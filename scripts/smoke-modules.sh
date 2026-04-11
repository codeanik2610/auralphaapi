#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000/api/v1}"
API_KEY="${APP_API_KEY:-${API_KEY:-change-me}}"

curl_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  echo "==> ${method} ${path}"

  if [[ -n "${body}" ]]; then
    curl -fsS -X "${method}" "${BASE_URL}${path}" \
      -H "x-api-key: ${API_KEY}" \
      -H "content-type: application/json" \
      -d "${body}"
  else
    curl -fsS -X "${method}" "${BASE_URL}${path}" \
      -H "x-api-key: ${API_KEY}"
  fi

  echo
  echo
}

curl_json "GET" "/signals"
curl_json "GET" "/signals/summary"
curl_json "GET" "/automations"
curl_json "GET" "/automations/summary"
curl_json "GET" "/watchlists"
curl_json "GET" "/watchlists/summary"
curl_json "GET" "/backtests"
curl_json "GET" "/backtests/summary"
curl_json "GET" "/alerts"
curl_json "GET" "/alerts/summary"
curl_json "GET" "/portfolio/holdings"
curl_json "GET" "/portfolio/summary"
curl_json "GET" "/risk/summary"
curl_json "GET" "/risk/controls"
curl_json "GET" "/activity"
curl_json "GET" "/activity/summary"
curl_json "GET" "/connections"
curl_json "GET" "/connections/summary"
curl_json "GET" "/settings"
curl_json "GET" "/settings/audit"
curl_json "PUT" "/settings" '{"notifyEmail":false,"notifyInApp":true,"confirmDestructive":true}'
curl_json "GET" "/strategy-templates?limit=5&offset=0"
curl_json "GET" "/strategy-templates?limit=5&offset=0&search=momentum&status=Active"
curl_json "GET" "/strategy-library?limit=5&offset=0"
curl_json "GET" "/strategy-library?limit=5&offset=0&search=momentum"

echo "Smoke test run completed."
