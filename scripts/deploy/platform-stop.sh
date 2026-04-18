#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

validate_platform_inputs

WITH_EMAIL=false
services=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-email)
      WITH_EMAIL=true
      shift
      ;;
    *)
      services+=("$1")
      shift
      ;;
  esac
done

profile_args=()
if [[ "${WITH_EMAIL}" == "true" ]]; then
  profile_args+=(--profile email)
fi

if [[ ${#services[@]} -eq 0 ]]; then
  services=(caddy auralphaapp auralpha-api auralpha-scheduler-worker discovery-engine)
  if [[ "${WITH_EMAIL}" == "true" ]]; then
    services+=(auralpha-email-worker)
  fi
fi

compose "${profile_args[@]}" stop "${services[@]}"

echo "Stopped services:"
printf -- '- %s\n' "${services[@]}"
