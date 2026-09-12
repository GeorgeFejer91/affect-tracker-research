//! Bind closed renderer requests to the original external command before I/O.
use super::effects::{
    self, CallAdmission, NativeAction, NativeContext, NativeRequest, NativeResult, RevisionNotice,
};
use super::{failure, PlannerAuthoringBroker};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_cli_effects::{
    execute_native_effect, NativeEffect, NativeEffectFailureClass, NativeEffectReceipt,
};
use crate::research_planner_cli_io::{CliIoPurpose, CliIoRequestBinding, CliIoTarget};
use crate::research_planner_recipe_file::read_supported_planner_recipe_file;
use crate::research_workspace::WorkspaceService;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

impl PlannerAuthoringBroker {
    pub(super) fn notice_revision(&self, notice: RevisionNotice) -> ResearchResult<()> {
        let mut state = self.lock()?;
        if !self.enabled
            || state.closed
            || state.session_id.as_deref() != Some(&notice.session_id)
            || !super::wire::is_uuid(&notice.session_id)
            || notice.revision > 9_007_199_254_740_991
        {
            return Err(failure(
                "stale_session",
                "Revision notification has no active owned session.",
            ));
        }
        // Delayed notifications cannot roll the native fence backwards.
        state.revision = state.revision.max(notice.revision);
        Ok(())
    }

    fn current_native(&self, context: &NativeContext) -> ResearchResult<()> {
        let state = self.lock()?;
        Self::check_native_state(&state, context)
    }

    fn check_native_state(
        state: &super::BrokerState,
        context: &NativeContext,
    ) -> ResearchResult<()> {
        if state.closed || state.session_id.as_deref() != Some(&context.session_id) {
            return Err(failure(
                "stale_session",
                "The original native session is closed or changed.",
            ));
        }
        state.native.check(context)?;
        if !state.pending.contains_key(&context.request_id)
            || state.revision != context.expected_revision
        {
            return Err(failure(
                "stale_revision",
                "Native work requires the original pending command and revision.",
            ));
        }
        Ok(())
    }

    fn claim_target(
        &self,
        binding: CliIoRequestBinding,
        grant: Uuid,
        purpose: CliIoPurpose,
    ) -> ResearchResult<CliIoTarget> {
        let mut grants = self.grants.lock().map_err(CommandError::io)?;
        grants
            .as_mut()
            .ok_or_else(|| failure("unknown_grant", "No native selections are available."))?
            .claim(&binding, grant, purpose)
    }

    pub(super) fn native_effect(
        &self,
        workspace: &WorkspaceService,
        request: NativeRequest,
    ) -> ResearchResult<NativeResult> {
        request.validate()?;
        let admission = {
            let mut state = self.lock()?;
            if !self.enabled || state.session_id.as_deref() != Some(&request.context.session_id) {
                return Err(failure(
                    "stale_session",
                    "Native operation has no owned CLI session.",
                ));
            }
            // An exact completed RPC may reconcile its compact acknowledgement
            // after cancellation/closure, but can never redispatch its effect.
            if !state.native.has_call(&request.context.request_id) {
                Self::check_native_state(&state, &request.context)?;
            }
            state.native.reserve(&request)?
        };
        let binding = match admission {
            CallAdmission::Retained(result) => return Ok(result),
            CallAdmission::Execute(binding) => binding,
        };
        // Both compact and full encoded-response capacity were reserved before
        // claiming a grant or entering any filesystem/workspace service.
        let mut result = NativeResult::new(&request);
        match self.execute_reserved(workspace, &request, binding, &mut result) {
            Ok(()) => {}
            Err(error) => {
                // This branch precedes mutation service dispatch. Read failures
                // may consume their grant, but cannot change workspace/files.
                result.effect = json!({"operation":result.operation,"requestId":request.context.request_id,
                    "stage":"completed","outcome":"notInvoked","possiblyChanged":false});
                result.error = Some(error);
            }
        }
        self.finish_native(&request, result)
    }

    fn finish_native(
        &self,
        request: &NativeRequest,
        mut result: NativeResult,
    ) -> ResearchResult<NativeResult> {
        if result.superseded.is_none() {
            result.superseded = self.current_native(&request.context).err();
        }
        let mut state = self.lock()?;
        let closed = state.closed;
        state
            .native
            .finish(&request.context.request_id, result, closed)
    }

    fn execute_reserved(
        &self,
        workspace: &WorkspaceService,
        request: &NativeRequest,
        binding: CliIoRequestBinding,
        result: &mut NativeResult,
    ) -> ResearchResult<()> {
        self.current_native(&request.context)?;
        let effect = match &request.action {
            NativeAction::ReadQuestionnaire { grant_id } => {
                let source = {
                    let mut grants = self.grants.lock().map_err(CommandError::io)?;
                    grants
                        .as_mut()
                        .ok_or_else(|| {
                            failure("unknown_grant", "No native selections are available.")
                        })?
                        .claim_questionnaire_source(&binding, *grant_id)?
                };
                acknowledged(
                    result,
                    &request.context,
                    json!({"grantId":source.grant_id,"logicalName":source.logical_name,
                    "format":source.format,"byteLength":source.byte_length,"sha256":source.sha256}),
                    false,
                );
                result.payload = json!(source);
                return Ok(());
            }
            NativeAction::ReadRecipe { grant_id } => {
                let CliIoTarget::OpenRecipe { path } =
                    self.claim_target(binding, *grant_id, CliIoPurpose::OpenRecipe)?
                else {
                    return Err(wrong_target());
                };
                self.current_native(&request.context)?;
                let loaded = read_supported_planner_recipe_file(&path)?;
                acknowledged(
                    result,
                    &request.context,
                    json!({"sourceSha256":loaded.canonical_source_byte_sha256,
                    "byteLength":loaded.canonical_source_text.len()}),
                    false,
                );
                result.payload = json!({"sourceText":loaded.canonical_source_text,"sourceSha256":loaded.canonical_source_byte_sha256,
                    "byteLength":loaded.canonical_source_text.len()});
                return Ok(());
            }
            NativeAction::SelectWorkspace { grant_id } => {
                let CliIoTarget::SelectWorkspace { directory } =
                    self.claim_target(binding, *grant_id, CliIoPurpose::SelectWorkspace)?
                else {
                    return Err(wrong_target());
                };
                NativeEffect::SelectWorkspace { path: directory }
            }
            NativeAction::ImportVideos {
                grant_id,
                workspace_id,
            } => {
                let CliIoTarget::ImportVideos { paths } =
                    self.claim_target(binding, *grant_id, CliIoPurpose::ImportVideos)?
                else {
                    return Err(wrong_target());
                };
                NativeEffect::ImportVideos {
                    workspace_id: workspace_id.clone(),
                    paths,
                }
            }
            NativeAction::ImportVideoFolder {
                grant_id,
                workspace_id,
            } => {
                let CliIoTarget::ImportVideoFolder { directory } =
                    self.claim_target(binding, *grant_id, CliIoPurpose::ImportVideoFolder)?
                else {
                    return Err(wrong_target());
                };
                NativeEffect::ImportVideoFolder {
                    workspace_id: workspace_id.clone(),
                    path: directory,
                }
            }
            NativeAction::RescanVideoLibrary { workspace_id } => NativeEffect::RescanVideoLibrary {
                workspace_id: workspace_id.clone(),
            },
            NativeAction::StoreQuestionnaire {
                workspace_id,
                family_id,
                language_tag,
                format,
                source_sha256,
                bytes_hex,
                ..
            } => NativeEffect::StoreQuestionnaire {
                workspace_id: workspace_id.clone(),
                family_id: family_id.clone(),
                language_tag: language_tag.clone(),
                format: format.clone(),
                source_sha256: source_sha256.clone(),
                bytes: effects::source_bytes(bytes_hex, source_sha256)?,
            },
            NativeAction::WriteRecipe {
                grant_id,
                source_text,
            } => {
                let CliIoTarget::SaveRecipe { directory } =
                    self.claim_target(binding, *grant_id, CliIoPurpose::SaveRecipe)?
                else {
                    return Err(wrong_target());
                };
                NativeEffect::WriteSupportedRecipe {
                    directory,
                    source_text: source_text.clone(),
                }
            }
        };
        let outcome =
            execute_native_effect(workspace, effect, || self.current_native(&request.context));
        result.superseded = outcome.superseded;
        match outcome.result {
            Ok(receipt) => {
                // These owner receipts already exclude absolute native paths.
                // Video lists remain bulk; their compact receipt uses identity,
                // count and a digest, so acknowledging a large scan stays small.
                let (payload, compact) = match receipt {
                    NativeEffectReceipt::Workspace(value) => {
                        let payload = json!(value);
                        (payload.clone(), payload)
                    }
                    NativeEffectReceipt::Questionnaire(value) => {
                        let payload = json!(value);
                        (payload.clone(), payload)
                    }
                    NativeEffectReceipt::Recipe(value) => {
                        let payload = json!(value);
                        (payload.clone(), payload)
                    }
                    NativeEffectReceipt::VideoLibrary(value) => {
                        let compact = json!({"workspaceId":value.workspace_id,"stimuliCount":value.stimuli.len(),"receiptSha256":safe_digest(&value)});
                        (json!(value), compact)
                    }
                };
                acknowledged(result, &request.context, compact, true);
                result.payload = payload;
            }
            Err(failed) => {
                let (outcome, changed, basename) = match failed.class {
                    NativeEffectFailureClass::EffectNotInvoked => ("notInvoked", false, None),
                    NativeEffectFailureClass::MayHaveChangedWorkspace => {
                        ("possiblyChanged", true, None)
                    }
                    NativeEffectFailureClass::NoRecipePublished => ("notPublished", false, None),
                    NativeEffectFailureClass::RecipePublishedUnverified { basename } => {
                        ("publishedUnverified", true, Some(basename))
                    }
                };
                result.effect = json!({"operation":result.operation,"requestId":request.context.request_id,"stage":"completed",
                    "outcome":outcome,"possiblyChanged":changed,"basename":basename});
                result.error = Some(failed.error);
            }
        }
        Ok(())
    }
}

fn wrong_target() -> CommandError {
    failure(
        "operation_mismatch",
        "Native grant target does not match this operation.",
    )
}
fn acknowledged(result: &mut NativeResult, context: &NativeContext, receipt: Value, changed: bool) {
    result.effect = json!({"operation":result.operation,"requestId":context.request_id,"stage":"completed",
        "outcome":"acknowledged","possiblyChanged":changed,"receipt":receipt});
}
fn safe_digest(value: &impl Serialize) -> String {
    // All members of this closed receipt are serializable. Hashing failure must
    // not relabel an already completed native effect as never invoked.
    serde_json::to_vec(value)
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
        .unwrap_or_else(|_| "unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::super::wire::parse_command;
    use super::*;
    use std::fs;

    #[test]
    fn actual_saved_file_ack_survives_ui_change_or_shutdown_before_retention() {
        for close in [false, true] {
            let root = std::env::temp_dir().join(format!("affect-broker-late-{}", Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            let workspace = WorkspaceService::new(root.join("app")).unwrap();
            let broker = PlannerAuthoringBroker::new(true);
            let session = Uuid::new_v4().to_string();
            broker.lock().unwrap().session_id = Some(session.clone());
            let original=parse_command(json!({"schema":"affect-research-planner-command","version":1,"sessionId":session,
                "requestId":Uuid::new_v4(),"expectedRevision":0,"action":{"kind":"perform","operation":"saveRecipe","arguments":{"directory":root}}}).to_string().as_bytes()).unwrap();
            broker.enqueue(original.clone()).unwrap();
            let forward = broker.next().unwrap().unwrap();
            let super::super::PlannerAction::Perform { arguments, .. } = forward.action else {
                panic!("wrong command")
            };
            let request = NativeRequest {
                context: NativeContext {
                    session_id: session.clone(),
                    request_id: original.request_id.clone(),
                    expected_revision: 0,
                },
                action: NativeAction::WriteRecipe {
                    grant_id: Uuid::parse_str(arguments["directory"].as_str().unwrap()).unwrap(),
                    source_text: include_str!(
                        "../../../test/fixtures/planner-recipe-v2-mixed.canonical.json"
                    )
                    .into(),
                },
            };
            let CallAdmission::Execute(binding) =
                broker.lock().unwrap().native.reserve(&request).unwrap()
            else {
                panic!("wrong admission")
            };
            let mut result = NativeResult::new(&request);
            broker
                .execute_reserved(&workspace, &request, binding, &mut result)
                .unwrap();
            assert_eq!(result.effect["outcome"], "acknowledged");
            let basename = result.payload["basename"].as_str().unwrap().to_owned();
            if close {
                broker.shutdown();
            } else {
                broker
                    .notice_revision(RevisionNotice {
                        session_id: session,
                        revision: 1,
                    })
                    .unwrap();
            }
            let retained = broker.finish_native(&request, result).unwrap();
            assert!(retained.superseded.is_some());
            assert_eq!(retained.effect["receipt"]["basename"], basename);
            assert!(root.join(basename).is_file());
            assert_eq!(
                broker.native_effect(&workspace, request).unwrap().effect,
                retained.effect
            );
            broker.shutdown();
            assert!(root.starts_with(std::env::temp_dir()));
            assert!(root
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("affect-broker-late-"));
            fs::remove_dir_all(root).unwrap();
        }
    }
}
