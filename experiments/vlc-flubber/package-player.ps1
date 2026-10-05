param([string]$VisualStudioDir)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$build = Join-Path $root 'build'
$package = Join-Path $build 'player-package'
$stage = Join-Path $package 'stage'
$downloads = Join-Path $build 'package\downloads'
$unpacked = Join-Path $build 'package\unpacked'
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

function Get-PinnedZip([string]$url, [string]$name, [string]$sha256) {
    $path = Join-Path $downloads $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Invoke-WebRequest -Uri $url -OutFile $path
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $sha256) {
        throw "Pinned archive hash mismatch: $name"
    }
    return $path
}

$vlcZip = Get-PinnedZip `
    'https://download.videolan.org/pub/videolan/vlc/3.0.20/win64/vlc-3.0.20-win64.zip' `
    'vlc-3.0.20-win64.zip' `
    '75D946B166476191DF3D93783F7683B7A1A5176AAD105E1CD46D940C049F7CDC'
$ffmpegZip = Get-PinnedZip `
    'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip' `
    'ffmpeg-8.1.2-essentials_build.zip' `
    'DB580001CAA24AC104C8CB856CD113A87B0A443F7BDF47D8C12B1D740584A2EC'
foreach ($item in @(@('vlc', $vlcZip), @('ffmpeg', $ffmpegZip))) {
    $dest = Join-Path $unpacked $item[0]
    if (-not (Test-Path -LiteralPath $dest -PathType Container)) {
        Expand-Archive -LiteralPath $item[1] -DestinationPath $dest
    }
}
$vlcExe = Get-ChildItem -LiteralPath (Join-Path $unpacked 'vlc') -Filter vlc.exe -Recurse -File |
    Select-Object -First 1
$ffmpegExe = Get-ChildItem -LiteralPath (Join-Path $unpacked 'ffmpeg') -Filter ffmpeg.exe -Recurse -File |
    Select-Object -First 1
$ffprobeExe = Get-ChildItem -LiteralPath (Join-Path $unpacked 'ffmpeg') -Filter ffprobe.exe -Recurse -File |
    Select-Object -First 1
if (-not $vlcExe -or -not $ffmpegExe -or -not $ffprobeExe -or
    $ffmpegExe.DirectoryName -ne $ffprobeExe.DirectoryName) {
    throw 'A pinned media archive has an unexpected layout'
}

if ($VisualStudioDir) {
    & (Join-Path $root 'build.ps1') -VlcDir $vlcExe.DirectoryName -VisualStudioDir $VisualStudioDir
} else {
    & (Join-Path $root 'build.ps1') -VlcDir $vlcExe.DirectoryName
}
if ($LASTEXITCODE -ne 0) { throw 'Native VLC plugin build failed' }
$launcherManifest = Join-Path $root 'player-launcher\Cargo.toml'
& cargo build --manifest-path $launcherManifest --release --locked
if ($LASTEXITCODE -ne 0) { throw 'Rust player launcher build failed' }

if (Test-Path -LiteralPath $stageAbsolute) {
    Remove-Item -LiteralPath $stageAbsolute -Recurse -Force
}
foreach ($name in @('vlc', 'ffmpeg', 'plugins\video_filter', 'svg', 'licenses', 'source')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stageAbsolute $name) | Out-Null
}
Copy-Item -Path (Join-Path $vlcExe.DirectoryName '*') -Destination (Join-Path $stageAbsolute 'vlc') -Recurse -Force
Copy-Item -LiteralPath $ffmpegExe.FullName, $ffprobeExe.FullName -Destination (Join-Path $stageAbsolute 'ffmpeg')
Copy-Item -LiteralPath (Join-Path $ffmpegExe.Directory.Parent.FullName 'LICENSE'),
    (Join-Path $ffmpegExe.Directory.Parent.FullName 'README.txt') -Destination (Join-Path $stageAbsolute 'ffmpeg')
Copy-Item -LiteralPath (Join-Path $root 'player-launcher\target\release\flubber-vlc-player.exe') `
    -Destination (Join-Path $stageAbsolute 'FlubberVLC.exe')
Copy-Item -LiteralPath (Join-Path $root 'build\plugins\video_filter\libflubber_plugin.dll') `
    -Destination (Join-Path $stageAbsolute 'plugins\video_filter')
Copy-Item -LiteralPath (Join-Path $root 'build\svg\flubber_svg.dll') `
    -Destination (Join-Path $stageAbsolute 'svg')
Copy-Item -LiteralPath (Join-Path $root 'build\deps\liblsl-1.17.7-Win_amd64\bin\lsl.dll') `
    -Destination (Join-Path $stageAbsolute 'lsl.dll')
Copy-Item -LiteralPath (Join-Path $root '..\..\LICENSE') `
    -Destination (Join-Path $stageAbsolute 'licenses\AFFECT-RESEARCH-LICENSE')
Copy-Item -LiteralPath (Join-Path $root 'flubbercorder\recorder-source\LIBLSL-LICENSE') `
    -Destination (Join-Path $stageAbsolute 'licenses\LIBLSL-LICENSE')
Copy-Item -LiteralPath (Join-Path $root 'plugin.c'), (Join-Path $root 'build.ps1'),
    (Join-Path $root 'package-player.ps1') -Destination (Join-Path $stageAbsolute 'source')
foreach ($crate in @('svg-renderer', 'player-launcher')) {
    $destination = Join-Path $stageAbsolute "source\$crate"
    New-Item -ItemType Directory -Force -Path (Join-Path $destination 'src') | Out-Null
    Copy-Item -LiteralPath (Join-Path $root "$crate\Cargo.toml"),
        (Join-Path $root "$crate\Cargo.lock") -Destination $destination
    Get-ChildItem -LiteralPath (Join-Path $root "$crate\src") -File |
        Copy-Item -Destination (Join-Path $destination 'src')
}
Copy-Item -LiteralPath (Join-Path $root 'PLAYER-README.md') -Destination $stageAbsolute
Copy-Item -LiteralPath (Join-Path $root 'PLAYER-THIRD-PARTY.md') -Destination $stageAbsolute

$manifest = [ordered]@{}
foreach ($name in @('FlubberVLC.exe', 'vlc\vlc.exe', 'ffmpeg\ffmpeg.exe', 'ffmpeg\ffprobe.exe',
                   'plugins\video_filter\libflubber_plugin.dll', 'svg\flubber_svg.dll', 'lsl.dll')) {
    $manifest[$name] = (Get-FileHash -LiteralPath (Join-Path $stageAbsolute $name) -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $stageAbsolute 'manifest.json') -Encoding utf8
Write-Output "Standalone player staging ready: $stageAbsolute"
