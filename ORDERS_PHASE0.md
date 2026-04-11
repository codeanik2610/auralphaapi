# Orders Phase 0

Date: 2026-04-09

## 1) Problem Statement
AurAlpha already has a protected `/orders` route, live order APIs, paper-order persistence, and a
real frontend execution workspace, but the current implementation is easy to misread as one
coherent broker-native blotter.
Phase 0 exists to freeze what `/orders` is for, which endpoints the page is allowed to depend on,
which parts of the page are route-scoped vs global, and where live orders, paper orders, prices,
and margin checks actually come from before Phase 1 starts changing UX and trust semantics.

## 2) Ownership Boundary
Frontend ownership lives in `/Users/apple/Documents/Project/Frontend/aurAlphaApp`:

- route registration: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/routes/index.jsx`
- page UI: `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx`
- order ticket form:
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/forms/OrderTicketForm.jsx`
- orders state:
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/ordersSlice.js`
- API call wiring:
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`
- page test:
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.test.jsx`

Backend ownership lives in this repo:

- overview controller:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/OrdersOverviewController.ts`
- order CRUD controller:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/OrdersController.ts`
- overview service:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersOverviewService.ts`
- facade service:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerOrdersFacadeService.ts`
- validation:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/orders.validator.ts`
- overview contract:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/OrdersOverview.ts`
- live order snapshot sync:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/InternalOrdersSyncService.ts`
- paper order simulation:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PaperOrderExecutionService.ts`
- paper order scheduler loader:
  `/Users/apple/Documents/Project/Backend/aurAlpha/src/loaders/PaperOrdersExecutionLoader.ts`
- paper order persistence:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/PaperOrder.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/PaperOrderRepository.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/migrations/1765308000000-CreatePaperOrdersTable.ts`

Phase 1 may change copy, layout, state handling, and interaction design, but it should preserve
the product decisions below unless frontend and backend are updated together.

## 3) Product Decision
`/orders` is a global execution console, not a canonical live broker blotter and not a purely
route-scoped workspace.

That means:

- monitoring is allowed to aggregate across all active connected accounts
- creation and cancellation are route-scoped to the selected broker/account route
- live order reads are allowed to come from internal snapshots instead of direct broker reads
- paper orders are a first-class internal simulation model, not a broker mirror
- the page may combine broker connections, exchange assets, live quotes, margin checks, live order
  monitoring, and paper execution in one workspace

Phase 0 explicitly freezes these semantics:

- `/orders` monitoring defaults to all active connected accounts
- `brokerKey` on overview reduces the active-account set before aggregation
- `accountId` on overview filters after aggregation at the account group level
- the current details drawer is a row-payload renderer, not a canonical detail fetch
- paper order execution state is driven by internal simulation and persisted back to MySQL

## 4) Current End-To-End Data Flow
1. An authenticated user lands on `/orders`.
2. The frontend mounts `OrdersPage`.
3. The page dispatches broker route dependencies:
   - connections
   - broker accounts
4. The page dispatches:
   - `GET /api/v1/orders/overview`
   - `GET /api/v1/orders/paper`
5. `GET /api/v1/orders/overview` returns live open/history groups across active connected accounts.
6. The frontend flattens grouped overview rows into the table model.
7. `GET /api/v1/orders/paper` runs paper-order simulation first, then returns paper orders from
   MySQL.
8. When the create drawer opens, the page loads or reuses:
   - broker/account route state
   - `GET /api/v1/exchange-assets`
   - `GET /api/v1/wallet/futures/funds`
   - `GET /api/v1/assets/futures/symbol/:symbol` for asset quote if not already cached
9. Creating a live order posts `POST /api/v1/orders/futures/:assetId`.
10. Creating a paper order posts `POST /api/v1/orders/paper/:assetId`, which internally reuses the
    same service path with `execution_mode = paper`.
11. Live create/cancel writes go through the broker adapter.
12. Paper create/cancel writes go to `paper_orders`, and simulation updates may immediately change
    status/payload.
13. The frontend refreshes overview and paper lists after create/cancel.
14. The order details drawer currently opens from the already-loaded row payload rather than
    calling the detail endpoints.

## 5) Frozen Page Truth Model
Phase 0 freezes the meaning of each major `/orders` page surface:

- summary cards
  - frontend-derived counts from already-fetched open/history/paper arrays
  - not authoritative broker metrics
- open tab
  - live snapshot-backed order groups flattened into one grid
- history tab
  - snapshot-backed terminal/closed order groups flattened into one grid
- paper tab
  - DB-backed paper orders with read-time simulation updates
- create drawer
  - route-scoped action surface
  - depends on broker accounts, exchange assets, wallet futures funds, and asset quote lookups
- detail drawer
  - current selected-row payload renderer
  - not guaranteed to refetch canonical latest detail

## 6) Frozen Endpoint Contract
### `GET /api/v1/orders/overview`
Supported query params:

- `brokerKey`
- `accountId`
- `startDate`
- `endDate`

Explicitly unsupported:

- `limit`

Phase 0 response shape:

```json
{
  "success": true,
  "data": {
    "meta": {
      "contractVersion": "orders-phase0-2026-04-09",
      "purpose": "global_execution_console",
      "generatedAt": "2026-04-09T12:00:00.000Z",
      "summary": "Phase 0 freezes `/orders` as a global execution console with snapshot-backed live monitoring, route-scoped order creation, DB-backed paper orders, and row-payload detail rendering.",
      "query": {
        "supported": ["brokerKey", "accountId", "startDate", "endDate"],
        "unsupported": ["limit"],
        "behavior": {
          "defaultScope": "all_active_connected_accounts",
          "brokerKey": "limits_active_accounts_before_aggregation",
          "accountId": "post_aggregation_row_filter",
          "limit": "not_supported_on_orders_overview"
        },
        "resolved": {
          "brokerKey": "mudrex",
          "accountId": "acct-default",
          "startDate": "2026-04-01",
          "endDate": "2026-04-09"
        }
      },
      "sources": {
        "openOrders": "scheduler_orders_snapshots",
        "history": "scheduler_orders_snapshots",
        "paperOrders": "paper_orders",
        "paperSimulation": "paper_orders + market price simulation",
        "createLive": "broker orders adapter",
        "createPaper": "paper_orders",
        "cancelLive": "broker orders adapter with snapshot-assisted idempotency",
        "cancelPaper": "paper_orders"
      },
      "pageTruth": {
        "monitoringScope": "global_active_accounts",
        "creationScope": "selected_broker_route",
        "liveReadModel": "snapshot_backed",
        "paperReadModel": "db_backed_simulated",
        "detailDrawerSource": "row_payload"
      },
      "capabilities": {
        "routeScopedCreate": true,
        "routeScopedMonitoring": false,
        "liveSnapshotFreshnessExposed": false,
        "canonicalDetailFetchUsedByPage": false,
        "paperExecutionScheduler": true
      }
    },
    "openOrders": [],
    "history": []
  }
}
```

Notes:

- `openOrders` and `history` currently return grouped account rows, not a flat row list
- the frontend flattens grouped rows after fetch

### `GET /api/v1/orders/paper`
Supported query params:

- `limit`
- `brokerKey`
- `accountId`
- `startDate`
- `endDate`

Phase 0 semantics:

- runs read-time paper simulation first
- then returns persisted `paper_orders` rows mapped into API shape
- current response remains a plain list because the frontend expects `response.data` to be an array

### `POST /api/v1/orders/futures/:assetId`
Phase 0 semantics:

- validates the order body
- resolves broker/account route
- runs backend pre-trade risk evaluation
- writes through the broker adapter for live orders
- optionally links accepted suggestions back to execution

### `POST /api/v1/orders/paper/:assetId`
Phase 0 semantics:

- forces `execution_mode = paper`
- persists a `paper_orders` row
- runs immediate paper simulation for the created order
- optionally links accepted suggestions back to execution

### `DELETE /api/v1/orders/futures/:orderId`
Phase 0 semantics:

- route-scoped broker cancel
- uses snapshots to treat already-terminal orders as idempotent success when possible

### `DELETE /api/v1/orders/paper/:paperOrderId`
Phase 0 semantics:

- updates the persisted `paper_orders` row to `CANCELLED`
- syncs linked suggested-trade execution if needed

### Detail Endpoints
Available but not used by the current page:

- `GET /api/v1/orders/futures/detail/:orderId`
- `GET /api/v1/orders/paper/:paperOrderId`

## 7) Data Source Map
- live open orders
  - source type: `db_snapshot`
  - source: `scheduler_orders_snapshots.payload_json`
- live history
  - source type: `db_snapshot`
  - source: `scheduler_orders_snapshots.payload_json`
- paper orders
  - source type: `db_record`
  - source: `paper_orders`
- paper execution state
  - source type: `computed_persisted_state`
  - source: simulation payload inside `paper_orders.payload_json`
- create route selection
  - source type: `config/runtime`
  - source: connected broker accounts + selected page route
- margin snapshot in create drawer
  - source type: `live_external`
  - source: `GET /wallet/futures/funds`
- asset quote in create drawer
  - source type: `live_external`
  - source: `GET /assets/futures/symbol/:symbol`
- exchange asset search in create drawer
  - source type: `reference_data`
  - source: `GET /exchange-assets`

## 8) Phase 0 Decisions
### Monitoring Scope
Decision:

- the page remains globally scoped for monitoring
- the selected broker/account route does not implicitly filter the live table

Reason:

- current monitoring fetches intentionally ignore the selected route
- operators can create on one route while monitoring all active accounts

### Paper Model
Decision:

- paper orders remain a first-class internal MySQL model with simulated lifecycle state
- paper orders are not treated as a fake variant of the live snapshot table

### Detail Drawer
Decision:

- keep the current row-payload details model for Phase 1
- do not add detail refetching in Phase 0

Reason:

- Phase 1 should first fix trust/copy/state semantics before expanding request flow complexity

### Scope Guardrails For Phase 1
In scope:

- trust and semantics fixes
- clearer live vs paper separation
- route/filter clarity
- error and stale-state behavior
- market-order contract correctness

Out of scope:

- replacing snapshot-backed live monitoring with direct broker reads
- scheduler architecture changes
- full page decomposition into separate routes/modules

## 9) Current Known Gaps
- the page still presents one blended workspace even though live reads are snapshot-backed and paper
  reads are DB-backed simulated records
- page-level load and error banners auto-hide too quickly for a critical trading surface
- history/paper date filters still affect refresh behavior more broadly than the current UI implies
- the details drawer uses selected row payload instead of canonical detail fetches
- live snapshot freshness is not surfaced in the current UI or API contract beyond the Phase 0 truth
  note
- the market-order path still depends on `order_price` even though the form disables direct input
  for non-limit orders
- summary cards are frontend-derived and can drift from normalized backend semantics

These gaps remain visible on purpose so Phase 1 improves truthfulness instead of hiding ambiguity.

## 10) Verification
Phase 0-specific verification passed with:

- `npm run test:orders-contract`
