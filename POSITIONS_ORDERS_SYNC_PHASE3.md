# Positions And Orders Sync Phase 3

Phase 3 migrates `positions-sync` to a user-scoped scheduler record while
freezing the trust boundary between admin scheduler execution and signed-in-user
product refresh.

## Goal

Move the live `positions-sync` config surface onto `scheduler_user_configs`
without breaking the all-users batch execution path, and keep `/positions` and
`/orders` product refreshes explicitly owned by the signed-in user.

## What Changed

### 1. `positions-sync` now uses a user-scoped scheduler record

`PositionsSchedulerService.ts` now treats the scheduler config as a
user-scoped scheduler record:

- canonical ownership is `schedulerType = user`
- per-actor config is created in `scheduler_user_configs`
- the legacy scheduler anchor in `scheduler_configs` is still created and
  normalized so defaults stay centralized during the migration
- attempts to switch the scheduler back to `global` are rejected

This gives the positions admin surface the target ownership model without
changing the actual batch execution behavior yet.

### 2. Manual positions runs are actor-owned at the scheduler layer

Queued positions runs, pause/resume controls, and purge/list/progress lookups
are now actor-aware:

- duplicate checks use actor-scoped scheduler commands and run logs
- queued runs and commands stamp the calling admin as `actorUserId`
- config mutation, pause, resume, stop, restart, purge, list, and progress all
  resolve through the actor-owned scheduler record

The execution context still stays `system` for all-users scheduler work, which
preserves the existing batch behavior while tightening operator ownership.

### 3. Product refresh remains signed-in-user owned

`BrokerPositionsFacadeService.ts` and `BrokerOrdersFacadeService.ts` still build
product-owned sync requests with:

- `executionScope = product_user`
- `requestUserId = signed-in user`
- `targetUserIds = [signed-in user]`

That keeps `/positions/futures/refresh` and `/orders/futures/refresh` anchored
to the authenticated product user even while the scheduler admin surface moves
to user-scoped records.

### 4. Internal scheduler routes remain system-owned

`InternalPositionsSchedulerController.ts` and
`InternalOrdersSchedulerController.ts` still normalize incoming sync payloads as
system-owned requests with:

- `executionScope = system_scheduler`
- `requestUserId = env.scheduler.systemUserId`
- `targetUserIds = [env.scheduler.systemUserId]`

That preserves the scheduler-or-cron all-users path and keeps internal routes
from trusting arbitrary `targetUserIds`.

## Non-Negotiables After Phase 3

- `positions-sync` admin config must resolve from `scheduler_user_configs`
- the legacy scheduler anchor must continue to provide normalized defaults
- `/positions` and `/orders` product refresh must stay signed-in-user owned
- scheduler or cron all-users execution must remain available
- internal scheduler routes must keep the system-owned path explicit

## Phase 4 Entry Checklist

1. Migrate `orders-sync` to the same user-scoped scheduler record model.
2. Validate provider-fetch behavior for all-users scheduler runs across Mudrex
   and Delta paths.
3. Confirm failure isolation so one bad account or provider response does not
   poison the whole positions or orders scheduler run.
