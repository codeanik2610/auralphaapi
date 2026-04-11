# Asset Price Sync Phase 8

Date: 2026-04-10

Phase 8 closes the operational proof gap after the Phase 7 frontend/operator freeze.

## 1) Goal

By the end of Phase 8 `asset-price-sync` should have:

- one live health command that validates queue, worker, overview, config,
  asset-scope, run-history, progress, and update-log surfaces together
- one release gate that proves the Phase 1 through Phase 7 contract still
  holds across backend, frontend, and worker touch points
- one signoff step that captures operator review of run-scope overrides,
  broker-asset-id writes, system-source truth, and time/audit display behavior
- one proof command that runs the live-ready release chain in order and writes a
  combined deployment evidence artifact

Phase 8 does not redesign source selection, runtime storage, scheduler
ownership, or frontend save/run payload semantics again. It turns the earlier
phases into one promotable workflow.

## 2) What Changed

### Live health is now a first-class operator entry point

Phase 8 formalizes:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-asset-price-sync-health.ts`
- `npm run check:asset-price-sync-health`

The health script verifies:

- Redis queue health and scheduler worker health
- `/scheduler/overview` coverage for `asset-price-sync`
- `/scheduler/asset-price/config` still advertises `schedulerType: global`
- Mudrex and Delta Exchange remain the system-source contract
- scope assets, run history, run progress, and update logs remain reachable
- localized display-time metadata and UTC raw-time companions stay explicit

The resulting snapshot is written to:

- `artifacts/asset-price-sync-health.json`

### A release gate now validates the full operator chain

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-asset-price-sync.ts`
- `npm run release-gate:asset-price-sync`

The release gate now runs:

- backend Phase 1 through Phase 8 suites
- shared global-system-scheduler regression coverage
- backend operational-audit coverage
- backend scoped lint for the asset-price workflow
- optional worker build coverage
- optional frontend `/schedulers` UI test plus scoped frontend lint
- optional live health verification

This is the first phase where `asset-price-sync` is treated as a release
surface instead of separate migration, worker, and UI milestones.

### Final signoff now records the key operator reviews

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-asset-price-sync.ts`
- `npm run signoff:asset-price-sync`

The signoff step now records whether an operator has explicitly reviewed:

- the `/schedulers` operator workspace
- run-now scope override behavior
- broker-asset-id scoped writes into `asset_price`
- Mudrex and Delta Exchange as the live system-source contract
- localized time display and audit metadata
- threshold posture for the live health checks

### One proof command now ties the release chain together

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-asset-price-sync-live.ts`
- `npm run proof:asset-price-sync-live`

The proof script now:

1. runs `release-gate-asset-price-sync.ts` with live health enabled
2. runs `signoff-asset-price-sync.ts` with live-health review required
3. reads the generated release-gate, signoff, and health artifacts
4. writes a combined proof record to
   `artifacts/asset-price-sync-live-proof.json`
5. writes a deployment evidence package to
   `artifacts/asset-price-sync-deployment-evidence.json`

That gives `asset-price-sync` one proof entry point instead of a loose sequence
of manual commands.

### Focused Phase 8 guard coverage now exists

Phase 8 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-asset-price-sync-phase8.ts`
- `npm run test:asset-price-sync-phase8`

That suite verifies:

- the proof script drives release gate and signoff in the correct order
- live health is forced on for the proof path
- the combined proof artifact captures gate, signoff, health, threshold, and
  deployment evidence paths
- the release gate includes frontend, worker, and live-health validation
- the operational audit treats the proof workflow as required

## 3) Phase 8 Outcome

`asset-price-sync` now has a clean proof chain:

1. `test:asset-price-sync-phase1` through `phase8` freeze the contract
2. `test:global-system-schedulers` proves the shared scheduler behavior still
   treats `asset-price-sync` as a global system scheduler
3. `check:asset-price-sync-health` proves the live queue, worker, overview,
   config, asset-scope, run, progress, and update-log surfaces together
4. `release-gate:asset-price-sync` aggregates backend, worker, frontend, and
   optional live-health validation
5. `signoff:asset-price-sync` captures operator review posture
6. `proof:asset-price-sync-live` serializes the whole release chain into one
   final proof artifact

That leaves one remaining real-world job for the next phase: run the proof
chain against the target environment with real evidence links and live health
access.

## 4) Carry-Forward For Phase 9

- run `npm run proof:asset-price-sync-live` against the target environment with
  real queue, worker, and API access
- capture the real approver name plus workflow, dashboard, runbook, and release
  note links instead of placeholder review input
- execute one manual proof run and one scheduled proof run and attach the
  resulting evidence to the Phase 9 promotion record

## 5) Verification

Phase 8 verification passed with:

- `npm run test:asset-price-sync-phase8`
- `npm run test:operational-audit`
- `npm run release-gate:asset-price-sync`
- `npx eslint scripts/check-asset-price-sync-health.ts scripts/release-gate-asset-price-sync.ts scripts/signoff-asset-price-sync.ts scripts/proof-asset-price-sync-live.ts scripts/test-asset-price-sync-phase8.ts scripts/test-operational-audit.ts`

`npm run proof:asset-price-sync-live` is now ready, but the exact artifact
posture still depends on the target environment. Real queue/worker/API
reachability and real deployment evidence links are still required before a
production promotion claim is trustworthy.
