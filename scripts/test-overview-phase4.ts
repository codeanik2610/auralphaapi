import assert from 'node:assert/strict';

import { OverviewService } from '../src/api/services/OverviewService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function main(): Promise<void> {
  const originalDateNow = Date.now;
  let nowMs = new Date('2026-04-09T10:20:00.000Z').getTime();
  Date.now = () => nowMs;

  try {
    const service = new OverviewService() as any;
    let referenceMode: 'live' | 'down' = 'live';

    service.brokerAccountRepository = {
      async getConnectedBrokerAccounts() {
        return [
          {
            id: 'acct-default',
            brokerKey: 'mudrex',
            isDefault: true,
          },
        ];
      },
    };

    service.fundsSnapshotRepository = {
      async getLatestSnapshot() {
        return {
          wallet_funds_json: JSON.stringify({
            total: 12500,
            rewards: 120,
            invested: 6400,
            withdrawable: 6100,
          }),
          futures_funds_json: JSON.stringify({
            balance: '8450.50',
            locked_amount: '250.25',
            first_time_user: false,
          }),
          computed_at: new Date('2026-04-07T08:00:00.000Z'),
        };
      },
    };

    service.brokerWalletFacadeService = {
      async getWalletFunds() {
        return createSuccess({
          total: 12500,
          rewards: 120,
          invested: 6400,
          withdrawable: 6100,
        });
      },
      async getFuturesFunds() {
        return createSuccess({
          balance: '8450.50',
          locked_amount: '250.25',
          first_time_user: false,
        });
      },
    };

    service.brokerReferenceDataService = {
      async getFuturesAssets() {
        if (referenceMode === 'down') {
          throw new Error('market feed unavailable');
        }
        return createSuccess([
          {
            id: 'asset-btc',
            name: 'Bitcoin',
            symbol: 'BTCUSDT',
            price: '64000',
            change_perc: '2.5',
            volume: '999999',
          },
        ]);
      },
      async getFuturesAssetDetailBySymbol() {
        if (referenceMode === 'down') {
          throw new Error('selected asset detail unavailable');
        }
        return createSuccess({
          id: 'asset-btc',
          name: 'Bitcoin',
          symbol: 'BTCUSDT',
          funding_interval: 8,
          price: '64000',
          change_perc: '2.5',
          volume: '999999',
          '1d_high': 65000,
          '1d_low': 62000,
        });
      },
      async getLeverageBySymbol() {
        if (referenceMode === 'down') {
          throw new Error('leverage lookup unavailable');
        }
        return createSuccess({
          Leverage: '20x',
          MarginType: 'Cross',
        });
      },
    };

    service.automationsService = {
      async getAutomations() {
        return createSuccess({
          items: [
            {
              id: 'auto-1',
              name: 'Momentum',
              status: 'Running',
              updatedAt: '2026-04-09T10:10:00.000Z',
            },
          ],
          total: 1,
          limit: 5,
          offset: 0,
        });
      },
      async getAutomationsSummary() {
        return createSuccess({
          running: 1,
          paused: 0,
          connectedAccounts: 2,
          health: 'Degraded',
          healthStatus: 'degraded',
          diagnostics: {
            workerStatus: 'degraded',
            queueStatus: 'ok',
            queueLatencyMs: 32,
            activeRuns: 1,
            failedRuns24h: 1,
            overlapSkips24h: 0,
            staleCursorCount: 1,
            totalCursorCount: 3,
            staleCursorThresholdMinutes: 120,
            workerDetail: 'Worker heartbeat is stale by 180s',
          },
        });
      },
    };

    service.alertsService = {
      async getAlerts() {
        return createSuccess({
          items: [],
          total: 0,
          limit: 5,
          offset: 0,
        });
      },
      async getAlertsSummary() {
        return createSuccess({
          openAlerts: 0,
          acknowledged: 0,
          highSeverityAlerts: 0,
          criticalSeverity: 0,
          watchlistCapable: 'Yes',
        });
      },
    };

    service.signalsService = {
      async getSignals() {
        return createSuccess({
          items: [],
          total: 0,
          limit: 3,
          offset: 0,
        });
      },
      async getSignalsSummary() {
        return createSuccess({
          liveSignals: 0,
          triggered: 0,
          watching: 0,
          queued: 0,
          muted: 0,
          highConfidence: 0,
          mutedOrQueued: 0,
        });
      },
    };

    service.portfolioService = {
      async getPortfolioSummary() {
        return createSuccess({
          equity: 18000,
          dayPnL: 420,
          netExposure: '42%',
          diversification: 'Balanced',
        });
      },
      async getPortfolioHoldings() {
        return createSuccess({
          items: [
            {
              id: 'holding-1',
              symbol: 'BTCUSDT',
              allocationPct: 35,
            },
          ],
          total: 1,
          limit: 5,
          offset: 0,
        });
      },
    };

    service.portfolioRepository = {
      async getLatestSnapshot() {
        return {
          createdAt: new Date('2026-04-09T02:00:00.000Z'),
        };
      },
    };

    const primed = await service.getOverview('user-1', {
      selectedSymbol: 'BTCUSDT',
    });
    assert.equal(primed.data.meta.sections.assets.cache?.state, 'live');

    referenceMode = 'down';
    nowMs = new Date('2026-04-09T10:23:00.000Z').getTime();

    const response = await service.getOverview('user-1', {
      selectedSymbol: 'BTCUSDT',
    });

    assert.equal(response.success, true);
    assert.equal(response.data.meta.sections.walletFunds.freshness?.state, 'critical');
    assert.equal(response.data.meta.sections.portfolioSummary.freshness?.state, 'stale');

    assert.equal(response.data.meta.sections.assets.requestStatus, 'degraded');
    assert.equal(response.data.meta.sections.assets.fetchMode, 'fallback');
    assert.equal(response.data.meta.sections.assets.cache?.state, 'stale-cache-fallback');
    assert.equal(response.data.meta.sections.assets.freshness?.state, 'stale');

    assert.equal(response.data.meta.sections.selectedAsset.fetchMode, 'fallback');
    assert.equal(
      response.data.meta.sections.selectedAsset.cache?.state,
      'stale-cache-fallback'
    );
    assert.equal(response.data.meta.sections.leverage.fetchMode, 'fallback');
    assert.equal(response.data.meta.sections.leverage.cache?.state, 'stale-cache-fallback');

    assert.equal(response.data.meta.warnings.length, 4);
    assert.deepEqual(
      response.data.meta.warnings
        .map((warning: { code: string }) => warning.code)
        .sort(),
      [
        'automation_health_attention',
        'capital_snapshot_attention',
        'live_reference_feed_attention',
        'portfolio_snapshot_attention',
      ]
    );
    assert.equal(
      response.data.meta.warnings.find(
        (warning: { code: string; level: string }) =>
          warning.code === 'capital_snapshot_attention'
      )?.level,
      'critical'
    );
    assert.equal(
      response.data.meta.warnings.find(
        (warning: { code: string; level: string }) =>
          warning.code === 'portfolio_snapshot_attention'
      )?.level,
      'warning'
    );

    assert.equal(response.data.meta.observability.totalMs, 0);
    assert.equal(response.data.meta.observability.warningCount, 4);
    assert.equal(response.data.meta.observability.staleSectionCount >= 4, true);
    assert.equal(response.data.meta.observability.criticalSectionCount >= 1, true);
    assert.equal(
      response.data.meta.observability.referenceCache.assets,
      'stale-cache-fallback'
    );
    assert.equal(
      response.data.meta.observability.referenceCache.selectedAsset,
      'stale-cache-fallback'
    );
    assert.equal(
      response.data.meta.observability.referenceCache.leverage,
      'stale-cache-fallback'
    );

    console.log('Overview Phase 4 assertions passed.');
  } finally {
    Date.now = originalDateNow;
  }
}

main().catch((error) => {
  console.error('Overview Phase 4 assertion failure:', error);
  process.exit(1);
});
