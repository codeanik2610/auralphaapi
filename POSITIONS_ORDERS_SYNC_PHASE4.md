# Positions And Orders Sync Phase 4

Phase 4 finishes the scheduler-record migration for `orders-sync` and confirms
that the all-users provider-runtime path still behaves correctly for both
`positions-sync` and `orders-sync`.

## Goal

Move `orders-sync` onto the same user-scoped scheduler record model as
`positions-sync`, then prove that Mudrex and Delta all-users runs still route
through real account owners and isolate failures correctly.

## What Changed

### 1. `orders-sync` now uses a user-scoped scheduler record

`OrdersSchedulerService.ts` now mirrors the Phase 3 positions runtime model:

- canonical ownership is `schedulerType = user`
- per-actor config is created in `scheduler_user_configs`
- the legacy scheduler anchor in `scheduler_configs` is still created and
  normalized for shared defaults
- attempts to switch the scheduler back to `global` are rejected

Queued runs, pause/resume controls, replay actions, purge/list/progress lookups,
and actor traceability now resolve through the calling admin's scheduler record.

### 2. Scheduler execution still stays system-owned for all-users batches

Even though both scheduler records are now user-owned:

- all-users scheduler execution still runs with the system execution context
- internal scheduler routes still normalize to `executionScope = system_scheduler`
- `/positions` and `/orders` product refresh remain signed-in-user owned

This keeps ownership and execution semantics distinct instead of conflating
config storage with runtime fanout behavior.

### 3. Provider-runtime coverage stays correct across Mudrex and Delta

`InternalPositionsSyncService.ts` and `InternalOrdersSyncService.ts` continue to
group eligible accounts by real owner during `system_scheduler` execution.

That means:

- the system scheduler path enumerates all eligible user-owned accounts
- Mudrex and Delta routing runs with the real owner context
- ownerless system accounts are not part of the user batch path
- the legacy `getActiveSystemBrokerAccounts()` path is not used for the
  infra-wide all-users scheduler run

### 4. Failure isolation is proven at the account and user-group level

Both services now prove the same runtime expectations:

- one failed provider account does not poison unrelated successful accounts
- a user with at least one successful account can still complete successfully
- a user whose scoped accounts all fail is counted in `failedUsers`
- emitted failures carry explicit account context such as
  `positions sync failed for account acct-1 (mudrex): ...` and
  `orders sync failed for account acct-2 (delta_exchange): ...`

## Non-Negotiables After Phase 4

- `positions-sync` and `orders-sync` admin config must both resolve from
  `scheduler_user_configs`
- the legacy scheduler anchor must continue to provide normalized defaults
- all-users scheduler execution must stay system-owned
- Mudrex and Delta accounts must route through the correct owner context
- one failed provider account must not poison unrelated successful accounts

## Phase 5 Entry Checklist

1. Standardize richer recent-run, progress, and ops truth for positions and
   orders scheduler surfaces.
2. Make sure counters and actor traceability line up with the improved runtime
   truth from Phase 4.
3. Add dashboard-facing proofs for recent run, active status, and scheduler ops
   behavior.
