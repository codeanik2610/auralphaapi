# Delta Protection Repair Operator Runbook

## Scope

Use this runbook only for Delta Exchange suggested-trade protection repair. The normal operating mode is read-only. Any apply must be a one-candidate canary with explicit flags, fresh broker read-back, and manual Delta verification.

Do not use this runbook for Mudrex. The architecture is similar, but broker behavior and read-back rules are different.

## Artifact Paths

Production host:

- Backend checkout: `/opt/auralpha/Backend/aurAlpha`
- Delta protection guardrail: `/opt/auralpha/guardrail-artifacts/delta-protection-guardrail`
- Delta position-resolution watchdog: `/opt/auralpha/guardrail-artifacts/delta-position-resolution`
- Delta stale-protection watchdog: `/opt/auralpha/guardrail-artifacts/delta-stale-protection-watchdog`
- Stale watchdog log: `/var/log/auralpha-delta-stale-protection-watchdog.log`
- Position-resolution watchdog log: `/var/log/auralpha-delta-position-resolution-watchdog.log`

Container output files used during manual checks:

- Repair preview: `/tmp/delta-repair-preview.json`
- Repair dry run: `/tmp/delta-repair-dry-run.json`
- Repair apply: `/tmp/delta-repair-apply.json`

## Read-Only Baseline

Start with the scheduled artifacts. The latest JSON should be inspected before any manual run:

```bash
cd /opt/auralpha/Backend/aurAlpha
ls -1t /opt/auralpha/guardrail-artifacts/delta-position-resolution/*.json | head -5
ls -1t /opt/auralpha/guardrail-artifacts/delta-stale-protection-watchdog/*.json | head -5
```

Run the stale-protection watchdog with mutation disabled. This command must keep both apply flags false:

```bash
cd /opt/auralpha/Backend/aurAlpha
SUGGESTED_TRADES_DELTA_STALE_PROTECTION_WATCHDOG_LIMIT=25 \
SUGGESTED_TRADES_MAX_DELTA_STALE_CANCEL_CANDIDATES=0 \
./scripts/checks/run-suggested-trades-delta-stale-protection-watchdog.sh
```

Run the full Delta repair dry run with mutation disabled:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY=false \
  -e SUGGESTED_TRADES_DELTA_STALE_PROTECTION_CANCEL_APPLY=false \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_LIMIT=5 \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_OUTPUT_FILE=/tmp/delta-repair-dry-run.json \
  auralpha-api \
  node dist/scripts/maintenance/repair-suggested-trades-delta-protection.js
```

Inspect the dry-run JSON:

```bash
docker exec auralpha-auralpha-api-1 cat /tmp/delta-repair-dry-run.json
```

## Candidate Requirements

Proceed only if the dry-run shows exactly one candidate you intend to handle:

- `applyEnabled` is `false` during preview.
- `candidateItems` is `1` for the canary action being considered.
- `errorItems` is `0`.
- `blockedItems` is `0`.
- `preview.byAction` matches the expected action.
- The item has the expected `suggestedTradeId`, `symbol`, `side`, `entryOrderId`, and `positionId`.
- The item is `repairable: true` and `readiness: ready` in the preview.

Action-specific requirements:

- Stale cancel: action must be `would_cancel_stale_protection_orders`; issue must include `stale_protection_for_closed_position`; terminal execution or terminal position evidence must be present; `sameSymbolOpenPositionCandidates` must be `0`; linked SL/TP order ids must not include the entry order id.
- Missing protection: action must be `would_attach_missing_protection`; `expectedMutation.protectionPath` must be `detached_reduce_only_orders`; `requiresFreshPositionReadback`, `requiresFreshProtectionOrderReadback`, and `requiresDuplicateProtectionCheck` must be `true`; planned price must exist for each missing leg.
- Native bracket reconcile: action must be `would_reconcile_native_bracket_protection`; `expectedMutation.protectionPath` must be `native_bracket`; `attachDetachedOrders` must be `false`; `requiresNativeBracketReadback` must be `true`.
- Partial-fill replacement: action must be `would_replace_mismatched_partial_fill_protection`; expected quantity must be whole Delta contracts; both linked protection order ids must be present; `requiresFreshPositionReadback` and `requiresFreshProtectionOrderReadback` must be `true`.

## Manual Delta Check

Before apply, open Delta Exchange and verify the candidate manually:

- Confirm the account matches the preview `accountId`.
- Confirm the symbol/base symbol matches the preview.
- Confirm the position status matches the intended action.
- Confirm the position side matches the suggested trade side.
- For stale cancel, confirm there is no open same-symbol position that could own the protection orders.
- For stale cancel, confirm each linked order is active, reduce-only, opposite side, correct symbol, and an SL/TP stop order.
- For missing protection, confirm no duplicate SL/TP protection already exists outside the linked ids.
- For partial-fill replacement, confirm existing protection quantity differs from the current open/fill contract size.

## Do Not Proceed

Stop immediately if any of these are true:

- More than one candidate appears.
- The preview has `manual_review_required`.
- The preview has any blocker.
- The candidate position id is missing or does not match the broker/read-model position.
- `sameSymbolOpenPositionCandidates` is greater than `0` for stale cancellation.
- A cancel list contains the entry order id.
- A linked order is not active, not reduce-only, wrong side, wrong symbol, or not an SL/TP stop order.
- Delta UI disagrees with the preview.
- The action is not the action you intended to canary.
- Any apply flag is enabled during watchdog or preview-only checks.

## One-Candidate Apply

Set `SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_LIMIT=1` for every apply.

For missing protection, native bracket reconcile, or partial-fill replacement:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY=true \
  -e SUGGESTED_TRADES_DELTA_STALE_PROTECTION_CANCEL_APPLY=false \
  -e SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED=true \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_LIMIT=1 \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_OUTPUT_FILE=/tmp/delta-repair-apply.json \
  auralpha-api \
  node dist/scripts/maintenance/repair-suggested-trades-delta-protection.js
```

For stale protection cancellation:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY=true \
  -e SUGGESTED_TRADES_DELTA_STALE_PROTECTION_CANCEL_APPLY=true \
  -e SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED=true \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_LIMIT=1 \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_OUTPUT_FILE=/tmp/delta-repair-apply.json \
  auralpha-api \
  node dist/scripts/maintenance/repair-suggested-trades-delta-protection.js
```

Inspect the apply artifact immediately:

```bash
docker exec auralpha-auralpha-api-1 cat /tmp/delta-repair-apply.json
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

Run the dry-run again with both mutation flags off:

```bash
cd /opt/auralpha/Backend/aurAlpha
docker compose --env-file deploy/.env.platform -f docker-compose.platform.yml exec -T \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY=false \
  -e SUGGESTED_TRADES_DELTA_STALE_PROTECTION_CANCEL_APPLY=false \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_LIMIT=5 \
  -e SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_OUTPUT_FILE=/tmp/delta-repair-after.json \
  auralpha-api \
  node dist/scripts/maintenance/repair-suggested-trades-delta-protection.js
```

Confirm:

- The handled candidate is no longer listed.
- `errorItems` remains `0`.
- No new `manual_review_required` item appears.
- Delta UI matches the database state.
- For stale cancellation, the database execution state is terminal or `not_required` for protection lifecycle.
- For missing or replacement protection, linked SL/TP ids and quantities match broker read-back.

## Recovery Notes

There is no blind automatic rollback for broker mutations. If post-apply verification does not match the expected state:

- Stop all further repair attempts.
- Capture `/tmp/delta-repair-apply.json` and `/tmp/delta-repair-after.json`.
- Capture the latest guardrail/watchdog artifacts.
- Verify the broker state manually in Delta.
- Only recreate or cancel broker protection manually after explicit operator approval.
