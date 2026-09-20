!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$SMPROGRAMS\Affect Research"
  Delete "$SMPROGRAMS\Affect Research\${PRODUCTNAME}.lnk"
  Delete "$SMPROGRAMS\Affect Research\Experiment Planner Classic.lnk"
  Delete "$SMPROGRAMS\Affect Research\Experiment Planner Ledger.lnk"

  CreateShortcut "$SMPROGRAMS\Affect Research\Experiment Planner Classic.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0 SW_SHOWNORMAL "" "Experiment Planner Classic"
  !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\Affect Research\Experiment Planner Classic.lnk"

  CreateShortcut "$SMPROGRAMS\Affect Research\Experiment Planner Ledger.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--ledger" "$INSTDIR\resources\ledger-icon.ico" 0 SW_SHOWNORMAL "" "Experiment Planner Ledger"
  !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\Affect Research\Experiment Planner Ledger.lnk"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$SMPROGRAMS\Affect Research\Experiment Planner Classic.lnk"
  Delete "$SMPROGRAMS\Affect Research\Experiment Planner Ledger.lnk"
  RMDir "$SMPROGRAMS\Affect Research"
!macroend
