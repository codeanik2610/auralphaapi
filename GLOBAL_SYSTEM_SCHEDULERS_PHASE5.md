# Global System Schedulers Phase 5

Phase 5 freezes the richer overview payload for these global system schedulers:

- `broker-assets-sync`
- `exchange-assets-sync`
- `binance-candles-3m-1m-sync`
- `system-health-sync`

## Contract

- These schedulers remain global system schedulers.
- Storage stays UTC.
- Display localization and raw UTC ISO companions from Phase 3 stay unchanged.
- Scheduler-scoped purge and retention behavior from Phase 4 stays unchanged.
- The overview payload now carries an explicit `recentRun` snapshot.
- The overview payload now carries an explicit `ops` snapshot.
- Top-level active-status fields stay backward compatible.

## Phase 5 Outcome

Phase 5 does not change ownership, execution scope, or retention behavior.

It does four things:

- expands overview run-log queries to include duration and counters
- exposes `hasQueuedWork` directly on overview rows
- publishes `recentRun` with status, timing, counters, error, progress, and
  initiator metadata
- publishes `ops` with active status, queue truth, latest run status, latest
  outcome, latest error, and latest-finished timestamps

## Non-Negotiables

- do not remove the top-level overview fields that existing clients already use
- do not overload audit/ownership semantics while adding overview richness
- do not rework Phase 3 localized display fields or Phase 4 purge behavior
- `recentRun` must describe the latest actual run, not a queued command
- `ops` must summarize active status and latest outcome without forcing clients
  to infer them from multiple endpoints

## Transitional State After Phase 5

- Broker assets, exchange assets, candles, and system health now share the same
  richer scheduler overview contract.
- Recent-run, scheduler ops, and active-status surfaces can read from one stable
  backend payload instead of re-deriving counters and latest outcome from
  separate run queries.
- Phase 6 should implement worker/runtime truth against this stable overview
  contract instead of redesigning the response shape again.

## Phase 6 Entry Checklist

1. Keep the Phase 1, 2, 3, 4, and 5 overview contract stable.
2. Make worker/runtime updates populate the same counters and progress fields
   that Phase 5 now exposes.
3. Keep manual-vs-cron execution scope system-owned while carrying truthful
   initiator and progress data through the worker path.
