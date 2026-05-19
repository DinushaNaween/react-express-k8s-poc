#!/usr/bin/env bash
# Check tools required to run the NRDC POC.
# Usage:
#   ./scripts/check-prerequisites.sh [all|dev|compose|kubernetes] [--pause|--no-pause]
#
# On Windows Git Bash the window stays open until Enter (use --no-pause to skip).
# Or double-click: scripts/check-prerequisites.cmd

set -u

PROFILE="all"
PAUSE=""
NO_PAUSE=""

for arg in "$@"; do
  case "$arg" in
    --pause) PAUSE=1 ;;
    --no-pause) NO_PAUSE=1 ;;
    all|dev|compose|kubernetes) PROFILE="$arg" ;;
  esac
done

FAILED=0

pass() { printf '%-22s [PASS]  %s\n' "$1" "$2"; }
fail() { printf '%-22s [FAIL]  %s\n' "$1" "$2"; FAILED=1; }
warn() { printf '%-22s [WARN]  %s\n' "$1" "$2"; }
skip() { printf '%-22s [SKIP]  %s\n' "$1" "$2"; }

is_required() {
  local for_profiles="$1"
  [[ "$PROFILE" == "all" ]] && return 0
  [[ " $for_profiles " == *" $PROFILE "* ]]
}

is_optional() {
  local for_profiles="$1"
  [[ "$PROFILE" == "all" ]] && return 1
  [[ " $for_profiles " == *" $PROFILE "* ]]
}

run_check() {
  local name="$1" required_for="$2" optional_for="$3"
  shift 3

  if is_required "$required_for"; then
    if "$@"; then return; fi
    fail "$name" "${DETAIL:-check failed}"
    return
  fi
  if is_optional "$optional_for" || [[ "$PROFILE" == "all" && -n "$optional_for" ]]; then
    if "$@"; then return; fi
    warn "$name" "${DETAIL:-not available}"
    return
  fi
  skip "$name" "not required for profile $PROFILE"
}

check_git() {
  DETAIL=""
  if command -v git >/dev/null 2>&1; then DETAIL=$(git --version); pass "Git" "$DETAIL"; return 0; fi
  DETAIL="not installed (optional)"; return 1
}

check_node() {
  DETAIL=""
  if ! command -v node >/dev/null 2>&1; then DETAIL="not installed"; return 1; fi
  major=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [[ "$major" -ge 20 ]]; then DETAIL=$(node -v); pass "Node.js 20+" "$DETAIL"; return 0; fi
  DETAIL="$(node -v) — need v20+"; return 1
}

check_npm() {
  DETAIL=""
  command -v npm >/dev/null 2>&1 || { DETAIL="not installed"; return 1; }
  DETAIL=$(npm -v); pass "npm" "v$DETAIL"; return 0
}

check_docker() {
  DETAIL=""
  command -v docker >/dev/null 2>&1 || { DETAIL="not installed"; return 1; }
  if docker info >/dev/null 2>&1; then
    DETAIL="running ($(docker version --format '{{.Server.Version}}' 2>/dev/null || echo ok))"
    pass "Docker" "$DETAIL"; return 0
  fi
  DETAIL="daemon not running"; return 1
}

check_compose() {
  DETAIL=""
  if docker compose version >/dev/null 2>&1; then
    DETAIL=$(docker compose version | head -1)
    pass "Docker Compose" "$DETAIL"; return 0
  fi
  DETAIL="not available"; return 1
}

check_kubectl() {
  DETAIL=""
  command -v kubectl >/dev/null 2>&1 || { DETAIL="not installed"; return 1; }
  DETAIL=$(kubectl version --client --short 2>/dev/null | head -1)
  pass "kubectl" "$DETAIL"; return 0
}

check_k3d() {
  DETAIL=""
  command -v k3d >/dev/null 2>&1 || { DETAIL="not installed"; return 1; }
  DETAIL=$(k3d version 2>/dev/null | head -1)
  pass "k3d" "$DETAIL"; return 0
}

check_cluster() {
  DETAIL=""
  command -v kubectl >/dev/null 2>&1 || { DETAIL="kubectl missing"; return 1; }
  ctx=$(kubectl config current-context 2>/dev/null || true)
  [[ -n "$ctx" ]] || { DETAIL="no kubeconfig context"; return 1; }
  kubectl get nodes >/dev/null 2>&1 || { DETAIL="context '$ctx' not reachable"; return 1; }
  count=$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')
  DETAIL="context '$ctx', ${count} node(s)"
  pass "Kubernetes cluster" "$DETAIL"; return 0
}

check_k3d_cluster() {
  DETAIL=""
  command -v k3d >/dev/null 2>&1 || { DETAIL="k3d missing"; return 1; }
  if k3d cluster list 2>/dev/null | grep -q 'nrdc-poc'; then
    DETAIL="cluster 'nrdc-poc' exists"
    pass "k3d cluster (nrdc-poc)" "$DETAIL"; return 0
  fi
  DETAIL="not found — run: k3d cluster create nrdc-poc"; return 1
}

echo ""
echo "NRDC POC — prerequisite check"
echo "Profile: $PROFILE"
echo ""

# Git
if is_required "dev compose kubernetes"; then check_git || warn "Git" "$DETAIL"
else skip "Git" "not required"; fi

# Node + npm
if is_required "dev compose kubernetes"; then check_node || fail "Node.js 20+" "$DETAIL"
else skip "Node.js 20+" "not required"; fi
if is_required "dev compose kubernetes"; then check_npm || fail "npm" "$DETAIL"
else skip "npm" "not required"; fi

# Docker
if is_required "compose kubernetes"; then check_docker || fail "Docker" "$DETAIL"
elif [[ "$PROFILE" == "all" ]]; then check_docker || warn "Docker" "$DETAIL"
else skip "Docker" "not required"; fi

if is_required "compose"; then check_compose || fail "Docker Compose" "$DETAIL"
else skip "Docker Compose" "not required"; fi

if is_required "kubernetes"; then check_kubectl || fail "kubectl" "$DETAIL"
else skip "kubectl" "not required"; fi

if is_required "kubernetes"; then check_k3d || fail "k3d" "$DETAIL"
else skip "k3d" "not required"; fi

if is_required "kubernetes"; then check_cluster || fail "Kubernetes cluster" "$DETAIL"
else skip "Kubernetes cluster" "not required"; fi

if [[ "$PROFILE" == "kubernetes" || "$PROFILE" == "all" ]]; then
  check_k3d_cluster || warn "k3d cluster (nrdc-poc)" "$DETAIL"
else skip "k3d cluster (nrdc-poc)" "not required"; fi

echo ""
echo "Profiles:"
echo "  dev         — npm run dev"
echo "  compose     — docker compose up"
echo "  kubernetes  — k3d + kubectl deploy"
echo ""

EXIT_CODE=0
if [[ "$FAILED" -eq 1 ]]; then
  echo "Result: MISSING required tools. See README.md for install links."
  EXIT_CODE=1
else
  echo "Result: All required tools for profile \"$PROFILE\" are ready."
fi

# Keep terminal open on Windows (Git Bash) unless --no-pause
SHOULD_PAUSE=0
if [[ -n "$PAUSE" ]]; then
  SHOULD_PAUSE=1
elif [[ -z "$NO_PAUSE" ]]; then
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) SHOULD_PAUSE=1 ;;
  esac
fi

if [[ "$SHOULD_PAUSE" -eq 1 ]]; then
  echo ""
  read -r -p "Press Enter to close..."
fi

exit "$EXIT_CODE"
