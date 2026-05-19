#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

kubectl apply -f "$ROOT/k8s/namespace.yaml"
kubectl apply -f "$ROOT/k8s/"

echo "Deployed to namespace nrdc-poc."
echo "Add to /etc/hosts: <VM-IP> nrdc-poc.local"
echo "Open: http://nrdc-poc.local"
