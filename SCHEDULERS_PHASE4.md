# Schedulers Phase 4

Phase 4 exposes the orders scheduler controls that were previously hidden behind fixed server
defaults, so `/schedulers` now gives operators an honest way to understand and repair orders sync
behavior.

## What changed

- Orders scheduler config now persists `lookbackDays` explicitly instead of keeping replay backfill
  depth as a hidden backend default.
- The orders config response now returns an `ordersPolicy` block that freezes the current operator
  contract:
  - replay and missing-checkpoint runs use the saved replay lookback
  - replay backfills are capped by a server-side max lookback
  - history fetches stay chunked into fixed windows
  - incremental reconciliation keeps a fixed checkpoint overlap
  - open-order sweeps and stale-close behavior remain fixed system policy
- Orders `run now` now accepts an optional scoped replay body:
  - `accountId`
  - `brokerKey`
  - `resetCheckpoint`
- Scoped replay requests now validate the target account against active broker accounts before the
  run is queued.
- A replay with `resetCheckpoint: true` now clears the selected account checkpoint before queuing
  the follow-up run, which makes the next orders sync backfill from the saved replay lookback
  window instead of relying on the stale checkpoint.
- Global/manual orders runs now execute under the scheduler system actor when the scheduler itself is
  globally scoped, while still recording the requesting admin separately in run metadata and command
  payloads.
- The `/schedulers` orders tab now exposes the saved replay lookback in the config form, explains
  the fixed orders policy inline, and adds a per-account `Replay account` action directly in Order
  sync health.
- The orders replay CTA now refreshes sync-state truth after a successful scoped replay queue so the
  operator can immediately see the updated account coverage.

## Main files

- Contracts:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Scheduler.ts`
- Validators:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/scheduler.validator.ts`
- Orders scheduler API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/OrdersSchedulerController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersSchedulerService.ts`
- Frontend `/schedulers` orders workspace:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerConfigSection.jsx`
- Focused verification:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-schedulers-phase4.ts`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerConfigSection.test.jsx`

## Verification

- `npm run test:schedulers-phase4`
- `npm run test:schedulers-phase3`
- `npm run test:schedulers-phase2`
- `npm run test:controllers`
- `npm run type-check`
- `npx eslint src/api/contracts/Scheduler.ts src/api/controllers/OrdersSchedulerController.ts src/api/services/OrdersSchedulerService.ts src/api/validators/scheduler.validator.ts scripts/test-schedulers-phase2.ts scripts/test-schedulers-phase3.ts scripts/test-schedulers-phase4.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerConfigSection.jsx src/pages/Schedulers/components/SchedulerConfigSection.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerConfigSection.test.jsx`

Verification note:

- the focused Phase 2-4 scheduler checks, lint, and `/schedulers` UI tests passed
- `npm run type-check` is still blocked by unrelated portfolio-script issues in
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-portfolio-health.ts` and
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-portfolio-phase6.ts`

## Phase 5 start point

Phase 5 should move the orders scheduler runtime schema into migrations so checkpoint and snapshot
tables stop depending on lazy runtime DDL:

- promote orders checkpoint and snapshot tables into first-class migrations
- add explicit ownership and indexing for orders scheduler runtime tables
- remove runtime schema creation from the happy-path sync flow where possible
