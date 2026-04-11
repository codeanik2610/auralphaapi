# Positions Scheduler Product Split Phase 6

Date: 2026-04-10

## Goal

Phase 6 hardens the recovery experience that Phase 5 introduced.

Phase 5 made positions read-model rebuilds executable from `/schedulers`.
Phase 6 makes that recovery path safer and more legible:

- the scheduler config contract now declares recovery capability and policy
- the diagnostics desk now reports the last rebuild result in operator terms
- broader rebuild scopes now require explicit confirmation before execution

The product split does not change:

- `/positions` remains the day-to-day trust desk for operators
- `/schedulers` remains the admin diagnostics and recovery desk

## What Changed

### 1. The positions scheduler config now exposes a recovery policy contract

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PositionsSchedulerService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-positions-scheduler-phase6.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-positions-scheduler-health.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-operational-audit.ts`

`GET /scheduler/positions/config` now exposes `readModelRecoveryPolicy` for
the positions scheduler.

That policy currently declares:

- supported rebuild scopes: `account`, `owner`, `broker`, `all`
- recommended scope order for escalation
- which scopes require confirmation
- the account-count threshold that also requires confirmation
- whether drift-only rebuild is the default
- whether full rebuild-all is allowed
- the canonical CLI fallback command
- the runbook path and the intended product versus admin surfaces

This makes the recovery posture explicit instead of leaving it implied in page
copy.

### 2. `/schedulers` now surfaces richer rebuild-result truth

Updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/settingsSlice.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/settingsSlice.test.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx`

The scheduler UI now preserves the last positions rebuild response and renders
it directly in the diagnostics desk.

That result reporting includes:

- execution state and message
- performed-at timestamp
- requested versus processed account totals
- before/after drift totals
- deleted and inserted row totals
- warnings for skipped or still-drifted scopes
- a recommended next step for the admin

The config workspace also renders the recovery policy itself, including the
CLI fallback, runbook, trust desk, and admin surface.

### 3. Broader positions rebuild scopes now require confirmation

Updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx`

The positions diagnostics desk no longer exposes only a generic rebuild button.

It now provides:

- `Run account rebuild`
- `Run owner rebuild`
- `Run broker rebuild`

The page uses the recovery-policy metadata to decide when confirmation is
required. In the current policy:

- `owner`, `broker`, and `all` scopes require confirmation
- any rebuild that would touch more than `2` accounts also requires
  confirmation

This keeps the browser-triggered repair path aligned with admin intent instead
of allowing broader scope escalation silently.

## Intentional Phase 6 Boundaries

Phase 6 does not yet:

- persist a dedicated rebuild history feed beyond the most recent result
- expose a side-by-side diff viewer for snapshot versus read-model rows
- auto-trigger rebuilds from scheduler diagnostics without an explicit admin
  action
- move the recovery workflow out of `/schedulers` into the operator-facing
  `/positions` desk

This phase is about trustworthy recovery ergonomics, not automation.

## Phase 7 Entry Criteria

Phase 7 can now focus on recovery durability and operational follow-through
instead of missing guardrails. Strong next targets are:

- a persisted rebuild activity trail or exportable recovery history
- deeper drift drill-down for owner and broker scopes
- explicit evidence capture for rebuild outcomes in the positions scheduler
  signoff workflow

The important part is now in place: contract, UI guidance, confirmation, and
result reporting all agree on the same recovery model.

## Verification

Focused verification for Phase 6:

- `npx eslint src/api/contracts/Scheduler.ts src/api/services/PositionsSchedulerService.ts scripts/test-positions-scheduler-phase6.ts scripts/check-positions-scheduler-health.ts scripts/test-operational-audit.ts`
- `npm run test:positions-scheduler-phase6`
- `npm run test:operational-audit`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx src/store/slices/settingsSlice.js src/store/slices/settingsSlice.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/store/slices/settingsSlice.test.js src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx src/pages/Schedulers/index.test.jsx`
- `npm run release-gate:positions-scheduler`

Observed test noise:

- the focused frontend Vitest run may still emit the existing React Router
  future-flag warnings in jsdom, but the Phase 6 verification passes cleanly
