import assert from 'node:assert/strict';

import { RiskOverviewService } from '../src/api/services/RiskOverviewService';
import { formatApiDisplayTime } from '../src/api/utils/apiTimeContract';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runRiskActivityTrailAssertions(): Promise<void> {
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
        breachedRules: 0,
        liquidationWatch: 0,
        capitalAtRisk: 1250,
        drawdownBudgetUsed: '12%',
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

  service.riskRepository = {
    async getLatestSnapshot() {
      return {
        drawdownBudgetUsed: '12%',
        createdAt: new Date('2026-04-09T10:00:00.000Z'),
      };
    },
  };
  service.riskControlRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-09T10:10:00.000Z');
    },
  };
  service.riskAlertRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-09T10:11:00.000Z');
    },
  };
  service.riskScenarioRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-09T10:12:00.000Z');
    },
  };

  service.brokerDefinitionService = {
    async listActiveDefinitions() {
      return [{ brokerKey: 'mudrex', name: 'Mudrex' }];
    },
  };

  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [{ id: 'mudrex-1', brokerKey: 'mudrex', accountName: 'Mudrex Prime' }];
    },
  };

  service.fundsSnapshotRepository = {
    async getLatestSnapshot() {
      return null;
    },
  };

  service.positionSnapshotRepository = {
    async getAccountOpenPositionSummary() {
      return new Map();
    },
  };

  service.activityExportRepository = {
    async listExports(userId: string, query: { limit: number; offset: number }) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, { limit: 10, offset: 0 });
      return {
        items: [
          {
            id: 'export-orders-1',
            status: 'Ready',
            fileName: 'orders.csv',
            createdAt: new Date('2026-04-09T11:00:00.000Z'),
            expiresAt: new Date('2026-04-16T11:00:00.000Z'),
            filters: { route: 'Orders' },
          },
          {
            id: 'export-risk-2',
            status: 'Queued',
            fileName: 'risk-queued.csv',
            createdAt: new Date('2026-04-09T10:45:00.000Z'),
            expiresAt: null,
            filters: { route: 'Risk', referenceId: 'policy-1' },
          },
          {
            id: 'export-risk-1',
            status: 'Ready',
            fileName: 'risk-ready.csv',
            createdAt: new Date('2026-04-09T10:30:00.000Z'),
            expiresAt: new Date('2026-04-16T10:30:00.000Z'),
            filters: { route: 'Risk' },
          },
        ],
        total: 3,
      };
    },
  };

  const response = await service.getOverview('user-1', {});

  assert.deepEqual(response.data.activityTrail.defaultFilters, {
    route: 'Risk',
    readState: 'all',
  });
  assert.deepEqual(response.data.activityTrail.supportedFilters, [
    'stream',
    'status',
    'readState',
  ]);
  assert.deepEqual(response.data.activityTrail.streamOptions, [
    { value: 'all', label: 'All streams' },
    { value: 'Policies', label: 'Policy lifecycle' },
    { value: 'Controls', label: 'Enforcement' },
  ]);
  assert.equal(response.data.activityTrail.exportHistoryPath, '/activity?panel=exports&route=Risk');
  assert.equal(response.data.activityTrail.exportFormat, 'csv');
  assert.equal(response.data.activityTrail.exportRetentionDays, 7);
  assert.equal(
    response.data.activityTrail.exportRetentionLabel,
    'Exports from this trail are retained for 7 days.'
  );
  assert.deepEqual(response.data.activityTrail.latestExport, {
    exportId: 'export-risk-2',
    status: 'Queued',
    fileName: 'risk-queued.csv',
    createdAt: formatApiDisplayTime('2026-04-09T10:45:00.000Z', timeZone),
    createdAtIso: '2026-04-09T10:45:00.000Z',
    expiresAt: null,
    expiresAtIso: null,
    filters: { route: 'Risk', referenceId: 'policy-1' },
    downloadPath: undefined,
  });
}

async function main(): Promise<void> {
  await runRiskActivityTrailAssertions();
  console.log('Risk Center Phase 9 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
