# Candles Sync Functional Checklist

Scheduler key: `binance-candles-3m-1m-sync`  
Primary service: `src/api/services/CandlesSchedulerService.ts`  
Admin route base: `/scheduler/candles`  
Scope source table: `broker_assets`  
Primary storage path: Postgres candle storage  
Sync-state surface: `/scheduler/candles/sync-state`

Primary runtime contracts used for this checklist:

- `src/api/services/CandlesSchedulerService.ts`
- `src/api/controllers/CandlesSchedulerController.ts`
- `GLOBAL_SYSTEM_SCHEDULERS_PHASE3.md`
- `scripts/test-global-system-schedulers-phase3.ts`

Use this checklist to verify the full behavior of the `binance-candles-3m-1m-sync` scheduler, its global system scope, the system-asset selection contract, and the Postgres-backed sync-state surfaces that expose candle freshness.

## 1. Identity And Ownership

- [ ] Scheduler record exists with key `binance-candles-3m-1m-sync`.
- [ ] Scheduler name is `OHLCV Data Sync`.
- [ ] Scheduler description clearly states that it fetches 3 months of 1m candles from Binance for global system exchange assets and stores them in Postgres.
- [ ] Scheduler is normalized to `schedulerType = global`.
- [ ] Attempts to change it to `user` scope are rejected.
- [ ] `config.useSystemConnectionsOnly` is always forced to `true`.
- [ ] `config.useSystemAccountsOnly` is always forced to `true`.
- [ ] Legacy or partially migrated scheduler rows are normalized back to the expected global shape on read or update.

## 2. Route And Access

- [ ] Admin-only route works through `/scheduler/candles/config`.
- [ ] Admin-only route works through `/scheduler/candles/run`.
- [ ] Admin-only route works through `/scheduler/candles/pause`.
- [ ] Admin-only route works through `/scheduler/candles/resume`.
- [ ] Admin-only route works through `/scheduler/candles/stop`.
- [ ] Admin-only route works through `/scheduler/candles/restart`.
- [ ] Admin-only route works through `/scheduler/candles/purge-logs`.
- [ ] Admin-only route works through `/scheduler/candles/purge-logs/preview`.
- [ ] Admin-only route works through `/scheduler/candles/runs`.
- [ ] Admin-only route works through `/scheduler/candles/assets`.
- [ ] Admin-only route works through `/scheduler/candles/sync-state`.
- [ ] Admin-only route works through `/scheduler/candles/runs/:runId/progress`.
- [ ] Admin-only route works through `/scheduler/candles/runs/:runId/updates`.
- [ ] Admin-only route works through `/scheduler/candles/runs/:runId/updates/export`.

## 3. Default Config

- [ ] Missing config is auto-created.
- [ ] Default `enabled` is `false`.
- [ ] Default cron is `0 1 * * *`.
- [ ] Default `runAt` is `01:00`.
- [ ] Default `intervalDays` is `1`.
- [ ] Default `batchSize` is `200`.
- [ ] Default timezone is the normalized scheduler timezone.
- [ ] Default source list is `['binance']`.
- [ ] Default `selectionMode` is `all`.
- [ ] Default `selectedAssetIds` is an empty list.
- [ ] Default `maxLookbackDays` is `90`.
- [ ] Default retention is `30` days.
- [ ] Default schedule mode falls back to `daily` when unset or invalid.

## 4. Config Update Behavior

- [ ] `enabled` can be updated.
- [ ] `name` can be updated.
- [ ] `description` can be updated.
- [ ] `cronExpression` can be updated.
- [ ] `runAt` can be updated.
- [ ] `intervalDays` can be updated.
- [ ] `batchSize` can be updated.
- [ ] `sources` can be updated.
- [ ] `selectionMode` can be updated between `all` and `custom`.
- [ ] `selectedAssetIds` can be updated.
- [ ] `maxLookbackDays` can be updated within the supported range.
- [ ] `retentionDays` can be updated.
- [ ] `scheduleMode` can be updated.
- [ ] `intervalMinutes` can be updated.
- [ ] `intervalSeconds` can be updated.
- [ ] `hourlyMinute` can be updated.
- [ ] Disabling the scheduler cancels pending queued commands for this scheduler.
- [ ] Invalid scope change to `user` is rejected with a clear error.

## 5. System Scope And Binance Execution Behavior

- [ ] Manual run uses the global system execution path, not the admin actor's personal credentials.
- [ ] Cron or scheduled runs use the same global system execution path as manual runs.
- [ ] No interactive actor-specific connection context is required for cron execution.
- [ ] Manual and scheduled runs derive scope from system exchange assets, not user-owned account lists.
- [ ] Binance failures are isolated so they do not corrupt scheduler metadata or other system schedulers.
- [ ] Run metadata records the selected asset scope.

## 6. Asset Scope, Sync-State, And Postgres Candle Coverage

- [ ] `/scheduler/candles/assets` returns the system asset scope exposed to the scheduler UI.
- [ ] `selectedAssetIds` refer to asset identifiers surfaced by `/scheduler/candles/assets`.
- [ ] `selectionMode = custom` uses only the selected asset ids.
- [ ] `selectionMode = all` resolves all eligible system exchange assets from `broker_assets`.
- [ ] Empty custom scope is rejected with a clear validation error.
- [ ] `GET /sync-state` returns paginated candle sync-state rows for this scheduler.
- [ ] Sync-state rows expose symbol, asset identity, last synced boundaries, and freshness or stale-day semantics.
- [ ] Sync-state is backed by Postgres candle truth rather than ad hoc in-memory state.
- [ ] A successful run stores candles in Postgres for the selected asset scope.
- [ ] Manual and cron runs produce equivalent candle coverage when run against the same asset scope and lookback window.

## 7. Manual Run Behavior

- [ ] `runNow` rejects missing `actorUserId`.
- [ ] `runNow` rejects when the scheduler is paused.
- [ ] `runNow` rejects when `env.scheduler.executionMode !== 'queue'`.
- [ ] `runNow` resolves the selected scope before queueing work.
- [ ] `runNow` creates a queued run log row with status `Queued`.
- [ ] `runNow` creates a `run_now` command row.
- [ ] `runNow` includes progress metadata in the queued run log.
- [ ] `runNow` prevents duplicate queueing when a `run_now` command is already `Pending` or `Processing`.
- [ ] `runNow` returns the existing queued run instead of creating a duplicate when one is already queued.
- [ ] `runNow` refuses to queue a second run when a run is already actively executing.

## 8. Pause / Resume / Stop / Restart

- [ ] `pause` flips `enabled` to `false`.
- [ ] `pause` cancels pending commands for this scheduler.
- [ ] `resume` flips `enabled` to `true`.
- [ ] `stop` is only allowed in queue mode.
- [ ] `stop` cancels pending `run_now` commands.
- [ ] `stop` queues `stop_now` only when a run is actually active.
- [ ] `stop` returns `noop` when there is nothing running or queued.
- [ ] `restart` is rejected when the scheduler is paused.
- [ ] `restart` is only allowed in queue mode.
- [ ] `restart` cancels pending `run_now` commands before requeueing.
- [ ] `restart` queues `stop_now` first when a run is active.
- [ ] `restart` always queues a new `run_now`.

## 9. Run Logs And Progress

- [ ] `GET /runs` returns paginated run logs for only `binance-candles-3m-1m-sync`.
- [ ] `GET /runs/:runId/progress` returns the selected run or `run: null` when missing.
- [ ] Run log item includes `id`, `schedulerKey`, `status`, `startedAt`, `finishedAt`, and `durationMs`.
- [ ] Each run log includes who initiated or performed the run, showing admin actor for manual runs and system actor or system context for cron runs.
- [ ] Run log item includes counters such as `processedAccounts`, `insertedAssets`, `updatedAssets`, and `skippedAssets`.
- [ ] The same captured counters are reflected correctly in recent run, run progress, and scheduler ops surfaces.
- [ ] Progress block returns `total`, `processed`, `percent`, and optional `etaSeconds`.
- [ ] Current item block identifies the current symbol or asset being processed when available.
- [ ] Missing or malformed `meta` does not break run log rendering.

## 10. Update Logs And Export

- [ ] `GET /runs/:runId/updates` supports pagination.
- [ ] `GET /runs/:runId/updates` supports filtering by `actionType`.
- [ ] `GET /runs/:runId/updates` supports filtering by `source`.
- [ ] `GET /runs/:runId/updates` supports filtering by `symbol`.
- [ ] `GET /runs/:runId/updates` supports validated sorting.
- [ ] Update rows return `id`, `runLogId`, `source`, `actionType`, `symbol`, `externalId`, `assetId`, `message`, and `createdAt`.
- [ ] Each update log includes who performed the action or which system actor or process generated it.
- [ ] `GET /runs/:runId/updates/export` returns a CSV with the same filtered dataset.
- [ ] Export filename is `scheduler-run-<runId>-updates.csv`.
- [ ] CSV escaping is correct for quotes and commas in `message`.

## 11. Retention And Purge

- [ ] Purge preview returns the expected `retentionDays`.
- [ ] Purge preview returns the count of run logs to delete.
- [ ] Purge preview returns the count of update logs to delete for this scheduler only.
- [ ] Purge deletes only run logs older than retention for this scheduler.
- [ ] Purge deletes only update logs owned by this scheduler.
- [ ] Purge response accurately reports deleted run log count and deleted update log count.

## 12. Activity And Alerting

- [ ] Successful config updates create an activity log entry.
- [ ] Failed config updates create a failure activity log entry.
- [ ] Successful queue actions create an activity log entry.
- [ ] Failed queue actions create a failure activity log entry.
- [ ] Activity or audit logs show who performed the action, including admin actor for manual controls and system actor for scheduled execution.
- [ ] Queue failures emit scheduler alerts.
- [ ] Alert throttling prevents duplicate high-frequency failure alerts.
- [ ] Alert source is `binance-candles-3m-1m-sync`.

## 13. Scheduling Semantics

- [ ] Scheduled execution respects the scheduler config, not ad hoc hardcoded values.
- [ ] Schedule modes behave correctly: `daily`, `every_n_minutes`, `every_n_seconds`, `hourly_at_minute`.
- [ ] Invalid schedule mode safely falls back to `daily`.
- [ ] Interval minute bounds are enforced.
- [ ] Interval second bounds are enforced.
- [ ] Hourly minute bounds are enforced.
- [ ] Next scheduled runs are generated without duplicate overlapping execution.
- [ ] Manual and cron runs produce equivalent candle-sync behavior when run against the same selected asset scope and lookback window.

## 14. Time And Timezone Checks

- [ ] Config timezone returned by the API matches the expected scheduler timezone.
- [ ] Stored run timestamps are understood to be emitted as raw UTC ISO companions.
- [ ] Sync-state exposes localized display timestamps plus raw UTC ISO companions such as `syncedFromIso`, `syncedToIso`, and `lastSyncedAtIso`.
- [ ] Display-facing config, run, update-log, and sync-state timestamps are localized for the requesting actor.
- [ ] Shared `time` metadata remains present and truthful on config, run, update, and sync-state surfaces.

