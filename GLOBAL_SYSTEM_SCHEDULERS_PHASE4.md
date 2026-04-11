# Global System Schedulers Phase 4

Phase 4 hardens retention and purge behavior for these global system
schedulers:

- `broker-assets-sync`
- `exchange-assets-sync`
- `binance-candles-3m-1m-sync`
- `system-health-sync`

## Contract

- These schedulers remain global system schedulers.
- Storage stays UTC.
- Display localization and raw UTC ISO companions from Phase 3 stay unchanged.
- Update-log retention and purge behavior is now scoped by `scheduler_key`.
- Purging one global system scheduler must not delete another scheduler's update
  logs.
- Update logs are deleted before run logs for these schedulers.

## Phase 4 Outcome

Phase 4 does not change ownership, initiator metadata, or localized display
fields.

It does four things:

- scopes update-log purge preview counts by scheduler key
- scopes update-log deletion by scheduler key
- returns truthful `updateLogsDeleted` and `updateLogsToDelete` values for all
  four target schedulers
- aligns delete order so update logs are removed before run logs

## Non-Negotiables

- do not use table-wide update-log retention methods for these four schedulers
- preview counts must match the same scheduler-scoped deletion contract
- Phase 1/2/3 contracts must stay stable
- purge/reporting must not rely on actor ownership semantics for these global
  schedulers

## Transitional State After Phase 4

- Broker assets, exchange assets, candles, and system health now report
  scheduler-scoped update-log retention truth.
- Exchange assets and system health no longer hardcode zero update-log cleanup.
- Scheduler-scoped update-log retention keys off the owning scheduler and the
  update-log age, not table-wide cleanup.
- Phase 5 should build on this stable cleanup contract instead of reworking
  retention paths again.

## Phase 5 Entry Checklist

1. Keep scheduler-scoped purge counts and deletion behavior unchanged.
2. Keep Phase 1/2/3 response contracts unchanged.
3. Build any richer ops/recent-run behavior on top of the now-stable cleanup
   contract.
