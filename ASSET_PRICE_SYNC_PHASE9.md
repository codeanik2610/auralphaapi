# Asset Price Sync Phase 9

Date: 2026-04-10

## 1) Goal

Phase 9 closes the real deployment-proof gap that remained after the Phase 8
workflow landed in code.

By the end of this phase:

- the live `asset-price-sync` proof uses bounded thresholds instead of the
  placeholder acknowledgement posture from Phase 8
- concrete workflow and dashboard evidence files are captured from the live
  asset-price scheduler endpoints before signoff
- the real `proof:asset-price-sync-live` workflow has been executed end to end
  against a live backend instance with concrete evidence inputs

Phase 9 does not change the `asset_price` storage contract again. It executes
the existing workflow with real bounded evidence.

## 2) What Changed

### Concrete asset-price evidence capture was added

Phase 9 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/capture-asset-price-sync-evidence.ts`
- `npm run capture:asset-price-sync-evidence`

That script logs into the live backend, captures:

- `/health/queue`
- `/health/worker`
- `/scheduler/overview`
- `/scheduler/asset-price/config`
- `/scheduler/asset-price/assets`
- `/scheduler/asset-price/runs`
- latest `/progress` and `/updates` where a recent run exists

and writes:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-workflow-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-dashboard-evidence.json`

Those files are then used as concrete signoff evidence locations instead of the
missing-placeholder posture recorded in Phase 8.

### Bounded thresholds were frozen from a real live snapshot

Phase 9 first ran a live asset-price health measurement against
`http://127.0.0.1:3102/api/v1`:

```bash
HEALTH_BASE_URL=http://127.0.0.1:3102/api/v1 \
SMOKE_BASE_URL=http://127.0.0.1:3102/api/v1 \
npm run check:asset-price-sync-health
```

That measurement reported:

- `configLatencyMs = 13`
- `assetsLatencyMs = 28`
- `runsLatencyMs = 28`
- `assetTotal = 0`
- `runTotal = 0`

The local Phase 9 environment currently has an empty `asset-price` scope and no
historical asset-price runs, so the bounded proof posture in this environment
keeps the API healthy while explicitly allowing zero-volume results.

Phase 9 then froze the following bounded thresholds for the real proof run:

- `ASSET_PRICE_SYNC_HEALTH_MAX_CONFIG_LATENCY_MS=500`
- `ASSET_PRICE_SYNC_HEALTH_MAX_ASSET_LIST_LATENCY_MS=500`
- `ASSET_PRICE_SYNC_HEALTH_MAX_RUN_LIST_LATENCY_MS=500`
- `ASSET_PRICE_SYNC_HEALTH_REQUIRE_ASSET_RESULTS=false`
- `ASSET_PRICE_SYNC_HEALTH_MIN_ASSET_RESULTS=0`
- `ASSET_PRICE_SYNC_HEALTH_MIN_RUN_RESULTS=0`

That moved the asset-price threshold posture from `unbounded` to `bounded`.

### The real live-proof workflow was executed with concrete evidence

The app already running on `localhost:3000` was serving an older build that did
not yet expose the Phase 6 `time` contract on `/scheduler/asset-price/config`.

Phase 9 resolved that by rebuilding the backend and starting the updated app on
`localhost:3102`, then capturing evidence and running the real asset-price
proof chain there:

```bash
npm run build
PORT=3102 node dist/app.js
```

```bash
HEALTH_BASE_URL=http://127.0.0.1:3102/api/v1 \
SMOKE_BASE_URL=http://127.0.0.1:3102/api/v1 \
npm run capture:asset-price-sync-evidence
```

```bash
HEALTH_BASE_URL=http://127.0.0.1:3102/api/v1 \
SMOKE_BASE_URL=http://127.0.0.1:3102/api/v1 \
ASSET_PRICE_SYNC_HEALTH_REQUIRE_ASSET_RESULTS=false \
ASSET_PRICE_SYNC_HEALTH_MAX_CONFIG_LATENCY_MS=500 \
ASSET_PRICE_SYNC_HEALTH_MAX_ASSET_LIST_LATENCY_MS=500 \
ASSET_PRICE_SYNC_HEALTH_MAX_RUN_LIST_LATENCY_MS=500 \
ASSET_PRICE_SYNC_HEALTH_MIN_ASSET_RESULTS=0 \
ASSET_PRICE_SYNC_HEALTH_MIN_RUN_RESULTS=0 \
ASSET_PRICE_SYNC_SIGNOFF_APPROVER=codex-phase9 \
ASSET_PRICE_SYNC_SIGNOFF_OPERATOR_WORKSPACE_REVIEWED=true \
ASSET_PRICE_SYNC_SIGNOFF_RUN_SCOPE_OVERRIDE_REVIEWED=true \
ASSET_PRICE_SYNC_SIGNOFF_BROKER_ASSET_ID_REVIEWED=true \
ASSET_PRICE_SYNC_SIGNOFF_SYSTEM_SOURCES_REVIEWED=true \
ASSET_PRICE_SYNC_SIGNOFF_TIME_AUDIT_REVIEWED=true \
ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE=true \
ASSET_PRICE_SYNC_SIGNOFF_STAGING_WORKFLOW_URL=/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-workflow-evidence.json \
ASSET_PRICE_SYNC_SIGNOFF_DASHBOARD_URL=/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-dashboard-evidence.json \
ASSET_PRICE_SYNC_SIGNOFF_RUNBOOK_URL=/Users/apple/Documents/Project/Backend/aurAlpha/RUNBOOK.md \
ASSET_PRICE_SYNC_SIGNOFF_RELEASE_NOTE_URL=/Users/apple/Documents/Project/Backend/aurAlpha/ASSET_PRICE_SYNC_PHASE9.md \
npm run proof:asset-price-sync-live
```

That run writes:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-health.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-release-gate.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-signoff.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-live-proof.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-deployment-evidence.json`

## 3) Phase 9 Outcome

`asset-price-sync` now has a real bounded deployment-proof chain instead of the
Phase 8 acknowledgement posture:

1. live asset-price health is measured first
2. bounded zero-volume thresholds are explicitly configured for the current
   local dataset
3. workflow and dashboard evidence are captured into local evidence artifacts
4. release gate passes with live checks enabled
5. signoff passes with deployment evidence required
6. the final proof and deployment-evidence artifacts are written successfully

The key resulting artifacts are:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-health.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-workflow-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-dashboard-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-live-proof.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/asset-price-sync-deployment-evidence.json`

## 4) Carry-Forward For Phase 10

- rerun `npm run capture:asset-price-sync-evidence` and
  `npm run proof:asset-price-sync-live` in the target deployment environment
- replace localhost-backed evidence captures with target-environment workflow
  and dashboard evidence where available
- decide whether a dedicated operator dashboard for asset-price run outcomes is
  still worthwhile beyond the shared `/schedulers` surface

## 5) Verification

Phase 9 completion used:

- `npm run build`
- `npm run test:asset-price-sync-phase9`
- `npm run check:asset-price-sync-health`
- `npm run capture:asset-price-sync-evidence`
- `npm run proof:asset-price-sync-live`

The final successful proof run recorded:

- `gateDecision = ready`
- `signoffDecision = ready`
- `liveChecksEnabled = true`
- `readiness.deploymentEvidenceReady = true`
- `readiness.thresholdProfileMode = bounded`
- `gateTotals.passed = 16`
- `gateTotals.failed = 0`
