fn main() {
    println!("cargo:rerun-if-env-changed=FLUBBERVLC_MANIFEST_SHA256");
    println!("cargo:rerun-if-env-changed=FLUBBERVLC_PAYLOAD_MANIFEST_SHA256");
    tauri_build::build()
}
