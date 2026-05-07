# First60 Deploy Readiness Runbook

This package prepares the First60 managed template work for production deploy.
It does not enable order management. The only production behavior introduced by
this package is snapshot capture and observe-only diagnostics.

## Included Changes

- Template profile parsing for `tradeManagement.first60`.
- Side-specific First60 decision gate:
  - BUY: `observe_only`
  - SELL: `blocked`, diagnostics still enabled
- Suggested trade snapshot persistence at creation time:
  - `meta.tradeManagementSnapshot.first60`
  - `meta.tradeManagementSnapshot.first60.decisionGate`
- Real-data simulator:
  - `scripts/diagnostics/run-first60-template-simulator.ts`
- Observe-only monitor:
  - `scripts/checks/check-first60-observe-only-monitor.ts`
- Deploy readiness check:
  - `scripts/checks/check-first60-deploy-readiness.ts`

## Local Pre-Deploy Gate

Run these from the backend repo before deploying:

```bash
npm run check:first60-deploy-readiness
npm run test:strategy-template-automation-profile
npm run test:automations
npm run type-check
```

Expected readiness result:

- `status` may be `warn` if live DB checks are skipped.
- There must be no `fail` checks.
- BUY gate must normalize as observe-only.
- SELL gate must normalize as diagnostics-only blocked.

## Deploy

Use the normal platform deploy/update flow. The runtime Docker image compiles
TypeScript scripts into `dist/scripts`, so production commands should use
compiled JavaScript inside the container.

```bash
npm run deploy:platform:update
```

If deploying by SSH on the droplet, run the equivalent update from
`/opt/auralpha/Backend/aurAlpha`.

## Post-Deploy Static/Live Readiness

Run inside a one-off API container after deploy:

```bash
docker compose \
  -f docker-compose.platform.yml \
  -f docker-compose.selfhosted-db.yml \
  run --rm --no-deps \
  -e FIRST60_DEPLOY_READINESS_LIVE=true \
  auralpha-api \
  node dist/scripts/checks/check-first60-deploy-readiness.js
```

For the first deploy, recent snapshot count can still be `0` until new
automation-generated suggested trades arrive. To require at least one recent
snapshot after fresh paper signals exist, add:

```bash
-e FIRST60_DEPLOY_READINESS_REQUIRE_SNAPSHOTS=true
```

## Confirm Snapshot Capture

After new paper suggested trades are generated from the managed template/profile,
check that recent suggestions include both the First60 snapshot and decision gate:

```bash
docker compose \
  -f docker-compose.platform.yml \
  -f docker-compose.selfhosted-db.yml \
  run --rm --no-deps \
  -e FIRST60_DEPLOY_READINESS_LIVE=true \
  -e FIRST60_DEPLOY_READINESS_REQUIRE_SNAPSHOTS=true \
  auralpha-api \
  node dist/scripts/checks/check-first60-deploy-readiness.js
```

## Observe-Only Dry Run

Before enabling persistence, run the monitor in dry-run mode:

```bash
docker compose \
  -f docker-compose.platform.yml \
  -f docker-compose.selfhosted-db.yml \
  run --rm --no-deps \
  -e FIRST60_OBSERVE_WRITE=false \
  -e FIRST60_OBSERVE_LOOKBACK_HOURS=72 \
  auralpha-api \
  node dist/scripts/checks/check-first60-observe-only-monitor.js
```

Expected behavior:

- BUY trades with `observeOnlyEnabled=true` are reported as `observe_only`.
- SELL trades with `status=blocked` are reported as `diagnostics_only`.
- No order, paper order, broker order, or position is changed.
- No `meta_json.first60ObserveOnly` write occurs unless
  `FIRST60_OBSERVE_WRITE=true`.

## Persistence Gate

Only after a successful dry run with eligible BUY observations:

```bash
docker compose \
  -f docker-compose.platform.yml \
  -f docker-compose.selfhosted-db.yml \
  run --rm --no-deps \
  -e FIRST60_OBSERVE_WRITE=true \
  -e FIRST60_OBSERVE_LOOKBACK_HOURS=72 \
  auralpha-api \
  node dist/scripts/checks/check-first60-observe-only-monitor.js
```

This still remains observe-only. It writes only
`meta_json.first60ObserveOnly`; it must not place, modify, close, or cancel any
paper or live order.

## Rollback

If post-deploy checks fail:

- Stop before `FIRST60_OBSERVE_WRITE=true`.
- Revert or redeploy the previous backend image.
- Existing suggested trades without First60 snapshots remain valid.
- Suggested trades with First60 snapshots are safe to leave in place because the
  snapshot is metadata only.
