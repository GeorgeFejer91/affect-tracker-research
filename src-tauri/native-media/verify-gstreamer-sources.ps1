[CmdletBinding()]
param(
    [string] $DownloadDirectory,
    [switch] $CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($CheckOnly -ne [string]::IsNullOrWhiteSpace($DownloadDirectory)) {
    throw 'Use -CheckOnly or pass a new -DownloadDirectory.'
}

$pinPath = Join-Path $PSScriptRoot 'gstreamer-runtime-v1.json'
$pin = Get-Content -Raw -LiteralPath $pinPath | ConvertFrom-Json
$components = @('gstreamer', 'gst-plugins-base', 'gst-plugins-good', 'gst-plugins-bad', 'gst-plugins-ugly', 'gst-libav')
if ($pin.runtimeVersion -cne '1.28.6' -or $pin.target -cne 'msvc-x86_64' -or
    $pin.sourceEvidence.status -cne 'incomplete-not-for-distribution' -or
    $pin.sourceEvidence.distributionApproved -ne $false -or
    @($pin.sources).Count -ne $components.Count) {
    throw 'The GStreamer source pin is incompatible or falsely approved.'
}

for ($index = 0; $index -lt $components.Count; $index++) {
    $source = $pin.sources[$index]
    $component = $components[$index]
    $name = "$component-1.28.6.tar.xz"
    $url = "https://gstreamer.freedesktop.org/src/$component/$name"
    if ($source.component -cne $component -or $source.fileName -cne $name -or
        $source.url -cne $url -or [UInt64] $source.byteLength -eq 0 -or
        $source.sha256 -cnotmatch '^[0-9a-f]{64}$') {
        throw "Invalid pinned source identity: $component"
    }
}
if ($CheckOnly) {
    'Six GStreamer source identities are structurally pinned; archive bytes were not downloaded.'
    return
}

$destination = [IO.Path]::GetFullPath($DownloadDirectory)
if (Test-Path -LiteralPath $destination) { throw 'Source download directory must be new.' }
[void] (New-Item -ItemType Directory -Path $destination)
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$commit = (& git -C $repoRoot rev-parse --verify HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -cnotmatch '^[0-9a-f]{40}$' -or
    ($env:GITHUB_SHA -and $commit -cne $env:GITHUB_SHA) -or
    @(& git -C $repoRoot status --porcelain=v1).Count -ne 0) {
    throw 'Source verification requires a clean, exact Git checkout.'
}

$verified = foreach ($source in $pin.sources) {
    $path = Join-Path $destination $source.fileName
    Invoke-WebRequest -Uri $source.url -OutFile $path
    $size = [UInt64] (Get-Item -LiteralPath $path).Length
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($size -ne [UInt64] $source.byteLength -or $hash -cne $source.sha256) {
        throw "Source archive identity mismatch: $($source.component)"
    }
    $checksum = Invoke-WebRequest -Uri "$($source.url).sha256sum" -UseBasicParsing
    $published = [Text.Encoding]::UTF8.GetString($checksum.Content).Trim()
    if ($published -cne "$hash  $($source.fileName)") {
        throw "Published source checksum mismatch: $($source.component)"
    }
    [ordered]@{ component = $source.component; fileName = $source.fileName; byteLength = $size; sha256 = $hash; url = $source.url }
}

$receipt = [ordered]@{
    schema = 'affect-gstreamer-component-sources-v1'
    sourceCommit = $commit
    runtimePinSha256 = (Get-FileHash -LiteralPath $pinPath -Algorithm SHA256).Hash.ToLowerInvariant()
    sourceCount = $verified.Count
    archives = @($verified)
    redistributionApproved = $false
    claim = 'Six direct GStreamer component archives only; external dependency source and license closure remain open.'
}
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'source-receipt.json') -Encoding utf8
$receipt | ConvertTo-Json -Depth 5
