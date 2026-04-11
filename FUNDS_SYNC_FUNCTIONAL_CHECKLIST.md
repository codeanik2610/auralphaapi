# Funds Sync Functional Checklist

Scheduler key: `funds-sync`  
Primary service: `src/api/services/FundsSchedulerService.ts`  
Admin route base: `/scheduler/funds`  
Product route base: `/wallet`  
Internal execution route: `/internal/funds/snapshot`  
Primary snapshot table: `funds_snapshots`  
Scheduler config tables: `scheduler_user_configs` with a legacy anchor in `scheduler_configs`

Primary runtime contracts used for this checklist:

- `src/api/services/FundsSchedulerService.ts`
- `src/api/controllers/FundsSchedulerController.ts`
- `src/api/controllers/InternalFundsSchedulerController.ts`
- `src/api/controllers/WalletController.ts`
- `scripts/test-funds-scheduler-phase4.ts`
- `FUNDS_SCHEDULER_PHASE8.md`

Use this checklist to verify the full behavior of the `funds-sync` scheduler, its admin-owned user scheduler record, the all-users execution fanout used by scheduler runs, and the user-owned wallet and portfolio read surfaces that consume funds snapshots.

## 1. Identity And Ownership

- [ ] Scheduler record exists with key `funds-sync`.
- [ ] Scheduler name is `Funds Snapshot Sync`.
- [ ] Scheduler description clearly states that it captures wallet and futures funds for connected broker accounts.
- [ ] Scheduler is normalized to `schedulerType = user`.
- [ ] Attempts to switch it to `global` scope are rejected.
- [ ] Legacy or partially migrated scheduler anchor rows are normalized back to the expected user-scoped shape.
- [ ] Scheduler config is resolved from the owning `scheduler_user_configs` row, while the legacy `scheduler_configs` anchor remains a default source only.
- [ ] Manual admin actor is used for audit and control ownership only, not to collapse execution scope to that admin's own broker accounts.

## 2. Route And Access

- [ ] Admin-only route works through `/scheduler/funds/config`.
- [ ] Admin-only route works through `/scheduler/funds/run`.
- [ ] Admin-only route works through `/scheduler/funds/pause`.
- [ ] Admin-only route works through `/scheduler/funds/resume`.
- [ ] Admin-only route works through `/scheduler/funds/stop`.
- [ ] Admin-only route works through `/scheduler/funds/restart`.
- [ ] Admin-only route works through `/scheduler/funds/purge-logs`.
- [ ] Admin-only route works through `/scheduler/funds/purge-logs/preview`.
- [ ] Admin-only route works through `/scheduler/funds/summary`.
- [ ] Admin-only route works through `/scheduler/funds/coverage`.
- [ ] Admin-only route works through `/scheduler/funds/runs`.
- [ ] Admin-only route works through `/scheduler/funds/runs/:runId/progress`.
- [ ] Admin-only route works through `/scheduler/funds/runs/:runId/updates`.
- [ ] Admin-only route works through `/scheduler/funds/runs/:runId/updates/export`.
- [ ] Internal worker execution route works through `/internal/funds/snapshot`.
- [ ] Product read route works through `/wallet/funds/active`.
- [ ] Product read route works through `/wallet/futures/funds/active`.
- [ ] Funds-backed portfolio read remains available through `/portfolio/overview`.

## 3. Default Config

- [ ] Missing scheduler config is auto-created for the owning scheduler user.
- [ ] Default `enabled` is `false`.
- [ ] Default cron is `0 1 * * *`.
- [ ] Default `runAt` is `01:00`.
- [ ] Default `intervalDays` is `1`.
- [ ] Default `batchSize` is `200`.
- [ ] Default timezone is the normalized scheduler timezone from the scheduler anchor or default scheduler timezone.
- [ ] Default source list is `['funds']`.
- [ ] Default retention is `30` days.
- [ ] Default schedule mode falls back to `daily` when unset or invalid.
- [ ] Default funds health thresholds are normalized when present.

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
- [ ] Funds health thresholds can be updated.
- [ ] Disabling the scheduler cancels pending queued commands for this scheduler and actor.
- [ ] Invalid scope change to `global` is rejected with a clear error.

## 5. Scheduler And Cron All-Users Execution Scope

- [ ] Manual scheduler run uses the user-scoped scheduler record but the all-users execution path.
- [ ] Cron or scheduled runs use the same all-users execution path as manual scheduler runs.
- [ ] Scheduler or cron runs resolve all eligible active broker accounts across the system, not only the admin actor who clicked run.
- [ ] Scheduler or cron runs preserve owner attribution so each refreshed funds snapshot still belongs to the true account owner.
- [ ] Scheduler or cron runs only consider real user-owned accounts with a non-null `userId`.
- [ ] Scheduler or cron runs do not include ownerless system accounts where `userId = null`.
- [ ] Scheduler or cron runs do not require each end user's interactive session to be open.
- [ ] Worker execution calls `/internal/funds/snapshot` with the all-users target set.
- [ ] Scheduled runs are distinguishable from manual admin-triggered runs in logs and recent-run surfaces.

## 6. Scoped Manual Recovery Behavior

- [ ] Manual `runNow` supports optional `accountId`.
- [ ] Manual `runNow` supports optional `brokerKey`.
- [ ] Scoped manual run queues a distinct `scoped-manual` trigger.
- [ ] Scoped manual run still preserves owner-aware execution and does not silently widen to all accounts.
- [ ] Scoped manual run can be used for account-level recovery when the funds runtime schema is ready.
- [ ] Scoped manual run scope is persisted in queued run metadata and queued command payloads.

## 7. Product Read Boundary And Trust Split

- [ ] `/wallet/funds/active` stays limited to the signed-in user's own active accounts.
- [ ] `/wallet/futures/funds/active` stays limited to the signed-in user's own active accounts.
- [ ] `/portfolio/overview` remains snapshot-backed and user-owned.
- [ ] Admin scheduler execution never leaks all-users funds data into product responses for a signed-in user.
- [ ] Product reads do not silently trigger an all-users scheduler-style batch.
- [ ] Support and ops teams can distinguish scheduler refreshes from normal product reads in activity and run history.

## 8. Summary, Coverage, Recovery, And Product Read Boundary

- [ ] `/scheduler/funds/summary` returns `schedulerKey`.
- [ ] `/scheduler/funds/summary` returns `timezone`.
- [ ] `/scheduler/funds/summary` returns `localDate`.
- [ ] `/scheduler/funds/summary` returns `totalConnectedAccounts`.
- [ ] `/scheduler/funds/summary` returns fresh, stale, missing, failed, and successful latest-attempt counts.
- [ ] `/scheduler/funds/summary` returns latest observed snapshot and latest attempt timestamps plus age-in-minutes fields.
- [ ] `/scheduler/funds/summary` returns `lastSuccessfulRun` when available.
- [ ] `/scheduler/funds/summary` returns `runtimeFoundation`.
- [ ] `/scheduler/funds/summary` returns `recoveryRunSupported`.
- [ ] `/scheduler/funds/summary` returns `recoveryRunScope = account`.
- [ ] `/scheduler/funds/summary` returns `runUpdatesSupported = false`.
- [ ] `/scheduler/funds/summary` returns the explicit reason that per-record update logs are not emitted.
- [ ] `/scheduler/funds/coverage` supports filtering by `accountId`.
- [ ] `/scheduler/funds/coverage` supports filtering by `brokerKey`.
- [ ] `/scheduler/funds/coverage` supports filtering by `freshnessState`.
- [ ] `/scheduler/funds/coverage` supports filtering by `latestFetchStatus`.
- [ ] Coverage rows expose freshness, latest snapshot, latest attempt, latest error, and wallet/futures availability truth.
- [ ] Coverage rows identify account ownership semantics without exposing all-users data to product routes.

## 9. Manual Run Behavior

- [ ] `runNow` rejects missing `actorUserId`.
- [ ] `runNow` rejects when the scheduler is paused.
- [ ] `runNow` rejects when `env.scheduler.executionMode !== 'queue'`.
- [ ] `runNow` asserts the funds runtime schema before queueing work.
- [ ] `runNow` creates a queued run log row with status `Queued`.
- [ ] `runNow` creates a `run_now` command row.
- [ ] `runNow` includes progress metadata in the queued run log.
- [ ] `runNow` prevents duplicate queueing for the same actor when an unscoped run is already `Pending` or `Processing`.
- [ ] `runNow` returns the existing queued run instead of creating a duplicate when one is already queued.
- [ ] `runNow` refuses to queue a second unscoped run when one is already actively executing for the actor.

## 10. Pause / Resume / Stop / Restart

- [ ] `pause` flips `enabled` to `false`.
- [ ] `pause` cancels pending commands for this scheduler and actor.
- [ ] `resume` flips `enabled` to `true`.
- [ ] `stop` is only allowed in queue mode.
- [ ] `stop` cancels pending `run_now` commands for this scheduler and actor.
- [ ] `stop` queues `stop_now` only when a run is actually active.
- [ ] `stop` returns `noop` when there is nothing running or queued.
- [ ] `restart` is rejected when the scheduler is paused.
- [ ] `restart` is only allowed in queue mode.
- [ ] `restart` cancels pending `run_now` commands before requeueing.
- [ ] `restart` queues `stop_now` first when a run is active.
- [ ] `restart` always queues a new `run_now`.

## 11. Run Logs, Progress, Update Logs, And Export

- [ ] `GET /runs` returns paginated run logs for only `funds-sync`.
- [ ] `GET /runs/:runId/progress` returns the selected run or `run: null` when missing.
- [ ] Run log item includes `id`, `schedulerKey`, `status`, `startedAt`, `finishedAt`, and `durationMs`.
- [ ] Each run log includes who initiated or performed the run, showing admin actor for manual runs and scheduler or cron context for scheduled runs.
- [ ] Run log counters reflect funds work: `processedAccounts`, refreshed counts, and failed counts.
- [ ] Progress block returns `total`, `processed`, `percent`, and optional `etaSeconds`.
- [ ] Missing or malformed `meta` does not break run log rendering.
- [ ] `GET /runs/:runId/updates` remains safe even though funds does not emit per-record update rows.
- [ ] `GET /runs/:runId/updates/export` remains safe and returns a CSV shape even when there are no emitted update rows.
- [ ] Export filename is `scheduler-run-<runId>-updates.csv`.
- [ ] Audit metadata remains present on any emitted update-row fallback path.

## 12. Retention And Purge

- [ ] Purge preview returns the expected `retentionDays`.
- [ ] Purge preview returns the count of run logs to delete.
- [ ] Purge preview returns the count of update logs to delete for this scheduler only.
- [ ] Purge deletes only run logs older than retention for this scheduler and actor scope.
- [ ] Purge deletes only update logs owned by this scheduler.
- [ ] Purge response accurately reports deleted run log count and deleted update log count.

## 13. Activity, Alerting, And Failure Capture

- [ ] Successful config updates create an activity log entry.
- [ ] Failed config updates create a failure activity log entry.
- [ ] Successful queue actions create an activity log entry.
- [ ] Failed queue actions create a failure activity log entry.
- [ ] Fetch failures are recorded against the affected funds account scope when possible.
- [ ] Queue or runtime failures emit scheduler alerts.
- [ ] Alert throttling prevents duplicate high-frequency failure alerts.
- [ ] Alert source is `funds-sync`.

## 14. Time And Timezone Checks

- [ ] Config timezone returned by the API matches the scheduler config timezone, not a personal `/settings.timezone` override.
- [ ] Summary and coverage `timezone` and `localDate` are derived from the configured scheduler timezone.
- [ ] Stored run timestamps are understood to be emitted as raw UTC ISO companions.
- [ ] Display-facing config, run, and update timestamps are localized for the requesting actor.
- [ ] Shared `time` metadata remains present and truthful on config, run, and update surfaces.

