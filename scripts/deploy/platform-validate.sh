#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

validate_platform_inputs

compose config > "${RENDERED_CONFIG_PATH}"

echo "Platform config rendered successfully: ${RENDERED_CONFIG_PATH}"
echo "Compose file: ${COMPOSE_FILE}"
echo "Platform env: ${PLATFORM_ENV_FILE}"
echo "Backend env: ${BACKEND_ENV_FILE}"
echo "Worker env: ${WORKER_ENV_FILE}"
echo "Discovery env: ${DISCOVERY_ENV_FILE}"
