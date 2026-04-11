import assert from 'node:assert/strict';

import { RiskBrokerOverviewItem } from '../src/api/contracts/RiskOverview';
import { RiskOverviewService } from '../src/api/services/RiskOverviewService';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

async function runRiskOverviewTruthAssertions(): Promise<void> {
  const service = new RiskOverviewService() as any;

  service.riskService = {
    async getRiskSummary() {
      return createSuccess({
        portfolioRisk: 'Watch',
        breachedRules: 1,
        liquidationWatch: 0,
        capitalAtRisk: 3200,
        drawdownBudgetUsed: '18%',
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
        drawdownBudgetUsed: '18%',
        createdAt: new Date('2026-04-09T10:00:00.000Z'),
      };
    },
  };
  service.riskControlRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-09T10:18:00.000Z');
    },
  };
  service.riskAlertRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-09T10:19:00.000Z');
    },
  };
  service.riskScenarioRepository = {
    async getLatestCreatedAtForUsers() {
      return new Date('2026-04-09T10:20:00.000Z');
    },
  };

  service.brokerDefinitionService = {
    async listActiveDefinitions() {
      return [
        { brokerKey: 'mudrex', name: 'Mudrex' },
        { brokerKey: 'delta_exchange', name: 'Delta Exchange' },
      ];
    },
  };

  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts() {
      return [
        {
          id: 'mudrex-1',
          brokerKey: 'mudrex',
          accountName: 'Mudrex Prime',
        },
        {
          id: 'mudrex-2',
          brokerKey: 'mudrex',
          accountName: 'Mudrex Secondary',
        },
        {
          id: 'delta-1',
          brokerKey: 'delta_exchange',
          accountName: 'Delta Main',
        },
      ];
    },
  };

  service.fundsSnapshotRepository = {
    async getLatestSnapshot(_userId: string, brokerKey: string, accountId: string) {
      const key = `${String(brokerKey).toLowerCase()}::${accountId}`;
      if (key === 'mudrex::mudrex-1') {
        return {
          futures_funds_json: JSON.stringify({ balance: 2000 }),
          wallet_funds_json: null,
          computed_at: new Date('2026-04-09T10:10:00.000Z'),
          created_at: new Date('2026-04-09T10:10:00.000Z'),
        };
      }
      if (key === 'delta_exchange::delta-1') {
        return {
          futures_funds_json: null,
          wallet_funds_json: JSON.stringify({ total: 300 }),
          computed_at: new Date('2026-04-09T09:45:00.000Z'),
          created_at: new Date('2026-04-09T09:45:00.000Z'),
        };
      }
      return null;
    },
  };

  service.positionSnapshotRepository = {
    async getAccountOpenPositionSummary() {
      return new Map([
        [
          'mudrex-1',
          {
            accountId: 'mudrex-1',
            openPositions: 3,
            observedAt: new Date('2026-04-09T10:11:00.000Z'),
            hasSnapshotHistory: true,
          },
        ],
        [
          'mudrex-2',
          {
            accountId: 'mudrex-2',
            openPositions: 0,
            observedAt: new Date('2026-04-09T10:12:00.000Z'),
            hasSnapshotHistory: true,
          },
        ],
      ]);
    },
  };

  service.activityExportRepository = {
    async listExports() {
      return {
        items: [
          {
            id: 'export-risk-1',
            status: 'Ready',
            fileName: 'risk-activity.csv',
            createdAt: new Date('2026-04-09T10:20:00.000Z'),
            expiresAt: new Date('2026-04-16T10:20:00.000Z'),
            filters: {
              route: 'Risk',
            },
          },
        ],
        total: 1,
      };
    },
  };

  const response = await service.getOverview('user-1', {});

  assert.equal(response.data.meta.contractVersion, 'risk-center-phase9-2026-04-09');
  assert.equal(
    response.data.meta.summary,
    'Phase 9 makes the `/risk-center` activity trail operational: operators can filter the in-page risk feed, queue exports from the current trail posture, and see retention cues before handing off into the full Activity workspace.'
  );
  assert.equal(response.data.meta.capabilities.liveBrokerKpis, false);
  assert.equal(response.data.meta.capabilities.policyRollback, true);
  assert.equal(response.data.meta.capabilities.snapshotBrokerKpis, true);
  assert.equal(response.data.meta.capabilities.weeklyMonthlyRiskWindowUsage, false);
  assert.equal(response.data.meta.capabilities.riskActivityTrailUsedByPage, true);
  assert.equal(response.data.meta.capabilities.riskActivityTrailFiltersUsedByPage, true);
  assert.equal(response.data.meta.capabilities.riskActivityTrailExportsUsedByPage, true);
  assert.equal(response.data.meta.capabilities.pageModulesSplitByConcern, true);
  assert.equal(response.data.meta.capabilities.workspaceFocusBannerUsedByPage, true);
  assert.equal(response.data.meta.capabilities.policyReviewWorkflow, true);
  assert.deepEqual(response.data.meta.freshness, {
    state: 'lagging',
    blockers: [
      'missing_funds_snapshot_coverage',
      'missing_positions_snapshot_coverage',
      'risk_snapshot_behind_sources',
    ],
    connectedAccountCount: 3,
    fundsAccountsWithSnapshot: 2,
    positionsAccountsWithSnapshot: 2,
    latestRiskSnapshotAt: '2026-04-09T10:00:00.000Z',
    latestFundsObservedAt: '2026-04-09T10:10:00.000Z',
    latestPositionsObservedAt: '2026-04-09T10:12:00.000Z',
    latestControlAt: '2026-04-09T10:18:00.000Z',
    latestAlertAt: '2026-04-09T10:19:00.000Z',
    latestScenarioAt: '2026-04-09T10:20:00.000Z',
    snapshotLagMinutes: 12,
  });
  assert.deepEqual(response.data.meta.lineage, {
    summary: 'risk_snapshots_latest',
    riskWindows: 'risk_snapshots_latest_with_explicit_unavailable_windows',
    brokerCoverage: 'funds_snapshots_plus_position_read_models_for_connected_accounts',
    recomputeWrites: ['risk_snapshots', 'risk_controls', 'risk_alerts', 'risk_scenarios'],
  });
  assert.deepEqual(response.data.meta.pageTruth, {
    riskWindowSource: 'latest_risk_snapshot_with_explicit_unavailable_windows',
    brokerCoverageSource: 'snapshot_backed_connected_brokers',
    policyWorkspace: 'selected_rule_with_pending_review_history_controls',
    policyGovernance: 'manual_review_for_sensitive_policy_mutations',
    activityTrailSource: 'activity_logs_route_and_reference_filters',
    activityTrailControls: 'in_page_filters_export_and_retention_cues',
    alertHandoff: 'alerts_workspace_symbol_search',
    workspaceStructure: 'focus_coverage_policy_activity_modules',
  });
  assert.equal(response.data.activityTrail.exportHistoryPath, '/activity?panel=exports&route=Risk');
  assert.equal(response.data.activityTrail.exportRetentionDays, 7);
  assert.equal(response.data.activityTrail.latestExport?.exportId, 'export-risk-1');

  const [dailyWindow, weeklyWindow, monthlyWindow] = response.data.riskWindows;
  assert.equal(dailyWindow.key, 'daily');
  assert.equal(dailyWindow.usedPct, 18);
  assert.equal(dailyWindow.availability, 'snapshot');
  assert.equal(weeklyWindow.availability, 'unavailable');
  assert.equal(monthlyWindow.availability, 'unavailable');

  const deltaItem = response.data.brokers.items.find(
    (item: RiskBrokerOverviewItem) => item.brokerKey === 'delta_exchange'
  );
  assert.deepEqual(deltaItem, {
    brokerKey: 'delta_exchange',
    brokerName: 'Delta Exchange',
    connectedAccountCount: 1,
    snapshotAvailability: 'partial',
    fundsBalance: {
      value: 300,
      availability: 'snapshot',
      observedAt: '2026-04-09T09:45:00.000Z',
      sourceLabel: 'Latest funds snapshot',
    },
    openPositions: {
      value: null,
      availability: 'unavailable',
      observedAt: null,
      sourceLabel: 'Latest positions snapshot',
    },
    note: 'Snapshot coverage is partial: funds 1/1, positions 0/1.',
  });

  const mudrexItem = response.data.brokers.items.find(
    (item: RiskBrokerOverviewItem) => item.brokerKey === 'mudrex'
  );
  assert.deepEqual(mudrexItem, {
    brokerKey: 'mudrex',
    brokerName: 'Mudrex',
    connectedAccountCount: 2,
    snapshotAvailability: 'partial',
    fundsBalance: {
      value: 2000,
      availability: 'snapshot',
      observedAt: '2026-04-09T10:10:00.000Z',
      sourceLabel: 'Latest funds snapshot',
    },
    openPositions: {
      value: 3,
      availability: 'snapshot',
      observedAt: '2026-04-09T10:12:00.000Z',
      sourceLabel: 'Latest positions snapshot',
    },
    note: 'Snapshot coverage is partial: funds 1/2, positions 2/2.',
  });
}

async function main(): Promise<void> {
  await runRiskOverviewTruthAssertions();
  console.log('Risk Center Phase 2 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
