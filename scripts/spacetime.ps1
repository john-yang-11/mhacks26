param([ValidateSet("start", "publish", "generate")][string]$Operation)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$portableCli = Join-Path $repoRoot ".tools/spacetime/spacetimedb-cli.exe"
if (Test-Path -LiteralPath $portableCli) { $cli = $portableCli }
else {
  $installedCli = Get-Command spacetime -ErrorAction SilentlyContinue
  if (!$installedCli) { throw "Install SpacetimeDB 2.10.2 from https://spacetimedb.com/install, then retry." }
  $cli = $installedCli.Source
}
if ($Operation -eq "start") {
  & $cli --root-dir .tools/config start --listen-addr 127.0.0.1:3001 --data-dir .tools/data --non-interactive
} elseif ($Operation -eq "publish") {
  & $cli --root-dir .tools/config publish rising-waters-v2-local --module-path spacetime --server http://127.0.0.1:3001 --yes=skip-login --delete-data=never --no-config
} else {
  & $cli --root-dir .tools/config generate --lang typescript --out-dir apps/web/src/module_bindings --module-path spacetime
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npx --prefix apps/web prettier --write apps/web/src/module_bindings
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
