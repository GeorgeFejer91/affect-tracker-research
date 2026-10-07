param([Parameter(Mandatory = $true)][string]$SourceRoot)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $SourceRoot).Path
$here = Split-Path -Parent $PSCommandPath
$patch = Join-Path $here 'vlc-3.0.20-flubber.patch'
$header = Join-Path $here 'flubber_panel.hpp'
$bridgeHeader = Join-Path $here 'flubber_bridge.hpp'
$target = Join-Path $root 'modules/gui/qt/flubber_panel.hpp'
$bridgeTarget = Join-Path $root 'modules/gui/qt/flubber_bridge.hpp'
if (-not (Test-Path -LiteralPath (Join-Path $root 'modules/gui/qt/main_interface.cpp'))) {
    throw 'SourceRoot is not a VLC 3.0.20 source tree.'
}
& git -C $root apply --check $patch
if ($LASTEXITCODE -ne 0) { throw 'VLC Qt patch does not apply cleanly.' }
& git -C $root apply $patch
if ($LASTEXITCODE -ne 0) { throw 'VLC Qt patch failed.' }
Copy-Item -LiteralPath $header -Destination $target
Copy-Item -LiteralPath $bridgeHeader -Destination $bridgeTarget
Write-Output "Applied VLC Flubber Qt patch to $root"
