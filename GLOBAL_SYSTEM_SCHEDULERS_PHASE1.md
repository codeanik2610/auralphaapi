# Global System Schedulers Phase 1

Phase 1 freezes the shared backend contract for these global system schedulers:

- `broker-assets-sync`
- `exchange-assets-sync`
- `binance-candles-3m-1m-sync`
- `system-health-sync`

## Contract

- These schedulers are global system schedulers. They are not user-owned schedulers.
- Scheduler execution scope stays system-owned for both manual and cron-triggered runs.
- Manual controls still require an authenticated admin actor, but that actor is control-plane context,
  not scheduler ownership.
- Storage stays UTC.
- Existing scheduler timestamp fields remain backward compatible in Phase 1.
- Phase 1 introduces explicit raw UTC ISO companion fields and shared time-contract metadata so later
  phases can localize display fields without breaking clients.

## Phase 1 Outcome

Phase 1 does not change scheduler execution behavior.

It does four things:

- documents the global system scheduler contract
- freezes a shared scheduler time contract in the backend API types
- adds explicit time-contract metadata to the overview and targeted scheduler run surfaces
- adds an automated guard so Phase 2 starts from an explicit frozen contract

## Non-Negotiables

- `scheduler_run_logs.actor_user_id` must not be reused as ownership for these global schedulers
- `scheduler_commands.actor_user_id` must not be reused as ownership for these global schedulers
- no new feature should infer user scope from run-log ownership fields on these schedulers
- no Phase 2 audit work should reintroduce user ownership semantics for global runs

## Transitional State After Phase 1

- Raw UTC remains the storage contract.
- API time metadata now explicitly says whether display fields are localized.
- In Phase 1, display fields are still transitional UTC-compatible values.
- Phase 2 must add explicit initiator and audit fields without changing global ownership.
- Phase 3 must localize display fields while keeping raw UTC ISO companions stable.

## Phase 2 Entry Checklist

1. Add explicit initiator and audit fields for manual and cron runs.
2. Keep execution context fixed to system scope.
3. Do not overload `actor_user_id` with ownership meaning.
4. Extend run logs, update logs, and overview items with truthful initiator metadata.
