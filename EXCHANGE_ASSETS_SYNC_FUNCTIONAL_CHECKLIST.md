# Exchange Assets Sync Functional Checklist

Scheduler key: `exchange-assets-sync`  
Primary service: `src/api/services/BinanceAssetsSchedulerService.ts`  
Admin route base: `/scheduler/binance-assets`

Use this checklist to verify the full behavior of the `exchange-assets-sync` scheduler, not just whether a run starts.

## 1. Identity And Ownership

- [ ] Scheduler record exists with key `exchange-assets-sync`.
- [ ] Scheduler name is `Exchange Assets Sync`.
- [ ] Scheduler description matches the system-global exchange asset sync purpose.
- [ ] Scheduler is normalized to `schedulerType = global`.
- [ ] Attempts to change it to `user` scope are rejected.
- [ ] `config.useSystemConnectionsOnly` is always forced to `true`.
- [ ] Legacy or partially migrated scheduler rows are normalized back to the expected global shape on read/update.

## 2. Route And Access

- [ ] Admin-only route works through `/scheduler/binance-assets/config`.
- [ ] Admin-only route works through `/scheduler/binance-assets/run`.
- [ ] Admin-only route works through `/scheduler/binance-assets/pause`.
- [ ] Admin-only route works through `/scheduler/binance-assets/resume`.
- [ ] Admin-only route works through `/scheduler/binance-assets/stop`.
- [ ] Admin-only route works through `/scheduler/binance-assets/restart`.
- [ ] Admin-only route works through `/scheduler/binance-assets/runs`.
- [ ] Admin-only route works through `/scheduler/binance-assets/runs/:runId/progress`.
- [ ] Admin-only route works through `/scheduler/binance-assets/runs/:runId/updates`.
- [ ] Admin-only route works through `/scheduler/binance-assets/runs/:runId/updates/export`.
- [ ] Team is aware that the controller path still says `binance-assets` while the scheduler key is `exchange-assets-sync`.

## 3. Default Config

- [ ] Missing config is auto-created.
- [ ] Default `enabled` is `false`.
- [ ] Default cron is `0 1 * * *`.
- [ ] Default `runAt` is `01:00`.
- [ ] Default `intervalDays` is `1`.
- [ ] Default `batchSize` is `50`.
- [ ] Default timezone is the normalized scheduler timezone.
- [ ] Default source list is `['binance-futures']`.
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
- [ ] `retentionDays` can be updated.
- [ ] `scheduleMode` can be updated.
- [ ] `intervalMinutes` can be updated.
- [ ] `intervalSeconds` can be updated.
- [ ] `hourlyMinute` can be updated.
- [ ] Disabling the scheduler cancels pending queued commands for this scheduler.
- [ ] Invalid scope change to `user` is rejected with a clear error.

## 5. Manual Run Behavior

- [ ] `runNow` rejects missing `actorUserId`.
- [ ] `runNow` rejects when the scheduler is paused.
- [ ] `runNow` rejects when `env.scheduler.executionMode !== 'queue'`.
- [ ] Manual run uses system credentials / system exchange metadata, not the admin actor's personal credentials.
- [ ] `runNow` creates a queued run log row with status `Queued`.
- [ ] `runNow` creates a `run_now` command row.
- [ ] `runNow` includes progress metadata in the queued run log.
- [ ] `runNow` prevents duplicate queueing when a `run_now` command is already `Pending` or `Processing`.
- [ ] `runNow` returns the existing queued run instead of creating a duplicate when one is already queued.
- [ ] `runNow` refuses to queue a second run when a run is already actively executing.
- [ ] Manual run keeps `actorUserId` limited to audit/control context and does not switch execution scope away from the system credential path.

## 6. Pause / Resume / Stop / Restart

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

## 7. Run Logs And Progress

- [ ] `GET /runs` returns paginated run logs for only `exchange-assets-sync`.
- [ ] `GET /runs/:runId/progress` returns the selected run or `run: null` when missing.
- [ ] Run log item includes `id`, `schedulerKey`, `status`, `startedAt`, `finishedAt`, and `durationMs`.
- [ ] Each run log includes who initiated/performed the run, showing admin actor for manual runs and system actor/system context for cron runs.
- [ ] Run log item includes counters: `processedAccounts`, `insertedAssets`, `updatedAssets`, `skippedAssets`.
- [ ] `insertedAssets`, `updatedAssets`, `skippedAssets`, and related counters are actually captured during execution and persisted to the run log, not left empty or always zero.
- [ ] The same captured counters are reflected correctly in recent run, run progress, and scheduler ops surfaces.
- [ ] Progress block returns `total`, `processed`, `percent`, and optional `etaSeconds`.
- [ ] Progress bar works as expected, visibly updating with execution progress and reaching the correct final state on completion, failure, or stop.
- [ ] Current item block returns `symbol`, `assetId`, and `id` when present.
- [ ] Missing or malformed `meta` does not break run log rendering.
- [ ] Scheduler Ops data updates after config changes and run lifecycle changes, including latest status, error, and last-run fields.
- [ ] Active status data updates correctly after pause, resume, queue, start, stop, restart, fail, and complete transitions without stale state.
- [ ] Recent run section behaves as expected, showing the latest run state, timing, counters, and error details without stale or mismatched data.

## 8. Update Logs And Export

- [ ] `GET /runs/:runId/updates` supports pagination.
- [ ] `GET /runs/:runId/updates` supports filtering by `actionType`.
- [ ] `GET /runs/:runId/updates` supports filtering by `source`.
- [ ] `GET /runs/:runId/updates` supports filtering by `symbol`.
- [ ] `GET /runs/:runId/updates` supports validated sorting.
- [ ] Update rows return `id`, `runLogId`, `source`, `actionType`, `symbol`, `externalId`, `assetId`, `message`, and `createdAt`.
- [ ] Each update log includes who performed the action or which system actor/process generated it.
- [ ] `GET /runs/:runId/updates/export` returns a CSV with the same filtered dataset.
- [ ] Export filename is `scheduler-run-<runId>-updates.csv`.
- [ ] CSV escaping is correct for quotes and commas in `message`.

## 9. Retention And Purge

- [ ] Purge preview returns the expected `retentionDays`.
- [ ] Purge preview returns the count of run logs to delete.
- [ ] Purge deletes only run logs older than retention for this scheduler.
- [ ] Purge response accurately reports deleted run log count.
- [ ] Team is aware that current purge behavior reports `updateLogsDeleted: 0`.

## 10. Activity And Alerting

- [ ] Successful config updates create an activity log entry.
- [ ] Failed config updates create a failure activity log entry.
- [ ] Successful queue actions create an activity log entry.
- [ ] Failed queue actions create a failure activity log entry.
- [ ] Activity / audit logs show who performed the action, including admin actor for manual controls and system actor for scheduled execution.
- [ ] Queue failures emit scheduler alerts.
- [ ] Alert throttling prevents duplicate high-frequency failure alerts.
- [ ] Alert source is `exchange-assets-sync`.

## 11. Scheduling Semantics

- [ ] Scheduled execution respects the scheduler config, not ad hoc hardcoded values.
- [ ] Schedule modes behave correctly: `daily`, `every_n_minutes`, `every_n_seconds`, `hourly_at_minute`.
- [ ] Invalid schedule mode safely falls back to `daily`.
- [ ] Interval minute bounds are enforced.
- [ ] Interval second bounds are enforced.
- [ ] Hourly minute bounds are enforced.
- [ ] Next scheduled runs are generated without duplicate overlapping execution.
- [ ] Cron / scheduled runs use the same system credentials / system exchange metadata path as manual runs.
- [ ] Cron / scheduled runs do not depend on any interactive actor-specific credential context.

## 12. Time And Timezone Checks

- [ ] Config timezone returned by the API matches expected scheduler timezone.
- [ ] Stored run timestamps are understood to be emitted as ISO strings.
- [ ] UI or consuming clients correctly interpret returned timestamps.
- [ ] Manual run and scheduled run timestamps are validated against expected UTC/local behavior.
- [ ] Queue request time, run start time, and run finish time are internally consistent.

## 13. Data Integrity Outcome Checks

- [ ] A successful run inserts new exchange assets when unseen symbols appear.
- [ ] A successful run updates existing assets when provider metadata changes.
- [ ] A successful run skips unchanged assets without inflating insert/update counts.
- [ ] Source is recorded correctly for each updated asset log row.
- [ ] Asset identifiers and symbols are preserved correctly in logs.
- [ ] No user-scoped accounts or actor-scoped ownership are attached to this global scheduler run.
- [ ] Manual and cron runs produce equivalent asset-sync results when run against the same upstream system source and time window.

## 14. Failure Scenarios

- [ ] Worker unavailable in non-queue mode returns a clear service-unavailable error.
- [ ] Paused scheduler returns a clear error on run/restart attempts.
- [ ] Invalid run ID returns a safe empty response, not a crash.
- [ ] Malformed config values do not crash config mapping.
- [ ] Broken metadata payload does not crash run mapping.
- [ ] Failure path writes activity and alert records.

## 15. Recommended Proof Run

- [ ] Fetch config and verify normalized global shape.
- [ ] Queue a manual run.
- [ ] Verify queued run log row exists.
- [ ] Verify queued scheduler command exists.
- [ ] Verify worker picks up the command.
- [ ] Verify run progresses from `Queued` to active/completed state.
- [ ] Verify `inserted`, `updated`, `skipped`, and any other exposed counters are captured and change as expected.
- [ ] Verify update log rows are written for affected assets.
- [ ] Export CSV and verify row count matches filtered UI data.
- [ ] Pause the scheduler and verify pending commands are cancelled.
- [ ] Resume the scheduler and verify it becomes runnable again.
- [ ] Test stop and restart behavior in queue mode.

## 16. Fast Regression Set

- [ ] Existing global scheduler behavior test passes for `exchange-assets-sync`.
- [ ] Config normalization test passes.
- [ ] Queue dedupe test passes.
- [ ] Pause cancels pending command test passes.
- [ ] Restart queues stop+run in the right order when a run is active.
- [ ] Runs listing and progress endpoints return expected shapes.
- [ ] Update log filtering and CSV export return expected rows.
