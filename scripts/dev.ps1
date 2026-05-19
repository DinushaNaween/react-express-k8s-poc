# Start backend + frontend dev servers (requires two terminals normally).
# This script starts the backend; run frontend in another terminal:
#   cd frontend; npm run dev
# Or use Option A in README with two terminals.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

& "$PSScriptRoot\check-prerequisites.ps1" -Profile dev
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path "$root\backend\node_modules")) {
    Write-Host 'Installing backend dependencies...' -ForegroundColor Cyan
    Push-Location "$root\backend"; npm install; Pop-Location
}

Write-Host 'Starting backend on http://localhost:3000' -ForegroundColor Green
Write-Host 'In another terminal: cd frontend; npm install; npm run dev' -ForegroundColor Yellow
Write-Host 'Then open http://localhost:5173' -ForegroundColor Yellow
Push-Location "$root\backend"
npm run dev
