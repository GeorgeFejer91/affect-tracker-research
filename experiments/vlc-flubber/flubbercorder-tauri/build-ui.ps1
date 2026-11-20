$ErrorActionPreference = 'Stop'
function Get-Sha256File($path) {
    $stream = [IO.File]::OpenRead($path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}
$root = $PSScriptRoot
$source = Join-Path $root '..\flubbercorder'
$web = Join-Path $root 'web'
$resources = Join-Path $root 'src-tauri\resources\recorder'
$demo = Join-Path $root 'src-tauri\resources\demo'
$player = Join-Path $root 'src-tauri\resources\player'
$phoneWeb = Join-Path $root 'src-tauri\resources\web'
$rootAbsolute = [IO.Path]::GetFullPath($root)
foreach ($target in @($web, $resources, $demo, $player, $phoneWeb)) {
    $absolute = [IO.Path]::GetFullPath($target)
    if (-not $absolute.StartsWith($rootAbsolute + [IO.Path]::DirectorySeparatorChar,
                                  [StringComparison]::OrdinalIgnoreCase)) {
        throw "Generated target escaped Flubbercorder: $absolute"
    }
    if (Test-Path -LiteralPath $absolute) {
        Remove-Item -LiteralPath $absolute -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $absolute | Out-Null
}
Copy-Item -LiteralPath (Join-Path $source 'index.html'),
    (Join-Path $source 'app.js'), (Join-Path $source 'app.css') -Destination $web
New-Item -ItemType Directory -Force -Path (Join-Path $web 'vendor') | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'vendor\pretext') -Destination (Join-Path $web 'vendor') -Recurse
Copy-Item -Path (Join-Path $web '*') -Destination $phoneWeb -Recurse
Copy-Item -Path (Join-Path $source 'recorder-runtime\*') -Destination $resources -Recurse
$playerSource = if ($env:FLUBBERCORDER_PLAYER_PACKAGE) {
    $env:FLUBBERCORDER_PLAYER_PACKAGE
} elseif (Test-Path -LiteralPath (Join-Path $root '..\build\stock-vlc-package\stage\manifest.json') -PathType Leaf) {
    Join-Path $root '..\build\stock-vlc-package\stage'
} else {
    Join-Path $root '..\build\player-package\stage'
}
$playerSource = [IO.Path]::GetFullPath($playerSource)
$manifest = Join-Path $playerSource 'manifest.json'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "Build the pinned VLC player package first: $playerSource"
}
$manifestObject = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$expected = if ($manifestObject.PSObject.Properties.Name -contains 'files') {
    if ($manifestObject.vlcVersion -ne '3.0.20' -or
        -not (Test-Path -LiteralPath (Join-Path $playerSource 'vlc.exe') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $playerSource 'flubber_bridge.dll') -PathType Leaf)) {
        throw 'Stock VLC Flubber package is incomplete or unexpected.'
    }
    $manifestObject.files
} else {
    $manifestObject
}
foreach ($entry in $expected.PSObject.Properties) {
    $part = Join-Path $playerSource $entry.Name
    if (-not (Test-Path -LiteralPath $part -PathType Leaf)) {
        throw "VLC player package is missing $($entry.Name)"
    }
    if ((Get-Sha256File $part) -ne $entry.Value) {
        throw "VLC player package hash mismatch: $($entry.Name)"
    }
}
Copy-Item -Path (Join-Path $playerSource '*') -Destination $player -Recurse
Copy-Item -LiteralPath (Join-Path $source 'demo\great-dictator.json') -Destination $demo
if ($env:FLUBBERCORDER_DEMO_VIDEO) {
    $clip = [IO.Path]::GetFullPath($env:FLUBBERCORDER_DEMO_VIDEO)
    if (-not (Test-Path -LiteralPath $clip -PathType Leaf) -or
        (Get-Item -LiteralPath $clip).Length -ne 86870779) {
        throw 'Great Dictator demo clip does not match the pinned local study file'
    }
    $hash = Get-Sha256File $clip
    if ($hash -ne 'B5327E7465EC92A4C93F3236A1EBAB4556CDF508E24EAFE6C593EAC1E13AFD49') {
        throw 'Great Dictator demo clip hash does not match the pinned local study file'
    }
    Copy-Item -LiteralPath $clip -Destination (Join-Path $demo 'dictator-3-study.mp4')
}
Write-Output "Tauri web and recorder resources ready: $web"
