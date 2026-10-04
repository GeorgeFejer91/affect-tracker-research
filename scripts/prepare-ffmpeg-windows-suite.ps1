[CmdletBinding()]
param([Parameter(Mandatory)][string]$StageDirectory)
$ErrorActionPreference = 'Stop'

# Pin the archive bytes; the installed suite carries only the two tools P1 uses.
$archiveUrl = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'
$archiveSha256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
$stage = (Resolve-Path -LiteralPath $StageDirectory).Path
$destination = Join-Path $stage 'ffmpeg/bin'
if (Test-Path -LiteralPath $destination) { throw 'Use a new suite stage for FFmpeg tools.' }
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('affect-ffmpeg-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $archive = Join-Path $scratch 'ffmpeg.zip'
    $extracted = Join-Path $scratch 'extracted'
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archive
    $actualArchiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualArchiveSha256 -cne $archiveSha256) { throw 'Pinned FFmpeg archive hash mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $extracted
    $package = Join-Path $extracted 'ffmpeg-9.0.2-essentials_build'
    foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $package "bin/$name") -PathType Leaf)) {
            throw "Pinned FFmpeg archive is missing $name."
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $package 'LICENSE') -PathType Leaf)) {
        throw 'Pinned FFmpeg archive is missing its license.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $package 'README.txt') -PathType Leaf)) {
        throw 'Pinned FFmpeg archive is missing its build notes.'
    }
    New-Item -ItemType Directory -Path $destination | Out-Null
    Copy-Item -LiteralPath (Join-Path $package 'bin/ffmpeg.exe') -Destination $destination
    Copy-Item -LiteralPath (Join-Path $package 'bin/ffprobe.exe') -Destination $destination
    Copy-Item -LiteralPath (Join-Path $package 'LICENSE') -Destination (Join-Path $stage 'ffmpeg/LICENSE')
    Copy-Item -LiteralPath (Join-Path $package 'README.txt') -Destination (Join-Path $stage 'ffmpeg/README.txt')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../src-tauri/ffmpeg/SOURCE.txt') -Destination (Join-Path $stage 'ffmpeg/SOURCE.txt')
    foreach ($name in @('ffmpeg.exe', 'ffprobe.exe')) {
        $tool = Join-Path $destination $name
        $versionLines = @(& $tool -version)
        $toolExitCode = $LASTEXITCODE
        $firstLine = $versionLines[0]
        if ($toolExitCode -ne 0 -or $firstLine -notmatch '^ff(mpeg|probe) version 9\.0\.2') {
            throw "Pinned $name failed version check: $firstLine"
        }
    }
    [ordered]@{
        archiveSha256 = $archiveSha256
        ffmpegSha256 = (Get-FileHash -LiteralPath (Join-Path $destination 'ffmpeg.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
        ffprobeSha256 = (Get-FileHash -LiteralPath (Join-Path $destination 'ffprobe.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
        licenseSha256 = (Get-FileHash -LiteralPath (Join-Path $stage 'ffmpeg/LICENSE') -Algorithm SHA256).Hash.ToLowerInvariant()
        readmeSha256 = (Get-FileHash -LiteralPath (Join-Path $stage 'ffmpeg/README.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
        sourceNoticeSha256 = (Get-FileHash -LiteralPath (Join-Path $stage 'ffmpeg/SOURCE.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $stage 'ffmpeg/receipt.json') -Encoding utf8
} finally {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $scratchFull = [IO.Path]::GetFullPath($scratch)
    if (-not $scratchFull.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporary FFmpeg directory escaped the system temp directory.'
    }
    Remove-Item -LiteralPath $scratchFull -Recurse -Force
}
