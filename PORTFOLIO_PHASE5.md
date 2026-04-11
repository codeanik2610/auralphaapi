# Portfolio Phase 5

Date: 2026-04-10

## 1) Goal
Phase 5 tunes `/portfolio` for query cost and operational readiness without changing the operator semantics established in Phases 1 to 4.

By the end of this phase the portfolio surface should:

- keep the same truth model and page contract
- stop paying JSON-extraction cost for closed-position activity on the hot path
- stop loading snapshot holdings twice when the page only needs the latest snapshot id and timestamp
- publish a focused health check so production environments can verify portfolio latency and capability posture
- add the indexes and backfill needed to support the new read paths

## 2) What Changed
### Closed-position activity now prefers `position_read_models`
`/portfolio/pnl` and `/portfolio/performance` still preserve the same operator-facing semantics:

- source semantics remain `scheduler_positions_snapshots`
- measurement remains `realized_pnl`
- time windows remain user-timezone today / trailing 7 days / trailing 30 days

Under the hood, Phase 5 now accelerates those reads through `position_read_models` first, then falls back to the legacy scheduler snapshot query only if the read model is unavailable.

The key backend files are:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioService.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/utils/positionsReadModel.ts`

Important details:

- `PortfolioService.queryClosedPositionSnapshotsByPayloadDateRange(...)` now hydrates and reads from `position_read_models`
- the service maps `realized_pnl`, `exposure`, and `position_closed_at` back into the existing activity payload shape so the rest of the portfolio contract stays stable
- if `position_read_models` is missing, the service safely falls back to the old `scheduler_positions_snapshots` JSON query path

### Latest snapshot reads are now lighter
The holdings workspace no longer loads the full latest snapshot plus joined holdings just to discover the newest snapshot id.

That optimization lives in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/PortfolioRepository.ts`

Phase 5 additions:

- `getLatestSnapshotReference(...)` for lightweight snapshot lookup
- `listHoldings(...)` now fetches the latest snapshot reference first, then performs the holdings query once against that snapshot id
- `getPortfolioSummary(...)` still uses the full snapshot-with-holdings read because that route genuinely needs largest-weight calculations

### New indexes and read-model backfill support the hot path
Phase 5 adds a migration so the new query shapes are actually backed by storage changes instead of only application logic.

The migration is:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/migrations/1770704000000-AddPortfolioPhase5Indexes.ts`

It does three things:

- backfills `position_read_models.position_closed_at` for closed rows using the best available activity timestamp
- adds `portfolio_snapshots(user_id, createdAt)` for latest snapshot and range reads
- adds `portfolio_holdings(snapshotId, user_id, marketValue)` plus `position_read_models` closed-activity indexes for the new portfolio query path

The matching entity metadata is now present in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/PortfolioSnapshot.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/entities/PortfolioHolding.ts`

### Portfolio health checks are now first-class
Phase 5 adds a dedicated live-health script:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-portfolio-health.ts`

and wires it through:

- `/Users/apple/Documents/Project/Backend/aurAlpha/package.json`

The health check validates:

- `/portfolio/overview` purpose and hydration mode
- summary/performance source semantics
- new Phase 5 capability flags
- overview and direct performance latency thresholds in a live environment

### The overview contract now advertises the Phase 5 runtime posture
Phase 5 does not introduce a breaking contract version bump, but it does add capability flags so operators and release tooling can tell that the runtime is using the optimized path.

That lives in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/PortfolioOverview.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/PortfolioOverviewService.ts`

New capabilities:

- `indexedSnapshotReads`
- `activityReadModelAcceleration`
- `portfolioHealthChecks`

## 3) Phase 5 Outcome
`/portfolio` now has a tuned backend read path instead of a contract that is correct but unnecessarily expensive.

From an operator point of view nothing became more confusing:

- the page still speaks in terms of stored posture, live capital routes, and closed-position activity
- the meaning of summary, holdings, performance, and PnL did not change
- the query cost behind activity and latest-snapshot reads is materially better aligned with the actual storage model

This is the backend baseline Phase 6 needs before we add reporting or action-oriented workspace behavior.

## 4) Carry-Forward For Phase 6
- live-vs-snapshot reconciliation rules are still explicit but not implemented as an operator workflow
- export/report remains intentionally deferred
- overview holdings focus still operates on the loaded overview slice instead of a server-scoped overview search model
- the new `check:portfolio-health` script exists, but live environment execution still needs to happen in the target deployment

## 5) Verification
Phase 5 verification passed with:

- `npm run test:portfolio-phase1`
- `npm run test:portfolio-phase2`
- `npm run test:portfolio-phase3`
- `npm run test:portfolio-phase4`
- `npm run test:portfolio-phase5`
- `npx eslint src/api/contracts/PortfolioOverview.ts src/api/services/PortfolioOverviewService.ts src/api/services/PortfolioService.ts src/api/utils/positionsReadModel.ts src/database/entities/PortfolioSnapshot.ts src/database/entities/PortfolioHolding.ts src/database/repositories/PortfolioRepository.ts src/database/migrations/1770704000000-AddPortfolioPhase5Indexes.ts scripts/test-portfolio-phase1.ts scripts/test-portfolio-phase2.ts scripts/test-portfolio-phase3.ts scripts/test-portfolio-phase4.ts scripts/test-portfolio-phase5.ts scripts/check-portfolio-health.ts`

`npm run check:portfolio-health` was added in this phase but was not run here because it expects a live API target with auth credentials.
