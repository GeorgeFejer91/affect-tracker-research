// Compile the P2-owned service without editing main's shared lib/command registry.
#[path = "../src/research_error.rs"]
mod research_error;
#[path = "../src/research_local_questionnaire_presets.rs"]
mod research_local_questionnaire_presets;

/// Explicit local maintenance action, never part of the ordinary test run.
/// This uses the production no-clobber store, not a filesystem copy shortcut.
#[test]
#[ignore = "Explicitly authorized installation into this user's existing Planner data library"]
fn install_authorized_fixed_preset_into_current_user_planner_library() {
    use research_local_questionnaire_presets::{
        LocalQuestionnairePresetStore, GERMAN_TAS_PRESET_ID,
    };
    use std::path::PathBuf;
    let selected = PathBuf::from(
        std::env::var_os("AFFECT_PLANNER_LOCAL_PRESET_INSTALL_ROOT")
            .expect("Supply the explicit existing Planner app-data root."),
    );
    let expected =
        PathBuf::from(std::env::var_os("APPDATA").expect("Windows AppData is required."))
            .join("io.github.georgefejer91.affecttracker");
    assert_eq!(
        selected.canonicalize().unwrap(),
        expected.canonicalize().unwrap(),
        "This maintenance action is restricted to the current user's existing Planner namespace."
    );
    let source = std::env::var_os("AFFECT_LOCAL_TAS_SOURCE")
        .expect("Supply the authorized fixed CSV source.");
    let bytes = std::fs::read(source).unwrap();
    let installed = LocalQuestionnairePresetStore::new(selected.clone())
        .unwrap()
        .install(GERMAN_TAS_PRESET_ID, &bytes)
        .unwrap();
    let reopened = LocalQuestionnairePresetStore::new(selected)
        .unwrap()
        .read(GERMAN_TAS_PRESET_ID)
        .unwrap()
        .unwrap();
    assert_eq!(installed, reopened.receipt);
    assert_eq!(bytes, reopened.bytes);
    println!("{}", serde_json::to_string(&installed).unwrap());
}
