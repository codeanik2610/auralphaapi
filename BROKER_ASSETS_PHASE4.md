# Broker Assets Phase 4

Phase 4 removes the last legacy user-ownership schema from `broker_assets`.

## Implemented Behavior

- `broker_assets.user_id` is dropped.
- Legacy per-user `broker_assets` rows are backfilled into the global catalog
  when needed, then removed.
- The old user-scoped broker-assets indexes are removed.
- Global broker-assets constraints now describe the table correctly:
  - unique `(source, symbol)`
  - lookup indexes for `(source, externalId)` and `(source, assetId)`
  - catalog indexes for `(source, symbol, name)` and `(broker_id)`
- `ExchangeAssetRepository` no longer exposes the legacy user-scoped read or
  write methods.

## Observed Catalog Detail

The live local `delta_exchange` catalog still reuses some `externalId` and
`assetId` values across multiple symbols, so Phase 4 keeps those as lookup
indexes instead of promoting them to unique constraints.

## Resulting Ownership Model

- `broker_assets` is a pure global provider or exchange catalog.
- User visibility is derived from owned `connections` and active
  `broker_accounts`.
- User ownership no longer exists in the `broker_assets` schema itself.

## Phase 5 Entry Checklist

1. Consolidate the historical Phase 1-4 broker-assets guards into a smaller
   stable contract suite now that the schema transition is complete.
2. Review whether `(source, externalId)` should be promoted from an index to a
   unique constraint after observing synced catalog data in production.
3. Add a higher-level release-gate or smoke check that proves the full flow:
   sync global catalog -> user-visible asset list -> Delta product lookup.
4. Clean up any remaining naming drift between older `exchange_assets` legacy
   artifacts and the current `broker_assets` model.

All four Phase 5 entry items were completed in `BROKER_ASSETS_PHASE5.md`.
