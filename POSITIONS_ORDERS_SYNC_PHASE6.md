## Positions And Orders Sync Phase 6

Phase 6 localizes shared scheduler display timestamps for `positions-sync` and `orders-sync` without changing UTC storage.

This phase builds directly on the additive audit contract frozen in Phase 5:

- Config responses now expose localized `lastStartedAt` and `lastFinishedAt` values plus response-level `time` metadata.
- Run list, run progress, and update-log responses now render display timestamps in the resolved user timezone while keeping the raw UTC `*Iso` companions from Phase 5.
- Orders and positions sync-state list or summary responses now expose shared `time` metadata and localize checkpoint or retry or freshness timestamps.
- UTC storage remains unchanged; the backend still returns raw ISO companion fields where Phase 5 already introduced them.
- The fallback timezone for direct service use stays the scheduler default, so script-level guards can run outside DI without drifting the runtime contract.

Phase 7 should build on this stable shared timezone contract and finish the remaining positions-specific and orders-specific operational surfaces without redefining shared scheduler time behavior again.
