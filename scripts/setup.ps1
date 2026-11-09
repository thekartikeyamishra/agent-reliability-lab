# One-shot setup for Windows PowerShell. Run from the project folder:  .\scripts\setup.ps1
$ErrorActionPreference = 'Stop'
$v = (node -v) -replace 'v',''
if ([int]($v.Split('.')[0]) -lt 22) { throw "Node.js 22+ required (found $v). Install the LTS from https://nodejs.org" }
npm ci
npm run build
npm test
node dist/cli.js demo
node dist/cli.js init
Write-Host "`nSetup complete. Next:  node dist/cli.js wizard --preset truesource-ai   (see docs\NO-BUSINESS-PLAN.md)" -ForegroundColor Green
