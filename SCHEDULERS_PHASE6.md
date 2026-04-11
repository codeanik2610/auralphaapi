# Schedulers Phase 6

Phase 6 turns the shared `/schedulers` page into clearer workspace modules, with a more
orders-focused operator flow instead of keeping all config, health, runs, and detail rendering
inside one giant page component.

## What changed

- The `/schedulers` page now renders through focused workspace modules instead of keeping the entire
  selected-scheduler surface inline inside `index.jsx`.
- Selected-scheduler overview, shared diagnostics, config/repair, and run history now live in
  dedicated frontend modules:
  - `SchedulerOverviewWorkspace.jsx`
  - `SchedulerConfigWorkspace.jsx`
  - `SchedulerHistoryWorkspace.jsx`
  - `SchedulerDiscoveryRunDetail.jsx`
- Orders sync now has a clearer operator desk flow:
  - the page explicitly labels the orders area as an operator desk
  - checkpoint repair and replay coverage stay visually separate from schedule-wide config
  - run history is labeled as an orders-specific workspace instead of blending into the generic page
- Discovery run detail is now isolated from the main page render tree, which reduces the coupling
  between discovery-specific detail UX and the rest of the scheduler shell.
- No backend contract changes were needed for Phase 6; this phase restructures and clarifies the
  frontend operator surface on top of the Phase 5 migration/runtime foundation.

## Main files

- Frontend `/schedulers` page:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.jsx`
- New workspace modules:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerHistoryWorkspace.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerDiscoveryRunDetail.jsx`
- Focused verification:
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/index.test.jsx`
  - `/Users/apple/Documents/Project/Frontend/aurAlphaApp/src/pages/Schedulers/components/SchedulerConfigSection.test.jsx`

## Verification

- `npm run test:schedulers-phase5`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npx eslint src/pages/Schedulers/index.jsx src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx src/pages/Schedulers/components/SchedulerConfigWorkspace.jsx src/pages/Schedulers/components/SchedulerDiscoveryRunDetail.jsx src/pages/Schedulers/components/SchedulerHistoryWorkspace.jsx src/pages/Schedulers/components/SchedulerConfigSection.jsx src/pages/Schedulers/components/SchedulerRecordSyncCoverage.jsx src/pages/Schedulers/components/SchedulerRunsSection.jsx src/pages/Schedulers/components/SchedulerRunUpdatesSection.jsx`
- `cd /Users/apple/Documents/Project/Frontend/aurAlphaApp && npm run test:ui -- src/pages/Schedulers/index.test.jsx src/pages/Schedulers/components/SchedulerConfigSection.test.jsx`

Verification note:

- the focused Phase 6 frontend lint and UI tests passed
- `npm run type-check` in the backend repo is still blocked by unrelated portfolio-script issues in
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/check-portfolio-health.ts` and
  `/Users/apple/Documents/Project/Backend/aurAlpha/scripts/test-portfolio-phase6.ts`

## Phase 7 start point

Phase 7 should harden the orders scheduler release path around the new workspace:

- add CI-grade multi-service E2E around the orders scheduler operator flow
- add release-grade checks for the Phase 5 migration foundation plus the Phase 6 workspace UX
- close any remaining gaps between scheduler health truth and a production promotion checklist
