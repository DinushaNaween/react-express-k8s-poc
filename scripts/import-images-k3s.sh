#!/usr/bin/env bash
# Run on the k3s Linux VM after build-images.sh
set -euo pipefail

for image in nrdc-poc-backend:latest nrdc-poc-frontend:latest; do
  echo "Importing $image into k3s..."
  docker save "$image" | sudo k3s ctr images import -
done

echo "Done. Verify with: sudo k3s ctr images ls | grep nrdc-poc"
