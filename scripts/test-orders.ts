import assert from 'node:assert/strict';
import { runScriptSuite, runSuiteSteps } from './_support/run-script-suite';

// Consolidated module suite.

async function ordersGuard07(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const { assertOrdersHealthSnapshot, buildOrdersHealthSnapshot, } = await import("./checks/check-orders-health");

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

async function runHealthAssertionChecks(): Promise<void> {
  const snapshot = buildOrdersHealthSnapshot({
    baseUrl: 'http://127.0.0.1:3000/api/v1',
    overviewDurationMs: 900,
    paperDurationMs: 650,
    productSyncDurationMs: 420,
    productRefreshDurationMs: 510,
    nowMs: new Date('2026-04-10T12:05:00.000Z').getTime(),
    overviewPayload: {
      data: {
        meta: {
          contractVersion: 'orders-overview-phase9-2026-04-10',
          purpose: 'global_execution_console',
          capabilities: {
            embeddedSyncStatus: true,
            canonicalDetailFetchUsedByPage: true,
            localPaperWriteReconciliationUsedByPage: true,
            targetedLiveSyncPollingUsedByPage: true,
          },
          pageTruth: {
            detailDrawerSource: 'canonical_detail_fetch_with_row_fallback',
            liveWriteFlow: 'broker_write_with_snapshot_ack_polling',
            paperWriteFlow: 'db_write_with_local_reconciliation',
          },
        },
        syncStatus: {
          state: 'healthy',
          summary: 'Desk sync is healthy',
          scope: 'desk',
          items: [{ routeKey: 'mudrex:acct-1' }],
        },
        openOrders: {
          rowModel: 'normalized_live_snapshot',
          latestSnapshotAt: '2026-04-10T12:00:00.000Z',
          items: [
            {
              id: 'live-1',
              brokerKey: 'mudrex',
              accountId: 'acct-1',
            },
          ],
        },
        history: {
          rowModel: 'normalized_live_snapshot',
          items: [
            {
              id: 'hist-1',
            },
          ],
        },
      },
    },
    paperPayload: {
      data: [
        {
          id: 'paper-1',
        },
      ],
    },
    productSyncPayload: {
      data: {
        state: 'healthy',
        label: 'Healthy',
        summary: 'Orders desk sync healthy',
        scope: 'desk',
        totalAccounts: 1,
        pendingRecords: 0,
        failedRecords: 0,
        latestSnapshotAt: '2026-04-10T12:01:00.000Z',
        items: [{ routeKey: 'mudrex:acct-1' }],
      },
    },
    productRefreshPayload: {
      data: {
        requested: true,
        scope: 'desk',
        state: 'requested',
      },
    },
    liveDetailPayload: {
      data: {
        id: 'live-1',
        source: 'scheduler_orders_snapshots',
        brokerKey: 'mudrex',
        accountId: 'acct-1',
        snapshot: {
          lastSeenAt: '2026-04-10T12:02:00.000Z',
        },
        detailMeta: {
          sourceKind: 'snapshot_backed_live',
        },
      },
    },
    paperDetailPayload: {
      data: {
        id: 'paper-1',
        source: 'paper_orders',
        lifecycle: {
          stage: 'filled',
          terminal: true,
          lastTransition: {
            type: 'fill',
          },
        },
        detailMeta: {
          sourceKind: 'paper_simulation',
        },
        execution_history: [
          {
            id: 'exec-1',
          },
        ],
      },
    },
  });

  assert.equal(snapshot.embeddedSyncStatus, true);
  assert.equal(snapshot.productSyncSnapshot?.scope, 'desk');
  assert.equal(snapshot.productSyncSnapshot?.items, 1);
  assert.equal(snapshot.firstOpenOrderId, 'live-1');
  assert.equal(snapshot.firstPaperOrderId, 'paper-1');
  assert.equal(snapshot.openSnapshotAgeMs, 300000);

  assertOrdersHealthSnapshot(snapshot, {
    maxOverviewMs: 1200,
    maxPaperMs: 900,
    maxSyncStatusMs: 600,
    maxRefreshMs: 700,
    maxOpenSnapshotAgeMs: 400000,
    requireNormalizedOverview: true,
    requirePhase5WriteFlows: true,
    requireDetailConsistencyIfOpen: true,
    requirePaperLifecycleIfPresent: true,
    requireProductSyncChecks: true,
  });
}

async function runSignoffChecks(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orders-phase7-'));
  const gateFile = path.join(tempDir, 'orders-release-gate.json');
  const outputFile = path.join(tempDir, 'orders-signoff.json');

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: false,
    totals: {
      total: 6,
      passed: 6,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-orders-suite',
      'backend-orders-controllers',
      'backend-orders-eslint',
      'frontend-orders-eslint',
      'frontend-orders-ui',
      'frontend-orders-e2e',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(process.execPath, ['--import', 'tsx', 'scripts/signoffs/signoff-orders.ts'], {
    ...process.env,
    ORDERS_SIGNOFF_GATE_FILE: gateFile,
    ORDERS_SIGNOFF_OUTPUT_FILE: outputFile,
    ORDERS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED: 'true',
    ORDERS_SIGNOFF_WRITE_READ_CONSISTENCY_VERIFIED: 'true',
    ORDERS_SIGNOFF_SNAPSHOT_LAG_RUNBOOK_VERIFIED: 'true',
    ORDERS_SIGNOFF_OPERATOR_FLOWS_VERIFIED: 'true',
    ORDERS_SIGNOFF_SYNC_STATUS_VERIFIED: 'true',
    ORDERS_SIGNOFF_MANUAL_REFRESH_VERIFIED: 'true',
    ORDERS_SIGNOFF_APPROVER: 'codex-phase7',
  });

  assert.equal(exitCode, 0, 'orders signoff script should succeed against a ready gate');

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase7');
  assert.equal(summary.checks.requiredSuitesPassed, true);
  assert.equal(summary.checks.syncStatusVerified, true);
  assert.equal(summary.checks.manualRefreshVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'checks', 'check-orders-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-orders.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-orders.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');

  assert.equal(
    healthSource.includes('export function buildOrdersHealthSnapshot'),
    true,
    'orders health script must export buildOrdersHealthSnapshot for Phase 7 checks'
  );
  assert.equal(
    healthSource.includes('export function assertOrdersHealthSnapshot'),
    true,
    'orders health script must export assertOrdersHealthSnapshot for Phase 7 checks'
  );
  assert.equal(
    healthSource.includes("const isDirectRun = (() => {"),
    true,
    'orders health script must only auto-run when invoked directly'
  );
  assert.equal(
    releaseGateSource.includes('backend-orders-suite'),
    true,
    'release gate must include the consolidated orders suite'
  );
  assert.equal(
    releaseGateSource.includes('backend-orders-controllers'),
    true,
    'release gate must include the orders controller suite'
  );
  assert.equal(
    signoffSource.includes('backend-orders-suite'),
    true,
    'orders signoff must require the consolidated orders gate result'
  );
  assert.equal(
    signoffSource.includes('backend-orders-controllers'),
    true,
    'orders signoff must require the controller gate result'
  );
  assert.equal(
    signoffSource.includes('ORDERS_SIGNOFF_SYNC_STATUS_VERIFIED'),
    true,
    'orders signoff must require sync-status verification'
  );
  assert.equal(
    signoffSource.includes('ORDERS_SIGNOFF_MANUAL_REFRESH_VERIFIED'),
    true,
    'orders signoff must require manual refresh verification'
  );
  assert.equal(
    packageSource.includes('"test:orders"') &&
      packageSource.includes('scripts/test-orders.ts'),
    true,
    'package.json must expose the consolidated orders suite entrypoint'
  );
}

async function main(): Promise<void> {
  await runHealthAssertionChecks();
  await runSignoffChecks();
  await runSourceMarkerAssertions();
  console.log('Orders Phase 7 assertions passed.');
}

  await main();
}

async function ordersGuard08(): Promise<void> {
  const { BadRequestAppError, UnauthorizedAppError } = await import("../src/api/errors/AppError");
  const { BrokerOrdersFacadeService } = await import("../src/api/services/BrokerOrdersFacadeService");
  const { InternalOrdersSyncService } = await import("../src/api/services/InternalOrdersSyncService");
  const { coreDataSource } = await import("../src/database/data-source");

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function createServiceHarness() {
  const submissions = new Map<string, any>();
  const snapshots = new Map<string, any>();
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const linkedSuggestedOrders: Array<Record<string, unknown>> = [];
  const freshnessChecks: string[] = [];
  const preTradeChecks: Array<Record<string, unknown>> = [];
  let adapterCalls = 0;
  let nextAdapterResult: unknown = createSuccess({
    order_id: 'live-1',
    status: 'OPEN',
    protection_status: 'attached',
    stop_loss_order_id: 'sl-1',
    take_profit_order_id: 'tp-1',
    protective_orders: [
      {
        kind: 'stop_loss',
        order_id: 'sl-1',
        status: 'open',
      },
      {
        kind: 'take_profit',
        order_id: 'tp-1',
        status: 'open',
      },
    ],
    message: 'Order submitted',
  });

  const service = new BrokerOrdersFacadeService() as any;
  service.orderSubmissionReconciliationMissingAfterMs = 1000;

  service.brokerAccountRoutingService = {
    async resolve(userId: string, brokerKey?: string, accountId?: string) {
      return {
        userId,
        brokerKey: String(brokerKey || 'mudrex').trim() || 'mudrex',
        accountId: String(accountId || 'acct-1').trim() || 'acct-1',
      };
    },
  };

  service.riskService = {
    async evaluatePreTradeOrder() {
      return {
        blocked: false,
        reason: '',
        policyId: null,
        breaches: [],
      };
    },
  };

  service.riskPreTradeService = {
    async createPreTradeCheck(userId: string, body: Record<string, unknown>) {
      preTradeChecks.push({ userId, body });
      return {
        success: true,
        data: {
          checkId: `pretrade-${preTradeChecks.length}`,
          status: 'passed',
          decision: {
            allowed: true,
            blocked: false,
            approvalRequired: false,
            blockingRuleCount: 0,
            warningRuleCount: 0,
            summary: 'Pre-trade check passed.',
          },
        },
      };
    },
  };

  service.orderSubmissionRequestRepository = {
    async findByUserAndKey(userId: string, idempotencyKey: string) {
      return submissions.get(`${userId}:${idempotencyKey}`) || null;
    },
    async findByUserAndId(userId: string, submissionId: string) {
      return (
        Array.from(submissions.values()).find(
          (record) => record.userId === userId && record.id === submissionId
        ) || null
      );
    },
    async listSubmissionAttempts(query: Record<string, unknown>) {
      let items = Array.from(submissions.values()).filter(
        (record) => record.userId === query.userId
      );
      if (query.suggestedTradeId) {
        items = items.filter((record) => record.suggestedTradeId === query.suggestedTradeId);
      }
      if (query.status) {
        items = items.filter((record) => record.status === query.status);
      }
      if (query.placementState) {
        items = items.filter((record) => record.placementState === query.placementState);
      }
      if (query.reconciliationState) {
        items = items.filter(
          (record) => record.reconciliationState === query.reconciliationState
        );
      }
      if (query.brokerKey) {
        items = items.filter(
          (record) => String(record.brokerKey || '').toLowerCase() === query.brokerKey
        );
      }
      if (query.accountId) {
        items = items.filter((record) => record.accountId === query.accountId);
      }
      return {
        items: items.slice(
          Number(query.offset || 0),
          Number(query.offset || 0) + Number(query.limit || 50)
        ),
        total: items.length,
      };
    },
    async listReconciliationCandidates(query: Record<string, unknown>) {
      let items = Array.from(submissions.values()).filter(
        (record) =>
          record.userId === query.userId &&
          record.status === 'completed' &&
          record.placementState === 'placed' &&
          ['pending', 'missing'].includes(record.reconciliationState)
      );
      if (query.brokerKey) {
        items = items.filter(
          (record) => String(record.brokerKey || '').toLowerCase() === query.brokerKey
        );
      }
      if (query.accountId) {
        items = items.filter((record) => record.accountId === query.accountId);
      }
      return items.slice(0, Number(query.limit || 50));
    },
    async createInProgress(payload: Record<string, unknown>) {
      const key = `${payload.userId}:${payload.idempotencyKey}`;
      if (submissions.has(key)) {
        const duplicate: NodeJS.ErrnoException = new Error('duplicate');
        duplicate.code = 'ER_DUP_ENTRY';
        throw duplicate;
      }

      const record = {
        id: `${payload.idempotencyKey}-record`,
        ...payload,
        status: 'in_progress',
        placementState: 'registered',
        brokerOrderId: null,
        brokerOrderStatus: null,
        reconciliationState: 'not_required',
        responsePayload: null,
        errorPayload: null,
        lifecyclePayload: [
          {
            type: 'submission_registered',
          },
        ],
        completedAt: null,
        failedAt: null,
        createdAt: new Date('2026-04-09T11:55:00.000Z'),
        updatedAt: new Date('2026-04-09T11:55:00.000Z'),
      };
      submissions.set(key, record);
      return record;
    },
    async markInProgress(record: Record<string, unknown>, requestHash: string) {
      const updated = {
        ...record,
        requestHash,
        status: 'in_progress',
        placementState: 'registered',
        brokerOrderId: null,
        brokerOrderStatus: null,
        reconciliationState: 'not_required',
        responsePayload: null,
        errorPayload: null,
        lifecyclePayload: [
          ...((record.lifecyclePayload as Array<Record<string, unknown>> | undefined) ?? []),
          { type: 'submission_restarted' },
        ],
        completedAt: null,
        failedAt: null,
        updatedAt: new Date('2026-04-09T12:00:00.000Z'),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    async markBrokerSubmitting(record: Record<string, unknown>, event: Record<string, unknown>) {
      const updated = {
        ...record,
        status: 'in_progress',
        placementState: 'submitting',
        lifecyclePayload: [
          ...((record.lifecyclePayload as Array<Record<string, unknown>> | undefined) ?? []),
          event,
        ],
        updatedAt: new Date('2026-04-09T12:00:00.000Z'),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    async markCompleted(
      record: Record<string, unknown>,
      responsePayload: Record<string, unknown>,
      options: Record<string, unknown> = {}
    ) {
      const updated = {
        ...record,
        status: 'completed',
        placementState: options.placementState ?? 'placed',
        brokerOrderId: options.brokerOrderId ?? null,
        brokerOrderStatus: options.brokerOrderStatus ?? null,
        reconciliationState: options.reconciliationState ?? 'not_required',
        responsePayload,
        errorPayload: null,
        lifecyclePayload: [
          ...((record.lifecyclePayload as Array<Record<string, unknown>> | undefined) ?? []),
          (options.lifecycleEvent as Record<string, unknown> | undefined) ?? {
            type: 'submission_completed',
          },
        ],
        completedAt: new Date('2026-04-09T12:00:00.000Z'),
        failedAt: null,
        updatedAt: new Date('2026-04-09T12:00:00.000Z'),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    async markFailed(
      record: Record<string, unknown>,
      errorPayload: Record<string, unknown>,
      options: Record<string, unknown> = {}
    ) {
      const updated = {
        ...record,
        status: 'failed',
        placementState: options.placementState ?? 'rejected',
        reconciliationState: options.reconciliationState ?? 'not_required',
        responsePayload: null,
        errorPayload,
        lifecyclePayload: [
          ...((record.lifecyclePayload as Array<Record<string, unknown>> | undefined) ?? []),
          (options.lifecycleEvent as Record<string, unknown> | undefined) ?? {
            type: 'submission_failed',
          },
        ],
        completedAt: null,
        failedAt: new Date('2026-04-09T12:00:00.000Z'),
        updatedAt: new Date('2026-04-09T12:00:00.000Z'),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    async markReconciliationMatched(
      record: Record<string, unknown>,
      options: Record<string, unknown> = {}
    ) {
      const updated = {
        ...record,
        reconciliationState: 'matched',
        brokerOrderStatus: options.brokerOrderStatus ?? record.brokerOrderStatus,
        lifecyclePayload: [
          ...((record.lifecyclePayload as Array<Record<string, unknown>> | undefined) ?? []),
          (options.lifecycleEvent as Record<string, unknown> | undefined) ?? {
            type: 'broker_order_snapshot_matched',
          },
        ],
        updatedAt: new Date(),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    async markReconciliationMissing(
      record: Record<string, unknown>,
      options: Record<string, unknown> = {}
    ) {
      const updated = {
        ...record,
        reconciliationState: 'missing',
        lifecyclePayload: [
          ...((record.lifecyclePayload as Array<Record<string, unknown>> | undefined) ?? []),
          (options.lifecycleEvent as Record<string, unknown> | undefined) ?? {
            type: 'broker_order_snapshot_missing',
          },
        ],
        updatedAt: new Date(),
      };
      submissions.set(`${record.userId}:${record.idempotencyKey}`, updated);
      return updated;
    },
    isDuplicateIdempotencyKeyError(error: unknown) {
      return (error as { code?: string })?.code === 'ER_DUP_ENTRY';
    },
  };

  service.ordersSnapshotSourceRepository = {
    async findOrderByExternalId(
      userId: string,
      brokerKey: string,
      accountId: string,
      externalId: string
    ) {
      return (
        snapshots.get(
          `${userId}:${String(brokerKey || '').toLowerCase()}:${accountId}:${externalId}`
        ) || null
      );
    },
  };

  service.brokerRuntimeRegistry = {
    getOrdersAdapter() {
      return {
        async createOrder() {
          adapterCalls += 1;
          if (nextAdapterResult instanceof Error) {
            throw nextAdapterResult;
          }
          return nextAdapterResult;
        },
      };
    },
  };

  service.paperOrderRepository = {
    async createPaperOrder() {
      throw new Error('paper path not used in phase 8 service test');
    },
  };

  service.paperOrderExecutionService = {
    async simulateUserPaperOrders() {
      return {
        updatedOrderIds: [],
      };
    },
  };

  service.suggestedTradesService = {
    async assertLiveOrderFreshnessForSuggestedTrade(userId: string, suggestedTradeId: string) {
      freshnessChecks.push(`${userId}:${suggestedTradeId}`);
      return null;
    },
    async linkSuggestedTradeOrder(_userId: string, _suggestedTradeId: string, payload: Record<string, unknown>) {
      linkedSuggestedOrders.push(payload);
      return null;
    },
    async syncExecutionForPaperOrderUpdates() {
      return null;
    },
  };

  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activities.push(payload);
    },
    async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
      alerts.push(payload);
    },
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'UTC';
    },
  };

  return {
    service,
    submissions,
    snapshots,
    activities,
    alerts,
    linkedSuggestedOrders,
    freshnessChecks,
    preTradeChecks,
    getAdapterCalls: () => adapterCalls,
    setAdapterResult: (value: unknown) => {
      nextAdapterResult = value;
    },
  };
}

async function runReplayAssertion(): Promise<void> {
  const harness = createServiceHarness();

  const body = {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    idempotency_key: 'order-submit-8-replay',
    symbol: 'BTCUSDT',
    side: 'long',
    execution_mode: 'live',
    leverage: 5,
    quantity: 1,
    order_price: 64000,
    order_type: 'market',
    trigger_type: 'immediate',
    is_takeprofit: false,
    is_stoploss: false,
    stoploss_price: 62000,
    takeprofit_price: 66000,
    reduce_only: false,
  };

  const first = await harness.service.createFuturesOrder('user-1', 'asset-1', body, {
    suggestedTradeId: 'st-auto-1',
  });
  const second = await harness.service.createFuturesOrder('user-1', 'asset-1', body, {
    suggestedTradeId: 'st-auto-1',
  });

  assert.deepEqual(second, first);
  assert.equal(harness.getAdapterCalls(), 1);
  assert.equal(harness.preTradeChecks.length, 1);
  assert.deepEqual(harness.preTradeChecks[0]?.body, {
    snapshotId: undefined,
    suggestedTradeId: 'st-auto-1',
    automationId: undefined,
    automationRunId: undefined,
    sourceType: 'suggested_trade_order',
    executionMode: 'live',
    approvalMode: 'auto_if_safe',
    routing: {
      routeMode: 'fixed',
      brokerKey: 'mudrex',
      accountId: 'acct-1',
    },
    order: {
      symbol: 'BTCUSDT',
      timeframe: null,
      side: 'BUY',
      orderType: 'market',
      timeInForce: null,
      quantityMode: 'quantity',
      quantity: 1,
      notional: null,
      riskPercent: null,
      entryPrice: 64000,
      stopLossPrice: 62000,
      takeProfitTargets: [66000],
      leverage: 5,
      reduceOnly: false,
    },
  });
  assert.deepEqual(harness.freshnessChecks, ['user-1:st-auto-1', 'user-1:st-auto-1']);
  const stored = harness.submissions.get('user-1:order-submit-8-replay');
  assert.equal(stored?.status, 'completed');
  assert.equal(stored?.suggestedTradeId, 'st-auto-1');
  assert.equal(stored?.placementState, 'placed');
  assert.equal(stored?.brokerOrderId, 'live-1');
  assert.equal(stored?.brokerOrderStatus, 'OPEN');
  assert.equal(stored?.reconciliationState, 'pending');
  assert.equal(stored?.requestPayload?.order?.suggestedTradeId, 'st-auto-1');
  assert.equal(stored?.responsePayload?.data?.protection_status, 'attached');
  assert.equal(stored?.responsePayload?.data?.stop_loss_order_id, 'sl-1');
  assert.equal(stored?.responsePayload?.data?.take_profit_order_id, 'tp-1');
  assert.equal(
    stored?.lifecyclePayload?.find(
      (event: Record<string, unknown>) => event.type === 'broker_order_accepted'
    )?.details?.protectionStatus,
    'attached'
  );
  assert.equal(
    stored?.lifecyclePayload?.find(
      (event: Record<string, unknown>) => event.type === 'broker_call_started'
    )?.details?.preTradeCheckId,
    'pretrade-1'
  );
  assert.equal(
    stored?.lifecyclePayload?.find(
      (event: Record<string, unknown>) => event.type === 'broker_order_accepted'
    )?.details?.preTradeCheckId,
    'pretrade-1'
  );
  assert.equal(harness.linkedSuggestedOrders.length, 1);
  assert.equal(
    String(harness.linkedSuggestedOrders[0]?.note || '').includes('native SL/TP protection'),
    true,
    'live suggested-trade link should mention native protection when the broker attached it'
  );
  assert.deepEqual(
    (stored?.lifecyclePayload ?? []).map((event: Record<string, unknown>) => event.type),
    ['submission_registered', 'broker_call_started', 'broker_order_accepted']
  );

  const listResponse = await harness.service.getOrderSubmissionAttempts('user-1', {
    suggestedTradeId: 'st-auto-1',
    placementState: 'placed',
    reconciliationState: 'pending',
  });
  assert.equal(listResponse.total, 1);
  assert.equal(listResponse.items[0]?.id, stored?.id);
  assert.deepEqual(listResponse.items[0]?.protectionState, {
    expected: true,
    status: 'attached',
    attached: true,
    summary: 'Native SL/TP protection was reported by the broker response.',
    brokerStatus: 'attached',
    stopLossOrderId: 'sl-1',
    takeProfitOrderId: 'tp-1',
    protectiveOrderCount: 2,
  });
  assert.equal(listResponse.items[0]?.operatorState.label, 'Pending reconciliation');
  assert.equal(
    listResponse.items[0]?.operatorState.recommendedAction,
    'reconcile_execution'
  );

  const detailResponse = await harness.service.getOrderSubmissionAttempt('user-1', stored.id);
  assert.equal(detailResponse.id, stored.id);
  assert.equal(detailResponse.protectionState.status, 'attached');
  assert.equal(detailResponse.requestPayload?.order?.suggestedTradeId, 'st-auto-1');
  assert.equal(
    ((detailResponse.responsePayload?.data as Record<string, unknown> | undefined)
      ?.order_id as string | undefined) ?? null,
    'live-1'
  );
  assert.equal(detailResponse.lifecycle.length, 3);

  stored.completedAt = new Date();
  stored.updatedAt = new Date();
  const pendingReconcile = await harness.service.reconcileOrderSubmissionAttempt(
    'user-1',
    stored.id
  );
  assert.equal(pendingReconcile.decision, 'pending');
  assert.equal(
    harness.submissions.get('user-1:order-submit-8-replay')?.reconciliationState,
    'pending'
  );

  harness.snapshots.set('user-1:mudrex:acct-1:live-1', {
    accountId: 'acct-1',
    brokerKey: 'mudrex',
    externalId: 'live-1',
    orderStatus: 'OPEN',
    statusRank: 1,
    payloadJson: { order_id: 'live-1', status: 'OPEN' },
    firstSeenAt: new Date('2026-04-09T12:00:20.000Z'),
    lastSeenAt: new Date('2026-04-09T12:00:30.000Z'),
  });
  const matchedReconcile = await harness.service.reconcileOrderSubmissionAttempt(
    'user-1',
    stored.id
  );
  assert.equal(matchedReconcile.decision, 'matched');
  assert.equal(matchedReconcile.matchedSnapshot?.externalId, 'live-1');
  assert.equal(
    harness.submissions.get('user-1:order-submit-8-replay')?.reconciliationState,
    'matched'
  );
  assert.equal(
    harness
      .submissions
      .get('user-1:order-submit-8-replay')
      ?.lifecyclePayload.some(
        (event: Record<string, unknown>) => event.type === 'broker_order_snapshot_matched'
      ),
    true
  );

  const staleRecord = {
    ...stored,
    id: 'order-submit-8-missing-record',
    idempotencyKey: 'order-submit-8-missing',
    brokerOrderId: 'live-missing',
    brokerOrderStatus: 'OPEN',
    reconciliationState: 'pending',
    lifecyclePayload: [],
    completedAt: new Date(Date.now() - 2000),
    updatedAt: new Date(Date.now() - 2000),
  };
  harness.submissions.set('user-1:order-submit-8-missing', staleRecord);
  const missingReconcile = await harness.service.reconcileOrderSubmissionAttempt(
    'user-1',
    staleRecord.id
  );
  assert.equal(missingReconcile.decision, 'missing');
  assert.equal(
    harness.submissions.get('user-1:order-submit-8-missing')?.reconciliationState,
    'missing'
  );
  assert.equal(missingReconcile.submission.operatorState.label, 'Missing snapshot');

  const sweep = await harness.service.reconcileOrderSubmissionAttempts('user-1', {
    limit: '10',
    brokerKey: 'mudrex',
    accountId: 'acct-1',
  });
  assert.equal(sweep.total, 1);
  assert.equal(sweep.missing, 1);
}

async function runProtectionGapAssertion(): Promise<void> {
  const harness = createServiceHarness();
  harness.setAdapterResult(
    createSuccess({
      order_id: 'live-unprotected-1',
      status: 'OPEN',
      protection_status: 'not_requested',
      message: 'Order submitted without native protection',
    })
  );

  await harness.service.createFuturesOrder('user-1', 'asset-1', {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    idempotency_key: 'order-submit-8-protection-gap',
    symbol: 'BTCUSDT',
    side: 'long',
    execution_mode: 'live',
    leverage: 5,
    quantity: 1,
    order_price: 64000,
    order_type: 'market',
    trigger_type: 'immediate',
    is_takeprofit: false,
    is_stoploss: false,
    stoploss_price: 62000,
    takeprofit_price: 66000,
    reduce_only: false,
  });

  const stored = harness.submissions.get('user-1:order-submit-8-protection-gap');
  assert.equal(stored?.status, 'completed');
  assert.equal(stored?.brokerOrderId, 'live-unprotected-1');
  assert.equal(
    stored?.lifecyclePayload?.find(
      (event: Record<string, unknown>) => event.type === 'broker_order_accepted'
    )?.details?.protectionStatus,
    'missing'
  );

  const detail = await harness.service.getOrderSubmissionAttempt('user-1', stored.id);
  assert.deepEqual(detail.protectionState, {
    expected: true,
    status: 'missing',
    attached: false,
    summary:
      'Native SL/TP protection was expected but the broker response did not report both protective legs.',
    brokerStatus: 'not_requested',
    stopLossOrderId: null,
    takeProfitOrderId: null,
    protectiveOrderCount: 0,
  });
  assert.equal(detail.operatorState.label, 'Protection missing');
  assert.equal(detail.operatorState.recommendedAction, 'verify_protection');

  assert.equal(
    harness.activities.some((item) => item.title === 'Live order missing native protection'),
    true
  );
  assert.equal(
    harness.alerts.some((item) =>
      String(item.message || '').includes('Live order missing native protection')
    ),
    true
  );
}

async function runConflictAssertion(): Promise<void> {
  const harness = createServiceHarness();

  await harness.service.createFuturesOrder('user-1', 'asset-1', {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    idempotency_key: 'order-submit-8-conflict',
    symbol: 'BTCUSDT',
    side: 'long',
    execution_mode: 'live',
    leverage: 5,
    quantity: 1,
    order_price: 64000,
    order_type: 'market',
    trigger_type: 'immediate',
    is_takeprofit: false,
    is_stoploss: false,
    stoploss_price: 62000,
    takeprofit_price: 66000,
    reduce_only: false,
  });

  await assert.rejects(
    () =>
      harness.service.createFuturesOrder('user-1', 'asset-1', {
        brokerKey: 'mudrex',
        accountId: 'acct-1',
        idempotency_key: 'order-submit-8-conflict',
        symbol: 'BTCUSDT',
        side: 'long',
        execution_mode: 'live',
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
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 409 &&
      (error as { code?: string }).code === 'ORDER_IDEMPOTENCY_KEY_REUSED'
  );

  assert.equal(harness.getAdapterCalls(), 1);
}

async function runNormalizationAssertion(): Promise<void> {
  const harness = createServiceHarness();
  harness.setAdapterResult(
    new BadRequestAppError('insufficient margin on selected account')
  );

  await assert.rejects(
    () =>
      harness.service.createFuturesOrder('user-1', 'asset-1', {
        brokerKey: 'mudrex',
        accountId: 'acct-1',
        idempotency_key: 'order-submit-8-error',
        symbol: 'BTCUSDT',
        side: 'long',
        execution_mode: 'live',
        leverage: 5,
        quantity: 1,
        order_price: 64000,
        order_type: 'market',
        trigger_type: 'immediate',
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: 62000,
        takeprofit_price: 66000,
        reduce_only: false,
      }),
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 400 &&
      error.message === 'Order rejected: insufficient margin for this route.' &&
      (error as { code?: string }).code === 'ORDER_REJECTED_INSUFFICIENT_MARGIN'
  );

  const stored = harness.submissions.get('user-1:order-submit-8-error');
  assert.equal(stored?.status, 'failed');
  assert.equal(stored?.placementState, 'rejected');
  assert.equal(stored?.reconciliationState, 'not_required');
  assert.equal(stored?.errorPayload?.code, 'ORDER_REJECTED_INSUFFICIENT_MARGIN');
  assert.deepEqual(
    (stored?.lifecyclePayload ?? []).map((event: Record<string, unknown>) => event.type),
    ['submission_registered', 'broker_call_started', 'broker_order_rejected']
  );
  assert.equal(harness.alerts.length, 1);
  assert.equal(
    harness.alerts[0]?.message,
    'Order create failed: Order rejected: insufficient margin for this route.'
  );

  harness.setAdapterResult(
    new BadRequestAppError(
      'Delta Exchange product mapping is stale for BTCUSDT; requested product 139 was not found in the live product catalog'
    )
  );

  await assert.rejects(
    () =>
      harness.service.createFuturesOrder('user-1', 'asset-1', {
        brokerKey: 'delta_exchange',
        accountId: 'acct-delta-1',
        idempotency_key: 'order-submit-8-mapping-error',
        symbol: 'BTCUSDT',
        side: 'long',
        execution_mode: 'live',
        leverage: 15,
        quantity: 1,
        order_price: 74000,
        order_type: 'market',
        trigger_type: 'immediate',
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: 73000,
        takeprofit_price: 76000,
        reduce_only: false,
      }),
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 400 &&
      error.message ===
        'Order rejected: broker product mapping is stale or unavailable for this route.' &&
      (error as { code?: string }).code === 'ORDER_REJECTED_BROKER_MAPPING'
  );

  const mappingStored = harness.submissions.get('user-1:order-submit-8-mapping-error');
  assert.equal(mappingStored?.status, 'failed');
  assert.equal(mappingStored?.placementState, 'rejected');
  assert.equal(mappingStored?.reconciliationState, 'not_required');
  assert.equal(mappingStored?.errorPayload?.code, 'ORDER_REJECTED_BROKER_MAPPING');

  const deltaAuthError = new UnauthorizedAppError(
    'UnauthorizedApiAccess: Api Key not authorised to access this endpoint (route /v2/orders)'
  );
  Object.assign(deltaAuthError, {
    broker: 'delta_exchange',
    brokerStatusCode: 403,
    brokerRoutePath: '/v2/orders',
    brokerErrorCode: 'UnauthorizedApiAccess',
    brokerErrorMessage: 'Api Key not authorised to access this endpoint',
    brokerErrorPayload: {
      success: false,
      error: 'UnauthorizedApiAccess',
      message: 'Api Key not authorised to access this endpoint',
    },
  });
  harness.setAdapterResult(deltaAuthError);

  await assert.rejects(
    () =>
      harness.service.createFuturesOrder('user-1', 'asset-1', {
        brokerKey: 'delta_exchange',
        accountId: 'acct-delta-1',
        idempotency_key: 'order-submit-8-delta-auth-error',
        symbol: 'BTCUSDT',
        side: 'long',
        execution_mode: 'live',
        leverage: 15,
        quantity: 1,
        order_price: 74000,
        order_type: 'market',
        trigger_type: 'immediate',
        is_takeprofit: false,
        is_stoploss: false,
        stoploss_price: 73000,
        takeprofit_price: 76000,
        reduce_only: false,
      }),
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 400 &&
      error.message ===
        'Order rejected: broker authorization failed. Check Delta API key Trading permission and IP whitelist.' &&
      (error as { code?: string }).code === 'ORDER_BROKER_AUTHORIZATION_FAILED'
  );

  const authStored = harness.submissions.get('user-1:order-submit-8-delta-auth-error');
  assert.equal(authStored?.status, 'failed');
  assert.equal(authStored?.placementState, 'rejected');
  assert.equal(authStored?.reconciliationState, 'not_required');
  assert.equal(authStored?.errorPayload?.code, 'ORDER_BROKER_AUTHORIZATION_FAILED');
  assert.equal(authStored?.errorPayload?.brokerError?.broker, 'delta_exchange');
  assert.equal(authStored?.errorPayload?.brokerError?.statusCode, 403);
  assert.equal(authStored?.errorPayload?.brokerError?.routePath, '/v2/orders');
  assert.equal(authStored?.errorPayload?.brokerError?.code, 'UnauthorizedApiAccess');
  assert.equal(
    authStored?.errorPayload?.brokerError?.message,
    'Api Key not authorised to access this endpoint'
  );
  assert.deepEqual(authStored?.errorPayload?.brokerError?.payload, {
    success: false,
    error: 'UnauthorizedApiAccess',
    message: 'Api Key not authorised to access this endpoint',
  });
}

async function runAutomaticSyncReconciliationAssertion(): Promise<void> {
  const syncService = new InternalOrdersSyncService() as any;
  const marked: Array<Record<string, unknown>> = [];
  const candidate = {
    id: 'submission-sync-1',
    userId: 'user-1',
    idempotencyKey: 'order-submit-sync-1',
    requestHash: 'hash',
    executionMode: 'live',
    assetId: 'asset-1',
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    suggestedTradeId: null,
    status: 'completed',
    placementState: 'placed',
    brokerOrderId: 'live-sync-1',
    brokerOrderStatus: 'OPEN',
    reconciliationState: 'pending',
    requestPayload: null,
    responsePayload: null,
    errorPayload: null,
    lifecyclePayload: [],
    completedAt: new Date(),
    failedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  syncService.orderSubmissionRequestRepository = {
    async listReconciliationCandidatesByBrokerOrderIds(query: Record<string, unknown>) {
      assert.deepEqual(query, {
        userId: 'user-1',
        brokerKey: 'mudrex',
        accountId: 'acct-1',
        brokerOrderIds: ['live-sync-1'],
      });
      return [candidate];
    },
    async markReconciliationMatched(record: Record<string, unknown>, options: Record<string, unknown>) {
      marked.push({ record, options });
      return {
        ...record,
        reconciliationState: 'matched',
      };
    },
  };

  const originalQuery = coreDataSource.query;
  try {
    coreDataSource.query = (async (_sql: string, params: unknown[]) => {
      assert.deepEqual(params, ['user-1', 'acct-1', 'mudrex', 'live-sync-1']);
      return [
        {
          externalId: 'live-sync-1',
          orderStatus: 'OPEN',
          statusRank: 1,
          firstSeenAt: new Date('2026-04-09T12:00:20.000Z'),
          lastSeenAt: new Date('2026-04-09T12:00:30.000Z'),
        },
      ];
    }) as typeof coreDataSource.query;

    const matched = await syncService.reconcileOrderSubmissionMatchesForOrderUpdates(
      'user-1',
      'mudrex',
      'acct-1',
      ['live-sync-1']
    );

    assert.equal(matched, 1);
    assert.equal(marked.length, 1);
    assert.equal(
      (marked[0]?.options as { brokerOrderStatus?: string } | undefined)?.brokerOrderStatus,
      'OPEN'
    );
  } finally {
    coreDataSource.query = originalQuery;
  }
}

async function main(): Promise<void> {
  await runReplayAssertion();
  await runProtectionGapAssertion();
  await runConflictAssertion();
  await runNormalizationAssertion();
  await runAutomaticSyncReconciliationAssertion();
  console.log('Orders phase 8 checks passed');
}

  await main();
}

async function ordersGuard09(): Promise<void> {
  const { BadRequestAppError } = await import("../src/api/errors/AppError");
  const { PaperOrderExecutionService } = await import("../src/api/services/PaperOrderExecutionService");

  const savedOrders: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const observedAt = new Date('2026-04-23T13:12:00.000Z');

  const filledOrder = {
    id: 'paper-order-1',
    userId: 'user-1',
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    assetId: 'asset-1',
    symbol: 'SOLUSDT',
    side: 'long',
    status: 'FILLED',
    quantity: 1.2,
    orderPrice: 87.5,
    orderType: 'market',
    triggerType: 'immediate',
    stoplossPrice: 84,
    takeprofitPrice: 91,
    payload: {
      simulation: {
        executionState: 'filled',
        positionStatus: 'OPEN',
        filledAt: '2026-04-23T12:45:00.000Z',
        filledPrice: '87.5',
        filledQuantity: 1.2,
        positionOpenedAt: '2026-04-23T12:45:00.000Z',
      },
    },
  };

  const service = new PaperOrderExecutionService() as any;
  service.paperOrderRepository = {
    async getPaperOrderById(userId: string, paperOrderId: string) {
      assert.equal(userId, 'user-1');
      if (paperOrderId === 'paper-order-1') {
        return { ...filledOrder };
      }
      if (paperOrderId === 'paper-order-closed') {
        return {
          ...filledOrder,
          id: 'paper-order-closed',
          status: 'CLOSED',
        };
      }
      return null;
    },
    async savePaperOrder(order: Record<string, unknown>) {
      savedOrders.push(JSON.parse(JSON.stringify(order)));
      return order;
    },
  };
  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      activities.push({ userId, ...payload });
    },
  };
  service.loadFallbackMarketPrices = async () => new Map();
  service.loadScopedMarketPrices = async () => new Map();
  service.loadLatestCandleObservations = async () =>
    new Map([
      [
        'SOLUSDT',
        {
          symbol: 'SOLUSDT',
          observedAt,
          referencePrice: 89,
          source: 'candle',
          candleOpenTime: new Date('2026-04-23T13:11:00.000Z'),
          candleCloseTime: observedAt,
          candleOpen: 88.2,
          candleHigh: 89.4,
          candleLow: 88.1,
          candleClose: 89,
        },
      ],
    ]);

  const closedOrder = await service.closePaperOrderAtMarket('user-1', 'paper-order-1');
  assert.equal(closedOrder.status, 'CLOSED');
  assert.equal(savedOrders.length, 1);
  const savedSimulation =
    ((savedOrders[0]?.payload as { simulation?: Record<string, unknown> } | undefined)
      ?.simulation as Record<string, unknown> | undefined) ?? {};
  assert.equal(savedSimulation.executionState, 'closed');
  assert.equal(savedSimulation.positionStatus, 'CLOSED');
  assert.equal(savedSimulation.closeReason, 'manual-close');
  assert.equal(savedSimulation.exitPrice, '89');
  assert.equal(savedSimulation.realizedPnl, '1.8');
  assert.equal(savedSimulation.outcome, 'profit');
  assert.equal(savedSimulation.lastObservationSource, 'candle');
  assert.equal(savedSimulation.positionClosedAt, observedAt.toISOString());
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.userId, 'user-1');
  assert.equal(activities[0]?.route, 'Positions');
  assert.equal(activities[0]?.stream, 'Paper execution');

  await assert.rejects(
    () => service.closePaperOrderAtMarket('user-1', 'paper-order-closed'),
    (error: unknown) =>
      error instanceof BadRequestAppError &&
      error.message === 'Only open paper positions can be closed'
  );

  console.log('Orders phase 9 checks passed');
}

const suiteSteps = {
  "07": ordersGuard07,
  "08": ordersGuard08,
  "09": ordersGuard09,
} as const;

export async function runOrdersSuite(): Promise<void> {
  await runSuiteSteps("Orders module", "scripts/test-orders.ts", ["07", "08", "09"]);
  await runScriptSuite("Orders module", ["scripts/test-orders-contract.ts"]);
  console.log("Orders module assertions passed.");
}

async function runRequestedStep(): Promise<void> {
  const requestedStep = process.argv[3];
  if (!requestedStep) {
    return;
  }
  const step = suiteSteps[requestedStep as keyof typeof suiteSteps];
  if (!step) {
    throw new Error(`Unknown suite step: ${requestedStep}`);
  }
  await step();
}

if (process.argv[3]) {
  runRequestedStep().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
