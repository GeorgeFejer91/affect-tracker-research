param([Parameter(Mandatory)][string]$StagePath)

$ErrorActionPreference = 'Stop'
$stage = (Resolve-Path -LiteralPath $StagePath).Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
$components = @(
    'FlubberVLC.exe',
    'vlc/vlc.exe',
    'ffmpeg/ffmpeg.exe',
    'ffmpeg/ffprobe.exe',
    'plugins/video_filter/libflubber_plugin.dll',
    'svg/flubber_svg.dll',
    'lsl.dll'
)

function Write-Manifest([string]$name, [string[]]$paths) {
    $entries = [ordered]@{}
    foreach ($relative in $paths) {
        $file = Join-Path $stage ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Player payload is missing $relative"
        }
        $entries[$relative] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $json = ($entries | ConvertTo-Json -Depth 3) + "`n"
    [IO.File]::WriteAllText((Join-Path $stage $name), $json, $utf8)
}

Write-Manifest 'manifest.json' $components
$allFiles = [string[]]@(Get-ChildItem -LiteralPath $stage -Recurse -File -Force | ForEach-Object {
    [IO.Path]::GetRelativePath($stage, $_.FullName).Replace('\', '/')
} | Where-Object { $_ -ne 'payload-manifest.json' })
[Array]::Sort($allFiles, [StringComparer]::Ordinal)
Write-Manifest 'payload-manifest.json' $allFiles
