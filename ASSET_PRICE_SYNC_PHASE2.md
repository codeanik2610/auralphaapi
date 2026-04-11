# Asset Price Sync Phase 2

Date: 2026-04-10

## 1) Goal

Phase 2 introduces the schema foundation for the `asset-price-sync` cutover.

By the end of this phase:

- `asset_price` exists as the target storage table
- `broker_asset_id` is the schema anchor for price rows
- a safe migration path exists from `market_prices_binance`
- Phase 3 can switch writer paths without redesigning storage again

Phase 2 does not switch the live writer path yet. The runtime may still write to
`market_prices_binance` until the later cutover phases land.

## 2) What Changed

### `asset_price` table was added

Phase 2 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/migrations/1770713000000-CreateAssetPriceTable.ts`

That migration creates `asset_price` with:

- `broker_asset_id`
- `symbol`
- `source_symbol`
- `price`
- `source`
- `retrieved_at`
- `updated_at`

and adds supporting indexes for:

- `(source, symbol)`
- `symbol`
- `retrieved_at`
- `updated_at`

### Backfill uses broker-asset IDs only

Phase 2 backfills from `market_prices_binance` into `asset_price` only when the
legacy row already carries a valid `exchange_asset_id` that matches
`broker_assets.id`.

This is intentional. Phase 2 does not perform risky symbol-only remapping.

### Passive schema entity now exists

Phase 2 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/AssetPrice.ts`

This gives Phase 3 a typed target model without switching reader or writer
repositories yet.

## 3) Phase 2 Outcome

The schema is now ready for the `asset-price-sync` cutover:

1. `asset_price` exists
2. `broker_asset_id` is the schema key
3. legacy rows can be safely promoted when they already have a broker-asset ID
4. current runtime behavior remains backward compatible

What still remains for later phases:

- Phase 3 must switch writer paths away from `market_prices_binance`
- Phase 4 and later phases must move downstream readers off the legacy table
- final cleanup must remove the legacy market-price table and repository

## 4) Carry-Forward For Phase 3

- replace live writer SQL so `asset-price-sync` writes into `asset_price`
- preserve counters, update logs, and progress behavior during the writer swap
- keep `broker_asset_id` as the write key rather than symbol
- do not expand legacy `market_prices_binance` usage during the cutover

## 5) Verification

Phase 2 completion used:

- `npm run test:asset-price-sync-phase2`
- `npm run test:asset-price-sync-phase1`
- `npm run type-check`
- `npm run db:migrate`
- `npx eslint src/database/entities/AssetPrice.ts src/database/data-source.ts src/database/migrations/1770713000000-CreateAssetPriceTable.ts scripts/test-asset-price-sync-phase2.ts`
