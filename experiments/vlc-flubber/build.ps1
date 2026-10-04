param(
    [string]$VlcDir = 'C:\Program Files\VideoLAN\VLC',
    [string]$VisualStudioDir = 'C:\Program Files\Microsoft Visual Studio\2022\Community'
)

$ErrorActionPreference = 'Stop'
$vlcExe = Join-Path $VlcDir 'vlc.exe'
$vlcCore = Join-Path $VlcDir 'libvlccore.dll'
$vcvars = Join-Path $VisualStudioDir 'VC\Auxiliary\Build\vcvars64.bat'
foreach ($file in @($vlcExe, $vlcCore, $vcvars)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing prerequisite: $file" }
}
if (-not (Get-Item -LiteralPath $vlcExe).VersionInfo.FileVersion.StartsWith('3.0.20')) {
    throw 'This plugin is pinned to VLC 3.0.20 x64. Use that version or re-audit the ABI.'
}

$build = Join-Path $PSScriptRoot 'build'
$downloads = Join-Path $build 'downloads'
$deps = Join-Path $build 'deps'
$objects = Join-Path $build 'obj'
$plugins = Join-Path $build 'plugins'
$videoFilters = Join-Path $plugins 'video_filter'
foreach ($directory in @($downloads, $deps, $objects, $videoFilters)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

function Get-VerifiedArchive([string]$url, [string]$path, [string]$expectedSha256) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Invoke-WebRequest -Uri $url -OutFile $path
    }
    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expectedSha256) { throw "Archive hash mismatch: $path" }
}

$sourceArchive = Join-Path $downloads 'vlc-3.0.20.tar.xz'
Get-VerifiedArchive `
    'https://download.videolan.org/pub/videolan/vlc/3.0.20/vlc-3.0.20.tar.xz' `
    $sourceArchive `
    'adc7285b4d2721cddf40eb5270cada2aaa10a334cb546fd55a06353447ba29b5'
$source = Join-Path $deps 'vlc-3.0.20'
if (-not (Test-Path -LiteralPath (Join-Path $source 'include\vlc_plugin.h'))) {
    & tar.exe -xf $sourceArchive -C $deps
    if ($LASTEXITCODE -ne 0) { throw 'VLC source extraction failed' }
}

$lslArchive = Join-Path $downloads 'liblsl-1.17.7-Win_amd64.zip'
Get-VerifiedArchive `
    'https://github.com/sccn/liblsl/releases/download/v1.17.7/liblsl-1.17.7-Win_amd64.zip' `
    $lslArchive `
    '1285c4846f705108d417f5b7e57727f7e864941692d936fa18f8e7ab9b7112e1'
$lslRoot = Join-Path $deps 'liblsl-1.17.7-Win_amd64'
if (-not (Test-Path -LiteralPath (Join-Path $lslRoot 'include\lsl_c.h'))) {
    Expand-Archive -LiteralPath $lslArchive -DestinationPath $deps -Force
}

function Invoke-DeveloperCommand([string]$command) {
    foreach ($path in @($vcvars, $vlcCore, $objects, $videoFilters, $source, $lslRoot, $PSScriptRoot)) {
        if ($path -match '[%&|<>^"\r\n]') { throw "Unsupported command-shell character in path: $path" }
    }
    & cmd.exe /d /s /c ('call "' + $vcvars + '" >nul && ' + $command)
    if ($LASTEXITCODE -ne 0) { throw "Native build command failed with exit code $LASTEXITCODE" }
}

$exports = Join-Path $objects 'vlccore-exports.txt'
Invoke-DeveloperCommand ('dumpbin /exports "' + $vlcCore + '" > "' + $exports + '"')
$names = @(Get-Content -LiteralPath $exports | ForEach-Object {
    if ($_ -match '^\s*\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)') { $Matches[1] }
})
if ($names.Count -lt 500) { throw 'VLC exports were not parsed as expected' }
$definition = Join-Path $objects 'libvlccore.def'
@('LIBRARY libvlccore.dll', 'EXPORTS') + $names |
    Set-Content -LiteralPath $definition -Encoding ascii
$importLibrary = Join-Path $objects 'libvlccore.lib'
Invoke-DeveloperCommand ('lib /nologo /machine:x64 /def:"' + $definition + '" /out:"' + $importLibrary + '"')

$object = Join-Path $objects 'flubber.obj'
$plugin = Join-Path $videoFilters 'libflubber_plugin.dll'
$pluginImport = Join-Path $objects 'libflubber_plugin.lib'
$sourceFile = Join-Path $PSScriptRoot 'plugin.c'
$compile = 'cl /nologo /c /std:c11 /W1 /D__PLUGIN__ /DLSLNOAUTOLINK ' +
    '/DMODULE_STRING=\"flubber\" /DMODULE_NAME=flubber ' +
    '/I "' + (Join-Path $source 'include') + '" ' +
    '/I "' + (Join-Path $lslRoot 'include') + '" ' +
    '/Fo:"' + $object + '" "' + $sourceFile + '"'
Invoke-DeveloperCommand $compile
Invoke-DeveloperCommand ('link /nologo /DLL /IMPLIB:"' + $pluginImport +
    '" /OUT:"' + $plugin + '" "' +
    $object + '" "' + $importLibrary + '"')

Write-Output "Plugin: $plugin"
Write-Output "Plugin SHA256: $((Get-FileHash -LiteralPath $plugin -Algorithm SHA256).Hash)"
Write-Output "Optional LSL DLL: $(Join-Path $lslRoot 'bin\lsl.dll')"
