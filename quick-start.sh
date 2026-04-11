#!/usr/bin/env bash
set -euo pipefail

API_ENVIRONMENT="${API_ENVIRONMENT:-localhost}"
ENV_FILE="./environments/${API_ENVIRONMENT}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE"
  exit 1
fi

cp "$ENV_FILE" ./.env

echo "Starting trading-apis (queue mode)..."
npx nps serve
