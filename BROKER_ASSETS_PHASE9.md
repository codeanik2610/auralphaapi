# Broker Assets Phase 9

Date: 2026-04-10

## 1) Goal
Phase 9 closes the real deployment-proof gap that remained after the Phase 8
workflow landed in code.

By the end of this phase:

- the live broker-assets proof uses bounded thresholds instead of the unbounded
  acknowledgement posture from Phase 8
- concrete workflow and dashboard evidence files are captured from the live
  broker-assets endpoints before signoff
- the real `proof:broker-assets-live` workflow has been executed end to end
  against a live backend instance with concrete evidence inputs

Phase 9 does not change the `broker_assets` ownership model again.
It executes the existing release workflow with real bounded evidence.

## 2) What Happened
### Concrete broker-assets evidence capture was added
Phase 9 adds:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/capture-broker-assets-evidence.ts`
- `npm run capture:broker-assets-evidence`

That script logs into the live backend, captures:

- `/scheduler/exchange-assets/config`
- `/scheduler/exchange-assets/assets`
- `/exchange-assets`
- `/exchange-assets?source=...` for each configured broker-assets source

and writes:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-workflow-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-dashboard-evidence.json`

Those files are then used as concrete signoff evidence locations instead of the
missing-placeholder posture recorded in Phase 8.

### Bounded thresholds were frozen from a real live snapshot
Phase 9 first ran a live broker-assets health measurement against
`http://127.0.0.1:3102/api/v1` with per-source visibility enabled:

```bash
HEALTH_BASE_URL=http://127.0.0.1:3102/api/v1 \
SMOKE_BASE_URL=http://127.0.0.1:3102/api/v1 \
BROKER_ASSETS_HEALTH_REQUIRED_VISIBLE_SOURCES=mudrex,delta_exchange \
npm run check:broker-assets-health
```

That measurement reported:

- `adminCatalogLatencyMs = 7339`
- `visibleLatencyMs = 45`
- `adminCatalogTotal = 480`
- `visibleTotal = 919`
- `mudrex total = 540`
- `delta_exchange total = 379`

Phase 9 then froze the following bounded thresholds for the real proof run:

- `BROKER_ASSETS_HEALTH_MAX_ADMIN_CATALOG_LATENCY_MS=12000`
- `BROKER_ASSETS_HEALTH_MAX_VISIBLE_LATENCY_MS=500`
- `BROKER_ASSETS_HEALTH_MIN_ADMIN_CATALOG_RESULTS=400`
- `BROKER_ASSETS_HEALTH_MIN_VISIBLE_RESULTS=800`
- `BROKER_ASSETS_HEALTH_REQUIRED_VISIBLE_SOURCES=mudrex,delta_exchange`
- `BROKER_ASSETS_HEALTH_MIN_MUDREX_VISIBLE_RESULTS=400`
- `BROKER_ASSETS_HEALTH_MIN_DELTA_EXCHANGE_VISIBLE_RESULTS=300`

That moved the broker-assets threshold posture from `unbounded` to `bounded`.

### The real live-proof workflow was executed with concrete evidence
Phase 9 started a live backend instance on `localhost:3102`, captured evidence,
and then ran the real broker-assets proof chain:

```bash
PORT=3102 node dist/app.js
```

```bash
HEALTH_BASE_URL=http://127.0.0.1:3102/api/v1 \
SMOKE_BASE_URL=http://127.0.0.1:3102/api/v1 \
npm run capture:broker-assets-evidence
```

```bash
HEALTH_BASE_URL=http://127.0.0.1:3102/api/v1 \
SMOKE_BASE_URL=http://127.0.0.1:3102/api/v1 \
BROKER_ASSETS_HEALTH_MAX_ADMIN_CATALOG_LATENCY_MS=12000 \
BROKER_ASSETS_HEALTH_MAX_VISIBLE_LATENCY_MS=500 \
BROKER_ASSETS_HEALTH_MIN_ADMIN_CATALOG_RESULTS=400 \
BROKER_ASSETS_HEALTH_MIN_VISIBLE_RESULTS=800 \
BROKER_ASSETS_HEALTH_REQUIRED_VISIBLE_SOURCES=mudrex,delta_exchange \
BROKER_ASSETS_HEALTH_MIN_MUDREX_VISIBLE_RESULTS=400 \
BROKER_ASSETS_HEALTH_MIN_DELTA_EXCHANGE_VISIBLE_RESULTS=300 \
BROKER_ASSETS_SIGNOFF_APPROVER=codex-phase9 \
BROKER_ASSETS_SIGNOFF_GLOBAL_CATALOG_VERIFIED=true \
BROKER_ASSETS_SIGNOFF_CONNECTED_VISIBILITY_VERIFIED=true \
BROKER_ASSETS_SIGNOFF_DELTA_LOOKUP_VERIFIED=true \
BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED=true \
BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED=true \
BROKER_ASSETS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE=true \
BROKER_ASSETS_SIGNOFF_STAGING_WORKFLOW_URL=/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-workflow-evidence.json \
BROKER_ASSETS_SIGNOFF_DASHBOARD_URL=/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-dashboard-evidence.json \
BROKER_ASSETS_SIGNOFF_RUNBOOK_URL=/Users/apple/Documents/Project/Backend/aurAlpha/RUNBOOK.md \
BROKER_ASSETS_SIGNOFF_RELEASE_NOTE_URL=/Users/apple/Documents/Project/Backend/aurAlpha/BROKER_ASSETS_PHASE9.md \
npm run proof:broker-assets-live
```

That run writes:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-release-gate.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-signoff.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-live-proof.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-deployment-evidence.json`

## 3) Phase 9 Outcome
`broker_assets` now has a real bounded deployment-proof chain instead of the
Phase 8 acknowledgement posture:

1. live broker-assets health is measured first
2. bounded thresholds are explicitly configured
3. workflow and dashboard evidence are captured into local evidence artifacts
4. release gate passes with live checks enabled
5. signoff passes with deployment evidence required
6. the final proof and deployment-evidence artifacts are written successfully

The key resulting artifacts are:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-workflow-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-dashboard-evidence.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-live-proof.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/broker-assets-deployment-evidence.json`

## 4) Carry-Forward For Phase 10
- rerun `npm run capture:broker-assets-evidence` and
  `npm run proof:broker-assets-live` in the target deployment environment
- replace localhost-backed evidence captures with target-environment workflow and
  dashboard evidence where available
- decide whether the deferred `ExchangeAsset*` compatibility rename is still a
  worthwhile no-behavior cleanup

## 5) Verification
Phase 9 completion used:

- `npm run test:broker-assets-phase9`
- `npm run test:broker-assets`
- `npm run capture:broker-assets-evidence`
- `npm run proof:broker-assets-live`

The final successful proof run recorded:

- `gateDecision = ready`
- `signoffDecision = ready`
- `liveChecksEnabled = true`
- `readiness.deploymentEvidenceReady = true`
- `readiness.thresholdProfileMode = bounded`
- `gateTotals.passed = 7`
- `gateTotals.failed = 0`
