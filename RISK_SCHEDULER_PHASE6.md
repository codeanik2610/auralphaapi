# Risk Scheduler Phase 6

Phase 6 localizes diagnostics display timestamps for `risk-recompute-sync`.

## Goal

Keep the Phase 5 diagnostics truth intact while making the operator-facing
summary timezone-safe for real admin users.

This phase addresses the exact failure mode behind the timezone confusion:

- the admin summary already resolved the actor timezone
- the summary still serialized its key timestamps with raw UTC ISO strings
- admin users in `Asia/Calcutta` or `Asia/Kolkata` therefore saw scheduler
  diagnostics that looked shifted even though the runtime accepted the timezone

`Asia/Calcutta` remains a valid IANA timezone alias in the runtime and must keep
working exactly like `Asia/Kolkata`.

## What Changed

### 1. Diagnostics summary timestamps now localize for display

`RiskSchedulerService.getSchedulerDiagnosticsSummary(...)` now returns localized
display timestamps for:

- `latestSnapshotAt`
- `latestControlAt`
- `latestAlertAt`
- `latestScenarioAt`
- `latestRun.startedAt`
- `latestRun.finishedAt`

Those display fields are now rendered in the resolved admin timezone instead of
always echoing UTC-shaped values.

### 2. Raw UTC truth stays available beside display fields

Phase 6 keeps raw scheduler truth explicit with:

- `latestSnapshotAt` plus `latestSnapshotAtIso`
- `latestControlAt` plus `latestControlAtIso`
- `latestAlertAt` plus `latestAlertAtIso`
- `latestScenarioAt` plus `latestScenarioAtIso`
- `latestRun.startedAt` plus `latestRun.startedAtIso`
- `latestRun.finishedAt` plus `latestRun.finishedAtIso`

That makes the operator surface readable without losing audit-safe UTC values.

### 3. The summary now advertises the shared scheduler time contract

`/scheduler/risk/summary` now returns `time` with:

- `time.displayTimeZone`
- `time.storageTimeZone`
- `time.rawTimeFields`
- `time.displayTimesLocalized`

That matches the scheduler phase-6 contract already used by other operator
surfaces in the platform.

### 4. Health and release workflow now enforce the timezone contract

`check-risk-scheduler-health.ts` now validates the summary time contract and
logs both localized display timestamps and their raw ISO companions.

Phase 8 and final signoff must keep this timezone contract in the release gate.

## Non-Negotiables After Phase 6

- Phase 5 blocker counts and diagnostics truth must not change
- `time.displayTimeZone` must reflect the resolved admin timezone
- raw UTC ISO companions must stay present when display timestamps are present
- `Asia/Calcutta` must remain accepted and produce correct localized output
- release gate and signoff must keep the Phase 6 timezone contract wired in

## Verification

Phase 6 completion uses:

- `npm run test:risk-scheduler-phase6`
- `npm run test:risk-scheduler-phase5`
- `npm run test:risk-scheduler-phase8`
- `npm run test:controllers`
- `npm run type-check`
