[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$ProvenancePath,
  [Parameter(Mandatory = $true)]
  [string]$ReceiptPath,
  [string]$InstallDirectoryName = 'Affect Research Suite',
  [switch]$RequireOffline,
  [switch]$AllowDevelopmentHost
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class AffectResearchKnownFolders {
  [DllImport("shell32.dll")]
  private static extern int SHGetKnownFolderPath(
    [MarshalAs(UnmanagedType.LPStruct)] Guid rfid,
    uint flags,
    IntPtr token,
    out IntPtr path
  );

  public static string Downloads() {
    IntPtr pointer;
    int result = SHGetKnownFolderPath(
      new Guid("374DE290-123F-4565-9164-39C4925E467B"),
      0,
      IntPtr.Zero,
      out pointer
    );
    if (result != 0) Marshal.ThrowExceptionForHR(result);
    try { return Marshal.PtrToStringUni(pointer); }
    finally { Marshal.FreeCoTaskMem(pointer); }
  }
}

[ComImport]
[Guid("00021401-0000-0000-C000-000000000046")]
internal class AffectResearchShellLink {}

[ComImport]
[Guid("000214F9-0000-0000-C000-000000000046")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAffectResearchShellLinkW {
  void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int capacity, IntPtr findData, uint flags);
  void GetIDList(out IntPtr itemList);
  void SetIDList(IntPtr itemList);
  void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int capacity);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
  void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int capacity);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
  void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int capacity);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
  void GetHotkey(out short hotkey);
  void SetHotkey(short hotkey);
  void GetShowCmd(out int showCommand);
  void SetShowCmd(int showCommand);
  void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int capacity, out int iconIndex);
  void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
  void Resolve(IntPtr window, uint flags);
  void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
}

public sealed class AffectResearchShortcutDetails {
  public string Target { get; set; }
  public string Arguments { get; set; }
  public string Icon { get; set; }
}

public static class AffectResearchShortcutReader {
  public static AffectResearchShortcutDetails Read(string path) {
    object link = new AffectResearchShellLink();
    try {
      ((IPersistFile)link).Load(path, 0);
      IAffectResearchShellLinkW shellLink = (IAffectResearchShellLinkW)link;
      StringBuilder target = new StringBuilder(32768);
      StringBuilder arguments = new StringBuilder(32768);
      StringBuilder icon = new StringBuilder(32768);
      int iconIndex;
      shellLink.GetPath(target, target.Capacity, IntPtr.Zero, 4);
      shellLink.GetArguments(arguments, arguments.Capacity);
      shellLink.GetIconLocation(icon, icon.Capacity, out iconIndex);
      return new AffectResearchShortcutDetails {
        Target = target.ToString(),
        Arguments = arguments.ToString(),
        Icon = icon.ToString() + "," + iconIndex.ToString()
      };
    } finally {
      Marshal.FinalReleaseComObject(link);
    }
  }
}
'@

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-Inventory([string]$Root) {
  if (-not (Test-Path -LiteralPath $Root)) { return @() }
  return @(
    Get-ChildItem -LiteralPath $Root -Force -Recurse |
      Sort-Object FullName |
      ForEach-Object {
        [ordered]@{
          relativePath = $_.FullName.Substring($Root.Length + 1).Replace('\', '/')
          kind = if ($_.PSIsContainer) { 'directory' } else { 'file' }
          byteLength = if ($_.PSIsContainer) { $null } else { $_.Length }
          sha256 = if ($_.PSIsContainer) { $null } else { Get-Sha256 $_.FullName }
        }
      }
  )
}

function Get-InventoryIdentity([object[]]$Inventory) {
  $json = ConvertTo-Json -InputObject @($Inventory) -Compress -Depth 4
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Get-ProgramInventory([string]$Root) {
  return @(
    Get-Inventory $Root |
      Where-Object {
        $_.relativePath -notmatch '^(?:workspace|state)(?:/|$)'
      }
  )
}

function Test-OrdinaryDirectory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
  $item = Get-Item -LiteralPath $Path -Force
  return -not [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Set-Gate([string]$Name, [string]$Status, [string]$Evidence) {
  $script:receipt.gates[$Name] = [ordered]@{ status = $Status; evidence = $Evidence }
}

function Get-Shortcut([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'An expected suite shortcut is absent.' }
  $shortcut = [AffectResearchShortcutReader]::Read($Path)
  return [ordered]@{
    name = [IO.Path]::GetFileNameWithoutExtension($Path)
    target = $shortcut.Target
    arguments = $shortcut.Arguments
    icon = $shortcut.Icon
  }
}

function Wait-ForDesktopProcess(
  [Diagnostics.Process]$Process,
  [string]$Executable,
  [string]$ExpectedTitle
) {
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $Process.Refresh()
    if ($Process.HasExited) { throw 'The installed suite app exited before exposing its main window.' }
    if (
      $Process.MainWindowHandle -ne 0 -and
      $Process.Responding -and
      $Process.MainWindowTitle -ceq $ExpectedTitle
    ) {
      $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $($Process.Id)"
      if ($candidate.ExecutablePath -cne $Executable) {
        throw 'The installed shortcut did not start the expected executable.'
      }
      return [ordered]@{ process = $Process; commandLine = $candidate.CommandLine }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw 'The installed suite app did not expose a responding main window within 30 seconds.'
}

function Invoke-AppShortcut(
  [string]$Shortcut,
  [string]$Executable,
  [string]$ExpectedTitle,
  [string]$Interface
) {
  $existing = @(
    Get-CimInstance Win32_Process |
      Where-Object { $_.ExecutablePath -eq $Executable } |
      ForEach-Object { [int]$_.ProcessId }
  )
  if ($existing.Count -ne 0) { throw 'A suite app process was already running before the launch check.' }
  $started = Start-Process -FilePath $Shortcut -PassThru
  $launched = Wait-ForDesktopProcess $started $Executable $ExpectedTitle
  $process = $launched.process
  $result = $null
  try {
    if ($launched.commandLine -match '(?:^|\s)--ledger(?:\s|$)') { throw 'The installed app used the retired Ledger argument.' }
    $processTable = @(Get-CimInstance Win32_Process)
    $processIds = @([int]$process.Id)
    do {
      $children = @(
        $processTable |
          Where-Object { $_.ParentProcessId -in $processIds -and $_.ProcessId -notin $processIds } |
          ForEach-Object { [int]$_.ProcessId }
      )
      $processIds += $children
    } while ($children.Count -ne 0)
    $connections = @(
      Get-NetTCPConnection -ErrorAction Stop |
        Where-Object { $_.OwningProcess -in $processIds -and $_.State -ne 'Closed' }
    )
    $result = [ordered]@{
      title = $process.MainWindowTitle
      interface = $Interface
      responding = $process.Responding
      tcpConnectionCount = $connections.Count
    }
  } finally {
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(10000)) {
      throw 'The installed suite app did not close through its main window within 10 seconds.'
    }
  }
  if ($process.ExitCode -ne 0) { throw 'The installed suite app returned a nonzero exit code after normal close.' }
  $result.exitCode = $process.ExitCode
  return $result
}

function Invoke-SilentExecutable([string]$Path) {
  $process = Start-Process -FilePath $Path -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw 'A silent installer lifecycle action returned a nonzero exit code.' }
  return $process.ExitCode
}

function Invoke-SilentInstaller([string]$Path, [string]$Destination) {
  $process = Start-Process -FilePath $Path -ArgumentList @('/S', "/D=$Destination") -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw 'The silent suite installer returned a nonzero exit code.' }
  return $process.ExitCode
}

$downloads = [IO.Path]::GetFullPath([AffectResearchKnownFolders]::Downloads()).TrimEnd('\')
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$provenanceFile = (Resolve-Path -LiteralPath $ProvenancePath).Path
$receiptFile = [IO.Path]::GetFullPath($ReceiptPath)
$installRoot = if ([string]::IsNullOrWhiteSpace($InstallDirectoryName)) {
  throw 'The selected suite directory name must not be empty.'
} else {
  [IO.Path]::GetFullPath((Join-Path $downloads $InstallDirectoryName)).TrimEnd('\')
}
if (
  [IO.Path]::GetDirectoryName($installRoot) -cne $downloads -or
  [IO.Path]::GetFileName($installRoot) -cne $InstallDirectoryName
) {
  throw 'The selected suite directory must be one direct child of the current user known Downloads folder.'
}
$canWriteReceipt = $false
$failure = $null
$currentGate = 'provenance'

$receipt = [ordered]@{
  schema = 'AffectResearchSuiteInstalledSmokeV2'
  status = 'running'
  capturedAtUtc = $null
  artifact = $null
  host = [ordered]@{
    os = [Environment]::OSVersion.VersionString
    architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    currentAppliedDpi = (Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop\WindowMetrics' -Name AppliedDPI -ErrorAction SilentlyContinue).AppliedDPI
    offlineRequired = [bool]$RequireOffline
    developmentHostAllowed = [bool]$AllowDevelopmentHost
  }
  environment = $null
  installation = $null
  shortcuts = @()
  launches = @()
  gates = [ordered]@{
    provenance = [ordered]@{ status = 'notRun'; evidence = 'Not reached.' }
    cleanProfile = [ordered]@{ status = 'notRun'; evidence = 'Not reached.' }
    offline = [ordered]@{ status = 'notRun'; evidence = 'Not requested.' }
    install = [ordered]@{ status = 'notRun'; evidence = 'Not reached.' }
    environment = [ordered]@{ status = 'notRun'; evidence = 'Not reached.' }
    interfaces = [ordered]@{ status = 'notRun'; evidence = 'Not reached.' }
    restart = [ordered]@{ status = 'notRun'; evidence = 'Not reached.' }
    repair = [ordered]@{ status = 'notRun'; evidence = 'Not reached.' }
    uninstall = [ordered]@{ status = 'notRun'; evidence = 'Not reached.' }
  }
  failure = $null
}

try {
  if ([IO.Path]::GetDirectoryName($installer) -cne $downloads) {
    throw 'The installer must be a direct child of the current user known Downloads folder.'
  }
  if ([IO.Path]::GetDirectoryName($receiptFile) -cne $downloads) {
    throw 'The receipt must be written directly beneath the current user known Downloads folder.'
  }
  if (Test-Path -LiteralPath $receiptFile) { throw 'The requested receipt already exists.' }
  $canWriteReceipt = $true

  $provenance = Get-Content -LiteralPath $provenanceFile -Raw | ConvertFrom-Json
  if ($provenance.schema -cne 'AffectResearchUnqualifiedInternalPackageProvenanceV2') {
    throw 'The package provenance schema is not supported by this installed smoke route.'
  }
  if (
    -not $provenance.buildBoundary.dirtyStateRejected -or
    -not $provenance.buildBoundary.lockedDependencies -or
    -not $provenance.buildBoundary.unsigned -or
    $provenance.buildBoundary.published
  ) {
    throw 'The package provenance does not bind clean-tree and locked-dependency checks.'
  }
  $artifacts = @($provenance.artifacts)
  if ($artifacts.Count -ne 1 -or $artifacts[0].kind -cne 'nsis') {
    throw 'The package provenance must bind exactly one NSIS artifact.'
  }
  $artifactHash = Get-Sha256 $installer
  $artifactLength = (Get-Item -LiteralPath $installer).Length
  if (
    $artifacts[0].fileName -cne [IO.Path]::GetFileName($installer) -or
    $artifacts[0].sha256 -cne $artifactHash -or
    [int64]$artifacts[0].byteLength -ne $artifactLength
  ) {
    throw 'The installer bytes do not match their provenance.'
  }
  $receipt.artifact = [ordered]@{
    fileName = [IO.Path]::GetFileName($installer)
    byteLength = $artifactLength
    sha256 = $artifactHash
    sourceCommit = $provenance.commit
    productVersion = $provenance.version
    signature = 'notSigned'
    published = $false
    toolchain = $provenance.toolchain
  }
  Set-Gate 'provenance' 'passed' 'Exact installer filename, length, SHA-256, source commit, clean-tree rejection, locked dependencies, and build toolchain matched V2 provenance.'

  $currentGate = 'cleanProfile'
  $developmentTools = @(
    @('node', 'node.exe', 'pnpm', 'pnpm.cmd', 'pnpm.exe') |
      Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } |
      Sort-Object -Unique
  )
  $developmentListeners = @(
    Get-NetTCPConnection -State Listen -ErrorAction Stop |
      Where-Object { $_.LocalPort -in 8000, 8013, 1420, 5173 }
  )
  $documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
  $sourceCandidates = @(
    (Join-Path $downloads 'affect-tracker-research'),
    (Join-Path (Join-Path $documents 'GitHub') 'affect-tracker-research'),
    (Join-Path ([IO.Path]::GetDirectoryName($installer)) '.git')
  )
  $sourceCheckoutDetected = @($sourceCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count -ne 0
  if ($developmentTools.Count -ne 0 -or $developmentListeners.Count -ne 0 -or $sourceCheckoutDetected) {
    if (-not $AllowDevelopmentHost) {
      throw 'The clean-profile boundary found a source checkout, Node/pnpm, or a development-server listener.'
    }
    Set-Gate 'cleanProfile' 'blocked' 'Development-host continuation was requested. A source checkout, Node/pnpm, or a development-server listener was present, so this receipt cannot qualify the clean-profile gate.'
  } else {
    Set-Gate 'cleanProfile' 'passed' 'No source checkout at the validator boundaries, Node, pnpm, or common suite development-server listener was present.'
  }

  if ($RequireOffline) { $currentGate = 'offline' }
  $defaultRouteAdapters = @(
    Get-NetIPConfiguration -ErrorAction Stop |
      Where-Object {
        $_.NetAdapter.Status -eq 'Up' -and
        ($null -ne $_.IPv4DefaultGateway -or $null -ne $_.IPv6DefaultGateway)
      }
  )
  if ($RequireOffline) {
    if ($defaultRouteAdapters.Count -ne 0) { throw 'Offline validation requires every default-route network adapter to be disconnected.' }
    Set-Gate 'offline' 'passed' 'No active adapter with an IPv4 or IPv6 default gateway was present during the installed workflow.'
  }

  $workspace = Join-Path $installRoot 'workspace'
  $stateRoot = Join-Path $installRoot 'state'
  $plannerWebviewRoot = Join-Path $stateRoot 'planner\webview'
  $runnerWebviewRoot = Join-Path $stateRoot 'runner\webview'
  $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Affect Research'
  $plannerShortcut = Join-Path $startMenu 'Experiment Planner.lnk'
  $runnerShortcut = Join-Path $startMenu 'Experiment Runner.lnk'
  $currentGate = 'install'
  if (Test-Path -LiteralPath $installRoot) { throw 'The clean-install program directory already exists.' }

  Set-Location -LiteralPath $downloads
  $installExitCode = Invoke-SilentInstaller $installer $installRoot
  $executable = Join-Path $installRoot 'affect-research.exe'
  $runnerExecutable = Join-Path $installRoot 'resources\bin\affect-runner.exe'
  $uninstaller = Join-Path $installRoot 'uninstall.exe'
  $ledgerIcon = Join-Path $installRoot 'resources\icons\planner-ledger.ico'
  $runnerIcon = Join-Path $installRoot 'resources\icons\experiment-runner.ico'
  $suiteMarker = Join-Path $installRoot 'resources\affect-research-suite-root.json'
  $installedInventory = Get-ProgramInventory $installRoot
  $installedNames = @($installedInventory | ForEach-Object { $_.relativePath })
  $expectedInstalledNames = @(
    'affect-research.exe',
    'resources',
    'resources/affect-research-suite-root.json',
    'resources/bin',
    'resources/bin/affect-runner.exe',
    'resources/icons',
    'resources/icons/experiment-runner.ico',
    'resources/icons/planner-ledger.ico',
    'uninstall.exe'
  )
  if (Compare-Object $expectedInstalledNames $installedNames) { throw 'The installed program-file inventory was not the closed suite inventory.' }
  if (-not (Test-Path -LiteralPath $suiteMarker -PathType Leaf)) { throw 'The installed suite marker is absent.' }
  $installedIdentity = Get-InventoryIdentity $installedInventory
  Set-Gate 'install' 'passed' 'The per-user installer used the requested suite directory and produced the Planner, embedded Runner, scoped icons, suite marker, and uninstaller.'

  $planner = Get-Shortcut $plannerShortcut
  $runner = Get-Shortcut $runnerShortcut
  if ($planner.target -cne $executable -or $planner.arguments) { throw 'The Planner shortcut target or arguments were incorrect.' }
  if ($runner.target -cne $runnerExecutable -or $runner.arguments) { throw 'The Runner shortcut target or arguments were incorrect.' }
  if ($planner.icon.Split(',')[0] -cne $ledgerIcon) { throw 'The Planner shortcut did not use its installed icon.' }
  if ($runner.icon.Split(',')[0] -cne $runnerIcon) { throw 'The Runner shortcut did not use its installed icon.' }
  $receipt.shortcuts = @(
    [ordered]@{ name = $planner.name; target = '<SuiteRoot>/affect-research.exe'; arguments = ''; icon = '<SuiteRoot>/resources/icons/planner-ledger.ico,0' },
    [ordered]@{ name = $runner.name; target = '<SuiteRoot>/resources/bin/affect-runner.exe'; arguments = ''; icon = '<SuiteRoot>/resources/icons/experiment-runner.ico,0' }
  )

  $currentGate = 'environment'
  $receipt.launches += Invoke-AppShortcut $plannerShortcut $executable 'Experiment Planner' 'planner-ledger'
  $requiredDirectories = @(
    'stimuli', 'settings', 'outputs', 'recovery', 'assets', 'assets/stimuli', 'assets/questionnaires'
  )
  foreach ($relativePath in $requiredDirectories) {
    if (-not (Test-OrdinaryDirectory (Join-Path $workspace $relativePath))) {
      throw 'First launch did not create the complete ordinary-directory workspace contract.'
    }
  }
  if (-not (Test-OrdinaryDirectory $plannerWebviewRoot)) { throw 'First launch did not create the suite-local Planner WebView profile.' }
  $workspaceInventory = Get-Inventory $workspace
  if (@($workspaceInventory | Where-Object { $_.kind -ne 'directory' }).Count -ne 0) {
    throw 'The clean first-launch workspace contained undeclared files.'
  }
  $workspaceIdentity = Get-InventoryIdentity $workspaceInventory
  $receipt.environment = [ordered]@{
    suiteRoot = '<Known Downloads>/<Selected Suite Directory>'
    workspace = '<SuiteRoot>/workspace'
    plannerWebviewProfile = '<SuiteRoot>/state/planner/webview'
    runnerWebviewProfile = '<SuiteRoot>/state/runner/webview'
    requiredDirectories = $requiredDirectories
    workspaceInventorySha256 = $workspaceIdentity
    activeDefaultRouteAdapterCount = $defaultRouteAdapters.Count
  }
  Set-Gate 'environment' 'passed' 'First launch created the required ordinary workspace directories and suite-local Planner state without an external app-data dependency.'

  $currentGate = 'interfaces'
  $receipt.launches += Invoke-AppShortcut $runnerShortcut $runnerExecutable 'Experiment Runner' 'runner'
  if (-not (Test-OrdinaryDirectory $runnerWebviewRoot)) { throw 'Runner launch did not create the suite-local Runner WebView profile.' }
  if ((Get-InventoryIdentity (Get-Inventory $workspace)) -cne $workspaceIdentity) {
    throw 'The Runner launch changed the clean workspace contract.'
  }
  $launchesWithTcp = @($receipt.launches | Where-Object { $_.tcpConnectionCount -ne 0 }).Count
  if ($RequireOffline -and $launchesWithTcp -ne 0) {
    throw 'An installed suite process held a TCP connection during the disconnected-host workflow.'
  }
  Set-Gate 'interfaces' 'passed' 'Both installed shortcuts launched the intended responsive window, used the exact target and arguments, and closed normally. TCP connection counts were recorded for all launches; zero was required only for the disconnected-host gate.'

  $currentGate = 'restart'
  $receipt.launches += Invoke-AppShortcut $plannerShortcut $executable 'Experiment Planner' 'planner-ledger'
  if ((Get-InventoryIdentity (Get-Inventory $workspace)) -cne $workspaceIdentity) {
    throw 'Restart changed the clean workspace contract.'
  }
  Set-Gate 'restart' 'passed' 'A second Planner launch retained the same workspace inventory and closed normally.'

  $currentGate = 'repair'
  $iconHash = Get-Sha256 $ledgerIcon
  [IO.File]::Delete($ledgerIcon)
  if (Test-Path -LiteralPath $ledgerIcon) { throw 'The controlled repair probe could not remove the installed Ledger icon.' }
  $repairExitCode = Invoke-SilentInstaller $installer $installRoot
  if ((Get-Sha256 $ledgerIcon) -cne $iconHash) { throw 'Repair did not restore the exact installed Ledger icon.' }
  if ((Get-InventoryIdentity (Get-ProgramInventory $installRoot)) -cne $installedIdentity) {
    throw 'Repair did not restore the exact installed program-file inventory.'
  }
  if ((Get-InventoryIdentity (Get-Inventory $workspace)) -cne $workspaceIdentity) {
    throw 'Repair changed the workspace.'
  }
  Set-Gate 'repair' 'passed' 'Same-artifact repair returned 0, restored the exact removed Ledger icon, restored the program inventory, and did not change the workspace.'

  $currentGate = 'uninstall'
  $stateIdentity = Get-InventoryIdentity (Get-Inventory $stateRoot)
  $uninstallExitCode = Invoke-SilentExecutable $uninstaller
  $uninstallDeadline = (Get-Date).AddSeconds(10)
  while (
    (
      (Test-Path -LiteralPath $uninstaller) -or
      (Test-Path -LiteralPath $plannerShortcut) -or
      (Test-Path -LiteralPath $runnerShortcut)
    ) -and
    (Get-Date) -lt $uninstallDeadline
  ) {
    Start-Sleep -Milliseconds 250
  }
  if (@(Get-ProgramInventory $installRoot).Count -ne 0) { throw 'Uninstall retained suite program files.' }
  if ((Test-Path -LiteralPath $plannerShortcut) -or (Test-Path -LiteralPath $runnerShortcut)) {
    throw 'Uninstall retained a suite Start Menu shortcut.'
  }
  if ((Get-InventoryIdentity (Get-Inventory $workspace)) -cne $workspaceIdentity) {
    throw 'Uninstall changed the researcher workspace.'
  }
  if ((Get-InventoryIdentity (Get-Inventory $stateRoot)) -cne $stateIdentity) {
    throw 'Uninstall changed the suite-local application state.'
  }
  Set-Gate 'uninstall' 'passed' 'Silent uninstall returned 0, removed program files and both shortcuts, and preserved the exact workspace and suite-local state inventories.'

  $receipt.installation = [ordered]@{
    mode = 'currentUserSelectedDirectory'
    installRoot = '<Known Downloads>/<Selected Suite Directory>'
    installExitCode = $installExitCode
    repairExitCode = $repairExitCode
    uninstallExitCode = $uninstallExitCode
    installedInventorySha256 = $installedIdentity
    installedFiles = @($installedInventory)
  }
  $receipt.status = if ($receipt.gates.cleanProfile.status -eq 'blocked') { 'blocked' } else { 'passed' }
} catch {
  $failure = $_
  $message = $_.Exception.Message
  foreach ($replacement in @(
    @($downloads, '<Known Downloads>'),
    @($env:LOCALAPPDATA, '<LocalAppData>'),
    @($env:APPDATA, '<RoamingAppData>'),
    @($env:USERPROFILE, '<UserProfile>')
  )) {
    $message = $message.Replace($replacement[0], $replacement[1])
  }
  $receipt.status = 'failed'
  if ($receipt.gates[$currentGate].status -ne 'passed') {
    Set-Gate $currentGate 'failed' $message
  }
  $receipt.failure = $message
} finally {
  if ($canWriteReceipt) {
    $receipt.capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    $json = ConvertTo-Json -InputObject $receipt -Depth 9
    [IO.File]::WriteAllText($receiptFile, "$json`r`n", (New-Object Text.UTF8Encoding($false)))
  }
}

if ($failure) { throw 'Installed smoke failed. Inspect the redacted receipt for the failing gate.' }
if ($receipt.status -eq 'blocked') {
  Write-Host "Installed functional smoke completed; clean-profile qualification remains blocked: $receiptFile"
} else {
  Write-Host "Installed smoke passed: $receiptFile"
}
