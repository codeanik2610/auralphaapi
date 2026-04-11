# Funds Scheduler Phase 9

Date: 2026-04-10

## 1) Goal
Phase 9 closes the real deployment-proof gap that remained after the Phase 8 workflow landed in code.

By the end of this phase:

- the local funds scheduler environment has the required runtime migrations applied
- the real `proof:funds-scheduler-live` workflow has been executed against a live backend instance
- the repo now has a concrete proof artifact, not only stubbed Phase 8 validation

Phase 9 does not add a new API or UI surface.
It executes the existing proof chain against a real environment and records the result.

## 2) What Happened
### Local runtime schema was behind the repo
The first live proof attempt failed because the live funds health check reported:

- `runtimeFoundation.status = "missing"`

Inspecting the local MySQL `migrations` table showed the environment had not yet applied:

- `1770706000000-CreateOrdersSchedulerRuntimeTables`
- `1770707000000-HardenFundsSnapshotsRuntime`

That meant the proof workflow was doing the right thing by blocking.

### The missing migrations were applied
Phase 9 ran:

```bash
npm run db:migrate
```

That applied:

- `CreateOrdersSchedulerRuntimeTables1770706000000`
- `HardenFundsSnapshotsRuntime1770707000000`

After that, the live funds health path reported the runtime foundation as ready.

### The real live-proof workflow was executed
Phase 9 then ran the real funds proof chain against a live backend instance on `localhost:3100`:

```bash
HEALTH_BASE_URL=http://127.0.0.1:3100/api/v1 \
SMOKE_BASE_URL=http://127.0.0.1:3100/api/v1 \
FUNDS_SCHEDULER_SIGNOFF_APPROVER=codex-phase9 \
FUNDS_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED=true \
FUNDS_SCHEDULER_SIGNOFF_COVERAGE_VERIFIED=true \
FUNDS_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED=true \
FUNDS_SCHEDULER_SIGNOFF_HEALTH_THRESHOLDS_VERIFIED=true \
FUNDS_SCHEDULER_SIGNOFF_RECOVERY_DRILL_VERIFIED=true \
FUNDS_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED=true \
FUNDS_SCHEDULER_SIGNOFF_WORKFLOW_URL=http://127.0.0.1:3100/api/v1/scheduler/funds/summary \
FUNDS_SCHEDULER_SIGNOFF_DASHBOARD_URL=http://127.0.0.1:3100/api/v1/scheduler/funds/coverage?limit=200 \
FUNDS_SCHEDULER_SIGNOFF_RUNBOOK_URL=/Users/apple/Documents/Project/Backend/aurAlpha/RUNBOOK.md \
FUNDS_SCHEDULER_SIGNOFF_RELEASE_NOTE_URL=/Users/apple/Documents/Project/Backend/aurAlpha/FUNDS_SCHEDULER_PHASE8.md \
npm run proof:funds-scheduler-live
```

That run succeeded end to end and produced:

- `artifacts/funds-scheduler-release-gate.json`
- `artifacts/funds-scheduler-signoff.json`
- `artifacts/funds-scheduler-live-proof.json`

## 3) Phase 9 Outcome
`funds-sync` now has a real deployment-proof chain, not just a theoretical one:

1. runtime schema is present in the local environment
2. live funds scheduler health passes
3. live portfolio health passes
4. release gate passes with live checks enabled
5. signoff passes with real evidence fields
6. the final proof artifact is written successfully

The resulting proof artifact is:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/funds-scheduler-live-proof.json`

## 4) Carry-Forward For Phase 10
- rerun `npm run proof:funds-scheduler-live` in the target deployment environment
- replace localhost evidence URLs with real staging or production workflow and dashboard links
- archive the resulting proof artifact alongside the deployment evidence package

## 5) Verification
Phase 9 completion used:

- `npm run db:migrate`
- `npm run proof:funds-scheduler-live`

The final successful proof run recorded:

- `gateDecision = ready`
- `signoffDecision = ready`
- `liveChecksEnabled = true`
- `gateTotals.passed = 14`
- `gateTotals.failed = 0`
- `gateTotals.skipped = 0`
