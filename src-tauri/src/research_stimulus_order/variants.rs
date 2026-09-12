//! Successor P3 authoring grammar. No runtime allocation, clocks or recording.
use super::*;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsiDefinition {
    pub isi_id: String,
    pub duration_ms: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VariantDraft {
    pub columns: Vec<VariantColumn>,
    pub rows: Vec<Vec<String>>,
    pub entry_ids: Vec<Vec<String>>,
    pub isi_definitions: Vec<IsiDefinition>,
    pub next_isi_ordinal: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannedEntry {
    pub entry_id: String,
    pub kind: String,
    pub reference_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannedVariant {
    pub variant_id: String,
    pub title: String,
    pub entries: Vec<PlannedEntry>,
    pub version_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VariantDesign {
    pub schema: String,
    pub version: u8,
    pub library_sha256: String,
    pub isi_definitions: Vec<IsiDefinition>,
    pub variants: Vec<PlannedVariant>,
    pub allocation: Value,
    pub marker_contract: Value,
    pub integrity_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VariantDocument {
    pub schema: String,
    pub version: u8,
    pub library_sha256: String,
    pub draft: VariantDraft,
    pub contribution: VariantDesign,
    pub integrity_sha256: String,
}
pub(super) fn numbered(value: &str, prefix: &str) -> Option<u32> {
    let suffix = value.strip_prefix(prefix)?;
    if suffix.is_empty()
        || suffix.len() > 6
        || suffix.starts_with('0')
        || !suffix.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    suffix.parse().ok()
}
pub(super) fn marker_contract() -> Value {
    json!({
        "schema":"affect-research-planned-markers", "version":1,
        "vocabulary":["sessionStart","videoStart","videoEnd","isiStart","isiEnd","formStart","formEnd","pause","resume","interruption","restart","complete","partial"],
        "identity":"recipe-run-attempt-variant-entry-execution-v1",
        "clock":"runner-observed-monotonic-v1", "sequence":"strictly-increasing-per-run-v1",
        "onset":"observed-media-lifecycle-not-qualified-visible-onset-v1",
        "reconstruction":"embedded-codebook-paired-boundaries-no-gap-repair-v1"
    })
}
impl VariantDraft {
    pub fn validate(&self) -> ResearchResult<()> {
        self.validate_cell_bytes(160)
    }
    pub(super) fn validate_cell_bytes(&self, cell_bytes: usize) -> ResearchResult<()> {
        if self.columns.is_empty()
            || self.columns.len() > 64
            || self.rows.is_empty()
            || self.rows.len() > 1024
            || self.columns.len() * self.rows.len() > 32000
            || self.entry_ids.len() != self.rows.len()
            || self.isi_definitions.len() > 1024
            || !(1..=1000000).contains(&self.next_isi_ordinal)
        {
            return Err(invalid("Variant table bounds are invalid."));
        }
        let mut columns = BTreeSet::new();
        let mut titles = BTreeSet::new();
        let mut entries = BTreeSet::new();
        let mut intervals = BTreeSet::new();
        for column in &self.columns {
            if numbered(&column.variant_id, "variant-").is_none()
                || !columns.insert(&column.variant_id)
                || !safe_text(&column.title, 120)
                || column.title.trim() != column.title
                || !titles.insert(&column.title)
            {
                return Err(invalid("Use distinct valid variant identities and names."));
            }
        }
        for (r, row) in self.rows.iter().enumerate() {
            if row.len() != self.columns.len() || self.entry_ids[r].len() != row.len() {
                return Err(invalid(
                    "Every row needs one cell and identity per variant.",
                ));
            }
            for (c, cell) in row.iter().enumerate() {
                let id = &self.entry_ids[r][c];
                if cell.len() > cell_bytes
                    || numbered(id, &format!("{}-entry-", self.columns[c].variant_id)).is_none()
                    || !entries.insert(id)
                {
                    return Err(invalid("Invalid cell or repeated occurrence identity."));
                }
            }
        }
        for isi in &self.isi_definitions {
            if numbered(&isi.isi_id, "ISI").is_none_or(|n| n >= self.next_isi_ordinal)
                || !intervals.insert(&isi.isi_id)
                || isi.duration_ms > 3600000
            {
                return Err(invalid(
                    "ISI definitions require distinct stable IDs and 0 to 3600000 milliseconds.",
                ));
            }
        }
        Ok(())
    }
    pub fn compile(&self, library: &VideoLibrary) -> ResearchResult<VariantDesign> {
        self.validate()?;
        library.validate()?;
        if self.isi_definitions.iter().any(|isi| {
            library
                .videos
                .iter()
                .any(|video| video.annotation_id == isi.isi_id)
        }) {
            return Err(invalid("Video and ISI identities collide."));
        }
        let mut variants = Vec::new();
        for (c, column) in self.columns.iter().enumerate() {
            let last = self
                .rows
                .iter()
                .rposition(|row| !row[c].is_empty())
                .ok_or_else(|| invalid("Every variant needs at least one video."))?;
            let mut entries = Vec::new();
            let mut identities = Vec::new();
            let mut has_video = false;
            for (r, row) in self.rows[..=last].iter().enumerate() {
                let reference = &row[c];
                let kind = if let Some(video) = library
                    .videos
                    .iter()
                    .find(|video| &video.annotation_id == reference)
                {
                    identities.push(
                        serde_json::to_value(video)
                            .map_err(|_| invalid("Video identity cannot be encoded."))?,
                    );
                    has_video = true;
                    "video"
                } else if let Some(isi) = self
                    .isi_definitions
                    .iter()
                    .find(|isi| &isi.isi_id == reference)
                {
                    identities.push(
                        serde_json::to_value(isi)
                            .map_err(|_| invalid("ISI identity cannot be encoded."))?,
                    );
                    "isi"
                } else {
                    return Err(invalid("Use known video annotations or named ISIs, without interior blanks or numeric cells."));
                };
                entries.push(PlannedEntry {
                    entry_id: self.entry_ids[r][c].clone(),
                    kind: kind.into(),
                    reference_id: reference.clone(),
                });
            }
            if !has_video {
                return Err(invalid("Every variant needs at least one video."));
            }
            let version_sha256 = digest(
                &json!({"variantId":column.variant_id,"title":column.title,"entries":entries,"identities":identities}),
                &[],
            )?;
            variants.push(PlannedVariant {
                variant_id: column.variant_id.clone(),
                title: column.title.clone(),
                entries,
                version_sha256,
            });
        }
        let mut value = VariantDesign {
            schema: "affect-research-variant-design".into(),
            version: 1,
            library_sha256: library.integrity_sha256.clone(),
            isi_definitions: self.isi_definitions.clone(),
            variants,
            allocation: json!({"kind":"runnerAssigned"}),
            marker_contract: marker_contract(),
            integrity_sha256: String::new(),
        };
        value.integrity_sha256 = digest(&value, &["integritySha256"])?;
        Ok(value)
    }
}
impl VariantDocument {
    pub fn create(draft: VariantDraft, library: &VideoLibrary) -> ResearchResult<Self> {
        let contribution = draft.compile(library)?;
        let mut value = Self {
            schema: "affect-research-stimulus-order".into(),
            version: 2,
            library_sha256: library.integrity_sha256.clone(),
            draft,
            contribution,
            integrity_sha256: String::new(),
        };
        value.integrity_sha256 = digest(&value, &["integritySha256"])?;
        Ok(value)
    }
    pub fn validate(&self, library: &VideoLibrary) -> ResearchResult<()> {
        self.contribution.validate(library)?;
        if &Self::create(self.draft.clone(), library)? != self {
            return Err(invalid(
                "Variant document identity, references or integrity do not match.",
            ));
        }
        Ok(())
    }
}

impl VariantDesign {
    /// Validate a standalone master-recipe contribution without trusting saved derivations.
    pub fn validate(&self, library: &VideoLibrary) -> ResearchResult<()> {
        if self.variants.is_empty() || self.variants.len() > 64 || self.isi_definitions.len() > 1024
        {
            return Err(invalid("Variant contribution arrays are invalid."));
        }
        let height = self
            .variants
            .iter()
            .map(|v| v.entries.len())
            .max()
            .unwrap_or(0);
        if height == 0 || height > 1024 || height * self.variants.len() > 32000 {
            return Err(invalid("Variant contribution exceeds table bounds."));
        }
        let mut next_ids = Vec::new();
        for variant in &self.variants {
            let prefix = format!("{}-entry-", variant.variant_id);
            let mut maximum = 0;
            for entry in &variant.entries {
                maximum = maximum.max(
                    numbered(&entry.entry_id, &prefix)
                        .ok_or_else(|| invalid("Invalid entry identity."))?,
                );
            }
            next_ids.push(maximum + 1);
        }
        let mut rows = Vec::new();
        let mut entry_ids = Vec::new();
        for r in 0..height {
            let mut row = Vec::new();
            let mut ids = Vec::new();
            for (c, variant) in self.variants.iter().enumerate() {
                if let Some(entry) = variant.entries.get(r) {
                    row.push(entry.reference_id.clone());
                    ids.push(entry.entry_id.clone());
                } else {
                    row.push(String::new());
                    ids.push(format!("{}-entry-{}", variant.variant_id, next_ids[c]));
                    next_ids[c] += 1;
                }
            }
            rows.push(row);
            entry_ids.push(ids);
        }
        let mut next_isi_ordinal = 1;
        for isi in &self.isi_definitions {
            next_isi_ordinal = next_isi_ordinal.max(
                numbered(&isi.isi_id, "ISI").ok_or_else(|| invalid("Invalid ISI identity."))? + 1,
            );
        }
        let draft = VariantDraft {
            columns: self
                .variants
                .iter()
                .map(|v| VariantColumn {
                    variant_id: v.variant_id.clone(),
                    title: v.title.clone(),
                })
                .collect(),
            rows,
            entry_ids,
            isi_definitions: self.isi_definitions.clone(),
            next_isi_ordinal,
        };
        if &draft.compile(library)? != self {
            return Err(invalid(
                "Variant contribution integrity or source types do not match.",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum StoredStimulusOrder {
    Legacy(StimulusOrderDocument),
    Named(Box<VariantDocument>),
}
impl StoredStimulusOrder {
    pub fn validate(&self, library: &VideoLibrary) -> ResearchResult<()> {
        match self {
            Self::Legacy(value) => value.validate(library),
            Self::Named(value) => value.validate(library),
        }
    }
}
impl From<StimulusOrderDocument> for StoredStimulusOrder {
    fn from(value: StimulusOrderDocument) -> Self {
        Self::Legacy(value)
    }
}
impl From<VariantDocument> for StoredStimulusOrder {
    fn from(value: VariantDocument) -> Self {
        Self::Named(Box::new(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn named_isi_fixture_preserves_chronological_entries_and_js_hashes() {
        let value: Value = serde_json::from_str(include_str!(
            "../../../test/fixtures/variant-design-v1.json"
        ))
        .unwrap();
        let library: VideoLibrary = serde_json::from_value(value["library"].clone()).unwrap();
        let document: VariantDocument = serde_json::from_value(value["document"].clone()).unwrap();
        document.validate(&library).unwrap();
        document.contribution.validate(&library).unwrap();
        assert_eq!(
            document.contribution.allocation,
            json!({"kind":"runnerAssigned"})
        );
        let mut draft = document.draft.clone();
        draft.rows[1][0] = "500".into();
        assert!(draft.compile(&library).is_err());
        draft = document.draft.clone();
        draft.rows[1][0].clear();
        assert!(draft.compile(&library).is_err());
        draft = document.draft.clone();
        draft.entry_ids[1][0] = draft.entry_ids[0][0].clone();
        assert!(draft.compile(&library).is_err());
        let mut changed = document.clone();
        changed.contribution.variants[0].version_sha256 = "0".repeat(64);
        assert!(changed.validate(&library).is_err());
        changed = document.clone();
        changed.contribution.allocation = json!({"kind":"cyclicByOrdinal","ordinalBase":1});
        assert!(changed.validate(&library).is_err());
        let stored: StoredStimulusOrder =
            serde_json::from_value(value["document"].clone()).unwrap();
        stored.validate(&library).unwrap();
    }
}
