# Risk Scheduler Phase 4

Phase 4 freezes runtime proof and failure isolation for `risk-recompute-sync`.

## Goal

Lock the operator-facing runtime evidence before Phase 5 expands diagnostics:

- config responses keep additive raw UTC companions like `lastStartedAtIso` and
  `lastFinishedAtIso`
- run list and run-progress responses keep additive audit fields like
  `initiatedBy`, `executionContext`, and `currentItem.id`
- update-log APIs and CSV export keep inherited audit fields plus `createdAtIso`
- worker execution keeps partial-failure accounting instead of collapsing the
  whole batch
- scheduler runs with no real target users stay explicit skips instead of
  opaque no-op behavior

## What Changed

### 1. Risk scheduler runtime payloads now stay audit-complete

`RiskSchedulerService` keeps the additive runtime contract available to
operators:

- `lastStartedAtIso`
- `lastFinishedAtIso`
- `initiatedBy`
- `executionContext`
- `createdAtIso`
- `progress.currentItem.id`

Phase 4 freezes those fields so later phases can build on them instead of
changing the payload shape again.

### 2. Worker execution proves explicit partial-failure behavior

`SchedulerExecutionService.executeRiskRecomputeSync(...)` already posts
explicit `targetUserIds` to `/internal/risk/recompute`.

Phase 4 freezes the runtime proof around that path:

- successful runs emit an `updated` summary
- mixed-success runs emit a `partial` update log outcome
- detail payloads keep `actorUserId`, `targetUserIds`, and capacity counters
- progress updates move from `currentItem.id = risk-recompute` to a completed
  processed summary without hiding failures

### 3. No-target scheduler runs stay observable

When the worker resolves no real user-owned targets, it must not silently
pretend the batch succeeded.

Phase 4 freezes the explicit skip message:

- `Risk recompute skipped: no real connected target users were resolved`

That keeps ownerless or null-owned broker accounts out of the recompute target
set while still giving operators visible evidence in the update log.

## Non-Negotiables After Phase 4

- runtime responses must keep additive ISO audit fields instead of regressing
  to display-only timestamps
- run and progress payloads must keep `currentItem.id`
- update logs and export must keep inherited scheduler audit metadata
- worker batches must report partial failures without poisoning all-user
  scheduler execution
- no-target runs must stay explicit skipped outcomes

## Phase 5 Entry Checklist

1. Deepen diagnostics summary truth for targeted users, blockers, and latest
   recompute lineage.
2. Verify operator-facing summary counts stay aligned with the now-frozen
   runtime payloads.
3. Extend health and release checks to reason about blocker states rather than
   just runtime audit metadata.
4. Phase 5 should focus on diagnostics summary and blocker truth rather than runtime audit shape.

## Verification

Phase 4 completion used:

- `npm run test:risk-scheduler-phase4`
- `npm run test:risk-scheduler-phase3`
- `npm run test:risk-scheduler-phase2`
- `npm run test:risk-scheduler-phase1`
- `npm run test:controllers`
- `npm run type-check`
