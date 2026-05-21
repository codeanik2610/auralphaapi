#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${AURALPHA_API_CONTAINER_NAME:-auralpha-auralpha-api-1}"
ARTIFACT_DIR="${AURALPHA_BROKER_GUARDRAIL_ALERT_ARTIFACT_DIR:-/opt/auralpha/guardrail-artifacts/broker-guardrail-candidate-alerts}"
HISTORY_DIR="${AURALPHA_BROKER_GUARDRAIL_ALERT_HISTORY_DIR:-${ARTIFACT_DIR}/candidate-history}"
RETENTION_DAYS="${AURALPHA_BROKER_GUARDRAIL_ALERT_RETENTION_DAYS:-14}"
DRY_RUN="${SUGGESTED_TRADES_BROKER_GUARDRAIL_ALERT_DRY_RUN:-false}"
ALERT_LIMIT="${SUGGESTED_TRADES_BROKER_GUARDRAIL_ALERT_LIMIT:-100}"
MUDREX_LOOKBACK_DAYS="${SUGGESTED_TRADES_MUDREX_PROTECTION_LOOKBACK_DAYS:-7}"
MUDREX_LIMIT="${SUGGESTED_TRADES_MUDREX_PROTECTION_LIMIT:-1000}"
DELTA_LOOKBACK_DAYS="${SUGGESTED_TRADES_DELTA_PROTECTION_LOOKBACK_DAYS:-7}"
DELTA_LIMIT="${SUGGESTED_TRADES_DELTA_PROTECTION_LIMIT:-1000}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${ARTIFACT_DIR}"

tmp_output="${ARTIFACT_DIR}/${timestamp}.tmp"
log_output="${ARTIFACT_DIR}/${timestamp}.log"
json_output="${ARTIFACT_DIR}/${timestamp}.json"
history_output="${HISTORY_DIR}/${timestamp:0:8}.jsonl"

cleanup_tmp() {
  rm -f "${tmp_output}"
}
trap cleanup_tmp EXIT

set +e
docker exec \
  -e SUGGESTED_TRADES_BROKER_GUARDRAIL_ALERT_DRY_RUN="${DRY_RUN}" \
  -e SUGGESTED_TRADES_BROKER_GUARDRAIL_ALERT_LIMIT="${ALERT_LIMIT}" \
  -e SUGGESTED_TRADES_BROKER_GUARDRAIL_ALERT_OUTPUT_FILE="" \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_LOOKBACK_DAYS="${MUDREX_LOOKBACK_DAYS}" \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_LIMIT="${MUDREX_LIMIT}" \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_HEALTH_OUTPUT_FILE="" \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_LOOKBACK_DAYS="${DELTA_LOOKBACK_DAYS}" \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_LIMIT="${DELTA_LIMIT}" \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_GUARDRAIL_OUTPUT_FILE="" \
  "${CONTAINER_NAME}" \
  node dist/scripts/checks/check-suggested-trades-broker-guardrail-candidate-alerts.js \
  >"${tmp_output}" 2>&1
status=$?
set -e

mv "${tmp_output}" "${log_output}"
trap - EXIT

json_line="$(sed -n 's/^suggested-trades-broker-guardrail-candidate-alerts: //p' "${log_output}" | tail -n 1)"
if [[ -n "${json_line}" ]]; then
  printf '%s\n' "${json_line}" >"${json_output}"
  mkdir -p "${HISTORY_DIR}"
  printf '%s\n' "${json_line}" >>"${history_output}"
fi

find "${ARTIFACT_DIR}" -type f -mtime +"${RETENTION_DAYS}" -delete
find "${HISTORY_DIR}" -type f -mtime +"${RETENTION_DAYS}" -delete 2>/dev/null || true

if [[ "${status}" -ne 0 ]]; then
  echo "Broker guardrail candidate alert watchdog failed; see ${log_output}" >&2
  exit "${status}"
fi

if [[ ! -s "${json_output}" ]]; then
  echo "Broker guardrail candidate alert watchdog produced no JSON artifact; see ${log_output}" >&2
  exit 1
fi

echo "Broker guardrail candidate alert watchdog passed; artifact=${json_output}; history=${history_output}"
