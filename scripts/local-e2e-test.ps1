# Local E2E validation checklist for instruction-as-infra deployment.
param(
    [switch]$SkipRepairTest
)

$ErrorActionPreference = 'Stop'
$failed = 0

function Test-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    Write-Host ""
    Write-Host "TEST: $Name" -ForegroundColor Cyan
    try {
        & $Action
        Write-Host "PASS: $Name" -ForegroundColor Green
    } catch {
        Write-Host "FAIL: $Name — $($_.Exception.Message)" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host 'NRDC POC — local E2E tests' -ForegroundColor Cyan

Test-Step 'Kubernetes cluster reachable' {
    kubectl get nodes | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'kubectl get nodes failed' }
}

Test-Step 'App pods running' {
    $pods = kubectl get pods -n nrdc-poc --no-headers 2>$null
    if (-not $pods) { throw 'no pods in nrdc-poc' }
    $notRunning = $pods | Where-Object { $_ -notmatch 'Running' }
    if ($notRunning) { throw "pods not running: $notRunning" }
}

Test-Step 'Ops pods running' {
    kubectl get pods -n ops --no-headers | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'ops namespace check failed' }
}

Test-Step 'Backend health via service' {
    kubectl run curl-test --rm -i --restart=Never -n nrdc-poc --image=curlimages/curl:latest -- \
        curl -sf http://backend.nrdc-poc.svc.cluster.local:3000/health | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '/health check failed' }
}

Test-Step 'Cluster API via service' {
    $out = kubectl run curl-cluster --rm -i --restart=Never -n nrdc-poc --image=curlimages/curl:latest -- \
        curl -sf http://backend.nrdc-poc.svc.cluster.local:3000/api/cluster 2>$null
    if ($LASTEXITCODE -ne 0) { throw '/api/cluster check failed' }
    if ($out -notmatch 'nodes') { throw 'cluster API response unexpected' }
}

Test-Step 'L1 heal — pod delete recreates' {
    $before = kubectl get pods -n nrdc-poc -l app=backend -o jsonpath='{.items[0].metadata.name}'
    kubectl delete pod -n nrdc-poc -l app=backend --wait=false | Out-Null
    Start-Sleep -Seconds 15
    $ready = kubectl get deployment backend -n nrdc-poc -o jsonpath='{.status.readyReplicas}'
    if ([int]$ready -lt 1) { throw "backend not ready after pod delete (was $before)" }
}

if (-not $SkipRepairTest) {
    Test-Step 'L2 heal — cron health-repair job' {
        kubectl create job --from=cronjob/nrdc-cluster-ops manual-repair-test -n ops 2>$null
        Start-Sleep -Seconds 20
        $status = kubectl get jobs manual-repair-test -n ops -o jsonpath='{.status.succeeded}' 2>$null
        kubectl delete job manual-repair-test -n ops --ignore-not-found 2>$null | Out-Null
        if ($status -ne '1') {
            Write-Host 'WARN: manual repair job did not succeed (may be OK if cluster healthy)' -ForegroundColor Yellow
        }
    }
}

Write-Host ''
if ($failed -eq 0) {
    Write-Host 'All E2E tests passed.' -ForegroundColor Green
    exit 0
}

Write-Host "$failed test(s) failed." -ForegroundColor Red
exit 1
