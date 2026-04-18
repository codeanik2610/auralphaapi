#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

WITH_EMAIL=false
SKIP_SMOKE=false
SKIP_POST_BOOTSTRAP=false
FORCE_ENV=false
DROPLET_IP=""

function usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/platform-launch-ip-selfhosted.sh <droplet-ip> [options]

Options:
  --with-email             Start the optional email worker.
  --skip-smoke             Skip public smoke checks.
  --skip-post-bootstrap    Skip post-bootstrap rebuilds.
  --force-env              Overwrite existing env files instead of backing them up.

Optional environment variables:
  LLM_API_KEY=<key>        Real discovery LLM API key. If omitted, discovery starts with a generated disabled placeholder.

This is the one-command path for a no-domain, self-hosted DB Droplet deployment.
It writes all production env files, generates internal secrets, validates the stack,
starts MySQL/PostgreSQL/Redis, builds images, runs backend migrations, and launches.
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

DROPLET_IP="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-email)
      WITH_EMAIL=true
      shift
      ;;
    --skip-smoke)
      SKIP_SMOKE=true
      shift
      ;;
    --skip-post-bootstrap)
      SKIP_POST_BOOTSTRAP=true
      shift
      ;;
    --force-env)
      FORCE_ENV=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! "${DROPLET_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected an IPv4 address, got: ${DROPLET_IP}" >&2
  exit 1
fi

echo "[1/6] Writing IP-only self-hosted env files..."
if [[ "${FORCE_ENV}" == "true" ]]; then
  PLATFORM_ENV_FORCE=true bash "${SCRIPT_DIR}/platform-write-ip-env.sh" "${DROPLET_IP}"
else
  bash "${SCRIPT_DIR}/platform-write-ip-env.sh" "${DROPLET_IP}"
fi

export PLATFORM_COMPOSE_OVERRIDE_FILE=./docker-compose.selfhosted-db.yml

echo "[2/6] Auditing generated env files..."
bash "${SCRIPT_DIR}/platform-env-audit.sh"

echo "[3/6] Validating compose config..."
bash "${SCRIPT_DIR}/platform-validate.sh"

echo "[4/6] Building, migrating, and starting the stack..."
launch_args=()
if [[ "${WITH_EMAIL}" == "true" ]]; then
  launch_args+=(--with-email)
fi
if [[ "${SKIP_SMOKE}" == "true" ]]; then
  launch_args+=(--skip-smoke)
fi
if [[ "${SKIP_POST_BOOTSTRAP}" == "true" ]]; then
  launch_args+=(--skip-post-bootstrap)
fi
bash "${SCRIPT_DIR}/platform-launch.sh" "${launch_args[@]}"

echo "[5/6] Current platform status..."
bash "${SCRIPT_DIR}/platform-status.sh"

echo "[6/6] Done."
echo "Open: http://${DROPLET_IP}"
echo "API health: http://${DROPLET_IP}/api/v1/health"
echo "Worker health: http://${DROPLET_IP}/api/v1/health/worker"
echo "Discovery health: http://${DROPLET_IP}/health/ready"
