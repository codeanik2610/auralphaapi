# Portfolio Phase 4

Date: 2026-04-10

## 1) Goal
Phase 4 hardens `/portfolio/overview` into an explicit operator contract.

By the end of this phase the portfolio surface should:

- expose generated-at, resolved query inputs, section provenance, and section freshness directly from the backend
- stop forcing the frontend to infer trust state from scattered payload fields
- make unsupported portfolio filters explicit instead of implied
- keep the dedicated `/portfolio` page honest about what is snapshot-backed, what is activity-based, and what is only a loaded overview slice

## 2) What Changed
### Overview contract now publishes trust metadata
`/portfolio/overview` now returns a Phase 4 metadata envelope instead of only source labels.

The main backend files are:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/PortfolioOverview.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioOverviewService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/validators/portfolio.validator.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerWalletFacadeService.ts`

Phase 4 additions:

- `meta.purpose = operator_portfolio_workspace`
- `meta.generatedAt` for request-level timing
- `meta.query.supported[]`, `meta.query.unsupported[]`, and `meta.query.resolved`
- `meta.sources`, `meta.pageTruth`, and `meta.capabilities`
- `meta.sections.*` with per-section source label, availability, observed time, freshness model, freshness state, definition, and note
- `meta.warnings[]` for snapshot staleness and capital-route attention states

### Section freshness is now explicit
The overview contract now differentiates freshness models instead of pretending every number means the same thing:

- stored posture, holdings, and snapshot history use `snapshot_timestamp`
- capital routes use `funds_snapshot_timestamp`
- realized PnL and activity use `windowed_activity`

That means `/portfolio` can now show:

- when the stored book was actually captured
- when capital route snapshots were last seen
- when activity windows last saw a closed-position event
- whether a section is `available`, `partial`, or `missing`

### Active funds now carry route-level snapshot timing
Wallet and futures route rows now preserve:

- `observedAt`
- `error`

That allows the frontend to show trust at the account-route level instead of only total balance numbers.

### Frontend now renders the contract directly
The page in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.jsx`
now surfaces the hardened contract through a dedicated `Contract & trust` section.

Phase 4 UI additions:

- overview-generated timing
- resolved timeframe, holdings slice size, and snapshot page size
- section-by-section provenance rows for posture, holdings, capital routes, realized PnL, activity, and snapshot history
- backend warning detail when stored posture or funds snapshots need attention
- route-level funds snapshot timestamps inside wallet and futures account rows

The supporting frontend files are:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/portfolioSlice.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/styles/app.css`

## 3) Phase 4 Outcome
`/portfolio` no longer needs guesswork to explain its own trust model.

Operators can now read:

- what query the page actually resolved
- which sections are snapshot-backed versus activity-based
- which sections are stale, partial, or missing
- whether holdings search/focus operates only on the loaded overview slice
- when capital route rows were last observed per account

This is the contract baseline Phase 5 needs before we spend time profiling or optimizing the queries behind it.

## 4) Known Carry-Forward For Phase 5
- live-vs-snapshot reconciliation policy is still explicit only as a `false` capability, not an implemented policy engine
- export/report is now explicitly deferred through `meta.capabilities.exportReport = false`
- overview holdings search/focus still operates on the loaded overview slice instead of a server-scoped overview query
- portfolio overview and performance query cost still needs profiling and tuning

## 5) Verification
Phase 4 verification passed with:

- `npm run test:portfolio-phase2`
- `npm run test:portfolio-phase3`
- `npm run test:portfolio-phase4`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/store/slices/portfolioSlice.test.js src/pages/Portfolio/index.test.jsx`
- `npx eslint src/api/contracts/Portfolio.ts src/api/contracts/PortfolioOverview.ts src/api/services/PortfolioService.ts src/api/services/PortfolioOverviewService.ts src/api/services/BrokerWalletFacadeService.ts src/api/validators/portfolio.validator.ts scripts/test-portfolio-phase2.ts scripts/test-portfolio-phase3.ts scripts/test-portfolio-phase4.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Portfolio/index.jsx src/pages/Portfolio/index.test.jsx src/services/tradingApi.js src/store/slices/portfolioSlice.js src/store/slices/portfolioSlice.test.js`
