#!/usr/bin/env bash
# Build, import, and deploy the POC to a local k3d cluster.
# Usage: ./scripts/deploy-local-k3d.sh [--create-cluster] [--skip-build]

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER_NAME="${K3D_CLUSTER:-nrdc-poc}"
CREATE_CLUSTER=false
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --create-cluster) CREATE_CLUSTER=true ;;
    --skip-build) SKIP_BUILD=true ;;
  esac
done

echo "Checking prerequisites..."
"$ROOT/scripts/check-prerequisites.sh" kubernetes

if [[ "$CREATE_CLUSTER" == true ]] && ! k3d cluster list 2>/dev/null | grep -q "$CLUSTER_NAME"; then
  echo "Creating k3d cluster $CLUSTER_NAME..."
  k3d cluster create "$CLUSTER_NAME" --agents 0
fi

if [[ "$SKIP_BUILD" != true ]]; then
  "$ROOT/scripts/build-images.sh"
fi

echo "Importing images into k3d..."
k3d image import nrdc-poc-backend:latest nrdc-poc-frontend:latest -c "$CLUSTER_NAME"

echo "Applying manifests..."
kubectl apply -f "$ROOT/k8s/namespace.yaml"
kubectl apply -f "$ROOT/k8s/"

kubectl rollout restart deployment/backend deployment/frontend -n nrdc-poc 2>/dev/null || true
kubectl rollout status deployment/backend deployment/frontend -n nrdc-poc --timeout=120s

kubectl get pods,svc -n nrdc-poc
echo ""
echo "Deploy complete."
echo "  kubectl port-forward -n nrdc-poc svc/frontend 8080:80"
echo "  http://localhost:8080"
