use super::effects::NativeAction;
use super::*;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

struct Fixture {
    root: PathBuf,
    broker: Arc<PlannerAuthoringBroker>,
    workspace: WorkspaceService,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("affect-broker-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let workspace = WorkspaceService::new(root.join("app")).unwrap();
        let broker = Arc::new(PlannerAuthoringBroker::new(true));
        broker.lock().unwrap().session_id = Some(Uuid::new_v4().to_string());
        Self {
            root,
            broker,
            workspace,
        }
    }
    fn command(&self, operation: &str, arguments: Value) -> PlannerCommand {
        let state = self.broker.lock().unwrap();
        parse_command(json!({"schema":"affect-research-planner-command","version":1,
            "sessionId":state.session_id,"requestId":Uuid::new_v4(),"expectedRevision":state.revision,
            "action":{"kind":"perform","operation":operation,"arguments":arguments}}).to_string().as_bytes()).unwrap()
    }
    fn dispatch(&self, original: &PlannerCommand) -> PlannerCommand {
        self.broker.enqueue(original.clone()).unwrap();
        self.broker.next().unwrap().unwrap()
    }
    fn native(&self, original: &PlannerCommand, action: Value) -> NativeRequest {
        serde_json::from_value(
            json!({"context":{"sessionId":original.session_id,"requestId":original.request_id,
            "expectedRevision":original.expected_revision},"action":action}),
        )
        .unwrap()
    }
    fn finish(&self, original: &PlannerCommand) {
        let revision = self.broker.lock().unwrap().revision;
        self.broker
            .reserve_completion(&PlannerResponse {
                schema: "affect-research-planner-command-result".into(),
                version: 1,
                session_id: original.session_id.clone(),
                request_id: original.request_id.clone(),
                status: "applied".into(),
                revision,
                result: Value::Null,
                issues: vec![],
            })
            .unwrap();
        self.broker.lock().unwrap().output_pending -= 1;
    }
    fn select(&self) -> String {
        let path = self.root.join("study");
        fs::create_dir(&path).unwrap();
        let command = self.command("selectWorkspace", json!({"directory":path}));
        let forward = self.dispatch(&command);
        let native = self.native(
            &command,
            json!({"type":"selectWorkspace","grantId":argument(&forward,"directory")}),
        );
        let result = self.broker.native_effect(&self.workspace, native).unwrap();
        assert!(result.error.is_none());
        self.finish(&command);
        result.payload["workspaceId"].as_str().unwrap().into()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.broker.shutdown();
        assert!(self.root.starts_with(std::env::temp_dir()));
        assert!(self
            .root
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("affect-broker-"));
        fs::remove_dir_all(&self.root).unwrap();
    }
}
fn argument(command: &PlannerCommand, key: &str) -> Value {
    let PlannerAction::Perform { arguments, .. } = &command.action else {
        panic!("wrong command");
    };
    arguments[key].clone()
}
fn error<T>(result: ResearchResult<T>) -> String {
    result.err().expect("expected rejection").code
}

#[test]
fn closed_public_and_native_dtos_reject_extra_fields_and_missing_revision() {
    let f = Fixture::new();
    for (operation, args) in [
        ("selectWorkspace", json!({"directory":"x","extra":true})),
        ("rescanVideoLibrary", json!({"workspaceId":"x"})),
        ("confirmSegment", json!({"segment":"P7"})),
        ("importVideos", json!({"paths":[]})),
        ("deleteFile", json!({"path":"x"})),
    ] {
        assert!(Consequence::parse(operation, &args).is_err());
    }
    let command = f.command("rescanVideoLibrary", json!({}));
    let mut value = serde_json::to_value(&command).unwrap();
    value["expectedRevision"] = Value::Null;
    assert!(parse_command(value.to_string().as_bytes()).is_err());
    assert!(serde_json::from_value::<NativeAction>(
        json!({"type":"readRecipe","grantId":Uuid::new_v4(),"path":"x"})
    )
    .is_err());
    let mut request = f.native(
        &command,
        json!({"type":"rescanVideoLibrary","workspaceId":"test"}),
    );
    request.context.expected_revision = u64::MAX;
    assert!(request.validate().is_err());
}

#[test]
fn original_paths_are_hidden_and_changed_original_retry_is_denied() {
    let f = Fixture::new();
    let command = f.command("selectWorkspace", json!({"directory":f.root}));
    let forwarded = f.dispatch(&command);
    assert!(Uuid::parse_str(argument(&forwarded, "directory").as_str().unwrap()).is_ok());
    assert!(!serde_json::to_string(&forwarded)
        .unwrap()
        .contains(f.root.to_str().unwrap()));
    assert_ne!(
        effects::fingerprint(&command).unwrap(),
        effects::fingerprint(&forwarded).unwrap()
    );
    let mut changed = command.clone();
    if let PlannerAction::Perform { arguments, .. } = &mut changed.action {
        arguments["directory"] = "D:/different".into();
    }
    assert_eq!(error(f.broker.enqueue(changed)), "request_id_reused");
    assert!(
        Consequence::parse("selectWorkspace", &json!({"directory":f.root}))
            .unwrap()
            .forward(&command, None)
            .is_err()
    );
    f.finish(&command);
    let retry = f.dispatch(&command);
    assert_eq!(
        serde_json::to_value(retry).unwrap(),
        serde_json::to_value(forwarded).unwrap()
    );
}

#[test]
fn actual_select_ack_is_replayed_without_redispatch_and_survives_completion() {
    let f = Fixture::new();
    let command = f.command("selectWorkspace", json!({"directory":f.root}));
    let forwarded = f.dispatch(&command);
    let native = f.native(
        &command,
        json!({"type":"selectWorkspace","grantId":argument(&forwarded,"directory")}),
    );
    let result = f
        .broker
        .native_effect(&f.workspace, native.clone())
        .unwrap();
    assert_eq!(result.effect["outcome"], "acknowledged");
    let id = f.workspace.status().workspace_id.unwrap();
    assert_eq!(
        f.broker
            .native_effect(&f.workspace, native.clone())
            .unwrap()
            .payload,
        result.payload
    );
    assert_eq!(f.workspace.status().workspace_id.unwrap(), id);
    f.finish(&command);
    let compact = f
        .broker
        .native_effect(&f.workspace, native.clone())
        .unwrap();
    assert_eq!(compact.effect, result.effect);
    assert!(compact.payload.is_null());
    assert_eq!(compact.error.unwrap().code, "effect_already_completed");
    f.broker.shutdown();
    assert_eq!(
        f.broker.native_effect(&f.workspace, native).unwrap().effect,
        result.effect
    );
}

#[test]
fn purpose_grant_and_original_context_are_required_before_io() {
    let f = Fixture::new();
    let command = f.command("selectWorkspace", json!({"directory":f.root}));
    let forward = f.dispatch(&command);
    let request = f.native(
        &command,
        json!({"type":"readRecipe","grantId":argument(&forward,"directory")}),
    );
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, request)),
        "operation_mismatch"
    );
    let request = f.native(
        &command,
        json!({"type":"selectWorkspace","grantId":Uuid::new_v4()}),
    );
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, request)),
        "operation_mismatch"
    );
    assert!(!f.workspace.status().selected);
    let mut request = f.native(
        &command,
        json!({"type":"selectWorkspace","grantId":argument(&forward,"directory")}),
    );
    request.context.request_id = Uuid::new_v4().to_string();
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, request)),
        "unknown_request"
    );
}

#[test]
fn admitted_cancel_revokes_selection_before_renderer_processes_cancel() {
    let f = Fixture::new();
    let command = f.command("selectWorkspace", json!({"directory":f.root}));
    let forward = f.dispatch(&command);
    let mut cancel = command.clone();
    cancel.request_id = Uuid::new_v4().to_string();
    cancel.action = PlannerAction::Cancel {
        request_id: command.request_id.clone(),
    };
    f.broker.enqueue(cancel).unwrap();
    let native = f.native(
        &command,
        json!({"type":"selectWorkspace","grantId":argument(&forward,"directory")}),
    );
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, native)),
        "canceled"
    );
    assert!(!f.workspace.status().selected);
}

#[test]
fn newer_ui_revision_fences_native_effect_and_delayed_notice_never_rewinds() {
    let f = Fixture::new();
    let command = f.command("selectWorkspace", json!({"directory":f.root}));
    let forward = f.dispatch(&command);
    for revision in [2, 1] {
        f.broker
            .notice_revision(RevisionNotice {
                session_id: command.session_id.clone(),
                revision,
            })
            .unwrap();
    }
    assert_eq!(f.broker.lock().unwrap().revision, 2);
    let native = f.native(
        &command,
        json!({"type":"selectWorkspace","grantId":argument(&forward,"directory")}),
    );
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, native)),
        "stale_revision"
    );
    assert!(!f.workspace.status().selected);
}

#[test]
fn native_lease_lasts_until_original_command_completion() {
    let f = Fixture::new();
    let first = f.command("selectWorkspace", json!({"directory":f.root}));
    let forward = f.dispatch(&first);
    let native = f.native(
        &first,
        json!({"type":"selectWorkspace","grantId":argument(&forward,"directory")}),
    );
    let result = f.broker.native_effect(&f.workspace, native).unwrap();
    let second = f.command("rescanVideoLibrary", json!({}));
    f.dispatch(&second);
    let native = f.native(
        &second,
        json!({"type":"rescanVideoLibrary","workspaceId":result.payload["workspaceId"]}),
    );
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, native.clone())),
        "native_busy"
    );
    f.finish(&first);
    assert!(f
        .broker
        .native_effect(&f.workspace, native)
        .unwrap()
        .error
        .is_none());
}

#[test]
fn actual_questionnaire_read_and_store_preserve_bytes_and_bound_identity() {
    let f = Fixture::new();
    let workspace_id = f.select();
    let bytes = b"synthetic storage source, not questionnaire content";
    let path = f.root.join("source.txt");
    fs::write(&path, bytes).unwrap();
    let command = f.command(
        "importQuestionnaire",
        json!({"path":path,"familyId":"smoke","language":"en"}),
    );
    let forward = f.dispatch(&command);
    let result = f
        .broker
        .native_effect(
            &f.workspace,
            f.native(
                &command,
                json!({"type":"readQuestionnaire","grantId":argument(&forward,"path")}),
            ),
        )
        .unwrap();
    assert_eq!(result.operation, "importQuestionnaire");
    assert_eq!(
        result.payload["sha256"],
        format!("{:x}", Sha256::digest(bytes))
    );
    assert_eq!(result.payload["byteLength"], bytes.len());
    f.finish(&command);
    let save = f.command("saveQuestionnaire", json!({"questionnaireId":"smoke-en"}));
    f.dispatch(&save);
    let mut native = f.native(&save,json!({"type":"storeQuestionnaire","workspaceId":workspace_id,"questionnaireId":"different",
        "familyId":"smoke","languageTag":"en","format":"txt","sourceSha256":result.payload["sha256"],"bytesHex":result.payload["bytesHex"]}));
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, native.clone())),
        "operation_mismatch"
    );
    if let NativeAction::StoreQuestionnaire {
        questionnaire_id, ..
    } = &mut native.action
    {
        *questionnaire_id = "smoke-en".into();
    }
    let saved = f
        .broker
        .native_effect(&f.workspace, native.clone())
        .unwrap();
    assert!(saved.error.is_none());
    assert_eq!(
        fs::read(
            f.root
                .join("study")
                .join(saved.payload["relativePath"].as_str().unwrap())
        )
        .unwrap(),
        bytes
    );
    if let NativeAction::StoreQuestionnaire { family_id, .. } = &mut native.action {
        *family_id = "changed".into();
    }
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, native)),
        "request_id_reused"
    );
}

#[test]
fn actual_video_import_folder_and_rescan_have_compact_receipts() {
    let f = Fixture::new();
    let workspace_id = f.select();
    let folder = f.root.join("clips");
    fs::create_dir(&folder).unwrap();
    let path = folder.join("synthetic.mp4");
    fs::write(&path, b"synthetic storage test, not playable video").unwrap();
    for (operation, args, field) in [
        ("importVideos", json!({"paths":[path]}), "paths"),
        (
            "importVideoFolder",
            json!({"directory":folder}),
            "directory",
        ),
        ("rescanVideoLibrary", json!({}), ""),
    ] {
        let command = f.command(operation, args);
        let forward = f.dispatch(&command);
        let mut action = json!({"type":operation,"workspaceId":workspace_id});
        if !field.is_empty() {
            let grant = argument(&forward, field);
            action["grantId"] = if field == "paths" {
                grant[0].clone()
            } else {
                grant
            };
        }
        let result = f
            .broker
            .native_effect(&f.workspace, f.native(&command, action))
            .unwrap();
        assert!(result.error.is_none());
        assert!(!result.payload["stimuli"].as_array().unwrap().is_empty());
        assert!(result.effect["receipt"].get("stimuli").is_none());
        assert_eq!(
            result.effect["receipt"]["receiptSha256"]
                .as_str()
                .unwrap()
                .len(),
            64
        );
        f.finish(&command);
    }
}

#[test]
fn actual_typed_master_save_retry_and_read_preserve_exact_file_and_basename() {
    let f = Fixture::new();
    let source = include_str!("../../../test/fixtures/planner-recipe-v2-mixed.canonical.json");
    let command = f.command("saveRecipe", json!({"directory":f.root}));
    let forward = f.dispatch(&command);
    let native = f.native(
        &command,
        json!({"type":"writeRecipe","grantId":argument(&forward,"directory"),"sourceText":source}),
    );
    let result = f
        .broker
        .native_effect(&f.workspace, native.clone())
        .unwrap();
    assert!(result.error.is_none());
    let basename = result.payload["basename"].as_str().unwrap();
    assert!(basename.ends_with("Z.json"));
    assert_eq!(fs::read_to_string(f.root.join(basename)).unwrap(), source);
    assert_eq!(
        f.broker
            .native_effect(&f.workspace, native)
            .unwrap()
            .payload,
        result.payload
    );
    assert_eq!(
        fs::read_dir(&f.root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .count(),
        1
    );
    f.finish(&command);
    let command = f.command("openRecipe", json!({"path":f.root.join(basename)}));
    let forward = f.dispatch(&command);
    let result = f
        .broker
        .native_effect(
            &f.workspace,
            f.native(
                &command,
                json!({"type":"readRecipe","grantId":argument(&forward,"path")}),
            ),
        )
        .unwrap();
    assert!(result.error.is_none());
    assert_eq!(result.payload["sourceText"], source);
    assert_eq!(
        result.payload["sourceSha256"],
        format!("{:x}", Sha256::digest(source.as_bytes()))
    );
    assert!(result.effect["receipt"].get("sourceText").is_none());
}

#[test]
fn encoded_oversize_is_rejected_before_claim_or_publication() {
    let f = Fixture::new();
    let command = f.command("saveRecipe", json!({"directory":f.root}));
    let forward = f.dispatch(&command);
    let request = f.native(&command,json!({"type":"writeRecipe","grantId":argument(&forward,"directory"),"sourceText":"\n".repeat(MAX_FRAME_BYTES/2)}));
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, request)),
        "invalid_native_request"
    );
    assert!(!f
        .broker
        .lock()
        .unwrap()
        .native
        .has_call(&command.request_id));
    assert_eq!(fs::read_dir(&f.root).unwrap().count(), 1); // app directory only
}

#[test]
fn malformed_saved_recipe_is_retained_as_not_published_and_never_retried() {
    let f = Fixture::new();
    let command = f.command("saveRecipe", json!({"directory":f.root}));
    let forward = f.dispatch(&command);
    let request = f.native(
        &command,
        json!({"type":"writeRecipe","grantId":argument(&forward,"directory"),"sourceText":"{}"}),
    );
    let result = f
        .broker
        .native_effect(&f.workspace, request.clone())
        .unwrap();
    assert!(result.error.is_some());
    assert_eq!(result.effect["outcome"], "notPublished");
    assert_eq!(
        f.broker
            .native_effect(&f.workspace, request)
            .unwrap()
            .effect,
        result.effect
    );
}

#[test]
fn cancellation_has_a_bounded_control_slot_when_work_queue_is_saturated() {
    let f = Fixture::new();
    let command = f.command("selectWorkspace", json!({"directory":f.root}));
    let forward = f.dispatch(&command);
    for _ in 1..MAX_PENDING {
        let mut query = command.clone();
        query.request_id = Uuid::new_v4().to_string();
        query.expected_revision = None;
        query.action = PlannerAction::Snapshot;
        f.broker.enqueue(query).unwrap();
    }
    let mut cancel = command.clone();
    cancel.request_id = Uuid::new_v4().to_string();
    cancel.action = PlannerAction::Cancel {
        request_id: command.request_id.clone(),
    };
    f.broker.enqueue(cancel.clone()).unwrap();
    cancel.request_id = Uuid::new_v4().to_string();
    assert_eq!(error(f.broker.enqueue(cancel)), "busy");
    let native = f.native(
        &command,
        json!({"type":"selectWorkspace","grantId":argument(&forward,"directory")}),
    );
    assert_eq!(
        error(f.broker.native_effect(&f.workspace, native)),
        "canceled"
    );
    assert!(!f.workspace.status().selected);
    let state = f.broker.lock().unwrap();
    assert_eq!(state.pending.len() + state.queue.len(), MAX_ADMITTED);
}
