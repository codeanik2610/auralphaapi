# Overview Phase 1

Date: 2026-04-09

## 1) Goal
Phase 1 for `/overview` focuses on truthfulness first.

The page should stop implying that every number is live, stop using the wrong source for key KPIs,
and make it obvious when the operator is looking at:

- live external reference data
- latest DB-backed snapshots
- backend-computed summaries

## 2) What Changed
### Backend contract
`GET /api/v1/overview` now returns richer section metadata in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Overview.ts` and
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OverviewService.ts`.

Each section now includes:

- `sourceType`
- `sourceLabel`
- `availability`
- `observedAt`
- existing Phase 0 provenance fields

Additional trust changes:

- `health.status` now resolves to `assembled` instead of a generic `ok`
- `health.summary` explicitly says this is request-level overview status, not platform health
- wallet/futures sections now expose real snapshot timestamps from `funds_snapshots.computed_at`
- portfolio sections now expose real snapshot timestamps from `portfolio_snapshots.created_at`
- live request-scoped sections use the overview request assembly time when they are available

### Frontend behavior
The dashboard page in `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.jsx`
and hero in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/components/dashboard/OverviewHero.jsx`
now consume the new metadata.

Phase 1 UI changes:

- page copy no longer claims "live risk" as the main promise
- hero now shows `Overview status` instead of `System health`
- hero and section cards now use truthful badges:
  - `Live feed`
  - `Snapshot`
  - `Summary`
  - `Missing`
- section cards now show observed timestamps when the backend can prove them
- a warning banner appears when snapshot-backed overview sections are missing
- watchlist action banners were removed from `/overview` because they do not belong to the
  overview contract

### KPI semantics
The KPI band is now more honest:

- `Daily PnL` uses `portfolioSummary.dayPnL`
- `Free Margin` remains snapshot-backed wallet data and is hidden when the wallet snapshot is
  missing
- `Running Bots` uses the automation count rather than `connectedAccounts`
- `High Alerts` now describes the alert digest instead of generic urgency copy

## 3) Phase 1 Outcome
`/overview` is still an operator command center, but it is now much clearer about what is request
scope, what is snapshot scope, and what is aggregated summary scope.

The page is still not the final interaction model. It is now a more trustworthy read surface for
Phase 2 work.

## 4) Known Carry-Forward For Phase 2
- selected market detail is still backend-resolved unless the caller passes `selectedSymbol`
- market table clicks still route to `/markets` instead of updating the local detail pane
- overview still relies on a single backend fan-out `Promise.all`
- computed digests use best-effort observed timestamps rather than dedicated per-section freshness
  pipelines
- repo-wide backend `npm run type-check` is still blocked by the unrelated stale discovery
  scheduler references in `scripts/test-services.ts`

## 5) Verification
Phase 1 verification passed with:

- `npm run test:overview-contract`
- `npx eslint src/api/contracts/Overview.ts src/api/controllers/OverviewController.ts src/api/services/OverviewService.ts scripts/test-overview-contract.ts`
- `npm run test:ui -- src/pages/Dashboard/index.test.jsx`
- `npx eslint src/pages/Dashboard/index.jsx src/pages/Dashboard/index.test.jsx src/components/dashboard/OverviewHero.jsx src/store/slices/overviewSlice.js`
