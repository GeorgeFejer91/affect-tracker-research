#[path = "research_native_media/contracts.rs"]
mod contracts;

pub use contracts::{PlaybackMode, PlaybackQualification};

use crate::research_error::{CommandError, ResearchResult};
use crate::research_platform::NATIVE_ACQUISITION_UNSUPPORTED_REASON;

/// Historical playback-mode compatibility for saved records; HTML video owns playback.
pub struct NativeMediaService {
    native_acquisition_supported: bool,
}

impl NativeMediaService {
    pub fn unavailable(native_acquisition_supported: bool) -> Self {
        Self {
            native_acquisition_supported,
        }
    }

    #[cfg(test)]
    pub fn unavailable_for_tests() -> Self {
        Self::unavailable(true)
    }

    pub fn authorize_playback(
        &self,
        playback_mode: PlaybackMode,
    ) -> ResearchResult<PlaybackQualification> {
        if !self.native_acquisition_supported {
            return Err(CommandError::native_acquisition_platform_unsupported());
        }
        match playback_mode {
            PlaybackMode::UnqualifiedWebview => Ok(PlaybackQualification::Unqualified),
            _ => self.unavailable_result(),
        }
    }

    fn unavailable_result<T>(&self) -> ResearchResult<T> {
        Err(CommandError::native_media_unavailable(
            if self.native_acquisition_supported {
                "html-video-playback-selected"
            } else {
                NATIVE_ACQUISITION_UNSUPPORTED_REASON
            },
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_service_rejects_retired_native_playback() {
        let service = NativeMediaService::unavailable_for_tests();
        assert!(service
            .authorize_playback(PlaybackMode::NativeLibvlc)
            .is_err());
        assert_eq!(
            service
                .authorize_playback(PlaybackMode::UnqualifiedWebview)
                .unwrap(),
            PlaybackQualification::Unqualified
        );
    }

    #[test]
    fn interface_only_platform_stays_unavailable() {
        let service = NativeMediaService::unavailable(false);
        assert!(service
            .authorize_playback(PlaybackMode::UnqualifiedWebview)
            .is_err());
    }
}
