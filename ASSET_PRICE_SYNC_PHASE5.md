# Asset Price Sync Phase 5

Date: 2026-04-10

## 1) Goal

Phase 5 performs the explicit legacy cleanup for `asset-price-sync`.

By the end of this phase:

- the legacy `MarketPriceBinance` entity and repository are removed
- `asset_price` is the only active runtime storage model for this flow
- `market_prices_binance` is removed through a dedicated migration after a final
  safety backfill into `asset_price`
- active backend source code no longer carries the legacy market-price wiring

## 2) What Changed

### Legacy entity and repository wiring was removed

Phase 5 deletes these dead compatibility files:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/MarketPriceBinance.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/MarketPriceBinanceRepository.ts`

It also removes the old exports and TypeORM registration from:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/index.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/index.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/data-source.ts`

### Legacy drop migration was added

Phase 5 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/migrations/1770714000000-DropLegacyMarketPricesBinanceTable.ts`

Migration behavior:

- performs one final backfill from `market_prices_binance` into `asset_price`
- drops `market_prices_binance`
- provides a rollback path that can recreate the legacy table if needed

### Shared contract wording now reflects steady state

Phase 5 removes the legacy storage constant from:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/utils/assetPriceContract.ts`

And updates the active entity comment in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/AssetPrice.ts`

## 3) Phase 5 Outcome

The storage cleanup contract is now frozen:

1. `asset_price` is the only active storage table for `asset-price-sync`
2. active backend code no longer references `MarketPriceBinance`
3. the legacy table is retired by migration, not by ad hoc manual cleanup
4. later phases no longer need to preserve dead compatibility wiring

## 4) Carry-Forward For Phase 6

- build new API or ops behavior only on top of `asset_price`
- do not reintroduce symbol-first legacy storage abstractions
- treat any remaining `market_prices_binance` references as historical docs or
  migrations only

## 5) Verification

Phase 5 completion used:

- `npm run test:asset-price-sync-phase1`
- `npm run test:asset-price-sync-phase2`
- `npm run test:asset-price-sync-phase3`
- `npm run test:asset-price-sync-phase4`
- `npm run test:asset-price-sync-phase5`
- `npm run db:migrate`
- `npm run build`
- `npm run type-check`
- `npx eslint src/api/utils/assetPriceContract.ts src/database/entities/AssetPrice.ts src/database/data-source.ts src/database/entities/index.ts src/database/repositories/index.ts src/database/migrations/1770714000000-DropLegacyMarketPricesBinanceTable.ts scripts/test-asset-price-sync-phase1.ts scripts/test-asset-price-sync-phase5.ts`
