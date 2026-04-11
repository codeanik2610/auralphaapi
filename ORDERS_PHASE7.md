# Orders Phase 7

Date: 2026-04-09

## 1) Goal
Phase 7 for `/orders` closes the remaining operator-trust and maintainability debt that was still visible after release gating.

By the end of this phase the orders workspace should:

- make the live broker workspace and the paper simulator feel intentionally different instead of like one blended table surface
- surface recent execution activity inside `/orders` instead of forcing operators to bounce out to `/activity`
- stop treating `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx` as the only place where workspace, ticket, and detail UI can live

## 2) What Changed
### Frontend workspace split
The Orders page in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx`
now hands rendering to focused modules:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrdersWorkspaceSection.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrderCreateDrawer.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrderDetailsDrawer.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/OrdersActivityTrail.jsx`

That split keeps the page-level state and orchestration where it already lived, while moving the bulky surface rendering into clear workspace, ticket, detail, and audit concerns.

### Clearer live vs paper separation
`/orders` now uses an explicit workspace-focus banner and clearer tab labels to distinguish:

- `Live Open`: snapshot-backed active broker book
- `Live History`: snapshot-backed terminal broker history
- `Paper Sim`: DB-backed local simulation

The create drawer copy now also explains that route selection is shared while execution mode still determines whether the order goes to the broker or stays local.

### In-page execution audit trail
The orders workspace now surfaces filtered activity data from `/activity` in two places:

- route-scoped or global execution trail directly on the page
- order-linked activity inside the detail drawer

That work is backed by more consistent order activity logging in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerOrdersFacadeService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PaperOrderExecutionService.ts`

Live and paper mutations now log a stable route target and order reference so the orders page can filter activity reliably.

### Contract metadata
The `/orders/overview` contract now advertises the new Phase 7 truth in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/OrdersOverview.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersOverviewService.ts`

The metadata now states that:

- activity trail rendering is part of the page truth
- live vs paper mode split is intentional
- the page is structured as workspace, ticket, and detail modules

## 3) Phase 7 Outcome
`/orders` is now a more trustworthy operator surface and a less fragile code surface.

The page is still one route, but it no longer behaves like one giant undifferentiated component. Operators can now:

- tell immediately whether they are working with live broker snapshots or paper simulation
- inspect recent execution activity without leaving `/orders`
- open an order and review linked activity in the same drawer as the canonical detail

## 4) What Remains
Phase 7 does not close the last mutation-hardening items.

The remaining `/orders` follow-up is:

- submit idempotency
- normalized broker rejection errors

Those are the right focus for Phase 8.

## 5) Verification
Phase 7 verification passed with:

- `npm run test:orders-contract`
- `npx eslint src/api/contracts/OrdersOverview.ts src/api/services/OrdersOverviewService.ts src/api/services/BrokerOrdersFacadeService.ts src/api/services/PaperOrderExecutionService.ts scripts/test-orders-contract.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Orders/index.jsx src/pages/Orders/trust.js src/pages/Orders/index.test.jsx src/pages/Orders/OrdersActivityTrail.jsx src/pages/Orders/OrdersWorkspaceSection.jsx src/pages/Orders/OrderCreateDrawer.jsx src/pages/Orders/OrderDetailsDrawer.jsx tests/e2e/orders.spec.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Orders/index.test.jsx src/store/slices/ordersSlice.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:e2e -- tests/e2e/orders.spec.js`
