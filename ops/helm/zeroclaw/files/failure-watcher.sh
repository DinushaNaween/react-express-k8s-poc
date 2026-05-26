#!/bin/bash
# Event-driven healer — watches for failures and triggers repair jobs quickly.
# Scheduled CronJob remains the fallback if event repair fails or is missed.
set -euo pipefail

NAMESPACE="${APP_NAMESPACE:-nrdc-poc}"
OPS_NAMESPACE="${OPS_NAMESPACE:-ops}"
BACKEND_URL="${BACKEND_URL:-http://backend.nrdc-poc.svc.cluster.local:3000}"
CRONJOB="${REPAIR_CRONJOB:-nrdc-cluster-ops}"
POLL_SECONDS="${EVENT_POLL_SECONDS:-3}"
GRACE_SECONDS="${EVENT_GRACE_SECONDS:-8}"
DEBOUNCE_SECONDS="${EVENT_DEBOUNCE_SECONDS:-15}"
LOG_PREFIX="[nrdc-event-healer]"

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

count_bad_pods() {
  kubectl get pods -n "$NAMESPACE" --field-selector=status.phase=Failed -o name 2>/dev/null | wc -l | tr -d ' '
}

has_active_repair_job() {
  local line name active
  while IFS= read -r line; do
    name="${line%% *}"
    active="${line##* }"
    case "$name" in
      nrdc-cluster-ops*)
        if [ "${active:-0}" != "0" ] && [ -n "$active" ]; then
          return 0
        fi
        ;;
    esac
  done < <(kubectl get jobs -n "$OPS_NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.active}{"\n"}{end}' 2>/dev/null || true)
  return 1
}

describe_failure() {
  local unready health_ok bad_pods parts=()
  unready=$(get_unready_deployments || true)
  bad_pods=$(count_bad_pods)
  if check_health; then health_ok=true; else health_ok=false; fi

  if [ -n "$unready" ]; then
    parts+=("unready deployments: $(echo "$unready" | tr '\n' ' ')")
  fi
  if [ "$bad_pods" -gt 0 ]; then
    parts+=("${bad_pods} failed pod(s)")
  fi
  if [ "$health_ok" = false ]; then
    parts+=("backend /health failing")
  fi

  if [ ${#parts[@]} -eq 0 ]; then
    echo ""
    return 1
  fi
  (IFS='; '; echo "${parts[*]}")
  return 0
}

create_event_repair_job() {
  local reason="$1"
  local job_name="nrdc-cluster-ops-event-$(date +%s)"

  if has_active_repair_job; then
    log "Repair job already running — skip event trigger ($reason)"
    return 0
  fi

  log "Triggering event-driven repair: $reason"
  kubectl create job "$job_name" --from="cronjob/${CRONJOB}" -n "$OPS_NAMESPACE"
  kubectl label job "$job_name" -n "$OPS_NAMESPACE" repair-trigger=event --overwrite 2>/dev/null || true
  log "Created repair job $job_name"
}

failure_since=0
in_failure=false
last_trigger=0

log "Event healer started (poll=${POLL_SECONDS}s grace=${GRACE_SECONDS}s debounce=${DEBOUNCE_SECONDS}s)"
log "Watching namespace $NAMESPACE — scheduled CronJob $CRONJOB is fallback"

while true; do
  now=$(date +%s)
  reason=$(describe_failure || true)

  if [ -n "$reason" ]; then
    if [ "$in_failure" = false ]; then
      in_failure=true
      failure_since=$now
      log "Failure detected: $reason"
    elif [ $((now - failure_since)) -ge "$GRACE_SECONDS" ]; then
      if [ $((now - last_trigger)) -ge "$DEBOUNCE_SECONDS" ]; then
        create_event_repair_job "$reason"
        last_trigger=$now
      fi
    fi
  else
    if [ "$in_failure" = true ]; then
      log "Cluster healthy again — L1 or healer recovered"
    fi
    in_failure=false
    failure_since=0
  fi

  sleep "$POLL_SECONDS"
done
