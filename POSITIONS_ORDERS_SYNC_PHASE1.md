# Positions And Orders Sync Phase 1

Phase 1 freezes the target trust contract for `positions-sync` and
`orders-sync` before Phase 2 aligns the shared contract layer and before
later phases migrate live scheduler services onto that target.

## Contract

- `positions-sync` target ownership is a user-scoped scheduler record.
- `orders-sync` target ownership is a user-scoped scheduler record.
- Manual scheduler controls still require an authenticated admin actor, but
  that actor is control-plane context, not scheduler ownership.
- Scheduler or cron execution for `positions-sync` and `orders-sync` still uses
  the all-users batch path.
- Admin scheduler control routes stay anchored on `/scheduler/positions` and
  `/scheduler/orders`.
- `/positions` and `/orders` remain user-owned product surfaces.
- `/positions/futures/refresh` and `/orders/futures/refresh` may refresh only
  the signed-in user's own eligible broker accounts.
- Product-page refreshes delegate through `/internal/positions/sync` and
  `/internal/orders/sync` with `targetUserIds: [userId]`, not all users.
- Scheduler or cron scope must never leak all-users data into `/positions` or
  `/orders` product responses.

## Phase 1 Outcome

Phase 1 does not change runtime execution semantics yet.

It does four things:

- documents the frozen shared trust contract for `positions-sync` and
  `orders-sync`
- centralizes the route and surface markers for scheduler and product scope
- aligns the functional checklists to the target user-owned scheduler contract
- adds an automated guard so Phase 2 starts from an explicit ownership baseline
- makes the Phase 2 responsibility explicit for the shared contract-file
  alignment work

## Non-Negotiables

- `positions-sync` must converge on a user-scoped scheduler record without
  changing all-users batch execution
- `orders-sync` must converge on a user-scoped scheduler record without
  changing all-users batch execution
- `/positions` must remain a signed-in-user desk, not an all-users admin
  scheduler surface
- `/orders` must remain a signed-in-user desk, not an all-users admin scheduler
  surface
- `actorUserId` for scheduler controls is audit context only
- product refresh paths must not widen to all-users execution

## Transitional State After Phase 1

- Current runtime still enforces legacy global ownership in
  `PositionsSchedulerService.ts`.
- Current runtime still enforces legacy global ownership in
  `OrdersSchedulerService.ts`.
- Product refresh for `/positions` already calls internal sync with
  `targetUserIds: [userId]`.
- Product refresh for `/orders` already calls internal sync with
  `targetUserIds: [userId]`.
- The checklists now freeze the intended user-owned scheduler target without
  forcing runtime cutover in Phase 1.

## Phase 2 Entry Checklist

1. Align `positionsOrdersSyncScopeContract.ts` to the user-owned scheduler
   target.
2. Preserve separate markers for all-users batch execution and signed-in-user
   product refresh execution.
3. Preserve `/positions` and `/orders` as signed-in-user product refresh
   surfaces.
4. Do not migrate live scheduler services in Phase 2; that starts in Phase 3.
