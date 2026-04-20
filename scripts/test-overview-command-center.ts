import assert from 'node:assert/strict';

process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED = 'true';
process.env.SUGGESTED_TRADES_LIVE_AUTO_ENABLED = 'true';
process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED = 'true';
process.env.SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST = 'user-1';
process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = 'mudrex';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function createOverviewData() {
  const observedAt = '2026-04-20T08:45:00.000Z';

  return {
    meta: {
      contractVersion: 'overview-phase4-2026-04-09',
      routing: {
        brokerKey: 'mudrex',
        accountId: 'acct-1',
        resolution: 'resolved',
      },
      sections: {
        activeFunds: {
          observedAt,
          freshness: { state: 'fresh' },
        },
        walletFunds: {
          observedAt,
          freshness: { state: 'fresh' },
        },
        futuresFunds: {
          observedAt,
          freshness: { state: 'fresh' },
        },
        portfolioSummary: {
          observedAt,
          freshness: { state: 'fresh' },
        },
        portfolioHoldings: {
          observedAt,
          freshness: { state: 'fresh' },
        },
      },
    },
    activeFunds: {
      latestObservedAt: observedAt,
      latestObservedAtIso: observedAt,
      oldestObservedAt: observedAt,
      oldestObservedAtIso: observedAt,
      walletItems: [
        {
          accountId: 'acct-1',
          accountName: 'Mudrex primary',
          accountKey: 'primary',
          brokerKey: 'mudrex',
          status: 'Connected',
          observedAt,
          observedAtIso: observedAt,
          funds: {
            balance: 1500,
            available: 1200,
            invested: 300,
          },
        },
      ],
      futuresItems: [
        {
          accountId: 'acct-1',
          accountName: 'Mudrex primary',
          accountKey: 'primary',
          brokerKey: 'mudrex',
          status: 'Connected',
          observedAt,
          observedAtIso: observedAt,
          funds: {
            balance: 8500,
            available: 8000,
            invested: 500,
          },
        },
      ],
    },
    automations: {
      items: [
        {
          id: 'automation-1',
          name: 'BTC breakout',
          strategy: 'Breakout',
          automationType: 'trade-suggestion',
          status: 'Running',
          lastRun: observedAt,
          updatedAt: observedAt,
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
    },
    automationsSummary: {
      running: 1,
      paused: 0,
      connectedAccounts: 1,
      health: 'Healthy',
      healthStatus: 'ok',
      diagnostics: {
        workerStatus: 'ok',
        workerHttpStatus: 'ok',
        heartbeatStatus: 'ok',
        workerDetail: 'Worker heartbeat is healthy.',
        workerHeartbeatAgeMs: 9000,
        commandPollLagMs: 3000,
        queueStatus: 'ok',
        queueLatencyMs: 5,
        activeRuns: 0,
        failedRuns24h: 0,
        overlapSkips24h: 0,
        staleCursorCount: 0,
        totalCursorCount: 1,
        staleCursorThresholdMinutes: 120,
        lastCursorAt: observedAt,
        lastTriggeredSignalAt: observedAt,
      },
    },
    alerts: {
      items: [
        {
          id: 'alert-1',
          severity: 'High',
          channel: 'Risk',
          symbol: 'BTCUSDT',
          message: 'Margin usage needs review',
          route: '/risk',
          time: observedAt,
          status: 'Open',
          source: 'risk',
          urgency: 'soon',
          updatedAt: observedAt,
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
    },
    alertsSummary: {
      openAlerts: 1,
      acknowledged: 0,
      highSeverityAlerts: 1,
      criticalSeverity: 0,
      watchlistCapable: 'No',
    },
    signals: {
      items: [
        {
          id: 'signal-1',
          symbol: 'BTCUSDT',
          direction: 'Long',
          timeframe: '1h',
          status: 'Triggered',
          source: 'Strategy Lab',
          confidence: 0.88,
          regime: 'Trend',
          aiScore: 82,
          thesis: 'Momentum continuation.',
          route: '/signals',
          createdAt: observedAt,
          updatedAt: observedAt,
        },
      ],
      total: 1,
      limit: 3,
      offset: 0,
    },
    signalsSummary: {
      liveSignals: 4,
      triggered: 1,
      watching: 2,
      queued: 1,
      muted: 0,
      highConfidence: 2,
      mutedOrQueued: 1,
    },
    portfolioSummary: {
      equity: 10000,
      dayPnL: 120,
      netExposure: '42%',
      diversification: 'Balanced',
      observedAt,
      observedAtIso: observedAt,
    },
    portfolioHoldings: {
      items: [
        {
          id: 'holding-1',
          symbol: 'BTCUSDT',
          quantity: 0.1,
          marketValue: 6000,
          allocationPct: 60,
          dayPnL: 110,
          unrealizedPnL: 500,
          side: 'Long',
          strategy: 'Breakout',
          riskState: 'Healthy',
          sleeve: 'Futures',
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
      observedAt,
      observedAtIso: observedAt,
    },
  };
}

function createRiskOverviewData() {
  const observedAt = '2026-04-20T08:46:00.000Z';

  return {
    meta: {
      generatedAtIso: observedAt,
      freshness: {
        state: 'fresh',
        latestRiskSnapshotAtIso: observedAt,
        latestAlertAtIso: observedAt,
      },
    },
    summary: {
      portfolioRisk: 'Healthy',
      breachedRules: 0,
      liquidationWatch: 0,
      capitalAtRisk: 250,
      fundsObservedAtIso: observedAt,
      positionsObservedAtIso: observedAt,
    },
    alerts: {
      items: [],
      total: 0,
      limit: 5,
      offset: 0,
    },
  };
}

function createSuggestedTradesData() {
  const observedAt = '2026-04-20T08:47:00.000Z';

  return {
    items: [
      {
        id: 'idea-1',
        automationId: 'automation-1',
        automationRunId: 'run-1',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        side: 'BUY',
        signalTime: observedAt,
        status: 'Open',
        statusDisplay: 'Needs review',
        executionStage: 'unlinked',
        dedupeKey: 'btc-1h',
        createdAt: observedAt,
        updatedAt: observedAt,
      },
    ],
    total: 1,
    limit: 5,
    offset: 0,
  };
}

function createSuggestedTradesSummary() {
  return {
    open: 1,
    reviewed: 0,
    accepted: 0,
    dismissed: 0,
    actionable: 1,
    buySide: 1,
    sellSide: 0,
    queued: 0,
    submitting: 0,
    linked: 0,
    working: 0,
    filled: 0,
    closed: 0,
  };
}

async function runServiceAssertions(): Promise<void> {
  const { OVERVIEW_COMMAND_CENTER_CONTRACT_VERSION } =
    await import('../src/api/contracts/OverviewCommandCenter');
  const { OverviewCommandCenterService } =
    await import('../src/api/services/OverviewCommandCenterService');

  const service = new OverviewCommandCenterService() as any;
  let overviewCallCount = 0;
  let riskCallCount = 0;
  let suggestedTradesCallCount = 0;
  let suggestedTradesSummaryCallCount = 0;

  service.overviewService = {
    async getOverview(userId: string, query: { selectedSymbol?: string }) {
      overviewCallCount += 1;
      assert.equal(userId, 'user-1');
      assert.equal(query.selectedSymbol, 'BTCUSDT');
      return createSuccess(createOverviewData());
    },
  };
  service.riskOverviewService = {
    async getOverview(userId: string, query: { alertsLimit?: string }) {
      riskCallCount += 1;
      assert.equal(userId, 'user-1');
      assert.equal(query.alertsLimit, '5');
      return createSuccess(createRiskOverviewData());
    },
  };
  service.suggestedTradesService = {
    async getSuggestedTrades(userId: string, query: { limit?: string }) {
      suggestedTradesCallCount += 1;
      assert.equal(userId, 'user-1');
      assert.equal(query.limit, '5');
      return createSuccess(createSuggestedTradesData());
    },
    async getSuggestedTradesSummary(userId: string) {
      suggestedTradesSummaryCallCount += 1;
      assert.equal(userId, 'user-1');
      return createSuccess(createSuggestedTradesSummary());
    },
  };

  const response = await service.getCommandCenter('user-1', {
    role: 'User',
    selectedSymbol: 'BTCUSDT',
  });
  const data = response.data;

  assert.equal(data.meta.contractVersion, OVERVIEW_COMMAND_CENTER_CONTRACT_VERSION);
  assert.equal(data.meta.purpose, 'operator_command_center');
  assert.equal(data.meta.dataPolicy.directBrokerCallsOnLoad, false);
  assert.deepEqual(data.meta.query.supported, ['selectedSymbol']);
  assert.deepEqual(data.meta.redactedSections, ['opsSnapshot']);
  assert.equal(data.tradingReadiness.state, 'ok');
  assert.equal(data.alertsSnapshot.state, 'attention');
  assert.equal(data.automationSnapshot.state, 'ok');
  assert.equal(data.bookSnapshot.state, 'ok');
  assert.equal(data.riskSnapshot.state, 'ok');
  assert.equal(data.brokerDataSnapshot.state, 'ok');
  assert.equal(data.opsSnapshot.visibility, 'admin');
  assert.equal(data.opsSnapshot.items.length, 0);

  for (const key of [
    'status',
    'actionQueue',
    'tradingReadiness',
    'alertsSnapshot',
    'automationSnapshot',
    'bookSnapshot',
    'riskSnapshot',
    'tradeIdeasSnapshot',
    'brokerDataSnapshot',
    'opsSnapshot',
  ] as const) {
    const section = data[key];
    assert.equal(section.id, key);
    assert.equal(typeof section.title, 'string');
    assert.equal(typeof section.summary, 'string');
    assert.ok(['ok', 'attention', 'blocked', 'loading', 'unknown'].includes(section.state));
    assert.ok(Array.isArray(section.cards));
    assert.ok(Array.isArray(section.items));
    assert.ok(Array.isArray(section.actions));
    assert.equal(typeof section.source.label, 'string');
  }

  assert.equal(overviewCallCount, 1);
  assert.equal(riskCallCount, 1);
  assert.equal(suggestedTradesCallCount, 1);
  assert.equal(suggestedTradesSummaryCallCount, 1);

  service.riskOverviewService = {
    async getOverview() {
      throw new Error('risk store offline');
    },
  };

  const degradedResponse = await service.getCommandCenter('user-1', {
    role: 'Admin',
    selectedSymbol: 'BTCUSDT',
  });

  assert.deepEqual(degradedResponse.data.meta.redactedSections, []);
  assert.equal(degradedResponse.data.riskSnapshot.state, 'unknown');
  assert.ok(degradedResponse.data.meta.degradedSections.includes('riskSnapshot'));
  assert.equal(degradedResponse.data.opsSnapshot.visibility, 'admin');
  assert.ok(degradedResponse.data.opsSnapshot.items.length > 0);
}

async function runControllerAssertions(): Promise<void> {
  const { OverviewController } = await import('../src/api/controllers/OverviewController');
  const controller = new OverviewController() as any;

  controller.overviewCommandCenterService = {
    async getCommandCenter(...args: unknown[]) {
      return createSuccess({ args });
    },
  };

  const response = await controller.getCommandCenter(
    { authUser: { sub: 'user-1', role: 'Admin' } },
    'ETHUSDT'
  );

  assert.deepEqual(response.data.args, [
    'user-1',
    {
      role: 'Admin',
      selectedSymbol: 'ETHUSDT',
    },
  ]);
}

async function main(): Promise<void> {
  await runServiceAssertions();
  await runControllerAssertions();

  console.log('Overview command center contract assertions passed.');
}

main().catch((error) => {
  console.error('Overview command center contract assertion failure:', error);
  process.exit(1);
});
