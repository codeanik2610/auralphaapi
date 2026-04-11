# Global System Schedulers Phase 7

Phase 7 freezes frontend/operator consumption for these global system
schedulers:

- `broker-assets-sync`
- `exchange-assets-sync`
- `binance-candles-3m-1m-sync`
- `system-health-sync`

## Contract

- Phase 1 through Phase 6 contracts stay stable.
- The `/schedulers` frontend now consumes `recentRun`, `ops`, initiator, and
  localized display timestamps directly from the backend overview contract.
- The Active Scheduler Status drawer no longer issues per-scheduler latest-run
  hydration calls.
- The selected scheduler card now shows the latest trigger and recent outcome
  from overview data.
- Scheduler Ops rows now show trigger attribution from overview data.
- Recent runs and run updates now show initiator attribution in the frontend.

## Files

- Frontend repo:
  `/Users/apple/Documents/Project/Frontend/aurAlphaApp`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx`
- `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`

## Verification

- Frontend repo:
  - `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Schedulers/index.test.jsx`
  - `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Schedulers/index.jsx src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx src/pages/Schedulers/index.test.jsx`

## Transitional State After Phase 7

- Operator-facing scheduler UI now trusts the backend overview contract instead
  of stitching together separate latest-run calls for active status.
- The frontend shows who triggered the current/recent run without changing
  global system execution scope semantics.
- Phase 8 can focus on proof and subsystem validation instead of redesigning
  frontend contract usage again.
