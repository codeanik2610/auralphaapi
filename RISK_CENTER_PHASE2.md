# Risk Center Phase 2

Date: 2026-04-09

## 1) Goal
Phase 2 for `/risk-center` makes the page truthful about what data it really has.

The operator workspace should stop implying live broker telemetry, stop inventing weekly/monthly
loss-window usage, and expose snapshot provenance clearly enough that Phase 3 can focus on UX
reliability instead of contract ambiguity.

## 2) What Changed
### Truthful overview contract
`GET /api/v1/risk/overview` now returns explicit Phase 2 data-shape support in
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/contracts/RiskOverview.ts`
and
`/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts`.

Phase 2 contract changes:

- `meta.contractVersion` is now `risk-center-phase2-2026-04-09`
- `meta.sources` now explicitly describes risk-window and broker-snapshot provenance
- `meta.capabilities.snapshotBrokerKpis` is now `true`
- `meta.capabilities.weeklyMonthlyRiskWindowUsage` remains `false`
- `riskWindows[]` now carries explicit availability, observed time, source label, and note per
  window
- `brokers.items[]` now carries snapshot availability, connected account count, metric-level
  observed times, and explanatory notes per broker

### Snapshot-backed broker data
Broker coverage is now backed by persisted account snapshots instead of frontend-only placeholders.

Phase 2 broker sources:

- funds balances come from `funds_snapshots`
- open-position counts come from `scheduler_positions_snapshots`
- connected-account grouping still comes from broker accounts plus active broker definitions

New backend support for this lives in:

- `/Users/apple/Documents/Project/Backend/aurAlpha/src/database/repositories/PositionSnapshotRepository.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/src/api/services/RiskOverviewService.ts`

If a broker has incomplete or missing snapshot history, the response now says `partial` or
`unavailable` instead of pretending those values are live.

### Truthful risk-window availability
Risk-window cards now consume an explicit backend array instead of synthesizing all three windows
from a single summary field.

Phase 2 window semantics:

- `daily` is snapshot-backed from `risk_snapshots.drawdownBudgetUsed`
- `weekly` is explicitly `unavailable`
- `monthly` is explicitly `unavailable`

This means the backend now tells the UI to treat unsupported windows as unavailable, not normal.

### Frontend contract adoption
The frontend `/risk-center` page and slice now consume the Phase 2 overview contract end to end.

Updated frontend files:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/riskCenterSlice.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/RiskCenter/index.test.jsx`

Phase 2 frontend changes:

- page loading/error UX now keys off `overviewStatus` and `overviewError`
- risk windows render from `riskWindows[]`, including explicit unavailable weekly/monthly states
- broker cards render from `brokers.items[]`, including snapshot availability and observed times
- broker-section copy now calls the data snapshot-backed, not live telemetry
- the page test fixture now uses the Phase 2 contract shape

## 3) Phase 2 Outcome
`/risk-center` is now honest about its broker and risk-window data.

Operators see snapshot-backed broker coverage instead of fake live KPIs, and weekly/monthly windows
are clearly marked unavailable until the backend persists them. Phase 3 can now improve UX flow and
reliability without needing to reinterpret the data contract first.

## 4) Known Carry-Forward For Phase 3
- overview and alerts-overview are still fetched separately and can be rationalized further
- weekly/monthly loss usage is still not persisted in the backend
- broker coverage is snapshot-backed, not live broker telemetry
- risk capacity, kill switch automation, and meaningful recompute behavior are still deferred
- policy approval, rollback, and richer audit workflow are still not part of the operator flow

## 5) Verification
Phase 2 verification passed with:

- `npm run test:risk-center-contract`
- `npm run test:risk-center-phase2`
- `npx eslint src/api/contracts/RiskOverview.ts src/api/services/RiskOverviewService.ts src/api/services/RiskAlertsOverviewService.ts src/database/repositories/PositionSnapshotRepository.ts scripts/test-risk-center-contract.ts scripts/test-risk-center-phase2.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/RiskCenter/index.jsx src/store/slices/riskCenterSlice.js src/pages/RiskCenter/index.test.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/RiskCenter/index.test.jsx`
