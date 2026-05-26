#!/bin/bash
set -euo pipefail

mkdir -p /zeroclaw-data/workspace/skills/nrdc-cluster-ops
mkdir -p /root/.zeroclaw

if [ -f /config/config.toml ]; then
  cp /config/config.toml /root/.zeroclaw/config.toml
fi

if [ -f /skills/SKILL.md ]; then
  cp /skills/SKILL.md /zeroclaw-data/workspace/skills/nrdc-cluster-ops/SKILL.md
fi

export ZEROCLAW_ALLOW_PUBLIC_BIND="${ZEROCLAW_ALLOW_PUBLIC_BIND:-true}"
export ZEROCLAW_GATEWAY_PORT="${ZEROCLAW_GATEWAY_PORT:-42617}"

# Gateway exposes /health for probes; CronJob runs deterministic health-repair.sh
exec zeroclaw gateway
