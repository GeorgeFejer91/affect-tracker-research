[CmdletBinding(DefaultParameterSetName = 'Stage')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Stage')]
    [string] $InstallerPath,

    [Parameter(ParameterSetName = 'Stage')]
    [Parameter(ParameterSetName = 'Verify')]
    [string] $DestinationPath = (Join-Path $PSScriptRoot 'runtime/gstreamer-1.28.6/msvc-x86_64'),

    [Parameter(Mandatory = $true, ParameterSetName = 'Verify')]
    [switch] $VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pinPath = Join-Path $PSScriptRoot 'gstreamer-runtime-v1.json'
$noticePath = Join-Path $PSScriptRoot 'GSTREAMER-RUNTIME-NOTICE.txt'
$pin = Get-Content -Raw -LiteralPath $pinPath | ConvertFrom-Json
if ($pin.schema -cne 'affect-research-native-media-runtime-pin' -or
    $pin.version -ne 2 -or
    $pin.backend -cne 'gstreamer-gstplay' -or
    $pin.api -cne 'gstplay' -or
    $pin.runtimeVersion -cne '1.28.6' -or
    $pin.bindingsSeries -cne '0.25' -or
    $pin.target -cne 'msvc-x86_64' -or
    $pin.runtimeTree.manifestOrdering -cne 'ordinal-relative-path-v1' -or
    $pin.runtimeTree.requiredPeMachine -cne '0x8664' -or
    $pin.runtimeTree.requiredOptionalHeaderMagic -cne '0x020b' -or
    $pin.runtimeIsolation.ambientPluginsAllowed -ne $false -or
    $pin.runtimeIsolation.systemRuntimeAllowed -ne $false) {
    throw 'The checked-in GStreamer runtime pin is incompatible with this stager.'
}

$pinnedInstallerSha256 = [string] $pin.installer.sha256
$pinnedInstallerName = [string] $pin.installer.fileName
$hashManifestName = [string] $pin.runtimeTree.manifestFileName
$pinnedManifestSha256 = [string] $pin.runtimeTree.manifestSha256
$pinnedFileCount = [int] $pin.runtimeTree.fileCount
$pinnedByteLength = [UInt64] $pin.runtimeTree.byteLength
$maximumFiles = 10000
$maximumBytes = 1GB
$maximumDepth = 16
$requiredDirectories = @('bin', 'etc', 'lib', 'libexec', 'share')
$requiredPeFiles = @(
    'bin/gstreamer-1.0-0.dll',
    'bin/gstplay-1.0-0.dll',
    'bin/gstvideo-1.0-0.dll',
    'bin/gstpbutils-1.0-0.dll',
    'libexec/gstreamer-1.0/gst-plugin-scanner.exe',
    'lib/gstreamer-1.0/gstcoreelements.dll',
    'lib/gstreamer-1.0/gstplayback.dll',
    'lib/gstreamer-1.0/gstd3d11.dll',
    'lib/gstreamer-1.0/gstwasapi2.dll',
    'lib/gstreamer-1.0/gstlibav.dll'
)

function Get-NormalizedRelativePath {
    param(
        [Parameter(Mandatory = $true)] [string] $Root,
        [Parameter(Mandatory = $true)] [string] $Path
    )
    [IO.Path]::GetRelativePath($Root, $Path).Replace('\', '/')
}

function Assert-SafeRelativePath {
    param([Parameter(Mandatory = $true)] [string] $RelativePath)
    $parts = $RelativePath.Split('/')
    $reservedDevice = $parts | Where-Object {
        $stem = $_.Split('.')[0].ToUpperInvariant()
        $stem -in @('CON', 'PRN', 'AUX', 'NUL') -or $stem -match '^(COM|LPT)[1-9]$'
    }
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or
        $RelativePath.Length -gt 512 -or
        [IO.Path]::IsPathRooted($RelativePath) -or
        $RelativePath.Contains('\') -or
        $RelativePath.Contains(':') -or
        $parts -contains '' -or
        $parts -contains '.' -or
        $parts -contains '..' -or
        ($parts | Where-Object { $_.EndsWith(' ') -or $_.EndsWith('.') }) -or
        $reservedDevice) {
        throw 'Unsafe relative path in GStreamer runtime package.'
    }
}

function Assert-OrdinaryFilesystemItem {
    param([Parameter(Mandatory = $true)] [IO.FileSystemInfo] $Item)
    if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $Item.LinkType) {
        throw 'Links and reparse points are forbidden in the staged runtime.'
    }
}

function Get-OrdinaryRuntimeFiles {
    param([Parameter(Mandatory = $true)] [string] $RuntimeRoot)
    $rootItem = Get-Item -LiteralPath $RuntimeRoot -Force
    Assert-OrdinaryFilesystemItem -Item $rootItem
    if (-not $rootItem.PSIsContainer) { throw 'The staged runtime root is not an ordinary directory.' }
    $pending = [Collections.Generic.Stack[object]]::new()
    $pending.Push([pscustomobject]@{ Path = $rootItem.FullName; Depth = 0 })
    $files = [Collections.Generic.List[IO.FileInfo]]::new()
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        foreach ($item in @(Get-ChildItem -LiteralPath $current.Path -Force)) {
            Assert-OrdinaryFilesystemItem -Item $item
            if ($item.PSIsContainer) {
                $nextDepth = [int] $current.Depth + 1
                if ($nextDepth -gt $maximumDepth) { throw 'The staged runtime exceeds the supported folder depth.' }
                $pending.Push([pscustomobject]@{ Path = $item.FullName; Depth = $nextDepth })
            }
            elseif ($item -is [IO.FileInfo]) {
                if ($files.Count -ge $maximumFiles) { throw 'The staged runtime contains too many files.' }
                $files.Add($item)
            }
            else { throw 'The staged runtime contains an unsupported filesystem item.' }
        }
    }
    $files.ToArray()
}

function Assert-PeX64 {
    param([Parameter(Mandatory = $true)] [string] $Path)
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -lt 64) { throw 'A required GStreamer file is not a valid PE image.' }
        $reader = [IO.BinaryReader]::new($stream, [Text.Encoding]::ASCII, $true)
        try {
            if ($reader.ReadByte() -ne 0x4d -or $reader.ReadByte() -ne 0x5a) { throw 'A required GStreamer file has no PE header.' }
            $stream.Position = 0x3c
            [UInt64] $peOffset = $reader.ReadUInt32()
            if ($peOffset -lt 64 -or $peOffset + 26 -gt [UInt64] $stream.Length) { throw 'A required GStreamer file has an invalid PE offset.' }
            $stream.Position = [Int64] $peOffset
            if ($reader.ReadUInt32() -ne 0x00004550) { throw 'A required GStreamer file has an invalid PE signature.' }
            $machine = $reader.ReadUInt16()
            $stream.Position = [Int64] ($peOffset + 20)
            $optionalHeaderBytes = $reader.ReadUInt16()
            if ($optionalHeaderBytes -lt 2) { throw 'A required GStreamer file has an invalid optional header.' }
            $stream.Position = [Int64] ($peOffset + 24)
            $optionalMagic = $reader.ReadUInt16()
            if ($machine -ne 0x8664 -or $optionalMagic -ne 0x020b) { throw 'A required GStreamer file is not x64 PE32+.' }
        }
        finally { $reader.Dispose() }
    }
    finally { $stream.Dispose() }
}

function Test-StagedRuntime {
    param([Parameter(Mandatory = $true)] [string] $RuntimeRoot)
    $rootItem = Get-Item -LiteralPath $RuntimeRoot -Force
    Assert-OrdinaryFilesystemItem -Item $rootItem
    if (-not $rootItem.PSIsContainer) { throw 'The staged runtime root is not an ordinary directory.' }
    $resolvedRoot = $rootItem.FullName
    $manifestPath = Join-Path $resolvedRoot $hashManifestName
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'The staged runtime hash manifest is missing.' }
    $observedManifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($observedManifestHash -cne $pinnedManifestSha256) { throw 'The staged runtime tree identity does not match the checked-in pin.' }
    $expected = @{}
    foreach ($line in [IO.File]::ReadAllLines($manifestPath, [Text.Encoding]::UTF8)) {
        if ($line.Length -eq 0) { continue }
        if ($line -notmatch '^([0-9a-f]{64}) \*(.+)$') { throw 'The staged runtime hash manifest is malformed.' }
        $relative = $Matches[2]
        Assert-SafeRelativePath -RelativePath $relative
        $folded = $relative.ToLowerInvariant()
        if ($expected.ContainsKey($folded)) { throw 'The staged runtime manifest contains a duplicate path.' }
        $expected[$folded] = @{ Relative = $relative; Hash = $Matches[1] }
    }
    if ($expected.Count -ne $pinnedFileCount) { throw 'The staged runtime file count does not match the pin.' }
    foreach ($required in $requiredPeFiles + @('GSTREAMER-RUNTIME-NOTICE.txt')) {
        if (-not $expected.ContainsKey($required.ToLowerInvariant())) { throw "The staged runtime is missing required file $required." }
    }
    $files = @(Get-OrdinaryRuntimeFiles -RuntimeRoot $resolvedRoot | Where-Object { $_.FullName -ne $manifestPath })
    if ($files.Count -ne $expected.Count) { throw 'The staged runtime has missing or unexpected files.' }
    [UInt64] $totalBytes = 0
    foreach ($file in $files) {
        $relative = Get-NormalizedRelativePath -Root $resolvedRoot -Path $file.FullName
        Assert-SafeRelativePath -RelativePath $relative
        $folded = $relative.ToLowerInvariant()
        if (-not $expected.ContainsKey($folded) -or $expected[$folded].Relative -cne $relative) { throw 'The staged runtime has an unexpected file.' }
        if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected[$folded].Hash) { throw 'A staged runtime file failed SHA-256 verification.' }
        $totalBytes += [UInt64] $file.Length
        if ($totalBytes -gt $maximumBytes) { throw 'The staged runtime exceeds the one-gigabyte safety bound.' }
    }
    if ($totalBytes -ne $pinnedByteLength) { throw 'The staged runtime byte length does not match the pin.' }
    foreach ($required in $requiredPeFiles) { Assert-PeX64 -Path (Join-Path $resolvedRoot $required) }
    [pscustomobject]@{ RuntimeVersion = '1.28.6'; Target = 'msvc-x86_64'; FileCount = $files.Count; ByteLength = $totalBytes; Verified = $true }
}

if ($VerifyOnly) {
    Test-StagedRuntime -RuntimeRoot $DestinationPath
    return
}

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf)) { throw 'The pinned GStreamer installer is unavailable.' }
if ([IO.Path]::GetFileName($resolvedInstaller) -cne $pinnedInstallerName) { throw 'The installer filename does not match the pin.' }
if ((Get-FileHash -LiteralPath $resolvedInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pinnedInstallerSha256) { throw 'The GStreamer installer SHA-256 does not match the pin.' }
if (Test-Path -LiteralPath $DestinationPath) { throw 'The native-media destination already exists; refusing to replace it.' }
if (-not (Test-Path -LiteralPath $noticePath -PathType Leaf)) { throw 'The checked-in GStreamer runtime notice is missing.' }

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("affect-research-gstreamer-" + [Guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $temporaryRoot 'installed-runtime'
[void] (New-Item -ItemType Directory -Path $temporaryRoot)
try {
    $arguments = @('/TYPE=runtime', '/CURRENTUSER', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS', "/DIR=`"$installRoot`"")
    $process = Start-Process -FilePath $resolvedInstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "The pinned GStreamer installer failed with exit code $($process.ExitCode)." }
    foreach ($directory in $requiredDirectories) {
        if (-not (Test-Path -LiteralPath (Join-Path $installRoot $directory) -PathType Container)) { throw "The installer omitted required directory $directory." }
    }
    $stagingRoot = Join-Path $temporaryRoot 'staged-runtime'
    [void] (New-Item -ItemType Directory -Path $stagingRoot)
    foreach ($directory in $requiredDirectories) {
        Copy-Item -LiteralPath (Join-Path $installRoot $directory) -Destination $stagingRoot -Recurse
    }
    Copy-Item -LiteralPath $noticePath -Destination $stagingRoot
    $runtimeFiles = @(Get-OrdinaryRuntimeFiles -RuntimeRoot $stagingRoot)
    $manifestEntries = [Collections.Generic.SortedDictionary[string, string]]::new([StringComparer]::Ordinal)
    $caseFoldedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $runtimeFiles) {
        $relative = Get-NormalizedRelativePath -Root $stagingRoot -Path $file.FullName
        Assert-SafeRelativePath -RelativePath $relative
        if (-not $caseFoldedPaths.Add($relative)) { throw 'The staged runtime contains a case-colliding path.' }
        $manifestEntries.Add($relative, (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant())
    }
    $lines = foreach ($entry in $manifestEntries.GetEnumerator()) { "$($entry.Value) *$($entry.Key)" }
    [IO.File]::WriteAllText((Join-Path $stagingRoot $hashManifestName), (($lines -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
    Test-StagedRuntime -RuntimeRoot $stagingRoot | Out-Null
    $destinationParent = Split-Path -Parent $DestinationPath
    [void] (New-Item -ItemType Directory -Path $destinationParent -Force)
    Move-Item -LiteralPath $stagingRoot -Destination $DestinationPath
    Test-StagedRuntime -RuntimeRoot $DestinationPath
}
finally {
    $uninstaller = Join-Path $installRoot 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait -PassThru -WindowStyle Hidden
        if ($uninstall.ExitCode -ne 0) { Write-Warning "The temporary GStreamer uninstaller returned $($uninstall.ExitCode)." }
    }
    $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
    $resolvedSystemTemporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedTemporaryRoot.StartsWith($resolvedSystemTemporary, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemporaryRoot)) {
        Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
    }
}
