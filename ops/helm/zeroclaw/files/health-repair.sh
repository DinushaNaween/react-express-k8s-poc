#!/bin/bash
# Deterministic cluster health check and repair.
set -euo pipefail

NAMESPACE="${APP_NAMESPACE:-nrdc-poc}"
BACKEND_URL="${BACKEND_URL:-http://backend.nrdc-poc.svc.cluster.local:3000}"
MAX_ATTEMPTS="${MAX_REPAIR_ATTEMPTS:-3}"

if [ -n "${REPAIR_TRIGGER:-}" ]; then
  TRIGGER="${REPAIR_TRIGGER}"
elif [[ "${HOSTNAME:-}" == *"-event-"* ]]; then
  TRIGGER="event"
elif [[ "${HOSTNAME:-}" == *"-manual-"* ]]; then
  TRIGGER="manual"
else
  TRIGGER="scheduled"
fi

case "$TRIGGER" in
  event) LOG_PREFIX="[nrdc-event-healer]" ;;
  manual) LOG_PREFIX="[nrdc-manual-repair]" ;;
  *) LOG_PREFIX="[nrdc-cluster-ops]" ;;
esac

log() { echo "${LOG_PREFIX} $*"; }

check_health() {
  curl -sf "${BACKEND_URL}/health" >/dev/null 2>&1
}

get_unready_deployments() {
  kubectl get deployments -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.readyReplicas}{" "}{.status.replicas}{"\n"}{end}' \
    | while read -r name ready spec; do
        [ -z "$name" ] && continue
        ready="${ready:-0}"
        spec="${spec:-0}"
        if [ "$ready" != "$spec" ]; then
          echo "$name"
        fi
      done
}

repair_deployment() {
  local name="$1"
  log "Rolling out restart for deployment/$name in $NAMESPACE"
  kubectl rollout restart "deployment/${name}" -n "$NAMESPACE"
  kubectl rollout status "deployment/${name}" -n "$NAMESPACE" --timeout=120s || true
}

main() {
  log "Starting health check (trigger=${TRIGGER})"

  if check_health; then
    log "Backend /health OK"
  else
    log "Backend /health FAILED"
  fi

  local unready
  unready=$(get_unready_deployments || true)

  if [ -z "$unready" ]; then
    log "All deployments ready"
    exit 0
  fi

  log "Unready deployments: $(echo "$unready" | tr '\n' ' ')"

  local attempts=0
  while IFS= read -r dep; do
    [ -z "$dep" ] && continue
    if [ "$attempts" -ge "$MAX_ATTEMPTS" ]; then
      log "Max repair attempts reached"
      exit 1
    fi
    repair_deployment "$dep"
    attempts=$((attempts + 1))
  done <<< "$unready"

  unready=$(get_unready_deployments || true)
  if [ -z "$unready" ] && check_health; then
    log "Repair successful"
    exit 0
  fi

  log "Repair incomplete"
  exit 1
}

main "$@"
