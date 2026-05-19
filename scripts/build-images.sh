#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

docker build -t nrdc-poc-backend:latest "$ROOT/backend"
docker build -t nrdc-poc-frontend:latest "$ROOT/frontend"

echo "Built: nrdc-poc-backend:latest, nrdc-poc-frontend:latest"
