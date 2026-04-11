# Orders Phase 6

Date: 2026-04-09

## 1) Goal
Phase 6 for `/orders` focuses on release readiness and final sign-off.

By the end of this phase the orders workspace should:

- have an orders-specific release gate that proves the backend contract, frontend UI, and browser write flows still hold
- support a live health probe against the real `/orders` endpoints with latency and consistency thresholds
- have a final sign-off script that records whether operators have reviewed write/read consistency, snapshot-lag guidance, and the core live/paper flows

## 2) What Changed
### Backend operational tooling
The backend now includes orders rollout scripts in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-orders-health.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-orders.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-orders.ts`

Those scripts add:

- a live `/orders/overview` + `/orders/paper` probe using API key or admin login credentials
- optional canonical detail checks for the first live and paper orders when data exists
- configurable latency and snapshot-age thresholds
- a JSON release-gate artifact at `artifacts/orders-release-gate.json`
- a final sign-off artifact path compatible with `artifacts/orders-signoff.json`

The package entry points are wired in
`/Users/apple/Documents/Project/Backend/aurAlpha/package.json`.

### Frontend sign-off coverage
The frontend orders browser journey in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/orders.spec.js`
was upgraded from a shallow tab-switch smoke test into a stateful operator-flow suite.

That flow now verifies:

- live create uses the resolved market reference price and then waits for snapshot acknowledgement
- live cancel keeps the operator informed until the snapshot-backed view catches up
- paper detail refreshes canonical simulation state and paper cancel reconciles immediately

### Repo tracking
The rollout tracker and README now include the Phase 6 baseline and orders gate commands in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/README.md`
- `/Users/apple/Documents/Project/Backend/aurAlpha/PRODUCTION_READINESS_TRACKER.md`

## 3) Phase 6 Outcome
`/orders` now has a full implementation-to-release path:

- trusted runtime behavior from earlier phases
- focused UI and browser write-flow regression coverage
- release-gate automation
- live health thresholds
- final sign-off automation

This is the point where `/orders` stops being “feature-complete” and becomes “promotion-ready.”

## 4) Operational Note
The live orders health probe still requires a running API plus either:

- `APP_API_KEY` or `API_KEY`
- or valid admin login credentials

The final sign-off script expects real environment evidence through env vars before an actual promotion. Local placeholder values can verify the automation wiring, but they are not a substitute for real staging or production evidence.

## 5) Verification
Phase 6 verification passed with:

- `npm run test:orders-contract`
- `npx eslint src/api/contracts/OrdersOverview.ts src/api/services/OrdersOverviewService.ts src/api/services/BrokerOrdersFacadeService.ts scripts/test-orders-contract.ts scripts/check-orders-health.ts scripts/release-gate-orders.ts scripts/signoff-orders.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/store/slices/ordersSlice.test.js src/pages/Orders/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Orders/index.jsx src/pages/Orders/index.test.jsx src/store/slices/ordersSlice.js src/store/slices/ordersSlice.test.js tests/e2e/orders.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/orders.spec.js`
- `npm run release-gate:orders`
- `ORDERS_SIGNOFF_GATE_FILE=artifacts/orders-release-gate.json ORDERS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED=true ORDERS_SIGNOFF_WRITE_READ_CONSISTENCY_VERIFIED=true ORDERS_SIGNOFF_SNAPSHOT_LAG_RUNBOOK_VERIFIED=true ORDERS_SIGNOFF_OPERATOR_FLOWS_VERIFIED=true npm run signoff:orders`
