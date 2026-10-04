; Tauri owns the main executable, sidecars, WebView2 bootstrap and uninstaller.
; Only the two portable receipts need moving from resources to the suite root.
Var SuiteInstallFailure
!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "affect-runner-engine.exe" "Experiment Runner"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $SuiteInstallFailure "planner-missing"
  IfFileExists "$INSTDIR\Experiment Planner.exe" 0 suite_install_failed
  StrCpy $SuiteInstallFailure "build-receipt-missing"
  IfFileExists "$INSTDIR\resources\current-build.json" 0 suite_install_failed
  StrCpy $SuiteInstallFailure "launcher-receipt-missing"
  IfFileExists "$INSTDIR\resources\launcher-receipt.json" 0 suite_install_failed
  StrCpy $SuiteInstallFailure "launcher-missing"
  IfFileExists "$INSTDIR\Experiment Runner.exe" 0 suite_install_failed
  StrCpy $SuiteInstallFailure "runner-engine-missing"
  IfFileExists "$INSTDIR\affect-runner-engine.exe" 0 suite_install_failed
  StrCpy $SuiteInstallFailure "launcher-verification-failed"
  ExecWait '"$INSTDIR\Experiment Runner.exe" --verify-only' $0
  IntCmp $0 0 0 suite_install_failed suite_install_failed
  ClearErrors
  StrCpy $SuiteInstallFailure "build-receipt-copy-failed"
  CopyFiles /SILENT "$INSTDIR\resources\current-build.json" "$INSTDIR\current-build.json"
  IfErrors suite_install_failed
  StrCpy $SuiteInstallFailure "launcher-receipt-copy-failed"
  CopyFiles /SILENT "$INSTDIR\resources\launcher-receipt.json" "$INSTDIR\launcher-receipt.json"
  IfErrors suite_install_failed
  Delete "$INSTDIR\resources\current-build.json"
  Delete "$INSTDIR\resources\launcher-receipt.json"
  IfFileExists "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" 0 suite_shortcuts_done
  Rename "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$SMPROGRAMS\$AppStartMenuFolder\Experiment Planner.lnk"
  CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\Experiment Runner.lnk" "$INSTDIR\Experiment Runner.exe"
  suite_shortcuts_done:
  Goto suite_install_done
  suite_install_failed:
  FileOpen $0 "$TEMP\affect-suite-install-failure.txt" w
  FileWrite $0 "$SuiteInstallFailure$\r$\n"
  FileClose $0
  Abort "The Planner and Runner suite files could not be installed together: $SuiteInstallFailure"
  suite_install_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "affect-runner-engine.exe" "Experiment Runner"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\Experiment Runner.exe"
  Delete "$INSTDIR\affect-runner-engine.exe"
  Delete "$INSTDIR\current-build.json"
  Delete "$INSTDIR\launcher-receipt.json"
  ${If} $UpdateMode <> 1
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    Delete "$SMPROGRAMS\$AppStartMenuFolder\Experiment Planner.lnk"
    Delete "$SMPROGRAMS\$AppStartMenuFolder\Experiment Runner.lnk"
    RMDir "$SMPROGRAMS\$AppStartMenuFolder"
  ${EndIf}
  RMDir "$INSTDIR"
!macroend
