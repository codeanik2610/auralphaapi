# Positions Scheduler Product Split Phase 7

Date: 2026-04-10

## Goal

Phase 7 turns the positions recovery path into a durable operational workflow.

Phase 6 made rebuild actions safer and more explicit. Phase 7 makes those
actions persist and stay reviewable:

- rebuild actions now write structured recovery history into persisted activity
- `/schedulers` now shows durable recovery history, not just the last in-memory
  result
- the diagnostics desk now exposes owner and broker hotspots for deeper drift
  review
- final signoff now requires explicit recovery-history evidence

The product split stays the same:

- `/positions` is still the operator trust desk
- `/schedulers` is still the admin diagnostics and recovery desk

## What Changed

### 1. Positions recovery history is now a first-class backend surface

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/PositionsSchedulerController.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PositionsSchedulerService.ts`

Added canonical admin history endpoint:

- `GET /scheduler/positions/read-model/recovery-history`

Recovery actions now log structured activity with a dedicated persisted
reference:

- `positions-read-model-recovery`

Each rebuild or noop now records:

- `recoveryId`
- scope and state
- requested, targeted, processed, and skipped account totals
- row replacement totals
- before and after drift counts
- scope filters
- warnings
- recommended next step

That means browser recovery, CLI recovery, and later signoff all have a shared
history source instead of depending on transient page state.

### 2. `/schedulers` now shows durable recovery history and drift hotspots

Updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/settingsSlice.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx`

The positions diagnostics desk now includes:

- a persisted recovery-history timeline
- local filtering for history by scope and status
- owner hotspot summaries
- broker hotspot summaries
- direct rebuild and scoped JSON diagnostics from those hotspot cards

This turns the desk from a single-priority-account workflow into a broader
review surface for clustered drift.

### 3. Rebuild responses now connect directly back into persisted history

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PositionsSchedulerService.ts`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/settingsSlice.js`

The rebuild response now carries:

- `recoveryId`
- `historyEntry`

That lets the UI update the durable recovery feed immediately after a rebuild
without waiting for a full page reload.

### 4. Final signoff now requires recovery-history evidence

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-positions-scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-positions-scheduler-phase8.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-positions-scheduler-health.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-operational-audit.ts`

Final positions scheduler signoff now requires:

- `POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED=true`

It also supports an explicit recovery-evidence link through:

- `POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL`

The health script now checks that the recovery-history endpoint is present and
returns the expected durable fields.

## Intentional Phase 7 Boundaries

Phase 7 does not yet:

- build a dedicated export/download path for recovery history
- persist per-row snapshot versus read-model diffs
- add automatic correlation between recovery history and a separate incident or
  alert object
- create a global admin history shared across multiple admin identities beyond
  the current activity-log ownership model

This phase is about durable review and evidence, not full incident management.

## Phase 8 Entry Criteria

Phase 8 can now focus on stronger operational proof instead of missing recovery
durability. Good next targets are:

- recovery-history export or artifact capture
- stronger live proof around rebuild outcomes
- tying recovery evidence into a single-command proof workflow

The important part is now done: rebuild execution, persisted history, hotspot
review, and signoff evidence all point at the same recovery model.

## Verification

Focused verification for Phase 7:

- `npx eslint src/api/contracts/Scheduler.ts src/api/controllers/PositionsSchedulerController.ts src/api/services/PositionsSchedulerService.ts scripts/test-positions-scheduler-phase7.ts scripts/test-positions-scheduler-phase8.ts scripts/check-positions-scheduler-health.ts scripts/signoff-positions-scheduler.ts scripts/test-operational-audit.ts`
- `npm run test:positions-scheduler-phase7`
- `npm run test:positions-scheduler-phase8`
- `npm run test:operational-audit`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/eslint src/services/tradingApi.js src/services/tradingApi.test.js src/store/slices/settingsSlice.js src/store/slices/settingsSlice.test.js src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/services/tradingApi.test.js src/store/slices/settingsSlice.test.js src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx src/pages/Schedulers/index.test.jsx`
- `npm run release-gate:positions-scheduler`

Observed test noise:

- the focused frontend Vitest run may still emit the existing React Router
  future-flag warnings in jsdom, but the Phase 7 verification passes cleanly
