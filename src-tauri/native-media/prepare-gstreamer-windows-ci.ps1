[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $DownloadDirectory,

    [Parameter(Mandatory = $true)]
    [string] $DevelopmentDestinationPath,

    [Parameter(Mandatory = $true)]
    [string] $GithubEnvironmentPath,

    [Parameter(Mandatory = $true)]
    [string] $GithubPathPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pinPath = Join-Path $PSScriptRoot 'gstreamer-runtime-v1.json'
$stagerPath = Join-Path $PSScriptRoot 'stage-gstreamer-runtime.ps1'
$pin = Get-Content -Raw -LiteralPath $pinPath | ConvertFrom-Json

if ($pin.schema -cne 'affect-research-native-media-runtime-pin' -or
    $pin.version -ne 2 -or
    $pin.backend -cne 'gstreamer-gstplay' -or
    $pin.api -cne 'gstplay' -or
    $pin.runtimeVersion -cne '1.28.6' -or
    $pin.bindingsSeries -cne '0.25' -or
    $pin.target -cne 'msvc-x86_64' -or
    $pin.installer.runtimeInstallType -cne 'runtime' -or
    $pin.installer.developmentInstallType -cne 'devel') {
    throw 'The checked-in GStreamer runtime pin is incompatible with the Windows CI preparer.'
}

$installerName = [string] $pin.installer.fileName
$installerUri = [Uri] ([string] $pin.installer.url)
$installerSha256 = [string] $pin.installer.sha256
$installerByteLength = [UInt64] $pin.installer.byteLength
if ($installerName -cne 'gstreamer-1.0-msvc-x86_64-1.28.6.exe' -or
    $installerUri.Scheme -cne 'https' -or
    $installerUri.Host -cne 'gstreamer.freedesktop.org' -or
    [IO.Path]::GetFileName($installerUri.AbsolutePath) -cne $installerName -or
    $installerSha256 -notmatch '^[0-9a-f]{64}$' -or
    $installerByteLength -eq 0) {
    throw 'The checked-in GStreamer installer identity is invalid.'
}

$resolvedDownloadDirectory = [IO.Path]::GetFullPath($DownloadDirectory)
$resolvedDevelopmentRoot = [IO.Path]::GetFullPath($DevelopmentDestinationPath)
if (Test-Path -LiteralPath $resolvedDevelopmentRoot) {
    throw 'The GStreamer development destination already exists; refusing to replace it.'
}
[void] (New-Item -ItemType Directory -Path $resolvedDownloadDirectory -Force)
$installerPath = Join-Path $resolvedDownloadDirectory $installerName
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    Invoke-WebRequest -Uri $installerUri.AbsoluteUri -OutFile $installerPath
}

$installer = Get-Item -LiteralPath $installerPath
if ([UInt64] $installer.Length -ne $installerByteLength -or
    (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $installerSha256) {
    throw 'The downloaded GStreamer installer does not match the checked-in byte length and SHA-256.'
}

$tauriRoot = Split-Path -Parent $PSScriptRoot
$runtimeDestination = Join-Path $tauriRoot ([string] $pin.runtimeTree.relativeRoot)
if (Test-Path -LiteralPath $runtimeDestination) {
    & $stagerPath -VerifyOnly -DestinationPath $runtimeDestination | Out-Null
}
else {
    & $stagerPath -InstallerPath $installer.FullName -DestinationPath $runtimeDestination | Out-Null
}

$developmentArguments = @(
    "/TYPE=$([string] $pin.installer.developmentInstallType)",
    '/CURRENTUSER',
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    '/NOICONS',
    "/DIR=`"$resolvedDevelopmentRoot`""
)
$developmentInstall = Start-Process -FilePath $installer.FullName -ArgumentList $developmentArguments -Wait -PassThru -WindowStyle Hidden
if ($developmentInstall.ExitCode -ne 0) {
    throw "The pinned GStreamer development install failed with exit code $($developmentInstall.ExitCode)."
}

$pkgConfig = Join-Path $resolvedDevelopmentRoot 'bin/pkg-config.exe'
$pkgConfigDirectory = Join-Path $resolvedDevelopmentRoot 'lib/pkgconfig'
$corePackage = Join-Path $pkgConfigDirectory 'gstreamer-1.0.pc'
$coreHeader = Join-Path $resolvedDevelopmentRoot 'include/gstreamer-1.0/gst/gst.h'
foreach ($required in @($pkgConfig, $corePackage, $coreHeader)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw 'The pinned GStreamer development install omitted a required build input.'
    }
}

$utf8 = [Text.UTF8Encoding]::new($false)
$environmentLines = @(
    "GSTREAMER_1_0_ROOT_MSVC_X86_64=$resolvedDevelopmentRoot",
    "PKG_CONFIG=$pkgConfig",
    "PKG_CONFIG_PATH=$pkgConfigDirectory"
) -join "`n"
[IO.File]::AppendAllText($GithubEnvironmentPath, "$environmentLines`n", $utf8)
[IO.File]::AppendAllText($GithubPathPath, "$(Join-Path $resolvedDevelopmentRoot 'bin')`n", $utf8)

[pscustomobject]@{
    InstallerPath = $installer.FullName
    InstallerSha256 = $installerSha256
    RuntimeDestination = $runtimeDestination
    DevelopmentDestination = $resolvedDevelopmentRoot
    RuntimeInstallType = [string] $pin.installer.runtimeInstallType
    DevelopmentInstallType = [string] $pin.installer.developmentInstallType
    Verified = $true
}
