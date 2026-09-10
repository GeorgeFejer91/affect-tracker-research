use crate::research_contracts::{
    canonical_json, canonical_sha256, normalize_identifier, normalize_text, validate_sha256,
    StimulusSourceV1, MAX_SAFE_INTEGER,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_external_protocol::{
    normalize_stimulus_path, EXTERNAL_ORDER_ALGORITHM_VERSION,
};
use crate::research_protocol::{
    QuestionnaireModuleV2, QuestionnairePlacementV2, QuestionnaireRelativeToIsiV1,
    ResearchSettingsV3,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const EXPERIMENT_PACKAGE_SCHEMA: &str = "affect-research-experiment-package";
pub const EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM: &str = "experiment-package-reproduction-v1";
pub const LANGUAGE_TREE_ALGORITHM: &str = "language-tree-v1";
pub const COMPLETE_VIDEO_PLAYBACK_ALGORITHM: &str = "complete-video-v1";
pub const EXPERIMENT_PACKAGE_ASSET_ROOT: &str = "assets/stimuli";
pub const EXPERIMENT_PACKAGE_FILE_NAME: &str = "experiment.package.json";
pub const MAX_EXPERIMENT_PACKAGE_BYTES: usize = 16 * 1024 * 1024;

const MAX_LANGUAGES: usize = 64;
const MAX_LANGUAGE_NODES: usize = 256;
const MAX_LANGUAGE_OPTIONS_PER_NODE: usize = 64;
const MAX_LANGUAGE_OPTIONS: usize = 16_384;
const MAX_LANGUAGE_QUESTIONNAIRE_MODULES: usize = 1_024;
const MAX_REPRODUCTION_CASES: usize = 25_000;
const MAX_ASSET_DURATION_MS: f64 = 86_400_000.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentPackageV1 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub package_id: String,
    pub asset_root: String,
    pub assets: ExperimentPackageAssetsV1,
    pub language_selection: LanguageSelectionTreeV1,
    pub playback: CompleteVideoPlaybackPolicyV1,
    pub settings: ResearchSettingsV3,
    pub integrity: ExperimentPackageIntegrityV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentPackageAssetsV1 {
    pub stimuli: Vec<ExperimentPackageStimulusAssetV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentPackageStimulusAssetV1 {
    pub stimulus_id: String,
    pub title: String,
    pub relative_path: String,
    pub mime_type: String,
    pub sha256: String,
    #[serde(deserialize_with = "deserialize_u64_integer")]
    pub byte_length: u64,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LanguageSelectionTreeV1 {
    pub algorithm_version: String,
    pub root_node_id: String,
    pub languages: Vec<PackageLanguageV1>,
    pub nodes: Vec<LanguageSelectionNodeV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageLanguageV1 {
    pub language_id: String,
    pub language_tag: String,
    pub label: String,
    pub questionnaire_module_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LanguageSelectionNodeV1 {
    pub node_id: String,
    pub prompt: String,
    pub options: Vec<LanguageSelectionOptionV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LanguageSelectionOptionV1 {
    pub option_id: String,
    pub label: String,
    pub target: LanguageSelectionTargetV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LanguageSelectionTargetV1 {
    Node { node_id: String },
    Language { language_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteVideoPlaybackPolicyV1 {
    pub algorithm_version: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub start_at_ms: u32,
    pub end_condition: PlaybackEndConditionV1,
    pub playback_rate: f64,
    pub r#loop: bool,
    pub seeking_allowed: bool,
    pub pause_allowed: bool,
    pub audio: CompleteVideoAudioPolicyV1,
    pub feedback_placement: FeedbackPlacementV1,
    pub recovery_restart: RecoveryRestartV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackEndConditionV1 {
    DecodedEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteVideoAudioPolicyV1 {
    pub muted: bool,
    pub volume: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FeedbackPlacementV1 {
    Adjacent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryRestartV1 {
    FromBeginning,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentPackageIntegrityV1 {
    pub algorithm_version: String,
    pub package_definition_sha256: String,
    pub settings_sha256: String,
    pub asset_manifest_sha256: String,
    pub experiment_plan_sha256: String,
    pub protocol_matrix_sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedExperimentPackageReceipt {
    pub package: ExperimentPackageV1,
    pub source_text: String,
    pub source_byte_sha256: String,
    pub canonical_source_text: String,
    pub canonical_source_byte_sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavedExperimentPackageReceipt {
    pub schema: &'static str,
    pub version: u32,
    pub package_id: String,
    pub package_definition_sha256: String,
    pub canonical_source_byte_sha256: String,
    pub byte_length: u64,
}

impl ExperimentPackageV1 {
    pub fn normalize_and_validate(mut self) -> ResearchResult<Self> {
        if self.schema != EXPERIMENT_PACKAGE_SCHEMA || self.version != 1 {
            return Err(contract_error(
                "ExperimentPackageV1 has an unsupported schema or version.",
            ));
        }
        self.package_id = strict_identifier(&self.package_id, "ExperimentPackageV1.packageId")?;
        if self.asset_root != EXPERIMENT_PACKAGE_ASSET_ROOT {
            return Err(contract_error(
                "ExperimentPackageV1.assetRoot must be assets/stimuli.",
            ));
        }

        self.settings = self.settings.normalize_and_validate()?;
        validate_canonical_embedded_experiment_source(&self.settings)?;
        normalize_and_validate_assets(&mut self.assets, &self.settings)?;
        self.language_selection = self.language_selection.normalize_and_validate()?;
        validate_questionnaire_language_routes(&self.settings, &self.language_selection)?;
        let reproduction_cases = (self.settings.experiment.participant_count as usize)
            .checked_mul(self.language_selection.languages.len())
            .ok_or_else(|| contract_error("The package reproduction matrix is too large."))?;
        if reproduction_cases > MAX_REPRODUCTION_CASES {
            return Err(contract_error(format!(
                "ExperimentPackageV1 participant × language matrix may not exceed {MAX_REPRODUCTION_CASES} cases."
            )));
        }
        self.playback.validate()?;

        if self.integrity.algorithm_version != EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM {
            return Err(contract_error(
                "ExperimentPackageV1 integrity algorithm is unsupported.",
            ));
        }
        validate_sha256(
            &self.integrity.package_definition_sha256,
            "ExperimentPackageV1.integrity.packageDefinitionSha256",
        )?;
        validate_sha256(
            &self.integrity.settings_sha256,
            "ExperimentPackageV1.integrity.settingsSha256",
        )?;
        validate_sha256(
            &self.integrity.asset_manifest_sha256,
            "ExperimentPackageV1.integrity.assetManifestSha256",
        )?;
        validate_sha256(
            &self.integrity.experiment_plan_sha256,
            "ExperimentPackageV1.integrity.experimentPlanSha256",
        )?;
        validate_sha256(
            &self.integrity.protocol_matrix_sha256,
            "ExperimentPackageV1.integrity.protocolMatrixSha256",
        )?;

        let settings_sha256 = self.settings.canonical_sha256()?;
        if self.integrity.settings_sha256 != settings_sha256 {
            return Err(contract_error(
                "ExperimentPackageV1 settings hash does not match its canonical settings.",
            ));
        }
        let asset_manifest_sha256 = canonical_sha256(&self.assets, &[])?;
        if self.integrity.asset_manifest_sha256 != asset_manifest_sha256 {
            return Err(contract_error(
                "ExperimentPackageV1 asset manifest hash does not match its canonical assets.",
            ));
        }
        let package_definition_sha256 = self.package_definition_sha256()?;
        if self.integrity.package_definition_sha256 != package_definition_sha256 {
            return Err(contract_error(
                "ExperimentPackageV1 self-hash does not match its canonical package definition.",
            ));
        }

        let expected = expected_derived_integrity(&self)?;
        if self.integrity.experiment_plan_sha256 != expected.experiment_plan_sha256 {
            return Err(contract_error(
                "ExperimentPackageV1 experiment-plan hash does not match its canonical external order.",
            ));
        }
        if self.integrity.protocol_matrix_sha256 != expected.protocol_matrix_sha256 {
            return Err(contract_error(
                "ExperimentPackageV1 protocol-matrix hash does not match every participant and language route.",
            ));
        }
        Ok(self)
    }

    pub fn package_definition_sha256(&self) -> ResearchResult<String> {
        canonical_sha256(self, &["integrity"])
    }

    pub fn canonical_file_bytes(&self) -> ResearchResult<Vec<u8>> {
        let mut bytes = canonical_json(self, &[])?;
        bytes.push(b'\n');
        Ok(bytes)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PackageLanguageRoute {
    pub(crate) language: PackageLanguageV1,
    pub(crate) option_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct ExpectedDerivedIntegrity {
    experiment_plan_sha256: String,
    protocol_matrix_sha256: String,
}

pub(crate) fn enumerate_language_routes(
    language_selection: &LanguageSelectionTreeV1,
) -> ResearchResult<Vec<PackageLanguageRoute>> {
    let nodes: BTreeMap<&str, &LanguageSelectionNodeV1> = language_selection
        .nodes
        .iter()
        .map(|node| (node.node_id.as_str(), node))
        .collect();
    let languages: BTreeMap<&str, &PackageLanguageV1> = language_selection
        .languages
        .iter()
        .map(|language| (language.language_id.as_str(), language))
        .collect();
    let mut routes = Vec::with_capacity(languages.len());
    let mut option_ids = Vec::new();
    collect_language_routes(
        &language_selection.root_node_id,
        &nodes,
        &languages,
        &mut option_ids,
        &mut routes,
    )?;
    if routes.len() != languages.len() {
        return Err(contract_error(
            "ExperimentPackageV1 language tree did not enumerate every terminal language exactly once.",
        ));
    }
    Ok(routes)
}

fn collect_language_routes(
    node_id: &str,
    nodes: &BTreeMap<&str, &LanguageSelectionNodeV1>,
    languages: &BTreeMap<&str, &PackageLanguageV1>,
    option_ids: &mut Vec<String>,
    routes: &mut Vec<PackageLanguageRoute>,
) -> ResearchResult<()> {
    let node = nodes.get(node_id).ok_or_else(|| {
        contract_error("ExperimentPackageV1 language route references a missing node.")
    })?;
    for option in &node.options {
        option_ids.push(option.option_id.clone());
        match &option.target {
            LanguageSelectionTargetV1::Node { node_id } => {
                collect_language_routes(node_id, nodes, languages, option_ids, routes)?;
            }
            LanguageSelectionTargetV1::Language { language_id } => {
                let language = languages.get(language_id.as_str()).ok_or_else(|| {
                    contract_error(
                        "ExperimentPackageV1 language route references a missing language.",
                    )
                })?;
                routes.push(PackageLanguageRoute {
                    language: (*language).clone(),
                    option_ids: option_ids.clone(),
                });
            }
        }
        option_ids.pop();
    }
    Ok(())
}

pub(crate) fn settings_for_language(
    settings: &ResearchSettingsV3,
    language: &PackageLanguageV1,
) -> ResearchResult<ResearchSettingsV3> {
    let modules: BTreeMap<&str, &QuestionnaireModuleV2> = settings
        .questionnaires
        .modules
        .iter()
        .map(|module| (module.module_id.as_str(), module))
        .collect();
    let definitions: BTreeMap<_, _> = settings
        .questionnaires
        .definitions
        .iter()
        .map(|definition| (definition.questionnaire_id.as_str(), definition))
        .collect();
    let mut selected_modules = Vec::with_capacity(language.questionnaire_module_ids.len());
    let mut selected_definitions = Vec::new();
    let mut included_definition_ids = BTreeSet::new();
    for module_id in &language.questionnaire_module_ids {
        let module = modules.get(module_id.as_str()).ok_or_else(|| {
            contract_error("ExperimentPackageV1 language route references a missing module.")
        })?;
        selected_modules.push((*module).clone());
        if included_definition_ids.insert(module.questionnaire_id.as_str()) {
            let definition = definitions
                .get(module.questionnaire_id.as_str())
                .ok_or_else(|| {
                    contract_error(
                        "ExperimentPackageV1 language route references a missing questionnaire definition.",
                    )
                })?;
            selected_definitions.push((*definition).clone());
        }
    }
    let mut selected = settings.clone();
    selected.questionnaires.definitions = selected_definitions;
    selected.questionnaires.modules = selected_modules;
    selected.normalize_and_validate()
}

pub(crate) fn resolved_experiment_plan(
    settings: &ResearchSettingsV3,
) -> ResearchResult<(Value, String)> {
    let settings_sha256 = settings.canonical_sha256()?;
    let definition = &settings.external_protocol.definition;
    let mut stimuli = Vec::with_capacity(definition.stimuli.len());
    for reference in &definition.stimuli {
        let stimulus = settings
            .stimuli
            .items
            .iter()
            .find(|stimulus| stimulus.stimulus_id == reference.stimulus_id)
            .ok_or_else(|| {
                contract_error("ExperimentPackageV1 plan references a missing verified stimulus.")
            })?;
        stimuli.push(serde_json::to_value(stimulus).map_err(|_| {
            contract_error("ExperimentPackageV1 could not serialize a verified stimulus.")
        })?);
    }

    let assignments = definition
        .schedules
        .iter()
        .map(|schedule| {
            let mut position = 0u32;
            let mut slots = Vec::new();
            for block in &schedule.blocks {
                for (pool_index, video) in block.videos.iter().enumerate() {
                    position += 1;
                    slots.push(json!({
                        "position": position,
                        "blockId": block.block_id,
                        "poolPosition": pool_index + 1,
                        "stimulusId": video.stimulus_id,
                        "isiAfterMs": video.isi_after_ms,
                    }));
                }
            }
            json!({
                "participantId": schedule.participant_id,
                "blockOrder": schedule.blocks.iter().map(|block| block.block_id.clone()).collect::<Vec<_>>(),
                "slots": slots,
            })
        })
        .collect::<Vec<_>>();

    let mut plan = json!({
        "schema": "affect-research-experiment-plan",
        "version": 1,
        "algorithmVersion": EXTERNAL_ORDER_ALGORITHM_VERSION,
        "experimentId": definition.experiment_id,
        "title": definition.title,
        "settingsSha256": settings_sha256,
        "sourceByteSha256": settings.external_protocol.source_byte_sha256,
        "definitionSha256": settings.external_protocol.definition_sha256,
        "participantIds": definition.schedules.iter().map(|schedule| schedule.participant_id.clone()).collect::<Vec<_>>(),
        "stimuli": stimuli,
        "blocks": definition.blocks,
        "assignments": assignments,
    });
    let plan_hash_sha256 = canonical_sha256(&plan, &[])?;
    plan.as_object_mut()
        .expect("resolved experiment plan is an object")
        .insert(
            "planHashSha256".to_owned(),
            Value::String(plan_hash_sha256.clone()),
        );
    Ok((plan, plan_hash_sha256))
}

pub(crate) fn participant_assignment_sha256(
    experiment_plan: &Value,
    participant_id: &str,
) -> ResearchResult<String> {
    let assignment = experiment_plan
        .get("assignments")
        .and_then(Value::as_array)
        .and_then(|assignments| {
            assignments.iter().find(|assignment| {
                assignment.get("participantId").and_then(Value::as_str) == Some(participant_id)
            })
        })
        .ok_or_else(|| {
            contract_error("ExperimentPackageV1 participant assignment projection is missing.")
        })?;
    canonical_sha256(assignment, &[])
}

fn append_questionnaire_step(
    steps: &mut Vec<Value>,
    module: &QuestionnaireModuleV2,
    block_position: Option<u32>,
    block_id: Option<&str>,
    stimulus: Option<(u32, u32, &str)>,
) {
    let placement = match &module.placement {
        QuestionnairePlacementV2::BeforeSession { .. } => "beforeSession",
        QuestionnairePlacementV2::AfterSession { .. } => "afterSession",
        QuestionnairePlacementV2::BeforeBlock { .. } => "beforeBlock",
        QuestionnairePlacementV2::AfterBlock { .. } => "afterBlock",
        QuestionnairePlacementV2::AfterStimulus { .. } => "afterStimulus",
    };
    let mut step = json!({
        "protocolPosition": steps.len() + 1,
        "kind": "questionnaire",
        "blockPosition": block_position,
        "blockId": block_id,
        "moduleId": module.module_id,
        "questionnaireId": module.questionnaire_id,
        "definitionSha256": module.definition_sha256,
        "placement": placement,
    });
    if let Some((stimulus_position, block_stimulus_position, stimulus_id)) = stimulus {
        let QuestionnairePlacementV2::AfterStimulus {
            relative_to_isi, ..
        } = module.placement
        else {
            unreachable!("only an after-stimulus questionnaire receives stimulus identity")
        };
        let object = step
            .as_object_mut()
            .expect("questionnaire protocol step is an object");
        object.insert(
            "stimulusPosition".to_owned(),
            Value::from(stimulus_position),
        );
        object.insert(
            "blockStimulusPosition".to_owned(),
            Value::from(block_stimulus_position),
        );
        object.insert(
            "stimulusId".to_owned(),
            Value::String(stimulus_id.to_owned()),
        );
        object.insert(
            "relativeToIsi".to_owned(),
            Value::String(
                match relative_to_isi {
                    QuestionnaireRelativeToIsiV1::Before => "before",
                    QuestionnaireRelativeToIsiV1::After => "after",
                }
                .to_owned(),
            ),
        );
    }
    steps.push(step);
}

pub(crate) fn resolved_protocol_plan(
    settings: &ResearchSettingsV3,
    experiment_plan_sha256: &str,
    participant_id: &str,
) -> ResearchResult<(Value, String)> {
    let schedule = settings
        .external_protocol
        .definition
        .schedules
        .iter()
        .find(|schedule| schedule.participant_id == participant_id)
        .ok_or_else(|| contract_error("ExperimentPackageV1 protocol participant is missing."))?;
    let modules = &settings.questionnaires.modules;
    let mut steps = Vec::new();
    for module in modules {
        if matches!(
            module.placement,
            QuestionnairePlacementV2::BeforeSession { .. }
        ) {
            append_questionnaire_step(&mut steps, module, None, None, None);
        }
    }

    let mut stimulus_position = 0u32;
    for (block_index, block) in schedule.blocks.iter().enumerate() {
        let block_position = (block_index + 1) as u32;
        for module in modules {
            if matches!(
                &module.placement,
                QuestionnairePlacementV2::BeforeBlock { block_id } if block_id == &block.block_id
            ) {
                append_questionnaire_step(
                    &mut steps,
                    module,
                    Some(block_position),
                    Some(&block.block_id),
                    None,
                );
            }
        }
        for (video_index, video) in block.videos.iter().enumerate() {
            stimulus_position += 1;
            let block_stimulus_position = (video_index + 1) as u32;
            let shared = json!({
                "stimulusPosition": stimulus_position,
                "blockPosition": block_position,
                "blockId": block.block_id,
                "blockStimulusPosition": block_stimulus_position,
                "stimulusId": video.stimulus_id,
            });
            let mut stimulus = shared.clone();
            let stimulus_object = stimulus
                .as_object_mut()
                .expect("stimulus protocol step is an object");
            stimulus_object.insert("protocolPosition".to_owned(), Value::from(steps.len() + 1));
            stimulus_object.insert("kind".to_owned(), Value::String("stimulus".to_owned()));
            steps.push(stimulus);

            for module in modules {
                if matches!(
                    &module.placement,
                    QuestionnairePlacementV2::AfterStimulus { stimulus_id, relative_to_isi: QuestionnaireRelativeToIsiV1::Before, .. }
                        if stimulus_id == &video.stimulus_id
                ) {
                    append_questionnaire_step(
                        &mut steps,
                        module,
                        Some(block_position),
                        Some(&block.block_id),
                        Some((
                            stimulus_position,
                            block_stimulus_position,
                            &video.stimulus_id,
                        )),
                    );
                }
            }

            let mut interval = shared;
            let interval_object = interval
                .as_object_mut()
                .expect("interval protocol step is an object");
            interval_object.insert("protocolPosition".to_owned(), Value::from(steps.len() + 1));
            interval_object.insert("kind".to_owned(), Value::String("interval".to_owned()));
            interval_object.insert("durationMs".to_owned(), Value::from(video.isi_after_ms));
            steps.push(interval);

            for module in modules {
                if matches!(
                    &module.placement,
                    QuestionnairePlacementV2::AfterStimulus { stimulus_id, relative_to_isi: QuestionnaireRelativeToIsiV1::After, .. }
                        if stimulus_id == &video.stimulus_id
                ) {
                    append_questionnaire_step(
                        &mut steps,
                        module,
                        Some(block_position),
                        Some(&block.block_id),
                        Some((
                            stimulus_position,
                            block_stimulus_position,
                            &video.stimulus_id,
                        )),
                    );
                }
            }
        }
        for module in modules {
            if matches!(
                &module.placement,
                QuestionnairePlacementV2::AfterBlock { block_id } if block_id == &block.block_id
            ) {
                append_questionnaire_step(
                    &mut steps,
                    module,
                    Some(block_position),
                    Some(&block.block_id),
                    None,
                );
            }
        }
    }
    for module in modules {
        if matches!(
            module.placement,
            QuestionnairePlacementV2::AfterSession { .. }
        ) {
            append_questionnaire_step(&mut steps, module, None, None, None);
        }
    }

    let mut plan = json!({
        "schema": "affect-research-protocol-plan",
        "version": 2,
        "algorithmVersion": "external-questionnaire-hooks-v1",
        "settingsSha256": settings.canonical_sha256()?,
        "assignmentPlanSha256": experiment_plan_sha256,
        "participantId": participant_id,
        "blockOrder": schedule.blocks.iter().map(|block| block.block_id.clone()).collect::<Vec<_>>(),
        "steps": steps,
    });
    let protocol_plan_hash_sha256 = canonical_sha256(&plan, &[])?;
    plan.as_object_mut()
        .expect("resolved protocol plan is an object")
        .insert(
            "protocolPlanHashSha256".to_owned(),
            Value::String(protocol_plan_hash_sha256.clone()),
        );
    Ok((plan, protocol_plan_hash_sha256))
}

fn expected_derived_integrity(
    package: &ExperimentPackageV1,
) -> ResearchResult<ExpectedDerivedIntegrity> {
    let (_, experiment_plan_sha256) = resolved_experiment_plan(&package.settings)?;
    let routes = enumerate_language_routes(&package.language_selection)?;
    let mut matrix = Vec::new();
    for route in routes {
        let selected_settings = settings_for_language(&package.settings, &route.language)?;
        let settings_sha256 = selected_settings.canonical_sha256()?;
        let (selected_experiment_plan, selected_experiment_plan_sha256) =
            resolved_experiment_plan(&selected_settings)?;
        for schedule in &selected_settings.external_protocol.definition.schedules {
            let assignment_sha256 =
                participant_assignment_sha256(&selected_experiment_plan, &schedule.participant_id)?;
            let (_, protocol_plan_sha256) = resolved_protocol_plan(
                &selected_settings,
                &selected_experiment_plan_sha256,
                &schedule.participant_id,
            )?;
            matrix.push(json!({
                "participantId": schedule.participant_id,
                "languageId": route.language.language_id,
                "languageTag": route.language.language_tag,
                "languageSelectionPath": route.option_ids,
                "settingsSha256": settings_sha256,
                "experimentPlanSha256": selected_experiment_plan_sha256,
                "assignmentSha256": assignment_sha256,
                "protocolPlanSha256": protocol_plan_sha256,
            }));
        }
    }
    Ok(ExpectedDerivedIntegrity {
        experiment_plan_sha256,
        protocol_matrix_sha256: canonical_sha256(&matrix, &[])?,
    })
}

impl LanguageSelectionTreeV1 {
    fn normalize_and_validate(mut self) -> ResearchResult<Self> {
        if self.algorithm_version != LANGUAGE_TREE_ALGORITHM {
            return Err(contract_error(
                "ExperimentPackageV1 language-selection algorithm is unsupported.",
            ));
        }
        if !(1..=MAX_LANGUAGES).contains(&self.languages.len())
            || !(1..=MAX_LANGUAGE_NODES).contains(&self.nodes.len())
        {
            return Err(contract_error(
                "ExperimentPackageV1 language selection exceeds its bounded tree limits.",
            ));
        }
        self.root_node_id = strict_identifier(
            &self.root_node_id,
            "ExperimentPackageV1.languageSelection.rootNodeId",
        )?;

        let mut language_ids = BTreeSet::new();
        let mut language_tags = BTreeSet::new();
        for language in &mut self.languages {
            language.language_id = strict_identifier(
                &language.language_id,
                "ExperimentPackageV1.languageSelection.languageId",
            )?;
            language.language_tag = normalize_language_tag(&language.language_tag)?;
            language.label = strict_bounded_text(
                &language.label,
                1,
                120,
                "ExperimentPackageV1.languageSelection.language.label",
            )?;
            if language.questionnaire_module_ids.len() > MAX_LANGUAGE_QUESTIONNAIRE_MODULES {
                return Err(contract_error(format!(
                    "Each package language may map at most {MAX_LANGUAGE_QUESTIONNAIRE_MODULES} questionnaire modules."
                )));
            }
            let mut questionnaire_module_ids = BTreeSet::new();
            for module_id in &mut language.questionnaire_module_ids {
                *module_id = strict_identifier(
                    module_id,
                    "ExperimentPackageV1.languageSelection.language.questionnaireModuleIds",
                )?;
                if !questionnaire_module_ids.insert(module_id.clone()) {
                    return Err(contract_error(
                        "A package language repeats a questionnaire module ID.",
                    ));
                }
            }
            if !language_ids.insert(language.language_id.clone())
                || !language_tags.insert(language.language_tag.clone())
            {
                return Err(contract_error(
                    "ExperimentPackageV1 language selection repeats a language ID or tag.",
                ));
            }
        }

        let mut node_ids = BTreeSet::new();
        let mut total_options = 0usize;
        for node in &mut self.nodes {
            node.node_id = strict_identifier(
                &node.node_id,
                "ExperimentPackageV1.languageSelection.nodeId",
            )?;
            node.prompt = strict_bounded_text(
                &node.prompt,
                1,
                500,
                "ExperimentPackageV1.languageSelection.node.prompt",
            )?;
            if !node_ids.insert(node.node_id.clone()) {
                return Err(contract_error(
                    "ExperimentPackageV1 language selection repeats a node ID.",
                ));
            }
            if !(1..=MAX_LANGUAGE_OPTIONS_PER_NODE).contains(&node.options.len()) {
                return Err(contract_error(
                    "Every language-selection node must contain a bounded nonempty option list.",
                ));
            }
            total_options = total_options
                .checked_add(node.options.len())
                .ok_or_else(|| contract_error("The language-selection tree is too large."))?;
            if total_options > MAX_LANGUAGE_OPTIONS {
                return Err(contract_error(
                    "ExperimentPackageV1 language selection contains too many options.",
                ));
            }
            let mut option_ids = BTreeSet::new();
            for option in &mut node.options {
                option.option_id = strict_identifier(
                    &option.option_id,
                    "ExperimentPackageV1.languageSelection.optionId",
                )?;
                option.label = strict_bounded_text(
                    &option.label,
                    1,
                    120,
                    "ExperimentPackageV1.languageSelection.option.label",
                )?;
                if !option_ids.insert(option.option_id.clone()) {
                    return Err(contract_error(
                        "A language-selection node repeats an option ID.",
                    ));
                }
                match &mut option.target {
                    LanguageSelectionTargetV1::Node { node_id } => {
                        *node_id = strict_identifier(
                            node_id,
                            "ExperimentPackageV1.languageSelection.target.nodeId",
                        )?;
                    }
                    LanguageSelectionTargetV1::Language { language_id } => {
                        *language_id = strict_identifier(
                            language_id,
                            "ExperimentPackageV1.languageSelection.target.languageId",
                        )?;
                    }
                }
            }
        }

        if !node_ids.contains(&self.root_node_id) {
            return Err(contract_error(
                "ExperimentPackageV1 language-selection root node is missing.",
            ));
        }
        validate_true_language_tree(&self.root_node_id, &self.nodes, &node_ids, &language_ids)?;
        Ok(self)
    }
}

impl CompleteVideoPlaybackPolicyV1 {
    fn validate(&self) -> ResearchResult<()> {
        if self.algorithm_version != COMPLETE_VIDEO_PLAYBACK_ALGORITHM
            || self.start_at_ms != 0
            || self.end_condition != PlaybackEndConditionV1::DecodedEnd
            || self.playback_rate != 1.0
            || self.r#loop
            || self.seeking_allowed
            || !self.pause_allowed
            || self.audio.muted
            || self.audio.volume != 1.0
            || self.feedback_placement != FeedbackPlacementV1::Adjacent
            || self.recovery_restart != RecoveryRestartV1::FromBeginning
        {
            return Err(contract_error(
                "ExperimentPackageV1 playback must use the complete-video-v1 policy exactly.",
            ));
        }
        Ok(())
    }
}

pub fn parse_experiment_package_bytes(
    bytes: &[u8],
) -> ResearchResult<LoadedExperimentPackageReceipt> {
    if bytes.is_empty() || bytes.len() > MAX_EXPERIMENT_PACKAGE_BYTES {
        return Err(contract_error(format!(
            "An experiment package must contain 1–{MAX_EXPERIMENT_PACKAGE_BYTES} bytes."
        )));
    }
    let decoded = std::str::from_utf8(bytes)
        .map_err(|_| contract_error("An experiment package must be valid UTF-8."))?;
    let package = serde_json::from_str::<ExperimentPackageV1>(decoded)
        .map_err(|_| contract_error("The selected file is not valid ExperimentPackageV1 JSON."))?
        .normalize_and_validate()?;
    let canonical_bytes = package.canonical_file_bytes()?;
    if canonical_bytes.as_slice() != bytes {
        return Err(contract_error(
            "experiment.package.json must use exact canonical UTF-8 JSON bytes with one trailing LF.",
        ));
    }
    let source_byte_sha256 = sha256_hex(bytes);
    let canonical_source_text = String::from_utf8(canonical_bytes)
        .map_err(|_| contract_error("The canonical experiment package could not be encoded."))?;
    Ok(LoadedExperimentPackageReceipt {
        package,
        source_text: canonical_source_text.clone(),
        source_byte_sha256: source_byte_sha256.clone(),
        canonical_source_text,
        canonical_source_byte_sha256: source_byte_sha256,
    })
}

pub fn parse_canonical_experiment_package_text(
    text: &str,
) -> ResearchResult<LoadedExperimentPackageReceipt> {
    let receipt = parse_experiment_package_bytes(text.as_bytes())?;
    if receipt.canonical_source_text.as_bytes() != text.as_bytes() {
        return Err(contract_error(
            "Saving requires the exact canonical ExperimentPackageV1 text with one trailing newline.",
        ));
    }
    Ok(receipt)
}

impl SavedExperimentPackageReceipt {
    pub fn from_loaded(receipt: &LoadedExperimentPackageReceipt) -> ResearchResult<Self> {
        Ok(Self {
            schema: "affect-research-experiment-package-save-receipt",
            version: 1,
            package_id: receipt.package.package_id.clone(),
            package_definition_sha256: receipt.package.integrity.package_definition_sha256.clone(),
            canonical_source_byte_sha256: receipt.canonical_source_byte_sha256.clone(),
            byte_length: u64::try_from(receipt.canonical_source_text.len())
                .map_err(|_| contract_error("The canonical experiment package is too large."))?,
        })
    }
}

fn normalize_and_validate_assets(
    assets: &mut ExperimentPackageAssetsV1,
    settings: &ResearchSettingsV3,
) -> ResearchResult<()> {
    if assets.stimuli.is_empty() || assets.stimuli.len() != settings.stimuli.items.len() {
        return Err(contract_error(
            "ExperimentPackageV1 assets must match the embedded settings stimuli one-to-one.",
        ));
    }
    let settings_stimuli: BTreeMap<_, _> = settings
        .stimuli
        .items
        .iter()
        .map(|stimulus| (stimulus.stimulus_id.as_str(), stimulus))
        .collect();
    let mut asset_ids = BTreeSet::new();
    let mut asset_paths = BTreeSet::new();
    for (index, asset) in assets.stimuli.iter_mut().enumerate() {
        asset.stimulus_id =
            strict_identifier(&asset.stimulus_id, "ExperimentPackageV1.assets.stimulusId")?;
        asset.title =
            strict_bounded_text(&asset.title, 1, 200, "ExperimentPackageV1.assets.title")?;
        asset.relative_path = normalize_package_asset_path(&asset.relative_path)?;
        asset.mime_type = strict_bounded_text(
            &asset.mime_type,
            1,
            100,
            "ExperimentPackageV1.assets.mimeType",
        )?
        .to_ascii_lowercase();
        if !is_video_mime_type(&asset.mime_type) {
            return Err(contract_error(
                "ExperimentPackageV1 asset mimeType must identify video media.",
            ));
        }
        validate_sha256(&asset.sha256, "ExperimentPackageV1.assets.stimulus.sha256")?;
        if asset.byte_length == 0 || asset.byte_length > MAX_SAFE_INTEGER {
            return Err(contract_error(
                "ExperimentPackageV1 asset byteLength is outside the exact JSON integer range.",
            ));
        }
        if !asset.duration_ms.is_finite()
            || !(1.0..=MAX_ASSET_DURATION_MS).contains(&asset.duration_ms)
        {
            return Err(contract_error(
                "ExperimentPackageV1 asset durationMs is outside its supported range.",
            ));
        }
        if !asset_ids.insert(asset.stimulus_id.clone())
            || !asset_paths.insert(asset.relative_path.clone())
        {
            return Err(contract_error(
                "ExperimentPackageV1 assets repeat a stimulus ID or package path.",
            ));
        }

        if settings.stimuli.items[index].stimulus_id != asset.stimulus_id {
            return Err(contract_error(
                "ExperimentPackageV1 assets must use canonical settings stimulus order.",
            ));
        }

        let settings_stimulus = settings_stimuli
            .get(asset.stimulus_id.as_str())
            .ok_or_else(|| {
                contract_error(
                    "ExperimentPackageV1 assets reference a stimulus absent from settings.",
                )
            })?;
        let StimulusSourceV1::WorkspaceFile {
            relative_path,
            mime_type,
            sha256,
            byte_length,
            duration_ms,
        } = &settings_stimulus.source
        else {
            return Err(contract_error(
                "ExperimentPackageV1 supports embedded workspace-file stimuli only.",
            ));
        };
        if asset.title != settings_stimulus.title
            || asset.relative_path != format!("assets/{relative_path}")
            || asset.mime_type != *mime_type
            || asset.sha256 != *sha256
            || asset.byte_length != *byte_length
            || asset.duration_ms != *duration_ms
        {
            return Err(contract_error(
                "ExperimentPackageV1 asset identity differs from embedded ResearchSettingsV3.",
            ));
        }
    }
    Ok(())
}

fn normalize_package_asset_path(value: &str) -> ResearchResult<String> {
    if value.encode_utf16().count() > 1_024 {
        return Err(contract_error(
            "ExperimentPackageV1 asset paths must be bounded beneath assets/stimuli/.",
        ));
    }
    let Some(logical_path) = value.strip_prefix("assets/") else {
        return Err(contract_error(
            "ExperimentPackageV1 asset paths must be beneath assets/stimuli/.",
        ));
    };
    let normalized = normalize_stimulus_path(
        logical_path,
        "ExperimentPackageV1.assets.stimulus.relativePath",
    )?;
    if normalized != logical_path {
        return Err(contract_error(
            "ExperimentPackageV1 asset paths must use NFC-normalized path components.",
        ));
    }
    Ok(format!("assets/{normalized}"))
}

fn validate_canonical_embedded_experiment_source(
    settings: &ResearchSettingsV3,
) -> ResearchResult<()> {
    let mut source = canonical_json(&settings.external_protocol.definition, &[])?;
    source.push(b'\n');
    if settings.external_protocol.source_byte_sha256 != sha256_hex(&source) {
        return Err(contract_error(
            "ExperimentPackageV1 settings must bind the canonical embedded experiment source bytes.",
        ));
    }
    Ok(())
}

fn validate_true_language_tree(
    root_node_id: &str,
    nodes: &[LanguageSelectionNodeV1],
    node_ids: &BTreeSet<String>,
    language_ids: &BTreeSet<String>,
) -> ResearchResult<()> {
    let mut node_incoming: BTreeMap<&str, usize> =
        node_ids.iter().map(|id| (id.as_str(), 0)).collect();
    let mut language_incoming: BTreeMap<&str, usize> =
        language_ids.iter().map(|id| (id.as_str(), 0)).collect();

    for node in nodes {
        for option in &node.options {
            let incoming = match &option.target {
                LanguageSelectionTargetV1::Node { node_id } => {
                    node_incoming.get_mut(node_id.as_str()).ok_or_else(|| {
                        contract_error("A language-selection option references an unknown node.")
                    })?
                }
                LanguageSelectionTargetV1::Language { language_id } => language_incoming
                    .get_mut(language_id.as_str())
                    .ok_or_else(|| {
                        contract_error(
                            "A language-selection option references an unknown language.",
                        )
                    })?,
            };
            *incoming += 1;
            if *incoming > 1 {
                return Err(contract_error(
                    "Every language-selection node and language must have exactly one parent.",
                ));
            }
        }
    }

    if node_incoming.get(root_node_id).copied() != Some(0)
        || node_incoming
            .iter()
            .any(|(node_id, incoming)| *node_id != root_node_id && *incoming != 1)
        || language_incoming.values().any(|incoming| *incoming != 1)
    {
        return Err(contract_error(
            "ExperimentPackageV1 language selection must be one rooted tree with every leaf reachable exactly once.",
        ));
    }

    let node_by_id: BTreeMap<_, _> = nodes
        .iter()
        .map(|node| (node.node_id.as_str(), node))
        .collect();
    let mut pending = VecDeque::from([root_node_id]);
    let mut reached_nodes = BTreeSet::from([root_node_id]);
    let mut reached_languages = BTreeSet::new();
    while let Some(node_id) = pending.pop_front() {
        let node = node_by_id
            .get(node_id)
            .ok_or_else(|| contract_error("The language-selection tree is inconsistent."))?;
        for option in &node.options {
            match &option.target {
                LanguageSelectionTargetV1::Node { node_id } => {
                    if !reached_nodes.insert(node_id.as_str()) {
                        return Err(contract_error(
                            "ExperimentPackageV1 language selection contains a cycle.",
                        ));
                    }
                    pending.push_back(node_id);
                }
                LanguageSelectionTargetV1::Language { language_id } => {
                    if !reached_languages.insert(language_id.as_str()) {
                        return Err(contract_error(
                            "ExperimentPackageV1 language selection reaches a language more than once.",
                        ));
                    }
                }
            }
        }
    }
    if reached_nodes.len() != node_ids.len() || reached_languages.len() != language_ids.len() {
        return Err(contract_error(
            "ExperimentPackageV1 language selection contains an unreachable node or language.",
        ));
    }
    Ok(())
}

fn normalize_language_tag(value: &str) -> ResearchResult<String> {
    let normalized = strict_bounded_text(
        value,
        2,
        80,
        "ExperimentPackageV1.languageSelection.languageTag",
    )?;
    let mut parts = normalized.split('-');
    let primary = parts.next().unwrap_or_default();
    if !(2..=8).contains(&primary.len())
        || !primary.bytes().all(|byte| byte.is_ascii_alphabetic())
        || parts.any(|part| {
            part.is_empty()
                || part.len() > 8
                || !part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
    {
        return Err(contract_error(
            "ExperimentPackageV1 language tags must use bounded BCP-47 spelling.",
        ));
    }
    Ok(normalized)
}

fn strict_identifier(value: &str, label: &str) -> ResearchResult<String> {
    let normalized = normalize_identifier(value, label)?;
    if normalized != value {
        return Err(contract_error(format!(
            "{label} must use canonical lowercase identifier spelling."
        )));
    }
    Ok(normalized)
}

fn strict_bounded_text(
    value: &str,
    minimum: usize,
    maximum: usize,
    label: &str,
) -> ResearchResult<String> {
    let normalized = normalize_text(value, minimum, maximum, label)?;
    if normalized != value {
        return Err(contract_error(format!(
            "{label} must use trimmed NFC text."
        )));
    }
    Ok(normalized)
}

fn is_video_mime_type(value: &str) -> bool {
    value.strip_prefix("video/").is_some_and(|subtype| {
        !subtype.is_empty()
            && subtype.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'.' | b'+' | b'-')
            })
    })
}

fn validate_questionnaire_language_routes(
    settings: &ResearchSettingsV3,
    language_selection: &LanguageSelectionTreeV1,
) -> ResearchResult<()> {
    let language_tags: BTreeSet<_> = language_selection
        .languages
        .iter()
        .map(|language| language.language_tag.as_str())
        .collect();
    if settings
        .questionnaires
        .definitions
        .iter()
        .any(|definition| {
            definition.language != "und" && !language_tags.contains(definition.language.as_str())
        })
    {
        return Err(contract_error(
            "ExperimentPackageV1 questionnaire languages must exist in its language tree or use und.",
        ));
    }
    let definitions: BTreeMap<_, _> = settings
        .questionnaires
        .definitions
        .iter()
        .map(|definition| (definition.questionnaire_id.as_str(), definition))
        .collect();
    let modules: BTreeMap<_, _> = settings
        .questionnaires
        .modules
        .iter()
        .map(|module| (module.module_id.as_str(), module))
        .collect();
    let mut mapped_module_ids = BTreeSet::new();
    for language in &language_selection.languages {
        for module_id in &language.questionnaire_module_ids {
            let module = modules.get(module_id.as_str()).ok_or_else(|| {
                contract_error(format!(
                    "Language {} maps unknown questionnaire module {module_id}.",
                    language.language_id
                ))
            })?;
            let definition = definitions
                .get(module.questionnaire_id.as_str())
                .ok_or_else(|| {
                    contract_error("A mapped package questionnaire module has no bound definition.")
                })?;
            if definition.language != "und" && definition.language != language.language_tag {
                return Err(contract_error(format!(
                    "Language {} maps questionnaire module {module_id} to a definition with an incompatible language.",
                    language.language_id
                )));
            }
            mapped_module_ids.insert(module_id.as_str());
        }
    }
    if let Some(module) = settings
        .questionnaires
        .modules
        .iter()
        .find(|module| !mapped_module_ids.contains(module.module_id.as_str()))
    {
        return Err(contract_error(format!(
            "Questionnaire module {} is not explicitly mapped to any package language.",
            module.module_id
        )));
    }
    Ok(())
}

fn deserialize_u32_integer<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = deserialize_u64_integer(deserializer)?;
    u32::try_from(value).map_err(serde::de::Error::custom)
}

fn deserialize_u64_integer<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let number = serde_json::Number::deserialize(deserializer)?;
    if let Some(value) = number.as_u64() {
        return Ok(value);
    }
    if let Some(value) = number.as_i64() {
        return u64::try_from(value).map_err(serde::de::Error::custom);
    }
    let value = number
        .as_f64()
        .ok_or_else(|| serde::de::Error::custom("expected a JSON integer"))?;
    if !value.is_finite()
        || value.fract() != 0.0
        || !(0.0..=MAX_SAFE_INTEGER as f64).contains(&value)
    {
        return Err(serde::de::Error::custom("expected an exact JSON integer"));
    }
    Ok(value as u64)
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn contract_error(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn valid_package() -> ExperimentPackageV1 {
        let mut settings = crate::research_protocol::tests::external_settings();
        let mut canonical_definition_source =
            canonical_json(&settings.external_protocol.definition, &[]).unwrap();
        canonical_definition_source.push(b'\n');
        settings.external_protocol.source_byte_sha256 = sha256_hex(&canonical_definition_source);
        settings = settings.normalize_and_validate().unwrap();

        let stimulus = &settings.stimuli.items[0];
        let StimulusSourceV1::WorkspaceFile {
            relative_path,
            mime_type,
            sha256,
            byte_length,
            duration_ms,
        } = &stimulus.source
        else {
            panic!("the V3 fixture must contain a workspace stimulus")
        };
        let mut package = ExperimentPackageV1 {
            schema: EXPERIMENT_PACKAGE_SCHEMA.to_owned(),
            version: 1,
            package_id: "video-affect-v1-package".to_owned(),
            asset_root: EXPERIMENT_PACKAGE_ASSET_ROOT.to_owned(),
            assets: ExperimentPackageAssetsV1 {
                stimuli: vec![ExperimentPackageStimulusAssetV1 {
                    stimulus_id: stimulus.stimulus_id.clone(),
                    title: stimulus.title.clone(),
                    relative_path: format!("assets/{relative_path}"),
                    mime_type: mime_type.clone(),
                    sha256: sha256.clone(),
                    byte_length: *byte_length,
                    duration_ms: *duration_ms,
                }],
            },
            language_selection: LanguageSelectionTreeV1 {
                algorithm_version: LANGUAGE_TREE_ALGORITHM.to_owned(),
                root_node_id: "language".to_owned(),
                languages: vec![PackageLanguageV1 {
                    language_id: "english".to_owned(),
                    language_tag: "en".to_owned(),
                    label: "English".to_owned(),
                    questionnaire_module_ids: vec!["pre-main".to_owned()],
                }],
                nodes: vec![LanguageSelectionNodeV1 {
                    node_id: "language".to_owned(),
                    prompt: "Choose a language".to_owned(),
                    options: vec![LanguageSelectionOptionV1 {
                        option_id: "english".to_owned(),
                        label: "English".to_owned(),
                        target: LanguageSelectionTargetV1::Language {
                            language_id: "english".to_owned(),
                        },
                    }],
                }],
            },
            playback: CompleteVideoPlaybackPolicyV1 {
                algorithm_version: COMPLETE_VIDEO_PLAYBACK_ALGORITHM.to_owned(),
                start_at_ms: 0,
                end_condition: PlaybackEndConditionV1::DecodedEnd,
                playback_rate: 1.0,
                r#loop: false,
                seeking_allowed: false,
                pause_allowed: true,
                audio: CompleteVideoAudioPolicyV1 {
                    muted: false,
                    volume: 1.0,
                },
                feedback_placement: FeedbackPlacementV1::Adjacent,
                recovery_restart: RecoveryRestartV1::FromBeginning,
            },
            settings,
            integrity: ExperimentPackageIntegrityV1 {
                algorithm_version: EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM.to_owned(),
                package_definition_sha256: "0".repeat(64),
                settings_sha256: "0".repeat(64),
                asset_manifest_sha256: "0".repeat(64),
                experiment_plan_sha256: "0".repeat(64),
                protocol_matrix_sha256: "0".repeat(64),
            },
        };
        package.integrity.settings_sha256 = package.settings.canonical_sha256().unwrap();
        package.integrity.asset_manifest_sha256 = canonical_sha256(&package.assets, &[]).unwrap();
        let expected = expected_derived_integrity(&package).unwrap();
        package.integrity.experiment_plan_sha256 = expected.experiment_plan_sha256;
        package.integrity.protocol_matrix_sha256 = expected.protocol_matrix_sha256;
        package.integrity.package_definition_sha256 = package.package_definition_sha256().unwrap();
        package.normalize_and_validate().unwrap()
    }

    #[test]
    fn strict_package_round_trip_binds_every_independent_hash() {
        let package = valid_package();
        let canonical = package.canonical_file_bytes().unwrap();
        let receipt = parse_experiment_package_bytes(&canonical).unwrap();
        assert_eq!(receipt.package, package);
        assert_eq!(
            receipt.source_byte_sha256,
            receipt.canonical_source_byte_sha256
        );
        assert_eq!(receipt.source_text.as_bytes(), canonical);
        assert_eq!(receipt.canonical_source_text.as_bytes(), canonical);
        assert_eq!(
            receipt.package.integrity.package_definition_sha256.as_str(),
            receipt.package.package_definition_sha256().unwrap()
        );
        assert_eq!(
            receipt.package.integrity.settings_sha256,
            receipt.package.settings.canonical_sha256().unwrap()
        );
        assert_eq!(
            receipt.package.integrity.asset_manifest_sha256,
            canonical_sha256(&receipt.package.assets, &[]).unwrap()
        );
        assert_eq!(
            receipt.canonical_source_byte_sha256,
            sha256_hex(receipt.canonical_source_text.as_bytes())
        );
    }

    #[test]
    fn rejects_noncanonical_source_bytes_instead_of_returning_two_variants() {
        let package = valid_package();
        let canonical = String::from_utf8(package.canonical_file_bytes().unwrap()).unwrap();
        let noncanonical = format!(" \n{}", canonical.trim_end());
        assert!(parse_experiment_package_bytes(noncanonical.as_bytes()).is_err());
        assert!(parse_canonical_experiment_package_text(&noncanonical).is_err());
        assert!(parse_canonical_experiment_package_text(&canonical).is_ok());

        let without_newline = canonical.trim_end_matches('\n');
        assert!(parse_experiment_package_bytes(without_newline.as_bytes()).is_err());
        let with_crlf = canonical.replace('\n', "\r\n");
        assert!(parse_experiment_package_bytes(with_crlf.as_bytes()).is_err());

        let pretty = format!(
            "{}\n",
            serde_json::to_string_pretty(&package).expect("the package serializes")
        );
        assert!(parse_experiment_package_bytes(pretty.as_bytes()).is_err());
        let struct_key_order = format!(
            "{}\n",
            serde_json::to_string(&package).expect("the package serializes")
        );
        assert!(parse_experiment_package_bytes(struct_key_order.as_bytes()).is_err());

        let mut with_bom = vec![0xef, 0xbb, 0xbf];
        with_bom.extend_from_slice(canonical.as_bytes());
        assert!(parse_experiment_package_bytes(&with_bom).is_err());
    }

    #[test]
    fn rejects_unknown_duplicate_and_integrity_drift() {
        let package = valid_package();
        let source = String::from_utf8(package.canonical_file_bytes().unwrap()).unwrap();
        let unknown = source.replacen("\"version\":1", "\"version\":1,\"unknown\":true", 1);
        assert!(parse_experiment_package_bytes(unknown.as_bytes()).is_err());
        let duplicate = source.replacen(
            "\"assetRoot\":\"assets/stimuli\"",
            "\"assetRoot\":\"assets/stimuli\",\"assetRoot\":\"assets/stimuli\"",
            1,
        );
        assert!(parse_experiment_package_bytes(duplicate.as_bytes()).is_err());

        let mut drift = serde_json::to_value(&package).unwrap();
        drift["settings"]["experiment"]["samplingFrequencyHz"] = Value::from(129);
        assert!(serde_json::from_value::<ExperimentPackageV1>(drift)
            .unwrap()
            .normalize_and_validate()
            .is_err());

        let mut false_plan = valid_package();
        false_plan.integrity.experiment_plan_sha256 = "a".repeat(64);
        false_plan.integrity.package_definition_sha256 =
            false_plan.package_definition_sha256().unwrap();
        assert!(false_plan.normalize_and_validate().is_err());

        let mut false_matrix = valid_package();
        false_matrix.integrity.protocol_matrix_sha256 = "b".repeat(64);
        false_matrix.integrity.package_definition_sha256 =
            false_matrix.package_definition_sha256().unwrap();
        assert!(false_matrix.normalize_and_validate().is_err());
    }

    #[test]
    fn rejects_asset_source_and_canonical_experiment_source_drift() {
        let package = valid_package();
        assert!(normalize_package_asset_path("assets/stimuli/cafe\u{301}.mp4").is_err());
        let mut asset_drift = package.clone();
        asset_drift.assets.stimuli[0].relative_path = "assets/stimuli/other.mp4".to_owned();
        assert!(asset_drift.normalize_and_validate().is_err());

        let mut asset_hash_drift = package.clone();
        asset_hash_drift.assets.stimuli[0].sha256 = "f".repeat(64);
        assert!(asset_hash_drift.normalize_and_validate().is_err());

        let mut raw_source_hash = package;
        raw_source_hash
            .settings
            .external_protocol
            .source_byte_sha256 = "a".repeat(64);
        assert!(raw_source_hash.normalize_and_validate().is_err());
    }

    #[test]
    fn rejects_non_tree_language_routes_and_changed_playback_policy() {
        let package = valid_package();
        let mut duplicate_language_parent = package.clone();
        duplicate_language_parent.language_selection.nodes[0]
            .options
            .push(LanguageSelectionOptionV1 {
                option_id: "english-again".to_owned(),
                label: "English again".to_owned(),
                target: LanguageSelectionTargetV1::Language {
                    language_id: "english".to_owned(),
                },
            });
        assert!(duplicate_language_parent.normalize_and_validate().is_err());

        let mut cycle = package.clone();
        cycle.language_selection.nodes[0].options[0].target = LanguageSelectionTargetV1::Node {
            node_id: "language".to_owned(),
        };
        assert!(cycle.normalize_and_validate().is_err());

        let mut playback_drift = package;
        playback_drift.playback.seeking_allowed = true;
        assert!(playback_drift.normalize_and_validate().is_err());
    }

    #[test]
    fn questionnaire_modules_require_explicit_compatible_language_routes() {
        let package = valid_package();

        let mut missing_mapping = serde_json::to_value(&package).unwrap();
        missing_mapping["languageSelection"]["languages"][0]
            .as_object_mut()
            .unwrap()
            .remove("questionnaireModuleIds");
        assert!(serde_json::from_value::<ExperimentPackageV1>(missing_mapping).is_err());

        let mut unmapped = package.clone();
        unmapped.language_selection.languages[0]
            .questionnaire_module_ids
            .clear();
        assert!(unmapped.normalize_and_validate().is_err());

        let mut unknown = package.clone();
        unknown.language_selection.languages[0].questionnaire_module_ids[0] =
            "unknown-module".to_owned();
        assert!(unknown.normalize_and_validate().is_err());

        let mut duplicate = package.clone();
        duplicate.language_selection.languages[0]
            .questionnaire_module_ids
            .push("pre-main".to_owned());
        assert!(duplicate.normalize_and_validate().is_err());

        let mut incompatible = package;
        incompatible.language_selection.languages[0].language_tag = "de".to_owned();
        assert!(incompatible.normalize_and_validate().is_err());
    }

    #[test]
    fn rejects_invalid_utf8_and_package_byte_bounds() {
        assert!(parse_experiment_package_bytes(&[]).is_err());
        assert!(parse_experiment_package_bytes(&[0xff]).is_err());
        assert!(
            parse_experiment_package_bytes(&vec![b' '; MAX_EXPERIMENT_PACKAGE_BYTES + 1]).is_err()
        );
    }

    #[test]
    fn checked_in_javascript_oracle_has_exact_rust_hash_and_wire_parity() {
        let bytes = include_bytes!("../../test/fixtures/experiment-package-v1.canonical.json");
        let receipt = parse_experiment_package_bytes(bytes).unwrap();
        assert_eq!(receipt.source_text.as_bytes(), bytes);
        assert_eq!(receipt.canonical_source_text.as_bytes(), bytes);
        assert_eq!(
            receipt.source_byte_sha256,
            "89e85bddc967d6c934b8c8875256fa00b695742d986f292439dc0ef1532e3b1b"
        );
        assert_eq!(
            receipt.canonical_source_byte_sha256,
            receipt.source_byte_sha256
        );
        assert_eq!(
            receipt.package.integrity.package_definition_sha256,
            "024ac9a294b9b8e1b7bb39f5e7334b9cfcacc841034d23fcccb8bbc3bf057f94"
        );
        assert_eq!(
            receipt.package.integrity.settings_sha256,
            "dcb6772afb0aa3620105f8b3227b04d62db62da18d5c690f685fa5a93a4ed79b"
        );
        assert_eq!(
            receipt.package.integrity.asset_manifest_sha256,
            "659183340229392d15a5bad1e7bfc8c1d0d48edc9d687f0bcf536d38cecebdda"
        );
        assert_eq!(
            receipt.package.integrity.protocol_matrix_sha256,
            "7bd624577be94f0c8c8638e34745fac1363824d2b60f9d15320d92c752ac5a22"
        );
        assert_eq!(receipt.package.language_selection.languages.len(), 2);
        assert_eq!(
            receipt.package.language_selection.languages[0].questionnaire_module_ids,
            [
                "vr-after-calm-followup",
                "vr-after-calm",
                "vr-after-calm-isi"
            ]
        );
        assert!(receipt.package.language_selection.languages[1]
            .questionnaire_module_ids
            .is_empty());
        assert!(matches!(
            receipt.package.settings.questionnaires.modules[0].placement,
            crate::research_protocol::QuestionnairePlacementV2::AfterStimulus {
                relative_to_isi: crate::research_protocol::QuestionnaireRelativeToIsiV1::Before,
                ..
            }
        ));
    }
}
