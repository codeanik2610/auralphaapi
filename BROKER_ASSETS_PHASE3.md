# Broker Assets Phase 3

Phase 3 aligns the runtime with the global-catalog ownership model for
`broker_assets`.

## Implemented Behavior

- `ExchangeAssetsService` now writes `broker_assets` through
  `replaceSystemAssets()`, so syncs populate global catalog rows instead of
  per-user rows.
- User-visible asset reads no longer depend on `broker_assets.user_id`.
- User-visible visibility is derived from user-owned routes:
  - any owned `connections` for the matching broker or exchange
  - active `broker_accounts` with status `Connected` or `Idle`
- `ConnectionsService` product-map totals now use the same user-visible global
  catalog path.
- `DeltaExchangeOrdersAdapter` now resolves product mappings from the global
  `delta_exchange` catalog instead of user-scoped rows.

## Why The Visibility Rule Includes Connections

`broker_accounts` covers broker-account routes, but feed-style providers such
as exchange market-data connections do not always have a separate broker-account
row. Using owned `connections` plus active `broker_accounts` preserves the
user-visible boundary without hiding feed product maps.

## Transitional State After Phase 3

- `broker_assets.user_id` still exists as a legacy transitional column.
- Legacy user-scoped repository methods still exist as compatibility shims.
- The runtime no longer depends on those user-scoped methods for active flows.

## Phase 4 Entry Checklist

1. Remove legacy user-scoped `ExchangeAssetRepository` methods that are no
   longer used by runtime code.
2. Add the schema migration to drop `broker_assets.user_id`.
3. Replace user-scoped uniqueness and indexes with global catalog constraints.
4. Backfill or deduplicate any legacy per-user rows that still matter before
   dropping the column.
5. Retire Phase 1 and Phase 2 transitional comments once the schema cleanup is
   complete.
