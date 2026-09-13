//! Version usage from XDF filenames within this exact JSON's recordings folder.
use crate::{
    research_error::{CommandError, ResearchResult},
    research_recorder::naming::parse_file_name,
    research_run_storage::checked_run_child,
    research_runner_session::RunnerDocument,
};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::Path};

pub(crate) fn usage(root: &Path, source: &str) -> ResearchResult<Value> {
    let document = RunnerDocument::read(source)?;
    let RunnerDocument::Master(loaded) = &document else {
        return Err(CommandError::invalid_contract(
            "Version usage requires a complete master.",
        ));
    };
    let ids = loaded.recipe.segment("P3")?["variants"]
        .as_array()
        .ok_or_else(|| CommandError::invalid_contract("Missing versions."))?
        .iter()
        .map(|v| v["variantId"].as_str().unwrap_or_default().to_owned())
        .collect::<Vec<_>>();
    let mut counts = vec![(0u32, BTreeSet::new()); ids.len()];
    let directory = document.ensure_directory(root)?;
    let mut ignored = 0u32;
    let path = directory.path.join("recordings");
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(CommandError::io(error)),
        Ok(_) => {
            let recordings = checked_run_child(&directory, "recordings")?;
            for (index, entry) in fs::read_dir(&recordings.path)
                .map_err(CommandError::io)?
                .enumerate()
            {
                if index >= 200_000 {
                    return Err(CommandError::forbidden(
                        "Recording inventory exceeds its inspection bound.",
                    ));
                }
                let entry = entry.map_err(CommandError::io)?;
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    continue;
                };
                if !name.to_ascii_lowercase().ends_with(".xdf") {
                    continue;
                }
                let kind = entry.file_type().map_err(CommandError::io)?;
                if !kind.is_file() || kind.is_symlink() {
                    return Err(CommandError::forbidden(
                        "Recording inventory contains a nonordinary XDF file.",
                    ));
                }
                if let Some((participant, ordinal)) = parse_file_name(name) {
                    if let Some((uses, participants)) = counts.get_mut(ordinal - 1) {
                        *uses += 1;
                        participants.insert(participant);
                        continue;
                    }
                }
                ignored += 1;
            }
            crate::research_run_storage::require_same_run_directory(
                &recordings,
                checked_run_child(&directory, "recordings")?,
            )?;
        }
    }
    let used_participants: BTreeSet<_> = counts
        .iter()
        .flat_map(|(_, participants)| participants.iter().cloned())
        .collect();
    let variants: Vec<_> = ids
        .iter()
        .enumerate()
        .map(|(index, id)| {
            let (uses, participants) = &counts[index];
            json!({"variantId":id,"recordingCount":uses,"participantCount":participants.len()})
        })
        .collect();
    Ok(
        json!({"schema":"affect-runner-variant-usage","version":1,"recipeSourceByteSha256":document.source_hash(),"basis":"xdf-file-names-v1","ignoredXdfFiles":ignored,"usedParticipantIds":used_participants,"variants":variants}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inventory_counts_files_not_results_and_isolates_json() {
        let root =
            std::env::temp_dir().join(format!("affect-version-usage-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("outputs")).unwrap();
        let source = include_str!("../../../test/fixtures/runner-master-v3-owner.canonical.json");
        let empty = usage(&root, source).unwrap();
        assert_eq!(empty["variants"][0]["recordingCount"], 0);
        assert_eq!(empty["usedParticipantIds"], json!([]));
        let directory = RunnerDocument::read(source)
            .unwrap()
            .ensure_directory(&root)
            .unwrap();
        let recordings =
            crate::research_run_storage::ensure_checked_run_child(&directory, "recordings")
                .unwrap();
        for name in [
            "P01_V1_20260913T143052123Z.xdf",
            "P01_V1_20260913T143052124Z.xdf",
            "P03_V1_20260913T143052125Z.xdf",
            "P02_V2_20260913T143052123Z.xdf",
            "recording-old.xdf",
            "P01_V9999_20260913T143052123Z.xdf",
        ] {
            fs::write(
                recordings.path.join(name),
                b"partial-or-complete-no-content-inspection",
            )
            .unwrap();
        }
        fs::write(
            recordings
                .path
                .join("P01_V1_20260913T143052123Z.xdf.recording.json"),
            b"stopped",
        )
        .unwrap();
        let result = usage(&root, source).unwrap();
        assert_eq!(result["variants"][0]["recordingCount"], 3);
        assert_eq!(result["variants"][0]["participantCount"], 2);
        assert_eq!(result["variants"][1]["recordingCount"], 1);
        assert_eq!(result["ignoredXdfFiles"], 2);
        assert_eq!(
            result["usedParticipantIds"],
            json!(["P001", "P002", "P003"])
        );
        let other =
            include_str!("../../../test/fixtures/planner-recipe-v2-locations.canonical.json");
        assert_eq!(
            usage(&root, other).unwrap()["variants"][0]["recordingCount"],
            0
        );
        fs::remove_file(recordings.path.join("P01_V1_20260913T143052124Z.xdf")).unwrap();
        assert_eq!(
            usage(&root, source).unwrap()["variants"][0]["recordingCount"],
            2
        );
        fs::create_dir(recordings.path.join("P04_V1_20260913T143052123Z.xdf")).unwrap();
        assert!(usage(&root, source).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
