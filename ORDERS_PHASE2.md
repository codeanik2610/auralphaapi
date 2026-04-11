# Orders Phase 2

Phase 2 for `/orders` clarifies the page model without changing the backend contract.

## Completed

- Monitoring scope is now explicit on the page. Operators can see whether the table is showing `All connected accounts` or `Current route`.
- Route selectors are now visible on the page instead of being hidden inside the create drawer. The selected route still drives order creation, and `Current route` monitoring now reuses that same route.
- The page now keeps monitoring refresh state separate from create-route availability. Refreshing live/paper data no longer disables the `Create Order` entry point when the route is already available.
- The orders grid now exposes a visible `View` action for opening the details drawer, while preserving double-click as a secondary shortcut.

## Frontend

- [index.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx)
- [trust.js](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/trust.js)
- [index.test.jsx](/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.test.jsx)

## Backend / API

- No backend or DB schema changes were required in this phase.
- Phase 2 reuses the existing `brokerKey` / `accountId` query support already exposed by `/api/v1/orders/overview` and `/api/v1/orders/paper`.

## Verification

- `npx eslint src/pages/Orders/index.jsx src/pages/Orders/trust.js src/pages/Orders/index.test.jsx src/components/forms/OrderTicketForm.jsx`
- `./node_modules/.bin/vitest run src/pages/Orders/index.test.jsx --reporter=verbose`

## Phase 3 Start Point

Phase 3 can now focus on strengthening the data shape: replace weak overview row contracts with typed order summaries, expose snapshot freshness and source metadata, and make the live/paper read models easier to trust programmatically.

## Known Unrelated Repo Blockers

- Backend repo-wide `npm run type-check` is still failing because of existing issues outside `/orders`, including [signals-user-schedulers-shared.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signals-user-schedulers-shared.ts) and [test-risk-center-phase1.ts](/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-risk-center-phase1.ts).
