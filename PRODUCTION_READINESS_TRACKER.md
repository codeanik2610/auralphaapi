# aurAlpha Production Readiness Tracker

Last updated: 2026-04-10

This tracker covers the full product path across:

- Frontend: `/Users/apple/Documents/Project/Frontend/aurAlphaApp`
- Main API: `/Users/apple/Documents/Project/Backend/aurAlpha`
- Scheduler worker: `/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker`
- Discovery service: `/Users/apple/Documents/Project/Backend/discovery-engine`

## Status Legend

- `Done`: production-ready enough for current scope
- `Partial`: functional but not release-complete
- `Missing`: major work still needed
- `Blocker`: should be fixed or removed before release

## Priority Legend

- `P0`: release blocker
- `P1`: should finish before broad rollout
- `P2`: important polish/stability after launch candidate

## How To Use This Tracker

1. Close all `P0` global gates first.
2. Then close all `P0` items on pages in the order listed under **Release Waves**.
3. Do not call the product production-ready until:
   - all global `P0` items are complete
   - all page `Status` values are at least `Partial` with no `P0` pending items
   - the release smoke tests pass
4. Once the currently validated strategy/ops phases are green, run
   `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-foundation.ts`
   via `npm run release-gate:foundation` before treating that area as low-touch.

## Release Waves

### Wave 1: Product Gates

- [ ] Typed frontend/backend contracts
- [ ] Route-level authz matrix
- [ ] End-to-end smoke coverage for core journeys
- [ ] Backup/restore runbooks for MySQL + Postgres + discovery-engine Postgres
- [ ] Index/performance review for high-volume list pages
- [ ] Production dashboards and alerting for API, worker, discovery-engine

### Wave 2: Revenue / Trade-Critical Surfaces

- [ ] `/login`
- [ ] `/orders`
- [ ] `/positions`
- [x] `/portfolio`
- [x] `/risk-center`
- [ ] `/signals`
- [ ] `/suggested-trades`

### Wave 3: Strategy Lifecycle

- [ ] `/strategy-template`
- [ ] `/strategy-lab`
- [ ] `/strategy-library`
- [ ] `/backtests`
- [ ] `/automations`

### Wave 4: Discovery & Scheduler Ops

- [ ] `/discovery`
- [ ] `/schedulers`
- [ ] `/email-deliveries`

### Wave 5: Admin / Platform Polish

- [ ] `/markets`
- [ ] `/watchlists`
- [ ] `/alerts`
- [ ] `/activity`
- [ ] `/brokers-data`
- [ ] `/broker-definitions`
- [ ] `/settings`
- [ ] delete/archive legacy `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/SchedulerOps/index.jsx`

## Global Gates

### 1. Typed Contract Layer

Status: `Missing`  
Priority: `P0`

Current state:

- Frontend request layer is handwritten JS in `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`
- Redux slices and pages rely on implicit response shapes

Finish checklist:

- [ ] generate or share API request/response types from backend contracts
- [ ] convert trading API layer to typed responses
- [ ] remove stringly-typed page assumptions on nested response fields
- [ ] add schema validation on critical async payloads

### 2. Authorization Matrix

Status: `Missing`  
Priority: `P0`

Current state:

- Auth exists, but route-by-route capability review is not formalized

Finish checklist:

- [ ] define roles/capabilities for every route and destructive action
- [ ] enforce route-level UI visibility
- [ ] enforce backend controller/service authorization
- [ ] audit admin-only surfaces:
  - `/brokers-data`
  - `/broker-definitions`
  - `/schedulers`
  - `/email-deliveries`
  - `/settings`

### 3. End-To-End Smoke Coverage

Status: `Partial`  
Priority: `P0`

Current state:

- focused unit/integration coverage exists
- full browser-level production journeys are not yet complete
- cross-module Playwright coverage now exists at
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/business-flows.spec.js`
  for:
  - settings -> alerts -> email deliveries
  - broker definitions -> brokers-data
  - strategy template -> strategy-library -> backtests -> automations -> activity
- cross-surface freeze gate now exists at
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-foundation.ts`
  and produced a local `decision: ready` artifact at
  `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/foundation-release-gate.json`
  on April 6, 2026 with backend suites, focused ops UI gates, and the cross-module Playwright flow

Required smoke flows:

- [ ] login and session refresh
- [ ] create order / paper order path
- [ ] strategy template -> strategy lab -> backtest -> automation
- [ ] discovery run -> suggestion import
- [ ] scheduler run -> recovery -> detail view
- [ ] email retry / cleanup

### 4. Observability

Status: `Partial`  
Priority: `P0`

Finish checklist:

- [ ] correlation ids across UI -> API -> worker -> discovery-engine
- [ ] structured logs for all async jobs
- [ ] metrics:
  - queue lag
  - worker heartbeat
  - discovery run durations
  - scheduler callback vs reconciliation ratio
  - automation run failures
  - email worker lag
- [ ] dashboards and paging alerts

### 5. Backup / Restore / Migration Discipline

Status: `Missing`  
Priority: `P0`

Finish checklist:

- [ ] MySQL backup and restore drill
- [ ] strategy Postgres backup and restore drill
- [ ] discovery-engine Postgres backup and restore drill
- [ ] migration ordering document for all three storage contexts
- [ ] rollback playbook for bad migrations

### 6. Performance And Index Review

Status: `Missing`  
Priority: `P1`

Focus tables:

- `activity_logs`
- `alerts`
- `email_deliveries`
- `scheduler_run_logs`
- `automations_runs`
- `backtests`
- `strategy_templates`
- discovery `runs`
- discovery `strategies`
- discovery `template_suggestions`

Finish checklist:

- [ ] capture slow query traces
- [ ] add/verify composite indexes for list filters
- [ ] add pagination hard limits
- [ ] verify export endpoints do not block primary request path

## Page Matrix

### `/login`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Login/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/AuthController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AuthService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/User.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/RefreshToken.ts`
- Tests:
  - missing page test
- Pending:
  - [ ] add page test
  - [ ] verify refresh-token rotation and logout invalidation
  - [ ] improve session-expiry UX
  - [ ] add rate-limit and brute-force error handling
  - [ ] define forgot/reset-password path or explicitly defer it

### `/overview`

- Status: `Ready`
- Priority: `P1`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/OverviewController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/OverviewService.ts`
- DB:
  - aggregated reads from MySQL operational tables
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Dashboard/index.test.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/overviewSlice.test.js`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/overview.spec.js`
- Recent progress:
  - [x] Phase 0 baseline now freezes `/overview` purpose, supported query inputs, and section limits
  - [x] `/overview` now returns contract metadata describing section provenance and current UI coverage
  - [x] overview metric/data-source mapping is documented in `OVERVIEW_PHASE0.md`
  - [x] Phase 1 now distinguishes live feed vs snapshot vs summary data on the page
  - [x] `/overview` KPI semantics now use portfolio snapshot PnL instead of wallet delta math
  - [x] `/overview` now exposes section timestamps/availability and warns on partial snapshot coverage
  - [x] Phase 2 makes market focus user-driven from the overview page instead of routing straight to `/markets`
  - [x] `/overview` can now pin a focused symbol locally for return visits
  - [x] `signalsSummary` and `portfolioSummary` are now rendered visibly instead of staying hidden in payload state
  - [x] Phase 3 adds per-section request status, fetch mode, and degradation detail to the overview contract
  - [x] `/overview` now survives partial dependency failure instead of failing as one brittle fan-out request
  - [x] live overview reference lookups are now timeout-bounded and surfaced as degraded UI state
  - [x] Phase 4 now classifies overview snapshot freshness as fresh vs stale vs critical
  - [x] `/overview` now surfaces automation health diagnostics directly on the page
  - [x] overview responses now expose request observability plus live-reference cache fallback metadata
  - [x] Phase 5 moves `/overview` to grouped section refresh state instead of one opaque page request state
  - [x] `/overview` now keeps the last successful data visible during targeted refreshes and failures
  - [x] live overview sections now poll in the background after the first successful load
  - [x] focused market selection now updates the local detail pane immediately while live detail refreshes
  - [x] Phase 6 adds `check:overview-health`, `release-gate:overview`, and `signoff:overview`
  - [x] `/overview` now has browser-level operator journey coverage for refresh and workspace handoffs
  - [x] overview release readiness is documented in `OVERVIEW_PHASE6.md`

### `/markets`

- Status: `Partial`
- Priority: `P1`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/MarketsOverviewController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/MarketController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/ExchangeAssetsController.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Asset.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/ExchangeAsset.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/MarketPriceBinance.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/MarketSymbolSnapshot.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.test.jsx`
- Recent progress:
  - [x] screener search, sort, order, page, page size, and filter state are now URL-backed
  - [x] `/markets` now hydrates shareable screener URLs on load instead of clearing them
  - [x] focused Markets URL-state coverage is in place in the page test suite
  - [x] screener responses now expose overview cache/build provenance
  - [x] selected market cards now show explicit live-vs-snapshot-vs-broker-price provenance
  - [x] chart and routed broker checks now surface freshness and comparison context
  - [x] Markets now carries symbol + interval context into Watchlists and Signals handoffs
  - [x] snapshot overview search now prefers exact/prefix symbol matches and explicitly gates unsupported fast-path sorts
  - [x] service smoke now covers stale snapshot provenance and symbol-detail live enrichment
  - [x] business-flow Playwright coverage now exercises Markets -> Watchlists -> Signals/Alerts handoffs through the shared release gate
- Pending:
  - [ ] sync selected symbol/timeframe into URL outside the current cross-page handoff path
  - [ ] harden chart request cancellation/race handling
  - [ ] add symbol/timeframe/filter index review
  - [ ] split the page into overview/chart/watchlist modules

### `/watchlists`

- Status: `Partial`
- Priority: `P1`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Watchlists/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/WatchlistsController.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Watchlist.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/WatchlistItem.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Watchlists/index.test.jsx`
- Recent progress:
  - [x] manual-only watchlist creation is aligned across UI and API
  - [x] watchlist metadata edit flow and item pagination are wired into `/watchlists`
  - [x] DB-level owner-scoped watchlist-name uniqueness is enforced
  - [x] DB-level one-symbol-per-watchlist integrity is enforced
  - [x] DB-level owner-consistent `watchlist_items -> watchlists` integrity is enforced
  - [x] Watchlists now opens Markets, Signals, and Alerts queue with preserved symbol context
  - [x] watchlist list/detail metadata now uses relation counts instead of loading full item relations
  - [x] `/watchlists` now only applies local symbol filtering while the debounced server query is still catching up
  - [x] service smoke now covers duplicate add/no-op handling for watchlist item race scenarios
  - [x] business-flow Playwright coverage now exercises Markets add -> Watchlists -> Markets/Signals/Alerts routing end to end
- Pending:
  - [ ] add import/export support or explicitly defer
  - [ ] tighten the remaining full-page Watchlists UI suite behavior in CI/local runs

### `/signals`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Signals/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/SignalsController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/SignalsOverviewController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/SignalsService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Signal.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/SignalAction.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/SignalAlertLink.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Signals/index.test.jsx`
- Pending:
  - [ ] verify promote idempotency
  - [ ] surface lineage to suggested trades and automations more directly
  - [ ] tie freshness indicator to scheduler health truth
  - [ ] audit signal action logging

### `/suggested-trades`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/SuggestedTrades/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/SuggestedTradesController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/SuggestedTradesService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/SuggestedTrade.ts`
- Tests:
  - missing page test
- Pending:
  - [ ] add page test
  - [ ] define lifecycle transitions clearly
  - [ ] expose lineage back to signal/automation
  - [ ] define archive/retention/export behavior

### `/orders`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/OrdersController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/OrdersOverviewController.ts`
  - broker funds/asset endpoints
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/PaperOrder.ts`
  - broker integration state
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.test.jsx`
- Recent progress:
  - [x] Phase 0 baseline now freezes `/orders` as a global execution console with route-scoped create/cancel and global monitoring
  - [x] `/orders/overview` now returns contract metadata describing query semantics, snapshot-backed live reads, paper-order storage, and current page capabilities
  - [x] ownership boundaries, endpoint semantics, and Phase 1 start gates are documented in `ORDERS_PHASE0.md`
  - [x] backend contract coverage now locks the Phase 0 orders baseline via `npm run test:orders-contract`
  - [x] Phase 1 now prevents market orders from submitting placeholder prices and validates SL/TP against a resolved live reference price
  - [x] critical `/orders` load and action failures now remain visible until the operator clears them
  - [x] `/orders/overview` now ignores history date windows for the open order book, and the frontend copy explains that date filters apply only to History and Paper
  - [x] Phase 1 handoff and verification are documented in `ORDERS_PHASE1.md`
  - [x] Phase 2 now exposes monitoring scope on the page, with explicit `All accounts` vs `Current route` behavior
  - [x] route selectors are now visible on the page and reused for both create routing and current-route monitoring
  - [x] the orders grid now exposes a visible `View` action for opening the detail drawer instead of relying only on row double-click
  - [x] Phase 2 handoff and verification are documented in `ORDERS_PHASE2.md`
  - [x] `/orders/overview` now returns typed live-order sections with normalized rows instead of relying on frontend flattening
  - [x] live overview rows now expose route metadata plus snapshot `first_seen_at` / `last_seen_at` timing from `scheduler_orders_snapshots`
  - [x] the frontend orders slice now stores overview section metadata and keeps a compatibility bridge for older grouped payloads
  - [x] Phase 3 handoff and verification are documented in `ORDERS_PHASE3.md`
  - [x] live and paper order details now refresh canonical detail on drawer open instead of trusting only the selected row payload
  - [x] `/orders` now surfaces source honesty for live snapshot-backed views versus paper simulation views
  - [x] live create/cancel actions now surface snapshot lag until the monitoring view catches up
  - [x] Phase 4 handoff and verification are documented in `ORDERS_PHASE4.md`
  - [x] paper-order responses now expose lifecycle metadata derived from persisted simulation state
  - [x] paper create/cancel now reconcile locally in the frontend orders slice instead of always waiting for a full list refetch
  - [x] live write follow-up now uses targeted snapshot polling and avoids reloading unrelated paper data
  - [x] `/orders/overview` metadata now matches the current page truth for canonical detail fetches and write/read consistency
  - [x] Phase 5 handoff and verification are documented in `ORDERS_PHASE5.md`
  - [x] Phase 6 adds `check:orders-health`, `release-gate:orders`, and `signoff:orders`
  - [x] browser-level `/orders` write-flow coverage now verifies live create, live cancel acknowledgment, and paper cancel reconciliation
  - [x] orders sign-off now has an artifact workflow for dashboards, write/read consistency, snapshot-lag guidance, and operator-flow verification
  - [x] Phase 6 handoff and verification are documented in `ORDERS_PHASE6.md`
  - [x] Phase 7 splits the Orders UI into workspace, ticket, detail, and activity modules instead of one oversized page component
  - [x] `/orders` now makes the live broker workspace and paper simulator visually explicit with dedicated workspace focus copy
  - [x] `/orders` now surfaces filtered execution activity in-page for both the current route workspace and the selected order detail drawer
  - [x] live and paper order mutations now log consistent route/order identifiers so the activity trail can filter reliably
  - [x] Phase 7 handoff and verification are documented in `ORDERS_PHASE7.md`
  - [x] create-order submissions now use a server-backed idempotency ledger so duplicate retries replay safely instead of placing duplicate orders
  - [x] broker create-order failures now return stable API error codes with operator-facing normalized messages
  - [x] frontend `/orders` now sends ticket-scoped `idempotency_key` values and preserves backend error `code` metadata through `http.js` and `ordersSlice`
  - [x] Phase 8 handoff and verification are documented in `ORDERS_PHASE8.md`

### `/positions`

- Status: `Ready`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/PositionsController.ts`
- DB:
  - broker-sourced state plus risk/portfolio context
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.test.jsx`
- Recent progress:
  - [x] Phase 1 normalized the live and history contract so the frontend no longer has to repair broker-shaped payloads
  - [x] Phase 2 reframed `/positions` around live desk intent versus archive intent
  - [x] Phase 3 completed the action workspace for margin, protection orders, reverse, and close flows
  - [x] Phase 4 introduced the `position_read_models` read path for normalized live and archive reads
  - [x] Phase 5 added lifecycle connectivity for related orders, alerts, suggested trades, and recent activity
  - [x] Phase 6 added snapshot freshness truth for live desk, account route trust, and lifecycle trust messaging
  - [x] Phase 7 adds `check:positions-health` and `release-gate:positions`
  - [x] Phase 7 extracts positions trust messaging into `src/pages/Positions/trust.js`
  - [x] stale-position handling is now explicitly surfaced through backend freshness state plus frontend trust banners
  - [x] source-of-truth for positions PnL and liquidation context is documented in `POSITIONS_PHASE7.md`
  - [x] Phase 7 handoff and verification are documented in `POSITIONS_PHASE7.md`
  - [x] Phase 8 hardens action audit logging for margin, protection, reverse, close, and partial-close flows
  - [x] Phase 8 makes the positions workspace shareable through URL-persisted tab, filters, selection, and drawer state
  - [x] Phase 8 adds `test:positions-phase8` and `signoff:positions`
  - [x] Phase 8 handoff and verification are documented in `POSITIONS_PHASE8.md`
- Pending:
  - [ ] run live health verification with `POSITIONS_RUN_LIVE_CHECKS=true` in the target environment
  - [ ] capture final signoff evidence through `npm run signoff:positions`

### `/portfolio`

- Status: `Ready`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/PortfolioController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/PortfolioOverviewController.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/PortfolioHolding.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/PortfolioSnapshot.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/RiskSnapshot.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Portfolio/index.test.jsx`
- Recent progress:
  - [x] Phase 1 freezes the portfolio source-of-truth in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_PHASE1.md`
  - [x] `/portfolio/summary` and `/portfolio/snapshots` now explicitly identify `portfolio_snapshots` as the stored book source
  - [x] `/portfolio/pnl` and `/portfolio/performance` now identify `scheduler_positions_snapshots` as the realized activity source
  - [x] `daily`, `weekly`, and `monthly` now map to user-timezone `today`, trailing 7 days, and trailing 30 days
  - [x] the dedicated `/portfolio` page now frames the chart as closed-position activity and surfaces the stored snapshot summary separately
  - [x] focused backend Phase 1 verification now runs through `npm run test:portfolio-phase1`
  - [x] Phase 2 makes `/portfolio/overview` the primary page hydration contract in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_PHASE2.md`
  - [x] the `/portfolio` page no longer double-fetches performance on first load or timeframe changes
  - [x] overview loading and failure now drive the page runtime while preserving last good section data on refresh
  - [x] `/portfolio/overview` now returns explicit contract metadata for supported query inputs and section sources
  - [x] focused backend Phase 2 verification now runs through `npm run test:portfolio-phase2`
  - [x] Phase 3 expands `/portfolio/overview` with holdings workspace data in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_PHASE3.md`
  - [x] the dedicated `/portfolio` page now includes a ranked holdings workspace, selected holding detail, and exposure mix panel
  - [x] stored posture, holdings, live capital routes, and realized activity are now visually split into operator-friendly modules
  - [x] focused backend Phase 3 verification now runs through `npm run test:portfolio-phase3`
  - [x] Phase 4 hardens `/portfolio/overview` with resolved query metadata, section provenance, section freshness, and warning state in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_PHASE4.md`
  - [x] the dedicated `/portfolio` page now renders a `Contract & trust` workspace instead of relying on hardcoded source copy
  - [x] wallet and futures capital routes now expose route-level funds snapshot timestamps and missing-snapshot attention cues
  - [x] unsupported `brokerKey` and `accountId` overview filters are now explicit through the Phase 4 contract metadata
  - [x] holdings slice behavior is now explicit as loaded-overview client-side search/focus instead of implied server filtering
  - [x] focused backend Phase 4 verification now runs through `npm run test:portfolio-phase4`
  - [x] Phase 5 tunes `/portfolio` query cost in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_PHASE5.md`
  - [x] closed-position portfolio activity now prefers `position_read_models` with safe fallback to scheduler snapshots
  - [x] latest snapshot lookups for holdings no longer load joined holdings before the holdings query runs
  - [x] portfolio snapshot, holdings, and position read-model indexes now back the portfolio hot path
  - [x] focused backend Phase 5 verification now runs through `npm run test:portfolio-phase5`
  - [x] live environment portfolio latency checks now have `npm run check:portfolio-health`
  - [x] Phase 6 completes the manual action/reporting workflow in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_PHASE6.md`
  - [x] `/portfolio/rebalance-review` now derives manual operator actions from the current shareable workspace state instead of returning a placeholder summary
  - [x] `/portfolio/workspace-report` now generates markdown or JSON exports from the same workspace state used for manual review
  - [x] the `/portfolio` page now persists timeframe, holdings focus, holdings search, and selected holding in the URL
  - [x] the dedicated `/portfolio` page now exposes an `Action & reporting` module with review generation, report generation, preview, and download
  - [x] focused backend Phase 6 verification now runs through `npm run test:portfolio-phase6`
  - [x] Phase 7 adds the portfolio release gate and final signoff workflow in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_PHASE7.md`
  - [x] `npm run check:portfolio-health` now asserts Phase 6 workflow capabilities and reconciliation metadata instead of only Phase 5 latency posture
  - [x] `npm run release-gate:portfolio` now runs the backend portfolio suites, portfolio lint checks, frontend UI tests, frontend build, and optional live health checks
  - [x] `npm run signoff:portfolio` now consumes the release-gate artifact and enforces explicit verification for manual review, report export, shareable state, and the reconciliation runbook
  - [x] the manual reconciliation procedure is now documented in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_RECONCILIATION_RUNBOOK.md`
  - [x] focused backend Phase 7 verification now runs through `npm run test:portfolio-phase7`
  - [x] Phase 8 adds the portfolio live-proof workflow in `/Users/apple/Documents/Project/Backend/aurAlpha/PORTFOLIO_PHASE8.md`
  - [x] `npm run proof:portfolio-live` now runs the portfolio release gate with live health enabled and then captures the final signoff artifact into one proof record
  - [x] the repo-level operational audit now treats the portfolio release workflow scripts as required package markers
  - [x] focused backend Phase 8 verification now runs through `npm run test:portfolio-phase8`
- Pending:
  - [ ] run `npm run proof:portfolio-live` against the target environment with real credentials, live health access, and final approver evidence

### `/risk-center`

- Status: `Ready`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/RiskController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/RiskOverviewController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/RiskAlertsOverviewController.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/RiskPolicy.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/RiskPolicyVersion.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/RiskSnapshot.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.test.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/risk-center.spec.js`
- Recent progress:
  - [x] Phase 0 baseline now freezes `/risk-center` purpose, policy precedence, policy-mode semantics, and deferred capability boundaries
  - [x] `/risk/overview` now returns contract metadata describing supported query inputs, section provenance, and current capability flags
  - [x] `/risk/alerts/overview` now returns contract metadata describing supported alert-summary filters and data sources
  - [x] risk-center ownership, source mapping, and Phase 1 start gates are documented in `RISK_CENTER_PHASE0.md`
  - [x] backend contract coverage now locks the Phase 0 overview, alerts-overview, and policy-validation baseline via `npm run test:risk-center-contract`
  - [x] Phase 1 backend correctness baseline is documented in `RISK_CENTER_PHASE1.md`
  - [x] backend policy writes now reject duplicate user-default and broker-target policies before persistence
  - [x] pre-trade enforcement now resolves broker policy precedence over user-default policy
  - [x] DB integrity migration `1770600000000-HardenRiskPolicyTargetIntegrity.ts` now enforces one normalized policy target per owner after data checks pass
  - [x] focused backend verification now covers duplicate conflicts and effective-policy selection via `npm run test:risk-center-phase1`
  - [x] Phase 2 truthfulness baseline is documented in `RISK_CENTER_PHASE2.md`
  - [x] `/risk/overview` now returns explicit `riskWindows[]` and `brokers.items[]` truth models, including availability, observed times, and source labels
  - [x] broker coverage now uses persisted funds and positions snapshots instead of frontend-only placeholder KPIs
  - [x] weekly/monthly loss windows are now explicitly marked unavailable instead of rendering implied values
  - [x] frontend overview loading and error states now follow `overviewStatus` and `overviewError`
  - [x] focused Phase 2 verification now covers the backend contract plus frontend `/risk-center` lint and UI test paths
  - [x] Phase 3 UX baseline is documented in `RISK_CENTER_PHASE3.md`
  - [x] `/risk-center` no longer performs a redundant alerts-overview fetch during page boot and refresh
  - [x] the page now differentiates first load from refresh and exposes an explicit retry fallback when no overview payload is available
  - [x] freshness and source cues are now surfaced in the operator header, risk-window detail, broker coverage, and alert empty states
  - [x] the policy drawer now traps focus, supports `Escape`, restores focus, and labels form fields accessibly
  - [x] shared `DataTable` rows now support keyboard activation and shared `StatusBanner` danger states now use stronger alert semantics
  - [x] Phase 4 lifecycle baseline is documented in `RISK_CENTER_PHASE4.md`
  - [x] `/risk/policies/:policyId/versions` now exposes structured policy lifecycle history, including summaries, changed fields, approval metadata, and activity links
  - [x] `/risk/policies/:policyId/rollback` now restores a prior persisted policy snapshot and records a new rollback version entry
  - [x] `/risk/overview` now truthfully advertises rollback support via `policyRollback: true` in the Phase 4 contract metadata
  - [x] `/risk-center` now exposes policy history, rollback targets, and direct policy/enforcement activity links from the selected rule workflow
  - [x] focused lifecycle verification now covers backend rollback/history behavior plus frontend `/risk-center` history UX paths
  - [x] Phase 5 release-hardening baseline is documented in `RISK_CENTER_PHASE5.md`
  - [x] focused UI coverage now locks selected-rule activity navigation plus policy save and rollback dispatch flows
  - [x] focused backend coverage now locks policy-linked order block/warn activity trails and the risk-center migration chain
  - [x] `npm run test:risk-center-phase5` now validates risk order audit linkage plus migration hygiene around remove/restore/hardening risk-center migrations
  - [x] Phase 6 adds `check:risk-center-health`, `release-gate:risk-center`, and `signoff:risk-center`
  - [x] browser-level `/risk-center` operator coverage now verifies policy save, rollback, activity handoffs, and alert handoff flows
  - [x] risk-center release readiness is documented in `RISK_CENTER_PHASE6.md`
  - [x] Phase 7 splits the Risk Center UI into overview, policy, operations, activity, and drawer modules instead of one oversized page component
  - [x] `/risk-center` now surfaces filtered recent risk activity inside the selected-rule workspace before handing off to `/activity`
  - [x] `/risk/overview` Phase 7 metadata now advertises workspace-focus, activity-trail, and modular page-structure truth
  - [x] Phase 7 handoff and verification are documented in `RISK_CENTER_PHASE7.md`
  - [x] Phase 8 adds manual-review governance for sensitive policy updates and rollbacks
  - [x] `/risk/policies/:policyId/versions/:versionId/approve` and `/reject` now drive pending-review lifecycle decisions
  - [x] `/risk-center` now keeps sensitive saves in the drawer history workflow and exposes approve/reject controls in-page
  - [x] focused backend verification now covers governance summaries plus approve/reject behavior via `npm run test:risk-center-phase8`
  - [x] browser-level `/risk-center` coverage now verifies submit-for-review, approve, and rollback operator flow
  - [x] Phase 8 handoff and verification are documented in `RISK_CENTER_PHASE8.md`
  - [x] Phase 9 makes the in-page `/risk-center` activity trail operational with stream, status, and read-state filters
  - [x] `/risk/overview` now returns `activityTrail` export posture, retention cues, and recent risk-export truth for the selected-rule workspace
  - [x] `/risk-center` now lets operators queue exports directly from the in-page trail and see the latest export state before handing off to `/activity`
  - [x] focused backend verification now locks Phase 9 trail contract and export truth via `npm run test:risk-center-phase9`
  - [x] browser-level `/risk-center` coverage now verifies activity filtering, export queueing, and the existing policy governance flow together
  - [x] Phase 9 handoff and verification are documented in `RISK_CENTER_PHASE9.md`

### `/alerts`

- Status: `Partial`
- Priority: `P1`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Alerts/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/AlertsController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/AlertsOverviewController.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Alert.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/AlertAction.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Alerts/index.test.jsx`
- Pending:
  - [ ] add dedupe/suppression controls
  - [x] add source deep-links
    alert detail now exposes direct links to the owning workspace, alert-scoped activity trail,
    source-scoped activity search, and observability health alongside the repository runbook path
  - [ ] define retention/archive rules
  - [ ] verify action idempotency

### `/activity`

- Status: `Partial`
- Priority: `P1`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Activity/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/ActivityController.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/ActivityLog.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Activity/index.test.jsx`
- Pending:
  - [ ] define retention/cold storage policy

### `/strategy-template`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyTemplate/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/StrategyTemplatesController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/StrategyTemplatesService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/StrategyTemplate.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyTemplate/index.test.jsx`
- Pending:
  - [ ] add version history UI
  - [ ] add authored-vs-compiled compare UI
  - [ ] define soft-delete/archive behavior
  - [ ] normalize naming across `strategy` vs `strategy-template`

### `/strategy-lab`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLab/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/StrategyLabController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/StrategyLabService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/StrategyLabProject.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/StrategyTemplate.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Backtest.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLab/index.test.jsx`
- Pending:
  - [ ] split editor/validation/compare/handoff into modules
  - [ ] add unsaved draft recovery strategy
  - [ ] handle multi-tab/version conflicts
  - [ ] expand validation coverage

### `/strategy-library`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLibrary/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/StrategyLibraryController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/StrategyLibraryService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/StrategyLibrary.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/StrategyTemplate.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLibrary/index.test.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/strategy-library.spec.js`
- Pending:
  - [x] add page test
  - [x] make the list feel like a library
    strategy-library now shows profile, readiness, lineage, and recent activity at the row level,
    plus overview cards for visible run-ready, automation-ready, manual-only, and recent-failure entries
  - [x] define entry lifecycle/status semantics
  - [x] define import conflict behavior
  - [x] harden backend contract tests for search/status/run snapshot behavior
  - [x] add DB-level ownership, duplicate-name, and payload-shape integrity constraints
  - [x] improve lineage visibility in list/detail
    strategy-library now shows template -> library -> backtests lineage in the drawer plus list-level lineage signals,
    includes drawer-level lineage history and direct "Open latest linked backtest" navigation,
    and backtests list/detail/top-setups/input snapshot expose a normalized `lineage` object in addition to the legacy flat fields
  - [x] add durable strategy-library run history
    strategy-library now exposes bounded persisted linked-run history through a dedicated runs endpoint,
    and the drawer renders direct per-run backtest actions so queued and completed history survives refresh
    instead of relying on session-only run state
  - [x] improve browse and triage UX on strategy-library
    strategy-library list now supports URL-backed sort plus triage filters for scope, assets, automation readiness, and recent failures,
    with clearer active-filter summaries and loading/empty states for review workflows
  - [x] tighten strategy-library API contracts
    `POST /strategy-library/:libraryId/run` now returns only the documented queue result shape,
    and persistent linked run history moved to `GET /strategy-library/:libraryId/runs?limit=...`
    so library detail stays lean while the drawer reads durable run history from a dedicated endpoint
  - [x] lazy-load strategy-library broker assets
    strategy-library no longer preloads exchange assets for every active broker on page entry;
    the drawer now switches broker scope explicitly and loads/caches broker assets on demand when the asset picker opens,
    with per-broker refresh and cached-state reuse for the current session
  - [x] add release-grade strategy-library lineage smoke and gate
    authenticated journey smoke now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/smoke-strategy-library-lineage.ts`
    release-gate summary now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-strategy-library.ts`
    live verification passed on April 6, 2026 against a fresh backend on port 3002 after
    widening top-setups library-name search coverage and persisting matching trade events in the smoke flow
  - [x] add frontend strategy-library journey E2E
    Playwright now covers the mocked user flow from template import -> library save -> one-off run
    -> open queued backtest -> reopen linked library entry at
    `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/strategy-library.spec.js`
  - [x] document run/import/update/delete permissions

### `/discovery`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/api/v1/bots.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/api/v1/runs.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/api/v1/strategies.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/api/v1/preferences.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/api/v1/template_suggestions.py`
- DB:
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/models/bot.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/models/run.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/models/strategy.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/models/template_suggestion.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/models/scheduler_template_improvement_run.py`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Discovery/index.test.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/discovery.spec.js`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/smoke-discovery-contract.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-discovery.ts`
- Pending:
  - [x] add explicit discovery dependency health surface and smoke
    aurAlpha now exposes authenticated dependency status at `/api/v1/health/discovery`,
    documents the expected discovery-engine seam in
    `/Users/apple/Documents/Project/Backend/aurAlpha/DISCOVERY_DEPENDENCY_CONTRACT.md`,
    and includes a live smoke at
    `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/smoke-discovery-dependency.ts`
  - [x] make discovery sections truthful about fetch state
    `/discovery` now exposes section-level loading/error/refresh truth for dependency health,
    summary, bots, review queue, suggestions, preferences, runs, and the live feed connection,
    with explicit banners instead of one shared error bucket
  - [x] replace derived summary/detail assumptions with authoritative fetches
    aurAlpha now exposes `/api/v1/discovery/summary` for exact Discovery summary cards,
    the page fetches selected strategy detail by id from discovery-engine,
    and bots/strategies/suggestions/runs now page against the dependency with real remote offsets
  - [x] add durable feed history and align websocket resolution
    aurAlpha now exposes `/api/v1/discovery/feed` as a normalized recent-run history surface for
    the Discovery live-feed panel, `/discovery` loads that persisted history before layering live
    websocket events on top, and the frontend now derives the Discovery websocket URL from the same
    configured discovery base instead of using a separate hardcoded environment path
  - [x] add section-aware dependency gating and stale trust warnings
    `/discovery` now maps dependency health into workspace readiness for summary, bots, detail
    panels, suggestions, preferences, feed history, and runs, surfaces stale/unavailable copy per
    section, and disables mutation actions when the relevant dependency seam is explicitly down
  - [x] surface scheduler-linked observability inside Discovery
    `/discovery` now renders a linked scheduler-run workspace with progress, scheduler update rows,
    CSV export, suggestion-sync context, and direct jumps into template suggestions and recent runs,
    so operators can trace scheduler run -> discovery run -> template suggestions without returning
    to `/schedulers`
  - [x] define Discovery ownership and release signoff path
    `DISCOVERY_DEPENDENCY_CONTRACT.md` now names the aurAlpha vs discovery-engine ownership split,
    `RUNBOOK.md` now includes the Discovery operator release checklist, and
    `npm run release-gate:discovery` writes a repeatable live signoff artifact at
    `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/discovery-release-gate.json`
  - [x] add full E2E for create/start/run/import handoffs
    `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/discovery.spec.js` now covers
    bot creation plus start/stop, suggestion import handoff into Strategy Template, and approved
    strategy backtest handoff into Backtests
  - [x] expand discovery seam coverage beyond dependency health into full create/read/update contract flows
    `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/smoke-discovery-contract.ts` now
    verifies the aurAlpha wrapper surfaces plus authenticated discovery-engine preferences, bot
    CRUD, sampled strategy detail, sampled run detail, and suggestion-list contract behavior
  - [ ] define import conflict behavior
  - [ ] complete microservice authz review
  - [ ] add discovery dashboards/SLOs

### `/backtests`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Backtests/index.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Backtests/BacktestsRunbookSection.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/BacktestsController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BacktestsService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Backtest.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/BacktestResult.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/BacktestTrade.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Backtests/index.test.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/backtests.spec.js`
- Ops:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/RUNBOOK.md`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-backtests.ts`
- Pending:
  - [ ] split giant page into list/detail/chart/promotion modules
  - [ ] finish external dashboards/alerts for `/health/backtests`
    internal failure alerts now emit for create/recovery/promotion through the alerts inbox under `Backtests`
    `/health/backtests` now accepts service monitoring via `x-api-key` in addition to admin JWT auth
    `/health/backtests` now exposes open alert totals plus runtime/recovery/promotion breakdown
    external threshold check now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-backtests-health.ts`
  - [ ] add CI-grade multi-service E2E for run/recover/promotion
    authenticated API smoke now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/smoke-backtests-lifecycle.ts`
    backend CI now provisions Postgres chart fixtures and requires chart validation instead of treating it as optional
    backend CI now runs `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-backtests-live.ts` to combine lifecycle smoke plus `/health/backtests` threshold checks on the live stack
    mocked browser coverage exists in `/Users/apple/Documents/Project/Frontend/aurAlphaApp/tests/e2e/backtests.spec.js`
  - [ ] run the staging release gate / soak before broad rollout
    release gate now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-backtests.ts`
    manual staging workflow now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/.github/workflows/backtests-staging-gate.yml`
    run with `BACKTESTS_SOAK_DURATION_MINUTES=30 npm run release-gate:backtests` once the target API/database stack is live
    final sign-off bundle now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-backtests.ts`
  - [ ] virtualize large results where needed

### `/automations`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/AutomationsController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AutomationsService.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/AutomationExecutionService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Automation.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/AutomationRun.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/AutomationEvent.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/AutomationAlert.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/AutomationCursor.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/index.test.jsx`
- Pending:
  - [x] split create/edit/history modules
  - [x] add pause/resume/run-now concurrency tests
  - [x] audit schedule timezone behavior
  - [x] add stuck-run recovery UI/operator controls
  - [ ] finish external dashboards/alerts for `/health/automations`
    `/health/automations` now accepts service monitoring via `x-api-key` in addition to admin JWT auth
    `/health/automations` now exposes worker/queue/run/cursor diagnostics plus open alert totals and control/recovery/execution breakdown
    external threshold check now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-automations-health.ts`
    authenticated lifecycle smoke now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/smoke-automations-lifecycle.ts`
    combined live proof now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/proof-automations-live.ts`
    release gate now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-automations.ts`
    manual staging workflow now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/.github/workflows/automations-staging-gate.yml`
    run with `AUTOMATIONS_SOAK_DURATION_MINUTES=30 npm run release-gate:automations` once the target API/worker/database stack is live
    final sign-off bundle now exists at `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/signoff-automations.ts`

### `/brokers-data`

- Status: `Partial`
- Priority: `P1`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokersData/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/BrokerAccountsController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/ConnectionsController.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/BrokerAccount.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Connection.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Broker.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/Exchange.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokersData/index.test.jsx`
- Pending:
  - [ ] add connection test history
  - [x] surface route/account integrity summaries in the workspace
    `/connections/:connectionId/workspace` now returns route and selected-account integrity summaries,
    and `/brokers-data` renders those checks directly in the selected route/account cards
  - [ ] improve secret masking/rotation UX
  - [ ] show last successful sync timestamps
  - [ ] complete admin-only access review

### `/broker-definitions`

- Status: `Partial`
- Priority: `P1`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokerDefinitions/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/BrokerDefinitionsController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/BrokerDefinitionsService.ts`
- DB:
  - broker definition/config persistence
- Tests:
  - missing page test
- Pending:
  - [ ] add page test
  - [ ] add approval/audit flow for definition changes
  - [ ] add schema validation per broker config
  - [ ] document env-vs-db override precedence

### `/schedulers`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/SchedulerController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/SchedulerOverviewController.ts`
  - scheduler-specific controllers/services in `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers`
- Worker:
  - `/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker/src/scheduler/queue/SchedulerCommandPoller.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker/src/scheduler/services/SchedulerExecutionService.ts`
- Discovery service:
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/api/v1/runs.py`
  - `/Users/apple/Documents/Project/Backend/discovery-engine/app/services/template_improvements.py`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/SchedulerConfig.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/SchedulerCommand.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/SchedulerRunLog.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/ExchangeAssetUpdateLog.ts`
  - discovery-engine scheduler tables
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-services.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-controllers.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker/scripts/test-reconciliation.js`
- Phase 6 note:
  - Positions Sync now exposes contract-backed recovery policy metadata, richer last-rebuild
    reporting, and confirmation-aware owner or broker rebuild actions in `/schedulers`
  - Phase 6 handoff and verification are documented in
    `POSITIONS_SCHEDULER_PRODUCT_SPLIT_PHASE6.md`
- Phase 7 note:
  - Positions Sync now persists structured recovery history, surfaces durable rebuild review plus
    owner or broker drift hotspots in `/schedulers`, and requires explicit recovery-history
    evidence during final signoff
  - Phase 7 handoff and verification are documented in
    `POSITIONS_SCHEDULER_PRODUCT_SPLIT_PHASE7.md`
- Phase 7 note:
  - AI Discovery now lives entirely in Discovery bots; `/schedulers` no longer exposes it and the legacy
    aurAlpha discovery scheduler backend path has been retired
  - Positions Sync now has a dedicated rollout gate and live health check for admin diagnostics plus
    `/positions` desk freshness validation in `POSITIONS_SCHEDULER_PHASE7.md`
- Phase 8 note:
  - Positions Sync now has a final signoff path in `signoff:positions-scheduler`, the deprecated
    `/scheduler/positions-sync` alias is retired, and the final handoff is documented in
    `POSITIONS_SCHEDULER_PHASE8.md`
- Phase 8 note:
  - Positions Sync now has a single-command live proof workflow in
    `proof:positions-scheduler-live`, which runs the release gate with live checks enabled and
    writes the combined proof artifact to
    `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/positions-scheduler-live-proof.json`
  - Phase 8 handoff and verification for the product-split stream are documented in
    `POSITIONS_SCHEDULER_PRODUCT_SPLIT_PHASE8.md`
- Phase 7 note:
  - Risk Snapshot Refresh is now presented only as admin diagnostics in `/schedulers`, while
    `/risk-center` owns user-facing refresh and recompute actions
- Phase 8 note:
  - risk scheduler now has a dedicated live health script in
    `scripts/check-risk-scheduler-health.ts`
  - risk scheduler now has a dedicated release gate in
    `scripts/release-gate-risk-scheduler.ts`
  - risk scheduler controller actions now have focused admin-only auth coverage across the
    canonical `/scheduler/risk/*` diagnostics and control surface
  - risk scheduler now has a final signoff script in
    `scripts/signoff-risk-scheduler.ts`
  - risk scheduler signoff now records diagnostics review, product trust alignment, recompute-write
    verification, and admin access review evidence into
    `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/risk-scheduler-signoff.json`
  - Phase 8 handoff and verification are documented in `RISK_SCHEDULER_PHASE8.md`
- Phase 1 note:
  - orders scheduler truth is now surfaced directly in `/schedulers`, including checkpoint coverage,
    retry backlog, next-retry timing, and raw sync-state diagnostics links
  - Phase 1 handoff and verification are documented in `SCHEDULERS_PHASE1.md`
- Phase 2 note:
  - orders scheduler run updates/export now verify `runId` ownership against `orders-sync`
  - orders scheduler config writes now reject asset/discovery-only fields, normalize fixed
    `["orders"]` sources, and validate the resolved schedule mode server-side
  - orders sync-state diagnostics now expose explicit `ownerUserId` semantics with legacy `userId`
    alias tolerance
  - Phase 2 handoff and verification are documented in `SCHEDULERS_PHASE2.md`
- Phase 3 note:
  - orders scheduler purge preview now includes scheduler-scoped update-log counts instead of
    hardcoding `0`
  - orders scheduler purge now deletes scheduler-scoped update logs before run logs and records the
    true run-log plus update-log totals in activity history
  - the shared update-log repository now counts scheduler-scoped retention candidates with the same
    run-age rule used by deletion, so previews and purge results stay aligned
  - Phase 3 handoff and verification are documented in `SCHEDULERS_PHASE3.md`
- Phase 4 note:
  - orders scheduler config now exposes saved replay lookback and a fixed `ordersPolicy` contract
    instead of hiding replay depth and overlap rules behind backend defaults
  - orders `run now` now supports account-scoped replay with checkpoint reset, active-account
    validation, and system-actor execution for globally scoped manual runs
  - the `/schedulers` orders tab now shows replay lookback controls, fixed policy copy, and a
    per-account `Replay account` repair action directly from Order sync health
  - Phase 4 handoff and verification are documented in `SCHEDULERS_PHASE4.md`
- Phase 5 note:
  - orders scheduler runtime tables now ship through
    `1770706000000-CreateOrdersSchedulerRuntimeTables.ts` instead of lazy runtime DDL
  - orders replay reset and internal orders sync now rely on migration-owned schema and fail fast
    with `ORDERS_SCHEDULER_SCHEMA_MISSING` when the runtime foundation is absent
  - `orders-sync` ownership is now normalized as a global system reconciliation scheduler in
    `scheduler_configs`, and any user-scoped orders scheduler rows are retired from
    `scheduler_user_configs`
  - Phase 5 handoff and verification are documented in `SCHEDULERS_PHASE5.md`
- Phase 6 note:
  - the `/schedulers` page now splits selected-scheduler overview, config/repair, and history/detail
    into focused workspace modules instead of keeping the entire selected-scheduler surface inline
    inside one page file
  - orders sync now has a clearer operator desk flow, with checkpoint repair visually separated from
    schedule-wide config and run history framed as an orders-specific workspace
  - discovery run detail now lives in its own frontend module instead of being embedded directly in
    the giant page render tree
  - Phase 6 handoff and verification are documented in `SCHEDULERS_PHASE6.md`
- Phase 7 note:
  - orders sync summary now exposes explicit runtime-foundation status, required tables/columns, and
    the Phase 5 migration identity instead of leaving migration readiness implicit
  - orders sync-state diagnostics now avoid missing-table query paths once the runtime foundation is
    known missing, so admin diagnostics degrade cleanly
  - orders scheduler now has a dedicated live health script in
    `scripts/check-orders-scheduler-health.ts`
  - orders scheduler now has a dedicated release gate in
    `scripts/release-gate-orders-scheduler.ts`
  - Phase 7 handoff and verification are documented in `SCHEDULERS_PHASE7.md`
- Phase 8 note:
  - orders scheduler controller actions now have focused admin-only auth coverage across the
    canonical `/scheduler/orders/*` diagnostics and control surface
  - orders scheduler now has a final signoff script in
    `scripts/signoff-orders-scheduler.ts`
  - orders scheduler signoff now records operator walkthrough, runbook review, runtime foundation,
    and admin access review evidence into
    `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/orders-scheduler-signoff.json`
  - Phase 8 handoff and verification are documented in `SCHEDULERS_PHASE8.md`
- Phase 9 note:
  - orders scheduler now has a single live-proof script in
    `scripts/proof-orders-scheduler-live.ts`
  - `npm run proof:orders-scheduler-live` now runs the orders scheduler release gate with live
    health enabled, then runs final signoff with live health required, and writes the combined proof
    artifact to `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/orders-scheduler-live-proof.json`
  - `test:operational-audit` now treats the orders scheduler release workflow markers as a required
    repo-level operational surface
  - Phase 9 handoff and verification are documented in `SCHEDULERS_PHASE9.md`
- Pending:
  - [x] retire legacy AI Discovery scheduler surface
    AI Discovery now runs only through Discovery bots and no longer exposes aurAlpha scheduler routes,
    services, or rollout scripts
  - [x] add operator repair tooling outside rolling reconciliation
    positions sync now ships browser-triggered scoped read-model rebuild tooling in `/schedulers`,
    keeps the script fallback for admin drill parity, and has a dedicated scheduler rollout gate
    and live health check path
  - [x] make positions rebuild policy and recovery outcomes explicit in the scheduler desk
    positions sync now exposes config-backed recovery policy metadata, renders the last rebuild
    result with warnings and recommended next steps, and requires confirmation before broader
    owner or broker rebuild scopes run from `/schedulers`
  - [x] add durable recovery history and clustered drift review for positions sync
    positions sync now persists rebuild history through activity-backed recovery records, exposes
    a first-class recovery-history endpoint, renders durable recovery review in `/schedulers`, and
    surfaces owner or broker hotspots instead of only a single priority account
  - [x] expose orders checkpoint and retry truth in the scheduler UI
    `/schedulers` now renders order sync health from `/scheduler/orders/sync-state` and
    `/scheduler/orders/sync-state/summary`, with refresh on selection, polling, and post-run completion
  - [x] harden orders scheduler API boundary and config contract
    orders scheduler now validates run ownership on update exports, rejects asset/discovery config
    leakage, normalizes fixed orders sources, and exposes explicit owner-scoped sync-state filters
  - [x] make orders retention and purge truth match the UI
    orders scheduler purge preview/result now include scheduler-scoped update logs, and the purge
    path deletes update logs before run logs so the operator-facing counts match the actual cleanup
  - [x] expose real orders controls and repair tools
    orders scheduler now exposes replay lookback, fixed replay policy metadata, and account-scoped
    checkpoint reset + replay directly from `/schedulers`
  - [x] move orders scheduler runtime schema into migrations
    orders checkpoint and snapshot tables now ship through
    `1770706000000-CreateOrdersSchedulerRuntimeTables.ts`, and orders sync/replay no longer issue
    lazy `CREATE TABLE IF NOT EXISTS` calls on the happy path
  - [x] split giant page into config/history/detail modules
    `/schedulers` now renders through focused overview, config, history, and detail workspace
    components, with a clearer orders-specific operator desk flow
  - [x] complete admin-only access review
    positions scheduler controller actions now have focused admin-only auth coverage across every
    canonical `/scheduler/positions/*` endpoint, and the deprecated `/scheduler/positions-sync`
    alias has been retired
  - [x] add CI-grade multi-service E2E
    orders scheduler now ships a browser-level `/schedulers` operator journey and a dedicated
    release gate that runs focused backend, frontend UI, frontend E2E, and optional live health
    proof for the orders operator workspace
  - [x] add final scheduler signoff artifact path
    `npm run signoff:positions-scheduler` now records the final admin diagnostics, product trust,
    rebuild drill, and access review evidence into
    `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/positions-scheduler-signoff.json`
  - [x] add final orders scheduler signoff artifact path
    `npm run signoff:orders-scheduler` now records the final operator walkthrough, runbook review,
    runtime foundation, and admin access review evidence into
    `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/orders-scheduler-signoff.json`
  - [x] add final risk scheduler signoff artifact path
    `npm run signoff:risk-scheduler` now records diagnostics review, product trust alignment,
    recompute-write verification, and admin access review evidence into
    `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/risk-scheduler-signoff.json`
  - [x] add single-command live proof workflow for orders scheduler
    `npm run proof:orders-scheduler-live` now ties the live release gate and final signoff into one
    deployment-proof artifact at
    `/Users/apple/Documents/Project/Backend/aurAlpha/artifacts/orders-scheduler-live-proof.json`
  - [x] publish runbook links in UI
    schedulers now expose active-status access, raw health links, discovery dependency checks,
    and the repository runbook path directly from the page
  - [ ] run `npm run proof:orders-scheduler-live` against the target environment with real admin
    credentials, live health access, and final evidence links


### `/email-deliveries`

- Status: `Partial`
- Priority: `P0`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/EmailDeliveries/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/EmailDeliveriesController.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/EmailDelivery.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/ActivityLog.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/EmailDeliveries/index.test.jsx`
- Pending:
  - [ ] verify retry/cleanup idempotency
  - [x] add worker lag metrics
  - [x] define retention/export behavior
  - [x] lock cleanup/body governance contract
    email delivery filter options now expose explicit governance for body preview visibility,
    cleanup-eligible/protected statuses, retention field, and preview limits
  - [ ] complete admin-only permission review
  - [ ] split giant page into list/detail/ops modules

### `/settings`

- Status: `Partial`
- Priority: `P1`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Settings/index.jsx`
- API:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/controllers/SettingsController.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/SettingsService.ts`
- DB:
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/AppSetting.ts`
  - `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/SettingsAuditLog.ts`
- Tests:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Settings/index.test.jsx`
- Pending:
  - [ ] add audit diff viewer
  - [ ] separate secret values from general settings UI
  - [ ] formalize settings audit export/archival workflow

### Legacy Page: `SchedulerOps`

- Status: `Blocker`
- UI:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/SchedulerOps/index.jsx`
- Reason:
  - route now redirects to `/schedulers`
  - leaving this file alive invites drift and confusion
- Pending:
  - [ ] delete or formally archive this page

## Missing Page Tests

- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Login/index.test.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/SuggestedTrades/index.test.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLibrary/index.test.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/BrokerDefinitions/index.test.jsx`

## Biggest Refactor Targets

- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Backtests/index.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Automations/index.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/StrategyLab/index.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Markets/index.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Orders/index.jsx`
- [ ] `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/EmailDeliveries/index.jsx`

## Final Release Checklist

Do not mark the product production-ready until all of the following are true:

- [ ] all global `P0` items are complete
- [ ] all missing page tests are added and passing
- [ ] core E2E smoke suite passes
- [ ] scheduler/discovery/automation observability is live
- [ ] backup/restore drills are documented and tested
- [ ] legacy `SchedulerOps` page is removed or archived
- [ ] no route remains with unresolved `Blocker` status
