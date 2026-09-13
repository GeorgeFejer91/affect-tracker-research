//! Actual native worker and durable storage; no playback qualification claim.
use super::*;
use crate::research_input::ResearchInputService;
use crate::research_native_protocol::runtime::PackageProtocolRuntime;
use crate::research_runner_master::MasterSelector;

#[test]
fn surveyjs_worker_requires_native_validation_and_persists_before_advancing() {
    let root = std::env::temp_dir().join(format!("affect-survey-worker-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(root.join("outputs")).unwrap();
    let prepared = PreparedMaster::read(
        include_str!("../../../test/fixtures/planner-recipe-v4-surveyjs.canonical.json"),
        "P001",
        MasterSelector {
            variant_id: "variant-1".into(),
            language_id: "de".into(),
            language_selection_path: vec!["both".into(), "de".into()],
            presentation_target: "desktop-screen".into(),
        },
    )
    .unwrap();
    let workspace = Arc::new(WorkspaceService::new(root.join("app")).unwrap());
    let media = Arc::new(NativeMediaService::unavailable_for_tests());
    let input = Arc::new(ResearchInputService::for_tests());
    let recorder = Arc::new(RecorderService::default());
    let binding = prepared.feedback.input.clone();
    let receipt = input.issue_test_receipt_for_tests(binding.clone()).unwrap();
    let mailbox = Arc::new(ProtocolInputMailbox::new(binding.kind));
    let sink = Arc::clone(&mailbox);
    let authority = InputAuthority {
        service: Arc::clone(&input),
        id: input
            .prepare_run_full(binding, &receipt.receipt_id, move |v| sink.push(v))
            .unwrap(),
    };
    let legacy = PackageProtocolRuntime::with_services(
        Arc::clone(&workspace),
        Arc::clone(&media),
        Arc::clone(&input),
    );
    let storage =
        MasterStorage::create(&root, &prepared, "run-survey-test", Value::Null, false).unwrap();
    let output = root.join(storage.receipt["outputDirectory"].as_str().unwrap());
    let mut worker = legacy
        .begin_companion(|lease| {
            MasterWorker::new(
                prepared,
                "unused".into(),
                vec![],
                NativeMediaViewportPxV1::initial(),
                storage,
                authority,
                mailbox,
                workspace,
                media,
                recorder,
                lease,
            )
        })
        .unwrap();
    worker.observe(MarkerEvent::SessionStart, false).unwrap();
    assert!(worker
        .action(MasterAction::SurveySubmit {
            position: 1,
            data: json!({"details":false}),
            page_no: 0
        })
        .is_err());
    worker
        .action(MasterAction::Presented { position: 1 })
        .unwrap();
    assert!(worker
        .action(MasterAction::SurveyDraft {
            position: 99,
            data: json!({}),
            page_no: 0
        })
        .is_err());
    assert!(worker
        .action(MasterAction::SurveySubmit {
            position: 1,
            data: json!({"details":true}),
            page_no: 0
        })
        .is_err());
    assert!(worker
        .action(MasterAction::SurveyDraft {
            position: 1,
            data: json!({"details":false}),
            page_no: 20
        })
        .is_err());
    worker
        .action(MasterAction::SurveyDraft {
            position: 1,
            data: json!({"details":true,"explanation":"Grüße 🌻"}),
            page_no: 1,
        })
        .unwrap();
    assert_eq!(worker.state.position, 1);
    assert_eq!(worker.state.answers["explanation"], "Grüße 🌻");
    let response_file = output.join("master-responses.v3.jsonl");
    let read = || {
        std::fs::read_to_string(&response_file)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str::<Value>(l).unwrap())
            .collect::<Vec<_>>()
    };
    assert_eq!(read().len(), 1); // Read while the writer is still open.
    let data = json!({"details":true,"explanation":"Grüße 🌻","choices":["a","b"]});
    worker
        .action(MasterAction::SurveySubmit {
            position: 1,
            data: data.clone(),
            page_no: 1,
        })
        .unwrap();
    assert_eq!(worker.state.position, 2);
    let records = read();
    assert_eq!(records.len(), 2);
    assert_eq!(records[1]["status"], "submitted");
    assert_eq!(records[1]["responses"]["data"], data);
    assert_eq!(records[1]["responses"]["language"], "de");
    assert_eq!(records[1]["responses"]["engineVersion"], "3.0.4");
    assert!(worker
        .action(MasterAction::SurveySubmit {
            position: 1,
            data,
            page_no: 1
        })
        .is_err());
    worker.action(MasterAction::Stop).unwrap();
    assert_eq!(worker.state.result.as_ref().unwrap()["status"], "stopped");
    drop(worker);
    std::fs::remove_dir_all(root).unwrap();
}
