# Orders Phase 3

Phase 3 for `/orders` strengthens the live orders data contract so the page can trust one normalized row model instead of flattening grouped snapshot payloads on the frontend.

## Completed

- `/api/v1/orders/overview` now returns typed section wrappers for `openOrders` and `history`, including `source`, `rowModel`, `totalRows`, `totalAccounts`, and normalized `items`.
- Live overview rows now carry route metadata and snapshot metadata together:
  - route: `brokerKey`, `accountId`, `accountName`, `accountKey`, `status`
  - snapshot: `source`, `statusRank`, `state`, `firstSeenAt`, `lastSeenAt`
- Snapshot-backed active-account reads now pass through real `first_seen_at` and `last_seen_at` values from `scheduler_orders_snapshots`.
- The frontend orders slice now consumes the section wrapper directly and stores overview metadata plus per-section metadata for the next phase.
- The frontend keeps a compatibility fallback for the older grouped payload shape so the UI can tolerate staggered backend/frontend rollout during local or staged testing.

## Backend / API

- [src/api/contracts/OrdersOverview.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/OrdersOverview.ts)
- [src/api/services/OrdersOverviewService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersOverviewService.ts)
- [src/api/services/BrokerOrdersFacadeService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerOrdersFacadeService.ts)
- [scripts/test-orders-contract.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-orders-contract.ts)

## Frontend

- [ordersSlice.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.js)
- [ordersSlice.test.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.test.js)
- [index.test.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.test.jsx)

## DB / Data Flow

- No schema migration was required in this phase.
- Phase 3 reuses the existing `scheduler_orders_snapshots` table and now exposes the existing `first_seen_at` / `last_seen_at` values through the `/orders/overview` response contract.
- Live create/cancel behavior is unchanged: writes still go through the broker adapter directly, while the overview still reads from snapshot-backed state.

## Verification

- `npm run test:orders-contract`
- `npx eslint src/api/contracts/OrdersOverview.ts src/api/services/OrdersOverviewService.ts src/api/services/BrokerOrdersFacadeService.ts scripts/test-orders-contract.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/ordersSlice.js src/store/slices/ordersSlice.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/store/slices/ordersSlice.test.js src/pages/Orders/index.test.jsx --reporter=verbose`

## Phase 4 Start Point

Phase 4 can now focus on freshness and detail accuracy:

- fetch canonical order detail when the drawer opens instead of trusting only the list row payload
- show snapshot age and source honesty in the UI
- make live snapshot lag visible after create/cancel actions

## Known Unrelated Repo Blockers

- Backend repo-wide `npm run type-check` is still failing because of existing issues outside `/orders`, including [test-risk-center-phase1.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase1.ts), [test-risk-center-phase2.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase2.ts), [RiskOverviewService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts), and [RiskService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskService.ts).
