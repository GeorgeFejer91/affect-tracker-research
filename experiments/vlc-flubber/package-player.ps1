param([string]$VisualStudioDir, [switch]$CompileInstaller)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $VisualStudioDir) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
        throw 'Visual Studio C++ tools are required'
    }
    $VisualStudioDir = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $VisualStudioDir) { throw 'Visual Studio C++ tools were not found' }
}
$vcvars = Join-Path $VisualStudioDir 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path -LiteralPath $vcvars -PathType Leaf) -or $vcvars -match '[%&|<>^"\r\n]') {
    throw 'A usable Visual Studio x64 developer environment is required'
}
& cmd.exe /d /s /c ('call "' + $vcvars + '" >nul && set') | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
if ($LASTEXITCODE -ne 0) { throw 'Visual Studio x64 developer environment failed' }
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

& (Join-Path $root 'build.ps1') -VlcDir $vlcExe.DirectoryName -VisualStudioDir $VisualStudioDir
if ($LASTEXITCODE -ne 0) { throw 'Native VLC plugin build failed' }
$launcherManifest = Join-Path $root 'player-launcher\Cargo.toml'
& cargo build --manifest-path $launcherManifest --release --locked
if ($LASTEXITCODE -ne 0) { throw 'Rust player launcher build failed' }

if (Test-Path -LiteralPath $stageAbsolute) {
    if ((Get-Item -LiteralPath $stageAbsolute -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Package staging path cannot be a link'
    }
    Remove-Item -LiteralPath $stageAbsolute -Recurse -Force
}
foreach ($name in @('vlc', 'ffmpeg', 'plugins\video_filter', 'svg', 'licenses')) {
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
Copy-Item -LiteralPath (Join-Path $root 'licenses\LIBLSL-LICENSE') `
    -Destination (Join-Path $stageAbsolute 'licenses\LIBLSL-LICENSE')
Copy-Item -LiteralPath (Join-Path $root 'PLAYER-README.md') -Destination $stageAbsolute
Copy-Item -LiteralPath (Join-Path $root 'PLAYER-THIRD-PARTY.md') -Destination $stageAbsolute

$manifestWriter = Join-Path $root 'write-player-manifest.ps1'
& $manifestWriter -StagePath $stageAbsolute
if ($LASTEXITCODE -ne 0) { throw 'Player manifest generation failed' }
$manifestSha256 = (Get-FileHash -LiteralPath (Join-Path $stageAbsolute 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$payloadManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $stageAbsolute 'payload-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "Standalone player staging ready: $stageAbsolute"
Write-Output "Trusted manifest SHA256: $manifestSha256"
Write-Output "Trusted payload manifest SHA256: $payloadManifestSha256"

if ($CompileInstaller) {
    $iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
    if (-not $iscc) { throw 'Inno Setup ISCC.exe is required to compile the installer' }
    & $iscc (Join-Path $root 'installer-player.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Inno Setup player build failed' }
    $setup = Join-Path $package 'out\Flubber_VLC_Player_Setup_0.1.0_x64.exe'
    if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw 'Player setup output is missing' }
    $sourceCommit = (& git -C (Join-Path $root '..\..') rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') {
        throw 'Player package source commit could not be identified'
    }
    $setupFile = Get-Item -LiteralPath $setup
    $setupSha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
    $provenance = [ordered]@{
        schema = 'flubber-vlc-player-package-provenance/v1'
        sourceCommit = $sourceCommit
        setupFileName = $setupFile.Name
        setupByteLength = $setupFile.Length
        setupSha256 = $setupSha256
        manifestSha256 = $manifestSha256
        payloadManifestSha256 = $payloadManifestSha256
        researchQualified = $false
    }
    $provenancePath = Join-Path $package 'out\player-package-provenance.json'
    [IO.File]::WriteAllText($provenancePath, (($provenance | ConvertTo-Json -Depth 3) + "`n"), [Text.UTF8Encoding]::new($false))
    Write-Output "Player installer: $setup"
    Write-Output "Player installer SHA256: $setupSha256"
    Write-Output "Player package provenance: $provenancePath"
}
