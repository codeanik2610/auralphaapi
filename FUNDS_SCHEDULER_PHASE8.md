# Funds Scheduler Phase 8

Date: 2026-04-10

## 1) Goal
Phase 8 closes the remaining operational gap after the Phase 7 release gate.

By the end of this phase `funds-sync` should have:

- one proof command that runs the live-ready funds scheduler release chain in order
- one artifact that captures the gate decision, signoff decision, and evidence links together
- repo-level audit coverage that treats the funds scheduler release workflow as a required operational surface

Phase 8 does not redefine the funds scheduler API or UI again.
It turns the Phase 7 gate and signoff steps into a single proof workflow.

## 2) What Changed
### Funds scheduler now has a single live-proof entry point
Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-funds-scheduler-live.ts`
- `npm run proof:funds-scheduler-live`

The proof script:

1. runs `release-gate-funds-scheduler.ts` with live health enabled
2. runs `signoff-funds-scheduler.ts` with live health review required
3. reads both generated artifacts
4. writes a combined proof record to `artifacts/funds-scheduler-live-proof.json`

This makes the operational release story easier to run in CI or from an operator terminal because the evidence chain is explicit and serialized.

### Focused Phase 8 coverage now exists
Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-funds-scheduler-phase8.ts`
- `npm run test:funds-scheduler-phase8`

That focused suite verifies:

- `proof-funds-scheduler-live.ts` drives the release gate and signoff steps in the correct order
- live health is forced on for the release gate path
- signoff requires live health review
- the combined proof artifact captures the gate file, signoff file, approver, totals, checks, and evidence
- the funds scheduler release gate and signoff scripts both carry the Phase 8 suite requirement
- the operational audit treats the proof workflow as required

### Funds scheduler release workflow is now part of the operational audit
`/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-operational-audit.ts`
now expects the funds scheduler workflow markers in `package.json`:

- `check:funds-scheduler-health`
- `release-gate:funds-scheduler`
- `signoff:funds-scheduler`
- `proof:funds-scheduler-live`

That means the repo-wide audit will now flag regressions if the funds scheduler release workflow is removed or partially unwired later.

## 3) Phase 8 Outcome
`funds-sync` now has a clean proof chain instead of separate manual assembly steps:

1. phase suites prove module behavior
2. `check:funds-scheduler-health` proves the live scheduler, coverage, and downstream product-trust contract
3. `release-gate:funds-scheduler` aggregates local release checks
4. `signoff:funds-scheduler` captures operator evidence
5. `proof:funds-scheduler-live` ties the release gate and signoff records into one final proof artifact

That leaves only one remaining real-world task: execute the proof flow in the target environment with real credentials and human evidence links.

## 4) Carry-Forward For Phase 9
- run `npm run proof:funds-scheduler-live` against the target environment with real auth and health-check access
- capture the real approver name plus workflow, dashboard, runbook, and release-note links
- archive the resulting `artifacts/funds-scheduler-live-proof.json` output with the release evidence for deployment

## 5) Verification
Phase 8 verification passed with:

- `npm run test:funds-scheduler-phase7`
- `npm run test:funds-scheduler-phase8`
- `npm run test:operational-audit`
- `npm run release-gate:funds-scheduler`
- `npx eslint scripts/proof-funds-scheduler-live.ts scripts/test-funds-scheduler-phase7.ts scripts/test-funds-scheduler-phase8.ts scripts/release-gate-funds-scheduler.ts scripts/signoff-funds-scheduler.ts scripts/test-operational-audit.ts`

`npm run proof:funds-scheduler-live` was not run against a live deployment here because it requires a reachable target environment, valid credentials, and real human signoff evidence.
