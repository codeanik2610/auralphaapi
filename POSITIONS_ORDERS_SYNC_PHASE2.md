# Positions And Orders Sync Phase 2

Phase 2 aligns the shared contract layer for the `positions-sync` and
`orders-sync` target that Phase 1 froze.

## Goal

Move the shared route and ownership contract to the target user-owned scheduler
model without changing the signed-in-user trust boundary for `/positions` and
`/orders`, and without migrating live scheduler services yet.

## What Changed

### 1. Shared ownership constants now express the target user-scoped model

`positionsOrdersSyncScopeContract.ts` now freezes:

- `positions-sync` target ownership as `user`
- `orders-sync` target ownership as `user`
- admin route markers for `/scheduler/positions` and `/scheduler/orders`
- internal route markers for `/internal/positions/sync` and `/internal/orders/sync`
- explicit separation between all-users batch execution and signed-in-user
  product execution

### 2. Shared batch execution helpers stay separate from product refresh helpers

The shared contract file still preserves two different execution scopes:

- `system_scheduler` for all-users batch work
- `product_user` for signed-in-user product refresh work

The request builders continue to encode this split so later runtime phases can
migrate services without reopening the trust-boundary decision.

### 3. Legacy runtime ownership remains intentionally unchanged in service code

Phase 2 does not migrate:

- `PositionsSchedulerService.ts`
- `OrdersSchedulerService.ts`
- scheduler overview ownership behavior
- health-check expectations

Those services still enforce the legacy global runtime model, and that is
intentional. Phase 3 starts the live-service migration.

### 4. Product-page trust boundaries remain unchanged

Phase 2 does not widen product refresh scope.

- `/positions/futures/refresh` stays signed-in-user owned
- `/orders/futures/refresh` stays signed-in-user owned
- both still delegate through internal sync with `targetUserIds: [userId]`

## Non-Negotiables After Phase 2

- The shared contract layer now says `positions-sync` and `orders-sync` are
  user-owned schedulers.
- All-users batch execution remains explicit and separate from product refresh
  execution.
- Live scheduler services remain on the legacy global runtime model until their
  migration phases.
- `/positions` remains a signed-in-user desk
- `/orders` remains a signed-in-user desk
- product refresh paths must not widen to all-users execution

## Phase 3 Entry Checklist

1. Migrate `PositionsSchedulerService.ts` from the legacy global ownership
   model to the shared user-owned scheduler target.
2. Keep all-users batch execution intact while moving positions config storage
   and normalization to the user-owned model.
3. Preserve `/positions` as a signed-in-user product surface.
4. Leave `OrdersSchedulerService.ts` on the legacy runtime model until its
   later migration phase.
