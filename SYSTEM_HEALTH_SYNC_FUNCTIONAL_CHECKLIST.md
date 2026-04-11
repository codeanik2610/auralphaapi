# System Health Sync Functional Checklist

Scheduler key: `system-health-sync`  
Primary service: `src/api/services/HealthCheckSchedulerService.ts`  
Admin route base: `/scheduler/health`  
Primary execution scope: global system infrastructure health probes

Primary runtime contracts used for this checklist:

- `src/api/services/HealthCheckSchedulerService.ts`
- `src/api/controllers/HealthCheckSchedulerController.ts`
- `GLOBAL_SYSTEM_SCHEDULERS_PHASE3.md`
- `scripts/test-global-system-schedulers-phase3.ts`

Use this checklist to verify the full behavior of the `system-health-sync` scheduler, its global system ownership, and the admin-only run surfaces used to capture system-health probe results and alerts.

## 1. Identity And Ownership

- [ ] Scheduler record exists with key `system-health-sync`.
- [ ] Scheduler name is `System Health Sync`.
- [ ] Scheduler description clearly states that it checks aurAlpha API health, discovery-engine health, scheduler worker health, Binance exchange health, and system broker connection health.
- [ ] Scheduler is normalized to `schedulerType = global`.
- [ ] Attempts to change it to `user` scope are rejected.
- [ ] `config.useSystemConnectionsOnly` is always forced to `true`.
- [ ] Legacy or partially migrated scheduler rows are normalized back to the expected global shape on read or update.

## 2. Route And Access

- [ ] Admin-only route works through `/scheduler/health/config`.
- [ ] Admin-only route works through `/scheduler/health/run`.
- [ ] Admin-only route works through `/scheduler/health/pause`.
- [ ] Admin-only route works through `/scheduler/health/resume`.
- [ ] Admin-only route works through `/scheduler/health/stop`.
- [ ] Admin-only route works through `/scheduler/health/restart`.
- [ ] Admin-only route works through `/scheduler/health/purge-logs`.
- [ ] Admin-only route works through `/scheduler/health/purge-logs/preview`.
- [ ] Admin-only route works through `/scheduler/health/runs`.
- [ ] Admin-only route works through `/scheduler/health/runs/:runId/progress`.
- [ ] Admin-only route works through `/scheduler/health/runs/:runId/updates`.
- [ ] Admin-only route works through `/scheduler/health/runs/:runId/updates/export`.

## 3. Default Config

- [ ] Missing config is auto-created.
- [ ] Default `enabled` is `false`.
- [ ] Default cron is `0 1 * * *`.
- [ ] Default `runAt` is `01:00`.
- [ ] Default `intervalDays` is `1`.
- [ ] Default `batchSize` is `50`.
- [ ] Default timezone is the normalized scheduler timezone.
- [ ] Default source list is `['health']`.
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

## 5. System Probe Scope And Health Targets

- [ ] Manual run uses the global system execution path, not the admin actor's personal health context.
- [ ] Cron or scheduled runs use the same global system execution path as manual runs.
- [ ] No interactive actor-specific connection context is required for cron execution.
- [ ] Health checks cover aurAlpha API health.
- [ ] Health checks cover discovery-engine health.
- [ ] Health checks cover scheduler worker health.
- [ ] Health checks cover Binance exchange health.
- [ ] Health checks cover system broker connection health.
- [ ] Probe failures are isolated and surfaced with clear source context.

## 6. Manual Run Behavior

- [ ] `runNow` rejects missing `actorUserId`.
- [ ] `runNow` rejects when the scheduler is paused.
- [ ] `runNow` rejects when `env.scheduler.executionMode !== 'queue'`.
- [ ] `runNow` creates a queued run log row with status `Queued`.
- [ ] `runNow` creates a `run_now` command row.
- [ ] `runNow` includes progress metadata in the queued run log.
- [ ] `runNow` prevents duplicate queueing when a `run_now` command is already `Pending` or `Processing`.
- [ ] `runNow` returns the existing queued run instead of creating a duplicate when one is already queued.
- [ ] `runNow` refuses to queue a second run when a run is already actively executing.
- [ ] Manual run keeps `actorUserId` limited to audit and control context and does not switch execution scope away from the system probe path.

## 7. Pause / Resume / Stop / Restart

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

## 8. Run Logs And Progress

- [ ] `GET /runs` returns paginated run logs for only `system-health-sync`.
- [ ] `GET /runs/:runId/progress` returns the selected run or `run: null` when missing.
- [ ] Run log item includes `id`, `schedulerKey`, `status`, `startedAt`, `finishedAt`, and `durationMs`.
- [ ] Each run log includes who initiated or performed the run, showing admin actor for manual runs and system actor or system context for cron runs.
- [ ] Run log item includes counters such as `processedAccounts`, `insertedAssets`, `updatedAssets`, and `skippedAssets`.
- [ ] The same captured counters are reflected correctly in recent run, run progress, and scheduler ops surfaces.
- [ ] Progress block returns `total`, `processed`, `percent`, and optional `etaSeconds`.
- [ ] Current item block identifies the current health probe item when available.
- [ ] Missing or malformed `meta` does not break run log rendering.

## 9. Update Logs And Export

- [ ] `GET /runs/:runId/updates` supports pagination.
- [ ] `GET /runs/:runId/updates` supports filtering by `actionType`.
- [ ] `GET /runs/:runId/updates` supports filtering by `source`.
- [ ] `GET /runs/:runId/updates` supports filtering by `symbol`.
- [ ] `GET /runs/:runId/updates` supports validated sorting.
- [ ] Update rows return `id`, `runLogId`, `source`, `actionType`, `symbol`, `message`, and `createdAt`.
- [ ] Each update log includes who performed the action or which system actor or process generated it.
- [ ] `GET /runs/:runId/updates/export` returns a CSV with the same filtered dataset.
- [ ] Export filename is `scheduler-run-<runId>-updates.csv`.
- [ ] CSV escaping is correct for quotes and commas in `message`.

## 10. Retention And Purge

- [ ] Purge preview returns the expected `retentionDays`.
- [ ] Purge preview returns the count of run logs to delete.
- [ ] Purge preview returns the count of update logs to delete for this scheduler only.
- [ ] Purge deletes only run logs older than retention for this scheduler.
- [ ] Purge deletes only update logs owned by this scheduler.
- [ ] Purge response accurately reports deleted run log count and deleted update log count.

## 11. Activity And Alerting

- [ ] Successful config updates create an activity log entry.
- [ ] Failed config updates create a failure activity log entry.
- [ ] Successful queue actions create an activity log entry.
- [ ] Failed queue actions create a failure activity log entry.
- [ ] Activity or audit logs show who performed the action, including admin actor for manual controls and system actor for scheduled execution.
- [ ] Queue failures emit scheduler alerts.
- [ ] Probe failures emit scheduler alerts with source context.
- [ ] Alert throttling prevents duplicate high-frequency failure alerts.
- [ ] Alert source is `system-health-sync`.

## 12. Scheduling Semantics

- [ ] Scheduled execution respects the scheduler config, not ad hoc hardcoded values.
- [ ] Schedule modes behave correctly: `daily`, `every_n_minutes`, `every_n_seconds`, `hourly_at_minute`.
- [ ] Invalid schedule mode safely falls back to `daily`.
- [ ] Interval minute bounds are enforced.
- [ ] Interval second bounds are enforced.
- [ ] Hourly minute bounds are enforced.
- [ ] Next scheduled runs are generated without duplicate overlapping execution.
- [ ] Manual and cron runs produce equivalent system-health behavior when run against the same probe set and time window.

## 13. Failure Scenarios

- [ ] Worker unavailable in non-queue mode returns a clear service-unavailable error.
- [ ] Paused scheduler returns a clear error on run and restart attempts.
- [ ] Invalid run ID returns a safe empty response, not a crash.
- [ ] Malformed config values do not crash config mapping.
- [ ] Broken metadata payload does not crash run mapping.
- [ ] Failure path writes activity and alert records.

## 14. Time And Timezone Checks

- [ ] Config timezone returned by the API matches the expected scheduler timezone.
- [ ] Stored run timestamps are understood to be emitted as raw UTC ISO companions.
- [ ] Display-facing config, run, and update timestamps are localized for the requesting actor.
- [ ] Shared `time` metadata remains present and truthful on config, run, and update surfaces.
- [ ] Queue request time, run start time, and run finish time are internally consistent.

