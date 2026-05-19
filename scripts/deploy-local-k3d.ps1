# Build, import, and deploy the POC to a local k3d cluster (Windows).
# Prereqs: Docker Desktop running, k3d, kubectl, cluster "nrdc-poc"
# Usage (from repo root): .\scripts\deploy-local-k3d.ps1

param(
    [string]$ClusterName = 'nrdc-poc',
    [switch]$SkipBuild,
    [switch]$CreateCluster
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host 'Checking prerequisites...' -ForegroundColor Cyan
& "$PSScriptRoot\check-prerequisites.ps1" -Profile kubernetes
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($CreateCluster) {
    $existing = k3d cluster list 2>$null | Select-String $ClusterName
    if (-not $existing) {
        Write-Host "Creating k3d cluster '$ClusterName'..." -ForegroundColor Cyan
        k3d cluster create $ClusterName --agents 0
    }
}

if (-not $SkipBuild) {
    & "$PSScriptRoot\build-images.ps1"
}

Write-Host "Importing images into k3d cluster '$ClusterName'..." -ForegroundColor Cyan
k3d image import nrdc-poc-backend:latest nrdc-poc-frontend:latest -c $ClusterName

Write-Host 'Applying Kubernetes manifests...' -ForegroundColor Cyan
kubectl apply -f "$root\k8s\namespace.yaml"
Get-ChildItem "$root\k8s\*.yaml" | Where-Object { $_.Name -ne 'namespace.yaml' } | ForEach-Object {
    kubectl apply -f $_.FullName
}

kubectl rollout restart deployment/backend deployment/frontend -n nrdc-poc 2>$null
kubectl rollout status deployment/backend deployment/frontend -n nrdc-poc --timeout=120s

Write-Host ''
kubectl get pods,svc -n nrdc-poc
Write-Host ''
Write-Host 'Deploy complete.' -ForegroundColor Green
Write-Host 'Run in another terminal:' -ForegroundColor Yellow
Write-Host '  kubectl port-forward -n nrdc-poc svc/frontend 8080:80'
Write-Host 'Then open: http://localhost:8080'
