#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${AURALPHA_API_CONTAINER_NAME:-auralpha-auralpha-api-1}"
ARTIFACT_ROOT="${AURALPHA_GUARDRAIL_ARTIFACT_ROOT:-/opt/auralpha/guardrail-artifacts}"
ARTIFACT_DIR="${AURALPHA_BROKER_GUARDRAIL_CHECKPOINT_ARTIFACT_DIR:-/opt/auralpha/guardrail-artifacts/broker-guardrail-checkpoint}"
RETENTION_DAYS="${AURALPHA_BROKER_GUARDRAIL_CHECKPOINT_RETENTION_DAYS:-30}"
MAX_ARTIFACT_AGE_MINUTES="${SUGGESTED_TRADES_BROKER_GUARDRAIL_CHECKPOINT_MAX_ARTIFACT_AGE_MINUTES:-180}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${ARTIFACT_DIR}"

tmp_output="${ARTIFACT_DIR}/${timestamp}.tmp"
log_output="${ARTIFACT_DIR}/${timestamp}.log"
json_output="${ARTIFACT_DIR}/${timestamp}.json"
container_json_output="/tmp/auralpha-broker-guardrail-checkpoint-${timestamp}.json"

cleanup_tmp() {
  rm -f "${tmp_output}"
}
trap cleanup_tmp EXIT

set +e
docker exec \
  -e AURALPHA_GUARDRAIL_ARTIFACT_ROOT="${ARTIFACT_ROOT}" \
  -e SUGGESTED_TRADES_BROKER_GUARDRAIL_CHECKPOINT_MAX_ARTIFACT_AGE_MINUTES="${MAX_ARTIFACT_AGE_MINUTES}" \
  -e SUGGESTED_TRADES_BROKER_GUARDRAIL_CHECKPOINT_OUTPUT_FILE="${container_json_output}" \
  "${CONTAINER_NAME}" \
  node dist/scripts/checks/check-suggested-trades-broker-guardrail-checkpoint.js \
  >"${tmp_output}" 2>&1
status=$?
set -e

mv "${tmp_output}" "${log_output}"
trap - EXIT

if docker cp "${CONTAINER_NAME}:${container_json_output}" "${json_output}" >/dev/null 2>&1; then
  docker exec "${CONTAINER_NAME}" rm -f "${container_json_output}" >/dev/null 2>&1 || true
else
  docker exec "${CONTAINER_NAME}" rm -f "${container_json_output}" >/dev/null 2>&1 || true
  json_line="$(sed -n 's/^suggested-trades-broker-guardrail-checkpoint: //p' "${log_output}" | tail -n 1)"
  if [[ -n "${json_line}" ]]; then
    printf '%s\n' "${json_line}" >"${json_output}"
  fi
fi

find "${ARTIFACT_DIR}" -type f -mtime +"${RETENTION_DAYS}" -delete

if [[ "${status}" -ne 0 ]]; then
  echo "Broker guardrail checkpoint failed; see ${log_output}" >&2
  exit "${status}"
fi

if [[ ! -s "${json_output}" ]]; then
  echo "Broker guardrail checkpoint produced no JSON artifact; see ${log_output}" >&2
  exit 1
fi

echo "Broker guardrail checkpoint passed; artifact=${json_output}"
