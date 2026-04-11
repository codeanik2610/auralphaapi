# Asset Price Sync Functional Checklist

Scheduler key: `asset-price-sync`  
Primary service: `src/api/services/AssetPriceSchedulerService.ts`  
Admin route base: `/scheduler/asset-price`  
Scope source table: `broker_assets`  
Storage target table: `asset_price`  
Legacy table to retire from this flow: `market_prices_binance`

Official provider docs used for this checklist:

- Mudrex Futures API overview: `https://docs.trade.mudrex.com/docs/overview`
- Mudrex Futures assets listing: `https://docs.trade.mudrex.com/docs/get-asset-listing`
- Mudrex asset by id or symbol: `https://docs.trade.mudrex.com/docs/get`
- Delta Exchange API introduction: `https://docs.delta.exchange/#introduction`
- Delta Exchange authentication: `https://docs.delta.exchange/#authentication`

Use this checklist to verify the full behavior of the `asset-price-sync` scheduler, not just whether a run starts.

## 1. Identity And Ownership

- [ ] Scheduler record exists with key `asset-price-sync`.
- [ ] Scheduler name is `Asset Price Sync`.
- [ ] Scheduler description clearly states that it fetches asset prices from system market sources.
- [ ] Scheduler is normalized to `schedulerType = global`.
- [ ] Attempts to change it to `user` scope are rejected.
- [ ] `config.useSystemConnectionsOnly` is always forced to `true`.
- [ ] Legacy or partially migrated scheduler rows are normalized back to the expected global shape on read or update.

## 2. Route And Access

- [ ] Admin-only route works through `/scheduler/asset-price/config`.
- [ ] Admin-only route works through `/scheduler/asset-price/run`.
- [ ] Admin-only route works through `/scheduler/asset-price/pause`.
- [ ] Admin-only route works through `/scheduler/asset-price/resume`.
- [ ] Admin-only route works through `/scheduler/asset-price/stop`.
- [ ] Admin-only route works through `/scheduler/asset-price/restart`.
- [ ] Admin-only route works through `/scheduler/asset-price/runs`.
- [ ] Admin-only route works through `/scheduler/asset-price/assets`.
- [ ] Admin-only route works through `/scheduler/asset-price/runs/:runId/progress`.
- [ ] Admin-only route works through `/scheduler/asset-price/runs/:runId/updates`.
- [ ] Admin-only route works through `/scheduler/asset-price/runs/:runId/updates/export`.

## 3. Default Config

- [ ] Missing config is auto-created.
- [ ] Default `enabled` is `false`.
- [ ] Default cron is `0 1 * * *`.
- [ ] Default `runAt` is `01:00`.
- [ ] Default `intervalDays` is `1`.
- [ ] Default `batchSize` is `200`.
- [ ] Default timezone is the normalized scheduler timezone.
- [ ] Default source list is `['mudrex', 'delta_exchange']`.
- [ ] Default `selectionMode` is `all`.
- [ ] Default `selectedAssetIds` is an empty list.
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
- [ ] `retentionDays` can be updated.
- [ ] `scheduleMode` can be updated.
- [ ] `intervalMinutes` can be updated.
- [ ] `intervalSeconds` can be updated.
- [ ] `hourlyMinute` can be updated.
- [ ] Disabling the scheduler cancels pending queued commands for this scheduler.
- [ ] Invalid scope change to `user` is rejected with a clear error.

## 5. System Connection And Provider Behavior

- [ ] Manual run uses only system-managed Mudrex and Delta connection context, not the admin actor's personal credentials.
- [ ] Cron or scheduled runs use the same system connection path as manual runs.
- [ ] No interactive actor-specific connection context is required for cron execution.
- [ ] Mudrex requests follow the official Futures API contract, including `X-Authentication` on the system request path.
- [ ] Mudrex base URL and path usage are aligned with the official docs for futures assets.
- [ ] Delta requests follow the official API contract for whichever endpoint is chosen.
- [ ] If Delta authenticated endpoints are used, required headers are present: `api-key`, `signature`, `timestamp`, and `User-Agent`.
- [ ] If Delta public market-data endpoints are used, the scheduler still derives scope and ownership from the system Delta source path, not user context.
- [ ] Source-specific failures are isolated so Mudrex failure does not corrupt Delta results, and Delta failure does not corrupt Mudrex results.
- [ ] The run result records which provider sources actually responded and which failed.

## 6. Scope, Asset Selection, And Broker Asset ID Mapping

- [ ] Scope is resolved from `broker_assets`, not from ad hoc symbol lists alone.
- [ ] `selectedAssetIds` refer to `broker_assets.id` values.
- [ ] `GET /assets` returns `broker_assets.id`, `symbol`, and `source`.
- [ ] `selectionMode = custom` uses the selected `broker_assets.id` rows only.
- [ ] `selectionMode = all` resolves all eligible system broker assets from `broker_assets`.
- [ ] Scheduler run payload carries broker asset identifiers for execution, not only normalized symbols.
- [ ] Price fetch and storage logic preserve the one-to-one relationship to the chosen `broker_assets.id`.
- [ ] Mudrex and Delta rows that share a human symbol do not overwrite each other just because the symbol text matches.
- [ ] The scheduler does not rely on symbol normalization alone as the storage key.

## 7. Storage Contract

- [ ] The storage table for this scheduler is `asset_price`.
- [ ] The scheduler no longer writes new data into `market_prices_binance`.
- [ ] Every stored price row is linked to `broker_assets.id`.
- [ ] `broker_asset_id` is the primary or uniqueness anchor for upsert behavior.
- [ ] A source-specific price row can be updated without overwriting a different source's row for another broker asset.
- [ ] Stored row includes `broker_asset_id`.
- [ ] Stored row includes `symbol`.
- [ ] Stored row includes `source_symbol`.
- [ ] Stored row includes `price`.
- [ ] Stored row includes `source`.
- [ ] Stored row includes `retrieved_at`.
- [ ] Stored row includes `updated_at`.
- [ ] If legacy `exchange_asset_id` naming exists anywhere in the code path, it is replaced or clearly remapped to `broker_asset_id`.
- [ ] Reads for downstream consumers move to `asset_price`, not `market_prices_binance`.
- [ ] A migration exists to create or rename the table safely.
- [ ] Backfill or cutover behavior is defined so old price data is not silently lost.

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
- [ ] Manual run keeps `actorUserId` limited to audit or control context and does not switch execution scope away from the system connection path.

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

## 10. Run Logs And Progress

- [ ] `GET /runs` returns paginated run logs for only `asset-price-sync`.
- [ ] `GET /runs/:runId/progress` returns the selected run or `run: null` when missing.
- [ ] Run log item includes `id`, `schedulerKey`, `status`, `startedAt`, `finishedAt`, and `durationMs`.
- [ ] Each run log includes who initiated or performed the run, showing admin actor for manual runs and system actor or system context for cron runs.
- [ ] Run log item includes counters such as `insertedAssets`, `updatedAssets`, and `skippedAssets`, interpreted for price-row work.
- [ ] `inserted`, `updated`, `skipped`, and related counters are actually captured during execution and persisted to the run log, not left empty or always zero.
- [ ] The same captured counters are reflected correctly in recent run, run progress, and scheduler ops surfaces.
- [ ] Progress block returns `total`, `processed`, `percent`, and optional `etaSeconds`.
- [ ] Progress bar works as expected, visibly updating with execution progress and reaching the correct final state on completion, failure, or stop.
- [ ] Current item block identifies the current broker asset being processed.
- [ ] Current item block includes the selected `broker_assets.id` when available.
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
- [ ] Update rows capture the corresponding `broker_assets.id`.
- [ ] Each update log includes who performed the action or which system actor or process generated it.
- [ ] `GET /runs/:runId/updates/export` returns a CSV with the same filtered dataset.
- [ ] Export filename is `scheduler-run-<runId>-updates.csv`.
- [ ] CSV escaping is correct for quotes and commas in `message`.

## 12. Retention And Purge

- [ ] Purge preview returns the expected `retentionDays`.
- [ ] Purge preview returns the count of run logs to delete.
- [ ] Purge preview returns the count of update logs to delete for this scheduler only.
- [ ] Purge deletes only run logs older than retention for this scheduler.
- [ ] Purge deletes only update logs owned by this scheduler.
- [ ] Purge response accurately reports deleted run log count and deleted update log count.

## 13. Activity And Alerting

- [ ] Successful config updates create an activity log entry.
- [ ] Failed config updates create a failure activity log entry.
- [ ] Successful queue actions create an activity log entry.
- [ ] Failed queue actions create a failure activity log entry.
- [ ] Activity or audit logs show who performed the action, including admin actor for manual controls and system actor for scheduled execution.
- [ ] Queue failures emit scheduler alerts.
- [ ] Provider fetch failures emit scheduler alerts with source context.
- [ ] Alert throttling prevents duplicate high-frequency failure alerts.
- [ ] Alert source is `asset-price-sync`.

## 14. Scheduling Semantics

- [ ] Scheduled execution respects the scheduler config, not ad hoc hardcoded values.
- [ ] Schedule modes behave correctly: `daily`, `every_n_minutes`, `every_n_seconds`, `hourly_at_minute`.
- [ ] Invalid schedule mode safely falls back to `daily`.
- [ ] Interval minute bounds are enforced.
- [ ] Interval second bounds are enforced.
- [ ] Hourly minute bounds are enforced.
- [ ] Next scheduled runs are generated without duplicate overlapping execution.
- [ ] Manual and cron runs produce equivalent price-sync behavior when run against the same system sources and scope.

## 15. Time And Timezone Checks

- [ ] Config timezone returned by the API matches expected scheduler timezone.
- [ ] Stored run timestamps are understood to be emitted as ISO strings.
- [ ] UI or consuming clients correctly interpret returned timestamps.
- [ ] Manual run and scheduled run timestamps are validated against expected UTC or local behavior.
- [ ] Queue request time, run start time, and run finish time are internally consistent.
- [ ] Recent run and ops timestamps show localized display time with raw UTC companion fields where expected.

## 16. Provider Data Integrity Checks

- [ ] Mudrex asset response mapping uses the provider asset `id`, `symbol`, and `price` consistently.
- [ ] Delta product or ticker response mapping uses the correct provider identifiers and current price field.
- [ ] Only the intended Delta product set is included, for example perpetual futures if that is the chosen contract.
- [ ] Provider symbol transformation does not corrupt the target `broker_assets` mapping.
- [ ] `broker_assets.source` remains the source of truth for which provider row is being updated.
- [ ] Mudrex broker asset rows update only from Mudrex data.
- [ ] Delta broker asset rows update only from Delta data.
- [ ] A successful run inserts new `asset_price` rows when unseen broker asset IDs appear in scope.
- [ ] A successful run updates existing `asset_price` rows when price or source metadata changes.
- [ ] A successful run skips unchanged rows without inflating insert or update counts.
- [ ] No symbol-only collision can overwrite one broker asset row with another provider's value.

## 17. Failure Scenarios

- [ ] Worker unavailable in non-queue mode returns a clear service-unavailable error.
- [ ] Paused scheduler returns a clear error on run or restart attempts.
- [ ] Invalid run ID returns a safe empty response, not a crash.
- [ ] Malformed config values do not crash config mapping.
- [ ] Broken metadata payload does not crash run mapping.
- [ ] Missing system Mudrex credentials fail clearly.
- [ ] Missing or invalid Delta system auth material fails clearly when auth is required.
- [ ] Missing target `broker_assets` rows fail clearly instead of silently writing orphaned prices.
- [ ] Missing `asset_price` table or migration mismatch fails clearly instead of silently writing to the legacy table.
- [ ] Failure path writes activity and alert records.

## 18. Recommended Proof Run

- [ ] Fetch config and verify normalized global shape.
- [ ] Verify the scheduler is configured to use system Mudrex and Delta sources only.
- [ ] Verify selected scope resolves from `broker_assets`.
- [ ] Queue a manual run.
- [ ] Verify queued run log row exists.
- [ ] Verify queued scheduler command exists.
- [ ] Verify worker picks up the command.
- [ ] Verify run progresses from `Queued` to active or completed state.
- [ ] Verify price rows are written into `asset_price`.
- [ ] Verify each written row uses the correct `broker_assets.id`.
- [ ] Verify no new data is written to `market_prices_binance`.
- [ ] Verify `inserted`, `updated`, `skipped`, and any other exposed counters are captured and change as expected.
- [ ] Verify update log rows are written for affected broker assets.
- [ ] Export CSV and verify row count matches filtered UI data.
- [ ] Pause the scheduler and verify pending commands are cancelled.
- [ ] Resume the scheduler and verify it becomes runnable again.
- [ ] Test stop and restart behavior in queue mode.

## 19. Fast Regression Set

- [ ] Existing global scheduler behavior test passes for `asset-price-sync`.
- [ ] Config normalization test passes.
- [ ] Queue dedupe test passes.
- [ ] Pause cancels pending command test passes.
- [ ] Restart queues stop plus run in the right order when a run is active.
- [ ] Runs listing and progress endpoints return expected shapes.
- [ ] Update log filtering and CSV export return expected rows.
- [ ] Table rename or migration test proves reads and writes use `asset_price`.
- [ ] Repository test proves broker asset ID is the storage key instead of symbol.
