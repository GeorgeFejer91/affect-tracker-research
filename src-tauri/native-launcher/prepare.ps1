[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnginePath,
    [Parameter(Mandatory)][string]$ApplicationDirectory,
    [Parameter(Mandatory)][string]$BuildDirectory
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $EnginePath).Path
$destination = (Resolve-Path -LiteralPath $ApplicationDirectory).Path
if (-not [IO.Path]::IsPathFullyQualified($BuildDirectory)) { throw 'BuildDirectory must be absolute.' }
$engineTarget = Join-Path $destination 'affect-runner-engine.exe'
$launcherTarget = Join-Path $destination 'Experiment Runner.exe'
if ((Test-Path -LiteralPath $engineTarget) -or (Test-Path -LiteralPath $launcherTarget)) {
    throw 'Use a new application directory; an existing candidate is never overwritten.'
}
$manifest = Join-Path $PSScriptRoot 'Cargo.toml'
$previousHash = $env:AFFECT_RUNNER_ENGINE_SHA256
$previousTarget = $env:CARGO_TARGET_DIR
try {
    $env:AFFECT_RUNNER_ENGINE_SHA256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    $env:CARGO_TARGET_DIR = $BuildDirectory
    & cargo build --manifest-path $manifest --locked --offline --release
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
    Copy-Item -LiteralPath $source -Destination $engineTarget
    Copy-Item -LiteralPath (Join-Path $BuildDirectory 'release/affect-runner-launcher.exe') -Destination $launcherTarget
    $verify = Start-Process -FilePath $launcherTarget -ArgumentList '--verify-only' -WindowStyle Hidden -PassThru -Wait
    if ($verify.ExitCode -ne 0) { throw 'Prepared launcher/runtime verification failed; do not use this candidate.' }
    [ordered]@{
        schema='affect-runner-bootstrap-receipt-v1'
        engineSha256=$env:AFFECT_RUNNER_ENGINE_SHA256
        launcherSha256=(Get-FileHash -LiteralPath $launcherTarget -Algorithm SHA256).Hash.ToLowerInvariant()
        runtimeVerified=$true
        researchQualified=$false
        commandFileRequired=$false
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'launcher-receipt.json') -Encoding utf8
} finally {
    $env:AFFECT_RUNNER_ENGINE_SHA256 = $previousHash
    $env:CARGO_TARGET_DIR = $previousTarget
}
