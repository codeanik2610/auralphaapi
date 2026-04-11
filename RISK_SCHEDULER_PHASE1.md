# Risk Scheduler Phase 1

Phase 1 freezes the backend contract for `risk-recompute-sync` before deeper
operator and runtime phases build on it.

## Contract

- `risk-recompute-sync` is a user-owned scheduler record with
  `schedulerType = user`.
- Admin scheduler controls remain on `/scheduler/risk/*`.
- scheduler or cron execution fans out across all eligible user-owned connections in the system.
- Scheduler or cron execution does not collapse to the admin actor's own desk.
- `/risk/recompute` stays own-user only.
- `/internal/risk/recompute` remains the worker batch handoff.
- `userId = null` connections are excluded from the scheduler target set.
- Diagnostics continue to measure all eligible real users, not only users who
  already have risk snapshots.
- Phase 1 does not change the all-users scheduler recompute path or the own-user product recompute path.

## Phase 1 Outcome

Phase 1 does four things:

- documents the frozen ownership and trust split for `risk-recompute-sync`
- aligns the scheduler config and run-control plane to user-owned scheduler rows
- keeps scheduler or cron execution on the existing all-users recompute path
- adds an automated guard so Phase 2 starts from an explicit contract

## Non-Negotiables

- `risk-recompute-sync` must remain `schedulerType = user`
- scheduler or cron runs must keep all-users execution scope
- `/risk/recompute` must remain limited to the signed-in user's own connections
- `userId = null` broker connections must stay out of the scheduler target set
- future phases must not blur admin scheduler execution with product own-user
  recompute

## Phase 2 Entry Checklist

1. Build the admin/operator surface on top of the user-owned risk scheduler row.
2. Preserve the all-users scheduler fan-out while expanding run-state visibility.
3. Keep `/risk/recompute` and `/risk/overview` on the own-user trust boundary.
4. Carry `userId != null` targeting rules through any later runtime refactors.
