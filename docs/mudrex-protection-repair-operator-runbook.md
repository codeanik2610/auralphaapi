# Mudrex Protection Repair Operator Runbook

## Scope

Use this runbook only for Mudrex suggested-trade protection repair. The normal operating mode is read-only. Any apply must be a one-candidate canary with explicit flags, fresh broker read-back, and manual Mudrex verification.

Do not use this runbook for Delta Exchange. The repair architecture is similar, but broker order behavior, quantity units, and safety checks are different.

## Artifact Paths

Production host:

- Backend checkout: `/opt/auralpha/Backend/aurAlpha`
- Mudrex position-resolution watchdog: `/opt/auralpha/guardrail-artifacts/mudrex-position-resolution`
- Mudrex protection-health watchdog: `/opt/auralpha/guardrail-artifacts/mudrex-protection-health`
- Mudrex stale-protection watchdog: `/opt/auralpha/guardrail-artifacts/mudrex-stale-protection-watchdog`
- Mudrex repair preview evidence: `/opt/auralpha/guardrail-artifacts/mudrex-protection-repair-preview`
- Position-resolution watchdog log: `/var/log/auralpha-mudrex-position-resolution-watchdog.log`
- Protection-health watchdog log: `/var/log/auralpha-mudrex-protection-health-watchdog.log`
- Stale-protection watchdog log: `/var/log/auralpha-mudrex-stale-protection-watchdog.log`

Container output files used during manual checks:

- Repair preview: `/tmp/mudrex-repair-preview.json`
- Repair dry run: `/tmp/mudrex-repair-dry-run.json`
- Repair apply: `/tmp/mudrex-repair-apply.json`
- Repair after-check: `/tmp/mudrex-repair-after.json`

## Read-Only Baseline

Start with the scheduled artifacts. The latest JSON should be inspected before any manual run:

```bash
cd /opt/auralpha/Backend/aurAlpha
ls -1t /opt/auralpha/guardrail-artifacts/mudrex-position-resolution/*.json | head -5
ls -1t /opt/auralpha/guardrail-artifacts/mudrex-protection-health/*.json | head -5
ls -1t /opt/auralpha/guardrail-artifacts/mudrex-stale-protection-watchdog/*.json | head -5
```

Run the Mudrex position-resolution watchdog. This is read-only:

```bash
cd /opt/auralpha/Backend/aurAlpha
./scripts/checks/run-suggested-trades-mudrex-position-resolution-watchdog.sh
```

Run the Mudrex protection-health watchdog. This is read-only:

```bash
cd /opt/auralpha/Backend/aurAlpha
./scripts/checks/run-suggested-trades-mudrex-protection-health-watchdog.sh
```

Run the Mudrex stale-protection watchdog. This is read-only and forces apply flags off:

```bash
cd /opt/auralpha/Backend/aurAlpha
./scripts/checks/run-suggested-trades-mudrex-stale-protection-watchdog.sh
```

Run the repair preview. This command only classifies what would be repaired:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_PREVIEW_OUTPUT_FILE=/tmp/mudrex-repair-preview.json \
  auralpha-api \
  node dist/scripts/checks/check-suggested-trades-mudrex-protection-repair-preview.js
```

Inspect the preview JSON:

```bash
docker exec auralpha-auralpha-api-1 cat /tmp/mudrex-repair-preview.json
```

Run the full Mudrex repair dry run with mutation disabled:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_APPLY=false \
  -e SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_CANCEL_APPLY=false \
  -e SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED=false \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_LIMIT=5 \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_OUTPUT_FILE=/tmp/mudrex-repair-dry-run.json \
  auralpha-api \
  node dist/scripts/maintenance/repair-suggested-trades-mudrex-protection.js
```

Inspect the dry-run JSON:

```bash
docker exec auralpha-auralpha-api-1 cat /tmp/mudrex-repair-dry-run.json
```

## Candidate Requirements

Proceed only if the dry run shows exactly one candidate you intend to handle:

- `applyEnabled` is `false` during preview and dry run.
- `staleCancelApplyEnabled` is `false` during preview and dry run.
- `candidateItems` is `1` for the canary action being considered.
- `errorItems` is `0`.
- `blockedItems` is `0`.
- `preview.byAction` matches the expected action.
- The item has the expected `suggestedTradeId`, `symbol`, `side`, `entryOrderId`, and `positionId`.
- The item is `repairable: true` and `readiness: ready` in the preview.
- The item has no `missing_position_read_model` or `unsafe_position_mismatch` issue.

Action-specific requirements:

- Missing protection: action must be `would_attach_missing_protection`; issue must include `missing_active_stop_loss` and/or `missing_active_take_profit`; `expectedProtectionQuantityUnit` must be `base`; planned SL/TP price must exist for each missing leg; position identity must be resolved.
- Partial-fill replacement: action must be `would_replace_mismatched_partial_fill_protection`; linked SL/TP order ids must be present; `expectedProtectionQuantityUnit` must be `base`; expected size must come from the resolved Mudrex position size.
- Terminal mark: action must be `would_mark_terminal_protection_not_required`; terminal execution or terminal position evidence must be present; there must be no active linked protection order ids to cancel.
- Stale cancel: action must be `would_cancel_stale_protection_orders`; issue must include `stale_protection_for_closed_position`; terminal execution or terminal position evidence must be present; `sameSymbolOpenPositionCandidates` must be `0`; linked order ids must not include the entry order id.

## Manual Mudrex Check

Before apply, open Mudrex and verify the candidate manually:

- Confirm the account matches the preview `accountId`.
- Confirm the symbol/base symbol matches the preview.
- Confirm the position side matches the suggested trade side.
- Confirm the position status matches the intended action.
- For missing protection, confirm no duplicate SL/TP protection already exists outside the linked ids.
- For partial-fill replacement, confirm existing protection quantity differs from the current Mudrex open/fill base quantity.
- For stale cancel, confirm there is no open same-symbol Mudrex position that could own the linked protection orders.
- For stale cancel or partial-fill replacement, confirm each linked order is active, belongs to the same symbol, and is an SL/TP protection order.
- Confirm the planned SL and TP prices match the trade plan before creating or replacing protection.

## Do Not Proceed

Stop immediately if any of these are true:

- More than one candidate appears.
- The preview has `manual_review_required`.
- The preview has any blocker.
- The candidate position id is missing or does not match the broker/read-model position.
- The candidate has `missing_position_read_model` or `unsafe_position_mismatch`.
- `sameSymbolOpenPositionCandidates` is greater than `0` for stale cancellation or terminal marking.
- A cancel or replace list contains the entry order id.
- A linked order is not active, not the same symbol, or not an SL/TP protection order.
- Mudrex UI disagrees with the preview.
- The action is not the action you intended to canary.
- Any apply flag is enabled during watchdog or preview-only checks.

## One-Candidate Apply

Set `SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_LIMIT=1` for every apply.

For missing protection, terminal mark, or partial-fill replacement:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_APPLY=true \
  -e SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_CANCEL_APPLY=false \
  -e SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED=true \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_LIMIT=1 \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_OUTPUT_FILE=/tmp/mudrex-repair-apply.json \
  auralpha-api \
  node dist/scripts/maintenance/repair-suggested-trades-mudrex-protection.js
```

For stale protection cancellation:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_APPLY=true \
  -e SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_CANCEL_APPLY=true \
  -e SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED=true \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_LIMIT=1 \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_OUTPUT_FILE=/tmp/mudrex-repair-apply.json \
  auralpha-api \
  node dist/scripts/maintenance/repair-suggested-trades-mudrex-protection.js
```

Inspect the apply artifact immediately:

```bash
docker exec auralpha-auralpha-api-1 cat /tmp/mudrex-repair-apply.json
```

The apply artifact must show:

- `mode: "apply"`
- `applyEnabled: true`
- `candidateItems: 1`
- `appliedItems: 1`
- `errorItems: 0`
- `blockedItems: 0`

Stop after one candidate. Do not run a batch apply.

## After-Apply Verification

Run the dry run again with both mutation flags off:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_APPLY=false \
  -e SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_CANCEL_APPLY=false \
  -e SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED=false \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_LIMIT=5 \
  -e SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_OUTPUT_FILE=/tmp/mudrex-repair-after.json \
  auralpha-api \
  node dist/scripts/maintenance/repair-suggested-trades-mudrex-protection.js
```

Confirm:

- The handled candidate is no longer listed.
- `errorItems` remains `0`.
- No new `manual_review_required` item appears.
- Mudrex UI matches the database state.
- For stale cancellation or terminal mark, the database execution state is terminal or `not_required` for protection lifecycle.
- For missing or replacement protection, linked SL/TP ids and base quantities match broker read-back.

## Recovery Notes

There is no blind automatic rollback for broker mutations. If post-apply verification does not match the expected state:

- Stop all further repair attempts.
- Capture `/tmp/mudrex-repair-apply.json` and `/tmp/mudrex-repair-after.json`.
- Capture the latest Mudrex position-resolution and protection-health artifacts.
- Verify the broker state manually in Mudrex.
- Only recreate or cancel broker protection manually after explicit operator approval.
