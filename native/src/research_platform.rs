use crate::research_error::{CommandError, ResearchResult};

pub const NATIVE_ACQUISITION_SUPPORTED: bool = cfg!(all(
    target_os = "windows",
    feature = "native-acquisition-windows"
));
pub const NATIVE_ACQUISITION_UNSUPPORTED_REASON: &str = "native-acquisition-platform-unsupported";

pub fn require_native_acquisition(supported: bool) -> ResearchResult<()> {
    if supported {
        Ok(())
    } else {
        Err(CommandError::native_acquisition_platform_unsupported())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_interface_only_gate_fails_closed() {
        let error = require_native_acquisition(false).unwrap_err();
        assert_eq!(error.code, "native_acquisition_platform_unsupported");
        assert!(require_native_acquisition(true).is_ok());
    }

    #[cfg(not(all(target_os = "windows", feature = "native-acquisition-windows")))]
    #[test]
    fn current_build_without_windows_acquisition_feature_is_interface_only() {
        assert_eq!(
            require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)
                .unwrap_err()
                .code,
            "native_acquisition_platform_unsupported"
        );
    }

    #[cfg(all(target_os = "windows", feature = "native-acquisition-windows"))]
    #[test]
    fn current_windows_build_retains_native_acquisition_boundary() {
        require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED).unwrap();
    }
}
