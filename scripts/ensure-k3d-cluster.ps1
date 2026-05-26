# Create or recreate k3d cluster if missing or unreachable (used by platform Terraform).
param(
    [string]$ClusterName = 'nrdc-poc'
)

$ErrorActionPreference = 'Stop'

function Test-ClusterReachable {
    param([string]$Name)
    kubectl config use-context "k3d-$Name" 2>$null | Out-Null
    kubectl get nodes --request-timeout=5s 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

$existing = k3d cluster list 2>$null | Select-String $ClusterName
if ($existing -and (Test-ClusterReachable -Name $ClusterName)) {
    Write-Host "k3d cluster '$ClusterName' is running"
    kubectl get nodes
    exit 0
}

if ($existing) {
    Write-Host "k3d cluster '$ClusterName' exists but is not reachable - recreating..."
    k3d cluster delete $ClusterName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Creating k3d cluster '$ClusterName'..."
k3d cluster create $ClusterName --agents 0 --port "80:80@loadbalancer"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Cluster '$ClusterName' ready"
kubectl get nodes
