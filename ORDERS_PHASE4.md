# Orders Phase 4

Phase 4 for `/orders` focuses on freshness and detail accuracy so the page stops treating list rows as the final source of truth.

## Completed

- The live order detail endpoint now returns canonical snapshot-backed detail with route, snapshot, and source metadata instead of only raw payload data.
- The paper order detail endpoint now exposes explicit source metadata so the UI can distinguish simulated paper state from live broker snapshots.
- `/orders/overview` sections now expose snapshot freshness metadata (`latestSnapshotAt`, `oldestSnapshotAt`, `freshnessModel`) alongside the normalized live rows added in Phase 3.
- The frontend order drawer now refreshes canonical detail on open for both live and paper orders.
- The `/orders` control plane now tells the operator whether they are looking at snapshot-backed live data or DB-backed paper simulation data.
- The page now tracks live create/cancel actions against the snapshot-backed read model and surfaces when the view is still waiting for the next snapshot cycle to catch up.

## Backend / API

- [src/api/contracts/OrdersOverview.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/OrdersOverview.ts)
- [src/api/services/OrdersOverviewService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersOverviewService.ts)
- [src/api/services/BrokerOrdersFacadeService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerOrdersFacadeService.ts)
- [scripts/test-orders-contract.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-orders-contract.ts)

## Frontend

- [index.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx)
- [trust.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/trust.js)
- [index.test.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.test.jsx)
- [ordersSlice.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.js)
- [ordersSlice.test.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.test.js)
- [tradingApi.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js)

## DB / Data Flow

- No schema migration was required in this phase.
- Live detail reads remain snapshot-backed from `scheduler_orders_snapshots`, but the detail payload now carries explicit snapshot timestamps and source metadata.
- Paper detail reads remain DB-backed from `paper_orders`, with simulation state refreshed before returning canonical detail.
- Live create/cancel writes still go directly to the broker adapter, so the new UI lag messages intentionally describe the delay between broker acceptance and snapshot visibility.

## Verification

- `npm run test:orders-contract`
- `npx eslint src/api/contracts/OrdersOverview.ts src/api/services/OrdersOverviewService.ts src/api/services/BrokerOrdersFacadeService.ts scripts/test-orders-contract.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Orders/index.jsx src/pages/Orders/trust.js src/pages/Orders/index.test.jsx src/store/slices/ordersSlice.js src/store/slices/ordersSlice.test.js src/services/tradingApi.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/pages/Orders/index.test.jsx src/store/slices/ordersSlice.test.js --reporter=verbose`

## Phase 5 Start Point

Phase 5 can now focus on persistence and execution lifecycle quality:

- tighten create/cancel refresh behavior beyond a full page refresh
- improve paper-order lifecycle metadata and execution history
- reduce friction between write actions and the monitoring surface

## Known Unrelated Repo Blockers

- Backend repo-wide `npm run type-check` is still failing because of existing issues outside `/orders`, including [test-risk-center-phase1.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase1.ts), [test-risk-center-phase2.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase2.ts), [RiskOverviewService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts), and [RiskService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskService.ts).
