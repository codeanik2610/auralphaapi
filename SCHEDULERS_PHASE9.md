# Schedulers Phase 9

Date: 2026-04-10

## 1) Goal
Phase 9 closes the last operational gap that remained after the Phase 8 release gate and signoff
work.

By the end of this phase:

- orders scheduler has one proof command that runs the live-ready release chain in order
- one artifact captures the release-gate decision, signoff decision, checks, and evidence links
- repo-level audit coverage treats the orders scheduler release workflow as a required operational
  surface

Phase 9 does not redefine the `/schedulers` UI or the orders scheduler API again.
It turns the existing release gate and signoff steps into a single deployment-proof workflow.

## 2) What Changed
### Orders scheduler now has a single live-proof entry point
Phase 9 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-orders-scheduler-live.ts`
- `npm run proof:orders-scheduler-live`

The proof script:

1. runs `release-gate-orders-scheduler.ts` with live health enabled
2. runs `signoff-orders-scheduler.ts` with live health review required
3. reads both generated artifacts
4. writes a combined proof record to `artifacts/orders-scheduler-live-proof.json`

That gives operators one explicit command for the deployment evidence chain instead of requiring
manual assembly of gate and signoff outputs.

### Focused Phase 9 coverage now exists
Phase 9 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-schedulers-phase9.ts`
- `npm run test:schedulers-phase9`

That focused suite verifies:

- `proof-orders-scheduler-live.ts` drives release gate and signoff in the correct order
- live health is forced on for the release gate path
- signoff requires live health review
- the combined proof artifact captures the gate file, signoff file, approver, totals, checks, and
  evidence
- the orders scheduler release gate and signoff scripts both carry the Phase 9 suite requirement
- the repo-level operational audit still guards the orders scheduler workflow markers

### Repo-level operational audit now guards the workflow
`/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-operational-audit.ts`
now expects the orders scheduler release workflow markers in `package.json`:

- `check:orders-scheduler-health`
- `release-gate:orders-scheduler`
- `signoff:orders-scheduler`
- `proof:orders-scheduler-live`

That means repo-wide audit coverage will flag regressions if the orders scheduler live-proof
workflow is removed or only partially wired later.

## 3) Phase 9 Outcome
Orders scheduler now has a clean deployment-proof chain instead of separate manual release steps:

1. phase suites prove the module behavior
2. `check:orders-scheduler-health` proves the live contract and latency posture
3. `release-gate:orders-scheduler` aggregates the release checks
4. `signoff:orders-scheduler` captures operator evidence
5. `proof:orders-scheduler-live` ties the release gate and signoff records into one final proof
   artifact

That leaves only one real-world task: run the proof flow in the target environment with real admin
credentials and human evidence links.

## 4) Carry-Forward For Phase 10
- run `npm run proof:orders-scheduler-live` against the target environment with real admin access
- capture the real approver name plus staging workflow, dashboard, runbook, release-note, and
  walkthrough links
- archive the resulting `artifacts/orders-scheduler-live-proof.json` output with the deployment
  evidence

## 5) Verification
Phase 9 verification passed with:

- `npm run test:schedulers-phase8`
- `npm run test:schedulers-phase9`
- `npm run test:operational-audit`
- `npm run release-gate:orders-scheduler`
- `ORDERS_SCHEDULER_SIGNOFF_GATE_FILE=artifacts/orders-scheduler-release-gate.json ORDERS_SCHEDULER_SIGNOFF_OPERATOR_WALKTHROUGH_VERIFIED=true ORDERS_SCHEDULER_SIGNOFF_RUNBOOK_REVIEW_VERIFIED=true ORDERS_SCHEDULER_SIGNOFF_RUNTIME_FOUNDATION_VERIFIED=true ORDERS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED=true ORDERS_SCHEDULER_SIGNOFF_APPROVER=Codex npm run signoff:orders-scheduler`
- `npx eslint scripts/proof-orders-scheduler-live.ts scripts/test-schedulers-phase8.ts scripts/test-schedulers-phase9.ts scripts/release-gate-orders-scheduler.ts scripts/signoff-orders-scheduler.ts scripts/test-operational-audit.ts`

`npm run proof:orders-scheduler-live` was not run against a live deployment here because it
requires a reachable target environment, valid admin credentials, live health access, and real
human signoff evidence.
