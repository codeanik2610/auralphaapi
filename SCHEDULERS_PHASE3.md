# Schedulers Phase 3

Phase 3 closes the orders scheduler retention gap so `/schedulers` purge previews and purge results
now tell the truth about what cleanup actually removes.

## What changed

- Orders purge preview now counts both retention-expired run logs and scheduler-scoped update logs.
- Orders purge now deletes scheduler-scoped update logs before deleting the underlying run logs, so
  related update rows are not stranded behind already-deleted run metadata.
- Orders purge success activity now records both run-log and update-log totals, and purge failures
  now log a failed scheduler activity entry instead of failing silently.
- The shared `ExchangeAssetUpdateLogRepository` now counts scheduler-scoped retention candidates
  using the same run-age rule that the delete path already uses. That keeps preview totals aligned
  with actual purge outcomes for scheduler-scoped consumers.
- No frontend code changes were required for Phase 3 because the shared `/schedulers` purge modal
  and result banner already render both run-log and update-log counts once the backend returns
  truthful values.

## Main files

- Orders scheduler API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersSchedulerService.ts`
- Shared retention repository:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/ExchangeAssetUpdateLogRepository.ts`
- Focused verification:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-schedulers-phase3.ts`

## Verification

- `npm run test:schedulers-phase3`
- `npm run test:schedulers-phase2`
- `npm run test:controllers`
- `npm run type-check`
- `npx eslint src/api/contracts/Scheduler.ts src/api/controllers/OrdersSchedulerController.ts src/api/services/OrdersSchedulerService.ts src/api/validators/scheduler.validator.ts src/database/repositories/ExchangeAssetUpdateLogRepository.ts scripts/test-schedulers-phase2.ts scripts/test-schedulers-phase3.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Schedulers/index.test.jsx`

Verification note:

- the focused Phase 3 checks, lint, and `/schedulers` UI smoke test passed
- `npm run type-check` is still blocked by unrelated portfolio-script issues in
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-portfolio-health.ts` and
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-portfolio-phase6.ts`

## Phase 4 start point

Phase 4 should expose real orders-specific control and repair tools instead of keeping key sync
behavior hidden behind fixed server defaults:

- decide which orders sync controls remain fixed system policy versus operator-configurable
- surface lookback, replay/backfill, and checkpoint reset behavior explicitly
- keep the shared `/schedulers` shell from hiding orders-only operational semantics
