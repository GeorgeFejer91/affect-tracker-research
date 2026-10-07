param(
    [Parameter(Mandatory = $true)][string]$QtBin,
    [Parameter(Mandatory = $true)][string]$AppearanceJson,
    [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $PSScriptRoot '../build/panel-check'
}
$qt = (Resolve-Path -LiteralPath $QtBin).Path
$preset = (Resolve-Path -LiteralPath $AppearanceJson).Path
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$output = (Resolve-Path -LiteralPath $OutputDirectory).Path
$previousPath = $env:PATH
$previousPlatform = $env:QT_QPA_PLATFORM
try {
    $env:PATH = "$qt;$previousPath"
    $env:QT_QPA_PLATFORM = 'offscreen'
    $flags = & (Join-Path $qt 'pkg-config.exe') --cflags --libs Qt5Widgets Qt5Gui Qt5Core
    if ($LASTEXITCODE -ne 0) { throw 'Qt5 pkg-config failed.' }
    & (Join-Path $qt 'g++.exe') -std=c++11 -O1 "-I$PSScriptRoot" `
        (Join-Path $PSScriptRoot 'panel-check.cpp') ($flags -split ' ') `
        -o (Join-Path $output 'panel-check.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Panel check compilation failed.' }
    & (Join-Path $output 'panel-check.exe') $preset (Join-Path $output 'panel-check.png')
    if ($LASTEXITCODE -ne 0) { throw "Panel check failed with code $LASTEXITCODE." }
    Write-Output (Join-Path $output 'panel-check.png')
}
finally {
    $env:PATH = $previousPath
    $env:QT_QPA_PLATFORM = $previousPlatform
}
