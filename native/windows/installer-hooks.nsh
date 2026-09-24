!macro NSIS_HOOK_POSTINSTALL
  ${If} $NoShortcutMode != 1
    CreateDirectory "$SMPROGRAMS\Affect Research"
    Delete "$SMPROGRAMS\Affect Research\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\Affect Research\Experiment Planner Classic.lnk"
    Delete "$SMPROGRAMS\Affect Research\Experiment Planner Ledger.lnk"
    Delete "$SMPROGRAMS\Affect Research\Experiment Planner.lnk"
    Delete "$SMPROGRAMS\Affect Research\Experiment Runner.lnk"

    CreateShortcut "$SMPROGRAMS\Affect Research\Experiment Planner.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\resources\icons\planner-ledger.ico" 0 SW_SHOWNORMAL "" "Experiment Planner"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\Affect Research\Experiment Planner.lnk"

    CreateShortcut "$SMPROGRAMS\Affect Research\Experiment Runner.lnk" "$INSTDIR\resources\bin\affect-runner.exe" "" "$INSTDIR\resources\icons\experiment-runner.ico" 0 SW_SHOWNORMAL "" "Experiment Runner"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\Affect Research\Experiment Runner.lnk"
    WriteRegDWORD SHCTX "${UNINSTKEY}" "AffectResearchCustomShortcuts" 1
  ${Else}
    WriteRegDWORD SHCTX "${UNINSTKEY}" "AffectResearchCustomShortcuts" 0
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Suite-owned state and research files live below $INSTDIR and are retained.
  ; Never let Tauri's generic app-data option delete a legacy bundle profile
  ; that this suite does not own.
  ${If} $DeleteAppDataCheckboxState = 1
    ${Unless} ${Silent}
      MessageBox MB_OK|MB_ICONINFORMATION "Affect Research Suite preserves its workspace and application state so research data remains recoverable."
    ${EndUnless}
  ${EndIf}
  StrCpy $DeleteAppDataCheckboxState 0

  ReadRegDWORD $0 SHCTX "${UNINSTKEY}" "AffectResearchCustomShortcuts"
  ${If} $0 = 1
    Delete "$SMPROGRAMS\Affect Research\Experiment Planner.lnk"
    Delete "$SMPROGRAMS\Affect Research\Experiment Planner Classic.lnk"
    Delete "$SMPROGRAMS\Affect Research\Experiment Planner Ledger.lnk"
    Delete "$SMPROGRAMS\Affect Research\Experiment Runner.lnk"
    RMDir "$SMPROGRAMS\Affect Research"
  ${EndIf}
!macroend
