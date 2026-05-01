#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

errors=()

function add_error() {
  errors+=("$1")
}

function require_nonempty() {
  local file="$1"
  local key="$2"
  local label="$3"
  local value
  value="$(read_env_value "${file}" "${key}")"
  if [[ -z "${value}" ]]; then
    add_error "${label} must not be empty (${file}: ${key})"
  fi
}

function require_not_placeholder() {
  local file="$1"
  local key="$2"
  local label="$3"
  local value
  value="$(read_env_value "${file}" "${key}")"

  if [[ -z "${value}" ]]; then
    add_error "${label} must not be empty (${file}: ${key})"
    return
  fi

  if [[ "${value}" == *"example.com"* || "${value}" == *"xxxxx"* || "${value}" == *"<"* || "${value}" == *">"* ]]; then
    add_error "${label} still looks like a placeholder (${file}: ${key}=${value})"
  fi
}

function require_equals() {
  local file_a="$1"
  local key_a="$2"
  local file_b="$3"
  local key_b="$4"
  local label="$5"
  local value_a
  local value_b
  value_a="$(read_env_value "${file_a}" "${key_a}")"
  value_b="$(read_env_value "${file_b}" "${key_b}")"
  if [[ -z "${value_a}" || -z "${value_b}" ]]; then
    add_error "${label} must be set in both files (${file_a}: ${key_a}, ${file_b}: ${key_b})"
    return
  fi
  if [[ "${value_a}" != "${value_b}" ]]; then
    add_error "${label} must match (${file_a}: ${key_a} != ${file_b}: ${key_b})"
  fi
}

validate_platform_inputs

require_not_placeholder "${PLATFORM_ENV_FILE}" "APP_DOMAIN" "Platform app domain"
require_not_placeholder "${PLATFORM_ENV_FILE}" "API_DOMAIN" "Platform API domain"
require_not_placeholder "${PLATFORM_ENV_FILE}" "DISCOVERY_DOMAIN" "Platform discovery domain"
require_not_placeholder "${PLATFORM_ENV_FILE}" "FRONTEND_API_BASE_URL" "Frontend API base URL"
require_not_placeholder "${PLATFORM_ENV_FILE}" "FRONTEND_DISCOVERY_API_BASE_URL" "Frontend discovery API base URL"
require_not_placeholder "${PLATFORM_ENV_FILE}" "FRONTEND_DISCOVERY_WS_URL" "Frontend discovery websocket URL"
require_nonempty "${PLATFORM_ENV_FILE}" "FRONTEND_API_KEY" "Frontend API key"
require_nonempty "${PLATFORM_ENV_FILE}" "DISCOVERY_NODE_BACKEND_API_KEY" "Discovery backend API key"

require_not_placeholder "${BACKEND_ENV_FILE}" "APP_HOST" "Backend app host"
require_nonempty "${BACKEND_ENV_FILE}" "APP_CORS_ORIGINS" "Backend CORS origins"
require_nonempty "${BACKEND_ENV_FILE}" "APP_API_KEY" "Backend API key"
require_nonempty "${BACKEND_ENV_FILE}" "AUTH_ACCESS_TOKEN_SECRET" "Backend auth access token secret"
require_nonempty "${BACKEND_ENV_FILE}" "DISCOVERY_SCHEDULER_SECRET" "Backend discovery scheduler secret"
require_nonempty "${BACKEND_ENV_FILE}" "BROKER_ACCOUNT_SECRETS_KEY" "Backend broker account secrets key"
require_not_placeholder "${BACKEND_ENV_FILE}" "DB_HOST" "Backend MySQL host"
require_nonempty "${BACKEND_ENV_FILE}" "DB_PASSWORD" "Backend MySQL password"
require_nonempty "${BACKEND_ENV_FILE}" "DB_NAME" "Backend MySQL database"
require_not_placeholder "${BACKEND_ENV_FILE}" "PG_DB_HOST" "Backend PostgreSQL host"
require_nonempty "${BACKEND_ENV_FILE}" "PG_DB_PASSWORD" "Backend PostgreSQL password"
require_nonempty "${BACKEND_ENV_FILE}" "PG_DB_NAME" "Backend PostgreSQL database"
require_not_placeholder "${BACKEND_ENV_FILE}" "REDIS_HOST" "Backend Redis host"
require_nonempty "${BACKEND_ENV_FILE}" "REDIS_PASSWORD" "Backend Redis password"

require_nonempty "${WORKER_ENV_FILE}" "DISCOVERY_SCHEDULER_SECRET" "Worker discovery scheduler secret"
require_nonempty "${WORKER_ENV_FILE}" "BROKER_ACCOUNT_SECRETS_KEY" "Worker broker account secrets key"
require_not_placeholder "${WORKER_ENV_FILE}" "DB_HOST" "Worker MySQL host"
require_nonempty "${WORKER_ENV_FILE}" "DB_PASSWORD" "Worker MySQL password"
require_not_placeholder "${WORKER_ENV_FILE}" "PG_DB_HOST" "Worker PostgreSQL host"
require_nonempty "${WORKER_ENV_FILE}" "PG_DB_PASSWORD" "Worker PostgreSQL password"
require_not_placeholder "${WORKER_ENV_FILE}" "REDIS_HOST" "Worker Redis host"
require_nonempty "${WORKER_ENV_FILE}" "REDIS_PASSWORD" "Worker Redis password"

require_not_placeholder "${DISCOVERY_ENV_FILE}" "APP_HOST" "Discovery app host"
require_nonempty "${DISCOVERY_ENV_FILE}" "APP_CORS_ORIGINS" "Discovery CORS origins"
require_nonempty "${DISCOVERY_ENV_FILE}" "BROKER_ACCOUNT_SECRETS_KEY" "Discovery broker account secrets key"
require_nonempty "${DISCOVERY_ENV_FILE}" "SCHEDULER_SECRET" "Discovery scheduler secret"
require_nonempty "${DISCOVERY_ENV_FILE}" "JWT_SECRET" "Discovery JWT secret"
require_not_placeholder "${DISCOVERY_ENV_FILE}" "DB_HOST" "Discovery MySQL host"
require_nonempty "${DISCOVERY_ENV_FILE}" "DB_PASSWORD" "Discovery MySQL password"
require_not_placeholder "${DISCOVERY_ENV_FILE}" "DATABASE_URL" "Discovery PostgreSQL URL"
require_not_placeholder "${DISCOVERY_ENV_FILE}" "MYSQL_DATABASE_URL" "Discovery MySQL URL"
require_not_placeholder "${DISCOVERY_ENV_FILE}" "REDIS_HOST" "Discovery Redis host"
require_nonempty "${DISCOVERY_ENV_FILE}" "REDIS_PASSWORD" "Discovery Redis password"
require_nonempty "${DISCOVERY_ENV_FILE}" "NODE_BACKEND_API_KEY" "Discovery backend API key"
require_nonempty "${DISCOVERY_ENV_FILE}" "LLM_API_KEY" "Discovery LLM API key"

require_equals "${BACKEND_ENV_FILE}" "APP_API_KEY" "${PLATFORM_ENV_FILE}" "FRONTEND_API_KEY" "Frontend API key"
require_equals "${BACKEND_ENV_FILE}" "APP_API_KEY" "${PLATFORM_ENV_FILE}" "DISCOVERY_NODE_BACKEND_API_KEY" "Platform discovery backend API key"
require_equals "${BACKEND_ENV_FILE}" "APP_API_KEY" "${DISCOVERY_ENV_FILE}" "NODE_BACKEND_API_KEY" "Discovery backend API key"
require_equals "${BACKEND_ENV_FILE}" "BROKER_ACCOUNT_SECRETS_KEY" "${WORKER_ENV_FILE}" "BROKER_ACCOUNT_SECRETS_KEY" "Broker account secrets key"
require_equals "${BACKEND_ENV_FILE}" "BROKER_ACCOUNT_SECRETS_KEY" "${DISCOVERY_ENV_FILE}" "BROKER_ACCOUNT_SECRETS_KEY" "Discovery broker account secrets key"
require_equals "${BACKEND_ENV_FILE}" "DISCOVERY_SCHEDULER_SECRET" "${WORKER_ENV_FILE}" "DISCOVERY_SCHEDULER_SECRET" "Worker discovery scheduler secret"
require_equals "${BACKEND_ENV_FILE}" "DISCOVERY_SCHEDULER_SECRET" "${DISCOVERY_ENV_FILE}" "SCHEDULER_SECRET" "Discovery scheduler secret"

if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "WHATSAPP_DELIVERY_ENABLED")" == "true" ]]; then
  require_nonempty "${BACKEND_ENV_FILE}" "WHATSAPP_TWILIO_ACCOUNT_SID" "WhatsApp Twilio account SID"
  require_nonempty "${BACKEND_ENV_FILE}" "WHATSAPP_TWILIO_AUTH_TOKEN" "WhatsApp Twilio auth token"
  require_nonempty "${BACKEND_ENV_FILE}" "WHATSAPP_TWILIO_FROM" "WhatsApp Twilio sender"
fi

if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "APP_HOST")" != "$(read_env_value "${PLATFORM_ENV_FILE}" "API_DOMAIN")" ]]; then
  add_error "Backend APP_HOST must match platform API_DOMAIN"
fi

if [[ "$(read_env_value "${DISCOVERY_ENV_FILE}" "APP_HOST")" != "$(read_env_value "${PLATFORM_ENV_FILE}" "DISCOVERY_DOMAIN")" ]]; then
  add_error "Discovery APP_HOST must match platform DISCOVERY_DOMAIN"
fi

if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "AUTH_SEED_ENABLED")" != "false" ]]; then
  add_error "AUTH_SEED_ENABLED must stay false in production"
fi

if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "PRODUCTION_BOOTSTRAP_SEED_ENABLED")" == "true" ]]; then
  require_nonempty "${BACKEND_ENV_FILE}" "PRODUCTION_BOOTSTRAP_ADMIN_EMAIL" "Bootstrap admin email"
  require_nonempty "${BACKEND_ENV_FILE}" "PRODUCTION_BOOTSTRAP_ADMIN_PASSWORD" "Bootstrap admin password"
  require_nonempty "${BACKEND_ENV_FILE}" "PRODUCTION_BOOTSTRAP_ADMIN_FULL_NAME" "Bootstrap admin full name"

  if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "PRODUCTION_BOOTSTRAP_ADMIN_EMAIL")" != "admin@auralpha.com" ]]; then
    add_error "Bootstrap admin email must be admin@auralpha.com"
  fi

  bootstrap_broker_keys="$(read_env_value "${BACKEND_ENV_FILE}" "PRODUCTION_BOOTSTRAP_BROKER_KEYS")"
  if [[ -z "${bootstrap_broker_keys}" ]]; then
    bootstrap_broker_keys="$(read_env_value "${BACKEND_ENV_FILE}" "PRODUCTION_BOOTSTRAP_BROKER_KEY")"
  fi
  if [[ -z "${bootstrap_broker_keys}" ]]; then
    bootstrap_broker_keys="mudrex,delta_exchange"
  fi

  IFS=',' read -r -a bootstrap_broker_key_items <<< "${bootstrap_broker_keys}"
  for raw_bootstrap_broker_key in "${bootstrap_broker_key_items[@]}"; do
    bootstrap_broker_key="${raw_bootstrap_broker_key//[[:space:]]/}"
    bootstrap_broker_key="${bootstrap_broker_key,,}"
    case "${bootstrap_broker_key}" in
      mudrex|delta_exchange)
        ;;
      "")
        ;;
      *)
        add_error "Unsupported production bootstrap broker (${bootstrap_broker_key}); expected mudrex or delta_exchange"
        ;;
    esac
  done
fi

if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "DB_SYNCHRONIZE")" != "false" ]]; then
  add_error "DB_SYNCHRONIZE must stay false in production"
fi

if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "REDIS_AUTO_START")" != "false" ]]; then
  add_error "Backend REDIS_AUTO_START must stay false in production"
fi

if [[ "$(read_env_value "${WORKER_ENV_FILE}" "REDIS_AUTO_START")" != "false" ]]; then
  add_error "Worker REDIS_AUTO_START must stay false in production"
fi

if [[ "$(read_env_value "${DISCOVERY_ENV_FILE}" "REDIS_AUTO_START")" != "false" ]]; then
  add_error "Discovery REDIS_AUTO_START must stay false in production"
fi

if uses_selfhosted_db_stack; then
  require_nonempty "${PLATFORM_ENV_FILE}" "SELFHOSTED_MYSQL_PASSWORD" "Self-hosted MySQL password"
  require_nonempty "${PLATFORM_ENV_FILE}" "SELFHOSTED_MYSQL_ROOT_PASSWORD" "Self-hosted MySQL root password"
  require_nonempty "${PLATFORM_ENV_FILE}" "SELFHOSTED_POSTGRES_PASSWORD" "Self-hosted PostgreSQL password"
  require_nonempty "${PLATFORM_ENV_FILE}" "SELFHOSTED_REDIS_PASSWORD" "Self-hosted Redis password"

  if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "DB_HOST")" != "mysql" ]]; then
    add_error "Backend DB_HOST must be mysql when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "PG_DB_HOST")" != "postgres" ]]; then
    add_error "Backend PG_DB_HOST must be postgres when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "REDIS_HOST")" != "redis" ]]; then
    add_error "Backend REDIS_HOST must be redis when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "PG_DB_SSL")" != "false" ]]; then
    add_error "Backend PG_DB_SSL must be false when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${BACKEND_ENV_FILE}" "REDIS_TLS")" != "false" ]]; then
    add_error "Backend REDIS_TLS must be false when using the self-hosted DB stack"
  fi

  if [[ "$(read_env_value "${WORKER_ENV_FILE}" "DB_HOST")" != "mysql" ]]; then
    add_error "Worker DB_HOST must be mysql when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${WORKER_ENV_FILE}" "PG_DB_HOST")" != "postgres" ]]; then
    add_error "Worker PG_DB_HOST must be postgres when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${WORKER_ENV_FILE}" "REDIS_HOST")" != "redis" ]]; then
    add_error "Worker REDIS_HOST must be redis when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${WORKER_ENV_FILE}" "PG_DB_SSL")" != "false" ]]; then
    add_error "Worker PG_DB_SSL must be false when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${WORKER_ENV_FILE}" "REDIS_TLS")" != "false" ]]; then
    add_error "Worker REDIS_TLS must be false when using the self-hosted DB stack"
  fi

  if [[ "$(read_env_value "${DISCOVERY_ENV_FILE}" "DB_HOST")" != "mysql" ]]; then
    add_error "Discovery DB_HOST must be mysql when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${DISCOVERY_ENV_FILE}" "REDIS_HOST")" != "redis" ]]; then
    add_error "Discovery REDIS_HOST must be redis when using the self-hosted DB stack"
  fi
  if [[ "$(read_env_value "${DISCOVERY_ENV_FILE}" "REDIS_TLS")" != "false" ]]; then
    add_error "Discovery REDIS_TLS must be false when using the self-hosted DB stack"
  fi
fi

if (( ${#errors[@]} > 0 )); then
  printf 'Platform env audit failed with %d issue(s):\n' "${#errors[@]}" >&2
  for err in "${errors[@]}"; do
    printf -- '- %s\n' "${err}" >&2
  done
  exit 1
fi

echo "Platform env audit passed."
