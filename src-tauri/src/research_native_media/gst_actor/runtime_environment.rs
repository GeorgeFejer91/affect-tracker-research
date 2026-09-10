use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::System::LibraryLoader::{
    AddDllDirectory, RemoveDllDirectory, SetDefaultDllDirectories,
    LOAD_LIBRARY_SEARCH_APPLICATION_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32,
    LOAD_LIBRARY_SEARCH_USER_DIRS,
};

pub(super) struct PrivateRuntimeEnvironment {
    dll_directory_cookie: *mut std::ffi::c_void,
    runtime_bin: PathBuf,
    plugin_dir: PathBuf,
}

impl PrivateRuntimeEnvironment {
    pub(super) fn activate(runtime_root: &Path, state_root: &Path) -> Result<Self, &'static str> {
        let runtime_bin = runtime_root.join("bin");
        let plugin_dir = runtime_root.join("lib").join("gstreamer-1.0");
        let scanner = runtime_root
            .join("libexec")
            .join("gstreamer-1.0")
            .join("gst-plugin-scanner.exe");
        if !runtime_bin.is_dir() || !plugin_dir.is_dir() || !scanner.is_file() {
            return Err("private-gstreamer-layout-invalid");
        }
        fs::create_dir_all(state_root).map_err(|_| "private-gstreamer-state-unavailable")?;
        let registry = state_root.join("registry-x86_64.bin");

        set_private_environment(&plugin_dir, &scanner, &registry);
        let wide_bin = wide_path(&runtime_bin)?;

        // SAFETY: This process-wide loader policy is installed once during the
        // native-media actor's startup, before GStreamer initialization. The
        // flags retain only the application directory, System32, and the one
        // explicitly added, integrity-verified private runtime directory. The
        // returned non-null cookie is retained until the actor has dropped all
        // GstPlay objects and is removed on the same actor thread.
        let cookie = unsafe {
            SetDefaultDllDirectories(
                LOAD_LIBRARY_SEARCH_APPLICATION_DIR
                    | LOAD_LIBRARY_SEARCH_SYSTEM32
                    | LOAD_LIBRARY_SEARCH_USER_DIRS,
            )
            .map_err(|_| "private-dll-policy-failed")?;
            AddDllDirectory(PCWSTR::from_raw(wide_bin.as_ptr()))
        };
        if cookie.is_null() {
            return Err("private-dll-directory-failed");
        }

        Ok(Self {
            dll_directory_cookie: cookie,
            runtime_bin,
            plugin_dir,
        })
    }

    pub(super) fn initialize_gstreamer(&self) -> Result<(), &'static str> {
        // The helper process used by registry discovery does not inherit the
        // parent's AddDllDirectory cookie. Restrict PATH to the verified bin
        // directory only while initialization and the explicit scan run; the
        // Windows loader still searches the application directory and
        // System32. The previous process value is restored immediately after.
        let _path_scope = ScopedEnvironmentValue::replace("PATH", self.runtime_bin.as_os_str());
        gstreamer::init().map_err(|_| "gstreamer-init-failed")?;
        let registry = gstreamer::Registry::get();
        let _ = registry.scan_path(&self.plugin_dir);
        for required in ["playbin3", "d3d11videosink"] {
            if gstreamer::ElementFactory::find(required).is_none() {
                return Err("gstreamer-required-plugin-missing");
            }
        }
        Ok(())
    }
}

impl Drop for PrivateRuntimeEnvironment {
    fn drop(&mut self) {
        if !self.dll_directory_cookie.is_null() {
            // SAFETY: The cookie was returned by AddDllDirectory in `activate`,
            // is removed exactly once, and all GstPlay objects have already
            // been dropped by field/lifetime ordering in the actor loop.
            let _ = unsafe { RemoveDllDirectory(self.dll_directory_cookie.cast_const()) };
            self.dll_directory_cookie = std::ptr::null_mut();
        }
    }
}

fn set_private_environment(plugin_dir: &Path, scanner: &Path, registry: &Path) {
    std::env::set_var("GST_PLUGIN_PATH_1_0", plugin_dir);
    std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", "");
    std::env::set_var("GST_PLUGIN_PATH", "");
    std::env::set_var("GST_PLUGIN_SYSTEM_PATH", "");
    std::env::set_var("GST_PLUGIN_SCANNER_1_0", scanner);
    std::env::set_var("GST_REGISTRY_1_0", registry);
    std::env::set_var("GST_REGISTRY_FORK", "no");
    std::env::set_var("GST_REGISTRY_REUSE_PLUGIN_SCANNER", "no");
}

fn wide_path(path: &Path) -> Result<Vec<u16>, &'static str> {
    use std::os::windows::ffi::OsStrExt;
    let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if wide.is_empty() || wide.contains(&0) {
        return Err("private-dll-directory-invalid");
    }
    wide.push(0);
    Ok(wide)
}

struct ScopedEnvironmentValue {
    name: &'static str,
    previous: Option<OsString>,
}

impl ScopedEnvironmentValue {
    fn replace(name: &'static str, value: &std::ffi::OsStr) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, previous }
    }
}

impl Drop for ScopedEnvironmentValue {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.take() {
            std::env::set_var(self.name, previous);
        } else {
            std::env::remove_var(self.name);
        }
    }
}
