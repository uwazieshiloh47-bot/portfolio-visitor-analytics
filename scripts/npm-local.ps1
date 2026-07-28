[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $NpmArguments
)

$nodeHome = Join-Path $PSScriptRoot "..\.tools\node-v24.18.0-win-x64"
$npmCommand = Join-Path $nodeHome "npm.cmd"

if (-not (Test-Path -LiteralPath $npmCommand)) {
  throw "Portable Node.js was not found at $nodeHome."
}

$env:PATH = "$nodeHome;$env:PATH"

& $npmCommand @NpmArguments
exit $LASTEXITCODE
