# Positions Scheduler Product Split Phase 8

Date: 2026-04-10

## Goal

Phase 8 turns the new recovery-history workflow into a single live-proof release
path.

Phase 7 made rebuild recovery durable and reviewable. Phase 8 makes that
recovery evidence promotable:

- one proof command now runs the positions scheduler release chain in order
- one proof artifact now captures the gate decision, signoff decision, and
  recovery evidence together
- repo-level audit coverage now treats the proof workflow as a required
  operational surface

This phase does not redesign `/positions` or `/schedulers` again. It hardens
the operational proof around the recovery model already shipped in Phase 7.

## What Changed

### 1. Positions Sync now has a single live-proof entry point

Added:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-positions-scheduler-live.ts`
- `npm run proof:positions-scheduler-live`

The proof script:

1. runs `release-gate-positions-scheduler.ts` with live health enabled
2. runs `signoff-positions-scheduler.ts` with live health review required
3. requires recovery-history evidence to be supplied
4. reads both generated artifacts
5. writes a combined proof record to
   `artifacts/positions-scheduler-live-proof.json`

That gives the positions recovery workflow one repeatable operator command
instead of separate manual release-gate and signoff steps.

### 2. Recovery evidence is now part of the live-proof contract

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-positions-scheduler-live.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-positions-scheduler.ts`

The live-proof workflow now requires:

- `POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_HISTORY_VERIFIED=true`
- `POSITIONS_SCHEDULER_SIGNOFF_RECOVERY_EVIDENCE_URL=<link>`

That means a final proof run cannot succeed without carrying explicit recovery
evidence for the rebuild history that Phase 7 introduced.

### 3. The proof workflow is now part of the repo-level operational audit

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-operational-audit.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/package.json`

The repo audit now treats these positions scheduler scripts as required:

- `check:positions-scheduler-health`
- `release-gate:positions-scheduler`
- `signoff:positions-scheduler`
- `proof:positions-scheduler-live`

That makes it much harder for the proof flow to be partially removed later.

### 4. Focused Phase 8 coverage now proves the proof chain

Updated:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-positions-scheduler-phase8.ts`

The focused Phase 8 suite now proves that:

- the proof script runs release gate and signoff in the correct order
- live checks are forced on for the release gate path
- signoff is forced to require live health review
- the proof artifact captures gate, signoff, checks, and recovery evidence
- the operational audit expects the proof workflow to remain wired

## Phase 8 Outcome

`positions-sync` now has a clean proof chain:

1. phase suites prove the diagnostics and recovery contract
2. `check:positions-scheduler-health` proves live scheduler and product-trust health
3. `release-gate:positions-scheduler` aggregates local release checks
4. `signoff:positions-scheduler` captures operator evidence
5. `proof:positions-scheduler-live` ties those records into one final proof artifact

The remaining real-world step is to run the proof workflow in the target
environment with real credentials and human evidence links.

## Carry-Forward

- run `npm run proof:positions-scheduler-live` against the target environment
- attach the real approver plus recovery, dashboard, workflow, and runbook links
- archive `artifacts/positions-scheduler-live-proof.json` with deployment evidence

## Verification

Phase 8 verification passed with:

- `npm run test:positions-scheduler-phase8`
- `npm run test:operational-audit`
- `npm run release-gate:positions-scheduler`
- `npx eslint scripts/proof-positions-scheduler-live.ts scripts/test-positions-scheduler-phase8.ts scripts/release-gate-positions-scheduler.ts scripts/signoff-positions-scheduler.ts scripts/test-operational-audit.ts`

`npm run proof:positions-scheduler-live` was not run against a live deployment
here because it still requires a reachable target environment, valid
credentials, and real human recovery evidence.
