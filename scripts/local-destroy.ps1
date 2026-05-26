# Destroy local deployment in reverse order: ops -> deploy -> platform.
param(
    [switch]$AutoApprove
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host 'NRDC POC — local destroy' -ForegroundColor Cyan

function Invoke-TerraformDestroy {
    param(
        [string]$Dir,
        [hashtable]$Vars = @{}
    )
    if (-not (Test-Path (Join-Path $Dir 'terraform.tfstate'))) {
        Write-Host "Skip destroy (no state): $Dir" -ForegroundColor DarkGray
        return
    }
    Push-Location $Dir
    try {
        terraform init -input=false | Out-Null
        $varArgs = @()
        foreach ($key in $Vars.Keys) {
            $varArgs += "-var=$key=$($Vars[$key])"
        }
        if ($AutoApprove) {
            terraform destroy -input=false -auto-approve @varArgs
        } else {
            terraform destroy -input=false @varArgs
        }
    } finally {
        Pop-Location
    }
}

$opsDir = Join-Path $root 'ops\terraform\environments\local'
$deployDir = Join-Path $root 'deploy\terraform\environments\local'
$platformDir = Join-Path $root 'platform\terraform\environments\local'

Invoke-TerraformDestroy -Dir $opsDir
Invoke-TerraformDestroy -Dir $deployDir
Invoke-TerraformDestroy -Dir $platformDir -Vars @{ repo_root = $root }

Write-Host ''
Write-Host 'Local destroy complete.' -ForegroundColor Green
