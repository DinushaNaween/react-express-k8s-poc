# Build container images for the POC (run from repo root)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

docker build -t nrdc-poc-backend:latest "$root\backend"
docker build -t nrdc-poc-frontend:latest "$root\frontend"

Write-Host "Built: nrdc-poc-backend:latest, nrdc-poc-frontend:latest"
