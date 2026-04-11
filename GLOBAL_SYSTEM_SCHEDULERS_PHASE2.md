# Global System Schedulers Phase 2

Phase 2 adds an explicit initiator and audit contract for these global system
schedulers:

- `broker-assets-sync`
- `exchange-assets-sync`
- `binance-candles-3m-1m-sync`
- `system-health-sync`

## Contract

- These schedulers remain global system schedulers.
- Scheduler ownership does not move back to users.
- Manual admin actions record who requested the action separately from
  scheduler ownership.
- Cron or system-triggered actions record a system initiator separately from
  scheduler ownership.
- Execution scope stays `system` for these schedulers.
- Run logs, commands, update logs, and overview responses now expose explicit
  initiator metadata through a shared backend contract.

## Phase 2 Outcome

Phase 2 does not change scheduler execution scope.

It does four things:

- adds additive initiator and execution-context persistence fields
- records manual control-plane initiators on queued runs and commands
- exposes explicit initiator metadata in scheduler API responses
- backfills historical global-system scheduler audit data on a best-effort basis

## Non-Negotiables

- `actor_user_id` remains non-authoritative for global scheduler ownership
- no new code should infer user scope from global scheduler audit fields
- initiator metadata answers who requested or generated work
- execution context answers where the scheduler is allowed to run
- for these four schedulers, execution context stays `system`

## Transitional State After Phase 2

- Manual runs and manual stop/restart commands can now identify the requesting
  admin actor.
- Historical rows are best-effort backfilled from existing actor, trigger,
  payload, and meta data.
- Update-log responses may inherit initiator metadata from the parent run when
  the row itself does not yet carry explicit initiator columns.
- Phase 3 should localize display timestamps on top of this now-stable audit
  contract instead of inventing a separate time-only path.

## Phase 3 Entry Checklist

1. Localize display timestamps while keeping raw UTC companions stable.
2. Use the new initiator contract in localized overview, recent-run, and
   detail surfaces.
3. Do not remove or rename the Phase 2 initiator fields during the Phase 3
   timezone sweep.
