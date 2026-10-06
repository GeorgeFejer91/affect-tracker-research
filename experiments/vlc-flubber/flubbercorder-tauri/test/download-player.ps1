$ErrorActionPreference = 'Stop'
$download = Join-Path $PSScriptRoot '..\src-tauri\windows\download-player.ps1'
$out = Join-Path ([IO.Path]::GetTempPath()) ("flubber-player-download-test-" + [Guid]::NewGuid() + '.exe')
$trusted = [Text.Encoding]::UTF8.GetBytes('trusted setup fixture')
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $expected = [BitConverter]::ToString($sha.ComputeHash($trusted)).Replace('-', '')
} finally {
    $sha.Dispose()
}

try {
    $global:mockResponse = $trusted
    function Invoke-WebRequest {
        param([string]$Uri, [string]$OutFile, [int]$TimeoutSec, [switch]$UseBasicParsing)
        [IO.File]::WriteAllBytes($OutFile, $global:mockResponse)
    }
    & $download -Url 'https://example.org/releases/player.exe' -ExpectedSha256 $expected -OutFile $out
    if (-not (Test-Path -LiteralPath $out -PathType Leaf)) { throw 'Trusted download is missing.' }
    Remove-Item -LiteralPath $out

    $global:mockResponse = [Text.Encoding]::UTF8.GetBytes('tampered setup fixture')
    $rejected = $false
    try { & $download -Url 'https://example.org/releases/player.exe' -ExpectedSha256 $expected -OutFile $out }
    catch { $rejected = $true }
    if (-not $rejected -or (Test-Path -LiteralPath $out)) { throw 'Tampered download was accepted or retained.' }

    function Invoke-WebRequest { throw 'Offline fixture' }
    $rejected = $false
    try { & $download -Url 'https://example.org/releases/player.exe' -ExpectedSha256 $expected -OutFile $out }
    catch { $rejected = $true }
    if (-not $rejected -or (Test-Path -LiteralPath $out)) { throw 'Offline download was accepted or retained.' }
} finally {
    Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue
}
