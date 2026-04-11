# Schedulers Phase 1

Phase 1 for `/schedulers` makes the order scheduler UI truthful about checkpoint and retry health.

## What changed

- `/schedulers` now surfaces order-sync truth from the existing backend endpoints instead of treating
  `orders-sync` like a generic scheduler with only run history.
- The frontend now fetches both:
  - `GET /api/v1/scheduler/orders/sync-state`
  - `GET /api/v1/scheduler/orders/sync-state/summary`
- The orders tab now shows:
  - connected-account checkpoint coverage
  - pending and failed retry backlog
  - latest checkpoint and next-retry timing
  - per-account state for broker/account/user/checkpoint/retry health
- The shared scheduler support links now include raw orders sync-state JSON and sync-summary JSON
  when the orders tab is selected.
- Orders sync truth now refreshes:
  - on scheduler selection
  - after a terminal orders run completes
  - during scheduler polling while the orders tab is open

## Main files

- Frontend API client:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/services/tradingApi.js`
- Frontend state:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/store/slices/settingsSlice.js`
- Frontend page:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/hooks/useSchedulerPolling.js`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx`
- Focused UI coverage:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`

## Verification

- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/services/tradingApi.js src/store/slices/settingsSlice.js src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx src/pages/Schedulers/hooks/useSchedulerPolling.js`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Schedulers/index.test.jsx`

## Phase 2 start point

Phase 2 should harden the orders scheduler API boundary now that the UI truth surface exists:

- verify `runId` ownership for orders run-updates and export routes
- stop asset-oriented contract leakage in shared scheduler API helpers
- add any orders-specific validation that should exist server-side instead of only in UI assumptions
