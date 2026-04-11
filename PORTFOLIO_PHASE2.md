# Portfolio Phase 2

Date: 2026-04-09

## 1) Goal
Phase 2 for `/portfolio` cleans up the runtime choreography now that Phase 1 has already frozen the semantics.

By the end of this phase the portfolio surface should:

- hydrate the page through one primary request path
- stop double-fetching performance on first load and timeframe changes
- preserve the last good overview data when a refresh fails
- align the frontend client contract with the supported backend query inputs

## 2) What Changed
### Single overview hydration path
The dedicated portfolio page in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.jsx`
now boots and refreshes through `fetchPortfolioOverview(...)` only.

Phase 2 removes the overlapping standalone `fetchPortfolioPerformance(...)` request from
page load and timeframe transitions. One request now drives the page refresh cycle:

- `/portfolio/overview`

### Overview-driven runtime state
The portfolio reducer in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/portfolioSlice.js`
now treats overview as the page hydration contract instead of a sidecar response.

Phase 2 runtime behavior:

- first-load overview requests move missing sections into `loading`
- refresh requests keep already-hydrated sections stable while `overviewStatus` reflects refresh-in-flight
- overview failures preserve last good section data where available
- first-load overview failures now mark missing sections as failed instead of silently falling back to empty-looking UI

This means `/portfolio` can distinguish between:

- initial hydration still in progress
- refresh in progress with cached data still on screen
- refresh failure with stale-but-known data still visible
- first-load failure with no trusted section data yet

### Contract cleanup
The overview contract in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/PortfolioOverview.ts`
and
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioOverviewService.ts`
now explicitly describes the Phase 2 runtime model.

`/portfolio/overview` now returns:

- `meta.contractVersion = portfolio-overview-phase2-2026-04-09`
- `meta.primaryPageRoute = /portfolio`
- `meta.primaryEndpoint = /portfolio/overview`
- `meta.pageHydration = single-request`
- `meta.supportedQuery.*` so the runtime contract says which params are actually supported
- `meta.sectionSources.*` so each section source is explicit in the overview contract

`activeFunds` now also advertises:

- `activeFunds.source = broker_wallet_facade`
- `activeFunds.definition = Latest active broker funds lookup per connected account.`

### Frontend client alignment
The frontend API client in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`
no longer advertises unsupported `brokerKey` or `accountId` filters on:

- `getPortfolioPnL(...)`
- `getPortfolioPerformance(...)`

This removes the remaining Phase 1 client/server drift for the dedicated page runtime.

## 3) Phase 2 Outcome
`/portfolio` now refreshes as one coordinated overview workflow instead of a partially overlapping set
of requests.

Operators now get a cleaner runtime model:

- one primary request hydrates the page
- refresh controls reflect one overview fetch cycle
- cached section data survives refresh failures
- supported query inputs are explicit in the overview contract

This gives Phase 3 a cleaner base for the portfolio workspace rewrite.

## 4) Known Carry-Forward For Phase 3
- the dedicated page still needs a real holdings and exposure workspace
- reconciliation rules between stored posture and live broker funds still need to be expressed in the UI
- overview contract metadata is available but not yet surfaced directly in-page
- export/report capability is still undecided

## 5) Verification
Phase 2 verification passed with:

- `npm run test:portfolio-phase2`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/store/slices/portfolioSlice.test.js src/pages/Portfolio/index.test.jsx`
- `npx eslint src/api/contracts/PortfolioOverview.ts src/api/services/PortfolioOverviewService.ts scripts/test-portfolio-phase2.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/portfolioSlice.js src/store/slices/portfolioSlice.test.js src/pages/Portfolio/index.jsx src/pages/Portfolio/index.test.jsx src/services/tradingApi.js`
