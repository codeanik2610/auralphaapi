# Global System Schedulers Phase 9

Date: 2026-04-10

## 1) Goal

Phase 9 closes the real deployment-proof gap that remained after the Phase 8
workflow landed in code.

By the end of this phase:

- the live global system scheduler subsystem captures concrete workflow and
  dashboard evidence from the backend
- signoff understands when deployment evidence is actually present and
  promotion-ready
- the real `proof:global-system-schedulers-live` workflow can be executed
  end to end against a live backend instance with concrete evidence inputs

Phase 9 does not change scheduler ownership or the shared `/schedulers`
contract again. It executes the existing workflow with real evidence.

## 2) What Changed

### Concrete global system scheduler evidence capture was added

Phase 9 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/capture-global-system-schedulers-evidence.ts`
- `npm run capture:global-system-schedulers-evidence`

That script logs into the live backend, captures:

- `/scheduler/overview`
- `/health/queue`
- `/health/worker`
- each scheduler `/config`
- each scheduler `/runs`
- latest `/progress` and `/updates` where a recent run exists
- candles `/sync-state`

and writes:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-workflow-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-dashboard-evidence.json`

Those files are then used as concrete signoff evidence instead of a placeholder
review posture.

### Shared signoff now distinguishes deployment evidence readiness

Phase 9 expands:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-global-system-schedulers.ts`

The signoff step now:

- classifies workflow, dashboard, runbook, and release-note evidence locations
- supports `GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE=true`
- records `readiness.deploymentEvidenceReady`
- only records `productionPromotionReady = true` when both the earlier review
  checks and the concrete evidence posture are satisfied

### The release gate now carries the Phase 9 suite

Phase 9 expands:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-global-system-schedulers.ts`

The release gate now includes:

- backend global system schedulers Phase 9 suite
- scoped lint coverage for the new evidence capture script

### Focused Phase 9 guard coverage now exists

Phase 9 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-global-system-schedulers-phase9.ts`
- `npm run test:global-system-schedulers-phase9`

That suite verifies:

- evidence capture is exposed through `package.json`
- the Phase 9 doc and README reference the new operator workflow
- release gate now requires the Phase 9 suite
- signoff supports deployment evidence requirements
- proof wiring preserves promotion-ready semantics

## 3) Phase 9 Outcome

The shared global system scheduler subsystem now has a real deployment-proof
path instead of a Phase 8 proof shell, and it was executed successfully on
April 10, 2026 against the local live stack at `http://127.0.0.1:3000/api/v1`.

During the live run, one real environment issue surfaced:

- `/scheduler/overview` initially failed with `ER_BAD_FIELD_ERROR` because the
  MySQL schema had not yet received
  `1770712000000-AddGlobalSystemSchedulerInitiatorAudit.ts`

That was resolved in Phase 9 by running:

- `npm run db:migrate`

which applied:

- `AddGlobalSystemSchedulerInitiatorAudit1770712000000` on MySQL

After the migration, live health, live evidence capture, release gate, signoff,
and final proof all passed.

The final live proof recorded:

- release gate: `ready`
- signoff: `ready`
- production promotion readiness: `true`
- deployment evidence readiness: `true`
- total release-gate checks: `17 passed`, `0 failed`, `0 skipped`

1. live workflow/dashboard evidence can be captured from the backend
2. live health still proves queue, worker, overview, and per-scheduler APIs
3. release gate still proves backend, worker, and frontend contract integrity
4. signoff can now require concrete deployment evidence
5. `proof:global-system-schedulers-live` can record a promotion-ready outcome

Phase 9 artifacts now exist in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-health.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-workflow-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-dashboard-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-release-gate.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-signoff.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-live-proof.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/global-system-schedulers-deployment-evidence.json`

The health snapshot uses the runtime timezone label `Asia/Calcutta`, which is
the ICU alias returned by the running environment for `Asia/Kolkata`. The proof
still passed because the timestamps are localized correctly and storage remains
UTC.

## 4) Carry-Forward For Phase 10

- rerun `npm run capture:global-system-schedulers-evidence` and
  `npm run proof:global-system-schedulers-live` in the target environment
- replace localhost-backed evidence captures with target-environment workflow
  and dashboard evidence where available
- attach one archived promotion record for the four-scheduler subsystem to the
  next deployment handoff

## 5) Verification

Phase 9 completion used:

- `npm run build`
- `npm run db:migrate`
- `npm run test:global-system-schedulers-phase8`
- `npm run test:global-system-schedulers-phase9`
- `npm run check:global-system-schedulers-health`
- `npm run capture:global-system-schedulers-evidence`
- `npm run proof:global-system-schedulers-live`
- `npx eslint scripts/test-global-system-schedulers-phase8.ts scripts/capture-global-system-schedulers-evidence.ts scripts/release-gate-global-system-schedulers.ts scripts/signoff-global-system-schedulers.ts scripts/proof-global-system-schedulers-live.ts scripts/test-global-system-schedulers-phase9.ts`
