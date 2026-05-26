# Full local deployment: platform -> deploy -> ops (Terraform + Helm on k3d).
param(
    [switch]$SkipBuild,
    [switch]$AutoApprove
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host 'NRDC POC — local deployment' -ForegroundColor Cyan
Write-Host "Repo root: $root"
Write-Host ''

Write-Host 'Checking prerequisites...' -ForegroundColor Cyan
& "$PSScriptRoot\check-prerequisites.ps1" -Profile local
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$approveArg = if ($AutoApprove) { '-auto-approve' } else { '' }

function Invoke-TerraformApply {
    param(
        [string]$Dir,
        [hashtable]$Vars = @{}
    )
    Write-Host ""
    Write-Host "Terraform init: $Dir" -ForegroundColor Cyan
    Push-Location $Dir
    try {
        terraform init -input=false
        if ($LASTEXITCODE -ne 0) { throw "terraform init failed in $Dir" }

        $varArgs = @()
        foreach ($key in $Vars.Keys) {
            $varArgs += "-var=$key=$($Vars[$key])"
        }

        Write-Host "Terraform apply: $Dir" -ForegroundColor Cyan
        if ($AutoApprove) {
            terraform apply -input=false -auto-approve @varArgs
        } else {
            terraform apply -input=false @varArgs
        }
        if ($LASTEXITCODE -ne 0) { throw "terraform apply failed in $Dir" }
    } finally {
        Pop-Location
    }
}

# 1. Platform (k3d + images)
$platformDir = Join-Path $root 'platform\terraform\environments\local'
$importArgs = @{}
if ($SkipBuild) { $importArgs['SkipBuild'] = $true }

Invoke-TerraformApply -Dir $platformDir -Vars @{ repo_root = $root }

# 2. Deploy app
$deployDir = Join-Path $root 'deploy\terraform\environments\local'
Invoke-TerraformApply -Dir $deployDir

# 3. Deploy ops (ZeroClaw)
$opsDir = Join-Path $root 'ops\terraform\environments\local'
Invoke-TerraformApply -Dir $opsDir

Write-Host ''
Write-Host 'Waiting for app deployments...' -ForegroundColor Cyan
kubectl wait --for=condition=available deployment/backend deployment/frontend -n nrdc-poc --timeout=180s 2>$null

Write-Host ''
Write-Host 'Deploy complete.' -ForegroundColor Green
Write-Host ''
Write-Host 'Access:' -ForegroundColor Yellow
Write-Host '  App:       http://nrdc-poc.local  (add 127.0.0.1 nrdc-poc.local to hosts file)'
Write-Host '  Health:    http://nrdc-poc.local/health'
Write-Host '  Cluster:   http://nrdc-poc.local/api/cluster'
Write-Host ''
Write-Host 'ZeroClaw:' -ForegroundColor Yellow
Write-Host '  kubectl get pods -n ops'
Write-Host '  kubectl logs -n ops -l app=zeroclaw-ops -f'
Write-Host '  kubectl port-forward -n ops svc/zeroclaw-ops 42617:42617'
Write-Host ''
Write-Host 'Test: .\scripts\local-e2e-test.ps1' -ForegroundColor Yellow
