# Portfolio Phase 3

Date: 2026-04-09

## 1) Goal
Phase 3 turns `/portfolio` from a capital monitor into a real book workspace.

By the end of this phase the portfolio surface should:

- expose the ranked holdings book directly on `/portfolio`
- make stored posture, holdings, live capital routes, and realized activity readable as separate layers
- let an operator inspect one holding at a time without leaving the page
- exceed the old dashboard exposure snapshot in usefulness

## 2) What Changed
### Holdings now arrive through overview
`/portfolio/overview` now includes the latest holdings slice from the same stored portfolio snapshot as
the summary.

The relevant contract and service changes are in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Portfolio.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/PortfolioOverview.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioOverviewService.ts`

Phase 3 additions:

- `holdings.source = portfolio_snapshots`
- `holdings.observedAt` identifies the latest stored holdings snapshot timestamp
- `holdings.definition` explains that the workspace is ranked by market value
- `/portfolio/overview` now supports `holdingsLimit`
- overview metadata now includes `sectionSources.holdings`

### Dedicated holdings workspace
The page in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.jsx`
now has a dedicated holdings workspace instead of only summary cards and charting.

Phase 3 UI additions:

- a stored `Book posture` summary section
- a `Holdings workspace` table driven directly by overview data
- local search and focus filters for `All Book`, `Watch`, `Long`, and `Short`
- row selection with a `Selected holding` detail card
- an `Exposure mix` module that summarizes side balance, top sleeve, largest weight, and watch counts
- a separate `Capital routes` section so live broker balances are no longer visually mixed with stored posture

### Operator readability
The dedicated page is now more informative than the dashboard exposure card because it combines:

- stored summary
- ranked holdings
- selected holding detail
- exposure mix
- live capital route detail
- realized activity chart
- stored snapshot history

## 3) Phase 3 Outcome
`/portfolio` is now a proper portfolio workspace.

Operators can now:

- inspect the current stored book without leaving the page
- filter and search the loaded holdings set
- review one holding’s allocation, risk state, contribution, and rebalance timestamp
- compare stored posture against live wallet and futures routes on the same screen

This gives Phase 4 a stronger base for contract hardening and provenance cleanup.

## 4) Known Carry-Forward For Phase 4
- holdings freshness and summary freshness still rely on snapshot timestamps rather than a richer provenance model
- overview metadata is present, but the page does not yet render every supported query and section capability directly
- holdings search and focus are client-side over the loaded overview slice, not a hardened server-side contract
- reconciliation rules between live balances and stored posture are still descriptive rather than explicit policy rules

## 5) Verification
Phase 3 verification passed with:

- `npm run test:portfolio-phase3`
- `npm run test:portfolio-phase2`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/store/slices/portfolioSlice.test.js src/pages/Portfolio/index.test.jsx`
- `npx eslint src/api/contracts/Portfolio.ts src/api/contracts/PortfolioOverview.ts src/api/controllers/PortfolioOverviewController.ts src/api/services/PortfolioService.ts src/api/services/PortfolioOverviewService.ts src/database/repositories/PortfolioRepository.ts scripts/test-portfolio-phase2.ts scripts/test-portfolio-phase3.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Portfolio/index.jsx src/pages/Portfolio/index.test.jsx src/services/tradingApi.js src/store/slices/portfolioSlice.js src/store/slices/portfolioSlice.test.js src/styles/app.css`
