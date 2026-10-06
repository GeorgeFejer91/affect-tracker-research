param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$ExpectedSha256,
    [Parameter(Mandatory)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
if ($Url -cnotmatch '^https://[A-Za-z0-9.-]+(?:/[A-Za-z0-9._~/-]+)+$' -or
    $ExpectedSha256 -cnotmatch '^[0-9a-fA-F]{64}$') {
    throw 'The player setup source is not a fixed HTTPS URL and SHA-256 pair.'
}

try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -TimeoutSec 180 -UseBasicParsing
    $sha = [Security.Cryptography.SHA256]::Create()
    $file = [IO.File]::OpenRead($OutFile)
    try {
        $actual = [BitConverter]::ToString($sha.ComputeHash($file)).Replace('-', '')
    } finally {
        $file.Dispose()
        $sha.Dispose()
    }
    if ($actual -cne $ExpectedSha256.ToUpperInvariant()) {
        throw 'Downloaded player setup SHA-256 does not match the trusted package.'
    }
} catch {
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    throw
}
