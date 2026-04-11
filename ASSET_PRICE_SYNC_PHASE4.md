# Asset Price Sync Phase 4

Date: 2026-04-10

## 1) Goal

Phase 4 completes the downstream reader migration for `asset-price-sync`.

By the end of this phase:

- live backend readers no longer depend on `MarketPriceBinanceRepository`
- read paths consume `asset_price`
- symbol lookups use stable source preference rules where needed
- the legacy market-price repository is no longer on the active read path

Phase 4 does not remove the legacy table or entity yet. Cleanup belongs to a
later removal phase once every dependency is gone.

## 2) What Changed

### Shared `asset_price` read repository was expanded

Phase 4 updates:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/AssetPriceRepository.ts`

The repository now supports:

- `getByBrokerAssetId`
- `getBySymbol`
- `getBySymbols`
- source-aware preference ordering
- safe symbol or `source_symbol` matching when needed

### Remaining backend readers moved off the legacy repository

Phase 4 migrates these services:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerReferenceDataService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerPositionsFacadeService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/InternalPositionsSyncService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PaperOrderExecutionService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/MarketMetricsService.ts`

Specific behavior:

- positions read paths now prefer Mudrex price rows
- paper-order simulation now prefers broker-matched price rows before generic fallback
- market metrics now fall back to `asset_price` instead of the legacy table
- futures-symbol reference lookup now returns `asset_price` data and exposes the
  broker asset ID

## 3) Phase 4 Outcome

The active reader contract is now frozen:

1. writers use `asset_price`
2. readers use `asset_price`
3. `broker_asset_id` remains the canonical storage anchor
4. `market_prices_binance` is no longer part of the active app read/write path

What still remains for later phases:

- remove the legacy `MarketPriceBinanceRepository`
- remove the legacy entity and table references when cleanup is safe
- tighten any remaining API contracts that still expose legacy names such as
  `exchangeAssetId`

## 4) Carry-Forward For Phase 5

- remove dead compatibility code only after confirming no runtime dependency
  remains
- finish legacy cleanup in one explicit phase, not opportunistically
- keep provider-aware selection behavior intact during cleanup

## 5) Verification

Phase 4 completion used:

- `npm run test:asset-price-sync-phase4`
- `npm run test:asset-price-sync-phase3`
- `npm run test:asset-price-sync-phase2`
- `npm run test:asset-price-sync-phase1`
- `npm run type-check`
- `npx eslint src/database/repositories/AssetPriceRepository.ts src/api/services/BrokerReferenceDataService.ts src/api/services/BrokerPositionsFacadeService.ts src/api/services/InternalPositionsSyncService.ts src/api/services/PaperOrderExecutionService.ts src/api/services/MarketMetricsService.ts src/api/contracts/MarketPrice.ts scripts/test-asset-price-sync-phase4.ts`
