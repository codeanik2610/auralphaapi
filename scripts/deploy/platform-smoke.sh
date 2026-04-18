#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

validate_platform_inputs

APP_DOMAIN="$(read_env_value "${PLATFORM_ENV_FILE}" "APP_DOMAIN")"
API_DOMAIN="$(read_env_value "${PLATFORM_ENV_FILE}" "API_DOMAIN")"
DISCOVERY_DOMAIN="$(read_env_value "${PLATFORM_ENV_FILE}" "DISCOVERY_DOMAIN")"

if [[ -z "${APP_DOMAIN}" || -z "${API_DOMAIN}" || -z "${DISCOVERY_DOMAIN}" ]]; then
  echo "APP_DOMAIN, API_DOMAIN, and DISCOVERY_DOMAIN must all be set in ${PLATFORM_ENV_FILE}" >&2
  exit 1
fi

require_command curl

compose ps

curl -fsSL "${PUBLIC_SCHEME}://${API_DOMAIN}/api/v1/health" >/dev/null
curl -fsSL "${PUBLIC_SCHEME}://${API_DOMAIN}/api/v1/health/worker" >/dev/null
curl -fsSL "${PUBLIC_SCHEME}://${DISCOVERY_DOMAIN}/health/ready" >/dev/null
curl -fsSL "${PUBLIC_SCHEME}://${APP_DOMAIN}/health" >/dev/null

echo "Platform smoke checks passed for:"
echo "- ${PUBLIC_SCHEME}://${API_DOMAIN}/api/v1/health"
echo "- ${PUBLIC_SCHEME}://${API_DOMAIN}/api/v1/health/worker"
echo "- ${PUBLIC_SCHEME}://${DISCOVERY_DOMAIN}/health/ready"
echo "- ${PUBLIC_SCHEME}://${APP_DOMAIN}/health"
