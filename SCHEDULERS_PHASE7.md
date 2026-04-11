# Schedulers Phase 7

Date: 2026-04-10

## 1) Goal
Phase 7 turns the orders scheduler into a release-gated operator surface.

By the end of this phase:

- the orders sync summary explicitly reports whether the Phase 5 runtime foundation is present
- the `/schedulers` orders workspace is covered by a browser-level operator journey
- the orders scheduler has a dedicated live health script and release gate
- Phase 8 can focus on final signoff instead of basic rollout proof

## 2) What Changed
### Runtime foundation is now part of scheduler truth
`/scheduler/orders/sync-state/summary` now carries explicit runtime-foundation diagnostics through:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Scheduler.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/SchedulerRuntimeSchemaService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersSchedulerService.ts`

That summary now states whether the orders runtime schema is:

- `ready`
- or `missing`

and includes:

- the Phase 5 migration name
- required runtime tables
- required runtime columns
- any missing parts when the foundation is incomplete

The sync-state list and summary also avoid probing missing runtime tables once the foundation is
known missing, so admin diagnostics degrade cleanly instead of relying on exception-driven fallback.

### Focused Phase 7 backend coverage exists
Phase 7 assertions now live in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-schedulers-phase7.ts`

The suite proves:

- runtime foundation readiness is reported explicitly
- missing runtime foundation is reported explicitly
- sync summary includes runtime foundation metadata
- sync summary avoids missing-table queries when the runtime foundation is already known missing

### Dedicated live health check exists
Orders scheduler now has a dedicated live health script:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-orders-scheduler-health.ts`

It checks:

- admin auth and `/scheduler/orders/config`
- `/scheduler/orders/sync-state/summary`
- `/scheduler/orders/sync-state`
- `/scheduler/orders/runs`
- shared queue and worker health endpoints
- runtime-foundation truth inside the summary contract

### Dedicated release gate exists
Orders scheduler now has a release gate at:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-orders-scheduler.ts`

Package commands added:

- `npm run test:schedulers-phase7`
- `npm run check:orders-scheduler-health`
- `npm run release-gate:orders-scheduler`

The release gate bundles:

- backend Phase 2, 3, 4, 5, and 7 suites
- backend controller coverage
- backend scheduler lint
- frontend schedulers lint
- focused schedulers UI tests
- a browser-level orders scheduler E2E flow
- optional live health proof

## 3) Commands
Run the focused backend suites:

```bash
npm run test:schedulers-phase2
npm run test:schedulers-phase3
npm run test:schedulers-phase4
npm run test:schedulers-phase5
npm run test:schedulers-phase7
```

Run the live orders scheduler health check:

```bash
ORDERS_SCHEDULER_ADMIN_EMAIL=admin@example.com \
ORDERS_SCHEDULER_ADMIN_PASSWORD=secret \
npm run check:orders-scheduler-health
```

Run the release gate:

```bash
npm run release-gate:orders-scheduler
```

Enable live checks inside the release gate:

```bash
ORDERS_SCHEDULER_RUN_LIVE_CHECKS=true \
ORDERS_SCHEDULER_ADMIN_EMAIL=admin@example.com \
ORDERS_SCHEDULER_ADMIN_PASSWORD=secret \
npm run release-gate:orders-scheduler
```

## 4) Health Expectations
- `/scheduler/orders/config` stays `schedulerType = global`
- `/scheduler/orders/config` keeps fixed `sources = ["orders"]`
- `/scheduler/orders/config` still exposes the saved replay policy contract
- `/scheduler/orders/sync-state/summary` exposes runtime-foundation status and migration identity
- `/scheduler/orders/sync-state` exposes `ownerUserId`, checkpoint coverage, and retry backlog fields
- `/scheduler/orders/runs` remains available for the orders operator desk
- shared queue and worker health remain reachable for the Phase 6 workspace cards

## 5) Phase 7 Outcome
Orders scheduler now has the rollout layer it was missing:

- admin diagnostics prove whether the runtime schema is actually ready
- the orders workspace is covered in browser automation instead of only unit tests
- a single release gate can be used before Phase 8 signoff

## 6) What Remains
Phase 8 should finish release governance with:

- final signoff artifact generation
- explicit evidence capture for operator walkthrough, runbook review, and live health review

