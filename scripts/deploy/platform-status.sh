#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

validate_platform_inputs

APP_DOMAIN="$(read_env_value "${PLATFORM_ENV_FILE}" "APP_DOMAIN")"
API_DOMAIN="$(read_env_value "${PLATFORM_ENV_FILE}" "API_DOMAIN")"
DISCOVERY_DOMAIN="$(read_env_value "${PLATFORM_ENV_FILE}" "DISCOVERY_DOMAIN")"
PUBLIC_SCHEME="${PUBLIC_SCHEME:-$(read_env_value "${PLATFORM_ENV_FILE}" "PUBLIC_SCHEME")}"
PUBLIC_SCHEME="${PUBLIC_SCHEME:-https}"

compose ps

echo
echo "Public endpoints:"
echo "- ${PUBLIC_SCHEME}://${APP_DOMAIN}"
echo "- ${PUBLIC_SCHEME}://${APP_DOMAIN}/health"
echo "- ${PUBLIC_SCHEME}://${API_DOMAIN}/api/v1/health"
echo "- ${PUBLIC_SCHEME}://${API_DOMAIN}/api/v1/health/worker"
echo "- ${PUBLIC_SCHEME}://${DISCOVERY_DOMAIN}/health/ready"
