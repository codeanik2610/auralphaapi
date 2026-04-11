# Orders Phase 5

Phase 5 for `/orders` focuses on execution-lifecycle quality: paper writes should feel durable immediately, live writes should stop forcing blunt full-page reloads, and the contract should describe the real persistence model the page now uses.

## Completed

- Paper-order responses now expose richer lifecycle metadata derived from the persisted simulation state, including lifecycle stage, last transition, observation source, position timestamps, and a compact execution history.
- The frontend orders slice now reconciles paper create/cancel responses locally, so DB-backed paper writes appear in the workspace immediately instead of waiting for a full list reload.
- The `/orders` page now splits live and paper refresh behavior: manual and initial loads still hydrate both surfaces, but live create/cancel follow-up now refreshes only live monitoring, while paper create/cancel can use a lighter paper-only refresh when the filtered Paper tab is active.
- Live broker writes now use targeted snapshot polling while the page is waiting for snapshot acknowledgement, instead of relying only on one blunt `refreshOrders()` call.
- `/orders/overview` metadata is now honest about the current page behavior: the details drawer uses canonical detail fetch with row fallback, paper writes use local reconciliation, and live writes use snapshot-ack polling.

## Backend / API

- [src/api/contracts/OrdersOverview.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/OrdersOverview.ts)
- [src/api/services/OrdersOverviewService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersOverviewService.ts)
- [src/api/services/BrokerOrdersFacadeService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerOrdersFacadeService.ts)
- [scripts/test-orders-contract.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-orders-contract.ts)

## Frontend

- [index.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx)
- [ordersSlice.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.js)
- [ordersSlice.test.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.test.js)

## DB / Data Flow

- No schema migration was required in this phase.
- Paper orders remain durable records in `paper_orders`, but their API mapping now exposes more of the simulation lifecycle already stored in `payload.simulation`.
- Paper create/cancel is now a stronger write-through path for the UI: the API response is treated as canonical enough for local list reconciliation, with a paper-only refetch used only when the current filtered Paper tab needs server confirmation.
- Live create/cancel remains broker-write plus snapshot-read, but the page now follows that model more deliberately by polling the live snapshot surface until acknowledgement instead of reloading unrelated paper data.

## Verification

- `npm run test:orders-contract`
- `npx eslint src/api/contracts/OrdersOverview.ts src/api/services/OrdersOverviewService.ts src/api/services/BrokerOrdersFacadeService.ts scripts/test-orders-contract.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && ./node_modules/.bin/vitest run src/store/slices/ordersSlice.test.js src/pages/Orders/index.test.jsx --reporter=verbose`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Orders/index.jsx src/store/slices/ordersSlice.js src/store/slices/ordersSlice.test.js`

## Phase 6 Start Point

Phase 6 can now focus on resilience, broader user-path coverage, and release readiness:

- add E2E coverage for the real `/orders` write flows
- add release-gate style checks for snapshot lag and write/read consistency
- verify the page behavior against live broker and scheduler timing, not just static contracts

## Known Unrelated Repo Blockers

- Backend repo-wide `npm run type-check` is still failing because of existing issues outside `/orders`, including [test-risk-center-phase1.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase1.ts), [test-risk-center-phase2.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase2.ts), [RiskOverviewService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts), and [RiskService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskService.ts).
