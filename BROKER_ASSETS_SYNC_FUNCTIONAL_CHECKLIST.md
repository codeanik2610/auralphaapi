# Broker Assets Sync Functional Checklist

Scheduler key: `broker-assets-sync`  
Primary service: `src/api/services/SchedulerService.ts`  
Admin route base: `/scheduler/exchange-assets`  
Scope source table: system-owned broker account connections  
Storage target table: `broker_assets`

Official provider docs used for this checklist:

- Mudrex Futures API overview: `https://docs.trade.mudrex.com/docs/overview`
- Delta Exchange API introduction: `https://docs.delta.exchange/#introduction`
- Delta Exchange authentication: `https://docs.delta.exchange/#authentication`

Use this checklist to verify the full behavior of the `broker-assets-sync` scheduler, the intentional route-name split between `/scheduler/exchange-assets` and `broker-assets-sync`, and the global broker-asset catalog updates driven from system-managed provider scope.

## 1. Identity And Ownership

- [ ] Scheduler record exists with key `broker-assets-sync`.
- [ ] Scheduler name is `Broker Assets Daily Sync`.
- [ ] Scheduler description clearly states that it fetches provider assets for system broker accounts and updates the global broker assets catalog.
- [ ] Scheduler is normalized to `schedulerType = global`.
- [ ] Attempts to change it to `user` scope are rejected.
- [ ] `config.useSystemConnectionsOnly` is always forced to `true`.
- [ ] `config.useSystemAccountsOnly` is always forced to `true`.
- [ ] Legacy or partially migrated scheduler rows are normalized back to the expected global shape on read or update.

## 2. Route And Access

- [ ] Admin-only route works through `/scheduler/exchange-assets/config`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/run`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/pause`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/resume`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/stop`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/restart`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/purge-logs`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/purge-logs/preview`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/runs`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/assets`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/runs/:runId/progress`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/runs/:runId/updates`.
- [ ] Admin-only route works through `/scheduler/exchange-assets/runs/:runId/updates/export`.
- [ ] Team is aware that the controller path says `exchange-assets` while the scheduler key is `broker-assets-sync`.

## 3. Default Config

- [ ] Missing config is auto-created.
- [ ] Default `enabled` is `false`.
- [ ] Default cron is `0 1 * * *`.
- [ ] Default `runAt` is `01:00`.
- [ ] Default `intervalDays` is `1`.
- [ ] Default `batchSize` is `200`.
- [ ] Default timezone is the normalized scheduler timezone.
- [ ] Default source list is `['mudrex', 'delta_exchange']`.
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

## 5. System Scope And Provider Behavior

- [ ] Manual run uses only system-managed provider scope, not the admin actor's personal credentials.
- [ ] Cron or scheduled runs use the same system scope as manual runs.
- [ ] No interactive actor-specific connection context is required for cron execution.
- [ ] Mudrex requests use the system connection path.
- [ ] Delta requests use the system connection path.
- [ ] Provider-specific failures are isolated so one source failure does not corrupt the other source's results.
- [ ] The run result records which provider sources responded and which failed.

## 6. Broker Asset Catalog Storage Contract

- [ ] The storage target for this scheduler is `broker_assets`.
- [ ] Broker-asset writes target the global catalog, not a user-owned table.
- [ ] New provider assets are inserted into `broker_assets` when unseen symbols appear.
- [ ] Existing provider assets are updated when metadata changes.
- [ ] Unchanged assets can be skipped without inflating insert or update counts.
- [ ] Source-specific rows do not overwrite a different provider row just because the symbol text matches.
- [ ] The catalog remains global even when downstream user-facing routes derive visibility from user-owned broker routes.

## 7. Manual Run Behavior

- [ ] `runNow` rejects missing `actorUserId`.
- [ ] `runNow` rejects when the scheduler is paused.
- [ ] `runNow` rejects when `env.scheduler.executionMode !== 'queue'`.
- [ ] `runNow` creates a queued run log row with status `Queued`.
- [ ] `runNow` creates a `run_now` command row.
- [ ] `runNow` includes progress metadata in the queued run log.
- [ ] `runNow` prevents duplicate queueing when a `run_now` command is already `Pending` or `Processing`.
- [ ] `runNow` returns the existing queued run instead of creating a duplicate when one is already queued.
- [ ] `runNow` refuses to queue a second run when a run is already actively executing.
- [ ] Manual run keeps `actorUserId` limited to audit and control context and does not switch execution scope away from the system provider path.

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

- [ ] `GET /runs` returns paginated run logs for only `broker-assets-sync`.
- [ ] `GET /runs/:runId/progress` returns the selected run or `run: null` when missing.
- [ ] Run log item includes `id`, `schedulerKey`, `status`, `startedAt`, `finishedAt`, and `durationMs`.
- [ ] Each run log includes who initiated or performed the run, showing admin actor for manual runs and system actor or system context for cron runs.
- [ ] Run log item includes counters such as `processedAccounts`, `insertedAssets`, `updatedAssets`, and `skippedAssets`.
- [ ] The same captured counters are reflected correctly in recent run, run progress, and scheduler ops surfaces.
- [ ] Progress block returns `total`, `processed`, `percent`, and optional `etaSeconds`.
- [ ] Current item block identifies the broker-asset or provider symbol being processed when available.
- [ ] Missing or malformed `meta` does not break run log rendering.

## 10. Update Logs, Assets List, And Export

- [ ] `GET /assets` returns the system broker-asset list exposed to the scheduler UI.
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
- [ ] Provider fetch failures emit scheduler alerts with source context.
- [ ] Alert throttling prevents duplicate high-frequency failure alerts.
- [ ] Alert source is `broker-assets-sync`.

## 13. Scheduling Semantics

- [ ] Scheduled execution respects the scheduler config, not ad hoc hardcoded values.
- [ ] Schedule modes behave correctly: `daily`, `every_n_minutes`, `every_n_seconds`, `hourly_at_minute`.
- [ ] Invalid schedule mode safely falls back to `daily`.
- [ ] Interval minute bounds are enforced.
- [ ] Interval second bounds are enforced.
- [ ] Hourly minute bounds are enforced.
- [ ] Next scheduled runs are generated without duplicate overlapping execution.
- [ ] Manual and cron runs produce equivalent broker-asset catalog behavior when run against the same system sources and time window.

## 14. Time And Timezone Checks

- [ ] Config timezone returned by the API matches the expected scheduler timezone.
- [ ] Stored run timestamps are understood to be emitted as raw UTC ISO companions.
- [ ] Display-facing config, run, and update timestamps are localized for the requesting actor.
- [ ] Shared `time` metadata remains present and truthful on config, run, and update surfaces.
- [ ] Queue request time, run start time, and run finish time are internally consistent.

