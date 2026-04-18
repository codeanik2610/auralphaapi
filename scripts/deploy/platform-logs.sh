#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

validate_platform_inputs

follow_args=()
tail_value=200
services=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--follow)
      follow_args+=(--follow)
      shift
      ;;
    --tail)
      shift
      if [[ $# -eq 0 ]]; then
        echo "--tail requires a numeric value" >&2
        exit 1
      fi
      tail_value="$1"
      shift
      ;;
    *)
      services+=("$1")
      shift
      ;;
  esac
done

if [[ ${#services[@]} -eq 0 ]]; then
  services=(auralpha-api auralpha-scheduler-worker discovery-engine caddy)
fi

compose logs --tail "${tail_value}" "${follow_args[@]}" "${services[@]}"
