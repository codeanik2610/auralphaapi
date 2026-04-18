#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/../.." && pwd)"

COMPOSE_FILE="${PLATFORM_COMPOSE_FILE:-${ROOT_DIR}/docker-compose.platform.yml}"
COMPOSE_OVERRIDE_FILE="${PLATFORM_COMPOSE_OVERRIDE_FILE:-}"
PLATFORM_ENV_FILE="${PLATFORM_ENV_FILE:-${ROOT_DIR}/deploy/.env.platform}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-${ROOT_DIR}/environments/production/.env}"
WORKER_ENV_FILE="${WORKER_ENV_FILE:-${ROOT_DIR}/../aurAlphaSchedulerWorker/environments/production/.env}"
DISCOVERY_ENV_FILE="${DISCOVERY_ENV_FILE:-${ROOT_DIR}/../discovery-engine/environments/production/.env}"
RENDERED_CONFIG_PATH="${RENDERED_CONFIG_PATH:-/tmp/auralpha-platform.compose.rendered.yml}"
PUBLIC_SCHEME="${PUBLIC_SCHEME:-https}"

function require_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    echo "Missing required file: ${path}" >&2
    exit 1
  fi
}

function require_directory() {
  local path="$1"
  if [[ ! -d "${path}" ]]; then
    echo "Missing required directory: ${path}" >&2
    exit 1
  fi
}

function require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    exit 1
  fi
}

function check_no_localhost() {
  local path="$1"
  if grep -nE 'localhost|127\.0\.0\.1' "${path}" >/dev/null 2>&1; then
    echo "Refusing to continue because localhost-style values were found in ${path}" >&2
    grep -nE 'localhost|127\.0\.0\.1' "${path}" >&2 || true
    exit 1
  fi
}

function repo_layout_checks() {
  require_directory "${ROOT_DIR}/../aurAlphaSchedulerWorker"
  require_directory "${ROOT_DIR}/../discovery-engine"
  require_directory "${ROOT_DIR}/../../Frontend/aurAlphaApp"
}

function env_file_checks() {
  require_file "${COMPOSE_FILE}"
  if [[ -n "${COMPOSE_OVERRIDE_FILE}" ]]; then
    require_file "${COMPOSE_OVERRIDE_FILE}"
  fi
  require_file "${PLATFORM_ENV_FILE}"
  require_file "${BACKEND_ENV_FILE}"
  require_file "${WORKER_ENV_FILE}"
  require_file "${DISCOVERY_ENV_FILE}"
  check_no_localhost "${PLATFORM_ENV_FILE}"
  check_no_localhost "${BACKEND_ENV_FILE}"
  check_no_localhost "${WORKER_ENV_FILE}"
  check_no_localhost "${DISCOVERY_ENV_FILE}"
}

function docker_checks() {
  require_command docker
  docker compose version >/dev/null
}

function compose() {
  local compose_args=("--env-file" "${PLATFORM_ENV_FILE}" "-f" "${COMPOSE_FILE}")
  if [[ -n "${COMPOSE_OVERRIDE_FILE}" ]]; then
    compose_args+=("-f" "${COMPOSE_OVERRIDE_FILE}")
  fi

  BACKEND_ENV_FILE="${BACKEND_ENV_FILE}" \
  WORKER_ENV_FILE="${WORKER_ENV_FILE}" \
  DISCOVERY_ENV_FILE="${DISCOVERY_ENV_FILE}" \
  docker compose "${compose_args[@]}" "$@"
}

function read_env_value() {
  local file="$1"
  local key="$2"
  local raw
  raw="$(awk -F= -v k="${key}" '$1 == k { print substr($0, index($0, "=") + 1); exit }' "${file}")"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s\n' "${raw}"
}

function validate_platform_inputs() {
  repo_layout_checks
  env_file_checks
  docker_checks
}

function uses_selfhosted_db_stack() {
  [[ -n "${COMPOSE_OVERRIDE_FILE}" && "$(basename "${COMPOSE_OVERRIDE_FILE}")" == "docker-compose.selfhosted-db.yml" ]]
}

function ensure_selfhosted_db_services() {
  if uses_selfhosted_db_stack; then
    compose up -d mysql postgres redis
  fi
}
