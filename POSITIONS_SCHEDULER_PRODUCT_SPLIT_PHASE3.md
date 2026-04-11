# Positions Scheduler Product Split Phase 3

Date: 2026-04-10

## Goal

Phase 3 aligns the restored `Positions Sync` scheduler tab with the real
frontend/backend contract for `/scheduler/positions/*`.

Phase 2 made the tab visible. Phase 3 makes that tab truthful:

- positions sync now uses the shared record-sync fetch lane in `/schedulers`
- the frontend request contract now honors `ownerUserId`
- the restored tab no longer renders orders-only affordances like account replay

The product split remains unchanged:

- `/positions` is still the operator trust and route-refresh desk
- `/schedulers` is the admin diagnostics and scheduler-control desk

## What Changed

### 1. The frontend record-sync client now supports positions ownership filters

In:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`

`getSchedulerRecordSyncState()` now switches behavior by `schedulerType`:

- `orders` still sends `userId`
- `positions` now sends `ownerUserId`
- older generic callers that still pass `userId` into the positions path are
  safely normalized into `ownerUserId`

This removes the contract drift against:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/PositionsSchedulerController.ts`

where the positions sync-state controller accepts `ownerUserId`, not `userId`.

### 2. Schedulers now treats positions as a real record-sync scheduler

In:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`

the restored `positions` scheduler now shares the same record-sync bootstrap,
refresh, completion-refresh, and polling path that `orders` already used.

That means the Positions Sync tab now actually hydrates:

- sync-state rows
- sync summary
- live refresh after terminal runs
- background polling while the live scheduler tab is open

Phase 2 restored visibility. Phase 3 restores the data path behind that
visibility.

### 3. The shared record-sync coverage desk is now positions-aware

In:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx`

the shared coverage component no longer speaks only in orders language.

It now changes copy and summary behavior by `schedulerType`:

- `Order sync health` for orders
- `Positions sync health` for positions

For positions, the desk now also surfaces the read-model reconciliation
foundation already returned by the backend:

- snapshot coverage
- read-model coverage
- read-model drift
- snapshot vs read-model totals
- latest snapshot/read-model timestamps

This gives the restored Positions Sync tab a truthful Phase 3 admin posture
without trying to finish the full diagnostics desk yet.

### 4. Positions no longer shows orders-only repair actions

In:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`

the record-sync table is now shaped by scheduler type:

- orders keeps the `Replay account` repair action
- positions removes that repair action
- positions shows `Owner user` semantics and read-model status instead

This matters because the positions scheduler does not support the same scoped
checkpoint-reset action that orders does. Leaving the replay button in place
would have made the admin tab misleading.

### 5. Focused tests now lock the Phase 3 contract

Added:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.test.js`

Updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`

The focused coverage now proves that:

- `positions` requests use `ownerUserId`
- older generic callers still normalize safely into `ownerUserId`
- `orders` keeps `userId`
- `Positions Sync` renders a positions-aware truth panel
- positions renders read-model drift state
- positions no longer shows the orders-only replay action

## Intentional Phase 3 Boundaries

Phase 3 does not yet:

- build a dedicated positions-only diagnostics component
- add per-row rebuild/reconciliation actions for positions
- add deeper read-model drill-down or diff views
- change the operator-facing trust workflow in `/positions`

This phase is about making the restored admin tab correct, not finishing the
full positions diagnostics experience.

## Phase 4 Entry Criteria

Phase 4 can now focus on the real positions admin diagnostics layer inside
`/schedulers`:

- dedicated positions diagnostics rendering or a richer generalized record-sync desk
- row-level read-model drift details
- rebuild/reconciliation recommendations and recovery affordances
- deeper summary of snapshot vs read-model divergence

Because Phase 3 aligned the request contract and removed the orders-only UI
assumptions, Phase 4 can build on the right product shape instead of working
around drift.

## Verification

Focused verification for Phase 3:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/services/tradingApi.js src/services/tradingApi.test.js src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/services/tradingApi.test.js src/pages/Schedulers/index.test.jsx`

Observed test noise:

- the focused Vitest run may still emit the existing React Router future-flag
  warnings in jsdom, but the Phase 3 verification passes cleanly
