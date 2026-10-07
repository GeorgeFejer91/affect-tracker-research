$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot 'bridge')
try {
    & cargo build --release --locked
    if ($LASTEXITCODE -ne 0) { throw 'Flubber bridge build failed.' }
    Write-Output (Join-Path (Get-Location).Path 'target/release/flubber_bridge.dll')
}
finally { Pop-Location }
