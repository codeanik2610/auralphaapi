# Orders Phase 1

Phase 1 for `/orders` hardens trust semantics so Phase 2 can focus on broader UX structure instead of correctness cleanup.

## Completed

- Market orders no longer submit the placeholder `order_price` from the disabled form field. The frontend now resolves a live reference price from the selected asset quote, blocks submission when no valid quote exists, and validates stop-loss / take-profit against that resolved market reference.
- Critical `/orders` page errors now stay visible until the operator clears them instead of auto-dismissing after a few seconds.
- `/orders/overview` now treats `startDate` and `endDate` as history / paper filters only. The open order book no longer inherits the hidden history date window.
- The `/orders` control-plane copy now tells the operator that the Open view always reflects the current active book while History and Paper use the date window.

## Backend

- [src/api/contracts/OrdersOverview.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/OrdersOverview.ts)
- [src/api/services/OrdersOverviewService.ts](/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OrdersOverviewService.ts)
- [scripts/test-orders-contract.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-orders-contract.ts)

## Frontend

- [index.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx)
- [trust.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/trust.js)
- [OrderTicketForm.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/forms/OrderTicketForm.jsx)
- [index.test.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.test.jsx)

## Verification

- `npm run test:orders-contract`
- `npx eslint src/api/contracts/OrdersOverview.ts src/api/services/OrdersOverviewService.ts scripts/test-orders-contract.ts`
- `npm run test:ui -- src/pages/Orders/index.test.jsx`
- `npx eslint src/pages/Orders/index.jsx src/pages/Orders/trust.js src/components/forms/OrderTicketForm.jsx src/pages/Orders/index.test.jsx`

## Phase 2 Start Point

Phase 2 can now focus on clarifying the UX model of `/orders`: making route-scoped monitoring explicit, improving detail affordances, and separating page loading from create / cancel action loading.

## Known Unrelated Repo Blockers

- Backend repo-wide `npm run type-check` is still failing because of existing issues outside `/orders`, including [signals-user-schedulers-shared.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signals-user-schedulers-shared.ts) and [test-risk-center-phase1.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase1.ts).
