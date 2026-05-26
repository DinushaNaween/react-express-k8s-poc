# Test ops layer: ZeroClaw gateway, CronJob repair, RBAC.
param(
    [switch]$SkipRepairTest
)

$ErrorActionPreference = 'Stop'
$failed = 0

function Test-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host ""
    Write-Host "TEST: $Name" -ForegroundColor Cyan
    try {
        & $Action
        Write-Host "PASS: $Name" -ForegroundColor Green
    } catch {
        Write-Host "FAIL: $Name - $($_.Exception.Message)" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host 'NRDC POC — ops layer tests' -ForegroundColor Cyan

Test-Step 'Ops namespace resources exist' {
    kubectl get deployment,cronjob,svc -n ops | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'ops namespace check failed' }
}

Test-Step 'ZeroClaw pod running' {
    $ready = kubectl get deployment zeroclaw-ops -n ops -o jsonpath='{.status.readyReplicas}'
    if ([int]$ready -lt 1) { throw "zeroclaw-ops not ready ($ready)" }
}

Test-Step 'ZeroClaw /health via port-forward' {
    $job = Start-Job {
        kubectl port-forward -n ops svc/zeroclaw-ops 42617:42617 2>$null
    }
    Start-Sleep -Seconds 3
    try {
        $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:42617/health' -UseBasicParsing -TimeoutSec 10
        if ($resp.StatusCode -ne 200) { throw "status $($resp.StatusCode)" }
    } finally {
        Stop-Job $job -ErrorAction SilentlyContinue
        Remove-Job $job -Force -ErrorAction SilentlyContinue
        Get-Process -Name kubectl -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*42617*' } | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

Test-Step 'Repair CronJob exists' {
    kubectl get cronjob nrdc-cluster-ops -n ops | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'cronjob missing' }
}

Test-Step 'RBAC in app namespace' {
    kubectl get role,rolebinding zeroclaw-ops-app -n nrdc-poc | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'app namespace RBAC missing' }
}

if (-not $SkipRepairTest) {
    Test-Step 'L2 repair - manual CronJob run' {
        kubectl delete job manual-repair-test -n ops --ignore-not-found 2>$null | Out-Null
        kubectl create job --from=cronjob/nrdc-cluster-ops manual-repair-test -n ops 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'failed to create job' }
        kubectl wait --for=condition=complete job/manual-repair-test -n ops --timeout=120s 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            kubectl logs job/manual-repair-test -n ops --tail=20
            throw 'repair job did not complete'
        }
        kubectl logs job/manual-repair-test -n ops --tail=5
    }
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host 'All ops tests passed.' -ForegroundColor Green
    exit 0
}
Write-Host "$failed ops test(s) failed." -ForegroundColor Red
exit 1
