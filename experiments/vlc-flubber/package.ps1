param([string]$VisualStudioDir)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$build = Join-Path $root 'build'
$package = Join-Path $build 'package'
$downloads = Join-Path $package 'downloads'
$unpacked = Join-Path $package 'unpacked'
$stage = Join-Path $package 'stage'
foreach ($path in @($downloads, $unpacked)) {
    New-Item -ItemType Directory -Force -Path $path | Out-Null
}
$rootAbsolute = (Resolve-Path -LiteralPath $root).Path
$stageAbsolute = [IO.Path]::GetFullPath($stage)
if (-not $stageAbsolute.StartsWith($rootAbsolute + [IO.Path]::DirectorySeparatorChar,
                                   [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package staging path escaped the project'
}
if (Test-Path -LiteralPath $stageAbsolute) {
    Remove-Item -LiteralPath $stageAbsolute -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stageAbsolute | Out-Null

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
$pythonZip = Get-PinnedZip `
    'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' `
    'python-3.12.10-embed-amd64.zip' `
    '4ACBED6DD1C744B0376E3B1CF57CE906F9DC9E95E68824584C8099A63025A3C3'

foreach ($item in @(@('vlc', $vlcZip), @('ffmpeg', $ffmpegZip), @('python', $pythonZip))) {
    $dest = Join-Path $unpacked $item[0]
    if (-not (Test-Path -LiteralPath $dest -PathType Container)) {
        Expand-Archive -LiteralPath $item[1] -DestinationPath $dest
    }
}
$vlcExe = Get-ChildItem -LiteralPath (Join-Path $unpacked 'vlc') -Filter vlc.exe -Recurse -File | Select-Object -First 1
$ffmpegExe = Get-ChildItem -LiteralPath (Join-Path $unpacked 'ffmpeg') -Filter ffmpeg.exe -Recurse -File | Select-Object -First 1
$ffprobeExe = Get-ChildItem -LiteralPath (Join-Path $unpacked 'ffmpeg') -Filter ffprobe.exe -Recurse -File | Select-Object -First 1
if (-not $vlcExe -or -not $ffmpegExe -or -not $ffprobeExe) {
    throw 'A pinned media archive has an unexpected layout'
}
if ($ffmpegExe.DirectoryName -ne $ffprobeExe.DirectoryName) {
    throw 'FFmpeg and FFprobe are not from one bundle'
}

if (-not $VisualStudioDir) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $VisualStudioDir = & $vswhere -latest -products '*' -property installationPath
}
if (-not $VisualStudioDir) { throw 'Visual Studio C toolchain was not found' }
& (Join-Path $root 'build.ps1') -VlcDir $vlcExe.DirectoryName -VisualStudioDir $VisualStudioDir
if ($LASTEXITCODE -ne 0) { throw 'Native VLC plugin build failed' }

foreach ($name in @('vlc', 'ffmpeg', 'python', 'app', 'recorder', 'plugins\video_filter', 'licenses', 'source')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage $name) | Out-Null
}
Copy-Item -Path (Join-Path $vlcExe.DirectoryName '*') -Destination (Join-Path $stage 'vlc') -Recurse -Force
Copy-Item -LiteralPath $ffmpegExe.FullName, $ffprobeExe.FullName -Destination (Join-Path $stage 'ffmpeg')
Copy-Item -Path (Join-Path $unpacked 'python\*') -Destination (Join-Path $stage 'python') -Force
Copy-Item -LiteralPath (Join-Path $root 'flubbercorder\app.py'),
    (Join-Path $root 'flubbercorder\index.html'),
    (Join-Path $root 'flubbercorder\app.css'),
    (Join-Path $root 'flubbercorder\app.js') -Destination (Join-Path $stage 'app')
Copy-Item -LiteralPath (Join-Path $root 'flubbercorder\vendor') -Destination (Join-Path $stage 'app\vendor') -Recurse
Copy-Item -Path (Join-Path $root 'flubbercorder\recorder-runtime\*') -Destination (Join-Path $stage 'recorder') -Force
Copy-Item -LiteralPath (Join-Path $root 'build\plugins\video_filter\libflubber_plugin.dll') `
    -Destination (Join-Path $stage 'plugins\video_filter')
Copy-Item -LiteralPath (Join-Path $root 'build\deps\liblsl-1.17.7-Win_amd64\bin\lsl.dll') `
    -Destination (Join-Path $stage 'lsl.dll')
Copy-Item -LiteralPath (Join-Path $root '..\..\LICENSE') -Destination (Join-Path $stage 'licenses\AFFECT-RESEARCH-LICENSE')
Copy-Item -LiteralPath (Join-Path $root 'flubbercorder\recorder-source') `
    -Destination (Join-Path $stage 'source\recorder') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'plugin.c'), (Join-Path $root 'build.ps1') `
    -Destination (Join-Path $stage 'source')
Copy-Item -LiteralPath (Join-Path $root 'flubbercorder\THIRD-PARTY.md') `
    -Destination (Join-Path $stage 'licenses')

$manifest = [ordered]@{}
foreach ($name in @('vlc\vlc.exe', 'ffmpeg\ffmpeg.exe', 'ffmpeg\ffprobe.exe',
                   'python\python.exe', 'recorder\respyrecorder.exe',
                   'plugins\video_filter\libflubber_plugin.dll', 'lsl.dll')) {
    $file = Join-Path $stage $name
    $manifest[$name] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8
Write-Output "Package staging ready: $stage"
