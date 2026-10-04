param(
    [Parameter(Mandatory = $true)][string]$Video,
    [int]$PanelPercent = 25,
    [int]$StepPercent = 10,
    [string]$Csv = '',
    [switch]$Lsl,
    [switch]$Headless,
    [string]$VlcDir = 'C:\Program Files\VideoLAN\VLC'
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Video).Path
$sidecar = Join-Path (Split-Path -Parent $source) `
    (([IO.Path]::GetFileNameWithoutExtension($source)) + '.flubber.json')
if (Test-Path -LiteralPath $sidecar) {
    $settings = Get-Content -LiteralPath $sidecar -Raw | ConvertFrom-Json
    if ($settings.schema -ne 'vlc-flubber-sidequest/v1') { throw "Unsupported sidecar: $sidecar" }
    if (-not $PSBoundParameters.ContainsKey('PanelPercent') -and $null -ne $settings.panelPercent) {
        $PanelPercent = [int]$settings.panelPercent
    }
    if (-not $PSBoundParameters.ContainsKey('StepPercent') -and $null -ne $settings.stepPercent) {
        $StepPercent = [int]$settings.stepPercent
    }
    if (-not $PSBoundParameters.ContainsKey('Lsl') -and $null -ne $settings.lsl) {
        $Lsl = [bool]$settings.lsl
    }
    if (-not $PSBoundParameters.ContainsKey('Csv') -and $settings.csvPath) {
        $Csv = [string]$settings.csvPath
    }
}
if ($PanelPercent -lt 10 -or $PanelPercent -gt 100) { throw 'PanelPercent must be 10–100' }
if ($StepPercent -lt 1 -or $StepPercent -gt 100) { throw 'StepPercent must be 1–100' }

$vlc = Join-Path $VlcDir 'vlc.exe'
$pluginRoot = Join-Path $PSScriptRoot 'build\plugins'
$plugin = Join-Path $pluginRoot 'video_filter\libflubber_plugin.dll'
$lslDll = Join-Path $PSScriptRoot 'build\deps\liblsl-1.17.7-Win_amd64\bin\lsl.dll'
foreach ($file in @($vlc, $plugin)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Missing $file. Run build.ps1 first."
    }
}
if ($Lsl -and -not (Test-Path -LiteralPath $lslDll -PathType Leaf)) {
    throw "Optional LSL DLL is missing: $lslDll"
}
$ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$probeText = & $ffprobe -v error -select_streams v:0 `
    -show_entries stream=width,height,r_frame_rate -of json $source
if ($LASTEXITCODE -ne 0) { throw "ffprobe failed for $source" }
$stream = ($probeText | ConvertFrom-Json).streams | Select-Object -First 1
if (-not $stream) { throw 'Input has no video stream' }
$width = [int]$stream.width
$height = [int]$stream.height
$rateParts = [string]$stream.r_frame_rate -split '/'
$sourceFps = [double]$rateParts[0] / [double]$rateParts[1]
if ($width -lt 64 -or $height -lt 64 -or $sourceFps -le 0 -or $sourceFps -gt 120) {
    throw 'Prototype accepts video at least 64 × 64 and at most 120 fps'
}
$renderFps = [int][Math]::Max(60, [Math]::Ceiling($sourceFps))
$canvasWidth = [int]([Math]::Ceiling($width / 2.0) * 2)
$videoHeight = [int]([Math]::Ceiling($height / 2.0) * 2)
$panelHeight = [int]([Math]::Ceiling($videoHeight * $PanelPercent / 200.0) * 2)
$canvasHeight = $videoHeight + $panelHeight

$mediaDir = Join-Path $PSScriptRoot 'build\media'
$recordingDir = Join-Path $PSScriptRoot 'build\recordings'
New-Item -ItemType Directory -Force -Path $mediaDir, $recordingDir | Out-Null
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.Substring(0, 16).ToLowerInvariant()
$stem = [IO.Path]::GetFileNameWithoutExtension($source)
$converted = Join-Path $mediaDir "$stem-$sourceHash-p$PanelPercent-f$renderFps.mkv"
if (-not (Test-Path -LiteralPath $converted -PathType Leaf)) {
    $filter = "fps=${renderFps},pad=${canvasWidth}:${canvasHeight}:0:0:black"
    & $ffmpeg -hide_banner -loglevel error -i $source `
        -map 0:v:0 -map '0:a?' -map '0:s?' -map_metadata 0 -map_chapters 0 `
        -vf $filter -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p `
        -c:a copy -c:s copy -fps_mode cfr -y $converted
    if ($LASTEXITCODE -ne 0) { throw 'FFmpeg conversion failed' }
}
$convertedProbeText = & $ffprobe -v error -select_streams v:0 `
    -show_entries stream=width,height,r_frame_rate -of json $converted
if ($LASTEXITCODE -ne 0) { throw 'Converted video probe failed' }
$convertedStream = ($convertedProbeText | ConvertFrom-Json).streams | Select-Object -First 1
if ([int]$convertedStream.width -ne $canvasWidth -or
    [int]$convertedStream.height -ne $canvasHeight) {
    throw 'Converted video geometry does not match the Flubber ratio'
}

if (-not $Csv) {
    $Csv = Join-Path $recordingDir "$stem-$(Get-Date -Format yyyyMMdd-HHmmss).csv"
} elseif (-not [IO.Path]::IsPathRooted($Csv)) {
    $Csv = Join-Path (Split-Path -Parent $source) $Csv
}
$csvPath = [IO.Path]::GetFullPath($Csv)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $csvPath) | Out-Null

$arguments = @(
    '-I', 'dummy', '--no-one-instance', '--no-plugins-cache',
    '--vout=wingdi', '--avcodec-hw=none', '--video-filter=flubber',
    "--flubber-panel-percent=$PanelPercent",
    "--flubber-video-height=$videoHeight",
    "--flubber-step-percent=$StepPercent",
    "--flubber-render-fps=$renderFps",
    "--flubber-csv=`"$csvPath`"",
    '--key-nav-up=', '--key-nav-down=', '--key-nav-left=', '--key-nav-right=',
    '--no-video-title-show', '--no-osd', '--play-and-exit'
)
if ($Lsl) { $arguments += '--flubber-lsl' }
$arguments += "`"$converted`""

$oldPluginPath = $env:VLC_PLUGIN_PATH
$oldLslDll = $env:FLUBBER_LSL_DLL
$oldPath = $env:PATH
try {
    $env:VLC_PLUGIN_PATH = $pluginRoot
    $env:FLUBBER_LSL_DLL = if ($Lsl) { $lslDll } else { '' }
    $env:PATH = "$VlcDir;$oldPath"
    $launch = @{ FilePath = $vlc; ArgumentList = $arguments; PassThru = $true; Wait = $true }
    if ($Headless) { $launch.WindowStyle = 'Hidden' }
    $process = Start-Process @launch
    if ($process.ExitCode -ne 0) { throw "VLC exited with code $($process.ExitCode)" }
} finally {
    $env:VLC_PLUGIN_PATH = $oldPluginPath
    $env:FLUBBER_LSL_DLL = $oldLslDll
    $env:PATH = $oldPath
}
if (-not (Test-Path -LiteralPath $csvPath -PathType Leaf)) {
    throw 'VLC exited without a Flubber CSV; inspect plugin loading and input format'
}
$lastRow = Get-Content -LiteralPath $csvPath -Tail 1
if (-not $lastRow.StartsWith('video_end,')) { throw "CSV did not end cleanly: $csvPath" }
Write-Output "Padded video: $converted"
Write-Output "Affect CSV: $csvPath"
Write-Output "Layout: ${canvasWidth}×${videoHeight} video + ${panelHeight}px Flubber at ${renderFps} fps"
