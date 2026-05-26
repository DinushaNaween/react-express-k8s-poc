# NRDC POC — Agent guide

## Repository layout

| Path | Purpose |
|------|---------|
| `backend/`, `frontend/` | Application source |
| `backend/src/infrastructure.js` | Terraform layer + auto-heal API |
| `backend/src/testlab.js` | Failure test lab + activity log API |
| `deploy/helm/nrdc-poc/` | App Helm chart |
| `deploy/terraform/environments/local/` | App Terraform (local) |
| `platform/terraform/environments/local/` | k3d cluster Terraform |
| `ops/helm/zeroclaw/` | ZeroClaw ops Helm chart (gateway, event healer, CronJob) |
| `ops/terraform/environments/local/` | Ops Terraform (local) |
| `ops/docker/zeroclaw-ops/` | Custom image: ZeroClaw + kubectl + heal scripts |
| `ops/zeroclaw-skills/` | ZeroClaw skill source |
| `scripts/local-*.ps1` | Deploy, destroy, test orchestrators |
| `docs/local-setup.md` | Full local stack documentation |
| `k8s/` | Legacy flat manifests (reference only) |

## Local-first rule

**Always validate locally before Azure.** Use `local` Terraform environments only until E2E tests pass.

## Deploy commands

```powershell
# Full stack (platform → deploy → ops)
.\scripts\local-deploy.ps1 -AutoApprove

# App only
terraform -chdir=deploy/terraform/environments/local apply -auto-approve

# Ops only
terraform -chdir=ops/terraform/environments/local apply -auto-approve

# Test
.\scripts\local-e2e-test.ps1
.\scripts\local-ops-test.ps1

# Destroy
.\scripts\local-destroy.ps1 -AutoApprove
```

## Auto-heal layers

| Layer | What |
|-------|------|
| L1 | Kubernetes probes + Deployment controller |
| L2-event | `nrdc-event-healer` watches failures, creates repair jobs (~8s grace) |
| L2-scheduled | `nrdc-cluster-ops` CronJob every 2 min as fallback |

Repair script: `ops/helm/zeroclaw/files/health-repair.sh`

## UI / test lab

The frontend at http://nrdc-poc.local exposes:

- Infrastructure panel (`GET /api/infrastructure`)
- Failure test lab with probe kill buttons (`GET/POST /api/testlab/*`)
- Live activity log (server-side ring buffer, 500 events)
- Side-by-side probes + ZeroClaw healer monitor

After UI/backend changes: rebuild images, import to k3d, apply deploy Terraform, rollout restart.

## Safety

- Never run `terraform destroy` on Azure without explicit user confirmation
- Local destroy is OK with confirmation
- Never commit secrets (`.env`, API keys)
- App changes go through Helm/Terraform — do not `kubectl apply` flat YAML for production paths

## Instruction mapping

| User intent | Action |
|-------------|--------|
| build local cluster | `.\scripts\local-deploy.ps1` |
| deploy app local | `terraform apply` in `deploy/terraform/environments/local` |
| deploy ops / healer | `terraform apply` in `ops/terraform/environments/local` |
| test local | `.\scripts\local-e2e-test.ps1` |
| test ops | `.\scripts\local-ops-test.ps1` |
| destroy local | `.\scripts\local-destroy.ps1` |
| manual repair | `POST /api/testlab/trigger-repair` or `kubectl create job --from=cronjob/nrdc-cluster-ops ...` |
