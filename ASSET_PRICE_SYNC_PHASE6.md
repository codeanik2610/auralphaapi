# Asset Price Sync Phase 6

Date: 2026-04-10

## 1) Goal

Phase 6 aligns the dedicated `asset-price-sync` backend operator contract with
the shared scheduler API model.

By the end of this phase:

- config responses expose localized display timestamps plus raw UTC ISO
  companions
- run history and run progress expose the shared time and audit contract
- update logs and CSV export include initiator and execution-context data
- manual queue actions stamp explicit system-scope audit metadata
- purge preview and purge execution are scoped to `asset-price-sync` update logs
- restart uses `stop_now` consistently before requeueing a fresh run

## 2) What Changed

### Dedicated scheduler service now uses the shared time and audit helpers

Phase 6 updates:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AssetPriceSchedulerService.ts`

The service now uses:

- `buildSchedulerTimeContract`
- `formatSchedulerDisplayTime`
- `formatSchedulerRawIso`
- `buildSystemSchedulerManualAudit`
- `toSchedulerAuditContract`

### Config, runs, progress, and update logs now match the richer scheduler contract

Specific behavior:

- config responses now expose `time`, `lastStartedAtIso`, and `lastFinishedAtIso`
- run history and run progress now expose localized display times plus raw ISO
  companions
- run items now expose `initiatedBy` and `executionContext`
- update-log rows now expose audit fields, `detail`, localized `createdAt`, and
  `createdAtIso`
- CSV export now includes initiator columns and raw UTC companion timestamps

### Manual queue actions now persist system-scope audit metadata

Phase 6 stamps manual audit metadata onto:

- queued run-log rows
- `run_now` commands
- `stop_now` commands
- restart follow-up commands

### Purge behavior is now scheduler-scoped

Phase 6 switches purge preview and deletion to:

- `countOlderThanDaysBySchedulerKey`
- `deleteOlderThanDaysBySchedulerKey`

This prevents `asset-price-sync` cleanup from counting or deleting update logs
owned by other schedulers.

## 3) Phase 6 Outcome

The backend operator contract is now frozen:

1. `asset-price-sync` API responses follow the shared time and audit model
2. manual admin-triggered actions remain system execution, but initiator
   identity is preserved explicitly
3. update-log export is now audit-friendly
4. retention and purge are scoped to this scheduler only
5. restart and stop semantics now use `stop_now` consistently

## 4) Carry-Forward For Phase 7

- build any frontend/operator UX directly on these backend fields
- do not reintroduce raw UTC-only display behavior in UI mapping
- treat audit fields as additive truth, not ownership changes
- keep scheduler-scoped purge behavior intact in later proof phases

## 5) Verification

Phase 6 completion used:

- `npm run test:asset-price-sync-phase1`
- `npm run test:asset-price-sync-phase2`
- `npm run test:asset-price-sync-phase3`
- `npm run test:asset-price-sync-phase4`
- `npm run test:asset-price-sync-phase5`
- `npm run test:asset-price-sync-phase6`
- `npm run test:global-system-schedulers`
- `npm run type-check`
- `npm run build`
- `npx eslint src/api/services/AssetPriceSchedulerService.ts scripts/test-asset-price-sync-phase6.ts`
