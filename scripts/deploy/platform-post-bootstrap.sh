#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./platform-common.sh
source "${SCRIPT_DIR}/platform-common.sh"

validate_platform_inputs

compose exec auralpha-api node dist/scripts/rebuild/rebuild-positions-read-model.js
compose exec auralpha-api node dist/scripts/rebuild/rebuild-risk-normalized-storage.js

echo "Post-bootstrap rebuilds completed successfully."
echo "Next step: run the scheduler syncs in application order."
