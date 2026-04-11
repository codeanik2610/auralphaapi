# Risk Scheduler Phase 3

Phase 3 freezes the internal execution contract for `risk-recompute-sync`.

## Goal

Make the execution split explicit:

- `/risk/recompute` remains signed-in-user only.
- `/internal/risk/recompute` remains the scheduler-facing batch route.
- scheduler or cron execution still fans out across all real user-owned connections.
- `userId = null` connections are excluded from the scheduler target set.

## What Changed

### 1. Product recompute stays owned by the signed-in user

`RiskController.recomputeRiskSnapshot(...)` continues to call
`RiskService.recomputeRiskSnapshot(...)` with `requireAuthUserId(request)`.

That keeps product-triggered recompute limited to the requesting user's own
connections instead of widening into an all-users scheduler pass.

### 2. The internal batch route keeps the scheduler handoff explicit

`InternalRiskSchedulerController.recomputeBatch(...)` continues to normalize:

- `actorUserId`
- `targetUserIds`

The route trims and de-duplicates incoming target users, drops empty values,
and falls back to `env.scheduler.systemUserId` only when the caller does not
provide a real actor.

### 3. Batch recompute now normalizes explicit targets in the service layer too

`RiskService.recomputeRiskSnapshotBatch(...)` now trims, de-duplicates, and
drops empty `targetUserIds` before iterating.

That means direct service callers cannot accidentally widen or duplicate the
internal batch payload just by bypassing the controller.

### 4. The worker keeps all-users scheduler execution separate from product runs

`SchedulerCommandPoller.buildRiskScheduledScope(...)` and
`SchedulerCommandPoller.listRiskTargetUserIds(...)` resolve scheduler targets
from `broker_accounts.user_id` and explicitly exclude null or blank owners.

`SchedulerExecutionService.executeRiskRecomputeSync(...)` then:

- resolves all real target users with system visibility
- keeps the scheduler owner's `actorUserId`
- posts the explicit `targetUserIds` batch to `/internal/risk/recompute`

## Non-Negotiables After Phase 3

- `/risk/recompute` must stay signed-in-user scoped.
- `/internal/risk/recompute` must stay the explicit batch handoff for scheduler
  or cron execution.
- scheduler or cron runs must only target real user-owned connections.
- `userId = null` or blank owners must stay excluded from scheduler target
  resolution.
- direct `RiskService.recomputeRiskSnapshotBatch(...)` callers must not rely on
  raw unsanitized `targetUserIds`.

## Phase 4 Entry Checklist

1. Add runtime proof for scheduler payloads, run logs, and update logs across
   real all-users recompute coverage.
2. Verify failure isolation so one user-level recompute failure does not poison
   the whole scheduler batch.
3. Confirm operator-facing diagnostics continue to match the internal execution
   split.
4. Phase 4 should focus on runtime proof and failure isolation rather than reopening the execution split.

## Verification

Phase 3 completion used:

- `npm run test:risk-scheduler-phase3`
- `npm run test:risk-scheduler-phase2`
- `npm run test:risk-scheduler-phase1`
- `npm run test:controllers`
- `npm run type-check`
