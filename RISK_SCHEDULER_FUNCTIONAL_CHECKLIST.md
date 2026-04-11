# Risk Scheduler Functional Checklist

Scheduler key: `risk-recompute-sync`  
Primary service: `src/api/services/RiskSchedulerService.ts`  
Admin route base: `/scheduler/risk`  
Product route base: `/risk`  
Internal execution route: `/internal/risk/recompute`  
Primary recompute writes: `risk_snapshots`, `risk_controls`, `risk_alerts`, `risk_scenarios`

Primary internal contracts used for this checklist:

- `src/api/services/RiskSchedulerService.ts`
- `src/api/services/RiskService.ts`
- `src/api/controllers/RiskSchedulerController.ts`
- `src/api/controllers/RiskController.ts`
- `src/api/controllers/RiskOverviewController.ts`
- `src/api/controllers/InternalRiskSchedulerController.ts`
- `scripts/check-risk-scheduler-health.ts`
- `RISK_SCHEDULER_PHASE8.md`

Use this checklist to verify the full behavior of the `risk-recompute-sync` scheduler, its user-scoped scheduler record, and the single critical trust split in this flow:

- scheduler or cron execution fans out across all eligible users and all eligible user connections
- internal or product-triggered execution stays limited to the requesting user's own connections

## 1. Identity And Ownership

- [ ] Scheduler record exists with key `risk-recompute-sync`.
- [ ] Scheduler name is `Risk Snapshot Refresh`.
- [ ] Scheduler description clearly states that it drives background risk snapshot refresh and risk-center diagnostics.
- [ ] Scheduler is normalized to `schedulerType = user`.
- [ ] Attempts to switch it to `global` scope are rejected.
- [ ] Legacy or partially migrated scheduler rows are normalized back to the expected user-scoped shape on read or update.
- [ ] Scheduler config is resolved from the owning `scheduler_user_configs` row.
- [ ] Manual admin actor is used for audit and control ownership only, not to collapse execution scope to that admin's own broker accounts.

## 2. Route And Access

- [ ] Admin-only route works through `/scheduler/risk/config`.
- [ ] Admin-only route works through `/scheduler/risk/run`.
- [ ] Admin-only route works through `/scheduler/risk/pause`.
- [ ] Admin-only route works through `/scheduler/risk/resume`.
- [ ] Admin-only route works through `/scheduler/risk/stop`.
- [ ] Admin-only route works through `/scheduler/risk/restart`.
- [ ] Admin-only route works through `/scheduler/risk/purge-logs`.
- [ ] Admin-only route works through `/scheduler/risk/purge-logs/preview`.
- [ ] Admin-only route works through `/scheduler/risk/summary`.
- [ ] Admin-only route works through `/scheduler/risk/runs`.
- [ ] Admin-only route works through `/scheduler/risk/runs/:runId/progress`.
- [ ] Admin-only route works through `/scheduler/risk/runs/:runId/updates`.
- [ ] Admin-only route works through `/scheduler/risk/runs/:runId/updates/export`.
- [ ] Product route works through `/risk/overview`.
- [ ] Product route works through `/risk/recompute`.
- [ ] Internal worker execution route works through `/internal/risk/recompute`.
- [ ] `/scheduler/risk/*` actions reject unauthenticated users.
- [ ] `/scheduler/risk/*` actions reject authenticated non-admin users.

## 3. Default Config

- [ ] Missing scheduler config is auto-created for the owning scheduler user.
- [ ] Default `enabled` is `false`.
- [ ] Default cron is `0 1 * * *`.
- [ ] Default `runAt` is `01:00`.
- [ ] Default `intervalDays` is `1`.
- [ ] Default `batchSize` is `200`.
- [ ] Default timezone is the normalized scheduler timezone.
- [ ] Default source list is `['risk']`.
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
- [ ] Invalid scope change to `global` is rejected with a clear error.

## 5. Scheduler And Cron All-Users Execution Scope

- [ ] Manual scheduler run uses the user-scoped scheduler record but the all-users execution path.
- [ ] Cron or scheduled runs use the same all-users execution path as manual scheduler runs.
- [ ] Scheduler or cron runs resolve target users from all eligible active broker accounts across the system, not only the admin actor who clicked run.
- [ ] Scheduler or cron runs fetch using all eligible user-owned connections across the system.
- [ ] Scheduler or cron runs do not limit broker connection scope to the actor who triggered the scheduler action.
- [ ] Scheduler or cron runs only consider real user-owned connections with a non-null `userId`.
- [ ] Scheduler or cron runs do not include `userId = null` connections in the target set.
- [ ] Scheduler or cron runs do not require each end user's interactive session to be open.
- [ ] Scheduler or cron runs do not collapse scope to the admin actor's own accounts.
- [ ] Worker execution calls `/internal/risk/recompute` with the resolved all-users target set.
- [ ] Scheduled runs are distinguishable from manual admin-triggered runs in logs and recent-run surfaces.

## 6. Product Own-User Execution Scope

- [ ] `/risk/recompute` only recomputes the signed-in user's own risk snapshot.
- [ ] `/risk/recompute` only uses the signed-in user's own broker connections.
- [ ] `/risk/recompute` does not silently trigger an all-users scheduler-style batch.
- [ ] `/risk/overview` returns only the signed-in user's own risk-center data.
- [ ] Product-route recompute and overview remain user-owned even while the scheduler record stays user-scoped and scheduler execution stays all-users.
- [ ] The scheduler path and the product path remain distinguishable in logs and activity so support can tell whether a recompute came from admin scheduler flow or user desk flow.

## 7. Internal Batch Contract

- [ ] `/internal/risk/recompute` accepts `actorUserId`.
- [ ] `/internal/risk/recompute` accepts `targetUserIds`.
- [ ] Internal batch recompute deduplicates `targetUserIds`.
- [ ] When `targetUserIds` contains all scheduler-resolved users, internal execution behaves as the all-users scheduler fanout path.
- [ ] When `targetUserIds` contains only the requesting user, internal execution stays limited to that user's own connections.
- [ ] Internal batch recompute returns `processed`.
- [ ] Internal batch recompute returns `succeeded`.
- [ ] Internal batch recompute returns `failed`.
- [ ] Internal batch recompute returns `snapshotsCreated`.
- [ ] Internal batch recompute returns `controlsCreated`.
- [ ] Internal batch recompute returns `alertsCreated`.
- [ ] Internal batch recompute returns `scenariosCreated`.
- [ ] Internal batch recompute returns per-user failures when some targets fail.

## 8. Diagnostics Summary And Blocker Semantics

- [ ] `/scheduler/risk/summary` returns `schedulerKey`.
- [ ] `/scheduler/risk/summary` returns `usersTargeted`.
- [ ] `/scheduler/risk/summary` returns `usersWithFreshSnapshot`.
- [ ] `/scheduler/risk/summary` returns `usersMissingSnapshot`.
- [ ] `/scheduler/risk/summary` returns `usersWithSourceBlockers`.
- [ ] `/scheduler/risk/summary` returns `latestSnapshotAt`.
- [ ] `/scheduler/risk/summary` returns `latestControlAt`.
- [ ] `/scheduler/risk/summary` returns `latestAlertAt`.
- [ ] `/scheduler/risk/summary` returns `latestScenarioAt`.
- [ ] `/scheduler/risk/summary` returns `latestRun`.
- [ ] `/scheduler/risk/summary` returns blocker rows with `blocker`, `label`, and `count`.
- [ ] Blocker `missing_snapshot` is surfaced when no risk snapshot exists for a targeted user.
- [ ] Blocker `missing_funds_snapshot` is surfaced when the user's risk sources are missing funds coverage.
- [ ] Blocker `missing_positions_snapshot` is surfaced when the user's risk sources are missing positions coverage.
- [ ] Blocker `stale_snapshot` is surfaced when the latest risk snapshot falls behind the freshest source snapshot beyond tolerance.
- [ ] Diagnostics use all targeted real users, not just users who already have risk snapshots.

## 9. Recompute Writes And Risk-Center Truth

- [ ] Scheduler-triggered recompute writes fresh rows into `risk_snapshots`.
- [ ] Scheduler-triggered recompute writes fresh rows into `risk_controls`.
- [ ] Scheduler-triggered recompute writes fresh rows into `risk_alerts`.
- [ ] Scheduler-triggered recompute writes fresh rows into `risk_scenarios`.
- [ ] A successful recompute produces a new snapshot id for the targeted user.
- [ ] Product `GET /risk/overview` reflects the latest recomputed snapshot-backed truth.
- [ ] Missing source coverage is surfaced as diagnostics blockers rather than being silently treated as healthy.
- [ ] Batch recompute activity records whether all users succeeded or some failed.

## 10. Manual Run Behavior

- [ ] `runNow` rejects missing `actorUserId`.
- [ ] `runNow` rejects when the scheduler is paused.
- [ ] `runNow` rejects when `env.scheduler.executionMode !== 'queue'`.
- [ ] `runNow` creates a queued run log row with status `Queued`.
- [ ] `runNow` creates a `run_now` command row.
- [ ] `runNow` includes progress metadata in the queued run log.
- [ ] `runNow` prevents duplicate queueing when a `run_now` command is already `Pending` or `Processing`.
- [ ] `runNow` returns the existing queued run instead of creating a duplicate when one is already queued.
- [ ] `runNow` refuses to queue a second run when a run is already actively executing.
- [ ] Manual scheduler run still executes against the all-users target set and all eligible user connections, not the admin actor's own desk.

## 11. Pause / Resume / Stop / Restart

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

## 12. Run Logs, Progress, Update Logs, And Export

- [ ] `GET /runs` returns paginated run logs for only `risk-recompute-sync`.
- [ ] `GET /runs/:runId/progress` returns the selected run or `run: null` when missing.
- [ ] Run log item includes `id`, `schedulerKey`, `status`, `startedAt`, `finishedAt`, and `durationMs`.
- [ ] Each run log includes who initiated or performed the run, showing admin actor for manual runs and scheduler or cron context for scheduled runs.
- [ ] Run log counters reflect user-target work: `processedAccounts` as targeted users, `insertedAssets` as refreshed users, and `skippedAssets` as failed users.
- [ ] Progress block returns `total`, `processed`, `percent`, and optional `etaSeconds`.
- [ ] Current item block can identify the risk recompute work item when available.
- [ ] Missing or malformed `meta` does not break run log rendering.
- [ ] `GET /runs/:runId/updates` supports pagination.
- [ ] `GET /runs/:runId/updates` supports filtering by `actionType`.
- [ ] `GET /runs/:runId/updates` supports filtering by `source`.
- [ ] `GET /runs/:runId/updates` supports filtering by `symbol`.
- [ ] `GET /runs/:runId/updates` supports validated sorting.
- [ ] Update rows preserve enough detail to explain whether the run fully updated, partially updated, or skipped recompute work.
- [ ] `GET /runs/:runId/updates/export` returns a CSV with the same filtered dataset.
- [ ] Export filename is `scheduler-run-<runId>-updates.csv`.

## 13. Retention And Purge

- [ ] Purge preview returns the expected `retentionDays`.
- [ ] Purge preview returns the count of run logs to delete.
- [ ] Purge preview returns the count of update logs to delete for this scheduler only.
- [ ] Purge deletes only run logs older than retention for this scheduler.
- [ ] Purge deletes only update logs owned by this scheduler.
- [ ] Purge response accurately reports deleted run log count and deleted update log count.

## 14. Activity And Alerting

- [ ] Successful config updates create an activity log entry.
- [ ] Failed config updates create a failure activity log entry.
- [ ] Successful queue actions create an activity log entry.
- [ ] Failed queue actions create a failure activity log entry.
- [ ] Manual product recompute creates user-owned risk activity.
- [ ] Batch recompute creates actor-owned completion activity with partial-failure awareness.
- [ ] Activity or audit logs show who performed the action, including admin actor for manual scheduler controls and the owning scheduler or cron context for scheduled execution.
- [ ] Queue failures emit scheduler alerts.
- [ ] Alert throttling prevents duplicate high-frequency scheduler failure alerts.
- [ ] Alert source is `risk-recompute-sync`.

## 15. Scheduling Semantics

- [ ] Scheduled execution respects the scheduler config, not ad hoc hardcoded values.
- [ ] Schedule modes behave correctly: `daily`, `every_n_minutes`, `every_n_seconds`, `hourly_at_minute`.
- [ ] Invalid schedule mode safely falls back to `daily`.
- [ ] Interval minute bounds are enforced.
- [ ] Interval second bounds are enforced.
- [ ] Hourly minute bounds are enforced.
- [ ] Next scheduled runs are generated without duplicate overlapping execution.
- [ ] Manual and cron runs produce equivalent all-users recompute behavior when run against the same eligible user set.

## 16. Live Health, Release Gate, And Signoff

- [ ] `npm run check:risk-scheduler-health` verifies `/scheduler/risk/config`, `/scheduler/risk/summary`, `/scheduler/risk/runs`, queue health, worker health, and product risk-center truth.
- [ ] Live health can optionally trigger a real `/risk/recompute` check when the environment flag is enabled.
- [ ] `npm run release-gate:risk-scheduler` includes the focused risk scheduler backend and UI suites.
- [ ] `npm run release-gate:risk-scheduler` can require live scheduler and risk-center health when enabled.
- [ ] `npm run signoff:risk-scheduler` records diagnostics verification, product trust verification, recompute write verification, and admin access review.
- [ ] Promotion signoff can require live health review when configured.

## 17. Time And Timezone Checks

- [ ] Config timezone returned by the API matches the expected scheduler timezone.
- [ ] Stored run timestamps are emitted as ISO strings.
- [ ] Admin diagnostics and scheduler ops clients correctly interpret returned timestamps.
- [ ] Manual run and scheduled run timestamps are validated against expected UTC and localized display behavior.
