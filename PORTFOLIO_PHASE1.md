# Portfolio Phase 1

Date: 2026-04-09

## 1) Goal
Phase 1 for `/portfolio` freezes the source-of-truth before any fetch or runtime cleanup work.

By the end of this phase the portfolio surface should:

- stop implying that all portfolio metrics come from one live source
- define the exact source behind stored book posture, live balances, realized PnL, and activity
- make the `daily`, `weekly`, and `monthly` windows explicit and consistent
- remove the misleading "portfolio performance" framing for the closed-position activity chart

## 2) What Changed
### Backend truth model
`/portfolio/summary` and `/portfolio/snapshots` remain snapshot-backed and now say so directly through
the response payload in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/Portfolio.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioService.ts`

Phase 1 now makes these semantics explicit:

- `summary.source = portfolio_snapshots`
- `summary.observedAt` is the timestamp of the latest stored portfolio snapshot
- `snapshots.source = portfolio_snapshots`

### Realized PnL and activity semantics
`/portfolio/pnl` and `/portfolio/performance` now advertise that they are derived from
persisted closed-position scheduler snapshots rather than the portfolio snapshot table.

Phase 1 now makes these semantics explicit:

- `pnl.source = scheduler_positions_snapshots`
- `pnl.measurement = realized_pnl`
- `performance.source = scheduler_positions_snapshots`
- `performance.measurement = realized_pnl`
- `performance.mode = closed-position-activity`

### Timeframe definitions
Portfolio timeframe windows are now frozen as user-timezone windows, not ad hoc UTC offsets or
month-to-date placeholders.

The current definitions are:

- `daily`: today in the user timezone, bucketed by hour
- `weekly`: trailing 7 local days including today, bucketed by day
- `monthly`: trailing 30 local days including today, bucketed by day

For `/portfolio/performance`, the `equity` value per bucket is now taken from the latest stored
portfolio snapshot observed in that bucket while PnL/profit/loss/trades remain closed-position
activity metrics.

### Frontend wording
The dedicated portfolio page in
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.jsx`
now exposes the frozen source model instead of implying one unified live feed.

Phase 1 UI changes:

- the page header now describes snapshot-backed posture plus live capital routes
- a persistent source-of-truth banner explains where each number comes from
- the page now surfaces a stored book snapshot section using snapshot-backed summary fields
- the old "Portfolio performance" section is now labelled "Closed-position activity"
- the realized PnL card uses the explicit window label returned by the backend

## 3) Phase 1 Outcome
`/portfolio` now has an explicit truth model.

Operators can distinguish:

- stored book posture from `portfolio_snapshots`
- live wallet and futures balances from active broker fund lookups
- realized PnL and activity from `scheduler_positions_snapshots`

This gives Phase 2 a stable semantic baseline before we change the request choreography.

## 4) Known Carry-Forward For Phase 2
- the page still performs overlapping fetches for performance and overview on initial load
- the page still does not expose a dedicated holdings or reconciliation workspace
- client and server filter support for portfolio performance and PnL still need cleanup
- overview-level failure handling is still lightweight compared with stronger module runtimes

## 5) Verification
Phase 1 verification passed with:

- `npm run test:portfolio-phase1`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Portfolio/index.test.jsx`
- `npx eslint src/api/contracts/Portfolio.ts src/api/services/PortfolioService.ts src/api/validators/portfolio.validator.ts scripts/test-portfolio-phase1.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/portfolioSlice.js src/pages/Portfolio/index.jsx src/pages/Portfolio/index.test.jsx`
