#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${AURALPHA_API_CONTAINER_NAME:-auralpha-auralpha-api-1}"
ARTIFACT_DIR="${AURALPHA_MUDREX_PROTECTION_HEALTH_ARTIFACT_DIR:-/opt/auralpha/guardrail-artifacts/mudrex-protection-health}"
RETENTION_DAYS="${AURALPHA_MUDREX_PROTECTION_HEALTH_RETENTION_DAYS:-14}"
LOOKBACK_DAYS="${SUGGESTED_TRADES_MUDREX_PROTECTION_LOOKBACK_DAYS:-7}"
LIMIT="${SUGGESTED_TRADES_MUDREX_PROTECTION_LIMIT:-1000}"
MAX_MISSING_POSITION_READ_MODEL="${SUGGESTED_TRADES_MAX_MUDREX_MISSING_POSITION_READ_MODEL:-0}"
MAX_MISSING_ACTIVE_STOP_LOSS="${SUGGESTED_TRADES_MAX_MUDREX_MISSING_ACTIVE_STOP_LOSS:-0}"
MAX_MISSING_ACTIVE_TAKE_PROFIT="${SUGGESTED_TRADES_MAX_MUDREX_MISSING_ACTIVE_TAKE_PROFIT:-0}"
MAX_STALE_PROTECTION_FOR_CLOSED_POSITION="${SUGGESTED_TRADES_MAX_MUDREX_STALE_PROTECTION_FOR_CLOSED_POSITION:-0}"
MAX_PARTIAL_FILL_PROTECTION_MISMATCH="${SUGGESTED_TRADES_MAX_MUDREX_PARTIAL_FILL_PROTECTION_MISMATCH:-0}"
MAX_UNSAFE_POSITION_MISMATCH="${SUGGESTED_TRADES_MAX_MUDREX_UNSAFE_POSITION_MISMATCH:-0}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${ARTIFACT_DIR}"

tmp_output="${ARTIFACT_DIR}/${timestamp}.tmp"
log_output="${ARTIFACT_DIR}/${timestamp}.log"
json_output="${ARTIFACT_DIR}/${timestamp}.json"

cleanup_tmp() {
  rm -f "${tmp_output}"
}
trap cleanup_tmp EXIT

set +e
docker exec \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_LOOKBACK_DAYS="${LOOKBACK_DAYS}" \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_LIMIT="${LIMIT}" \
  -e SUGGESTED_TRADES_MAX_MUDREX_MISSING_POSITION_READ_MODEL="${MAX_MISSING_POSITION_READ_MODEL}" \
  -e SUGGESTED_TRADES_MAX_MUDREX_MISSING_ACTIVE_STOP_LOSS="${MAX_MISSING_ACTIVE_STOP_LOSS}" \
  -e SUGGESTED_TRADES_MAX_MUDREX_MISSING_ACTIVE_TAKE_PROFIT="${MAX_MISSING_ACTIVE_TAKE_PROFIT}" \
  -e SUGGESTED_TRADES_MAX_MUDREX_STALE_PROTECTION_FOR_CLOSED_POSITION="${MAX_STALE_PROTECTION_FOR_CLOSED_POSITION}" \
  -e SUGGESTED_TRADES_MAX_MUDREX_PARTIAL_FILL_PROTECTION_MISMATCH="${MAX_PARTIAL_FILL_PROTECTION_MISMATCH}" \
  -e SUGGESTED_TRADES_MAX_MUDREX_UNSAFE_POSITION_MISMATCH="${MAX_UNSAFE_POSITION_MISMATCH}" \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_HEALTH_OUTPUT_FILE="" \
  "${CONTAINER_NAME}" \
  node dist/scripts/checks/check-suggested-trades-mudrex-protection-health.js \
  >"${tmp_output}" 2>&1
status=$?
set -e

mv "${tmp_output}" "${log_output}"
trap - EXIT

json_line="$(sed -n 's/^suggested-trades-mudrex-protection-health: //p' "${log_output}" | tail -n 1)"
if [[ -n "${json_line}" ]]; then
  printf '%s\n' "${json_line}" >"${json_output}"
fi

find "${ARTIFACT_DIR}" -type f -mtime +"${RETENTION_DAYS}" -delete

if [[ "${status}" -ne 0 ]]; then
  echo "Mudrex protection-health guardrail failed; see ${log_output}" >&2
  exit "${status}"
fi

if [[ ! -s "${json_output}" ]]; then
  echo "Mudrex protection-health guardrail produced no JSON artifact; see ${log_output}" >&2
  exit 1
fi

echo "Mudrex protection-health guardrail passed; artifact=${json_output}"
