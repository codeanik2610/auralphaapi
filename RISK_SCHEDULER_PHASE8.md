# Risk Scheduler Phase 8

Date: 2026-04-10

## 1) Goal
Phase 8 closes the rollout and final signoff gap for the user-scoped `risk-recompute-sync` scheduler.

By the end of this phase:

- the admin diagnostics surface at `/scheduler/risk/*` has explicit admin-only coverage
- the scheduler has a dedicated live health probe covering both admin diagnostics and Risk Center truth
- a dedicated release gate bundles the focused backend, frontend, and optional live checks
- a final signoff artifact can be generated with explicit evidence for diagnostics, product trust, recompute writes, and access review

## 2) What Changed
### Dedicated risk scheduler live health probe
The backend now includes:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-risk-scheduler-health.ts`

That probe checks:

- admin login plus `/scheduler/risk/config`
- `/scheduler/risk/summary`
- `/scheduler/risk/runs`
- queue and worker health
- Risk Center overview freshness and lineage truth
- optional real `/risk/recompute` execution when `RISK_SCHEDULER_TRIGGER_PRODUCT_RECOMPUTE=true`

### Dedicated release gate and signoff
The backend now includes:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-risk-scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-risk-scheduler.ts`

The release gate bundles:

- the Phase 6 risk scheduler timezone-display suite
- focused risk scheduler backend suites
- the Phase 6 risk-center trust suite
- backend controller and operational-audit coverage
- backend lint for the risk scheduler rollout files
- frontend scheduler UI tests and lint for the risk diagnostics surface
- optional live `check:risk-scheduler-health` and `check:risk-center-health`

The final signoff records:

- diagnostics verification
- product trust alignment verification
- recompute-write verification
- admin access review verification
- optional live health review

Artifacts default to:

- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/risk-scheduler-release-gate.json`
- `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/risk-scheduler-signoff.json`

### Focused Phase 8 governance coverage
Focused coverage now lives in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-scheduler-phase8.ts`

That suite proves:

- every `RiskSchedulerController` action rejects unauthenticated requests
- every `RiskSchedulerController` action rejects non-admin users
- admin users can reach the canonical `/scheduler/risk/*` controller surface
- the final signoff script can produce a ready artifact from a valid gate file

## 3) Commands
Run the focused governance suite:

```bash
npm run test:risk-scheduler-phase8
```

Run the risk scheduler release gate:

```bash
npm run release-gate:risk-scheduler
```

Enable live checks inside the release gate:

```bash
RISK_SCHEDULER_RUN_LIVE_CHECKS=true \
RISK_SCHEDULER_ADMIN_EMAIL=admin@example.com \
RISK_SCHEDULER_ADMIN_PASSWORD=secret \
RISK_SCHEDULER_USER_EMAIL=user@example.com \
RISK_SCHEDULER_USER_PASSWORD=secret \
npm run release-gate:risk-scheduler
```

Generate the final signoff artifact:

```bash
RISK_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED=true \
RISK_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED=true \
RISK_SCHEDULER_SIGNOFF_RECOMPUTE_WRITES_VERIFIED=true \
RISK_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED=true \
npm run signoff:risk-scheduler
```

Require live health review during signoff:

```bash
RISK_SCHEDULER_SIGNOFF_REQUIRE_LIVE_HEALTH=true \
RISK_SCHEDULER_SIGNOFF_DIAGNOSTICS_VERIFIED=true \
RISK_SCHEDULER_SIGNOFF_PRODUCT_TRUST_VERIFIED=true \
RISK_SCHEDULER_SIGNOFF_RECOMPUTE_WRITES_VERIFIED=true \
RISK_SCHEDULER_SIGNOFF_ACCESS_REVIEW_VERIFIED=true \
npm run signoff:risk-scheduler
```

## 4) Phase 8 Outcome
Risk scheduler is now in its final rollout state:

- product users stay in `/risk-center`
- admins keep `/scheduler/risk/*` as the diagnostics and control surface
- the release gate proves backend plus UI readiness
- the signoff artifact records the final promotion evidence

## 5) What Remains
No additional risk scheduler product phases are pending in this rollout track.

The only remaining work is live-environment evidence when you want deployment proof:

- rerun `npm run check:risk-scheduler-health` against a running target API
- rerun `npm run release-gate:risk-scheduler` with live checks enabled
- rerun `npm run signoff:risk-scheduler` with real review evidence attached
