# Trading APIs

Mudrex futures proxy service structured after `fxupdates-backend`.

## Endpoints

- `GET /api/v1/health`
- `GET /api/v1/assets/futures`
- `GET /api/v1/wallet/funds`
- `GET /api/v1/wallet/futures/funds`

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy the localhost env and fill in real app/runtime secrets:

```bash
cp environments/localhost/.env.example environments/localhost/.env.local
cp environments/localhost/.env.example .env
```

Or keep using the existing `environments/localhost/.env` flow if that is already part of your local setup.

3. Make sure MySQL is running and the configured database exists.

4. If the local DB already contains these tables from earlier `synchronize` runs, baseline the migration history:

```bash
npm run db:baseline
```

5. Run the DB baseline and migrations:

```bash
npm run db:bootstrap
```

6. Start the local API:

```bash
npm run serveLocal
```

## Authentication

The API now supports user login with JWT access tokens and DB-backed refresh tokens.

Phase 0 baseline for login/session work:

- [`LOGIN_PHASE0.md`](/Users/apple/Documents/Project/Backend/aurAlpha/LOGIN_PHASE0.md)

Current frontend `/login` owner:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Login/index.jsx`

Public auth endpoints:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`

Protected auth endpoints:

- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/sessions`
- `POST /api/v1/auth/logout-all`

Default localhost seed user after `npm run db:bootstrap`:

- `admin@auralpha.com`
- `Admin@123`

Auth security baseline:

- Login throttling is enabled by default: `5` attempts per `IP + email` window, `20` per IP, `15` minute window/lockout.
- `AUTH_SEED_ENABLED` defaults to `true` on localhost and `false` outside localhost.
- Outside localhost, the app now requires explicit non-default values for `AUTH_ACCESS_TOKEN_SECRET`, `DISCOVERY_SCHEDULER_SECRET`, `BROKER_ACCOUNT_SECRETS_KEY`, and `APP_API_KEY` when API-key auth is required.
- Phase 3 handoff: [LOGIN_PHASE3.md](/Users/apple/Documents/Project/Backend/aurAlpha/LOGIN_PHASE3.md)
- Phase 5 verification and release-safety baseline: [LOGIN_PHASE5.md](/Users/apple/Documents/Project/Backend/aurAlpha/LOGIN_PHASE5.md)

Protected auth health endpoint:

- `GET /api/v1/health/auth`

Phase 5 auth verification commands:

- `npm run test:auth-contract`
- `npm run test:auth-security`
- `npm run check:auth-health`
- `npm run release-gate:auth`
- `npm run signoff:auth`

Optional auth env vars:

- `AUTH_ACCESS_TOKEN_SECRET`
- `AUTH_ACCESS_TOKEN_TTL`
- `AUTH_REFRESH_TOKEN_DAYS`
- `AUTH_LOGIN_PROTECTION_ENABLED`
- `AUTH_LOGIN_MAX_ATTEMPTS`
- `AUTH_LOGIN_IP_MAX_ATTEMPTS`
- `AUTH_LOGIN_WINDOW_MINUTES`
- `AUTH_LOGIN_LOCKOUT_MINUTES`
- `AUTH_SEED_ENABLED`
- `AUTH_SEED_EMAIL`
- `AUTH_SEED_PASSWORD`
- `AUTH_SEED_FULL_NAME`
- `DISCOVERY_SCHEDULER_SECRET`

## Overview

Phase baselines for `/overview`:

- [OVERVIEW_PHASE0.md](/Users/apple/Documents/Project/Backend/aurAlpha/OVERVIEW_PHASE0.md)
- [OVERVIEW_PHASE1.md](/Users/apple/Documents/Project/Backend/aurAlpha/OVERVIEW_PHASE1.md)
- [OVERVIEW_PHASE2.md](/Users/apple/Documents/Project/Backend/aurAlpha/OVERVIEW_PHASE2.md)
- [OVERVIEW_PHASE3.md](/Users/apple/Documents/Project/Backend/aurAlpha/OVERVIEW_PHASE3.md)
- [OVERVIEW_PHASE4.md](/Users/apple/Documents/Project/Backend/aurAlpha/OVERVIEW_PHASE4.md)
- [OVERVIEW_PHASE5.md](/Users/apple/Documents/Project/Backend/aurAlpha/OVERVIEW_PHASE5.md)
- [OVERVIEW_PHASE6.md](/Users/apple/Documents/Project/Backend/aurAlpha/OVERVIEW_PHASE6.md)

Current frontend `/overview` owner:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/dashboard/OverviewHero.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/overviewSlice.js`

Protected overview endpoint:

- `GET /api/v1/overview`

Phase 0 supported query params:

- `selectedSymbol`
- `sort`
- `order`

Current overview verification commands:

- `npm run test:overview-contract`
- `npm run test:overview-resilience`
- `npm run test:overview-phase4`
- `npm run test:ui -- src/pages/Dashboard/index.test.jsx src/store/slices/overviewSlice.test.js`
- `npm run test:e2e -- tests/e2e/overview.spec.js`
- `npx eslint src/pages/Dashboard/index.jsx src/pages/Dashboard/index.test.jsx src/store/slices/overviewSlice.js src/store/slices/overviewSlice.test.js`
- `npx eslint tests/e2e/overview.spec.js`
- `npm run release-gate:overview`
- `npx eslint src/api/contracts/Overview.ts src/api/services/OverviewService.ts scripts/test-overview-contract.ts scripts/test-overview-resilience.ts scripts/test-overview-phase4.ts`

## Risk Center

Phase baselines for `/risk-center`:

- [RISK_CENTER_PHASE0.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE0.md)
- [RISK_CENTER_PHASE1.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE1.md)
- [RISK_CENTER_PHASE2.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE2.md)
- [RISK_CENTER_PHASE3.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE3.md)
- [RISK_CENTER_PHASE4.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE4.md)
- [RISK_CENTER_PHASE5.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE5.md)
- [RISK_CENTER_PHASE6.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE6.md)
- [RISK_CENTER_PHASE7.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE7.md)
- [RISK_CENTER_PHASE8.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_CENTER_PHASE8.md)

Current frontend `/risk-center` owner:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/trust.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterOverviewWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterOperationsWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskCenterActivityTrail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/RiskPolicyDrawer.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/riskCenterSlice.js`

Protected risk-center endpoints:

- `GET /api/v1/risk/overview`
- `GET /api/v1/risk/alerts/overview`
- `GET /api/v1/risk/policies`
- `GET /api/v1/risk/policies/:policyId/versions`
- `POST /api/v1/risk/policies`
- `POST /api/v1/risk/policies/:policyId/versions/:versionId/approve`
- `POST /api/v1/risk/policies/:policyId/versions/:versionId/reject`
- `POST /api/v1/risk/policies/:policyId/rollback`
- `PUT /api/v1/risk/policies/:policyId`

Phase 0 semantic baseline:

- broker-specific enabled policy wins over enabled user-default policy
- `monitor only` never blocks
- `warn` allows execution but should surface warnings
- `hard block` should reject on implemented breach
- policy history and rollback are now part of the supported operator lifecycle
- live broker wallet/open-position KPIs are not part of the current backend overview contract
- weekly/monthly loss-window usage is explicitly unavailable until persisted server-side
- broker coverage in `/risk-center` is snapshot-backed from persisted broker data, not live telemetry
- risk-center UX now differentiates first load from refresh and keeps critical failure states visible
- sensitive policy updates and rollbacks now move through `manual_review` and `pending_review` before becoming effective
- release hardening now regression-locks policy save/rollback UI flows, policy-linked order audit trails, and risk-center migration assumptions
- Phase 6 now adds health, release-gate, and signoff automation for `/risk-center`
- browser-level operator coverage now validates policy save, rollback, activity handoff, and alert handoff flows
- Phase 7 now splits `/risk-center` into focused overview, policy, operations, activity, and drawer modules
- selected-rule workflow now surfaces recent risk activity in-page before handing off to `/activity`
- `/risk/overview` Phase 7 metadata now advertises workspace focus, activity-trail, and module-structure truth
- Phase 8 now adds approve/reject governance controls to the selected-rule history workflow
- `/risk/overview` Phase 8 metadata now advertises pending-review policy governance truth
- Phase 9 now adds in-page risk activity stream/status/read-state filters plus export and retention cues
- `/risk/overview` Phase 9 metadata now advertises operational activity-trail controls and recent export truth

Current risk-center verification commands:

- `npm run test:risk-center-contract`
- `npm run test:risk-center-phase1`
- `npm run test:risk-center-phase2`
- `npm run test:risk-center-phase4`
- `npm run test:risk-center-phase5`
- `npm run test:risk-center-phase8`
- `npm run test:risk-center-phase9`
- `npm run test:controllers`
- `npx eslint src/api/contracts/Risk.ts src/api/contracts/RiskOverview.ts src/api/contracts/RiskAlertsOverview.ts src/api/controllers/RiskController.ts src/api/services/RiskService.ts src/api/services/RiskOverviewService.ts src/api/services/RiskAlertsOverviewService.ts src/api/services/BrokerOrdersFacadeService.ts src/api/validators/risk.validator.ts src/database/repositories/RiskPolicyRepository.ts scripts/test-controllers.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase2.ts scripts/test-risk-center-phase4.ts`
- `npx eslint src/api/contracts/Risk.ts src/api/contracts/RiskOverview.ts src/api/controllers/RiskController.ts src/api/services/RiskService.ts src/api/services/RiskOverviewService.ts src/api/validators/risk.validator.ts src/database/repositories/RiskPolicyRepository.ts scripts/test-risk-center-phase8.ts scripts/test-controllers.ts`
- `npx eslint src/api/contracts/RiskOverview.ts src/api/services/RiskOverviewService.ts src/api/services/BrokerPositionsFacadeService.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase2.ts scripts/test-risk-center-phase9.ts scripts/release-gate-risk-center.ts`
- `npx eslint src/api/validators/risk.validator.ts src/database/repositories/RiskPolicyRepository.ts src/database/entities/RiskPolicy.ts src/api/services/RiskService.ts src/database/migrations/1770600000000-HardenRiskPolicyTargetIntegrity.ts scripts/test-risk-center-phase1.ts`
- `npx eslint src/api/contracts/RiskOverview.ts src/api/services/RiskOverviewService.ts src/api/services/RiskAlertsOverviewService.ts src/database/repositories/PositionSnapshotRepository.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase2.ts`
- `npx eslint src/api/services/BrokerOrdersFacadeService.ts src/database/migrations/1763800000000-RemoveRiskCenterTables.ts src/database/migrations/1763800001000-RestoreRiskCenterTables.ts src/database/migrations/1770600000000-HardenRiskPolicyTargetIntegrity.ts scripts/test-risk-center-phase5.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/RiskCenter/index.jsx src/pages/RiskCenter/index.test.jsx src/store/slices/riskCenterSlice.js src/services/tradingApi.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/riskCenterSlice.js src/services/tradingApi.js src/pages/RiskCenter/index.jsx src/pages/RiskCenter/trust.js src/pages/RiskCenter/RiskPolicyDrawer.jsx src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx src/pages/RiskCenter/index.test.jsx tests/e2e/risk-center.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/riskCenterSlice.js src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx src/pages/RiskCenter/RiskCenterActivityTrail.jsx src/pages/RiskCenter/trust.js src/pages/RiskCenter/index.test.jsx tests/e2e/risk-center.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint tests/e2e/risk-center.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/risk-center.spec.js`
- `npm run check:risk-center-health`
- `npm run release-gate:risk-center`
- `npm run signoff:risk-center`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/RiskCenter/index.jsx src/pages/RiskCenter/index.test.jsx src/pages/RiskCenter/trust.js src/pages/RiskCenter/RiskCenterActivityTrail.jsx src/pages/RiskCenter/RiskCenterOverviewWorkspace.jsx src/pages/RiskCenter/RiskCenterPoliciesWorkspace.jsx src/pages/RiskCenter/RiskCenterOperationsWorkspace.jsx src/pages/RiskCenter/RiskPolicyDrawer.jsx tests/e2e/risk-center.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/RiskCenter/index.jsx src/pages/RiskCenter/index.test.jsx src/components/common/DataTable.jsx src/components/common/DataTable.test.jsx src/components/common/StatusBanner.jsx src/components/common/StatusBanner.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx src/components/common/DataTable.test.jsx src/components/common/StatusBanner.test.jsx`

## Schedulers

Phase baselines for `/schedulers`:

- [ASSET_PRICE_SYNC_PHASE1.md](/Users/apple/Documents/Project/Backend/aurAlpha/ASSET_PRICE_SYNC_PHASE1.md)
- [ASSET_PRICE_SYNC_PHASE2.md](/Users/apple/Documents/Project/Backend/aurAlpha/ASSET_PRICE_SYNC_PHASE2.md)
- [ASSET_PRICE_SYNC_PHASE3.md](/Users/apple/Documents/Project/Backend/aurAlpha/ASSET_PRICE_SYNC_PHASE3.md)
- [ASSET_PRICE_SYNC_PHASE4.md](/Users/apple/Documents/Project/Backend/aurAlpha/ASSET_PRICE_SYNC_PHASE4.md)
- [ASSET_PRICE_SYNC_PHASE5.md](/Users/apple/Documents/Project/Backend/aurAlpha/ASSET_PRICE_SYNC_PHASE5.md)
- [ASSET_PRICE_SYNC_PHASE6.md](/Users/apple/Documents/Project/Backend/aurAlpha/ASSET_PRICE_SYNC_PHASE6.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE1.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE1.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE2.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE2.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE3.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE3.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE4.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE4.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE5.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE5.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE6.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE6.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md)
- [GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md](/Users/apple/Documents/Project/Backend/aurAlpha/GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md)
- [RISK_SCHEDULER_PHASE1.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_SCHEDULER_PHASE1.md)
- [RISK_SCHEDULER_PHASE2.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_SCHEDULER_PHASE2.md)
- [RISK_SCHEDULER_PHASE3.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_SCHEDULER_PHASE3.md)
- [RISK_SCHEDULER_PHASE4.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_SCHEDULER_PHASE4.md)
- [RISK_SCHEDULER_PHASE5.md](/Users/apple/Documents/Project/Backend/aurAlpha/RISK_SCHEDULER_PHASE5.md)
- [SCHEDULERS_PHASE1.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE1.md)
- [SCHEDULERS_PHASE2.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE2.md)
- [SCHEDULERS_PHASE3.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE3.md)
- [SCHEDULERS_PHASE4.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE4.md)
- [SCHEDULERS_PHASE5.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE5.md)
- [SCHEDULERS_PHASE6.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE6.md)
- [SCHEDULERS_PHASE7.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE7.md)

Global system scheduler Phase 7 freezes frontend/operator consumption for the
shared `/schedulers` surface on top of the Phase 6 worker/runtime contract.
Global system scheduler Phase 8 now adds shared health, release-gate, signoff,
and live-proof workflow coverage across `broker-assets-sync`,
`exchange-assets-sync`, `binance-candles-3m-1m-sync`, and `system-health-sync`.
Global system scheduler Phase 9 now adds concrete workflow/dashboard evidence
capture plus promotion-ready proof posture for the same four-scheduler
subsystem.
- [SCHEDULERS_PHASE8.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE8.md)
- [SCHEDULERS_PHASE9.md](/Users/apple/Documents/Project/Backend/aurAlpha/SCHEDULERS_PHASE9.md)

Current semantic baseline:

- `broker-assets-sync`, `exchange-assets-sync`, `binance-candles-3m-1m-sync`, and
  `system-health-sync` now share a frozen backend Phase 1 contract: global/system ownership,
  UTC storage, and explicit time-contract metadata for later audit and localization phases
- those same four global system schedulers now also share an explicit initiator/audit contract,
  so manual admins, cron/system initiators, and system-only execution context are represented
  consistently in run logs, update logs, and overview responses
- those four schedulers now also return localized display timestamps with stable raw UTC ISO
  companions across overview, run history, run updates, config summaries, and targeted sync-state
  responses
- those four schedulers now also share scheduler-scoped purge and retention truth, so update-log
  preview and deletion are no longer table-wide or hardcoded to zero
- those four schedulers now also expose explicit recent-run and ops snapshots in scheduler overview,
  so active-status, latest outcome, counters, and queue truth no longer have to be reconstructed
  from sparse overview rows plus separate fallback queries
- those four schedulers now also have worker-backed audit and runtime truth, so queued commands,
  worker-written run logs, update logs, and activity trails all preserve system scope without
  losing the real manual initiator for global runs
- those four schedulers now also have one shared live health, release gate, signoff, and proof
  workflow, so backend, worker, frontend, and live subsystem evidence can be promoted together
- those four schedulers now also support concrete workflow/dashboard evidence capture, and the
  shared signoff can now distinguish between placeholder review posture and deployment-evidence-ready
  promotion posture
- the orders scheduler tab now surfaces checkpoint coverage, retry backlog, and next-retry truth
- `/schedulers` now links raw orders sync-state JSON and sync-summary JSON from the selected orders tab
- orders sync truth now refreshes on selection, post-run completion, and scheduler polling
- orders run updates/export now verify `runId` ownership against `orders-sync`
- orders scheduler config writes now reject asset/discovery-only fields and normalize fixed `["orders"]` sources
- orders sync-state diagnostics now expose explicit `ownerUserId` semantics while still tolerating the legacy `userId` alias
- orders purge preview and purge results now include scheduler-scoped update log counts so cleanup
  outcomes match the operator-facing UI
- orders scheduler config now exposes saved replay lookback and a fixed `ordersPolicy` contract for
  replay, checkpoint overlap, and stale-close behavior
- orders scheduler `run now` now supports account-scoped replay with checkpoint reset, active-account
  validation, and system-actor execution for globally scoped runs
- the `/schedulers` orders tab now shows replay lookback controls, fixed policy copy, and per-account
  `Replay account` repair actions from Order sync health
- orders scheduler runtime tables are now migration-owned, and orders sync/replay no longer create
  checkpoint or snapshot tables at runtime
- orders runtime schema now fails fast with `ORDERS_SCHEDULER_SCHEMA_MISSING` when the migration
  foundation is absent, instead of attempting lazy DDL during a sync or replay
- the `/schedulers` page now splits selected-scheduler overview, config/repair, and history/detail
  into focused workspace modules instead of keeping the entire surface inline in one page file
- orders sync now has a clearer operator desk flow, with checkpoint repair separated from
  schedule-wide configuration and run history framed as an orders-specific workspace
- orders sync summary now exposes explicit runtime-foundation truth, including the Phase 5 migration
  identity and any missing runtime tables/columns
- orders scheduler now has a dedicated live health script and release gate for admin diagnostics plus
  focused frontend UI/E2E coverage of the orders operator workspace
- orders scheduler now has a final signoff artifact path with explicit walkthrough, runbook,
  runtime-foundation, and admin-access review evidence
- orders scheduler controller actions now have focused admin-only auth coverage across the canonical
  `/scheduler/orders/*` surface
- orders scheduler now has a single live-proof workflow that runs the live release gate and final
  signoff in order, then writes one combined proof artifact for deployment evidence

Current schedulers verification commands:

- `npm run test:asset-price-sync-phase1`
- `npm run test:asset-price-sync-phase2`
- `npm run test:asset-price-sync-phase3`
- `npm run test:asset-price-sync-phase4`
- `npm run test:asset-price-sync-phase5`
- `npm run test:asset-price-sync-phase6`
- `npm run test:asset-price-sync-phase7`
- `npm run test:asset-price-sync-phase8`
- `npm run test:asset-price-sync-phase9`
- `npm run capture:asset-price-sync-evidence`
- `npm run proof:asset-price-sync-live`
- `npm run signoff:asset-price-sync`
- `npm run release-gate:asset-price-sync`
- `npm run check:asset-price-sync-health`
- `npm run capture:global-system-schedulers-evidence`
- `npm run proof:global-system-schedulers-live`
- `npm run signoff:global-system-schedulers`
- `npm run release-gate:global-system-schedulers`
- `npm run check:global-system-schedulers-health`
- `npm run test:global-system-schedulers-phase9`
- `npm run test:global-system-schedulers-phase8`
- `npm run proof:orders-scheduler-live`
- `npm run signoff:orders-scheduler`
- `npm run release-gate:orders-scheduler`
- `npm run check:orders-scheduler-health`
- `npm run proof:positions-scheduler-live`
- `npm run signoff:positions-scheduler`
- `npm run release-gate:positions-scheduler`
- `npm run check:positions-scheduler-health`
- `npm run test:positions-orders-sync-phase9`
- `npm run test:schedulers-phase9`
- `npm run test:schedulers-phase8`
- `npm run test:schedulers-phase7`
- `npm run test:schedulers-phase5`
- `npm run test:schedulers-phase4`
- `npm run test:schedulers-phase2`
- `npm run test:schedulers-phase3`
- `npm run test:operational-audit`
- `npm run test:controllers`
- `npm run type-check`
- `npx eslint src/api/contracts/Scheduler.ts src/api/controllers/OrdersSchedulerController.ts src/api/services/SchedulerRuntimeSchemaService.ts src/api/services/InternalOrdersSyncService.ts src/api/services/OrdersSchedulerService.ts src/api/validators/scheduler.validator.ts src/database/migrations/1770706000000-CreateOrdersSchedulerRuntimeTables.ts src/database/repositories/ExchangeAssetUpdateLogRepository.ts scripts/test-schedulers-phase2.ts scripts/test-schedulers-phase3.ts scripts/test-schedulers-phase4.ts scripts/test-schedulers-phase5.ts scripts/test-schedulers-phase7.ts scripts/test-schedulers-phase8.ts scripts/test-schedulers-phase9.ts scripts/check-orders-scheduler-health.ts scripts/proof-orders-scheduler-live.ts scripts/release-gate-orders-scheduler.ts scripts/signoff-orders-scheduler.ts scripts/test-operational-audit.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/services/tradingApi.js src/store/slices/settingsSlice.js src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx src/pages/Schedulers/components/SchedulerHistoryWorkspace.jsx src/pages/Schedulers/components/SchedulerDiscoveryRunDetail.jsx src/pages/Schedulers/components/SchedulerConfigSection.jsx src/pages/Schedulers/components/SchedulerConfigSection.test.jsx src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx src/pages/Schedulers/components/SchedulerRunsSection.jsx src/pages/Schedulers/components/SchedulerRunUpdatesSection.jsx src/pages/Schedulers/hooks/useSchedulerPolling.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerConfigSection.test.jsx`

## Orders

Phase baselines for `/orders`:

- [ORDERS_PHASE0.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE0.md)
- [ORDERS_PHASE1.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE1.md)
- [ORDERS_PHASE2.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE2.md)
- [ORDERS_PHASE3.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE3.md)
- [ORDERS_PHASE4.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE4.md)
- [ORDERS_PHASE5.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE5.md)
- [ORDERS_PHASE6.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE6.md)
- [ORDERS_PHASE7.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE7.md)
- [ORDERS_PHASE8.md](/Users/apple/Documents/Project/Backend/aurAlpha/ORDERS_PHASE8.md)

Current frontend `/orders` owner:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrdersWorkspaceSection.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrderCreateDrawer.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrderDetailsDrawer.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrdersActivityTrail.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/trust.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/forms/OrderTicketForm.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.js`

Protected orders endpoints:

- `GET /api/v1/orders/overview`
- `GET /api/v1/orders/paper`
- `POST /api/v1/orders/futures/:assetId`
- `POST /api/v1/orders/paper/:assetId`
- `DELETE /api/v1/orders/futures/:orderId`
- `DELETE /api/v1/orders/paper/:paperOrderId`

Phase 0 semantic baseline:

- `/orders` is a global execution console, not a broker-native live blotter
- live monitoring is snapshot-backed from `scheduler_orders_snapshots`
- paper orders are DB-backed and simulation-driven from `paper_orders`
- create/cancel is route-scoped, but monitoring remains global across active accounts
- the current details drawer uses canonical detail fetch with row fallback
- paper writes now reconcile locally from DB-backed API responses before any optional paper-only refetch
- live writes now rely on targeted snapshot polling instead of full live+paper reloads
- live and paper workspaces are now explicitly separated in-page
- execution activity is now visible from `/orders` through filtered `activity_logs` reads
- the page is now split into workspace, ticket, detail, and activity modules
- create-order submissions are now idempotent when the same ticket draft is retried
- broker rejection errors now return stable API `code` values and operator-friendly messages

Current orders verification commands:

- `npm run test:orders-contract`
- `npm run test:orders-phase8`
- `npx eslint src/api/contracts/ApiResponse.ts src/api/errors/AppError.ts src/api/middlewares/ErrorHandlerMiddleware.ts src/api/contracts/OrdersOverview.ts src/api/services/OrdersOverviewService.ts src/api/services/BrokerOrdersFacadeService.ts src/api/services/PaperOrderExecutionService.ts src/api/validators/orders.validator.ts src/database/entities/OrderSubmissionRequest.ts src/database/repositories/OrderSubmissionRequestRepository.ts scripts/test-orders-contract.ts scripts/test-orders-phase8.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/store/slices/ordersSlice.test.js src/pages/Orders/index.test.jsx --reporter=verbose`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Orders/index.jsx src/pages/Orders/trust.js src/pages/Orders/index.test.jsx src/pages/Orders/OrdersActivityTrail.jsx src/pages/Orders/OrdersWorkspaceSection.jsx src/pages/Orders/OrderCreateDrawer.jsx src/pages/Orders/OrderDetailsDrawer.jsx src/store/slices/ordersSlice.js src/store/slices/ordersSlice.test.js src/services/http.js tests/e2e/orders.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/orders.spec.js`
- `npm run release-gate:orders`
- `npm run signoff:orders`

## Scripts

- `npm run serveLocal`
- `npm run build-local`
- `npm run db:baseline`
- `npm run db:migrate`
- `npm run db:seed:persistence` (no-op; keeps tables empty)
- `npm run db:bootstrap`
- `npm start`
- `npm run smoke:modules`
- `npm run smoke:backtests-lifecycle`
- `npm run smoke:automations-lifecycle`
- `npm run proof:backtests-live`
- `npm run proof:automations-live`
- `npm run check:auth-health`
- `npm run check:overview-health`
- `npm run check:orders-health`
- `npm run check:backtests-health`
- `npm run check:automations-health`
- `npm run release-gate:auth`
- `npm run release-gate:overview`
- `npm run release-gate:orders`
- `npm run release-gate:backtests`
- `npm run release-gate:automations`
- `npm run signoff:auth`
- `npm run signoff:overview`
- `npm run signoff:orders`
- `npm run signoff:backtests`
- `npm run signoff:automations`
- `npm run db:seed:backtests-chart-smoke`
- `npm run test:all`
- `npm run test:controllers`
- `npm run test:overview-contract`
- `npm run test:services`

## Notes

- Prefer `DB_SYNCHRONIZE=false` when using migrations.
- `db:bootstrap` now creates the schema only and leaves application tables empty.
- `serveLocal` copies `environments/localhost/.env` into project root before starting the server.
- `/settings` persists user preferences in `app_settings`; those DB values win once a user has saved settings.
- If a user has no `app_settings` row yet, the API returns backend defaults (`UTC`, notifications enabled, destructive confirmation enabled) rather than reading per-setting env overrides.
- `executionMode` in the settings response is environment metadata from `APP_ENV`; it is not stored in `app_settings` and cannot be mutated from `/settings`.
- Shared scheduler execution config is separate from personal `/settings.timezone`; scheduler timezone comes from scheduler config/defaults, not from a user preference row.
- `settings_audit_logs` is treated as append-only history and is retained until an explicit archival/export workflow is introduced.
- Provider identity is now modeled in DB master tables:
  - `brokers`: `mudrex`, `delta_exchange`
  - `exchanges`: `binance`
- Provider-specific account credentials belong in `broker_accounts.settings`.
- Exchange product mappings belong in `broker_assets` and are keyed by provider `source`, with optional broker-master linkage when a broker record applies.
- `broker_assets` is the global provider asset catalog; the legacy `broker_assets.user_id` ownership column was removed in the schema cleanup documented in `BROKER_ASSETS_PHASE4.md`, and the steady-state contract is documented in `BROKER_ASSETS_PHASE5.md`.
- The frozen Phase 1 trust contract for `positions-sync` and `orders-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE1.md`; `npm run test:positions-orders-sync-phase1` is the current backend guard for the target user-owned scheduler contract before shared contract alignment in Phase 2.
- The Phase 2 shared contract alignment for `positions-sync` and `orders-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE2.md`; `npm run test:positions-orders-sync-phase2` is the current backend guard before the live positions scheduler migration starts in Phase 3.
- The Phase 3 positions runtime migration for `positions-sync` and trust-boundary freeze for `positions-sync` and `orders-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE3.md`; `npm run test:positions-orders-sync-phase3` is the current backend guard before the `orders-sync` runtime migration in Phase 4.
- The Phase 4 orders runtime migration plus provider-runtime validation for `positions-sync` and `orders-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE4.md`; `npm run test:positions-orders-sync-phase4` now guards the `orders-sync` user-scoped scheduler record plus all-users Mudrex and Delta coverage before the richer ops-surface work in Phase 5.
- The scheduler account-scope Phase 3 layering contract for `funds-sync`, `orders-sync`, and `positions-sync` is documented in `SCHEDULER_ACCOUNT_SCOPE_PHASE3.md`; `npm run test:scheduler-account-scope-phase3` now guards that `BrokerAccountRepository` stays generic while ownerless system-account exclusion remains in the scheduler or internal-sync service layer before Phase 4 extends route and operator coverage.
- The scheduler account-scope Phase 5 live proof workflow for `funds-sync`, `orders-sync`, and `positions-sync` is documented in `SCHEDULER_ACCOUNT_SCOPE_PHASE5.md`; `npm run check:scheduler-account-scope-live` now compares the real localhost API totals against the real MySQL `4` user-owned / `2` system-owned broker-account split, while `npm run test:scheduler-account-scope-phase5` freezes that proof command before Phase 6.
- The scheduler account-scope Phase 6 operator proof workflow for `funds-sync`, `orders-sync`, and `positions-sync` is documented in `SCHEDULER_ACCOUNT_SCOPE_PHASE6.md`; `npm run proof:scheduler-account-scope-live` now writes a manual smoke proof artifact from the real localhost API and ownership split, while `npm run test:scheduler-account-scope-phase6` freezes that artifact workflow before Phase 7 decides whether a dedicated release gate is needed.
- The scheduler account-scope Phase 7 release workflow for `funds-sync`, `orders-sync`, and `positions-sync` is documented in `SCHEDULER_ACCOUNT_SCOPE_PHASE7.md`; `npm run release-gate:scheduler-account-scope` and `npm run signoff:scheduler-account-scope` now turn the ownership-alignment work into a release-ready path, while `npm run test:scheduler-account-scope-phase7` freezes that release and signoff workflow before Phase 8 combines it into a final proof chain.
- The Phase 5 richer ops/audit payload for `positions-sync` and `orders-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE5.md`; `npm run test:positions-orders-sync-phase5` now guards manual audit stamping, additive run/update ISO fields, export audit columns, and scheduler-scoped positions update-log purge before Phase 6 timezone-localization work.
- The Phase 6 shared timezone/display contract for `positions-sync` and `orders-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE6.md`; `npm run test:positions-orders-sync-phase6` now guards localized config, run, update-log, and sync-state timestamps plus shared `time` metadata before the scheduler-specific Phase 7 surfaces.
- The Phase 7 positions-specific operational freeze for `positions-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE7.md`; `npm run test:positions-orders-sync-phase7` now builds on `npm run test:positions-scheduler-phase7` to guard owner-aware recovery diagnostics, persisted rebuild history, and the own-user `/positions` product trust boundary before Phase 8 shifts to `orders-sync`.
- The Phase 8 orders-specific operational freeze for `orders-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE8.md`; `npm run test:positions-orders-sync-phase8` now builds on `npm run test:schedulers-phase7` and `npm run test:schedulers-phase8` to guard runtime foundation truth, scoped replay and checkpoint reset handling, and the own-user `/orders` product trust boundary before Phase 9 proof/signoff work.
- The Phase 9 shared proof/signoff workflow for `positions-sync` and `orders-sync` is documented in `POSITIONS_ORDERS_SYNC_PHASE9.md`; `npm run test:positions-orders-sync-phase9` now guards both live-proof scripts, their signoff prerequisites, and the shared package/README workflow wiring before any deeper promotion-phase work.
- The frozen Phase 1 contract for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE1.md`; `npm run test:asset-price-sync-phase1` is the current backend guard before the schema and storage cutover phases.
- The Phase 2 schema foundation for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE2.md`; `npm run test:asset-price-sync-phase2` and `npm run db:migrate` are the current backend guardrails before the writer cutover in Phase 3.
- The Phase 3 writer cutover for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE3.md`; `npm run test:asset-price-sync-phase3` now guards the `asset_price` writer contract while Phase 4 migrates remaining readers off the legacy repository.
- The Phase 4 reader migration for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE4.md`; `npm run test:asset-price-sync-phase4` now guards the active read path so later cleanup phases can remove the legacy market-price repository safely.
- The Phase 5 legacy cleanup for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE5.md`; `npm run test:asset-price-sync-phase5` plus `npm run db:migrate` now guard the removal of the old `market_prices_binance` schema path.
- The Phase 6 backend operator contract for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE6.md`; `npm run test:asset-price-sync-phase6` now guards localized scheduler times, audit fields, export columns, and scheduler-scoped purge behavior.
- The Phase 7 frontend/operator consumption handoff for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE7.md`; `npm run test:asset-price-sync-phase7` now guards Mudrex + Delta operator copy plus the frontend save/run payload contract.
- The Phase 8 operational proof workflow for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE8.md`; `check:asset-price-sync-health`, `release-gate:asset-price-sync`, `signoff:asset-price-sync`, and `proof:asset-price-sync-live` are the current operator entry points.
- The Phase 8 operational proof workflow for `funds-sync` is documented in `FUNDS_SCHEDULER_PHASE8.md`; `check:funds-scheduler-health`, `release-gate:funds-scheduler`, `signoff:funds-scheduler`, and `proof:funds-scheduler-live` are the current operator entry points.
- Functional checklist baselines now exist for `funds-sync`, `broker-assets-sync`, `exchange-assets-sync`, `binance-candles-3m-1m-sync`, and `system-health-sync` in `FUNDS_SYNC_FUNCTIONAL_CHECKLIST.md`, `BROKER_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md`, `EXCHANGE_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md`, `CANDLES_SYNC_FUNCTIONAL_CHECKLIST.md`, and `SYSTEM_HEALTH_SYNC_FUNCTIONAL_CHECKLIST.md`.
- The Phase 9 real deployment-proof workflow for `asset-price-sync` is documented in `ASSET_PRICE_SYNC_PHASE9.md`; `capture:asset-price-sync-evidence` plus `proof:asset-price-sync-live` are the current live operator handoff entry points.
- The frozen Phase 1 contract for `risk-recompute-sync` is documented in `RISK_SCHEDULER_PHASE1.md`; `npm run test:risk-scheduler-phase1` is the current backend guard before the later operator and release-workflow phases.
- The Phase 2 admin scheduler surface for `risk-recompute-sync` is documented in `RISK_SCHEDULER_PHASE2.md`; `npm run test:risk-scheduler-phase2` is the current backend guard before the internal execution-contract work in Phase 3.
- The Phase 3 internal execution contract for `risk-recompute-sync` is documented in `RISK_SCHEDULER_PHASE3.md`; `npm run test:risk-scheduler-phase3` is the current backend guard before runtime proof and failure-isolation work in Phase 4.
- The Phase 4 runtime proof and failure isolation for `risk-recompute-sync` is documented in `RISK_SCHEDULER_PHASE4.md`; `npm run test:risk-scheduler-phase4` is the current backend guard before diagnostics-summary expansion in Phase 5.
- The Phase 5 diagnostics summary and blocker truth for `risk-recompute-sync` is documented in `RISK_SCHEDULER_PHASE5.md`; `npm run test:risk-scheduler-phase5` is the current backend guard before localized diagnostics-display work in Phase 6.
- The Phase 6 timezone-localized diagnostics contract for `risk-recompute-sync` is documented in `RISK_SCHEDULER_PHASE6.md`; `npm run test:risk-scheduler-phase6` now guards localized summary timestamps, raw UTC ISO companions, `time` metadata, and `Asia/Calcutta` alias coverage before the final release-workflow phase.
- The broker-assets release workflow is documented in `BROKER_ASSETS_PHASE9.md`; `check:broker-assets-health`, `capture:broker-assets-evidence`, `release-gate:broker-assets`, `signoff:broker-assets`, and `proof:broker-assets-live` are the current operator entry points.
- The shared global system scheduler release workflow is documented in `GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md`; `check:global-system-schedulers-health`, `capture:global-system-schedulers-evidence`, `release-gate:global-system-schedulers`, `signoff:global-system-schedulers`, and `proof:global-system-schedulers-live` are the current operator entry points.
- `MUDREX_API_SECRET` is required for the current Mudrex-authenticated request path.

## Smoke verification

Once the local API is running, verify the platform modules with:

```bash
APP_API_KEY=<APP_API_KEY> npm run smoke:modules
```

Optional overrides:

- `BASE_URL=http://localhost:3000/api/v1`
- `API_KEY=<APP_API_KEY>`

Backtests release gate:

```bash
BACKTESTS_SOAK_DURATION_MINUTES=30 npm run release-gate:backtests
```

The repo also includes a manual GitHub Actions workflow, `Backtests Staging Gate`, which runs the same release gate against staging and uploads the JSON summary artifact.

Final backtests sign-off:

```bash
BACKTESTS_SIGNOFF_GATE_FILE=artifacts/backtests-release-gate.json \
BACKTESTS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED=true \
BACKTESTS_SIGNOFF_UI_COMPOSURE_VERIFIED=true \
BACKTESTS_SIGNOFF_RESULTS_SCALING_VERIFIED=true \
npm run signoff:backtests
```

Useful overrides:

- `SMOKE_BASE_URL=http://localhost:3000/api/v1`
- `SMOKE_LOGIN_EMAIL=admin@auralpha.com`
- `SMOKE_LOGIN_PASSWORD=Admin@123`
- `SMOKE_REQUIRE_BACKTEST_CHART=true`
- `BACKTESTS_MAX_STALE_RUNNING_RUNS=0`
- `BACKTESTS_MAX_INCOMPLETE_TRADE_HISTORY_RUNS=0`
- `BACKTESTS_MAX_OPEN_ALERTS=0`
- `BACKTESTS_MAX_RECOVERABLE_RUNS=0`
- `BACKTESTS_RELEASE_GATE_OUTPUT_FILE=artifacts/backtests-release-gate.json`
- `BACKTESTS_SIGNOFF_OUTPUT_FILE=artifacts/backtests-signoff.json`

If you want the lifecycle smoke or release gate to validate the chart endpoint locally, enable Postgres market data, run migrations, and seed the smoke candle fixtures first:

```bash
npm run db:bootstrap
npm run db:seed:backtests-chart-smoke
SMOKE_REQUIRE_BACKTEST_CHART=true npm run smoke:backtests-lifecycle
```

Combined live backtests proof:

```bash
APP_API_KEY=<APP_API_KEY> \
SMOKE_REQUIRE_BACKTEST_CHART=true \
BACKTESTS_MAX_STALE_RUNNING_RUNS=0 \
BACKTESTS_MAX_INCOMPLETE_TRADE_HISTORY_RUNS=0 \
BACKTESTS_MAX_OPEN_ALERTS=0 \
BACKTESTS_MAX_RECOVERABLE_RUNS=0 \
npm run proof:backtests-live
```

Backend CI now uses that same proof path after bootstrapping the live API stack.

External backtests health check:

```bash
APP_API_KEY=<APP_API_KEY> npm run check:backtests-health
```

Useful thresholds:

- `BACKTESTS_MAX_STALE_RUNNING_RUNS`
- `BACKTESTS_MAX_INCOMPLETE_TRADE_HISTORY_RUNS`
- `BACKTESTS_MAX_OPEN_ALERTS`
- `BACKTESTS_MAX_OPEN_RUNTIME_ALERTS`
- `BACKTESTS_MAX_OPEN_RECOVERY_ALERTS`
- `BACKTESTS_MAX_OPEN_PROMOTION_ALERTS`
- `BACKTESTS_MAX_RECOVERABLE_RUNS`

Auth release gate:

```bash
npm run release-gate:auth
```

Optional live auth health check during the release gate:

- `AUTH_RUN_LIVE_CHECKS=true`
- `AUTH_FRONTEND_CWD=/Users/apple/Documents/Project/Frontend/aurAlphaApp`
- `AUTH_RELEASE_GATE_OUTPUT_FILE=artifacts/auth-release-gate.json`

External auth health check:

```bash
APP_API_KEY=<APP_API_KEY> npm run check:auth-health
```

Useful auth health thresholds:

- `AUTH_MAX_ACTIVE_PAIR_LOCKOUTS`
- `AUTH_MAX_ACTIVE_IP_LOCKOUTS`
- `AUTH_MAX_PAIR_FAILURES`
- `AUTH_MAX_IP_FAILURES`
- `AUTH_REQUIRE_SEED_DISABLED`
- `AUTH_REQUIRE_FAILURE_ALERTS_ENABLED`

Final auth sign-off:

```bash
AUTH_SIGNOFF_GATE_FILE=artifacts/auth-release-gate.json \
AUTH_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED=true \
AUTH_SIGNOFF_SESSION_RECOVERY_VERIFIED=true \
AUTH_SIGNOFF_LOCKOUT_RUNBOOK_VERIFIED=true \
npm run signoff:auth
```

Overview release gate:

```bash
npm run release-gate:overview
```

Optional live overview health check during the release gate:

- `OVERVIEW_RUN_LIVE_CHECKS=true`
- `OVERVIEW_FRONTEND_CWD=/Users/apple/Documents/Project/Frontend/aurAlphaApp`
- `OVERVIEW_RELEASE_GATE_OUTPUT_FILE=artifacts/overview-release-gate.json`

External overview health check:

```bash
APP_API_KEY=<APP_API_KEY> npm run check:overview-health
```

Useful overview health thresholds:

- `OVERVIEW_MAX_TOTAL_MS`
- `OVERVIEW_MAX_DEGRADED_SECTION_COUNT`
- `OVERVIEW_MAX_TIMEOUT_SECTION_COUNT`
- `OVERVIEW_MAX_STALE_SECTION_COUNT`
- `OVERVIEW_MAX_CRITICAL_SECTION_COUNT`
- `OVERVIEW_MAX_WARNING_COUNT`
- `OVERVIEW_REQUIRE_SELECTED_SYMBOL_RESOLVED`
- `OVERVIEW_REQUIRE_MARKETS_AVAILABLE`
- `OVERVIEW_REQUIRE_SELECTED_ASSET_AVAILABLE`
- `OVERVIEW_REQUIRE_CAPITAL_AVAILABLE`
- `OVERVIEW_REQUIRE_PORTFOLIO_AVAILABLE`

Final overview sign-off:

```bash
OVERVIEW_SIGNOFF_GATE_FILE=artifacts/overview-release-gate.json \
OVERVIEW_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED=true \
OVERVIEW_SIGNOFF_DATA_PROVENANCE_VERIFIED=true \
OVERVIEW_SIGNOFF_OPERATOR_HANDOFFS_VERIFIED=true \
OVERVIEW_SIGNOFF_STALE_DATA_RUNBOOK_VERIFIED=true \
npm run signoff:overview
```

Automations release gate:

```bash
AUTOMATIONS_SOAK_DURATION_MINUTES=30 npm run release-gate:automations
```

The repo also includes a manual GitHub Actions workflow, `Automations Staging Gate`, which runs the same release gate against staging and uploads the JSON summary artifact.

Final automations sign-off:

```bash
AUTOMATIONS_SIGNOFF_GATE_FILE=artifacts/automations-release-gate.json \
AUTOMATIONS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED=true \
AUTOMATIONS_SIGNOFF_OPERATOR_RECOVERY_VERIFIED=true \
AUTOMATIONS_SIGNOFF_SCHEDULE_AUDIT_VERIFIED=true \
npm run signoff:automations
```

Useful overrides:

- `AUTOMATIONS_MAX_FAILED_RUNS_24H=0`
- `AUTOMATIONS_MAX_OVERLAP_SKIPS_24H=0`
- `AUTOMATIONS_MAX_STALE_CURSORS=0`
- `AUTOMATIONS_MAX_OPEN_ALERTS=0`
- `AUTOMATIONS_RELEASE_GATE_OUTPUT_FILE=artifacts/automations-release-gate.json`
- `AUTOMATIONS_SIGNOFF_OUTPUT_FILE=artifacts/automations-signoff.json`

Combined live automations proof:

```bash
APP_API_KEY=<APP_API_KEY> \
AUTOMATIONS_MAX_FAILED_RUNS_24H=0 \
AUTOMATIONS_MAX_OVERLAP_SKIPS_24H=0 \
AUTOMATIONS_MAX_STALE_CURSORS=0 \
AUTOMATIONS_MAX_OPEN_ALERTS=0 \
npm run proof:automations-live
```

External automations health check:

```bash
APP_API_KEY=<APP_API_KEY> npm run check:automations-health
```

Useful thresholds:

- `AUTOMATIONS_MAX_FAILED_RUNS_24H`
- `AUTOMATIONS_MAX_OVERLAP_SKIPS_24H`
- `AUTOMATIONS_MAX_STALE_CURSORS`
- `AUTOMATIONS_MAX_OPEN_ALERTS`
- `AUTOMATIONS_MAX_OPEN_CONTROL_ALERTS`
- `AUTOMATIONS_MAX_OPEN_RECOVERY_ALERTS`
- `AUTOMATIONS_MAX_OPEN_EXECUTION_ALERTS`

Note:

- `proof:automations-live`, `check:automations-health`, and `release-gate:automations` expect a live scheduler worker heartbeat and `/health` response at the configured worker base URL. Local API-only smoke coverage remains available through `npm run smoke:automations-lifecycle`.

## Regression checks

Run the lightweight service assertions without starting the API:

```bash
npm run test:services
```

Run the lightweight controller assertions:

```bash
npm run test:controllers
```

Run the full lightweight backend regression set:

```bash
npm run test:all
```
