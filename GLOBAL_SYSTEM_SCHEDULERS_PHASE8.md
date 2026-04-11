# Global System Schedulers Phase 8

Date: 2026-04-10

Phase 8 closes the operational proof gap after the Phase 7 frontend freeze.

This phase covers the shared subsystem made up of:

- `broker-assets-sync`
- `exchange-assets-sync`
- `binance-candles-3m-1m-sync`
- `system-health-sync`

## 1) Goal

By the end of Phase 8 these four schedulers should have:

- one live health command that validates the shared queue, worker, overview, and
  per-scheduler API surfaces together
- one release gate that proves the backend, frontend, and worker contract chain
  still matches the frozen Phase 1 through Phase 7 design
- one signoff step that captures operator review of system scope, audit truth,
  localized display times, retention scope, and worker/runtime behavior
- one proof command that runs the live-ready release chain in order and writes a
  combined deployment evidence artifact

Phase 8 does not redesign scheduler ownership, audit fields, time handling, or
frontend consumption again. It turns the previous phases into one promotable
operator workflow.

## 2) What Changed

### A shared live health script now exists

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-global-system-schedulers-health.ts`
- `npm run check:global-system-schedulers-health`

The health script verifies:

- Redis queue health and scheduler worker health
- `/scheduler/overview` coverage for all four global schedulers
- each scheduler config still advertises `schedulerType: global`
- shared time-contract metadata is still explicit and localized for display
- run history, progress, and update-log APIs still preserve system execution
  context and initiator metadata
- candles sync-state still remains reachable through the shared subsystem

The resulting snapshot is written to:

- `artifacts/global-system-schedulers-health.json`

### A release gate now validates the full subsystem chain

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-global-system-schedulers.ts`
- `npm run release-gate:global-system-schedulers`

The release gate now runs:

- backend Phase 1 through Phase 8 suites
- backend global system scheduler regression coverage
- backend operational audit coverage
- backend scoped lint for the new workflow scripts
- worker reconciliation plus worker operational-audit coverage
- frontend `/schedulers` UI plus scoped frontend lint
- optional live health verification

This is the first phase where the global scheduler subsystem is treated as one
release surface instead of separate backend/frontend/worker milestones.

### Final signoff now captures the operator review posture

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-global-system-schedulers.ts`
- `npm run signoff:global-system-schedulers`

The signoff step now records whether an operator has explicitly verified:

- the shared `/schedulers` workspace
- system-only execution scope
- initiator/audit attribution
- localized display timestamps
- scheduler-scoped retention and purge behavior
- worker/runtime behavior for the four schedulers

### One proof command now ties the live release chain together

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-global-system-schedulers-live.ts`
- `npm run proof:global-system-schedulers-live`

The proof script now:

1. runs `release-gate-global-system-schedulers.ts` with live health enabled
2. runs `signoff-global-system-schedulers.ts` with live-health review required
3. reads the generated release-gate, signoff, and health artifacts
4. writes a combined proof record to
   `artifacts/global-system-schedulers-live-proof.json`
5. writes a deployment evidence package to
   `artifacts/global-system-schedulers-deployment-evidence.json`

That gives the subsystem a single proof entry point instead of a loose set of
manual commands.

### Focused Phase 8 guard coverage now exists

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-global-system-schedulers-phase8.ts`
- `npm run test:global-system-schedulers-phase8`

That suite verifies:

- the proof script drives release gate and signoff in the correct order
- live health is forced on for the proof path
- the combined proof artifact captures gate, signoff, health, checks, readiness,
  and deployment evidence paths
- the release gate includes worker, frontend, and live health validation
- the operational audit treats the proof workflow as required

## 3) Phase 8 Outcome

The four global system schedulers now have a clean proof chain:

1. `test:global-system-schedulers-phase1` through `phase8` freeze the contract
2. `test:global-system-schedulers` proves the shared service/runtime mapping
3. `check:global-system-schedulers-health` proves the live queue, worker,
   overview, config, run, and update-log surfaces together
4. `release-gate:global-system-schedulers` aggregates backend, worker, frontend,
   and optional live-health validation
5. `signoff:global-system-schedulers` captures operator review posture
6. `proof:global-system-schedulers-live` serializes the whole release chain into
   one final proof artifact

That leaves only one real-world job for the next phase: execute the proof chain
in the target environment with real evidence links and live health access.

## 4) Carry-Forward For Phase 9

- run `npm run proof:global-system-schedulers-live` against the target
  environment with real queue, worker, and API access
- capture the real approver name plus workflow, dashboard, runbook, and release
  note links instead of placeholder review input
- execute one manual and one scheduled proof run for each of the four schedulers
  and attach the resulting evidence to the Phase 9 promotion record

## 5) Verification

Phase 8 verification passed with:

- `npm run test:global-system-schedulers-phase8`
- `npm run test:operational-audit`
- `npm run release-gate:global-system-schedulers`
- `npx eslint scripts/check-global-system-schedulers-health.ts scripts/release-gate-global-system-schedulers.ts scripts/signoff-global-system-schedulers.ts scripts/proof-global-system-schedulers-live.ts scripts/test-global-system-schedulers-phase8.ts scripts/test-operational-audit.ts`

`npm run proof:global-system-schedulers-live` is now ready, but the exact
artifact posture still depends on the target environment. Real queue/worker/API
reachability and real deployment evidence links are still required before a
production promotion claim is trustworthy.
