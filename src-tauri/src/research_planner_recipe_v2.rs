//! Master version 2: explicit mixed P2 and reproduction-v3 identities. No v1 rewriting.
use crate::research_contracts::{canonical_json, validate_sha256};
use crate::research_desktop_layout::DesktopLayoutContributionV1;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_feedback::FeedbackContributionV2;
use crate::research_planner_recipe::{
    owners, RecipeIntegrityV1, XrSelectionV1, MAX_BYTES, MAX_CASES,
};
use crate::research_planner_recipe_policy::PlannerRecipePolicyV1;
use crate::research_questionnaire_recipe_v2::QuestionnaireRecipeContributionV2;
use crate::research_workspace_contribution::{validate_workspace_contribution, WorkspaceContribution};
use crate::research_workspace_contribution::v3::{validate_workspace_contribution_v3, WorkspaceContributionV3};
use owners::hash;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
pub const SCHEMA: &str = "affect-research-planner-recipe";
pub const ALGORITHM: &str = "planner-recipe-reproduction-v3";
const SEGMENTS: [&str; 6] = ["P1", "P2", "P3", "P4", "P5", "P6"];
fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerRecipeV2 {
    pub schema: String,
    pub version: u32,
    pub recipe_id: String,
    pub presentation_target: String,
    pub policy: PlannerRecipePolicyV1,
    pub segments: RecipeSegmentsV2,
    pub integrity: RecipeIntegrityV1,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeSegmentsV2 {
    #[serde(rename = "P1")]
    pub p1: Value,
    #[serde(rename = "P2")]
    pub p2: QuestionnaireRecipeContributionV2,
    #[serde(rename = "P3")]
    pub p3: Value,
    #[serde(rename = "P4")]
    pub p4: DesktopLayoutContributionV1,
    #[serde(rename = "P5")]
    pub p5: FeedbackContributionV2,
    #[serde(rename = "P6")]
    pub p6: XrSelectionV1,
}
struct Prepared {
    routes: Vec<Value>,
    variants: Vec<Value>,
    presentations: Vec<Value>,
    matrix: Value,
}

enum PreparedWorkspace {
    Legacy(WorkspaceContribution),
    Controlled(WorkspaceContributionV3),
}
impl PreparedWorkspace {
    fn media(&self) -> Vec<crate::research_desktop_layout::MediaGeometry> {
        match self {
            Self::Legacy(value) => owners::media(value),
            Self::Controlled(value) => {
                let mut seen = std::collections::BTreeSet::new();
                value.video_catalogue.entries.iter()
                    .filter(|entry| seen.insert(&entry.asset_id))
                    .map(|entry| crate::research_desktop_layout::MediaGeometry {
                        asset_id: entry.asset_id.clone(),
                        display_width: entry.geometry.display_width_px() as f64,
                        display_height: entry.geometry.display_height_px() as f64,
                    }).collect()
            }
        }
    }
    fn variants(&self, contribution: &Value, definition_hash: &str) -> ResearchResult<Value> {
        match self {
            Self::Legacy(value) => crate::research_stimulus_order::reproduction::validate_and_reproduce_saved_variants(value, contribution, definition_hash),
            Self::Controlled(value) => crate::research_stimulus_order::reproduction::validate_and_reproduce_saved_variants_v3(value, contribution, definition_hash),
        }
    }
}

impl PlannerRecipeV2 {
    fn prepare(&self) -> ResearchResult<Prepared> {
        self.prepare_version(2)
    }

    fn prepare_version(&self, version: u32) -> ResearchResult<Prepared> {
        let algorithm = match version {
            2 => ALGORITHM,
            3 => "planner-recipe-reproduction-v4",
            _ => return Err(invalid("Unsupported Planner recipe version.")),
        };
        if self.schema != SCHEMA
            || self.version != version
            || self.integrity.algorithm_version != algorithm
        {
            return Err(invalid("Unsupported Planner recipe schema or algorithm."));
        }
        let id = self.recipe_id.as_bytes();
        if id.is_empty()
            || id.len() > 128
            || !id[0].is_ascii_alphanumeric()
            || id.iter().any(|b| {
                !(b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_' || *b == b'-')
            })
        {
            return Err(invalid(
                "Recipe ID requires 1–128 lowercase identifier characters.",
            ));
        }
        if !["desktop-screen", "webxr-immersive-vr"].contains(&self.presentation_target.as_str())
            || matches!(self.segments.p6, XrSelectionV1::Included { .. })
                != (self.presentation_target == "webxr-immersive-vr")
        {
            return Err(invalid(
                "P6 inclusion must match the explicit presentation target.",
            ));
        }
        self.policy.validate()?;
        self.segments.p2.validate()?;
        self.segments.p5.validate()?;
        if version == 2 && !matches!(self.segments.p1["version"].as_u64(), Some(1 | 2)) {
            return Err(invalid("Planner recipe v2 requires workspace v1/v2."));
        }
        let workspace = if version == 3 {
            PreparedWorkspace::Controlled(validate_workspace_contribution_v3(&self.segments.p1)?)
        } else {
            PreparedWorkspace::Legacy(validate_workspace_contribution(&self.segments.p1)?)
        };
        let media = workspace.media();
        let route_count = owners::route_count(&self.segments.p2.language_selection)?;
        let variant_count = self
            .segments
            .p3
            .get("variants")
            .and_then(Value::as_array)
            .map(Vec::len)
            .ok_or_else(|| invalid("P3 variants are required."))?;
        let presentation_count = if matches!(self.segments.p6, XrSelectionV1::Included { .. }) {
            2
        } else {
            1
        };
        let case_count = route_count * variant_count * presentation_count;
        if !(1..=64).contains(&variant_count) || route_count == 0 || case_count > MAX_CASES {
            return Err(invalid(
                "Variant × language path × presentation matrix exceeds recipe bounds.",
            ));
        }
        let definition_hash = crate::research_contracts::canonical_sha256(self, &["integrity"])?;
        validate_sha256(&self.integrity.definition_sha256, "recipe definition hash")?;
        validate_sha256(
            &self.integrity.reproduction_sha256,
            "recipe reproduction hash",
        )?;
        if definition_hash != self.integrity.definition_sha256 {
            return Err(invalid(
                "Recipe definition hash does not match saved content.",
            ));
        }
        let segments = serde_json::to_value(&self.segments)
            .map_err(|_| invalid("Invalid recipe segments."))?;
        let hashes = serde_json::to_value(&self.integrity.segment_sha256)
            .map_err(|_| invalid("Invalid recipe hashes."))?;
        for segment in SEGMENTS {
            let expected = hashes[segment]
                .as_str()
                .ok_or_else(|| invalid("Missing segment hash."))?;
            validate_sha256(expected, "segment hash")?;
            if hash(&segments[segment])? != expected {
                return Err(invalid(format!("{segment} content hash does not match.")));
            }
        }
        let routes = self.segments.p2.routes()?;
        let reproduced = workspace.variants(&self.segments.p3, &definition_hash)?;
        let variants = reproduced["variants"]
            .as_array()
            .ok_or_else(|| invalid("P3 reproduction is incomplete."))?
            .clone();
        if variants.len() != variant_count || routes.len() != route_count {
            return Err(invalid("Reproduction omitted a saved variant or route."));
        }
        let mut presentations = vec![json!({"presentationTarget":"desktop-screen","layout":
            owners::desktop_media(&self.segments.p4, &media, &self.segments.p5)?})];
        if let XrSelectionV1::Included { profile } = &self.segments.p6 {
            presentations.push(json!({"presentationTarget":"webxr-immersive-vr","layout":owners::xr_media(profile, &media, &self.segments.p5)?}));
        }
        let variant_hashes = variants.iter().map(|v| Ok(json!({"variantId":v["variantId"],"versionSha256":v["versionSha256"],
            "timelineSha256":hash(&v["timeline"])?,"markerProfileSha256":hash(&v["markerProfile"])?}))).collect::<ResearchResult<Vec<_>>>()?;
        let languages = routes
            .iter()
            .map(|r| {
                Ok(
                    json!({"languageId":r["languageId"],"languageSelectionPath":r["optionIds"],
            "questionnaireSha256":hash(r)?}),
                )
            })
            .collect::<ResearchResult<Vec<_>>>()?;
        let presentation_hashes = presentations.iter().map(|p| {

                let desktop = p["presentationTarget"] == "desktop-screen";
                let identity = json!({"schema":"affect-research-planner-layout-identity","version":1,
                    "presentationTarget":p["presentationTarget"],"algorithms":{
                        "layout":if desktop {"desktop-layout-resolution-v1"} else {"xr-layout-resolution-v1"},
                        "feedbackEnvelope":"feedback-envelope-v2",
                        "feedbackFootprint":if desktop {Value::Null} else {json!("xr-feedback-footprint-v1")}},
                    "profile":p["layout"]["profile"],"media":media,"feedback":self.segments.p5});
                Ok(json!({"presentationTarget":p["presentationTarget"],"layoutIdentitySha256":hash(&identity)?}))
        }).collect::<ResearchResult<Vec<_>>>()?;
        let policy_hash = hash(&self.policy)?;
        let feedback_hash = hash(&self.segments.p5)?;
        let mut cases = Vec::with_capacity(case_count);
        for variant in &variant_hashes {
            for language in &languages {
                for presentation in &presentation_hashes {
                    let identity = json!({"definitionSha256":definition_hash,"policySha256":policy_hash,"feedbackSha256":feedback_hash,
                "variant":variant,"language":language,"presentation":presentation});
                    cases.push(json!({"variantId":variant["variantId"],"languageId":language["languageId"],
                "languageSelectionPath":language["languageSelectionPath"],"presentationTarget":presentation["presentationTarget"],
                "selectionSha256":hash(&identity)?}));
                }
            }
        }
        let matrix = json!({"algorithmVersion":self.integrity.algorithm_version,"definitionSha256":definition_hash,"policySha256":policy_hash,
            "feedbackSha256":feedback_hash,"routeCount":route_count,"variantCount":variant_count,"presentationCount":presentation_count,
            "caseCount":case_count,"variants":variant_hashes,"languages":languages,"presentations":presentation_hashes,"cases":cases});
        if hash(&matrix)? != self.integrity.reproduction_sha256 {
            return Err(invalid(
                "Independent Planner reproduction does not match its saved hash.",
            ));
        }
        Ok(Prepared {
            routes,
            variants,
            presentations,
            matrix,
        })
    }

    pub fn validate(&self) -> ResearchResult<()> {
        self.prepare().map(|_| ())
    }
    pub fn reproduce(&self) -> ResearchResult<Value> {
        Ok(self.prepare()?.matrix)
    }
    pub fn canonical_file_bytes(&self) -> ResearchResult<Vec<u8>> {
        self.validate()?;
        let mut bytes = canonical_json(self, &[])?;
        bytes.push(b'\n');
        if bytes.len() > MAX_BYTES {
            return Err(invalid("Recipe exceeds 16 MiB."));
        }
        Ok(bytes)
    }
    pub fn reconstruct_selection(&self, selector: &Value) -> ResearchResult<Value> {
        self.reconstruct_selection_version(selector, 2)
    }

    pub(crate) fn validate_version(&self, version: u32) -> ResearchResult<()> {
        self.prepare_version(version).map(|_| ())
    }

    pub(crate) fn reproduce_version(&self, version: u32) -> ResearchResult<Value> {
        Ok(self.prepare_version(version)?.matrix)
    }

    pub(crate) fn reconstruct_selection_version(&self, selector: &Value, version: u32) -> ResearchResult<Value> {
        let prepared = self.prepare_version(version)?;
        let keys = selector
            .as_object()
            .ok_or_else(|| invalid("Explicit selection is required."))?;
        if keys.len() != 4
            || [
                "variantId",
                "languageId",
                "languageSelectionPath",
                "presentationTarget",
            ]
            .iter()
            .any(|k| !keys.contains_key(*k))
            || selector["presentationTarget"] != self.presentation_target
        {
            return Err(invalid(
                "Select the exact saved variant, language path and recipe target.",
            ));
        }
        let variant = prepared
            .variants
            .iter()
            .find(|v| v["variantId"] == selector["variantId"])
            .ok_or_else(|| invalid("Selected variant is absent."))?;
        let route = prepared
            .routes
            .iter()
            .find(|r| {
                r["languageId"] == selector["languageId"]
                    && r["optionIds"] == selector["languageSelectionPath"]
            })
            .ok_or_else(|| invalid("Selected language path is absent."))?;
        let presentation = prepared
            .presentations
            .iter()
            .find(|p| p["presentationTarget"] == selector["presentationTarget"])
            .ok_or_else(|| invalid("Selected presentation is absent."))?;
        Ok(
            json!({"schema":"affect-research-planner-selection","version":version,"recipeId":self.recipe_id,
            "definitionSha256":self.integrity.definition_sha256,"presentationTarget":self.presentation_target,
            "study":self.segments.p1["study"],"assets":self.segments.p1["videoCatalogue"]["entries"],
            "policy":self.policy,"feedback":self.segments.p5,
            "language":{"languageId":route["languageId"],"languageTag":route["languageTag"],"languageSelectionPath":route["optionIds"]},
            "questionnaires":{"beforeSession":route["beforeSession"],"afterSession":route["afterSession"]},
            "variant":{"variantId":variant["variantId"],"versionSha256":variant["versionSha256"]},
            "timeline":variant["timeline"],"markerProfile":variant["markerProfile"],"layout":presentation["layout"]}),
        )
    }
}
