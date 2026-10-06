$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$build = Join-Path $root 'build'
$package = Join-Path $build 'player-package'
$stage = Join-Path $package 'stage'
$downloads = Join-Path $build 'package\downloads'
$unpacked = Join-Path $build 'package\unpacked\vlc'
foreach ($path in @($package, $downloads, $unpacked)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}

$rootAbsolute = [IO.Path]::GetFullPath($root)
$stageAbsolute = [IO.Path]::GetFullPath($stage)
$expectedStage = [IO.Path]::GetFullPath((Join-Path $root 'build\player-package\stage'))
if ($stageAbsolute -ne $expectedStage -or
    -not $stageAbsolute.StartsWith($rootAbsolute + [IO.Path]::DirectorySeparatorChar,
                                   [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package staging path escaped the side project'
}

$vlcZip = Join-Path $downloads 'vlc-3.0.20-win64.zip'
if (-not (Test-Path -LiteralPath $vlcZip -PathType Leaf) -or
    (Get-Item -LiteralPath $vlcZip).Length -ne 76999622) {
    & curl.exe --fail --location --retry 3 --continue-at - --silent --show-error `
        --output $vlcZip `
        'https://download.videolan.org/pub/videolan/vlc/3.0.20/win64/vlc-3.0.20-win64.zip'
    if ($LASTEXITCODE -ne 0) { throw 'Pinned VLC archive download failed' }
}
if ((Get-FileHash -LiteralPath $vlcZip -Algorithm SHA256).Hash -ne
    '75D946B166476191DF3D93783F7683B7A1A5176AAD105E1CD46D940C049F7CDC') {
    throw 'Pinned VLC 3.0.20 archive hash mismatch'
}
if (-not (Test-Path -LiteralPath (Join-Path $unpacked 'vlc-3.0.20\libvlc.dll'))) {
    & tar.exe -xf $vlcZip -C $unpacked
    if ($LASTEXITCODE -ne 0) { throw 'Pinned VLC archive extraction failed' }
}
$vlc = Join-Path $unpacked 'vlc-3.0.20'
if (-not (Test-Path -LiteralPath (Join-Path $vlc 'vlc-cache-gen.exe'))) {
    throw 'Pinned VLC archive has an unexpected layout'
}

foreach ($crate in @('svg-renderer', 'libvlc-player')) {
    & cargo build --release --locked --manifest-path (Join-Path $root "$crate\Cargo.toml")
    if ($LASTEXITCODE -ne 0) { throw "Rust build failed: $crate" }
}

if (Test-Path -LiteralPath $stageAbsolute) {
    Remove-Item -LiteralPath $stageAbsolute -Recurse -Force
}
foreach ($name in @('vlc', 'svg', 'licenses', 'source\svg-renderer\src',
                   'source\libvlc-player\src')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stageAbsolute $name) | Out-Null
}
Copy-Item -Path (Join-Path $vlc '*') -Destination (Join-Path $stageAbsolute 'vlc') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'libvlc-player\target\release\flubber-libvlc-prototype.exe') `
    -Destination (Join-Path $stageAbsolute 'FlubberVLC.exe')
Copy-Item -LiteralPath (Join-Path $root 'svg-renderer\target\release\flubber_svg.dll') `
    -Destination (Join-Path $stageAbsolute 'svg\flubber_svg.dll')
Copy-Item -LiteralPath (Join-Path $root '..\..\LICENSE') `
    -Destination (Join-Path $stageAbsolute 'licenses\AFFECT-RESEARCH-LICENSE')
Copy-Item -LiteralPath (Join-Path $root 'package-player.ps1') `
    -Destination (Join-Path $stageAbsolute 'source\package-player.ps1')
foreach ($crate in @('svg-renderer', 'libvlc-player')) {
    $source = Join-Path $root $crate
    $destination = Join-Path $stageAbsolute "source\$crate"
    Copy-Item -LiteralPath (Join-Path $source 'Cargo.toml'),
        (Join-Path $source 'Cargo.lock') -Destination $destination
    Copy-Item -Path (Join-Path $source 'src\*') -Destination (Join-Path $destination 'src') -Recurse
}
Copy-Item -LiteralPath (Join-Path $root 'PLAYER-README.md'),
    (Join-Path $root 'PLAYER-THIRD-PARTY.md') -Destination $stageAbsolute

$manifest = [ordered]@{}
foreach ($name in @('FlubberVLC.exe', 'vlc\libvlc.dll', 'vlc\libvlccore.dll',
                   'svg\flubber_svg.dll')) {
    $manifest[$name] = (Get-FileHash -LiteralPath (Join-Path $stageAbsolute $name) -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 3 |
    Set-Content -LiteralPath (Join-Path $stageAbsolute 'manifest.json') -Encoding utf8
Write-Output "Standalone LibVLC player staging ready: $stageAbsolute"
