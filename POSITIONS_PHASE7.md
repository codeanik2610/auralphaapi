# Positions Phase 7

Date: 2026-04-09

## 1) Goal
Phase 7 for `/positions` closes the remaining maintainability and release-readiness gap after the desk, lifecycle, and freshness work from Phases 1-6.

By the end of this phase the positions surface should:

- keep snapshot-trust messaging in a focused helper instead of one oversized page file
- expose a backend health check and release gate that can be run before rollout
- document the source-of-truth for live positions, archived positions, PnL, and liquidation context

## 2) What Changed
### Frontend trust extraction
The snapshot-trust messaging used by
`/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/index.jsx`
now lives in:

- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/trust.js`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Positions/trust.test.js`

That keeps the page focused on orchestration and layout while the messaging logic for:

- live desk freshness
- selected-position trust
- lifecycle trust

stays isolated and easy to regression test.

### Backend health and release gate
Positions now has the same operational gate pattern as the other release-critical modules:

- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-positions-health.ts`
- `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/release-gate-positions.ts`

Those scripts are wired through:

- `npm run check:positions-health`
- `npm run release-gate:positions`

The health check verifies:

- `/positions/futures/active`
- `/positions/futures/history/active`
- `/positions/futures/:positionId/lifecycle`

with latency budgets, normalized row expectations, and freshness/source assertions.

The release gate runs the focused backend suites, frontend positions suites, lint checks, build verification, and optionally the live health check.

### Source-of-truth documentation
Phase 7 also makes the current read model explicit:

- live desk rows come from `position_read_models`, which are snapshot-backed and then enriched for live monitoring
- grouped account freshness comes from `position_read_models` plus `scheduler_sync_checkpoints`
- archived/history rows are read as archive-backed position records and must not pretend to be broker-live
- PnL and liquidation context shown on `/positions` are derived from the persisted position snapshot/read model path, with live enrichment where the backend contract already exposes it

## 3) Phase 7 Outcome
`/positions` is now easier to maintain and easier to ship safely.

The desk already had better contracts and better UX from earlier phases. Phase 7 closes the operational gap by making the freshness rules explicit, giving the team a repeatable health gate, and removing trust-message sprawl from the page component.

## 4) What Remains
Phase 7 does not close the last two follow-ups called out in the readiness tracker:

- audit close and partial-close action logging end to end
- persist the primary positions filters in the URL

Those are the right focus for the next cleanup pass.

## 5) Verification
Phase 7 verification passed with:

- `npm run test:positions-phase1`
- `npm run test:positions-phase4`
- `npm run test:positions-phase5`
- `npm run test:positions-phase6`
- `npx eslint src/api/contracts/Positions.ts src/api/services/BrokerPositionsFacadeService.ts src/database/repositories/PositionReadModelRepository.ts src/env.ts scripts/test-positions-phase1.ts scripts/test-positions-phase4.ts scripts/test-positions-phase5.ts scripts/test-positions-phase6.ts scripts/check-positions-health.ts scripts/release-gate-positions.ts`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/store/slices/positionsSlice.js src/store/slices/positionsSlice.test.js src/pages/Positions/index.jsx src/pages/Positions/index.test.jsx src/pages/Positions/trust.js src/pages/Positions/trust.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/store/slices/positionsSlice.test.js src/pages/Positions/index.test.jsx src/pages/Positions/trust.test.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run build`
