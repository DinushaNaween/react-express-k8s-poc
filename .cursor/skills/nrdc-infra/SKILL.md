---
name: nrdc-infra
description: Deploy and manage NRDC POC infrastructure locally (k3d) or on Azure. Use when the user asks to build a cluster, deploy the app, test, repair, or destroy infrastructure.
---

# NRDC Infrastructure Skill

## Default: local-first

Always prefer **local** environment until E2E tests pass. Do not deploy to Azure unless the user explicitly requests promotion after local sign-off.

## Prerequisites check

```powershell
.\scripts\check-prerequisites.ps1 -Profile local
```

## Intent mapping

| User says | Run |
|-----------|-----|
| build local cluster / build dev cluster (local) | `.\scripts\local-deploy.ps1` |
| deploy app local | Build images if needed, then `terraform -chdir=deploy/terraform/environments/local apply` |
| test local cluster | `.\scripts\local-e2e-test.ps1` |
| destroy local cluster | `.\scripts\local-destroy.ps1` |
| repair cluster | Check event healer logs: `kubectl logs -n ops deploy/nrdc-event-healer`; manual job: `POST /api/testlab/trigger-repair` or `kubectl create job --from=cronjob/nrdc-cluster-ops manual-$(date +%s) -n ops` |

## Full local deploy order

1. `platform/terraform/environments/local` — k3d + images
2. `deploy/terraform/environments/local` — app Helm release
3. `ops/terraform/environments/local` — ZeroClaw ops

Or use orchestrator: `.\scripts\local-deploy.ps1 -AutoApprove`

## Safety gates

- Run `terraform plan` before apply when not using `-AutoApprove`
- Never run Azure `terraform destroy` without explicit user confirmation
- Never commit secrets
- Do not use raw `kubectl apply -f k8s/` for deployment — use Terraform Helm releases

## Auto-heal

| Layer | Component |
|-------|-----------|
| L1 | Kubernetes Deployment controller (seconds) |
| L2-event | `nrdc-event-healer` deployment — watches failures, triggers repair jobs after ~8s grace |
| L2-scheduled | `nrdc-cluster-ops` CronJob every 2 min — fallback |

## Verification

After deploy:

```powershell
kubectl get pods -n nrdc-poc
kubectl get pods -n ops
kubectl get deploy -n ops nrdc-event-healer zeroclaw-ops
curl -H "Host: nrdc-poc.local" http://127.0.0.1/health
.\scripts\local-e2e-test.ps1
.\scripts\local-ops-test.ps1
```

## Azure promotion (deferred)

Block until `local-e2e-test.ps1` passes. Azure uses same Helm charts under `deploy/helm/` and `ops/helm/` with `dev` Terraform environments.

## Cost guardrails (Azure only)

- AKS spot node pool, min 1 max 2 nodes
- ACR Basic SKU
- No premium add-ons unless user requests
