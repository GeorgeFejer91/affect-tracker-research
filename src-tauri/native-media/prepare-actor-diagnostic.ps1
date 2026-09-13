[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $TestExecutable,
    [Parameter(Mandatory)] [string] $ManifestTool,
    [Parameter(Mandatory)] [string] $OutputDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $TestExecutable).Path
$tool = (Resolve-Path -LiteralPath $ManifestTool).Path
$manifest = Join-Path $PSScriptRoot 'diagnostic-test.manifest'
if ([IO.Path]::GetFileName($source) -notmatch '^affect_research-[0-9a-f]+\.exe$' -or
    [IO.Path]::GetFileName($tool) -ine 'mt.exe') { throw 'Expected Cargo library test and Windows SDK manifest tool.' }
if (-not [IO.Path]::IsPathFullyQualified($OutputDirectory) -or (Test-Path -LiteralPath $OutputDirectory)) {
    throw 'Prepared diagnostic directory must be new and absolute.'
}
$null = New-Item -ItemType Directory -Path $OutputDirectory
$target = Join-Path $OutputDirectory ([IO.Path]::GetFileName($source))
Copy-Item -LiteralPath $source -Destination $target
& $tool -nologo -manifest $manifest "-outputresource:$target;#1"
if ($LASTEXITCODE -ne 0) { throw 'Test manifest embedding failed; original executable is unchanged.' }
& $tool -nologo "-inputresource:$target;#1" -validate_manifest
if ($LASTEXITCODE -ne 0) { throw 'Embedded test manifest validation failed.' }
[ordered]@{
    schema = 'affect-native-diagnostic-artifact-v1'
    originalExecutableSha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    preparedExecutableSha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    manifestSha256 = (Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant()
    manifestToolSha256 = (Get-FileHash -LiteralPath $tool -Algorithm SHA256).Hash.ToLowerInvariant()
    executable = $target
    mutation = 'copy-only-CommonControls6-test-manifest'
    qualified = $false
} | ConvertTo-Json | Tee-Object -FilePath (Join-Path $OutputDirectory 'artifact-receipt.json')
