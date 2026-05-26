# Build and import container images into a k3d cluster.
param(
    [string]$ClusterName = 'nrdc-poc',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $SkipBuild) {
    Write-Host 'Building app images...' -ForegroundColor Cyan
    & "$PSScriptRoot\build-images.ps1"

    Write-Host 'Building ZeroClaw ops image...' -ForegroundColor Cyan
    docker build -t nrdc-zeroclaw-ops:local "$root\ops\docker\zeroclaw-ops"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Importing images into k3d cluster '$ClusterName' (one at a time)..." -ForegroundColor Cyan
$images = @(
    'nrdc-poc-backend:latest',
    'nrdc-poc-frontend:latest',
    'nrdc-zeroclaw-ops:local'
)
foreach ($img in $images) {
    Write-Host "  Importing $img..."
    k3d image import $img -c $ClusterName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'Images imported successfully' -ForegroundColor Green
