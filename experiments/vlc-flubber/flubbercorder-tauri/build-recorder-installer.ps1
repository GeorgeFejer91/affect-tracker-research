param(
    [Parameter(Mandatory)][string]$PlayerSetupUrl,
    [Parameter(Mandatory)][string]$PlayerSetupPath,
    [Parameter(Mandatory)][string]$PlayerStagePath,
    [Parameter(Mandatory)][string]$PlayerProvenancePath,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
if ($PlayerSetupUrl.Length -gt 512 -or
    $PlayerSetupUrl -cnotmatch '^https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~/-]+)+$') {
    throw 'A fixed HTTPS player setup URL without query or fragment is required.'
}
$setup = (Resolve-Path -LiteralPath $PlayerSetupPath).Path
$stage = (Resolve-Path -LiteralPath $PlayerStagePath).Path
$receipt = Get-Content -LiteralPath $PlayerProvenancePath -Raw | ConvertFrom-Json
if ($receipt.schema -cne 'flubber-vlc-player-package-provenance/v1' -or
    $receipt.setupFileName -cne [IO.Path]::GetFileName($setup) -or
    $receipt.setupByteLength -ne (Get-Item -LiteralPath $setup).Length) {
    throw 'Player setup does not match its package provenance.'
}
foreach ($name in @('setupSha256', 'manifestSha256', 'payloadManifestSha256')) {
    if ($receipt.$name -cnotmatch '^[0-9a-fA-F]{64}$') {
        throw "Player package provenance has an invalid $name."
    }
}
$actual = @{
    setupSha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
    manifestSha256 = (Get-FileHash -LiteralPath (Join-Path $stage 'manifest.json') -Algorithm SHA256).Hash
    payloadManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $stage 'payload-manifest.json') -Algorithm SHA256).Hash
}
foreach ($name in $actual.Keys) {
    if ($actual[$name] -cne $receipt.$name.ToUpperInvariant()) {
        throw "Player package provenance differs from $name."
    }
}
if ($ValidateOnly) { return }

if (& git -C $PSScriptRoot status --porcelain) {
    throw 'Commit Recorder source before producing an installer provenance receipt.'
}
$env:FLUBBERVLC_SETUP_URL = $PlayerSetupUrl
$env:FLUBBERVLC_SETUP_SHA256 = $actual.setupSha256
$env:FLUBBERVLC_MANIFEST_SHA256 = $actual.manifestSha256
$env:FLUBBERVLC_PAYLOAD_MANIFEST_SHA256 = $actual.payloadManifestSha256
Push-Location $PSScriptRoot
try {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Locked Recorder frontend install failed.' }
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Recorder NSIS build failed.' }
    $bundle = Join-Path $PSScriptRoot 'src-tauri\target\release\bundle\nsis'
    $installers = @(Get-ChildItem -LiteralPath $bundle -Filter '*-setup.exe' -File)
    if ($installers.Count -ne 1) { throw 'Expected exactly one Recorder NSIS installer.' }
    $commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Recorder source commit is unavailable.' }
    $metadata = [ordered]@{
        schema = 'flubber-recorder-package-provenance/v1'
        sourceCommit = $commit
        setupFileName = $installers[0].Name
        setupByteLength = $installers[0].Length
        setupSha256 = (Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256).Hash
        playerSetupUrl = $PlayerSetupUrl
        playerSetupSha256 = $actual.setupSha256
        playerManifestSha256 = $actual.manifestSha256
        playerPayloadManifestSha256 = $actual.payloadManifestSha256
        playerSourceCommit = $receipt.sourceCommit
        researchQualified = $false
    }
    $metadata | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $bundle 'recorder-package-provenance.json') -Encoding utf8
} finally {
    Pop-Location
}
