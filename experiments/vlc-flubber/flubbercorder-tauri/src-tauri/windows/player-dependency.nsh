!define PLAYER_SETUP_URL "$%FLUBBERVLC_SETUP_URL%"
!define PLAYER_SETUP_SHA256 "$%FLUBBERVLC_SETUP_SHA256%"
!if "${PLAYER_SETUP_URL}" == ""
  !error "A fixed FlubberVLC setup URL is required"
!endif
!if "${PLAYER_SETUP_SHA256}" == ""
  !error "The exact FlubberVLC setup SHA-256 is required"
!endif
!define PLAYER_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  File /oname=$PLUGINSDIR\download-player.ps1 "${PLAYER_HOOK_DIR}\download-player.ps1"
  ClearErrors
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\download-player.ps1" -Url "${PLAYER_SETUP_URL}" -ExpectedSha256 "${PLAYER_SETUP_SHA256}" -OutFile "$PLUGINSDIR\FlubberVLCSetup.exe"' $0
  IfErrors flubber_download_failed
  StrCmp $0 0 flubber_download_complete flubber_download_failed
  flubber_download_failed:
    SetErrorLevel 1
    Abort "The trusted Flubber VLC Player setup could not be downloaded or verified. FlubberRecorder was not installed."
  flubber_download_complete:
    ClearErrors
    ExecWait '"$PLUGINSDIR\FlubberVLCSetup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR="$LOCALAPPDATA\Programs\FlubberVLCPlayer"' $0
    IfErrors flubber_player_install_failed
    StrCmp $0 0 flubber_player_install_complete flubber_player_install_failed
  flubber_player_install_failed:
    SetErrorLevel 1
    Abort "Flubber VLC Player installation failed. FlubberRecorder was not installed."
  flubber_player_install_complete:
    Delete "$PLUGINSDIR\FlubberVLCSetup.exe"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  ExecWait '"$INSTDIR\FlubberRecorder.exe" --verify-player' $0
  IfErrors flubber_player_verify_failed
  StrCmp $0 0 flubber_player_verify_complete flubber_player_verify_failed
  flubber_player_verify_failed:
    SetErrorLevel 1
    Abort "The installed Flubber VLC Player payload does not match this FlubberRecorder build."
  flubber_player_verify_complete:
!macroend
