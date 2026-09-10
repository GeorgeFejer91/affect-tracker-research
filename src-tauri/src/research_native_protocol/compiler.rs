use super::contracts::{ResolvedExperimentPlanV1, ResolvedProtocolPlanV2};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::{
    enumerate_language_routes, participant_assignment_sha256, resolved_experiment_plan,
    resolved_protocol_plan, settings_for_language, ExperimentPackageV1,
};
use crate::research_protocol::ResearchSettingsV3;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageAssetBindingV1 {
    pub stimulus_id: String,
    pub logical_path: String,
    pub package_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompiledPackageSelectionV1 {
    pub package_id: String,
    pub package_definition_sha256: String,
    pub package_source_byte_sha256: String,
    pub language_id: String,
    pub language_tag: String,
    pub language_selection_path: Vec<String>,
    pub participant_id: String,
    pub settings: ResearchSettingsV3,
    pub settings_sha256: String,
    pub experiment_plan: ResolvedExperimentPlanV1,
    pub assignment_sha256: String,
    pub protocol_plan: ResolvedProtocolPlanV2,
    pub asset_bindings: Vec<PackageAssetBindingV1>,
}

pub fn compile_package_selection(
    package: &ExperimentPackageV1,
    package_source_byte_sha256: &str,
    language_id: &str,
    language_selection_path: &[String],
    participant_id: &str,
) -> ResearchResult<CompiledPackageSelectionV1> {
    let routes = enumerate_language_routes(&package.language_selection)?;
    let route = routes
        .into_iter()
        .find(|route| route.language.language_id == language_id)
        .ok_or_else(|| {
            CommandError::invalid_contract(
                "The selected language is not a terminal package language.",
            )
        })?;
    if route.option_ids != language_selection_path {
        return Err(CommandError::invalid_contract(
            "The selected language path does not match the package language tree.",
        ));
    }
    let settings = settings_for_language(&package.settings, &route.language)?;
    let settings_sha256 = settings.canonical_sha256()?;
    let (experiment_value, experiment_plan_sha256) = resolved_experiment_plan(&settings)?;
    let experiment_plan = serde_json::from_value::<ResolvedExperimentPlanV1>(experiment_value)
        .map_err(|_| {
            CommandError::invalid_contract(
                "The package experiment plan could not enter its typed native boundary.",
            )
        })?;
    experiment_plan.validate_self()?;
    let assignment = experiment_plan
        .assignment_for(participant_id)
        .ok_or_else(|| {
            CommandError::invalid_contract(
                "The selected participant is not present in the package experiment plan.",
            )
        })?;
    let assignment_sha256 = participant_assignment_sha256(
        &serde_json::to_value(&experiment_plan).map_err(|_| {
            CommandError::invalid_contract("The native experiment plan could not be serialized.")
        })?,
        &assignment.participant_id,
    )?;
    let (protocol_value, protocol_plan_sha256) =
        resolved_protocol_plan(&settings, &experiment_plan_sha256, participant_id)?;
    let protocol_plan =
        serde_json::from_value::<ResolvedProtocolPlanV2>(protocol_value).map_err(|_| {
            CommandError::invalid_contract(
                "The package protocol plan could not enter its typed native boundary.",
            )
        })?;
    protocol_plan.validate_self()?;
    if protocol_plan.protocol_plan_hash_sha256 != protocol_plan_sha256
        || protocol_plan.settings_sha256 != settings_sha256
        || protocol_plan.assignment_plan_sha256 != experiment_plan.plan_hash_sha256
        || protocol_plan.participant_id != participant_id
    {
        return Err(CommandError::invalid_contract(
            "The native protocol plan does not bind the selected package projection.",
        ));
    }

    Ok(CompiledPackageSelectionV1 {
        package_id: package.package_id.clone(),
        package_definition_sha256: package.integrity.package_definition_sha256.clone(),
        package_source_byte_sha256: package_source_byte_sha256.to_owned(),
        language_id: route.language.language_id,
        language_tag: route.language.language_tag,
        language_selection_path: route.option_ids,
        participant_id: participant_id.to_owned(),
        settings,
        settings_sha256,
        experiment_plan,
        assignment_sha256,
        protocol_plan,
        asset_bindings: package
            .assets
            .stimuli
            .iter()
            .map(|asset| PackageAssetBindingV1 {
                stimulus_id: asset.stimulus_id.clone(),
                logical_path: asset
                    .relative_path
                    .strip_prefix("assets/")
                    .expect("validated package assets are beneath assets/")
                    .to_owned(),
                package_path: asset.relative_path.clone(),
                sha256: asset.sha256.clone(),
                byte_length: asset.byte_length,
                duration_ms: asset.duration_ms,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_experiment_package::parse_experiment_package_bytes;

    fn fixture() -> crate::research_experiment_package::LoadedExperimentPackageReceipt {
        parse_experiment_package_bytes(include_bytes!(
            "../../../test/fixtures/experiment-package-v1.canonical.json"
        ))
        .unwrap()
    }

    #[test]
    fn compiles_exact_typed_participant_and_language_projection() {
        let loaded = fixture();
        let compiled = compile_package_selection(
            &loaded.package,
            &loaded.source_byte_sha256,
            "en",
            &["en".to_owned()],
            "P001",
        )
        .unwrap();
        assert_eq!(compiled.language_id, "en");
        assert_eq!(compiled.language_selection_path, ["en"]);
        assert_eq!(compiled.settings.questionnaires.modules.len(), 3);
        assert_eq!(compiled.experiment_plan.assignments.len(), 2);
        assert_eq!(compiled.protocol_plan.participant_id, "P001");
        assert_eq!(
            compiled.protocol_plan.settings_sha256,
            compiled.settings_sha256
        );
        assert_eq!(
            compiled.protocol_plan.assignment_plan_sha256,
            compiled.experiment_plan.plan_hash_sha256
        );
        assert_ne!(
            compiled.assignment_sha256,
            compiled.experiment_plan.plan_hash_sha256
        );
        assert!(compiled.protocol_plan.steps.iter().any(|step| matches!(
            step,
            super::super::contracts::ProtocolStepV2::Interval { .. }
        )));
    }

    #[test]
    fn language_path_and_participant_are_fail_closed() {
        let loaded = fixture();
        assert!(compile_package_selection(
            &loaded.package,
            &loaded.source_byte_sha256,
            "en",
            &["de".to_owned()],
            "P001",
        )
        .is_err());
        assert!(compile_package_selection(
            &loaded.package,
            &loaded.source_byte_sha256,
            "en",
            &["en".to_owned()],
            "P999",
        )
        .is_err());
    }

    #[test]
    fn terminal_languages_compile_distinct_settings_without_changing_order() {
        let loaded = fixture();
        let english = compile_package_selection(
            &loaded.package,
            &loaded.source_byte_sha256,
            "en",
            &["en".to_owned()],
            "P002",
        )
        .unwrap();
        let german = compile_package_selection(
            &loaded.package,
            &loaded.source_byte_sha256,
            "de",
            &["de".to_owned()],
            "P002",
        )
        .unwrap();
        assert_ne!(english.settings_sha256, german.settings_sha256);
        assert_ne!(
            english.protocol_plan.protocol_plan_hash_sha256,
            german.protocol_plan.protocol_plan_hash_sha256
        );
        assert_eq!(
            english.experiment_plan.assignments[1].slots,
            german.experiment_plan.assignments[1].slots
        );
        assert_eq!(german.settings.questionnaires.modules.len(), 0);
    }
}
