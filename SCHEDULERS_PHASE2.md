# Schedulers Phase 2

Phase 2 hardens the order scheduler API boundary so the `/schedulers` orders truth surface now sits on a stricter backend contract.

## What changed

- Orders run-update routes now verify that the supplied `runId` belongs to `orders-sync` before
  reading update logs or exporting CSV data.
- Orders scheduler config updates now use an orders-specific validator instead of the generic shared
  scheduler body validator.
- The orders config endpoint now rejects scheduler fields that only make sense for asset or
  discovery schedulers:
  - `selectionMode`
  - `selectedAssetIds`
  - `timeframes`
  - `discoveryPolicy`
  - `maxLookbackDays`
- `sources` is now treated as fixed orders scheduler truth:
  - when provided it must be exactly `["orders"]`
  - persisted update payloads are normalized back to `["orders"]`
  - the config response now reports `["orders"]` even if older rows drifted
- Orders sync-state diagnostics now expose explicit owner semantics:
  - response items include `ownerUserId`
  - query filtering supports `ownerUserId`
  - legacy `userId` remains accepted as an alias, but conflicting `ownerUserId` + `userId`
    combinations are now rejected
- Orders schedule updates now validate the resolved schedule mode after merging the incoming body
  with the stored config, so the backend no longer relies purely on the UI to keep daily/minute/
  second/hourly settings coherent.
- Orders run update payload types now use the generic scheduler run-update contract instead of the
  asset-specific name, while keeping the old asset aliases backward-compatible.

## Main files

- Contracts:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Scheduler.ts`
- Validators:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/scheduler.validator.ts`
- Orders scheduler API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/OrdersSchedulerController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersSchedulerService.ts`
- Focused verification:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-schedulers-phase2.ts`

## Verification

- `npm run test:schedulers-phase2`
- `npm run test:controllers`
- `npm run type-check`
- `npx eslint src/api/contracts/Scheduler.ts src/api/controllers/OrdersSchedulerController.ts src/api/services/OrdersSchedulerService.ts src/api/validators/scheduler.validator.ts scripts/test-schedulers-phase2.ts`

## Phase 3 start point

Phase 3 should focus on retention and purge truth for the orders scheduler:

- make purge preview/report include orders run update logs as well as run logs
- align the purge UI copy with what the backend actually deletes
- lock the retention behavior with focused tests so operators can trust cleanup outcomes
