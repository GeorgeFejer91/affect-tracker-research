param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$QtPluginPath,
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$BridgeDllPath,
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })]
    [string]$MinGwBin
)

$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$build = Join-Path $project 'build'
$downloads = Join-Path $build 'package\downloads'
$unpacked = Join-Path $build 'package\unpacked\vlc'
$stage = Join-Path $build 'stock-vlc-package\stage'
$source = Join-Path $project 'vlc-qt'
$archive = Join-Path $downloads 'vlc-3.0.20-win64.zip'
$archiveHash = '75D946B166476191DF3D93783F7683B7A1A5176AAD105E1CD46D940C049F7CDC'

if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw 'The tracked VLC Qt integration source is missing.'
}

foreach ($directory in @($downloads, $unpacked)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
if (-not (Test-Path -LiteralPath $archive -PathType Leaf) -or
    (Get-Item -LiteralPath $archive).Length -ne 76999622) {
    & curl.exe --fail --location --retry 3 --continue-at - --silent --show-error `
        --output $archive `
        'https://download.videolan.org/pub/videolan/vlc/3.0.20/win64/vlc-3.0.20-win64.zip'
    if ($LASTEXITCODE -ne 0) { throw 'Pinned VLC archive download failed.' }
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $archiveHash) {
    throw 'Pinned VLC archive hash mismatch.'
}

$vlc = Join-Path $unpacked 'vlc-3.0.20'
if (-not (Test-Path -LiteralPath (Join-Path $vlc 'vlc.exe') -PathType Leaf)) {
    & tar.exe -xf $archive -C $unpacked
    if ($LASTEXITCODE -ne 0) { throw 'Pinned VLC archive extraction failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $vlc 'plugins\gui\libqt_plugin.dll') -PathType Leaf)) {
    throw 'Pinned VLC archive has an unexpected Qt layout.'
}
$stockPluginHash = (Get-FileHash -LiteralPath (Join-Path $vlc 'plugins\gui\libqt_plugin.dll') -Algorithm SHA256).Hash
$stockExeHash = (Get-FileHash -LiteralPath (Join-Path $vlc 'vlc.exe') -Algorithm SHA256).Hash
if ($stockPluginHash -ne 'A0FC9A46EE42A8A98F5455E727E9C9006F0354454D8F6CF39FFD86053E5AD6A4' -or
    $stockExeHash -ne '6A72CC8649A63B017844C4C1F3885A250D1A982FFE5F1E58B6F1432FE9198E62') {
    throw 'Extracted VLC files do not match the pinned archive.'
}
$modifiedPluginHash = (Get-FileHash -LiteralPath $QtPluginPath -Algorithm SHA256).Hash
if ($modifiedPluginHash -eq $stockPluginHash) {
    throw 'The supplied Qt plugin is identical to stock VLC and has no Flubber integration.'
}

# The package is deliberately a complete official VLC tree with only its Qt UI
# plugin replaced. This retains VLC's executable, modules, menus, and commands.
$expectedStage = [IO.Path]::GetFullPath((Join-Path $project 'build\stock-vlc-package\stage'))
$stage = [IO.Path]::GetFullPath($stage)
$buildRoot = [IO.Path]::GetFullPath($build)
if ($stage -ne $expectedStage -or
    -not $stage.StartsWith($buildRoot + [IO.Path]::DirectorySeparatorChar,
                           [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package staging path escaped the side project.'
}
if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -Path (Join-Path $vlc '*') -Destination $stage -Recurse -Force

$plugin = Join-Path $stage 'plugins\gui\libqt_plugin.dll'
Copy-Item -LiteralPath $QtPluginPath -Destination $plugin -Force
$bridge = Join-Path $stage 'flubber_bridge.dll'
Copy-Item -LiteralPath $BridgeDllPath -Destination $bridge -Force

# The MSYS2 Qt 5 build is dynamic. Deploy its Windows platform plugin and the
# exact transitive MinGW DLL imports used by the modified Qt module.
$objdump = Join-Path $MinGwBin 'objdump.exe'
$qwindows = Join-Path $MinGwBin '..\share\qt5\plugins\platforms\qwindows.dll'
$vistaStyle = Join-Path $MinGwBin '..\share\qt5\plugins\styles\qwindowsvistastyle.dll'
if (-not (Test-Path -LiteralPath $objdump -PathType Leaf) -or
    -not (Test-Path -LiteralPath $qwindows -PathType Leaf) -or
    -not (Test-Path -LiteralPath $vistaStyle -PathType Leaf)) {
    throw 'MinGW objdump or Qt Windows plugins are missing.'
}
$platform = Join-Path $stage 'qt5\plugins\platforms\qwindows.dll'
$style = Join-Path $stage 'qt5\plugins\styles\qwindowsvistastyle.dll'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $platform) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $style) | Out-Null
Copy-Item -LiteralPath $qwindows -Destination $platform
Copy-Item -LiteralPath $vistaStyle -Destination $style
@('[Paths]', 'Plugins=qt5/plugins') |
    Set-Content -LiteralPath (Join-Path $stage 'qt.conf') -Encoding ascii
$queue = [Collections.Generic.Queue[string]]::new()
foreach ($binary in @($plugin, $bridge, $platform, $style)) { $queue.Enqueue($binary) }
$visited = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$runtimeDlls = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
while ($queue.Count -gt 0) {
    $binary = $queue.Dequeue()
    if (-not $visited.Add($binary)) { continue }
    foreach ($line in (& $objdump -p $binary)) {
        if ($line -notmatch '^\s*DLL Name:\s*(\S+)') { continue }
        $dllName = $Matches[1]
        $bundled = Join-Path $stage $dllName
        $fromMinGw = Join-Path $MinGwBin $dllName
        if (Test-Path -LiteralPath $bundled -PathType Leaf) {
            $queue.Enqueue($bundled)
        } elseif (Test-Path -LiteralPath $fromMinGw -PathType Leaf) {
            Copy-Item -LiteralPath $fromMinGw -Destination $bundled
            $runtimeDlls.Add($dllName) | Out-Null
            $queue.Enqueue($bundled)
        }
    }
}

# VLC's plugin cache embeds module metadata and must match the replacement DLL.
$cachegen = Join-Path $stage 'vlc-cache-gen.exe'
& $cachegen (Join-Path $stage 'plugins')
if ($LASTEXITCODE -ne 0) { throw 'VLC plugin cache generation failed.' }

$sourceDestination = Join-Path $stage 'source\vlc-qt'
New-Item -ItemType Directory -Force -Path $sourceDestination | Out-Null
$repository = (& git -C $project rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Git repository unavailable for source packaging.' }
$sourcePrefix = 'experiments/vlc-flubber/vlc-qt/'
$trackedFiles = @(& git -C $repository ls-files -- 'experiments/vlc-flubber/vlc-qt')
if ($LASTEXITCODE -ne 0 -or $trackedFiles.Count -eq 0) {
    throw 'No tracked VLC Qt integration source is available for packaging.'
}
foreach ($trackedFile in $trackedFiles) {
    if (-not $trackedFile.StartsWith($sourcePrefix, [StringComparison]::Ordinal)) {
        throw "Unexpected source path: $trackedFile"
    }
    $relative = $trackedFile.Substring($sourcePrefix.Length)
    $destination = Join-Path $sourceDestination $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repository $trackedFile) -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $project 'package-stock-vlc.ps1'),
    (Join-Path $project 'STOCK-VLC-INTEGRATION.md') -Destination (Join-Path $stage 'source')
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'licenses') | Out-Null
Copy-Item -LiteralPath (Join-Path $project '..\..\LICENSE') `
    -Destination (Join-Path $stage 'licenses\AFFECT-RESEARCH-LICENSE')

$manifest = [ordered]@{
    vlcVersion = '3.0.20'
    officialArchiveSha256 = $archiveHash
    stockQtPluginSha256 = $stockPluginHash
    files = [ordered]@{}
}
foreach ($name in @('vlc.exe', 'libvlc.dll', 'libvlccore.dll',
                   'plugins\gui\libqt_plugin.dll', 'plugins\plugins.dat',
                   'flubber_bridge.dll', 'qt.conf',
                   'qt5\plugins\platforms\qwindows.dll',
                   'qt5\plugins\styles\qwindowsvistastyle.dll') + @($runtimeDlls | Sort-Object)) {
    $path = Join-Path $stage $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Expected package file is missing: $name"
    }
    $manifest.files[$name] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8

Write-Output "Stock VLC Flubber candidate staged: $stage"
