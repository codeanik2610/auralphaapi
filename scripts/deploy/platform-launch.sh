#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

WITH_EMAIL=false
SKIP_BUILD=false
SKIP_MIGRATE=false
SKIP_SMOKE=false
SKIP_POST_BOOTSTRAP=false
RUN_SEED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-email)
      WITH_EMAIL=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-migrate)
      SKIP_MIGRATE=true
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
    --seed)
      RUN_SEED=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Supported arguments: --with-email --skip-build --skip-migrate --skip-smoke --skip-post-bootstrap --seed" >&2
      exit 1
      ;;
  esac
done

echo "[1/5] Auditing production env files..."
bash "${SCRIPT_DIR}/platform-env-audit.sh"

echo "[2/5] Validating rendered compose config..."
bash "${SCRIPT_DIR}/platform-validate.sh"

echo "[3/5] Building, migrating, and starting the stack..."
first_run_args=()
if [[ "${WITH_EMAIL}" == "true" ]]; then
  first_run_args+=(--with-email)
fi
if [[ "${SKIP_BUILD}" == "true" ]]; then
  first_run_args+=(--skip-build)
fi
if [[ "${SKIP_MIGRATE}" == "true" ]]; then
  first_run_args+=(--skip-migrate)
fi
if [[ "${RUN_SEED}" == "true" ]]; then
  first_run_args+=(--seed)
fi
bash "${SCRIPT_DIR}/platform-first-run.sh" "${first_run_args[@]}"

if [[ "${SKIP_SMOKE}" != "true" ]]; then
  echo "[4/5] Running public smoke checks..."
  bash "${SCRIPT_DIR}/platform-smoke.sh"
else
  echo "[4/5] Skipping public smoke checks."
fi

if [[ "${SKIP_POST_BOOTSTRAP}" != "true" ]]; then
  echo "[5/5] Running post-bootstrap rebuilds..."
  bash "${SCRIPT_DIR}/platform-post-bootstrap.sh"
else
  echo "[5/5] Skipping post-bootstrap rebuilds."
fi

echo "Platform launch sequence completed successfully."
