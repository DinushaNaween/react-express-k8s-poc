# Apply manifests and import images into k3s (run on the Linux VM or via SSH)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

kubectl apply -f "$root\k8s\namespace.yaml"
Get-ChildItem "$root\k8s\*.yaml" | Where-Object { $_.Name -ne 'namespace.yaml' } | ForEach-Object {
  kubectl apply -f $_.FullName
}

# On the k3s node, import local images (Linux):
#   docker save nrdc-poc-backend:latest | sudo k3s ctr images import -
#   docker save nrdc-poc-frontend:latest | sudo k3s ctr images import -

Write-Host "Deployed to namespace nrdc-poc."
Write-Host "Add to hosts file: <VM-IP> nrdc-poc.local"
Write-Host "Then open: http://nrdc-poc.local"
