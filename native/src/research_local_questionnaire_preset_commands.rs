//! Planner-only, fixed-source installation and readback. No caller paths.
use crate::research_desktop::DesktopRole;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_local_questionnaire_presets::{
    LocalQuestionnairePresetReceipt, LocalQuestionnairePresetSource, LocalQuestionnairePresetStore,
};
use serde::{Deserialize, Deserializer};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{State, WebviewWindow};

pub(crate) struct LocalPresetService(ResearchResult<Arc<LocalQuestionnairePresetStore>>);

impl LocalPresetService {
    pub fn new(app_data_root: PathBuf) -> Self {
        // Failure is local to this optional authoring library, not app startup.
        Self(
            std::fs::create_dir_all(&app_data_root)
                .map_err(CommandError::io)
                .and_then(|()| LocalQuestionnairePresetStore::new(app_data_root))
                .map(Arc::new),
        )
    }
    fn store(&self) -> ResearchResult<Arc<LocalQuestionnairePresetStore>> {
        self.0.clone()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalPresetReadRequest {
    preset_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalPresetInstallRequest {
    preset_id: String,
    #[serde(deserialize_with = "bounded_preset_bytes")]
    bytes: Vec<u8>,
}

fn bounded_preset_bytes<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
    struct Bytes;
    impl<'de> serde::de::Visitor<'de> for Bytes {
        type Value = Vec<u8>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("exactly 124978 questionnaire source bytes")
        }
        fn visit_seq<A: serde::de::SeqAccess<'de>>(
            self,
            mut sequence: A,
        ) -> Result<Self::Value, A::Error> {
            let mut bytes = Vec::with_capacity(124_978);
            while let Some(byte) = sequence.next_element::<u8>()? {
                if bytes.len() == 124_978 {
                    return Err(serde::de::Error::custom("Preset source is oversized."));
                }
                bytes.push(byte);
            }
            if bytes.len() != 124_978 {
                return Err(serde::de::Error::custom(
                    "Preset source has the wrong byte length.",
                ));
            }
            Ok(bytes)
        }
    }
    deserializer.deserialize_seq(Bytes)
}

fn authorize(label: &str, role: DesktopRole) -> ResearchResult<()> {
    if label != "research" || role != DesktopRole::Planner {
        return Err(CommandError::forbidden(
            "Local questionnaire presets belong to Experiment Planner.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn research_read_local_questionnaire_preset(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    service: State<'_, LocalPresetService>,
    request: LocalPresetReadRequest,
) -> ResearchResult<Option<LocalQuestionnairePresetSource>> {
    authorize(window.label(), *role)?;
    let store = service.store()?;
    tauri::async_runtime::spawn_blocking(move || store.read(&request.preset_id))
        .await
        .map_err(CommandError::io)?
}

#[tauri::command]
pub(crate) async fn research_install_local_questionnaire_preset(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    service: State<'_, LocalPresetService>,
    request: LocalPresetInstallRequest,
) -> ResearchResult<LocalQuestionnairePresetReceipt> {
    authorize(window.label(), *role)?;
    // The store independently checks the exact fixed ID, size and SHA-256.
    if request.bytes.len() != 124_978 {
        return Err(CommandError::invalid_contract(
            "Local preset source has the wrong byte length.",
        ));
    }
    let store = service.store()?;
    tauri::async_runtime::spawn_blocking(move || store.install(&request.preset_id, &request.bytes))
        .await
        .map_err(CommandError::io)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presets_are_planner_only_and_have_no_path_argument() {
        assert!(authorize("research", DesktopRole::Planner).is_ok());
        assert!(authorize("research", DesktopRole::Runner).is_err());
        assert!(authorize("other", DesktopRole::Planner).is_err());
        assert!(serde_json::from_str::<LocalPresetReadRequest>(
            r#"{"presetId":"x","path":"C:/x"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<LocalPresetInstallRequest>(
            r#"{"presetId":"x","bytes":[256]}"#
        )
        .is_err());
        assert!(serde_json::from_str::<LocalPresetInstallRequest>(
            r#"{"presetId":"x","bytes":[],"path":"C:/x"}"#
        )
        .is_err());
    }
}
