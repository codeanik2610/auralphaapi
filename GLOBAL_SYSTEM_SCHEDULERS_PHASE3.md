# Global System Schedulers Phase 3

Phase 3 localizes display-facing timestamps for these global system schedulers:

- `broker-assets-sync`
- `exchange-assets-sync`
- `binance-candles-3m-1m-sync`
- `system-health-sync`

## Contract

- These schedulers remain global system schedulers.
- Scheduler execution scope stays `system`.
- Display-facing scheduler timestamps are localized into the resolved user
  timezone.
- Raw UTC ISO companion fields stay available and stable.
- Response time metadata now explicitly reports localized display fields.
- Phase 2 initiator and execution-context fields stay unchanged.

## Phase 3 Outcome

Phase 3 does not change scheduler ownership or execution scope.

It does five things:

- localizes overview, run history, run progress, and update-log display fields
- localizes config summary timestamps for the four target schedulers
- localizes candles sync-state display timestamps
- keeps raw UTC ISO companions stable where they already exist and adds them
  where they were missing on targeted surfaces
- localizes CSV export timestamp columns while preserving raw UTC export truth

## Non-Negotiables

- DB/storage timestamps stay UTC
- raw UTC ISO companion fields must not be removed or renamed
- Phase 2 initiator fields must not be removed or renamed
- localized display fields must use the resolved user timezone, not scheduler
  ownership semantics
- global/system execution rules stay unchanged

## Transitional State After Phase 3

- Scheduler overview, recent-run, active-status, and run detail surfaces now
  return display-ready localized timestamps.
- Targeted config and sync-state responses now expose raw UTC ISO companions in
  addition to localized display fields.
- Update-log exports now include both localized `createdAt` and raw
  `createdAtIso`.
- Phase 4 should harden scheduler-scoped retention and purge behavior without
  changing the Phase 1/2/3 response contracts.

## Phase 4 Entry Checklist

1. Scope update-log retention and purge behavior by scheduler key.
2. Keep localized display fields and raw ISO companions stable.
3. Do not remove Phase 1 time metadata or Phase 2 initiator metadata.
