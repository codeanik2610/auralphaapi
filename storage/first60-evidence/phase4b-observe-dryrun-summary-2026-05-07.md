# Phase 4b First60 Observe-Only Dry-Run Evidence

Generated on 2026-05-07 from the production droplet API container.

The run was read-only. It queried MySQL `suggested_trades` and would have
queried Postgres `market_candles_1m` for any eligible trades. No writes were
attempted, and the before/after count of `meta_json.first60ObserveOnly` stayed
unchanged.

## Artifact

- `storage/first60-evidence/first60-observe-dryrun-2026-05-07.json`

## Result

- Mode: `dry-run`
- Write attempted: `false`
- `first60ObserveOnly` rows before: `0`
- `first60ObserveOnly` rows after: `0`
- Unchanged: `true`
- Trades with `tradeManagementSnapshot.first60`: `0`
- Eligible candidates: `0`
- Evaluated trades: `0`
- Candles loaded: `0`

## Read

The observe-only monitor path ran safely on the droplet, but production does not
yet have suggested trades carrying `meta.tradeManagementSnapshot.first60`.
That is expected until the Phase 2/3d snapshot code is deployed and new
suggested trades are generated from the managed template/profile.

Next gate: deploy the snapshot/profile changes, let new paper suggestions arrive,
then rerun this dry-run. Only after eligible BUY observations appear should
`FIRST60_OBSERVE_WRITE=true` be considered.
