# HOMEOS - demarrage sur un PC Windows (lance automatiquement a l'ouverture de session).
# Reglages propres a ce PC : deploy\windows\reglages.ps1 (non versionne), ex. $env:HOMEOS_PUBLIC_URL = 'https://...ts.net'
$racine = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $racine
$env:HOMEOS_TRUST_PROXY = '1'
$reglages = Join-Path $PSScriptRoot 'reglages.ps1'
if (Test-Path $reglages) { . $reglages }
New-Item -ItemType Directory -Force (Join-Path $racine 'data') | Out-Null
$journal = Join-Path $racine 'data\homeos.log'
# Relance automatique si le serveur s'arrete.
while ($true) {
  & node packages/server/dist/server.js *>> $journal
  Start-Sleep -Seconds 5
}
