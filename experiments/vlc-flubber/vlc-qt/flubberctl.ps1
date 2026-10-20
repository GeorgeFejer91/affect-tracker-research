param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
    [Parameter(Mandatory = $true)][string]$Command
)

$ErrorActionPreference = 'Stop'
if ($Command -match '[\r\n]' -or $Command -notmatch '^(primary (flubber|grid|face)|input (arrows|mouse)|visible (flubber|grid|face) (on|off)|face photo-(reference-v3|synthetic-0[1-8])|load .+)$') {
    throw 'Use primary flubber|grid|face, input arrows|mouse, visible flubber|grid|face on|off, face <preset>, or load <JSON path>.'
}

$client = [Net.Sockets.TcpClient]::new()
try {
    if (-not $client.ConnectAsync('127.0.0.1', $Port).Wait(3000)) {
        throw "VLC RC did not accept a connection on loopback port $Port."
    }
    $stream = $client.GetStream()
    $bytes = [Text.Encoding]::UTF8.GetBytes("flubber $Command`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    Write-Output "Sent to VLC on port $Port`: flubber $Command"
}
finally {
    $client.Dispose()
}
