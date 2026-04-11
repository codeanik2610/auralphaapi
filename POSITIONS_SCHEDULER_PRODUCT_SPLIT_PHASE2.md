# Positions Scheduler Product Split Phase 2

Date: 2026-04-10

## Goal

Phase 2 restores `positions-sync` as a visible first-class scheduler inside
`/schedulers` without changing the deeper diagnostics contract yet.

The product split from Phase 1 stays intact:

- `/positions` remains the operator trust and route-refresh desk
- `/schedulers` now visibly includes `Positions Sync` as an admin scheduler tab

## What Changed

### 1. `Positions Sync` is no longer hidden in the Schedulers shell

The explicit suppression in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`

was removed by clearing the hidden-key set for `positions-sync`.

That means scheduler overview rows and active-status drawer content can now show
the positions scheduler when overview data includes it.

### 2. `Positions Sync` is now a first-class scheduler profile

`Positions Sync` now appears alongside the existing live scheduler tabs in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`

It is wired as:

- `key = positions-sync`
- `schedulerType = positions`

and is described as an admin diagnostics surface for global broker position
reconciliation.

### 3. The shell now provides positions-specific admin affordances

When `Positions Sync` is selected, the Schedulers overview workspace now exposes
admin support links for:

- `/scheduler/positions/sync-state`
- `/scheduler/positions/sync-state/summary`
- `/positions`

This keeps the split visible in the UI:

- admin diagnostics stay in Schedulers
- desk trust still belongs to Positions

### 4. Focused tests now lock visibility and URL ownership

The focused Schedulers suite now proves that:

- the `Positions Sync` tab is visible
- removed product schedulers still stay hidden
- active-status drawer can show `Positions Sync` when overview data includes it
- selecting the restored tab syncs the `scheduler=positions-sync` URL state

Coverage lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`

## Intentional Phase 2 Boundaries

Phase 2 does not:

- add the full positions diagnostics desk inside `/schedulers`
- add positions-specific sync coverage panels yet
- align owner-filter semantics for `/scheduler/positions/*`
- move trust controls out of `/positions`

This phase is about restoring visibility and first-class tab ownership, not
about finishing the deep admin workflow.

## Phase 3 Entry Criteria

Phase 3 can now focus on the frontend contract alignment for
`/scheduler/positions/*`:

- review and normalize query semantics such as `ownerUserId`
- align the shared scheduler client helpers with positions-specific controller
  expectations
- prepare the positions admin tab for dedicated diagnostics rendering

## Verification

Focused verification for Phase 2:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Schedulers/index.test.jsx`

Observed test noise:

- the local zsh environment may still print the existing `/dev/fd/... compdef`
  shell-noise line before some commands. The verification commands still pass.
