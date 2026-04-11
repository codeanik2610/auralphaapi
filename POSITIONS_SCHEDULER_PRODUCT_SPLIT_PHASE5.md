# Positions Scheduler Product Split Phase 5

Date: 2026-04-10

## Goal

Phase 5 turns the positions read-model rebuild path from a documented admin
drill into a real browser-triggered admin action.

Phase 4 made the drift visible and explained the recovery path. Phase 5 closes
the loop:

- `/schedulers` can now trigger a scoped positions read-model rebuild directly
- the backend exposes a guarded admin API for that rebuild
- the release gate and signoff workflow now treat Phase 5 as a first-class part
  of the positions scheduler rollout

The product split stays the same:

- `/positions` is still the operator trust desk
- `/schedulers` is now both the diagnostics desk and the admin recovery desk

## What Changed

### 1. Positions scheduler now exposes a real rebuild API

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/PositionsSchedulerController.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PositionsSchedulerService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/scheduler.validator.ts`

Added canonical admin mutation:

- `POST /scheduler/positions/read-model/rebuild`

The new contract accepts scoped admin filters:

- `accountId`
- `ownerUserId`
- `brokerKey`
- `onlyDrifted`
- `limit`
- `rebuildAll`

The service now:

- resolves connected positions accounts for the requested scope
- optionally narrows that scope to accounts that actually need a rebuild
- rebuilds read models from `scheduler_positions_snapshots`
- returns before/after coverage plus rebuild totals
- logs success, noop, and failure activity with the canonical positions
  scheduler route

### 2. `/schedulers` can now execute the scoped rebuild directly

Updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/settingsSlice.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx`

The priority account block in the positions diagnostics desk now has a real
`Run scoped rebuild` action.

That action:

- posts the scoped payload to `/scheduler/positions/read-model/rebuild`
- reuses the shared scheduler action banner state
- refreshes positions sync-state truth after success
- keeps the script drill visible as the fallback and audit-friendly operator
  reference

This means the admin no longer has to leave the page just to execute the
recommended recovery step.

### 3. The positions rollout gate now includes Phase 5

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/package.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-positions-scheduler-phase5.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-positions-scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-positions-scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-operational-audit.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-positions-scheduler-phase8.ts`

Phase 5 now has a dedicated backend suite:

- `npm run test:positions-scheduler-phase5`

The positions scheduler release gate now treats Phase 5 as required, and the
Phase 8 signoff proof test was updated so it no longer assumes the old
pre-Phase-5 suite list.

### 4. Focused tests now protect the recovery path

Added:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-positions-scheduler-phase5.ts`

Updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`

The new focused coverage proves:

- the rebuild payload is validated and normalized
- the service rebuilds only drifted accounts inside the requested scope
- healthy scopes return a truthful noop instead of mutating
- the frontend posts to the canonical rebuild endpoint
- the diagnostics desk button invokes the scoped action
- the page refreshes record-sync truth after a successful rebuild

## Intentional Phase 5 Boundaries

Phase 5 does not yet:

- add per-row snapshot versus read-model diff viewers
- move rebuild execution into the day-to-day `/positions` desk
- add live health mutations to automated checks
- replace the CLI rebuild script as the lowest-level recovery tool

This phase is about making admin recovery executable from the browser while
keeping the underlying script and operational discipline intact.

## Phase 6 Entry Criteria

Phase 6 can now focus on deeper execution ergonomics instead of missing
recovery plumbing. Good next targets are:

- richer rebuild result reporting inside the diagnostics desk
- explicit rebuild capability metadata and runbook links in the contract
- deciding whether larger-scope rebuilds need extra confirmation or dedicated
  admin policy controls

The important part is now done: diagnostics, contract, execution, and rollout
verification all agree on the same recovery model.

## Verification

Focused verification for Phase 5:

- `npx eslint src/api/contracts/Scheduler.ts src/api/controllers/PositionsSchedulerController.ts src/api/services/PositionsSchedulerService.ts src/api/validators/scheduler.validator.ts scripts/test-positions-scheduler-phase5.ts scripts/release-gate-positions-scheduler.ts scripts/signoff-positions-scheduler.ts scripts/test-operational-audit.ts scripts/test-positions-scheduler-phase8.ts`
- `npm run test:positions-scheduler-phase5`
- `npm run test:positions-scheduler-phase8`
- `npm run release-gate:positions-scheduler`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/services/tradingApi.js src/services/tradingApi.test.js src/store/slices/settingsSlice.js src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/services/tradingApi.test.js src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx src/pages/Schedulers/index.test.jsx`

Observed test noise:

- the focused frontend Vitest run may still emit the existing React Router
  future-flag warnings in jsdom, but the Phase 5 verification passes cleanly
