param(
  [Parameter(Mandatory)][ValidateSet('windows-x64', 'runner-windows-x64')][string]$Target,
  [Parameter(Mandatory)][string]$InstallDirectory,
  [Parameter(Mandatory)][string]$UninstallerPath,
  [Parameter(Mandatory)][string]$ProvenancePath,
  [string]$StagedPlannerCli
)

$ErrorActionPreference = 'Stop'
$receipt = Get-Content -LiteralPath $ProvenancePath -Raw | ConvertFrom-Json
if ($receipt.schema -cne 'AffectResearchUnqualifiedInternalPackageProvenanceV2' -or
    $receipt.target.platform -cne 'windows' -or $receipt.target.architecture -cne 'x64' -or
    @($receipt.artifacts).Count -ne 1 -or $receipt.artifacts[0].kind -cne 'nsis') {
  throw 'Package provenance does not describe one Windows x64 NSIS artifact.'
}

$install = (Resolve-Path -LiteralPath $InstallDirectory).Path
$uninstaller = (Resolve-Path -LiteralPath $UninstallerPath).Path
if ((Split-Path -Parent $uninstaller) -ine $install) {
  throw 'Registered uninstaller is outside the application install directory.'
}

[string[]]$expected = if ($Target -eq 'windows-x64') {
  if (-not $StagedPlannerCli -or -not $receipt.plannerCli -or
      $receipt.plannerCli.installedFileName -cne 'affect-planner-cli.exe' -or
      $receipt.plannerCli.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
      $receipt.plannerCli.byteLength -le 0) {
    throw 'Planner CLI provenance is missing or invalid.'
  }
  @('Experiment Planner.exe', 'affect-planner-cli.exe')
} else {
  if ($receipt.PSObject.Properties.Name -contains 'plannerCli' -or $StagedPlannerCli) {
    throw 'Runner package must not have a Planner CLI.'
  }
  @('affect-runner.exe')
}

$expected += Split-Path -Leaf $uninstaller
$actual = @(Get-ChildItem -LiteralPath $install -Recurse -File -Filter '*.exe' |
  ForEach-Object { [System.IO.Path]::GetRelativePath($install, $_.FullName).Replace('\', '/') })
if (Compare-Object -ReferenceObject $expected -DifferenceObject $actual) {
  throw "Installed executable set differs: expected $($expected -join ', '); found $($actual -join ', ')."
}

if ($Target -eq 'windows-x64') {
  foreach ($path in @($StagedPlannerCli, (Join-Path $install 'affect-planner-cli.exe'))) {
    $file = Get-Item -LiteralPath $path
    if ($file.Length -ne $receipt.plannerCli.byteLength -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $receipt.plannerCli.sha256) {
      throw "Planner CLI differs from staged provenance: $path"
    }
  }
}
