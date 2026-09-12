[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $TestExecutable,
    [Parameter(Mandatory)] [string] $RuntimeRoot,
    [Parameter(Mandatory)] [string] $ClipPath,
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [ValidateRange(30, 300)] [int] $TimeoutSeconds = 150
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testPath = (Resolve-Path -LiteralPath $TestExecutable).Path
$runtimePath = (Resolve-Path -LiteralPath $RuntimeRoot).Path
$clip = (Resolve-Path -LiteralPath $ClipPath).Path
if ([IO.Path]::GetFileName($testPath) -notmatch '^affect_research-[0-9a-f]+\.exe$') {
    throw 'Only a named Cargo library test executable may be launched.'
}
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory) -or (Test-Path -LiteralPath $OutputDirectory)) {
    throw 'OutputDirectory must be a new absolute directory; existing evidence is never overwritten.'
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
& (Join-Path $PSScriptRoot 'stage-gstreamer-runtime.ps1') -VerifyOnly -DestinationPath $runtimePath
$clipHash = (Get-FileHash -LiteralPath $clip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($clipHash -cne 'b5327e7465ec92a4c93f3236a1ebab4556cdf508e24eafe6c593eac1e13afd49' -or
    (Get-Item -LiteralPath $clip).Length -ne 86870779) { throw 'The diagnostic requires the exact allocated clip.' }
$null = New-Item -ItemType Directory -Path $output
$testName = 'research_native_media::gst_actor::diagnostic::offscreen_native_actor_lifecycle'
$saved = @{}
$values = @{
    AFFECT_NATIVE_DIAGNOSTIC_OPT_IN = '1'
    AFFECT_NATIVE_DIAGNOSTIC_RUNTIME = $runtimePath
    AFFECT_NATIVE_DIAGNOSTIC_CLIP = $clip
    AFFECT_NATIVE_DIAGNOSTIC_STATE = (Join-Path $output 'state')
    # This is a development diagnostic, not proof of standalone pre-main loading.
    PATH = "$(Join-Path $runtimePath 'bin');$env:SystemRoot/system32;$env:SystemRoot"
}
$child = $null
$timedOut = $false
$observedModules = @{}
$moduleObservationFailed = $false
$started = [DateTime]::UtcNow
try {
    foreach ($name in $values.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $values[$name], 'Process')
    }
    $child = Start-Process -FilePath $testPath -ArgumentList @($testName, '--exact', '--ignored', '--nocapture', '--test-threads=1') `
        -WorkingDirectory $output -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $output 'stdout.log') -RedirectStandardError (Join-Path $output 'stderr.log')
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not $child.WaitForExit(250) -and [DateTime]::UtcNow -lt $deadline) {
        try {
            foreach ($module in $child.Modules) {
                if ($module.ModuleName -in @('gstreamer-1.0-0.dll', 'gstplay-1.0-0.dll', 'gstvideo-1.0-0.dll', 'gstpbutils-1.0-0.dll')) {
                    $observedModules[$module.ModuleName.ToLowerInvariant()] = $module.FileName
                }
            }
        } catch { $moduleObservationFailed = $true }
        $child.Refresh()
    }
    if (-not $child.HasExited) {
        $timedOut = $true
        # This handle refers only to the exact child created above, never a user app.
        $child.Kill($true)
        $child.WaitForExit(10000) | Out-Null
    }
    $child.Refresh()
    $stdout = [string](Get-Content -Raw -LiteralPath (Join-Path $output 'stdout.log'))
    $moduleReceipts = @()
    foreach ($name in @('gstreamer-1.0-0.dll', 'gstplay-1.0-0.dll', 'gstvideo-1.0-0.dll', 'gstpbutils-1.0-0.dll')) {
        $expected = [IO.Path]::GetFullPath((Join-Path $runtimePath "bin/$name"))
        $observed = $observedModules[$name]
        $matches = $null -ne $observed -and [StringComparer]::OrdinalIgnoreCase.Equals($expected, [IO.Path]::GetFullPath($observed))
        $moduleReceipts += [ordered]@{
            name = $name; observedInPinnedBin = $matches
            sha256 = $(if ($matches) { (Get-FileHash -LiteralPath $observed -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
        }
    }
    $moduleClosureObserved = -not $moduleObservationFailed -and @($moduleReceipts | Where-Object { -not $_.observedInPinnedBin }).Count -eq 0
    $receipt = [ordered]@{
        schema = 'affect-native-engineering-process-v1'
        executableSha256 = (Get-FileHash -LiteralPath $testPath -Algorithm SHA256).Hash.ToLowerInvariant()
        test = $testName
        clipSha256 = $clipHash
        runtimeManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $runtimePath 'runtime-files.sha256') -Algorithm SHA256).Hash.ToLowerInvariant()
        processId = $child.Id
        exitCode = $child.ExitCode
        timedOut = $timedOut
        durationSeconds = ([DateTime]::UtcNow - $started).TotalSeconds
        completionObserved = ($stdout -match '"stage":"complete"')
        actorThreadExitObserved = ($stdout -match '"stage":"actor-thread-exited"')
        failedStartActorJoinedObserved = ($stdout -match '"stage":"failed-start-actor-joined"')
        failedStartShutdownUnconfirmed = ($stdout -match '"stage":"failed-start-shutdown-unconfirmed"')
        coreModuleClosureObserved = $moduleClosureObserved
        coreModuleObservationFailed = $moduleObservationFailed
        coreModules = $moduleReceipts
        qualified = $false
        installedQualification = $false
        launchDependencyMode = 'process-path-pinned-runtime-development-only'
    }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'process-receipt.json') -Encoding utf8NoBOM
    $receipt | ConvertTo-Json
    if ($timedOut -or $child.ExitCode -ne 0 -or -not $receipt.completionObserved -or -not $receipt.actorThreadExitObserved -or -not $moduleClosureObserved) {
        throw 'Native engineering diagnostic failed; retained logs and receipt contain the observed result.'
    }
}
finally {
    if ($null -ne $child) {
        if (-not $child.HasExited) { $child.Kill($true) }
        $child.Dispose()
    }
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
