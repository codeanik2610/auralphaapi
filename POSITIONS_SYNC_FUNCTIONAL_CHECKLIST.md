# Positions Sync Functional Checklist

Scheduler key: `positions-sync`  
Primary service: `src/api/services/PositionsSchedulerService.ts`  
Admin route base: `/scheduler/positions`  
Product route base: `/positions`  
Internal sync route: `/internal/positions/sync`

Official provider docs used for this checklist:

- Mudrex Futures API overview: `https://docs.trade.mudrex.com/docs/overview`
- Delta Exchange API introduction: `https://docs.delta.exchange/#introduction`
- Delta Exchange authentication: `https://docs.delta.exchange/#authentication`
- Delta Exchange margined positions reference: `https://docs.delta.exchange/`

Use this checklist to verify the full behavior of the `positions-sync` scheduler, its user-scoped scheduler record, and the trust split between the admin scheduler surface and the user-owned `/positions` product surface.

## 1. Identity And Ownership

- [ ] Scheduler record exists with key `positions-sync`.
- [ ] Scheduler name is `Positions Sync`.
- [ ] Scheduler description clearly states that it is the system reconciliation scheduler for broker position snapshots, checkpoints, and read-model hydration.
- [ ] Scheduler is normalized to `schedulerType = user`.
- [ ] Attempts to switch it to `global` scope are rejected.
- [ ] Legacy or partially migrated scheduler rows are normalized back to the expected user-scoped shape on read or update.
- [ ] Scheduler or cron execution uses the scheduler-owned all-users path, not the admin actor's personal broker scope.

## 2. Route And Access

- [ ] Admin-only route works through `/scheduler/positions/config`.
- [ ] Admin-only route works through `/scheduler/positions/run`.
- [ ] Admin-only route works through `/scheduler/positions/pause`.
- [ ] Admin-only route works through `/scheduler/positions/resume`.
- [ ] Admin-only route works through `/scheduler/positions/stop`.
- [ ] Admin-only route works through `/scheduler/positions/restart`.
- [ ] Admin-only route works through `/scheduler/positions/runs`.
- [ ] Admin-only route works through `/scheduler/positions/sync-state`.
- [ ] Admin-only route works through `/scheduler/positions/sync-state/summary`.
- [ ] Admin-only route works through `/scheduler/positions/read-model/rebuild`.
- [ ] Admin-only route works through `/scheduler/positions/read-model/recovery-history`.
- [ ] Admin-only route works through `/scheduler/positions/runs/:runId/progress`.
- [ ] Admin-only route works through `/scheduler/positions/runs/:runId/updates`.
- [ ] Admin-only route works through `/scheduler/positions/runs/:runId/updates/export`.
- [ ] Product route works through `/positions/futures/refresh`.
- [ ] Product route works through `/positions/futures/sync-status`.
- [ ] Internal execution route works through `/internal/positions/sync`.

## 3. Default Config

- [ ] Missing config is auto-created.
- [ ] Default `enabled` is `false`.
- [ ] Default cron is `0 1 * * *`.
- [ ] Default `runAt` is `01:00`.
- [ ] Default `intervalDays` is `1`.
- [ ] Default `batchSize` is `200`.
- [ ] Default timezone is the normalized scheduler timezone.
- [ ] Default source list is `['positions']`.
- [ ] Default retention is `30` days.
- [ ] Default lookback is `90` days.
- [ ] Default schedule mode falls back to `daily` when unset or invalid.
- [ ] Default read-model recovery policy is exposed in config.

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
- [ ] Scheduler or cron runs fetch positions across all eligible active broker accounts for all users, not only the admin actor who clicked run.
- [ ] Scheduler or cron runs do not require each end user's interactive session to be open.
- [ ] Scheduler or cron runs do not collapse scope to the admin actor's own broker accounts.
- [ ] Scheduler or cron runs preserve ownership diagnostics so affected accounts can still be tied back to the true owner user.
- [ ] System-triggered runs are distinguishable from manual admin-triggered runs in logs and recent-run surfaces.

## 6. Product Page Own-User Execution Scope

- [ ] `/positions/futures/refresh` only refreshes the signed-in user's own active broker accounts.
- [ ] `/positions/futures/refresh` respects optional `brokerKey` and `accountId` only within the signed-in user's own scope.
- [ ] `/positions/futures/refresh` returns `NotFound` when the requested account does not belong to the signed-in user.
- [ ] `/positions/futures/refresh` returns an idle or no-op response when the signed-in user has no connected or idle routes.
- [ ] `/positions/futures/sync-status` reports only the signed-in user's own accounts.
- [ ] Product-page reads such as active positions and history stay user-owned and never hydrate from all-users scheduler scope.
- [ ] Product-page refresh delegates to `/internal/positions/sync` with `targetUserIds: [userId]`, not all users.

## 7. Scope Separation And Trust Boundary

- [ ] Scheduler or cron scope never leaks all-users data into `/positions` responses for a signed-in user.
- [ ] Product-page refresh never triggers a hidden all-users scheduler-style run.
- [ ] `actorUserId` on manual scheduler actions is used for audit or control only and does not redefine execution ownership.
- [ ] Scheduler run logs clearly distinguish scheduler-owned all-users work from user-owned product refresh behavior.
- [ ] Support and ops teams can tell from logs whether a position update came from the admin scheduler path or the user desk path.

## 8. Manual Run Behavior

- [ ] `runNow` rejects missing `actorUserId`.
- [ ] `runNow` rejects when the scheduler is paused.
- [ ] `runNow` rejects when `env.scheduler.executionMode !== 'queue'`.
- [ ] `runNow` creates a queued run log row with status `Queued`.
- [ ] `runNow` creates a `run_now` command row.
- [ ] `runNow` includes progress metadata in the queued run log.
- [ ] `runNow` prevents duplicate queueing when a `run_now` command is already `Pending` or `Processing`.
- [ ] `runNow` returns the existing queued run instead of creating a duplicate when one is already queued.
- [ ] `runNow` refuses to queue a second run when a run is already actively executing.
- [ ] Manual scheduler run still executes against the all-users account set, not the admin actor's own connections, even though the scheduler record is user-scoped.

## 9. Pause / Resume / Stop / Restart

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

## 10. Run Logs, Progress, Recent Run, And Ops

- [ ] `GET /runs` returns paginated run logs for only `positions-sync`.
- [ ] `GET /runs/:runId/progress` returns the selected run or `run: null` when missing.
- [ ] Run log item includes `id`, `schedulerKey`, `status`, `startedAt`, `finishedAt`, and `durationMs`.
- [ ] Each run log includes who initiated or performed the run, showing admin actor for manual runs and system actor or system context for cron runs.
- [ ] Run log item includes counters such as `processedAccounts`, `insertedAssets`, `updatedAssets`, and `skippedAssets`.
- [ ] `inserted`, `updated`, `skipped`, and related counters are actually captured during execution and persisted to the run log, not left empty or always zero.
- [ ] The same captured counters are reflected correctly in recent run, run progress, and scheduler ops surfaces.
- [ ] Progress block returns `total`, `processed`, `percent`, and optional `etaSeconds`.
- [ ] Progress bar works as expected, visibly updating with execution progress and reaching the correct final state on completion, failure, or stop.
- [ ] Current item block identifies the current account, owner, broker, or position scope being processed when available.
- [ ] Missing or malformed `meta` does not break run log rendering.
- [ ] Scheduler Ops data updates after config changes and run lifecycle changes, including latest status, error, and last-run fields.
- [ ] Active status data updates correctly after pause, resume, queue, start, stop, restart, fail, and complete transitions without stale state.
- [ ] Recent run section behaves as expected, showing the latest run state, timing, counters, and error details without stale or mismatched data.

## 11. Update Logs And Export

- [ ] `GET /runs/:runId/updates` supports pagination.
- [ ] `GET /runs/:runId/updates` supports filtering by `actionType`.
- [ ] `GET /runs/:runId/updates` supports filtering by `source`.
- [ ] `GET /runs/:runId/updates` supports filtering by `symbol`.
- [ ] `GET /runs/:runId/updates` supports validated sorting.
- [ ] Update rows return `id`, `runLogId`, `source`, `actionType`, `symbol`, `message`, and `createdAt`.
- [ ] Update rows preserve enough identity to trace the affected account, owner user, broker, or record where applicable.
- [ ] Each update log includes who performed the action or which system actor or process generated it.
- [ ] `GET /runs/:runId/updates/export` returns a CSV with the same filtered dataset.
- [ ] Export filename is `scheduler-run-<runId>-updates.csv`.
- [ ] CSV escaping is correct for quotes and commas in `message`.

## 12. Sync-State, Read-Model, And Recovery Diagnostics

- [ ] `GET /sync-state` returns paginated positions sync-state rows for `positions-sync`.
- [ ] Sync-state can be filtered by `accountId`.
- [ ] Sync-state can be filtered by `ownerUserId`.
- [ ] Sync-state can be filtered by `brokerKey`.
- [ ] Sync-state rows expose owner-user semantics clearly.
- [ ] `GET /sync-state/summary` returns a truthful aggregate summary for the scheduler.
- [ ] Read-model recovery policy is exposed from config with supported scopes, confirmations, and runbook path.
- [ ] `POST /read-model/rebuild` supports scoped recovery by account, owner, broker, or all.
- [ ] Read-model rebuild logs requested scope, targeted scope, warnings, and recommended next step.
- [ ] Read-model rebuild no-op behavior is explicit when no matching or drifted scope exists.
- [ ] `GET /read-model/recovery-history` returns persisted history entries for past rebuild actions.
- [ ] Recovery history preserves actor, state, coverage before and after, and warnings.

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
- [ ] Successful read-model rebuild actions create recovery activity history.
- [ ] Failed read-model rebuild actions create failure activity history and alerts.
- [ ] Activity or audit logs show who performed the action, including admin actor for manual controls and system actor for scheduled execution.
- [ ] Queue failures emit scheduler alerts.
- [ ] Read-model recovery failures emit scheduler alerts.
- [ ] Alert throttling prevents duplicate high-frequency failure alerts.
- [ ] Alert source is `positions-sync`.

## 15. Scheduling Semantics

- [ ] Scheduled execution respects the scheduler config, not ad hoc hardcoded values.
- [ ] Schedule modes behave correctly: `daily`, `every_n_minutes`, `every_n_seconds`, `hourly_at_minute`.
- [ ] Invalid schedule mode safely falls back to `daily`.
- [ ] Interval minute bounds are enforced.
- [ ] Interval second bounds are enforced.
- [ ] Hourly minute bounds are enforced.
- [ ] Next scheduled runs are generated without duplicate overlapping execution.
- [ ] Manual and cron runs produce equivalent all-users reconciliation behavior when run against the same broker account set and time window.

## 16. Time And Timezone Checks

- [ ] Config timezone returned by the API matches expected scheduler timezone.
- [ ] Stored run timestamps are understood to be emitted as ISO strings.
- [ ] UI or consuming clients correctly interpret returned timestamps.
- [ ] Manual run and scheduled run timestamps are validated against expected UTC or local behavior.
- [ ] Queue request time, run start time, and run finish time are internally consistent.
- [ ] Recent run and ops timestamps show localized display time with raw UTC companion fields where expected.

## 17. Data Integrity Outcome Checks

- [ ] A successful scheduler run fetches positions across all eligible users' connected broker accounts.
- [ ] A successful product refresh fetches positions only for the requesting user's own eligible broker accounts.
- [ ] Scheduler runs do not cross-write one owner's positions into another owner's read model or snapshot state.
- [ ] Open, partial, closed, and liquidated statuses are normalized consistently.
- [ ] Checkpoint and snapshot updates stay tied to the correct `accountId`, `brokerKey`, and owner user.
- [ ] Read-model hydration preserves the correct ownership and account routing.
- [ ] Market-price enrichment, when applied, supplements the correct position rows without cross-user leakage.
- [ ] Manual scheduler runs and cron runs produce equivalent results when given the same all-users scope and upstream broker state.

## 18. Failure Scenarios

- [ ] Worker unavailable in non-queue mode returns a clear service-unavailable error.
- [ ] Paused scheduler returns a clear error on run or restart attempts.
- [ ] Invalid run ID returns a safe empty response, not a crash.
- [ ] Malformed config values do not crash config mapping.
- [ ] Broken metadata payload does not crash run mapping.
- [ ] Missing runtime tables or migration mismatch fail clearly.
- [ ] A broken broker route for one account does not silently erase positions for unrelated owners.
- [ ] Failure path writes activity and alert records.

## 19. Recommended Proof Run

- [ ] Fetch config and verify normalized global shape.
- [ ] Verify scheduler scope is global and intended for all eligible users' accounts.
- [ ] Queue a manual scheduler run from the admin surface.
- [ ] Verify queued run log row exists.
- [ ] Verify queued scheduler command exists.
- [ ] Verify worker picks up the command.
- [ ] Verify run progresses from `Queued` to active or completed state.
- [ ] Verify counters such as processed, inserted, updated, and skipped are captured.
- [ ] Verify update log rows are written for affected accounts or records.
- [ ] Verify sync-state summary and detailed sync-state update after the run.
- [ ] Verify recent run, scheduler ops, active status, and progress bar all reflect the same truth.
- [ ] Verify `/positions/futures/refresh` for a signed-in test user only touches that user's own accounts.
- [ ] Verify a signed-in user cannot use `/positions` refresh to trigger an all-users run.
- [ ] Run a scoped read-model rebuild and verify recovery history is written.

## 20. Fast Regression Set

- [ ] Existing positions scheduler phase tests pass.
- [ ] Global ownership normalization test passes for `positions-sync`.
- [ ] Queue dedupe test passes.
- [ ] Pause cancels pending command test passes.
- [ ] Restart queues stop plus run in the right order when a run is active.
- [ ] Runs listing and progress endpoints return expected shapes.
- [ ] Update log filtering and CSV export return expected rows.
- [ ] Sync-state summary and list endpoints return expected shapes.
- [ ] Read-model rebuild and recovery-history endpoints return expected shapes.
- [ ] `/positions/futures/refresh` remains user-owned and does not widen to all-users scope.
