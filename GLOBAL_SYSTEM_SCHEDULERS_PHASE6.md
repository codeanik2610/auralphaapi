# Global System Schedulers Phase 6

Phase 6 hardens runtime truth for these global system schedulers:

- `broker-assets-sync`
- `exchange-assets-sync`
- `binance-candles-3m-1m-sync`
- `system-health-sync`

## Contract

- Phase 1 through Phase 5 contracts stay stable.
- The worker now preserves global/system ownership semantics for these schedulers.
- Worker-written run logs keep `actor_user_id` null for global system schedulers.
- Worker-written run logs now persist `initiated_by_type`,
  `initiated_by_user_id`, `initiated_by_label`, and `execution_context`.
- Worker-written update logs now persist the same audit fields as the run log.
- Manual global runs keep system execution scope while retaining the real human
  initiator in audit fields.
- Cron/global scheduled runs record a system cron initiator instead of
  backfilling actor ownership.

## Phase 6 Outcome

Phase 6 does not redesign the API payload again.

It does four things:

- propagates audit metadata from queued commands into worker execution payloads
- keeps persisted actor ownership null for global system scheduler commands and
  run logs
- stamps worker-created run logs and update logs with explicit initiator and
  execution-context fields
- makes worker activity logging prefer the real initiator on manual global runs

## Non-Negotiables

- do not repopulate `actor_user_id` for global system schedulers
- do not remove the Phase 5 `recentRun` or `ops` contract
- do not let cron-created system commands masquerade as user-owned runs
- the worker and API repos must agree on the same audit field names and meaning

## Verification

- Worker repo:
  `/Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker`
- Verified commands:
  - `cd /Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker && npm run test:reconciliation`
  - `cd /Users/apple/Documents/Project/Backend/aurAlphaSchedulerWorker && npm run test:operational-audit`

## Transitional State After Phase 6

- The overview payload from Phase 5 is now backed by worker-written audit and
  progress truth instead of only queue-time placeholders.
- Manual and cron global runs now keep system execution scope without losing
  “who initiated this” traceability.
- Phase 7 can focus on frontend consumption and operator UX on top of this
  stable worker/runtime contract.

## Phase 7 Entry Checklist

1. Keep the Phase 1 to Phase 6 backend and worker contracts unchanged.
2. Consume the stable `recentRun`, `ops`, initiator, and localized time fields
   in the frontend without fallback reconstruction where possible.
3. Keep manual global runs visually attributable to the initiating admin while
   preserving system execution scope.
