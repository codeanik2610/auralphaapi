# Positions Scheduler Phase 7

Phase 7 is the rollout and verification layer for the global `positions-sync` scheduler.

Goals:

- verify scheduled reconciliation covers the intended connected account universe
- keep `/positions` freshness and trust messaging aligned with scheduler reality
- keep admin diagnostics clear without leaking scheduler ownership confusion into the product desk
- remove dead input semantics from the admin diagnostics API

## What changed

- `ownerUserId` is now the only supported account-owner filter for positions scheduler sync-state diagnostics
- scheduler sync-state diagnostics now expose read-model drift and rebuild-needed signals
- a dedicated live health script now checks both:
  - admin diagnostics at `/scheduler/positions/*`
  - product trust endpoints at `/positions/futures/*`
- a dedicated release gate now bundles the positions scheduler phase suites and optional live checks

## Commands

Run the focused backend suites:

```bash
npm run test:positions-scheduler-phase1
npm run test:positions-scheduler-phase2
npm run test:positions-scheduler-phase3
npm run test:positions-scheduler-phase4
npm run test:positions-scheduler-phase6
npm run test:positions-scheduler-phase7
```

Run the live admin/product health check:

```bash
POSITIONS_SCHEDULER_ADMIN_EMAIL=admin@example.com \
POSITIONS_SCHEDULER_ADMIN_PASSWORD=secret \
POSITIONS_SCHEDULER_USER_EMAIL=user@example.com \
POSITIONS_SCHEDULER_USER_PASSWORD=secret \
npm run check:positions-scheduler-health
```

Run the scheduler rollout gate:

```bash
npm run release-gate:positions-scheduler
```

Enable live checks inside the scheduler release gate:

```bash
POSITIONS_SCHEDULER_RUN_LIVE_CHECKS=true \
POSITIONS_SCHEDULER_ADMIN_EMAIL=admin@example.com \
POSITIONS_SCHEDULER_ADMIN_PASSWORD=secret \
POSITIONS_SCHEDULER_USER_EMAIL=user@example.com \
POSITIONS_SCHEDULER_USER_PASSWORD=secret \
npm run release-gate:positions-scheduler
```

## Health expectations

- `/scheduler/positions/config` stays `schedulerType = global`
- `/scheduler/positions/sync-state/summary` exposes snapshot/read-model coverage counters
- `/scheduler/positions/sync-state` exposes `ownerUserId`, `readModelState`, and `readModelNeedsRebuild`
- `/positions/futures/sync-status` stays user-owned and route-scoped
- `/positions/futures/active` stays snapshot-backed and freshness-aware

## Success checks

- scheduled Positions Sync covers the intended connected accounts
- `/positions` remains snapshot-backed and trustworthy
- normal users do not need `/schedulers` for positions trust or refresh
- admins still have a clean diagnostics surface for checkpoint, pending-record, and read-model drift review
