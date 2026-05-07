# Phase 4 end-to-end deploy

Date: 2026-05-07

## Outcome

The First60 package is now deployed end to end on the droplet.

## Deployed

- Copied `1800000100000-PreserveStrategyTemplateTradeManagement.ts` into droplet source.
- Rebuilt `auralpha-backend:prod`.
- Recreated `auralpha-api` from the rebuilt image.
- Confirmed the compiled migration exists in `/app/dist`.
- Ran the migration command.
- Applied Postgres migration: `PreserveStrategyTemplateTradeManagement1800000100000`.

## Verification

- API container: healthy
- First60 readiness: core checks pass
- DB normalizer preserves `tradeManagement`: yes
- Canary template First60: enabled
- BUY gate: `observe_only`
- BUY management enabled: no
- SELL gate: `blocked`
- Canary automation: paused, manual, `suggestion_only`
- Phase 4h canary trade has First60 snapshot: yes
- Order submissions created: `0`
- Paper orders created: `0`

## Observe-only dry-run

- Candidates: `1`
- Evaluated: `1`
- Write-eligible: `1`
- Written: `0`
- Outcome: `first60_failed`

## Notes

Readiness still reports optional warnings for runtime-only packaging: the docs runbook is not inside the runtime image, and live DB checks are skipped unless `FIRST60_DEPLOY_READINESS_LIVE=true`. These do not block the deployed First60 runtime path.
