# Positions Scheduler Product Split Phase 4

Date: 2026-04-10

## Goal

Phase 4 turns the restored `Positions Sync` tab in `/schedulers` into a real
admin diagnostics desk.

Phase 3 aligned the request contract and made the tab truthful. Phase 4 adds
the operational layer an admin actually needs:

- read-model drift triage
- row-level reconciliation details
- scoped diagnostics links
- an explicit rebuild drill path

The product split still stays intact:

- `/positions` is the operator trust and route-refresh desk
- `/schedulers` is the admin-only diagnostics and scheduler-control desk

## What Changed

### 1. Positions now has a dedicated diagnostics layer inside the shared sync desk

Added:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx`

This panel is rendered only for `schedulerType = positions` from:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx`

The panel uses the existing positions scheduler summary and row contract to
surface:

- accounts needing a read-model rebuild
- owners affected by rebuild-worthy drift
- rows behind snapshot
- missing and orphan read-model counts
- the current highest-priority account for admin follow-up

### 2. Row-level drift details are now visible without leaving the tab

The positions diagnostics panel now highlights one priority account using the
sync-state payload already returned by `/scheduler/positions/sync-state`.

The admin can now see in one place:

- account ID
- owner user
- broker key
- read-model state
- snapshot versus read-model row counts
- missing / behind / orphan row counts
- pending / failed record counts
- latest snapshot and read-model timestamps
- next retry timing

That means the tab now answers the Phase 4 operator question directly:

- is this drift real?
- who owns it?
- what should I do next?

### 3. The tab now exposes scoped diagnostics and rebuild drill affordances

For the current priority account, the positions diagnostics desk now exposes:

- owner-scoped sync-state JSON
- account-scoped sync-state JSON

It also renders a concrete rebuild drill based on the repo-supported command:

- `npm run rebuild:positions-read-model`

and points directly at:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/rebuild-positions-read-model.ts`

This matters because the rebuild path exists today as an admin script, not as a
route-level API mutation. Phase 4 makes that operational truth visible instead
of hiding it behind release docs.

### 4. The positions config workspace now has an intentional operator intro

Updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx`

`Positions Sync` no longer falls through to the generic scheduler layout.

The config workspace now introduces a dedicated `Positions diagnostics workflow`
card that explains the correct recovery split:

- use the diagnostics desk for drift triage and rebuild drills
- use `Run now` only when a full reconciliation pass is required
- keep `/positions` as the trust surface for normal operators

### 5. Focused tests now lock the Phase 4 admin workflow

Added:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx`

Updated:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`

The focused frontend coverage now proves that:

- the positions tab renders the new diagnostics workflow
- the diagnostics desk shows read-model drift and priority account details
- the scoped rebuild drill is visible
- owner-scoped diagnostics JSON is exposed
- positions still does not inherit the orders-only `Replay account` action

## Intentional Phase 4 Boundaries

Phase 4 does not yet:

- add a write API for read-model rebuilds from the browser
- add inline mutation buttons for scoped rebuild execution
- add per-row diff visualizations for snapshot versus read-model records
- change the user-owned `/positions` workflow

This phase is about making the admin diagnostics desk operationally complete
enough to guide recovery, not about turning the browser into the execution
surface for rebuild scripts.

## Phase 5 Entry Criteria

Phase 5 can now focus on the next step beyond diagnostics:

- decide whether positions rebuild tooling should remain script-driven or move
  behind an explicit admin API contract
- add stronger release/runbook integration if browser-triggered recovery is
  still intentionally deferred
- tighten any remaining backend/frontend gaps around rebuild evidence and
  recovery observability

Because Phase 4 now exposes scoped drift review and the rebuild drill path,
Phase 5 can focus on execution ergonomics instead of missing diagnostics.

## Verification

Focused verification for Phase 4:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.jsx src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Schedulers/components/SchedulerPositionsDiagnosticsPanel.test.jsx src/pages/Schedulers/index.test.jsx`

Observed test noise:

- the focused Vitest run may still emit the existing React Router future-flag
  warnings in jsdom, but the Phase 4 verification passes cleanly
