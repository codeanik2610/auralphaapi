#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${AURALPHA_API_CONTAINER_NAME:-auralpha-auralpha-api-1}"
ARTIFACT_DIR="${AURALPHA_DELTA_POSITION_RESOLUTION_ARTIFACT_DIR:-/opt/auralpha/guardrail-artifacts/delta-position-resolution}"
RETENTION_DAYS="${AURALPHA_DELTA_POSITION_RESOLUTION_RETENTION_DAYS:-14}"
LOOKBACK_DAYS="${SUGGESTED_TRADES_DELTA_POSITION_LOOKBACK_DAYS:-7}"
LIMIT="${SUGGESTED_TRADES_DELTA_POSITION_RESOLUTION_LIMIT:-1000}"
MAX_UNSAFE_MISMATCHES="${SUGGESTED_TRADES_MAX_DELTA_POSITION_UNSAFE_MISMATCHES:-0}"
MAX_UNRESOLVED="${SUGGESTED_TRADES_MAX_DELTA_POSITION_UNRESOLVED:-0}"

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
  -e SUGGESTED_TRADES_DELTA_POSITION_LOOKBACK_DAYS="${LOOKBACK_DAYS}" \
  -e SUGGESTED_TRADES_DELTA_POSITION_RESOLUTION_LIMIT="${LIMIT}" \
  -e SUGGESTED_TRADES_MAX_DELTA_POSITION_UNSAFE_MISMATCHES="${MAX_UNSAFE_MISMATCHES}" \
  -e SUGGESTED_TRADES_MAX_DELTA_POSITION_UNRESOLVED="${MAX_UNRESOLVED}" \
  -e SUGGESTED_TRADES_DELTA_POSITION_RESOLUTION_OUTPUT_FILE="" \
  "${CONTAINER_NAME}" \
  node dist/scripts/checks/check-suggested-trades-delta-position-resolution.js \
  >"${tmp_output}" 2>&1
status=$?
set -e

mv "${tmp_output}" "${log_output}"
trap - EXIT

json_line="$(sed -n 's/^suggested-trades-delta-position-resolution: //p' "${log_output}" | tail -n 1)"
if [[ -n "${json_line}" ]]; then
  printf '%s\n' "${json_line}" >"${json_output}"
fi

find "${ARTIFACT_DIR}" -type f -mtime +"${RETENTION_DAYS}" -delete

if [[ "${status}" -ne 0 ]]; then
  echo "Delta position-resolution guardrail failed; see ${log_output}" >&2
  exit "${status}"
fi

if [[ ! -s "${json_output}" ]]; then
  echo "Delta position-resolution guardrail produced no JSON artifact; see ${log_output}" >&2
  exit 1
fi

echo "Delta position-resolution guardrail passed; artifact=${json_output}"
