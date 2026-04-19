import assert from 'node:assert/strict';

import { OrdersController } from '../src/api/controllers/OrdersController';
import { OrdersOverviewController } from '../src/api/controllers/OrdersOverviewController';
import { BrokerOrdersFacadeService } from '../src/api/services/BrokerOrdersFacadeService';
import { OrdersOverviewService } from '../src/api/services/OrdersOverviewService';
import { coreDataSource } from '../src/database/data-source';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
} from '../src/api/utils/apiTimeContract';
import {
  validateCreateOrderBody,
  validateOrderSubmissionAttemptsQuery,
  validateOrdersRefreshBody,
  validateOrdersQuery,
  validateOrdersSyncStatusQuery,
} from '../src/api/validators/orders.validator';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function expectBadRequestSync(run: () => unknown, message: string): void {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 400 &&
      error.message === message
  );
}

async function runValidatorAssertions(): Promise<void> {
  assert.deepEqual(
    validateOrdersQuery({
      limit: '200',
      brokerKey: ' mudrex ',
      accountId: ' acct-2 ',
      startDate: '2026-04-01',
      endDate: '2026-04-09',
    }),
    {
      limit: 200,
      brokerKey: 'mudrex',
      accountId: 'acct-2',
      startDate: '2026-04-01',
      endDate: '2026-04-09',
    }
  );

  expectBadRequestSync(
    () => validateOrdersQuery({ limit: '0' }),
    'limit must be an integer between 1 and 50000'
  );

  expectBadRequestSync(
    () =>
      validateOrdersQuery({
        startDate: '2026-04-10',
        endDate: '2026-04-09',
      }),
    'startDate must be earlier than or equal to endDate'
  );

  assert.deepEqual(
    validateCreateOrderBody({
      brokerKey: ' mudrex ',
      accountId: ' acct-2 ',
      idempotency_key: ' order-submit-1 ',
      symbol: ' btcusdt ',
      side: 'SELL',
      execution_mode: ' paper ',
      suggested_trade_id: 'suggested-1',
      leverage: 5,
      quantity: 2,
      order_price: 64000,
      order_type: 'market',
      trigger_type: 'immediate',
      is_takeprofit: false,
      is_stoploss: false,
      stoploss_price: 62000,
      takeprofit_price: 66000,
      reduce_only: false,
    }),
    {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
      idempotency_key: 'order-submit-1',
      symbol: 'BTCUSDT',
      side: 'short',
      execution_mode: 'paper',
      suggested_trade_id: 'suggested-1',
      leverage: 5,
      quantity: 2,
      order_price: 64000,
      order_type: 'market',
      trigger_type: 'immediate',
      is_takeprofit: false,
      is_stoploss: false,
      stoploss_price: 62000,
      takeprofit_price: 66000,
      reduce_only: false,
    }
  );

  expectBadRequestSync(
    () =>
      validateCreateOrderBody({
        idempotency_key: 'short',
        leverage: 5,
        quantity: 2,
        order_price: 64000,
        order_type: 'market',
        trigger_type: 'immediate',
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: 62000,
        takeprofit_price: 66000,
        reduce_only: false,
      }),
    'idempotency_key must be between 8 and 191 characters when provided'
  );

  expectBadRequestSync(
    () =>
      validateCreateOrderBody({
        leverage: 0,
        quantity: 2,
        order_price: 64000,
        order_type: 'market',
        trigger_type: 'immediate',
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: 62000,
        takeprofit_price: 66000,
        reduce_only: false,
      }),
    'leverage must be a positive number'
  );

  assert.deepEqual(
    validateOrdersRefreshBody({
      brokerKey: ' mudrex ',
      accountId: ' acct-2 ',
    }),
    {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
    }
  );

  assert.deepEqual(
    validateOrdersSyncStatusQuery({
      brokerKey: ' mudrex ',
      accountId: ' acct-2 ',
    }),
    {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
    }
  );

  assert.deepEqual(
    validateOrderSubmissionAttemptsQuery({
      limit: '25',
      offset: '5',
      suggestedTradeId: ' suggested-1 ',
      status: ' Completed ',
      placementState: ' Placed ',
      reconciliationState: ' Pending ',
      brokerKey: ' Mudrex ',
      accountId: ' acct-2 ',
    }),
    {
      limit: 25,
      offset: 5,
      suggestedTradeId: 'suggested-1',
      status: 'completed',
      placementState: 'placed',
      reconciliationState: 'pending',
      brokerKey: 'mudrex',
      accountId: 'acct-2',
    }
  );

  expectBadRequestSync(
    () => validateOrderSubmissionAttemptsQuery({ placementState: 'lost' }),
    'placementState must be one of registered, submitting, placed, rejected, replayed'
  );
}

async function runOrdersOverviewServiceAssertions(): Promise<void> {
  const originalDateNow = Date.now;
  Date.now = () => new Date('2026-04-09T12:00:00.000Z').getTime();
  const timeZone = 'Asia/Calcutta';

  try {
    const service = new OrdersOverviewService() as any;
    const openQueries: Array<Record<string, unknown>> = [];
    const historyQueries: Array<Record<string, unknown>> = [];
    const syncStatusQueries: Array<Record<string, unknown>> = [];

    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };

    service.ordersService = {
      async getFuturesOrdersForActiveAccounts(
        userId: string,
        query: Record<string, unknown>
      ) {
        assert.equal(userId, 'user-1');
        openQueries.push(query);
        return createSuccess({
          totalActiveAccounts: 2,
          successCount: 2,
          failureCount: 0,
          items: [
            {
              accountId: 'acct-1',
              accountName: 'Desk One',
              accountKey: 'desk-one',
              brokerKey: 'mudrex',
              status: 'connected',
              totalOrders: 1,
              data: [
                {
                  id: 'open-1',
                  symbol: 'BTCUSDT',
                  status: 'OPEN',
                  quantity: '2',
                  price: '64000',
                  first_seen_at: '2026-04-09T09:45:00.000Z',
                  last_seen_at: '2026-04-09T11:45:00.000Z',
                  snapshot_status_rank: 1,
                },
              ],
              error: null,
            },
            {
              accountId: 'acct-2',
              accountName: 'Desk Two',
              accountKey: 'desk-two',
              brokerKey: 'mudrex',
              status: 'connected',
              totalOrders: 1,
              data: [
                {
                  id: 'open-2',
                  symbol: 'ETHUSDT',
                  status: 'PENDING',
                  quantity: '1.5',
                  order_price: '3550',
                  first_seen_at: '2026-04-09T10:00:00.000Z',
                  last_seen_at: '2026-04-09T11:55:00.000Z',
                  snapshot_status_rank: 2,
                },
              ],
              error: null,
            },
          ],
        });
      },
      async getFuturesOrderHistoryForActiveAccounts(
        userId: string,
        query: Record<string, unknown>
      ) {
        assert.equal(userId, 'user-1');
        historyQueries.push(query);
        return createSuccess({
          totalActiveAccounts: 2,
          successCount: 2,
          failureCount: 0,
          items: [
            {
              accountId: 'acct-1',
              accountName: 'Desk One',
              accountKey: 'desk-one',
              brokerKey: 'mudrex',
              status: 'connected',
              totalOrders: 1,
              data: [
                {
                  id: 'hist-1',
                  symbol: 'BTCUSDT',
                  status: 'FILLED',
                  filled_price: '65000',
                  first_seen_at: '2026-04-08T11:00:00.000Z',
                  last_seen_at: '2026-04-08T11:30:00.000Z',
                  snapshot_status_rank: 3,
                },
              ],
              error: null,
            },
            {
              accountId: 'acct-2',
              accountName: 'Desk Two',
              accountKey: 'desk-two',
              brokerKey: 'mudrex',
              status: 'connected',
              totalOrders: 1,
              data: [
                {
                  id: 'hist-2',
                  symbol: 'ETHUSDT',
                  status: 'CLOSED',
                  filled_price: '3525',
                  first_seen_at: '2026-04-08T12:00:00.000Z',
                  last_seen_at: '2026-04-08T12:20:00.000Z',
                  snapshot_status_rank: 4,
                },
              ],
              error: null,
            },
          ],
        });
      },
      async getOrdersSyncStatus(userId: string, query: Record<string, unknown>) {
        assert.equal(userId, 'user-1');
        syncStatusQueries.push(query);
        return {
          state: 'healthy',
          label: 'Healthy',
          summary:
            'Connected broker routes are aligned with the latest visible order snapshots and checkpoints.',
          generatedAt: '2026-04-09T12:00:00.000Z',
          scope: 'account',
          brokerKey: 'mudrex',
          accountId: 'acct-2',
          totalAccounts: 1,
          pendingRecords: 0,
          failedRecords: 0,
          resolvedRecords: 0,
          items: [
            {
              accountId: 'acct-2',
              accountName: 'Desk Two',
              accountKey: 'desk-two',
              brokerKey: 'mudrex',
              status: 'connected',
              freshness: {
                checkpoint: {
                  state: 'fresh',
                  observedAt: '2026-04-09T11:54:00.000Z',
                  freshnessMs: 360000,
                  staleAfterMs: 900000,
                  criticalAfterMs: 1800000,
                  isStale: false,
                  isCritical: false,
                  source: 'sync_checkpoint',
                },
                latestSnapshot: {
                  state: 'fresh',
                  observedAt: '2026-04-09T11:55:00.000Z',
                  freshnessMs: 300000,
                  staleAfterMs: 900000,
                  criticalAfterMs: 1800000,
                  isStale: false,
                  isCritical: false,
                  source: 'order_snapshot',
                },
                warning: null,
              },
              pendingRecords: 0,
              failedRecords: 0,
              resolvedRecords: 0,
              nextRetryAt: null,
              lastPendingUpdateAt: null,
              warning: null,
            },
          ],
          freshness: {
            observedAt: '2026-04-09T11:55:00.000Z',
            freshAccounts: 1,
            staleAccounts: 0,
            criticalAccounts: 0,
            unknownAccounts: 0,
            warning: null,
          },
          latestCheckpointAt: '2026-04-09T11:54:00.000Z',
          latestSnapshotAt: '2026-04-09T11:55:00.000Z',
          nextRetryAt: null,
        };
      },
    };

    const response = await service.getOverview('user-1', {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
      startDate: '2026-04-01',
      endDate: '2026-04-09',
    });

    assert.deepEqual(openQueries, [
      {
        brokerKey: 'mudrex',
      },
    ]);
    assert.deepEqual(historyQueries, [
      {
        brokerKey: 'mudrex',
        startDate: '2026-04-01',
        endDate: '2026-04-09',
      },
    ]);
    assert.deepEqual(syncStatusQueries, [
      {
        brokerKey: 'mudrex',
        accountId: 'acct-2',
      },
    ]);
    assert.equal(response.data.meta.contractVersion, 'orders-phase9-2026-04-10');
    assert.equal(response.data.meta.purpose, 'global_execution_console');
    assert.deepEqual(response.data.time, buildApiTimeContract(timeZone));
    assert.deepEqual(response.data.meta.time, buildApiTimeContract(timeZone));
    assert.equal(
      response.data.meta.summary,
      'Phase 9 keeps `/orders/overview` as the page-hydration contract: snapshot-backed open/history sections now travel with embedded orders sync status, while create-order submissions remain idempotent and broker rejection errors stay normalized for operators.'
    );
    assert.equal(
      response.data.meta.query.supported.join(','),
      'brokerKey,accountId,startDate,endDate'
    );
    assert.equal(response.data.meta.query.unsupported.join(','), 'limit');
    assert.equal(
      response.data.meta.query.behavior.defaultScope,
      'all_active_connected_accounts'
    );
    assert.equal(
      response.data.meta.query.behavior.accountId,
      'post_aggregation_row_filter'
    );
    assert.equal(
      response.data.meta.query.behavior.startDate,
      'applies_to_history_and_paper_only'
    );
    assert.equal(
      response.data.meta.query.behavior.endDate,
      'applies_to_history_and_paper_only'
    );
    assert.equal(
      response.data.meta.query.behavior.syncStatus,
      'follows_desk_broker_or_selected_route_scope_without_failing_on_empty_account_post_filter'
    );
    assert.deepEqual(response.data.meta.query.resolved, {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
      startDate: '2026-04-01',
      endDate: '2026-04-09',
    });
    assert.equal(response.data.meta.sources.openOrders, 'scheduler_orders_snapshots');
    assert.equal(response.data.meta.sources.paperOrders, 'paper_orders');
    assert.equal(
      response.data.meta.sources.createSubmissionLedger,
      'order_submission_requests'
    );
    assert.equal(
      response.data.meta.sources.syncStatus,
      'scheduler_orders_snapshots + scheduler_sync_checkpoints + scheduler_sync_pending_records'
    );
    assert.equal(response.data.meta.pageTruth.monitoringScope, 'global_active_accounts');
    assert.equal(response.data.meta.pageTruth.creationScope, 'selected_broker_route');
    assert.equal(response.data.meta.pageTruth.liveReadModel, 'snapshot_backed');
    assert.equal(response.data.meta.pageTruth.paperReadModel, 'db_backed_simulated');
    assert.equal(
      response.data.meta.pageTruth.detailDrawerSource,
      'canonical_detail_fetch_with_row_fallback'
    );
    assert.equal(
      response.data.meta.pageTruth.activityTrailSource,
      'activity_logs_route_and_reference_filters'
    );
    assert.equal(
      response.data.meta.pageTruth.liveWriteFlow,
      'broker_write_with_snapshot_ack_polling'
    );
    assert.equal(
      response.data.meta.pageTruth.paperWriteFlow,
      'db_write_with_local_reconciliation'
    );
    assert.equal(
      response.data.meta.pageTruth.createMutationHardening,
      'server_idempotency_keys_and_normalized_rejections'
    );
    assert.equal(
      response.data.meta.pageTruth.workspaceStructure,
      'workspace_ticket_detail_modules'
    );
    assert.equal(response.data.meta.capabilities.routeScopedCreate, true);
    assert.equal(response.data.meta.capabilities.routeScopedMonitoring, true);
    assert.equal(response.data.meta.capabilities.liveSnapshotFreshnessExposed, true);
    assert.equal(response.data.meta.capabilities.canonicalDetailFetchUsedByPage, true);
    assert.equal(response.data.meta.capabilities.paperExecutionScheduler, true);
    assert.equal(
      response.data.meta.capabilities.localPaperWriteReconciliationUsedByPage,
      true
    );
    assert.equal(
      response.data.meta.capabilities.targetedLiveSyncPollingUsedByPage,
      true
    );
    assert.equal(response.data.meta.capabilities.embeddedSyncStatus, true);
    assert.equal(
      response.data.meta.capabilities.executionSurfaceSplitByMode,
      true
    );
    assert.equal(
      response.data.meta.capabilities.executionActivityTrailUsedByPage,
      true
    );
    assert.equal(
      response.data.meta.capabilities.pageModulesSplitByConcern,
      true
    );
    assert.equal(response.data.meta.capabilities.createSubmitIdempotency, true);
    assert.equal(response.data.meta.capabilities.normalizedBrokerRejectCodes, true);
    assert.equal(response.data.syncStatus.state, 'healthy');
    assert.equal(response.data.syncStatus.scope, 'account');
    assert.equal(response.data.syncStatus.accountId, 'acct-2');
    assert.equal(response.data.syncStatus.totalAccounts, 1);
    assert.equal(
      response.data.syncStatus.latestSnapshotAt,
      formatApiDisplayTime('2026-04-09T11:55:00.000Z', timeZone)
    );
    assert.equal(response.data.syncStatus.latestSnapshotAtIso, '2026-04-09T11:55:00.000Z');
    assert.equal(response.data.openOrders.source, 'scheduler_orders_snapshots');
    assert.equal(response.data.openOrders.rowModel, 'normalized_live_snapshot');
    assert.equal(response.data.openOrders.freshnessModel, 'snapshot_timestamp');
    assert.equal(
      response.data.openOrders.latestSnapshotAt,
      formatApiDisplayTime('2026-04-09T11:55:00.000Z', timeZone)
    );
    assert.equal(response.data.openOrders.latestSnapshotAtIso, '2026-04-09T11:55:00.000Z');
    assert.equal(
      response.data.openOrders.oldestSnapshotAt,
      formatApiDisplayTime('2026-04-09T11:55:00.000Z', timeZone)
    );
    assert.equal(response.data.openOrders.oldestSnapshotAtIso, '2026-04-09T11:55:00.000Z');
    assert.equal(response.data.openOrders.totalRows, 1);
    assert.equal(response.data.openOrders.totalAccounts, 1);
    assert.equal(response.data.openOrders.items.length, 1);
    assert.equal(response.data.openOrders.items[0]?.accountId, 'acct-2');
    assert.equal(response.data.openOrders.items[0]?.mode, 'live');
    assert.equal(response.data.openOrders.items[0]?.quantity, 1.5);
    assert.equal(response.data.openOrders.items[0]?.order_price, 3550);
    assert.equal(
      response.data.openOrders.items[0]?.snapshot.lastSeenAt,
      formatApiDisplayTime('2026-04-09T11:55:00.000Z', timeZone)
    );
    assert.equal(response.data.openOrders.items[0]?.snapshot.lastSeenAtIso, '2026-04-09T11:55:00.000Z');
    assert.equal(response.data.openOrders.items[0]?.snapshot.state, 'open');
    assert.equal(response.data.openOrders.items[0]?.route.accountKey, 'desk-two');
    assert.equal(response.data.history.source, 'scheduler_orders_snapshots');
    assert.equal(response.data.history.rowModel, 'normalized_live_snapshot');
    assert.equal(response.data.history.freshnessModel, 'snapshot_timestamp');
    assert.equal(
      response.data.history.latestSnapshotAt,
      formatApiDisplayTime('2026-04-08T12:20:00.000Z', timeZone)
    );
    assert.equal(response.data.history.latestSnapshotAtIso, '2026-04-08T12:20:00.000Z');
    assert.equal(
      response.data.history.oldestSnapshotAt,
      formatApiDisplayTime('2026-04-08T12:20:00.000Z', timeZone)
    );
    assert.equal(response.data.history.oldestSnapshotAtIso, '2026-04-08T12:20:00.000Z');
    assert.equal(response.data.history.totalRows, 1);
    assert.equal(response.data.history.items.length, 1);
    assert.equal(response.data.history.items[0]?.accountId, 'acct-2');
    assert.equal(response.data.history.items[0]?.filled_price, 3525);
    assert.equal(response.data.history.items[0]?.snapshot.state, 'history');
    assert.equal(
      response.data.history.items[0]?.snapshot.firstSeenAt,
      formatApiDisplayTime('2026-04-08T12:00:00.000Z', timeZone)
    );
    assert.equal(response.data.history.items[0]?.snapshot.firstSeenAtIso, '2026-04-08T12:00:00.000Z');

    const fallbackService = new OrdersOverviewService() as any;
    fallbackService.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };
    fallbackService.ordersService = {
      async getFuturesOrdersForActiveAccounts() {
        return createSuccess({ items: [] });
      },
      async getFuturesOrderHistoryForActiveAccounts() {
        return createSuccess({ items: [] });
      },
      async getOrdersSyncStatus() {
        const error = new Error(
          'Broker account not found for the requested orders sync scope'
        ) as Error & {
          httpCode?: number;
        };
        error.httpCode = 404;
        throw error;
      },
    };

    const fallbackResponse = await fallbackService.getOverview('user-1', {
      brokerKey: 'mudrex',
      accountId: 'acct-missing',
    });

    assert.equal(fallbackResponse.data.syncStatus.state, 'idle');
    assert.equal(fallbackResponse.data.syncStatus.scope, 'account');
    assert.equal(fallbackResponse.data.syncStatus.accountId, 'acct-missing');
    assert.equal(
      fallbackResponse.data.syncStatus.summary,
      'No connected or idle broker routes are available for orders sync in the selected route.'
    );
  } finally {
    Date.now = originalDateNow;
  }
}

async function runOrdersDetailServiceAssertions(): Promise<void> {
  const originalDateNow = Date.now;
  Date.now = () => new Date('2026-04-09T12:30:00.000Z').getTime();
  const timeZone = 'Asia/Calcutta';

  try {
    const service = new BrokerOrdersFacadeService() as any;
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };

    service.paperOrderExecutionService = {
      async simulateUserPaperOrders() {
        return { updatedOrderIds: [] };
      },
    };
    service.suggestedTradesService = {
      async syncExecutionForPaperOrderUpdates() {
        return undefined;
      },
    };
    service.paperOrderRepository = {
      async getPaperOrderById(userId: string, paperOrderId: string) {
        assert.equal(userId, 'user-1');
        assert.equal(paperOrderId, 'paper-1');
        return {
          id: 'paper-1',
          suggestedTradeId: null,
          assetId: 'asset-1',
          brokerKey: 'mudrex',
          accountId: 'acct-2',
          symbol: 'ETHUSDT',
          side: 'BUY',
          orderType: 'limit',
          triggerType: 'immediate',
          status: 'OPEN',
          leverage: 5,
          quantity: '2',
          orderPrice: '3500',
          stoplossPrice: '3400',
          takeprofitPrice: '3650',
          reduceOnly: false,
          canceledAt: null,
          createdAt: new Date('2026-04-09T11:00:00.000Z'),
          updatedAt: new Date('2026-04-09T12:00:00.000Z'),
          payload: {
            simulation: {
              executionState: 'pending',
              lastPrice: 3512,
              lastPriceSeenAt: '2026-04-09T12:29:00.000Z',
              lastObservationSource: 'snapshot',
            },
          },
        };
      },
    };
    service.brokerAccountRoutingService = {
      async resolve(userId: string, brokerKey?: string, accountId?: string) {
        assert.equal(userId, 'user-1');
        assert.equal(brokerKey, 'mudrex');
        assert.equal(accountId, 'acct-2');
        return {
          brokerKey: 'mudrex',
          accountId: 'acct-2',
        };
      },
    };
    service.brokerAccountRepository = {
      async getBrokerAccountById(userId: string, accountId: string) {
        assert.equal(userId, 'user-1');
        assert.equal(accountId, 'acct-2');
        return {
          id: 'acct-2',
          accountName: 'Desk Two',
          accountKey: 'desk-two',
          status: 'Connected',
        };
      },
    };
    service.getOrderSnapshotByExternalId = async (
      userId: string,
      brokerKey: string,
      accountId: string,
      orderId: string,
      routeContext: Record<string, unknown>
    ) => {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      assert.equal(accountId, 'acct-2');
      assert.equal(orderId, 'live-1');
      assert.deepEqual(routeContext, {
        accountName: 'Desk Two',
        accountKey: 'desk-two',
        accountStatus: 'Connected',
      });
      return {
        id: 'live-1',
        order_id: 'live-1',
        external_id: 'live-1',
        mode: 'live',
        source: 'scheduler_orders_snapshots',
        brokerKey: 'mudrex',
        accountId: 'acct-2',
        accountName: 'Desk Two',
        accountKey: 'desk-two',
        status: 'OPEN',
        snapshot: {
          source: 'scheduler_orders_snapshots',
          statusRank: 1,
          state: 'open',
          firstSeenAt: '2026-04-09T12:20:00.000Z',
          lastSeenAt: '2026-04-09T12:28:00.000Z',
        },
        detailMeta: {
          sourceKind: 'snapshot_backed_live',
          sourceLabel: 'Live broker snapshot',
          freshnessModel: 'scheduler_snapshot',
          fetchedAt: '2026-04-09T12:30:00.000Z',
          canLagAfterBrokerWrite: true,
        },
      };
    };

    const paperResponse = await service.getPaperOrder('user-1', 'paper-1');
    assert.equal(paperResponse.data.mode, 'paper');
    assert.equal(paperResponse.data.source, 'paper_orders');
    assert.equal(paperResponse.data.detailMeta.sourceKind, 'paper_simulation');
    assert.equal(
      paperResponse.data.detailMeta.freshnessModel,
      'db_backed_simulation'
    );
    assert.equal(paperResponse.data.lifecycle_stage, 'open_order');
    assert.equal(paperResponse.data.lifecycle_can_cancel, true);
    assert.equal(
      paperResponse.data.lifecycle_last_transition_type,
      'created'
    );
    assert.equal(
      paperResponse.data.last_observation_source,
      'snapshot'
    );
    assert.equal(paperResponse.data.execution_history.length, 1);
    assert.equal(paperResponse.data.execution_history[0].type, 'created');

    const liveResponse = await service.getFuturesOrder('user-1', 'live-1', {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
    });
    assert.equal(liveResponse.data.mode, 'live');
    assert.equal(liveResponse.data.source, 'scheduler_orders_snapshots');
    assert.equal(
      liveResponse.data.detailMeta.sourceKind,
      'snapshot_backed_live'
    );
    assert.equal(liveResponse.data.snapshot.lastSeenAt, '2026-04-09T12:28:00.000Z');
  } finally {
    Date.now = originalDateNow;
  }
}

async function runOrdersRefreshServiceAssertions(): Promise<void> {
  const timeZone = 'Asia/Calcutta';
  const service = new BrokerOrdersFacadeService() as any;
  let syncPayload: Record<string, unknown> | null = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };

  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      return [
        {
          id: 'acct-1',
          accountName: 'Desk One',
          accountKey: 'desk-one',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
        {
          id: 'acct-2',
          accountName: 'Desk Two',
          accountKey: 'desk-two',
          brokerKey: 'mudrex',
          status: 'Idle',
        },
      ];
    },
  };
  service.internalOrdersSyncService = {
    async runBatch(payload: Record<string, unknown>) {
      syncPayload = payload;
      return {
        processedUsers: 1,
        succeededUsers: 1,
        failedUsers: 0,
        processedAccounts: 1,
        fetchedRecords: 12,
        insertedRecords: 4,
        updatedRecords: 5,
        skippedRecords: 3,
        failedAccounts: 0,
        failures: [],
      };
    },
  };

  const successResponse = await service.requestOrdersRefresh('user-1', {
    brokerKey: 'mudrex',
    accountId: 'acct-2',
  });

  assert.deepEqual(syncPayload, {
    executionScope: 'product_user',
    requestUserId: 'user-1',
    targetUserIds: ['user-1'],
    brokerKeys: ['mudrex'],
    accountIds: ['acct-2'],
  });
  assert.equal(successResponse.requested, true);
  assert.equal(successResponse.state, 'completed');
  assert.equal(successResponse.scope, 'account');
  assert.equal(successResponse.brokerKey, 'mudrex');
  assert.equal(successResponse.accountId, 'acct-2');
  assert.equal(successResponse.processedAccounts, 1);
  assert.equal(successResponse.failedAccounts, 0);
  assert.equal(successResponse.fetchedRecords, 12);
  assert.equal(successResponse.insertedRecords, 4);
  assert.equal(successResponse.updatedRecords, 5);
  assert.equal(successResponse.skippedRecords, 3);
  assert.deepEqual(successResponse.failures, []);
  assert.equal(
    successResponse.summary,
    'Reconciled 1 route for the live orders desk.'
  );

  const warningService = new BrokerOrdersFacadeService() as any;
  let idleRunBatchCalled = false;
  warningService.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };
  warningService.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, undefined);
      return [];
    },
  };
  warningService.internalOrdersSyncService = {
    async runBatch() {
      idleRunBatchCalled = true;
      return {
        processedUsers: 0,
        succeededUsers: 0,
        failedUsers: 0,
        processedAccounts: 0,
        fetchedRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        skippedRecords: 0,
        failedAccounts: 0,
        failures: [],
      };
    },
  };

  const idleResponse = await warningService.requestOrdersRefresh('user-1', {});
  assert.equal(idleRunBatchCalled, false);
  assert.equal(idleResponse.requested, false);
  assert.equal(idleResponse.state, 'idle');
  assert.equal(idleResponse.scope, 'desk');
  assert.equal(
    idleResponse.summary,
    'No connected or idle broker routes are available for orders refresh on this desk.'
  );

  const notFoundService = new BrokerOrdersFacadeService() as any;
  notFoundService.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };
  notFoundService.brokerAccountRepository = {
    async getActiveBrokerAccounts() {
      return [
        {
          id: 'acct-1',
          accountName: 'Desk One',
          accountKey: 'desk-one',
          brokerKey: 'mudrex',
          status: 'Connected',
        },
      ];
    },
  };
  notFoundService.internalOrdersSyncService = {
    async runBatch() {
      throw new Error('runBatch should not be called for missing account scope');
    },
  };

  await assert.rejects(
    notFoundService.requestOrdersRefresh('user-1', {
      brokerKey: 'mudrex',
      accountId: 'acct-9',
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 404 &&
      error.message === 'Broker account not found for the requested orders refresh scope'
  );
}

async function runOrdersSyncStatusServiceAssertions(): Promise<void> {
  const originalDateNow = Date.now;
  const originalQuery = coreDataSource.query.bind(coreDataSource);
  const timeZone = 'Asia/Calcutta';

  Date.now = () => new Date('2026-04-10T12:00:00.000Z').getTime();

  try {
    const service = new BrokerOrdersFacadeService() as any;
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };
    service.brokerAccountRepository = {
      async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
        assert.equal(userId, 'user-1');
        assert.equal(brokerKey, 'mudrex');
        return [
          {
            id: 'acct-1',
            accountName: 'Desk One',
            accountKey: 'desk-one',
            brokerKey: 'mudrex',
            status: 'Connected',
          },
        ];
      },
    };

    coreDataSource.query = (async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        assert.deepEqual(params, ['user-1', 'acct-1']);
        return [
          {
            accountId: 'acct-1',
            observedAt: '2026-04-10T11:59:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM scheduler_sync_checkpoints')) {
        assert.deepEqual(params, ['orders-sync', 'acct-1']);
        return [
          {
            accountId: 'acct-1',
            checkpointAt: '2026-04-10T11:58:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM scheduler_sync_pending_records')) {
        assert.deepEqual(params, ['orders-sync', 'acct-1']);
        return [];
      }
      throw new Error(`Unexpected SQL in healthy orders sync status test: ${sql}`);
    }) as typeof coreDataSource.query;

    const healthyResponse = await service.getOrdersSyncStatus('user-1', {
      brokerKey: 'mudrex',
      accountId: 'acct-1',
    });

    assert.equal(healthyResponse.state, 'healthy');
    assert.equal(healthyResponse.label, 'Healthy');
    assert.equal(healthyResponse.scope, 'account');
    assert.equal(healthyResponse.totalAccounts, 1);
    assert.equal(healthyResponse.pendingRecords, 0);
    assert.equal(healthyResponse.failedRecords, 0);
    assert.equal(healthyResponse.resolvedRecords, 0);
    assert.equal(
      healthyResponse.latestCheckpointAt,
      formatApiDisplayTime('2026-04-10T11:58:00.000Z', timeZone)
    );
    assert.equal(healthyResponse.latestCheckpointAtIso, '2026-04-10T11:58:00.000Z');
    assert.equal(
      healthyResponse.latestSnapshotAt,
      formatApiDisplayTime('2026-04-10T11:59:00.000Z', timeZone)
    );
    assert.equal(healthyResponse.latestSnapshotAtIso, '2026-04-10T11:59:00.000Z');
    assert.deepEqual(healthyResponse.time, buildApiTimeContract(timeZone));
    assert.equal(healthyResponse.items[0]?.freshness?.latestSnapshot?.state, 'fresh');
    assert.equal(healthyResponse.items[0]?.freshness?.checkpoint?.state, 'fresh');
    assert.equal(healthyResponse.items[0]?.warning, null);

    const attentionService = new BrokerOrdersFacadeService() as any;
    attentionService.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };
    attentionService.brokerAccountRepository = {
      async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
        assert.equal(userId, 'user-1');
        assert.equal(brokerKey, undefined);
        return [
          {
            id: 'acct-1',
            accountName: 'Desk One',
            accountKey: 'desk-one',
            brokerKey: 'mudrex',
            status: 'Connected',
          },
          {
            id: 'acct-2',
            accountName: 'Desk Two',
            accountKey: 'desk-two',
            brokerKey: 'delta',
            status: 'Idle',
          },
        ];
      },
    };

    coreDataSource.query = (async (sql: string) => {
      if (sql.includes('FROM scheduler_orders_snapshots')) {
        return [
          {
            accountId: 'acct-1',
            observedAt: '2026-04-10T11:40:00.000Z',
          },
          {
            accountId: 'acct-2',
            observedAt: '2026-04-10T11:58:30.000Z',
          },
        ];
      }
      if (sql.includes('FROM scheduler_sync_checkpoints')) {
        return [
          {
            accountId: 'acct-1',
            checkpointAt: '2026-04-10T11:39:00.000Z',
          },
          {
            accountId: 'acct-2',
            checkpointAt: '2026-04-10T11:58:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM scheduler_sync_pending_records')) {
        return [
          {
            accountId: 'acct-2',
            pendingRecords: 1,
            failedRecords: 1,
            resolvedRecords: 0,
            nextRetryAt: '2026-04-10T12:05:00.000Z',
            lastPendingUpdateAt: '2026-04-10T11:59:30.000Z',
          },
        ];
      }
      throw new Error(`Unexpected SQL in attention orders sync status test: ${sql}`);
    }) as typeof coreDataSource.query;

    const attentionResponse = await attentionService.getOrdersSyncStatus('user-1', {});
    assert.equal(attentionResponse.state, 'attention');
    assert.equal(attentionResponse.label, 'Needs attention');
    assert.equal(attentionResponse.scope, 'desk');
    assert.equal(attentionResponse.totalAccounts, 2);
    assert.equal(attentionResponse.pendingRecords, 1);
    assert.equal(attentionResponse.failedRecords, 1);
    assert.equal(
      attentionResponse.latestSnapshotAt,
      formatApiDisplayTime('2026-04-10T11:58:30.000Z', timeZone)
    );
    assert.equal(attentionResponse.latestSnapshotAtIso, '2026-04-10T11:58:30.000Z');
    assert.equal(
      attentionResponse.nextRetryAt,
      formatApiDisplayTime('2026-04-10T12:05:00.000Z', timeZone)
    );
    assert.equal(attentionResponse.nextRetryAtIso, '2026-04-10T12:05:00.000Z');
    assert.equal(
      attentionResponse.summary,
      '1 sync record still need operator attention on the live desk.'
    );
    assert.equal(attentionResponse.items[0]?.freshness?.latestSnapshot?.state, 'critical');
    assert.equal(attentionResponse.items[1]?.warning, '1 failed sync record still need review.');

    const idleService = new BrokerOrdersFacadeService() as any;
    idleService.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };
    idleService.brokerAccountRepository = {
      async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
        assert.equal(userId, 'user-1');
        assert.equal(brokerKey, undefined);
        return [];
      },
    };

    coreDataSource.query = (async () => {
      throw new Error('query should not run for idle orders sync status');
    }) as typeof coreDataSource.query;

    const idleResponse = await idleService.getOrdersSyncStatus('user-1', {});
    assert.equal(idleResponse.state, 'idle');
    assert.equal(idleResponse.label, 'No routes');
    assert.equal(idleResponse.totalAccounts, 0);
    assert.equal(
      idleResponse.summary,
      'No connected or idle broker routes are available for orders sync on this desk.'
    );

    const notFoundService = new BrokerOrdersFacadeService() as any;
    notFoundService.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };
    notFoundService.brokerAccountRepository = {
      async getActiveBrokerAccounts() {
        return [
          {
            id: 'acct-1',
            accountName: 'Desk One',
            accountKey: 'desk-one',
            brokerKey: 'mudrex',
            status: 'Connected',
          },
        ];
      },
    };

    coreDataSource.query = (async () => {
      throw new Error('query should not run for missing account sync status');
    }) as typeof coreDataSource.query;

    await assert.rejects(
      notFoundService.getOrdersSyncStatus('user-1', {
        brokerKey: 'mudrex',
        accountId: 'acct-9',
      }),
      (error: unknown) =>
        error instanceof Error &&
        (error as { httpCode?: number }).httpCode === 404 &&
        error.message === 'Broker account not found for the requested orders sync scope'
    );
  } finally {
    Date.now = originalDateNow;
    coreDataSource.query = originalQuery;
  }
}

async function runOrdersOverviewControllerAssertions(): Promise<void> {
  const controller = new OrdersOverviewController() as any;

  controller.ordersOverviewService = {
    async getOverview(...args: unknown[]) {
      return createSuccess({ args });
    },
  };

  const response = await controller.getOverview(
    { authUser: { sub: 'user-1' } },
    'mudrex',
    'acct-2',
    '2026-04-01',
    '2026-04-09'
  );

  assert.deepEqual(response.data.args, [
    'user-1',
    {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
      startDate: '2026-04-01',
      endDate: '2026-04-09',
    },
  ]);
}

async function runOrdersControllerAssertions(): Promise<void> {
  const controller = new OrdersController() as any;
  let createPaperArgs: unknown[] = [];
  let getPaperOrdersArgs: unknown[] = [];
  let refreshArgs: unknown[] = [];
  let syncStatusArgs: unknown[] = [];
  let submissionListArgs: unknown[] = [];
  let submissionDetailArgs: unknown[] = [];

  controller.ordersService = {
    async createFuturesOrder(...args: unknown[]) {
      createPaperArgs = args;
      return createSuccess({ message: 'ok' });
    },
    async getPaperOrders(...args: unknown[]) {
      getPaperOrdersArgs = args;
      return createSuccess({ message: 'ok' });
    },
    async requestOrdersRefresh(...args: unknown[]) {
      refreshArgs = args;
      return createSuccess({ message: 'ok' });
    },
    async getOrdersSyncStatus(...args: unknown[]) {
      syncStatusArgs = args;
      return createSuccess({ message: 'ok' });
    },
    async getOrderSubmissionAttempts(...args: unknown[]) {
      submissionListArgs = args;
      return { items: [], total: 0, limit: 50, offset: 0, filters: {} };
    },
    async getOrderSubmissionAttempt(...args: unknown[]) {
      submissionDetailArgs = args;
      return { id: 'submission-1' };
    },
  };

  await controller.createPaperOrder(
    { authUser: { sub: 'user-1' } },
    'asset-1',
    {
      leverage: 5,
      quantity: 2,
      order_price: 64000,
      order_type: 'market',
      trigger_type: 'immediate',
      is_takeprofit: false,
      is_stoploss: false,
      stoploss_price: 62000,
      takeprofit_price: 66000,
      reduce_only: false,
    }
  );

  assert.equal(createPaperArgs[0], 'user-1');
  assert.equal(createPaperArgs[1], 'asset-1');
  assert.equal(
    (createPaperArgs[2] as { execution_mode?: string }).execution_mode,
    'paper'
  );

  await controller.getPaperOrders(
    { authUser: { sub: 'user-1' } },
    '200',
    'mudrex',
    'acct-2',
    '2026-04-01',
    '2026-04-09'
  );

  assert.deepEqual(getPaperOrdersArgs, [
    'user-1',
    {
      limit: '200',
      brokerKey: 'mudrex',
      accountId: 'acct-2',
      startDate: '2026-04-01',
      endDate: '2026-04-09',
    },
  ]);

  await controller.requestFuturesOrdersRefresh(
    { authUser: { sub: 'user-1' } },
    {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
    }
  );

  assert.deepEqual(refreshArgs, [
    'user-1',
    {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
    },
  ]);

  await controller.getFuturesOrdersSyncStatus(
    { authUser: { sub: 'user-1' } },
    'mudrex',
    'acct-2'
  );

  assert.deepEqual(syncStatusArgs, [
    'user-1',
    {
      brokerKey: 'mudrex',
      accountId: 'acct-2',
    },
  ]);

  await controller.getOrderSubmissionAttempts(
    { authUser: { sub: 'user-1' } },
    '25',
    '5',
    'suggested-1',
    'completed',
    'placed',
    'pending',
    'mudrex',
    'acct-2'
  );

  assert.deepEqual(submissionListArgs, [
    'user-1',
    {
      limit: '25',
      offset: '5',
      suggestedTradeId: 'suggested-1',
      status: 'completed',
      placementState: 'placed',
      reconciliationState: 'pending',
      brokerKey: 'mudrex',
      accountId: 'acct-2',
    },
  ]);

  await controller.getOrderSubmissionAttempt(
    { authUser: { sub: 'user-1' } },
    'submission-1'
  );

  assert.deepEqual(submissionDetailArgs, ['user-1', 'submission-1']);
}

async function main(): Promise<void> {
  await runValidatorAssertions();
  await runOrdersOverviewServiceAssertions();
  await runOrdersDetailServiceAssertions();
  await runOrdersRefreshServiceAssertions();
  await runOrdersSyncStatusServiceAssertions();
  await runOrdersOverviewControllerAssertions();
  await runOrdersControllerAssertions();

  console.log('Orders contract assertions passed.');
}

main().catch((error) => {
  console.error('Orders contract assertion failure:', error);
  process.exit(1);
});
