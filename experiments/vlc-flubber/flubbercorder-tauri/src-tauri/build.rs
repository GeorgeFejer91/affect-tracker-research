fn main() {
    println!("cargo:rerun-if-env-changed=FLUBBERVLC_MANIFEST_SHA256");
    println!("cargo:rerun-if-env-changed=FLUBBERVLC_PAYLOAD_MANIFEST_SHA256");
    println!("cargo:rerun-if-env-changed=FLUBBERVLC_SETUP_URL");
    println!("cargo:rerun-if-env-changed=FLUBBERVLC_SETUP_SHA256");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        for name in [
            "FLUBBERVLC_MANIFEST_SHA256",
            "FLUBBERVLC_PAYLOAD_MANIFEST_SHA256",
            "FLUBBERVLC_SETUP_SHA256",
        ] {
            let value = std::env::var(name).unwrap_or_default();
            assert!(
                value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()),
                "{name} must be an exact SHA-256 pin for a release bundle"
            );
        }
        assert!(
            std::env::var("FLUBBERVLC_SETUP_URL").is_ok_and(|value| {
                value.starts_with("https://")
                    && value.len() <= 512
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"/._~-:".contains(&byte))
            }),
            "FLUBBERVLC_SETUP_URL must be a fixed HTTPS player setup URL"
        );
    }
    tauri_build::build()
}
