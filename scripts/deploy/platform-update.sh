#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

WITH_EMAIL=false
WITH_PULL=false
SKIP_BUILD=false
SKIP_MIGRATE=false
RUN_SEED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-email)
      WITH_EMAIL=true
      shift
      ;;
    --with-pull)
      WITH_PULL=true
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
    --seed)
      RUN_SEED=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Supported arguments: --with-email --with-pull --skip-build --skip-migrate --seed" >&2
      exit 1
      ;;
  esac
done

validate_platform_inputs
ensure_selfhosted_db_services

if [[ "${WITH_PULL}" == "true" ]]; then
  require_command git
  git -C "${ROOT_DIR}" pull
  git -C "${ROOT_DIR}/../aurAlphaSchedulerWorker" pull
  git -C "${ROOT_DIR}/../discovery-engine" pull
  git -C "${ROOT_DIR}/../../Frontend/aurAlphaApp" pull
fi

profile_args=()
if [[ "${WITH_EMAIL}" == "true" ]]; then
  profile_args+=(--profile email)
fi

if [[ "${SKIP_BUILD}" != "true" ]]; then
  compose "${profile_args[@]}" build
fi

if [[ "${SKIP_MIGRATE}" != "true" ]]; then
  compose run --rm --no-deps auralpha-api node dist/scripts/db/db-run-migrations.js
fi

if [[ "${RUN_SEED}" == "true" || "$(read_env_value "${BACKEND_ENV_FILE}" "PRODUCTION_BOOTSTRAP_SEED_ENABLED")" == "true" ]]; then
  compose run --rm --no-deps auralpha-api node dist/scripts/db/db-seed-production-bootstrap.js
fi

compose "${profile_args[@]}" up -d

echo "Platform update completed successfully."
echo "Run the smoke checks next with: bash scripts/deploy/platform-smoke.sh"
