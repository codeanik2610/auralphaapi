# Broker Assets Phase 2 Audit

Phase 2 audits the current `broker_assets` runtime surface before the Phase 3
repository and service refactor begins.

Phase 2 does not change runtime behavior. It records exactly which code paths
still treat `broker_assets` as user-scoped, which paths already use the global
catalog model, and what Phase 3 must change next.

## Summary

- `ExchangeAssetsService` is the only runtime writer still creating
  user-scoped `broker_assets` rows.
- User-scoped reads still exist in `ExchangeAssetsService`,
  `ConnectionsService`, and `DeltaExchangeOrdersAdapter`.
- The scheduler flows already consume global/system asset reads.
- `ExchangeAssetRepository.replaceSystemAssets()` already exists and is the
  natural Phase 3 write target, but it currently has no runtime caller.

## Repository Inventory

Legacy user-scoped `broker_assets` methods still present in
`src/database/repositories/ExchangeAssetRepository.ts`:

- `upsertAssets(userId, assets, attempted)`
- `getAssetBySourceAndExternalId(userId, source, externalId)`
- `getAssetBySourceAndAssetId(userId, source, assetId)`
- `getAssetBySourceAndSymbol(userId, source, symbol)`
- `listAssets(userId, query)`
- `listAssetsBySourceAndSymbols(userId, source, symbols)`

Global/system `broker_assets` methods already aligned with the target model in
`src/database/repositories/ExchangeAssetRepository.ts`:

- `replaceSystemAssets(source, assets, attempted)`
- `listSystemAssetsBySourceAndSymbols(source, symbols)`
- `listSystemAssetsDistinctSymbols(query)`
- `listSystemAssetSymbolsByIds(ids)`

## Runtime Write Paths

Current write paths that still persist `broker_assets` as user-scoped:

- `src/api/services/ExchangeAssetsService.ts`
  - `syncExchangeAssets()` calls `exchangeAssetRepository.upsertAssets(userId, matchedAssets, assets.length)`
  - `syncMudrexExchangeAssets()` calls `exchangeAssetRepository.upsertAssets(userId, matchedAssets, mudrexAssets.length)`

Confirmed audit result:

- no other runtime caller writes to `broker_assets` through
  `ExchangeAssetRepository`
- `replaceSystemAssets()` exists but is currently unused by runtime services

## Runtime Read Paths To Refactor In Phase 3

Legacy user-scoped reads that must move to the global-catalog model:

- `src/api/services/ExchangeAssetsService.ts`
  - `getStoredExchangeAssets()` calls `listAssets(userId, ...)`
  - Mudrex delta-enrichment also calls
    `listAssetsBySourceAndSymbols(userId, 'delta_exchange', symbols)`
- `src/api/services/ConnectionsService.ts`
  - `resolveConnectionProductMapSummary()` calls
    `listAssets(userId, { source })`
- `src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts`
  - `resolveProductId()` calls
    `getAssetBySourceAndExternalId(userId, 'delta_exchange', assetId)`
  - `resolveProductId()` calls
    `getAssetBySourceAndAssetId(userId, 'delta_exchange', assetId)`
  - `resolveProductId()` calls
    `getAssetBySourceAndSymbol(userId, 'delta_exchange', assetId.toUpperCase())`

## Runtime Paths Already Aligned

These services already consume global/system asset reads and do not depend on
user-scoped `broker_assets` rows:

- `src/api/services/SchedulerService.ts`
- `src/api/services/CandlesSchedulerService.ts`
- `src/api/services/AssetPriceSchedulerService.ts`

## Supporting Ownership Layer For Phase 3

`broker_accounts` already contains the user-owned visibility layer that Phase 3
should derive from:

- `src/database/repositories/BrokerAccountRepository.ts`
  - `getConnectedBrokerAccounts(userId, brokerKey?)`
  - `getActiveBrokerAccounts(userId, brokerKey?)`

Phase 3 must make one explicit behavior choice:

- visibility derived from `Connected` accounts only
- or visibility derived from `Connected` plus `Idle` accounts

The current codebase uses both patterns in different places, so Phase 3 should
decide this on purpose instead of inheriting it accidentally.

## Tests And Contracts To Update In Phase 3

Current test surface that still reflects the legacy model:

- `scripts/test-services.ts`
  - the `ConnectionsService` workspace assertions currently stub
    `exchangeAssetRepository.listAssets()`
  - the exchange-asset compatibility assertions currently capture
    `exchangeAssetRepository.upsertAssets(...)`

Additional gap to cover in Phase 3:

- add or extend a focused test for `DeltaExchangeOrdersAdapter` product lookup
  so the move from user-scoped mapping reads to global catalog reads is locked
  down

## Phase 3 Entry Checklist

1. Add first-class global and user-visible repository methods to
   `ExchangeAssetRepository`.
2. Switch `ExchangeAssetsService` writes from `upsertAssets()` to
   `replaceSystemAssets()`.
3. Switch user-visible asset reads to queries derived from the user's
   `broker_accounts`.
4. Switch `ConnectionsService` product-map counting to the new user-visible
   global read path.
5. Switch `DeltaExchangeOrdersAdapter` product lookups to global catalog
   methods.
6. Update `scripts/test-services.ts` stubs and assertions, and add the missing
   Delta product lookup coverage.
7. Leave schema cleanup for later phases after runtime no longer depends on
   `broker_assets.user_id`.

## Audit Guard

The Phase 2 audit guard intentionally checks for these legacy paths while the
repo is still in the mixed model. Phase 3 should update or replace that guard
once the refactor lands.
