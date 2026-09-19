param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('all-features', 'no-default-features')]
  [string]$FeatureSet,
  [string]$TestFilter
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$cargoManifest = Join-Path $repositoryRoot 'native\Cargo.toml'
$activationManifest = Join-Path $repositoryRoot 'native\windows-common-controls.manifest'
$cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue
$cargo = if ($cargoCommand) {
  $cargoCommand.Source
} else {
  Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
}
if (-not (Test-Path -LiteralPath $cargo)) {
  throw 'Cargo is unavailable.'
}

$manifestToolCommand = Get-Command mt.exe -ErrorAction SilentlyContinue
$manifestTool = if ($manifestToolCommand) {
  $manifestToolCommand.Source
} else {
  Get-ChildItem (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin') `
    -Filter mt.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object FullName -Match '\\x64\\mt\.exe$' |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $manifestTool -or -not (Test-Path -LiteralPath $manifestTool)) {
  throw 'The Windows SDK manifest tool (mt.exe) is unavailable.'
}

$arguments = @(
  'test',
  '--locked',
  '--manifest-path', $cargoManifest,
  "--$FeatureSet",
  '--no-run',
  '--message-format=json-render-diagnostics',
  '--lib',
  '--test', 'planner_cli_io',
  '--test', 'research_form_definition',
  '--test', 'research_local_questionnaire_presets',
  '--test', 'research_planner_recipe_v2',
  '--test', 'runner_typed_answers'
)
$messages = @(& $cargo @arguments)
if ($LASTEXITCODE -ne 0) {
  throw "Cargo failed to compile the $FeatureSet native tests."
}

$executables = @(
  $messages |
    ForEach-Object {
      try {
        $message = $_ | ConvertFrom-Json -ErrorAction Stop
      } catch {
        $message = $null
      }

      if (
        $message -and
        $message.reason -eq 'compiler-artifact' -and
        $message.executable -and
        $message.profile.test -and
        (
          ($message.target.kind -contains 'lib') -or
          ($message.target.kind -contains 'test')
        )
      ) {
        $message.executable
      }
    } |
    Sort-Object -Unique
)
if ($executables.Count -ne 6) {
  throw "Expected six native test executables, found $($executables.Count)."
}

$systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$preparedRoot = Join-Path $systemTemp "affect-native-tests-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $preparedRoot | Out-Null

try {
  foreach ($executable in $executables) {
    $backup = Join-Path $preparedRoot (Split-Path $executable -Leaf)
    Copy-Item -LiteralPath $executable -Destination $backup
    try {
      & $manifestTool -nologo -manifest $activationManifest "-outputresource:$executable;#1"
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to embed the test activation manifest in $executable."
      }

      Write-Host "Running $(Split-Path $executable -Leaf) ($FeatureSet)"
      if ($TestFilter) {
        & $executable $TestFilter '--test-threads=1'
      } else {
        & $executable '--test-threads=1'
      }
      if ($LASTEXITCODE -ne 0) {
        throw "Native test executable failed: $executable"
      }
    } finally {
      Copy-Item -LiteralPath $backup -Destination $executable -Force
    }
  }
} finally {
  if (Test-Path -LiteralPath $preparedRoot) {
    $resolvedPreparedRoot = (Resolve-Path -LiteralPath $preparedRoot).Path
    if (
      (Split-Path $resolvedPreparedRoot -Parent) -ne $systemTemp -or
      -not (Split-Path $resolvedPreparedRoot -Leaf).StartsWith('affect-native-tests-')
    ) {
      throw "Refusing to remove unexpected temporary path: $resolvedPreparedRoot"
    }
    Remove-Item -LiteralPath $resolvedPreparedRoot -Recurse -Force
  }
}
