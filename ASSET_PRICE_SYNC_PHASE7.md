# Asset Price Sync Phase 7

Date: 2026-04-10

## 1) Goal

Phase 7 completes the frontend/operator consumption handoff for
`asset-price-sync` on top of the Phase 6 backend contract.

By the end of this phase:

- the scheduler UI describes `asset-price-sync` using the real system market
  sources: Mudrex and Delta Exchange
- save and run-now flows preserve the frozen system-source contract instead of
  drifting back to Binance-era payloads
- the config workspace explains that the scheduler writes latest values by broker asset id
- focused frontend tests now guard the asset-price save/run payload contract

## 2) What Changed

### Scheduler page copy now reflects the real asset-price runtime

Phase 7 updates:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`

The scheduler tabs and ops drawer now describe `asset-price-sync` as:

- latest prices for system broker assets
- sourced from Mudrex and Delta Exchange

This removes stale Binance-only wording from the operator workspace.

### Save and run-now payloads now preserve the frozen Phase 1 source contract

Phase 7 also updates:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/AssetPriceSchedulerController.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AssetPriceSchedulerService.ts`

The asset-price scheduler branch in `buildSchedulerConfigBody` now queues and
saves:

- `sources: ['mudrex', 'delta_exchange']`
- `selectionMode`
- `selectedAssetIds`

That keeps the frontend aligned with the backend contract in
`assetPriceContract.ts` and prevents the UI from reintroducing an invalid
Binance source into persisted config.

The dedicated asset-price run-now route now also accepts scoped overrides from
the operator desk, so manual runs can honor the Phase 7 payload contract
without persisting those unsaved scope changes back into scheduler config.

### Config workspace now explains scope and write semantics

Phase 7 updates:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerConfigSection.jsx`

The asset picker now tells operators that:

- system sources are Mudrex and Delta Exchange
- writes land by broker asset id
- all-assets scope means all eligible system broker assets

### Focused frontend tests now guard the contract

Phase 7 updates:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`

The new tests verify that:

- save dispatches `settings/updateSchedulerConfig` with Mudrex and Delta
  Exchange sources for `asset-price-sync`
- run now dispatches `settings/runSchedulerNow` with the same system-source
  contract

## 3) Phase 7 Outcome

The operator consumption layer is now frozen:

1. `asset-price-sync` frontend copy matches the real Mudrex + Delta runtime
2. frontend save and run-now flows preserve the frozen system-source contract
3. the config desk explains broker-asset-id scoped writes truthfully
4. focused UI tests now block a regression back to Binance-era payloads

## 4) Carry-Forward For Phase 8

- treat the frontend payload contract as frozen
- do not reintroduce Binance-only source wording for `asset-price-sync`
- keep operator-facing copy aligned with `broker_assets.id` scope and
  `asset_price` storage
- use the new save/run-now tests as the baseline before live proof work in
  `ASSET_PRICE_SYNC_PHASE8.md`

## 5) Verification

Phase 7 completion used:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Schedulers/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Schedulers/index.jsx src/pages/Schedulers/components/SchedulerConfigSection.jsx src/pages/Schedulers/index.test.jsx`
- `npm run test:asset-price-sync-phase7`
- `npm run test:asset-price-sync-phase6`
- `npm run type-check`
