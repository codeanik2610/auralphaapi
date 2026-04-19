#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"

function usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/deploy/platform-write-ip-env.sh <droplet-ip>

Optional environment variables:
  LLM_API_KEY=<key>                 Discovery LLM API key. Defaults to replace_with_real_llm_key.
  PLATFORM_ENV_FORCE=true           Overwrite existing env files without creating a backup.
  PRODUCTION_BOOTSTRAP_*            Optional one-time seed values; preserved from the current backend env if present.

This writes the four production env files for the IP-only, self-hosted DB deployment:
  - deploy/.env.platform
  - environments/production/.env
  - ../aurAlphaSchedulerWorker/environments/production/.env
  - ../discovery-engine/environments/production/.env
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

DROPLET_IP="$1"
if [[ ! "${DROPLET_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected an IPv4 address, got: ${DROPLET_IP}" >&2
  exit 1
fi

BACKEND_ENV_FILE="${ROOT_DIR}/environments/production/.env"
WORKER_ENV_FILE="${ROOT_DIR}/../aurAlphaSchedulerWorker/environments/production/.env"
DISCOVERY_ENV_FILE="${ROOT_DIR}/../discovery-engine/environments/production/.env"
PLATFORM_ENV_FILE="${ROOT_DIR}/deploy/.env.platform"

function require_dir() {
  local path="$1"
  if [[ ! -d "${path}" ]]; then
    echo "Missing required directory: ${path}" >&2
    exit 1
  fi
}

function random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    local first
    local second
    first="$(tr -d '-\n' < /proc/sys/kernel/random/uuid)"
    second="$(tr -d '-\n' < /proc/sys/kernel/random/uuid)"
    printf '%s%s\n' "${first}" "${second}"
    return
  fi

  echo "Missing openssl and /proc uuid fallback; cannot generate secrets." >&2
  exit 1
}

function backup_if_needed() {
  local file="$1"
  if [[ -f "${file}" && "${PLATFORM_ENV_FORCE:-false}" != "true" ]]; then
    local backup="${file}.bak.$(date +%Y%m%d%H%M%S)"
    cp "${file}" "${backup}"
    echo "Backed up ${file} to ${backup}"
  fi
}

function read_existing_env_value() {
  local file="$1"
  local key="$2"
  local line
  if [[ ! -f "${file}" ]]; then
    return 0
  fi

  line="$(grep -E "^${key}=" "${file}" | tail -n 1 || true)"
  if [[ -n "${line}" ]]; then
    printf '%s\n' "${line#*=}"
  fi
}

function preserve_env_value() {
  local key="$1"
  local fallback="${2:-}"
  local shell_value="${!key-}"
  local existing_value

  if [[ -n "${shell_value}" ]]; then
    printf '%s\n' "${shell_value}"
    return
  fi

  existing_value="$(read_existing_env_value "${BACKEND_ENV_FILE}" "${key}")"
  if [[ -n "${existing_value}" ]]; then
    printf '%s\n' "${existing_value}"
    return
  fi

  printf '%s\n' "${fallback}"
}

require_dir "${ROOT_DIR}/environments/production"
require_dir "${ROOT_DIR}/../aurAlphaSchedulerWorker/environments/production"
require_dir "${ROOT_DIR}/../discovery-engine/environments/production"
require_dir "${ROOT_DIR}/deploy"

APP_API_KEY="auralpha_api_$(random_hex)"
AUTH_ACCESS_TOKEN_SECRET="auth_$(random_hex)"
DISCOVERY_SCHEDULER_SECRET="scheduler_$(random_hex)"
BROKER_ACCOUNT_SECRETS_KEY="broker_$(random_hex)"
DISCOVERY_JWT_SECRET="discovery_jwt_$(random_hex)"
MYSQL_PASSWORD="mysql_$(random_hex)"
MYSQL_ROOT_PASSWORD="mysql_root_$(random_hex)"
POSTGRES_PASSWORD="postgres_$(random_hex)"
REDIS_PASSWORD="redis_$(random_hex)"
LLM_KEY="${LLM_API_KEY:-llm_disabled_$(random_hex)}"
PRODUCTION_BOOTSTRAP_SEED_ENABLED="$(preserve_env_value PRODUCTION_BOOTSTRAP_SEED_ENABLED false)"
PRODUCTION_BOOTSTRAP_ADMIN_EMAIL="$(preserve_env_value PRODUCTION_BOOTSTRAP_ADMIN_EMAIL admin@auralpha.com)"
PRODUCTION_BOOTSTRAP_ADMIN_PASSWORD="$(preserve_env_value PRODUCTION_BOOTSTRAP_ADMIN_PASSWORD)"
PRODUCTION_BOOTSTRAP_ADMIN_FULL_NAME="$(preserve_env_value PRODUCTION_BOOTSTRAP_ADMIN_FULL_NAME "AurAlpha Admin")"
PRODUCTION_BOOTSTRAP_ADMIN_RESET_PASSWORD="$(preserve_env_value PRODUCTION_BOOTSTRAP_ADMIN_RESET_PASSWORD false)"
PRODUCTION_BOOTSTRAP_TIMEZONE="$(preserve_env_value PRODUCTION_BOOTSTRAP_TIMEZONE Asia/Kolkata)"
PRODUCTION_BOOTSTRAP_BROKER_KEYS="$(preserve_env_value PRODUCTION_BOOTSTRAP_BROKER_KEYS mudrex,delta_exchange)"
PRODUCTION_BOOTSTRAP_BROKER_KEY="$(preserve_env_value PRODUCTION_BOOTSTRAP_BROKER_KEY)"
PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_SCOPES="$(preserve_env_value PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_SCOPES system,admin)"
PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_STATUS="$(preserve_env_value PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_STATUS Idle)"
PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_MODE="$(preserve_env_value PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_MODE live)"
PRODUCTION_BOOTSTRAP_MUDREX_BASE_URL="$(preserve_env_value PRODUCTION_BOOTSTRAP_MUDREX_BASE_URL https://trade.mudrex.com)"
PRODUCTION_BOOTSTRAP_DELTA_BASE_URL="$(preserve_env_value PRODUCTION_BOOTSTRAP_DELTA_BASE_URL https://api.india.delta.exchange)"
PRODUCTION_BOOTSTRAP_STRATEGY_TEMPLATE_NAME="$(preserve_env_value PRODUCTION_BOOTSTRAP_STRATEGY_TEMPLATE_NAME "Bootstrap Momentum Guard")"

backup_if_needed "${PLATFORM_ENV_FILE}"
cat > "${PLATFORM_ENV_FILE}" <<EOF
APP_DOMAIN=${DROPLET_IP}
API_DOMAIN=${DROPLET_IP}
DISCOVERY_DOMAIN=${DROPLET_IP}
PUBLIC_SCHEME=http
CADDYFILE_PATH=./deploy/Caddyfile.ip-only

PLATFORM_HTTP_PORT=80
PLATFORM_HTTPS_PORT=443

FRONTEND_API_BASE_URL=http://${DROPLET_IP}/api/v1
FRONTEND_API_KEY=${APP_API_KEY}
FRONTEND_DISCOVERY_API_BASE_URL=http://${DROPLET_IP}/api/v1/discovery
FRONTEND_DISCOVERY_WS_URL=ws://${DROPLET_IP}/ws/discovery
FRONTEND_APP_API_TIMEOUT_MS=10000

DISCOVERY_NODE_BACKEND_API_KEY=${APP_API_KEY}

SELFHOSTED_MYSQL_DATABASE=auralpha
SELFHOSTED_MYSQL_USERNAME=auralpha
SELFHOSTED_MYSQL_PASSWORD=${MYSQL_PASSWORD}
SELFHOSTED_MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
SELFHOSTED_POSTGRES_DATABASE=auralpha
SELFHOSTED_POSTGRES_USERNAME=auralpha
SELFHOSTED_POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
SELFHOSTED_REDIS_PASSWORD=${REDIS_PASSWORD}
EOF

backup_if_needed "${BACKEND_ENV_FILE}"
cat > "${BACKEND_ENV_FILE}" <<EOF
APP_ENV=production
NODE_ENV=production
PORT=3000

APP_NAME=trading-apis
APP_SCHEMA=http
APP_HOST=${DROPLET_IP}
APP_BANNER=false
APP_ROUTE_PREFIX=/api/v1
APP_API_KEY=${APP_API_KEY}
APP_REQUIRE_API_KEY=true
APP_CORS_ORIGINS=http://${DROPLET_IP}

LOG_LEVEL=info
HTTP_REQUEST_TIMEOUT_MS=10000

ACTIVITY_EXPORT_STORAGE_MODE=filesystem
ACTIVITY_EXPORT_STORAGE_DIR=/app/storage/activity-exports

AUTH_ACCESS_TOKEN_SECRET=${AUTH_ACCESS_TOKEN_SECRET}
AUTH_ACCESS_TOKEN_TTL=15m
AUTH_REFRESH_TOKEN_DAYS=7
AUTH_LOGIN_PROTECTION_ENABLED=true
AUTH_LOGIN_MAX_ATTEMPTS=5
AUTH_LOGIN_IP_MAX_ATTEMPTS=20
AUTH_LOGIN_WINDOW_MINUTES=15
AUTH_LOGIN_LOCKOUT_MINUTES=15
AUTH_SEED_ENABLED=false
AUTH_SEED_EMAIL=
AUTH_SEED_PASSWORD=
AUTH_SEED_FULL_NAME=

PRODUCTION_BOOTSTRAP_SEED_ENABLED=${PRODUCTION_BOOTSTRAP_SEED_ENABLED}
PRODUCTION_BOOTSTRAP_ADMIN_EMAIL=${PRODUCTION_BOOTSTRAP_ADMIN_EMAIL}
PRODUCTION_BOOTSTRAP_ADMIN_PASSWORD=${PRODUCTION_BOOTSTRAP_ADMIN_PASSWORD}
PRODUCTION_BOOTSTRAP_ADMIN_FULL_NAME=${PRODUCTION_BOOTSTRAP_ADMIN_FULL_NAME}
PRODUCTION_BOOTSTRAP_ADMIN_RESET_PASSWORD=${PRODUCTION_BOOTSTRAP_ADMIN_RESET_PASSWORD}
PRODUCTION_BOOTSTRAP_TIMEZONE=${PRODUCTION_BOOTSTRAP_TIMEZONE}
PRODUCTION_BOOTSTRAP_BROKER_KEYS=${PRODUCTION_BOOTSTRAP_BROKER_KEYS}
PRODUCTION_BOOTSTRAP_BROKER_KEY=${PRODUCTION_BOOTSTRAP_BROKER_KEY}
PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_SCOPES=${PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_SCOPES}
PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_STATUS=${PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_STATUS}
PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_MODE=${PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_MODE}
PRODUCTION_BOOTSTRAP_MUDREX_BASE_URL=${PRODUCTION_BOOTSTRAP_MUDREX_BASE_URL}
PRODUCTION_BOOTSTRAP_DELTA_BASE_URL=${PRODUCTION_BOOTSTRAP_DELTA_BASE_URL}
PRODUCTION_BOOTSTRAP_STRATEGY_TEMPLATE_NAME=${PRODUCTION_BOOTSTRAP_STRATEGY_TEMPLATE_NAME}

DISCOVERY_API_BASE_URL=http://discovery-engine:8000/api/v1/discovery

SCHEDULER_EXECUTION_MODE=queue
SCHEDULER_SYSTEM_USER_ID=system
SCHEDULER_WORKER_SCHEMA=http
SCHEDULER_WORKER_HOST=auralpha-scheduler-worker
SCHEDULER_WORKER_PORT=3001
SCHEDULER_WORKER_BASE_URL=http://auralpha-scheduler-worker:3001
DISCOVERY_SCHEDULER_SECRET=${DISCOVERY_SCHEDULER_SECRET}

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0
REDIS_USERNAME=
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_TLS=false
REDIS_AUTO_START=false
WORKER_HEARTBEAT_KEY=scheduler:worker:heartbeat

BROKER_ACCOUNT_SECRETS_KEY=${BROKER_ACCOUNT_SECRETS_KEY}

DB_HOST=mysql
DB_PORT=3306
DB_USERNAME=auralpha
DB_PASSWORD=${MYSQL_PASSWORD}
DB_NAME=auralpha
DB_SYNCHRONIZE=false
DB_LOGGING=false

PG_DB_ENABLED=true
PG_DB_HOST=postgres
PG_DB_PORT=5432
PG_DB_USERNAME=auralpha
PG_DB_PASSWORD=${POSTGRES_PASSWORD}
PG_DB_NAME=auralpha
PG_DB_SSL=false
PG_DB_LOGGING=false
EOF

backup_if_needed "${WORKER_ENV_FILE}"
cat > "${WORKER_ENV_FILE}" <<EOF
LOG_LEVEL=info

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0
REDIS_USERNAME=
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_TLS=false
REDIS_AUTO_START=false

WORKER_ID=scheduler-worker-prod
WORKER_HTTP_HOST=0.0.0.0
WORKER_HTTP_PORT=3001
WORKER_HEARTBEAT_KEY=scheduler:worker:heartbeat
WORKER_HEARTBEAT_INTERVAL_MS=10000
WORKER_HEARTBEAT_TTL_SEC=30
SCHEDULER_COMMAND_POLL_INTERVAL_MS=5000
SCHEDULER_SYSTEM_USER_ID=system

TRADING_API_BASE_URL=http://auralpha-api:3000/api/v1
TRADING_API_HEALTH_URL=http://auralpha-api:3000/api/v1/health
DISCOVERY_ENGINE_BASE_URL=http://discovery-engine:8000/api/v1/discovery
DISCOVERY_ENGINE_HEALTH_URL=http://discovery-engine:8000/health/ready

BINANCE_FUTURES_BASE_URL=https://fapi.binance.com
CANDLES_INTERVAL=1m
CANDLES_LOOKBACK_DAYS=90

DB_HOST=mysql
DB_PORT=3306
DB_USERNAME=auralpha
DB_PASSWORD=${MYSQL_PASSWORD}
DB_NAME=auralpha

PG_DB_ENABLED=true
PG_DB_HOST=postgres
PG_DB_PORT=5432
PG_DB_USERNAME=auralpha
PG_DB_PASSWORD=${POSTGRES_PASSWORD}
PG_DB_NAME=auralpha
PG_DB_SSL=false

DISCOVERY_SCHEDULER_SECRET=${DISCOVERY_SCHEDULER_SECRET}
BROKER_ACCOUNT_SECRETS_KEY=${BROKER_ACCOUNT_SECRETS_KEY}
EOF

backup_if_needed "${DISCOVERY_ENV_FILE}"
cat > "${DISCOVERY_ENV_FILE}" <<EOF
NODE_ENV=production
PORT=8000

APP_NAME=discovery-engine
APP_SCHEMA=http
APP_HOST=${DROPLET_IP}
APP_BANNER=false
APP_ROUTE_PREFIX=/api/v1/discovery
APP_API_KEY=
APP_REQUIRE_API_KEY=false
APP_CORS_ORIGINS=http://${DROPLET_IP}

LOG_LEVEL=info
HTTP_REQUEST_TIMEOUT_MS=10000

OPS_AUTO_CAPTURE_ENABLED=true
OPS_CAPTURE_READ_REQUESTS=true
OPS_EMIT_FAILURE_ALERTS=true
OPS_EMIT_5XX_ALERTS=true
OPS_EMIT_4XX_MUTATION_ALERTS=true

SCHEDULER_EXECUTION_MODE=direct
SCHEDULER_WORKER_SCHEMA=http
SCHEDULER_WORKER_HOST=auralpha-scheduler-worker
SCHEDULER_WORKER_PORT=3001
SCHEDULER_WORKER_BASE_URL=http://auralpha-scheduler-worker:3001

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0
REDIS_USERNAME=
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_TLS=false
REDIS_AUTO_START=false
WORKER_HEARTBEAT_KEY=scheduler:worker:heartbeat
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

BROKER_ACCOUNT_SECRETS_KEY=${BROKER_ACCOUNT_SECRETS_KEY}
JWT_SECRET=${DISCOVERY_JWT_SECRET}
JWT_ALGORITHM=HS256

DB_HOST=mysql
DB_PORT=3306
DB_USERNAME=auralpha
DB_PASSWORD=${MYSQL_PASSWORD}
DB_NAME=auralpha
DB_SYNCHRONIZE=false
DB_LOGGING=false
DATABASE_URL=postgresql+asyncpg://auralpha:${POSTGRES_PASSWORD}@postgres:5432/auralpha
MYSQL_DATABASE_URL=mysql+aiomysql://auralpha:${MYSQL_PASSWORD}@mysql:3306/auralpha

NODE_BACKEND_URL=http://auralpha-api:3000/api/v1
NODE_BACKEND_API_KEY=${APP_API_KEY}
MAX_CONCURRENT_BOTS=10
LLM_API_KEY=${LLM_KEY}
LLM_MODEL=claude-sonnet-4-5-20250929
EOF

echo "Wrote IP-only self-hosted production env files for ${DROPLET_IP}:"
echo "- ${PLATFORM_ENV_FILE}"
echo "- ${BACKEND_ENV_FILE}"
echo "- ${WORKER_ENV_FILE}"
echo "- ${DISCOVERY_ENV_FILE}"
if [[ "${LLM_KEY}" == llm_disabled_* ]]; then
  echo
  echo "Reminder: discovery LLM features need a real LLM_API_KEY later."
fi
