param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("classic", "ledger")]
  [string]$Interface
)

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$siteUrl = "http://127.0.0.1:8000/"
$plannerPath = if ($Interface -eq "ledger") { "planner-ledger/" } else { "planner/" }

function Test-AffectTrackerSite {
  try {
    $response = Invoke-WebRequest -Uri $siteUrl -TimeoutSec 1 -UseBasicParsing
    return $response.StatusCode -eq 200 -and $response.Content.Contains("<title>Affect Tracker</title>")
  } catch {
    return $false
  }
}

if (-not (Test-AffectTrackerSite)) {
  Start-Process -FilePath "pnpm.cmd" -ArgumentList @("serve") -WorkingDirectory $repositoryRoot -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 40 -and -not (Test-AffectTrackerSite); $attempt += 1) {
    Start-Sleep -Milliseconds 250
  }
}

if (-not (Test-AffectTrackerSite)) {
  throw "Affect Tracker could not start at $siteUrl. Check whether port 8000 is already in use."
}

Start-Process "$siteUrl$plannerPath"
