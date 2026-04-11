# Positions Scheduler Product Split Phase 1

Date: 2026-04-10

## Goal

Phase 1 freezes the product split for the `positions-sync` workflow before any
tab or API wiring changes land in `/schedulers`.

The contract is now explicit:

- `/positions` is the operator trust surface for checkpoint freshness, route
  refresh, and day-to-day desk reconciliation review
- `/schedulers` is the admin-only surface for scheduler control and deeper
  diagnostics

This phase is intentionally about clarity, not about exposing the hidden
`positions-sync` scheduler tab yet.

## What Changed

### 1. `/positions` now says it owns live trust

The live desk copy in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.jsx`

now explicitly tells the user that Positions owns:

- checkpoint freshness
- route refresh
- operator trust for live exposure

The sync-status panel copy also now states that deeper admin scheduler
diagnostics stay in `/schedulers`.

### 2. `/schedulers` now says it is an admin diagnostics workspace

The shell copy in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`

now explicitly tells the user that Schedulers is for:

- admin-only scheduler control
- shared scheduler diagnostics

and that Positions trust, checkpoint freshness, and route refresh remain in the
Positions desk.

### 3. Focused tests now lock the split

The copy contract is now covered in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.test.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`

That means Phase 2 can change hidden scheduler wiring without re-opening the
basic product ownership decision.

## Intentional Phase 1 Boundaries

Phase 1 does not:

- unhide `positions-sync` in `/schedulers`
- add a `Positions Sync` scheduler tab
- change `/scheduler/positions/*` contracts
- change `/positions/futures/*` trust endpoints
- add admin handoff routing from `/positions` into `/schedulers`

This phase only freezes the system story so the next implementation phase is
building on explicit product intent.

## Phase 2 Entry Criteria

Phase 2 can now focus on the actual admin surface work:

- stop hiding `positions-sync` in `/schedulers`
- add a first-class `Positions Sync` scheduler profile/tab
- align frontend params with `/scheduler/positions/*` semantics
- add positions-specific diagnostics coverage in the Schedulers workspace

## Verification

Focused verification for Phase 1:

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Positions/index.jsx src/pages/Positions/index.test.jsx src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Positions/index.test.jsx src/pages/Schedulers/index.test.jsx`

Observed test noise:

- the local zsh environment may still print the existing `/dev/fd/... compdef`
  shell-noise line before some commands. The verification commands still pass.
