# Broker Assets Phase 8

Date: 2026-04-10

## 1) Goal
Phase 8 closes the remaining operational gap after the Phase 7 release gate.

By the end of this phase `broker_assets` should have:

- one proof command that runs the live-ready broker-assets release chain in order
- one artifact that captures the gate decision, signoff decision, health posture,
  and evidence links together
- repo-level audit coverage that treats the broker-assets proof workflow as a
  required operational surface

Phase 8 does not redefine the broker-assets ownership or query model again.
It turns the Phase 7 release gate and signoff steps into a single proof workflow.

## 2) What Changed
### Broker-assets now has a single live-proof entry point
Phase 8 expands:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-broker-assets-live.ts`
- `npm run proof:broker-assets-live`

The proof script now:

1. runs `release-gate-broker-assets.ts` with live broker-assets health enabled
2. runs `signoff-broker-assets.ts` with live health review required
3. reads the generated release-gate, signoff, and health evidence
4. writes a combined proof record to `artifacts/broker-assets-live-proof.json`
5. writes a deployment-evidence package to
   `artifacts/broker-assets-deployment-evidence.json`

This makes the broker-assets promotion story easier to run in CI or from an
operator terminal because the release evidence chain is explicit and serialized.

### Broker-assets release gate and signoff now carry the Phase 8 suite
Phase 8 expands:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-broker-assets.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-broker-assets.ts`

The release gate now includes:

- backend broker-assets Phase 8 suite

The signoff step now requires the Phase 8 gate result alongside the earlier
broker-assets contract, flow, Phase 6, and Phase 7 checks.

That keeps the proof workflow honest: the proof path cannot claim readiness
unless the dedicated Phase 8 orchestration suite has also passed.

### Focused Phase 8 coverage now exists
Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-broker-assets-phase8.ts`
- `npm run test:broker-assets-phase8`

That focused suite verifies:

- `proof-broker-assets-live.ts` drives the release gate and signoff steps in the
  correct order
- live health is forced on for the release gate path
- signoff requires live health review in the proof path
- the combined proof artifact captures the gate file, signoff file, health file,
  approver, totals, checks, readiness, and evidence
- the deployment-evidence artifact is written alongside the live-proof artifact
- the broker-assets release gate and signoff scripts both carry the Phase 8 suite
- the operational audit treats the broker-assets proof workflow as required

### Broker-assets proof workflow is now part of the operational audit
`/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-operational-audit.ts`
now expects the broker-assets workflow markers in `package.json`:

- `check:broker-assets-health`
- `release-gate:broker-assets`
- `signoff:broker-assets`
- `proof:broker-assets-live`

That means the repo-wide audit will now flag regressions if the broker-assets
release workflow is removed or partially unwired later.

## 3) Phase 8 Outcome
`broker_assets` now has a clean proof chain instead of separate manual assembly steps:

1. `test:broker-assets` proves the stable contract, runtime flow, and Phase 6-8 guardrails
2. `check:broker-assets-health` proves the live queue, worker, global scheduler, and threshold posture
3. `release-gate:broker-assets` aggregates the local release checks
4. `signoff:broker-assets` captures operator evidence and review posture
5. `proof:broker-assets-live` ties the release gate and signoff records into one final proof artifact

That leaves only one remaining real-world task: execute the proof flow in the
target environment with real credentials and real evidence links.

## 4) Carry-Forward For Phase 9
- run `npm run proof:broker-assets-live` against the target environment with real
  auth, source thresholds, and health-check access
- capture the real approver name plus workflow, dashboard, runbook, and
  release-note links instead of placeholder acknowledgements
- decide whether the deferred `ExchangeAsset*` compatibility rename is still a
  worthwhile Phase 9 no-behavior cleanup

## 5) Verification
Phase 8 verification passed with:

- `npm run test:broker-assets-phase7`
- `npm run test:broker-assets-phase8`
- `npm run test:broker-assets`
- `npm run test:operational-audit`
- `npm run release-gate:broker-assets`
- `npx eslint scripts/proof-broker-assets-live.ts scripts/release-gate-broker-assets.ts scripts/signoff-broker-assets.ts scripts/test-broker-assets-phase7.ts scripts/test-broker-assets-phase8.ts scripts/test-operational-audit.ts`

`npm run proof:broker-assets-live` can now be run end to end, but the exact
artifact posture still depends on the target environment. If deployment evidence
links or bounded source thresholds are not supplied, the proof path will still
record placeholder or unbounded acknowledgements rather than pretending that
real deployment evidence exists.
