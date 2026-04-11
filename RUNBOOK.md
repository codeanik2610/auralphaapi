# trading-apis RUNBOOK

## Purpose
Frontend-facing API service for scheduler config/log APIs and queue job enqueue.

## Environment structure

Use environment-specific files:

- `environments/localhost/.env`
- `environments/qa/.env`
- `environments/staging/.env`
- `environments/production/.env`

`quick-start.sh` copies one of these into root `.env` before startup.

Select environment via:

```bash
API_ENVIRONMENT=localhost bash ./quick-start.sh
```

Example required keys:

```env
SCHEDULER_EXECUTION_MODE=queue

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_TLS=false

WORKER_HEARTBEAT_KEY=scheduler:worker:heartbeat

SCHEDULER_WORKER_SCHEMA=http
SCHEDULER_WORKER_HOST=localhost
SCHEDULER_WORKER_PORT=3001
SCHEDULER_WORKER_BASE_URL=http://localhost:3001

OPS_CAPTURE_ACTIVITY_ENABLED=true
OPS_EMIT_FAILURE_ALERTS_ENABLED=true
OPS_FAILURE_ALERT_THROTTLE_MINUTES=15
```

## Install

```bash
npm install
```

## Start API

```bash
API_ENVIRONMENT=localhost bash ./quick-start.sh
```

Production style:

```bash
npm run build
npm run startApi
```

## Health checks

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/health/queue
curl http://localhost:3000/api/v1/health/worker
curl http://localhost:3000/api/v1/health/email-worker
curl http://localhost:3000/api/v1/health/ops
curl -H "x-api-key: <APP_API_KEY>" http://localhost:3000/api/v1/health/backtests
curl -H "x-api-key: <APP_API_KEY>" http://localhost:3000/api/v1/health/automations
```

Expected:
- `/health` => `status: ok`
- `/health/queue` => `status: ok` with `latencyMs` ping timing
- `/health/worker` => `status: ok` when Redis heartbeat and worker HTTP health are both healthy
  includes `heartbeatStatus` and `workerHttpStatus` (`ok`/`down`) for split liveness
  includes timing diagnostics when available: `heartbeatAgeMs`, `lastCommandPollAt`,
  `lastCommandPollDurationMs`, `commandPollLagMs`
  includes concurrency diagnostics when available: `commandConcurrency`, `activeCommandCount`,
  `activeScopeCount`
- `/health/email-worker` => email outbox worker status with queue pressure fields
  includes queue counts: `queuedCount`, `sendingCount`, `failedCount`, `activeCount`
  includes backlog timing: `oldestPendingAt`, `oldestPendingAgeMs`, `lastBatchAgeMs`
  includes heartbeat freshness: `heartbeatAgeMs`, `heartbeatLagMs`,
  `heartbeatStaleThresholdMs`, `isHeartbeatStale`
- `/health/ops` => active observability flags and alert throttle minutes
- `/health/backtests` => admin JWT or valid `x-api-key` required for external monitoring
  includes `staleRunningRuns`, `recoverableRuns`, and `incompleteTradeHistoryRuns`
  use this endpoint for dashboards/paging rather than scraping the UI
- `/health/automations` => admin JWT or valid `x-api-key` required for external monitoring
  includes worker/queue status, failed runs, overlap skips, stale cursors, and open alert breakdowns
  use this endpoint for dashboards/paging rather than scraping the UI

## Foundation freeze gate

Use this when the shared strategy/ops surface area is supposed to be low-touch and you want one
repeatable command before moving focus elsewhere.

Automated gate:

- `npm run release-gate:foundation`
- writes `artifacts/foundation-release-gate.json` by default
- runs backend verification:
  - `npm run test:services`
  - `npm run test:controllers`
  - `npm run test:operational-audit`
  - `npm run type-check`
- runs frontend verification in `/Users/apple/Documents/Project/Frontend/aurAlphaApp`:
  - focused ops-surface lint
  - `src/pages/Alerts/index.test.jsx`
  - `src/pages/Schedulers/index.test.jsx`
  - focused `src/pages/Activity/index.test.jsx` URL/detail gates
  - `tests/e2e/business-flows.spec.js`
  - email-deliveries is covered through that browser flow instead of a standalone Vitest file here,
    because the full file run remains slower/less stable in this environment

Optional live checks:

- set `FOUNDATION_RUN_LIVE_CHECKS=true` to add:
  - `npm run release-gate:discovery`
  - `npm run smoke:scheduler-health`
  - `npm run release-gate:strategy-library`
- set `FOUNDATION_RUN_STRATEGY_LIBRARY_E2E=true` to include:
  - `npm run test:e2e -- tests/e2e/strategy-library.spec.js`

Quick verification:

```bash
npm run release-gate:foundation
FOUNDATION_RUN_LIVE_CHECKS=true \
SMOKE_BASE_URL=http://127.0.0.1:3002/api/v1 \
npm run release-gate:foundation
```

Interpretation:

1. Treat `decision: ready` in the artifact as the automated freeze baseline for the validated
   strategy and operator surfaces.
2. If live checks are skipped, the artifact is still useful for local regression control, but it is
   not a substitute for staging smoke on the target stack.
3. Re-run this gate after any cross-cutting change to settings, alerts, activity, schedulers,
   discovery dependency wiring, strategy-library lineage, or the shared business-flow tests.

## Discovery runbook

Primary UI route:

- `/discovery`

Ownership:

- aurAlpha owns the Discovery workspace, dependency health, summary/feed wrappers, scheduler bridge,
  activity, alerts, and release gates
- discovery-engine owns bots, runs, strategies, template suggestions, preferences, websocket
  streaming, and discovery Postgres backup/restore
- the seam contract is documented in `DISCOVERY_DEPENDENCY_CONTRACT.md`

Release checklist:

1. Confirm both services are reachable on the target stack.
   - aurAlpha: `curl http://localhost:3000/api/v1/health`
   - discovery-engine: `curl http://localhost:8000/health`
2. Run the authenticated dependency and contract smokes.
   - `npm run smoke:discovery-dependency`
   - `npm run smoke:discovery-contract`
3. Run the browser journey in `/Users/apple/Documents/Project/Frontend/aurAlphaApp`.
   - `npm run test:e2e -- tests/e2e/discovery.spec.js`
4. Run the final live gate.
   - `npm run release-gate:discovery`
5. If you want the shared freeze artifact to include Discovery too, run:
   - `FOUNDATION_RUN_LIVE_CHECKS=true npm run release-gate:foundation`

Triage guide:

1. Open `/discovery` and read the `Discovery Dependency Health` section first.
2. If `service` or `auth` is down, treat the page as dependency-blocked rather than debugging the
   UI first.
3. If list/detail sections are stale but not down, use the section refresh actions before retrying
   mutations.
4. If the workspace is healthy but imports/backtests fail, inspect:
   - `/activity`
   - `/alerts`
   - linked scheduler updates when present
5. If the release gate fails only in the contract smoke, compare the failing endpoint against the
   owner model in `DISCOVERY_DEPENDENCY_CONTRACT.md` before deciding whether the fix belongs in
   aurAlpha or discovery-engine.

Quick verification:

```bash
npm run release-gate:discovery

FOUNDATION_RUN_LIVE_CHECKS=true \
npm run release-gate:foundation
```

## Email delivery monitor

Primary UI route:

- `/email-deliveries`

Operator actions:

- `Retry failed` re-queues the same failed record, resets attempts, and clears the previous failure detail
- `Resend copy` creates a new queued delivery record and leaves the original record untouched for history
- filtered cleanup only removes `Sent` and `Failed` rows that match the active filters
- retention cleanup only removes `Sent` and `Failed` rows older than the configured retention window

Delivery policy:

- default retention window: `30` days unless overridden in the API response contract
- CSV exports are capped at `5000` rows per export
- full email bodies stay out of CSV exports
- UI detail view shows only a short redacted body preview

Quick verification:

```bash
npm run test:services
npm run test:controllers
cd /Users/apple/Documents/Project/Frontend/aurAlphaApp
npm run test:ui -- src/pages/EmailDeliveries/index.test.jsx
npm run test:e2e:list
```

Triage guide:

1. Open `/health/email-worker` first.
2. If `activeCount > 0` and `heartbeatLagMs` keeps growing, treat it as a worker backlog.
3. If `smtpConfigured=false`, fix SMTP config before retrying queue items.
4. If the worker is healthy but failures continue, inspect the detail drawer preview and `lastError` from the monitor before choosing `Retry failed` or `Resend copy`.

## Backtest monitor

Primary UI route:

- `/backtests`

Operator actions:

- `Resume from checkpoint` re-queues the same run from its saved checkpoint; use `Run strategy` when you want a fresh run with current inputs instead
- `Download input snapshot` exports the immutable captured inputs for the selected run
- `Promote to Automation` creates a reusable automation only from a finished run after lineage and integrity checks

Health and trust signals:

- `/health/backtests` reports `staleRunningRuns`, `recoverableRuns`, and `incompleteTradeHistoryRuns`
- `/health/backtests` also reports `openAlerts`, `openRuntimeAlerts`, `openRecoveryAlerts`, and `openPromotionAlerts`
- external dashboards may poll `/health/backtests` with `x-api-key: <APP_API_KEY>`
- backtest operator failures open alerts in the alerts inbox under channel `Backtests`
  with sources `backtests`, `backtests:recovery`, and `backtests:promotion`
- `Data integrity` on the page explains whether persisted trade history is complete enough to trust chart-level evidence
- `Open health JSON` is the quickest path to raw monitor details when cards look degraded

Release checklist:

1. Apply DB migrations before rollout so the backtests operational, search, and summary indexes are active.
   Current hardening migrations:
   - `1767300000000-AddBacktestOperationalIndexesPg.ts`
   - `1767300002000-AddBacktestSearchIndexPg.ts`
   - `1767300003000-AddBacktestOperationalStateColumnsPg.ts`
   - `1767300004000-AddBacktestSummaryIndexesPg.ts`
2. Confirm `/health/backtests` is stable enough for sign-off.
   Investigate any `staleRunningRuns > 0` or `incompleteTradeHistoryRuns > 0` before trusting chart evidence or promotion readiness.
3. Run a staging smoke that covers the four operator-critical paths:
   - `Run strategy`
   - `Resume from checkpoint`
   - `Download input snapshot`
   - `Promote to Automation`
   - require the chart check too; the smoke should fail if Postgres candles are unavailable or empty
   - the repo now includes `npm run proof:backtests-live` to run the lifecycle smoke and `/health/backtests` threshold check together
4. Promotion is repeat-safe.
   Re-submitting the same finished setup should reuse the existing automation rather than creating duplicates.
5. Confirm backtest incident alerting is visible in the alerts inbox.
   Search `backtests` in `/alerts` after a forced create/recovery/promotion failure and verify only one open incident is emitted inside the throttle window.
6. Run the release gate in staging before broad rollout.
   `npm run release-gate:backtests` runs the authenticated lifecycle smoke, checks `/health/backtests`, verifies open `Backtests` alerts stay within threshold, and can hold a soak window with:
   - `BACKTESTS_SOAK_DURATION_MINUTES`
   - `BACKTESTS_SOAK_POLL_SECONDS`
   - `BACKTESTS_MAX_STALE_RUNNING_RUNS`
   - `BACKTESTS_MAX_INCOMPLETE_TRADE_HISTORY_RUNS`
   - `BACKTESTS_MAX_OPEN_ALERTS`
   - optional `BACKTESTS_MAX_RECOVERABLE_RUNS`
   - GitHub Actions now includes `.github/workflows/backtests-staging-gate.yml` for a manual staging run with artifact upload
   - required staging secrets:
     - `STAGING_API_BASE_URL`
     - `STAGING_APP_API_KEY`
     - `STAGING_BACKTESTS_LOGIN_EMAIL`
     - `STAGING_BACKTESTS_LOGIN_PASSWORD`
7. Run the final sign-off bundle only after the staging gate artifact exists.
   `npm run signoff:backtests` consumes the release-gate JSON artifact and requires explicit confirmation that:
   - external dashboards/paging are live
   - frontend composure is acceptable for rollout
   - large-results hardening has been verified for the expected dataset size

Triage guide:

1. Open `/health/backtests` first.
2. If `staleRunningRuns > 0`, inspect the selected run progress and checkpoint status before deciding whether to resume.
3. If `incompleteTradeHistoryRuns > 0`, treat chart-level trade evidence as partial until stored trade coverage is restored.
4. Search `backtests` in `/alerts` to see whether create, recovery, or promotion failures are already open and throttled.
5. Use `Download input snapshot` before promotion when you need an immutable audit trail for what was actually run.

Quick verification:

```bash
npm run check:backtests-health
npm run db:migrate
npm run db:seed:backtests-chart-smoke
npm run test:services
npm run type-check
SMOKE_REQUIRE_BACKTEST_CHART=true npm run smoke:backtests-lifecycle
APP_API_KEY=<APP_API_KEY> SMOKE_REQUIRE_BACKTEST_CHART=true npm run proof:backtests-live
BACKTESTS_SOAK_DURATION_MINUTES=30 npm run release-gate:backtests
BACKTESTS_SIGNOFF_GATE_FILE=artifacts/backtests-release-gate.json \
BACKTESTS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED=true \
BACKTESTS_SIGNOFF_UI_COMPOSURE_VERIFIED=true \
BACKTESTS_SIGNOFF_RESULTS_SCALING_VERIFIED=true \
npm run signoff:backtests
cd /Users/apple/Documents/Project/Frontend/aurAlphaApp
npm run test:ui -- src/pages/Backtests/index.test.jsx
npm run test:e2e -- tests/e2e/backtests.spec.js
```

Staging workflow:

- Open `Backtests Staging Gate` in GitHub Actions.
- Leave thresholds at `0` unless there is an approved temporary exception.
- Download the `backtests-staging-gate` artifact after the run and attach it to the release note if rollout is approved.
- Run `npm run signoff:backtests` against that artifact before moving `/backtests` from `Partial` to `Done`.

External monitor command:

```bash
APP_API_KEY=<APP_API_KEY> \
BACKTESTS_MAX_STALE_RUNNING_RUNS=0 \
BACKTESTS_MAX_INCOMPLETE_TRADE_HISTORY_RUNS=0 \
BACKTESTS_MAX_OPEN_ALERTS=0 \
BACKTESTS_MAX_OPEN_RUNTIME_ALERTS=0 \
BACKTESTS_MAX_OPEN_RECOVERY_ALERTS=0 \
BACKTESTS_MAX_OPEN_PROMOTION_ALERTS=0 \
npm run check:backtests-health
```

## Automation monitor

Primary UI route:

- `/automations`

Operator actions:

- `Pause`, `Resume`, and `Run now` now have repeat-safe backend behavior; repeated clicks should return stable operator messages instead of duplicating state changes
- `Reconcile state` is the guarded repair path for stale runs and child-backtest sync issues
- schedule edits now persist canonical timezone-aware payloads; verify the preview before resuming a paused automation

Health and trust signals:

- `/health/automations` reports `workerStatus`, `queueStatus`, `failedRuns24h`, `overlapSkips24h`, and `staleCursorCount`
- `/health/automations` also reports `openAlerts`, `openControlAlerts`, `openRecoveryAlerts`, and `openExecutionAlerts`
- external dashboards may poll `/health/automations` with `x-api-key: <APP_API_KEY>`
- automation operator failures open alerts in the alerts inbox under channel `Automation`
  with sources `automations`, `automations:recovery`, and `automation-execution`

Release checklist:

1. Apply DB migrations before rollout so the automation search/scope hardening columns are active.
   Current hardening migration:
   - `1767300005000-AddAutomationSearchAndScopeColumns.ts`
2. Confirm `/health/automations` is stable enough for sign-off.
   Investigate any non-`ok` `workerStatus` or `queueStatus`, and review any `failedRuns24h`, `overlapSkips24h`, or `staleCursorCount` above the agreed threshold.
3. Run a staging smoke that covers the operator-critical paths:
   - create automation
   - pause
   - resume
   - run now
   - child backtest sync back into automation run history
   - the repo now includes `npm run proof:automations-live` to run the lifecycle smoke and `/health/automations` threshold check together
4. Confirm automation incident alerting is visible in the alerts inbox.
   Search `automation` in `/alerts` after a forced control/recovery/execution failure and verify only one open incident is emitted inside the throttle window.
5. Run the release gate in staging before broad rollout.
   `npm run release-gate:automations` runs the authenticated lifecycle smoke, checks `/health/automations`, verifies open `Automation` alerts stay within threshold, and can hold a soak window with:
   - `AUTOMATIONS_SOAK_DURATION_MINUTES`
   - `AUTOMATIONS_SOAK_POLL_SECONDS`
   - `AUTOMATIONS_MAX_FAILED_RUNS_24H`
   - `AUTOMATIONS_MAX_OVERLAP_SKIPS_24H`
   - `AUTOMATIONS_MAX_STALE_CURSORS`
   - `AUTOMATIONS_MAX_OPEN_ALERTS`
   - GitHub Actions now includes `.github/workflows/automations-staging-gate.yml` for a manual staging run with artifact upload
   - required staging secrets:
     - `STAGING_API_BASE_URL`
     - `STAGING_APP_API_KEY`
     - `STAGING_AUTOMATIONS_LOGIN_EMAIL`
     - `STAGING_AUTOMATIONS_LOGIN_PASSWORD`
6. Run the final sign-off bundle only after the staging gate artifact exists.
   `npm run signoff:automations` consumes the release-gate JSON artifact and requires explicit confirmation that:
   - external dashboards/paging are live
   - operator recovery controls are acceptable for rollout
   - schedule/timezone audit has been verified on the target environment

Triage guide:

1. Open `/health/automations` first.
2. If `workerStatus != ok` or `queueStatus != ok`, treat it as a platform incident before changing individual automations.
3. If `failedRuns24h > 0`, inspect run history and alerts before choosing `Run now` or `Reconcile state`.
4. If `staleCursorCount > 0`, assume trade-suggestion automations may be evaluating stale data until worker health is restored.
5. Search `automation` in `/alerts` to see whether control, recovery, or execution failures are already open and throttled.

Quick verification:

```bash
npm run test:services
npm run test:controllers
npm run smoke:automations-lifecycle
APP_API_KEY=<APP_API_KEY> npm run check:automations-health
APP_API_KEY=<APP_API_KEY> \
AUTOMATIONS_MAX_FAILED_RUNS_24H=0 \
AUTOMATIONS_MAX_OVERLAP_SKIPS_24H=0 \
AUTOMATIONS_MAX_STALE_CURSORS=0 \
AUTOMATIONS_MAX_OPEN_ALERTS=0 \
npm run proof:automations-live
AUTOMATIONS_SOAK_DURATION_MINUTES=30 npm run release-gate:automations
AUTOMATIONS_SIGNOFF_GATE_FILE=artifacts/automations-release-gate.json \
AUTOMATIONS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED=true \
AUTOMATIONS_SIGNOFF_OPERATOR_RECOVERY_VERIFIED=true \
AUTOMATIONS_SIGNOFF_SCHEDULE_AUDIT_VERIFIED=true \
npm run signoff:automations
cd /Users/apple/Documents/Project/Frontend/aurAlphaApp
npm run test:ui -- src/pages/Automations/index.test.jsx
```

Staging workflow:

- Open `Automations Staging Gate` in GitHub Actions.
- Leave thresholds at `0` unless there is an approved temporary exception.
- Download the `automations-staging-gate` artifact after the run and attach it to the release note if rollout is approved.
- Run `npm run signoff:automations` against that artifact before moving `/automations` from `Partial` to `Done`.

External monitor command:

```bash
APP_API_KEY=<APP_API_KEY> \
AUTOMATIONS_MAX_FAILED_RUNS_24H=0 \
AUTOMATIONS_MAX_OVERLAP_SKIPS_24H=0 \
AUTOMATIONS_MAX_STALE_CURSORS=0 \
AUTOMATIONS_MAX_OPEN_ALERTS=0 \
AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS=0 \
AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS=0 \
AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS=0 \
npm run check:automations-health
```

## Scheduler run-now behavior

`POST /api/v1/scheduler/exchange-assets/run`:
- only enqueues queue jobs
- returns `queued=true` with `jobId`
- returns `503` if queue/worker health is down
- duplicate protection is actor-scoped: same scheduler + same authenticated user is deduped
- different users can queue/run the same scheduler concurrently when worker concurrency allows

`GET /api/v1/scheduler/<type>/runs/:runId/progress`:
- returns latest run progress snapshot for that run id
- response includes `run.progress` (`total`, `processed`, `percent`, optional ETA/current item)
- returns `run: null` when run id is not found under the selected scheduler type

`GET /api/v1/scheduler/positions/sync-state` and `GET /api/v1/scheduler/orders/sync-state`:
- returns per-account monitor sync coverage for connected/idle broker accounts
- response includes `checkpointAt`, `pendingRecords`, `failedRecords`, `resolvedRecords`,
  `nextRetryAt`, `lastPendingUpdateAt`
- supports optional filters: `accountId`, `userId`, `brokerKey`
- supports pagination: `limit`, `offset`
- safely returns base account rows even if pending/checkpoint tables are not created yet

`GET /api/v1/scheduler/positions/sync-state/summary` and `GET /api/v1/scheduler/orders/sync-state/summary`:
- returns compact monitor health totals for cards/ops dashboards
- fields include:
  - account coverage: `totalAccounts`, `accountsWithCheckpoint`, `accountsWithoutCheckpoint`
  - pending/failure pressure: `accountsWithPending`, `accountsWithFailed`, `pendingRecords`, `failedRecords`
  - retry pressure: `accountsWithRetryScheduled`, `nextRetryAt`
  - freshness: `oldestCheckpointAt`, `oldestCheckpointAgeHours`, `latestCheckpointAt`, `latestPendingUpdateAt`

Snapshot read cutover flags:
- `SYNC_READ_POSITIONS_FROM_SNAPSHOT=true|false`
- `SYNC_READ_ORDERS_FROM_SNAPSHOT=true|false`
- when enabled, facade reads come from scheduler snapshot tables instead of live broker pulls

## Failure alert throttle

Failure alerts are throttled to prevent repeated incident spam during retries or burst failures.

- Env key: `OPS_FAILURE_ALERT_THROTTLE_MINUTES`
- Default local value: `15`
- Scope: per `user_id + channel + source`
- Behavior:
  - if an open alert for the same scope exists in the throttle window, no new alert is created
  - outside the window, a new alert can be opened
  - exact-message dedupe still applies for open alerts

Tuning guidance:

- `5-10` minutes for high-frequency failures where fast operator signal is enough
- `15-30` minutes for noisy integrations
- `0` disables time-window throttle (not recommended in production)

Quick verification:

1. Trigger the same failing scheduler operation multiple times within the window.
2. Confirm activity logs keep recording failures.
3. Confirm alerts show at most one new open incident for the scoped source in that window.

## Deployment note for user-scoped scheduler locks

- Apply DB migrations before restarting worker:

```bash
npm run db:migrate
```

- This creates `scheduler_run_locks`, required for cross-worker dedupe of the same scheduler/user scope.
