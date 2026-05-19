# Check tools required to run the NRDC POC on your machine.
# Usage:
#   .\scripts\check-prerequisites.ps1              # check everything
#   .\scripts\check-prerequisites.ps1 -Profile dev # minimum for npm run dev
#   .\scripts\check-prerequisites.ps1 -Profile compose
#   .\scripts\check-prerequisites.ps1 -Profile kubernetes
#   .\scripts\check-prerequisites.ps1 -Wait   # keep window open until Enter

param(
    [ValidateSet('all', 'dev', 'compose', 'kubernetes')]
    [string]$Profile = 'all',
    [switch]$Wait
)

$ErrorActionPreference = 'SilentlyContinue'
$script:FailedRequired = $false

function Write-Status {
    param(
        [string]$Name,
        [ValidateSet('PASS', 'FAIL', 'WARN', 'SKIP')]
        [string]$Status,
        [string]$Detail = ''
    )
    $color = switch ($Status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        'WARN' { 'Yellow' }
        'SKIP' { 'DarkGray' }
    }
    $line = ('{0,-22} [{1}]' -f $Name, $Status)
    if ($Detail) { $line += "  $Detail" }
    Write-Host $line -ForegroundColor $color
}

function Test-CommandExists {
    param([string]$Command)
    return [bool](Get-Command $Command -ErrorAction SilentlyContinue)
}

function Get-CommandVersion {
    param([string]$Command, [string[]]$VersionArgs = @('--version'))
    if (-not (Test-CommandExists $Command)) { return $null }
    $output = & $Command @VersionArgs 2>&1 | Select-Object -First 1
    return ($output | Out-String).Trim()
}

function Test-NodeVersion {
    if (-not (Test-CommandExists 'node')) { return @{ Ok = $false; Detail = 'not installed' } }
    $version = (node -v) -replace '^v', ''
    $major = [int]($version.Split('.')[0])
    if ($major -ge 20) {
        return @{ Ok = $true; Detail = "v$version" }
    }
    return @{ Ok = $false; Detail = "v$version (need 20+)" }
}

function Test-DockerRunning {
    if (-not (Test-CommandExists 'docker')) { return @{ Ok = $false; Detail = 'not installed' } }
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        return @{ Ok = $false; Detail = 'installed but daemon not running — start Docker Desktop' }
    }
    $ver = (docker version --format '{{.Server.Version}}' 2>$null)
    return @{ Ok = $true; Detail = "running ($ver)" }
}

function Test-KubectlCluster {
    if (-not (Test-CommandExists 'kubectl')) { return @{ Ok = $false; Detail = 'not installed' } }
    $ctx = (kubectl config current-context 2>$null)
    if (-not $ctx) { return @{ Ok = $false; Detail = 'no kubeconfig context' } }
    kubectl get nodes 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        return @{ Ok = $false; Detail = "context '$ctx' not reachable" }
    }
    $count = (kubectl get nodes --no-headers 2>$null | Measure-Object).Count
    return @{ Ok = $true; Detail = "context '$ctx', $count node(s)" }
}

function Test-K3dCluster {
    param([string]$ClusterName = 'nrdc-poc')
    if (-not (Test-CommandExists 'k3d')) { return @{ Ok = $false; Detail = 'not installed' } }
    $clusters = (k3d cluster list -o json 2>$null | ConvertFrom-Json)
    $match = $clusters | Where-Object { $_.name -eq $ClusterName }
    if ($match) {
        return @{ Ok = $true; Detail = "cluster '$ClusterName' exists" }
    }
    return @{ Ok = $false; Detail = "cluster '$ClusterName' not found (run: k3d cluster create $ClusterName)" }
}

function Invoke-Check {
    param(
        [string]$Name,
        [scriptblock]$Test,
        [string[]]$RequiredFor = @(),
        [string[]]$OptionalFor = @()
    )

    $needed = $false
    $optional = $false

    if ($Profile -eq 'all') {
        $needed = $RequiredFor.Count -gt 0
        $optional = $OptionalFor.Count -gt 0 -and -not $needed
    } else {
        $needed = $RequiredFor -contains $Profile
        $optional = $OptionalFor -contains $Profile
    }

    if (-not $needed -and -not $optional) {
        Write-Status $Name 'SKIP' 'not required for this profile'
        return
    }

    $result = & $Test
    $ok = [bool]$result.Ok

    if ($needed -and -not $ok) {
        $script:FailedRequired = $true
        Write-Status $Name 'FAIL' $result.Detail
    } elseif (-not $ok) {
        Write-Status $Name 'WARN' $result.Detail
    } else {
        Write-Status $Name 'PASS' $result.Detail
    }
}

Write-Host ''
Write-Host 'NRDC POC — prerequisite check' -ForegroundColor Cyan
Write-Host "Profile: $Profile"
Write-Host ''

Invoke-Check 'Git' { @{ Ok = (Test-CommandExists 'git'); Detail = (Get-CommandVersion 'git') } } -OptionalFor @('dev', 'compose', 'kubernetes')
Invoke-Check 'Node.js 20+' { Test-NodeVersion } -RequiredFor @('dev', 'compose', 'kubernetes')
Invoke-Check 'npm' { @{ Ok = (Test-CommandExists 'npm'); Detail = (Get-CommandVersion 'npm') } } -RequiredFor @('dev', 'compose', 'kubernetes')
Invoke-Check 'Docker' { Test-DockerRunning } -RequiredFor @('compose', 'kubernetes') -OptionalFor @('dev')
Invoke-Check 'Docker Compose' {
    if (Test-CommandExists 'docker') {
        $v = docker compose version 2>$null
        if ($LASTEXITCODE -eq 0) { return @{ Ok = $true; Detail = ($v | Out-String).Trim() } }
    }
    @{ Ok = (Test-CommandExists 'docker-compose'); Detail = (Get-CommandVersion 'docker-compose') }
} -RequiredFor @('compose') -OptionalFor @('kubernetes')
Invoke-Check 'kubectl' {
    if (-not (Test-CommandExists 'kubectl')) { return @{ Ok = $false; Detail = 'not installed' } }
    $ver = (kubectl version --client 2>$null | Select-String 'Client Version' | Select-Object -First 1)
    @{ Ok = $true; Detail = ($(if ($ver) { $ver.Line.Trim() } else { 'installed' })) }
} -RequiredFor @('kubernetes')
Invoke-Check 'k3d' { @{ Ok = (Test-CommandExists 'k3d'); Detail = (Get-CommandVersion 'k3d' @('version')) } } -RequiredFor @('kubernetes')
Invoke-Check 'Kubernetes cluster' { Test-KubectlCluster } -RequiredFor @('kubernetes')
Invoke-Check 'k3d cluster (nrdc-poc)' { Test-K3dCluster } -OptionalFor @('kubernetes')

Write-Host ''
Write-Host 'Profiles:' -ForegroundColor Cyan
Write-Host '  dev         — npm run dev (frontend + backend), no Docker/K8s'
Write-Host '  compose     — docker compose up'
Write-Host '  kubernetes  — k3d/k3s + kubectl deploy (full POC with cluster UI)'
Write-Host ''

$exitCode = 0
if ($script:FailedRequired) {
    Write-Host 'Result: MISSING required tools. Install failures above, then re-run this script.' -ForegroundColor Red
    Write-Host 'See README.md for install links.' -ForegroundColor Yellow
    $exitCode = 1
} else {
    Write-Host 'Result: All required tools for profile "' -NoNewline -ForegroundColor Green
    Write-Host "$Profile" -NoNewline -ForegroundColor Green
    Write-Host '" are ready.' -ForegroundColor Green
}

if ($Wait) {
    Write-Host ''
    Read-Host 'Press Enter to close'
}

exit $exitCode
