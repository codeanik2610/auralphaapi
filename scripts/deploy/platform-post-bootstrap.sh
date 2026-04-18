#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

validate_platform_inputs

compose exec auralpha-api npm run rebuild:positions-read-model
compose exec auralpha-api npm run rebuild:risk-normalized-storage

echo "Post-bootstrap rebuilds completed successfully."
echo "Next step: run the scheduler syncs in application order."
