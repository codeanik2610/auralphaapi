# Schedulers Phase 5

Phase 5 moves the orders scheduler runtime schema out of lazy service DDL and into first-class
migrations, so orders sync and replay now depend on explicit database ownership instead of creating
tables on demand.

## What changed

- Orders scheduler runtime tables are now migration-owned through
  `1770706000000-CreateOrdersSchedulerRuntimeTables.ts`.
- The new migration creates or repairs:
  - `scheduler_sync_checkpoints`
  - `scheduler_orders_snapshots`
  - the required `payload_hash` snapshot column
  - the orders snapshot indexes that match current list, replay, stale-close, and portfolio read
    paths
- The migration also normalizes `orders-sync` ownership in `scheduler_configs` and removes any
  lingering `scheduler_user_configs` rows for the orders scheduler, so the schema and scheduler
  config now agree that orders sync is a global system reconciliation job.
- Orders replay checkpoint reset no longer issues `CREATE TABLE IF NOT EXISTS` at runtime.
- Internal orders sync no longer issues snapshot/checkpoint table DDL on the happy path.
- Orders runtime code now uses `SchedulerRuntimeSchemaService` to fail fast with a focused
  `ORDERS_SCHEDULER_SCHEMA_MISSING` error when the migration foundation is missing, instead of
  silently creating partial schema during a run.
- No frontend code changes were required for Phase 5 because the operator workflow from Phase 4
  stays the same; this phase hardens the persistence foundation underneath it.

## Main files

- Runtime schema readiness:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/SchedulerRuntimeSchemaService.ts`
- Orders sync/runtime services:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/InternalOrdersSyncService.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersSchedulerService.ts`
- Migration foundation:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/migrations/1770706000000-CreateOrdersSchedulerRuntimeTables.ts`
- Focused verification:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-schedulers-phase4.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-schedulers-phase5.ts`

## Verification

- `npm run test:schedulers-phase5`
- `npm run test:schedulers-phase4`
- `npm run test:schedulers-phase3`
- `npm run test:schedulers-phase2`
- `npm run test:controllers`
- `npm run type-check`
- `npx eslint src/api/services/SchedulerRuntimeSchemaService.ts src/api/services/InternalOrdersSyncService.ts src/api/services/OrdersSchedulerService.ts src/database/migrations/1770706000000-CreateOrdersSchedulerRuntimeTables.ts scripts/test-schedulers-phase4.ts scripts/test-schedulers-phase5.ts`

Verification note:

- the focused Phase 2-5 scheduler checks, migration assertions, and backend lint passed
- `npm run type-check` is still blocked by unrelated portfolio-script issues in
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-portfolio-health.ts` and
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-portfolio-phase6.ts`

## Phase 6 start point

Phase 6 should turn the shared `/schedulers` shell into a more orders-focused operator workspace:

- split the giant schedulers page into smaller config/history/detail modules
- pull orders-specific health, replay, retention, and run history into a clearer dedicated flow
- keep the new Phase 5 migration/runtime contract visible in the UI through better operational copy
  and module boundaries
