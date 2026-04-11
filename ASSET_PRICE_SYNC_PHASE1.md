# Asset Price Sync Phase 1

Phase 1 freezes the backend contract for `asset-price-sync` before Phase 2
changes schema and storage.

## Contract

- `asset-price-sync` is a global system scheduler. It is not a user-owned
  scheduler.
- Scheduler execution scope stays system-owned for both manual and
  cron-triggered runs.
- Manual controls still require an authenticated admin actor, but that actor is
  control-plane context, not scheduler ownership.
- `config.useSystemConnectionsOnly` must stay `true`.
- Provider scope for this scheduler is limited to the system Mudrex and Delta
  sources.
- Scheduler asset selection is anchored on `broker_assets`.
- `selectedAssetIds` refer to `broker_assets.id`.
- Phase 1 freezes `asset_price` as the target storage table for future phases.
- Phase 1 keeps `market_prices_binance` as the transitional legacy storage
  table until Phase 2 and later runtime cutover work is complete.
- Existing runtime behavior remains backward compatible in Phase 1.

## Phase 1 Outcome

Phase 1 does not change scheduler execution behavior.

It does four things:

- documents the frozen target contract for `asset-price-sync`
- centralizes the scheduler's key identity, source, scope, and storage markers
- aligns the scheduler service with those shared contract constants
- adds an automated guard so Phase 2 starts from an explicit frozen contract

## Non-Negotiables

- `asset-price-sync` must remain `schedulerType = global`
- no new feature should reintroduce user-owned scheduler semantics here
- system credentials or system connection context must remain the only runtime
  connection path
- `selectedAssetIds` must continue to mean `broker_assets.id`
- Phase 2 must not treat symbol-only matching as the final storage key
- `market_prices_binance` is transitional only and must not be expanded as the
  long-term contract

## Transitional State After Phase 1

- The live implementation still uses `market_prices_binance` in the current
  runtime path.
- Downstream consumers still read through the legacy market-price repository.
- The scheduler service now shares a single source of truth for ownership,
  provider sources, and target storage intent.
- Phase 2 must introduce the `asset_price` schema and storage migration path.
- Phase 3 must switch writer paths from the legacy table to `asset_price`.
- Phase 4 and later phases must migrate downstream readers and finish the
  legacy cleanup.

## Phase 2 Entry Checklist

1. Create the `asset_price` table and its migration path.
2. Add `broker_asset_id` as the storage anchor.
3. Preserve old data through rename or backfill, not silent replacement.
4. Keep `asset-price-sync` global and system-scoped while schema changes land.
