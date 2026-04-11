# Asset Price Sync Phase 3

Date: 2026-04-10

## 1) Goal

Phase 3 performs the live writer cutover for `asset-price-sync`.

By the end of this phase:

- `asset_price` is the canonical write target
- `broker_asset_id` is the runtime write key
- scheduler scope assets are `broker_assets.id` values, not symbol strings
- both the app-side refresh path and the queued worker path write into `asset_price`

Phase 3 intentionally does not migrate downstream readers yet. Phase 4 is the reader migration phase.

## 2) What Changed

### Canonical writer now targets `asset_price`

Phase 3 adds the repository:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/AssetPriceRepository.ts`

and uses it from:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/MarketPriceRefreshService.ts`

The app refresh path now resolves provider assets from `broker_assets`, then
upserts prices into `asset_price` keyed by `broker_asset_id`.

### Scheduler scope now carries broker-asset IDs

Phase 3 updates:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AssetPriceSchedulerService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/ExchangeAssetRepository.ts`

so `selectedAssetIds` stay as `broker_assets.id` values, asset list responses no
longer collapse multiple provider rows into one symbol row, and queued
`scope.assets` now represent broker asset IDs.

### Worker runtime now writes `asset_price`

Phase 3 also updates the worker runtime:

- `/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker/src/scheduler/services/SchedulerExecutionService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker/src/scheduler/queue/SchedulerCommandPoller.ts`

The worker now:

- resolves scope from `broker_assets.id`
- fetches prices from system Mudrex and Delta sources
- upserts into `asset_price`
- records update-log `assetId` as the broker asset ID

## 3) Phase 3 Outcome

The writer contract is now frozen:

1. `asset_price` is the canonical write target
2. `broker_asset_id` is the runtime upsert key
3. scheduler scope is provider-aware and ID-based
4. `market_prices_binance` is no longer the active writer target for this flow

What still remains for later phases:

- Phase 4 must migrate downstream readers off `MarketPriceBinanceRepository`
- later cleanup must remove the legacy table and repository once no reader
  depends on them

## 4) Carry-Forward For Phase 4

- move consumer reads from `market_prices_binance` to `asset_price`
- preserve source-aware lookups so Mudrex and Delta rows do not collide by symbol
- update any UI or service-level read paths that still assume symbol-primary
  storage
- remove legacy-market-price dependencies only after every reader has moved

## 5) Verification

Phase 3 completion used:

- `npm run test:asset-price-sync-phase3`
- `npm run test:asset-price-sync-phase2`
- `npm run test:asset-price-sync-phase1`
- `npm run test:global-system-schedulers`
- `npm run type-check`
- `cd /Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker && npm run build`
