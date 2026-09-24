$repositoryRoot = Split-Path -Parent $PSScriptRoot
$siteUrl = "http://127.0.0.1:8000/"

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

$appUrl = "${siteUrl}planner/"
$browser = @(
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $browser) {
  throw "A Chromium browser is required to open the Experiment Planner app window."
}

$profile = "$env:LOCALAPPDATA\AffectTracker\planner-browser"
Start-Process -FilePath $browser -ArgumentList @("--user-data-dir=$profile", "--app=$appUrl")
