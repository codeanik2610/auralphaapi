import assert from 'node:assert/strict';

import { RiskOverviewService } from '../src/api/services/RiskOverviewService';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
} from '../src/api/utils/apiTimeContract';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runRiskFreshnessAlignmentAssertions(): Promise<void> {
  const service = new RiskOverviewService() as any;
  const timeZone = 'Asia/Calcutta';

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };

  service.riskService = {
    async getRiskSummary() {
      return createSuccess({
        portfolioRisk: 'Watch',
        drawdownBudgetUsed: '16%',
      });
    },
    async getRiskControls() {
      return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
    },
    async getRiskScenarios() {
      return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
    },
    async getRiskAlerts() {
      return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
    },
    async getRiskPolicies() {
      return createSuccess({ items: [], total: 0 });
    },
  };

  service.brokerDefinitionService = {
    async listActiveDefinitions() {
      return [{ brokerKey: 'mudrex', name: 'Mudrex' }];
    },
  };

  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [
        { id: 'acc-1', brokerKey: 'mudrex', accountName: 'Mudrex Prime' },
        { id: 'acc-2', brokerKey: 'mudrex', accountName: 'Mudrex Backup' },
      ];
    },
  };

  service.riskRepository = {
    async getLatestSnapshot() {
      return {
        drawdownBudgetUsed: '16%',
        createdAt: new Date('2026-04-10T09:55:00.000Z'),
      };
    },
  };

  service.riskControlRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-10T09:57:00.000Z');
    },
  };

  service.riskAlertRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-10T09:58:00.000Z');
    },
  };

  service.riskScenarioRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-10T09:59:00.000Z');
    },
  };

  service.fundsSnapshotRepository = {
    async getLatestSnapshot() {
      return {
        futures_funds_json: JSON.stringify({ balance: 1200 }),
        wallet_funds_json: null,
        computed_at: new Date('2026-04-10T09:54:00.000Z'),
        created_at: new Date('2026-04-10T09:54:00.000Z'),
      };
    },
  };

  service.positionSnapshotRepository = {
    async getAccountOpenPositionSummary() {
      return new Map([
        [
          'acc-1',
          {
            accountId: 'acc-1',
            openPositions: 1,
            observedAt: new Date('2026-04-10T09:53:00.000Z'),
            hasSnapshotHistory: true,
          },
        ],
        [
          'acc-2',
          {
            accountId: 'acc-2',
            openPositions: 0,
            observedAt: new Date('2026-04-10T09:52:00.000Z'),
            hasSnapshotHistory: true,
          },
        ],
      ]);
    },
  };

  service.activityExportRepository = {
    async listExports() {
      return { items: [], total: 0 };
    },
  };

  const response = await service.getOverview('user-1', {});

  assert.deepEqual(response.data.time, buildApiTimeContract(timeZone));
  assert.deepEqual(response.data.meta.freshness, {
    state: 'fresh',
    blockers: [],
    connectedAccountCount: 2,
    fundsAccountsWithSnapshot: 2,
    positionsAccountsWithSnapshot: 2,
    latestRiskSnapshotAt: formatApiDisplayTime('2026-04-10T09:55:00.000Z', timeZone),
    latestRiskSnapshotAtIso: '2026-04-10T09:55:00.000Z',
    latestFundsObservedAt: formatApiDisplayTime('2026-04-10T09:54:00.000Z', timeZone),
    latestFundsObservedAtIso: '2026-04-10T09:54:00.000Z',
    latestPositionsObservedAt: formatApiDisplayTime('2026-04-10T09:53:00.000Z', timeZone),
    latestPositionsObservedAtIso: '2026-04-10T09:53:00.000Z',
    latestControlAt: formatApiDisplayTime('2026-04-10T09:57:00.000Z', timeZone),
    latestControlAtIso: '2026-04-10T09:57:00.000Z',
    latestAlertAt: formatApiDisplayTime('2026-04-10T09:58:00.000Z', timeZone),
    latestAlertAtIso: '2026-04-10T09:58:00.000Z',
    latestScenarioAt: formatApiDisplayTime('2026-04-10T09:59:00.000Z', timeZone),
    latestScenarioAtIso: '2026-04-10T09:59:00.000Z',
    snapshotLagMinutes: null,
  });
  assert.deepEqual(response.data.meta.lineage, {
    summary: 'risk_snapshots_latest',
    riskWindows: 'risk_snapshots_latest_with_explicit_unavailable_windows',
    brokerCoverage: 'funds_snapshots_plus_position_read_models_for_connected_accounts',
    recomputeWrites: ['risk_snapshots', 'risk_controls', 'risk_alerts', 'risk_scenarios'],
  });
}

async function main(): Promise<void> {
  await runRiskFreshnessAlignmentAssertions();
  console.log('Risk Center Phase 6 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
