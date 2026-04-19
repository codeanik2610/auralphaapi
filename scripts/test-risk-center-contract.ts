import assert from 'node:assert/strict';

import { RiskAlertsOverviewController } from '../src/api/controllers/RiskAlertsOverviewController';
import { RiskOverviewController } from '../src/api/controllers/RiskOverviewController';
import { RiskAlertsOverviewService } from '../src/api/services/RiskAlertsOverviewService';
import { RiskOverviewService } from '../src/api/services/RiskOverviewService';
import { validateUpsertRiskPolicyBody } from '../src/api/validators/risk.validator';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
} from '../src/api/utils/apiTimeContract';

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

function createOverviewQueryAssertion(query: Record<string, unknown>) {
  assert.deepEqual(query, {
    limit: '10',
    offset: '0',
  });
}

async function runValidatorAssertions(): Promise<void> {
  assert.deepEqual(
    validateUpsertRiskPolicyBody({
      scope: 'BROKER',
      brokerKey: ' mudrex ',
      enabled: 'true' as unknown as boolean,
      monitorOnly: 'false' as unknown as boolean,
      enforceHardBlock: 'true' as unknown as boolean,
      marginUsageWarnPct: '70',
      marginUsageCriticalPct: '85',
      concentrationWarnPct: '30',
      concentrationCriticalPct: '45',
      dailyLossLimitPct: '5',
      weeklyLossLimitPct: '12',
      monthlyLossLimitPct: '20',
      minLeverage: '1',
      maxLeverage: '5',
      minNotionalPerTrade: '100',
      maxOrderAllocation: '25',
      maxTotalAllocation: '70',
      maxAvgLeverage: '3',
    } as unknown as Parameters<typeof validateUpsertRiskPolicyBody>[0]),
    {
      scope: 'broker',
      brokerKey: 'mudrex',
      enabled: true,
      monitorOnly: false,
      enforceHardBlock: true,
      marginUsageWarnPct: 70,
      marginUsageCriticalPct: 85,
      concentrationWarnPct: 30,
      concentrationCriticalPct: 45,
      dailyLossLimitPct: 5,
      weeklyLossLimitPct: 12,
      monthlyLossLimitPct: 20,
      minLeverage: 1,
      maxLeverage: 5,
      minNotionalPerTrade: 100,
      maxOrderAllocation: 25,
      maxTotalAllocation: 70,
      maxAvgLeverage: 3,
    }
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'broker',
        enabled: true,
        monitorOnly: true,
        enforceHardBlock: false,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
      }),
    'brokerKey is required for broker scope'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'user',
        enabled: true,
        monitorOnly: true,
        enforceHardBlock: false,
        marginUsageWarnPct: 120,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
      }),
    'marginUsageWarnPct must be <= 100'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'desk' as any,
        enabled: true,
        monitorOnly: true,
        enforceHardBlock: false,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
      }),
    'scope must be one of: user, broker'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'user',
        enabled: true,
        monitorOnly: true,
        enforceHardBlock: true,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
      }),
    'monitorOnly and enforceHardBlock cannot both be true'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'user',
        enabled: true,
        monitorOnly: false,
        enforceHardBlock: true,
        marginUsageWarnPct: 90,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
      }),
    'marginUsageWarnPct must be less than or equal to marginUsageCriticalPct'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'user',
        enabled: true,
        monitorOnly: false,
        enforceHardBlock: true,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 50,
        concentrationCriticalPct: 45,
      }),
    'concentrationWarnPct must be less than or equal to concentrationCriticalPct'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'user',
        enabled: true,
        monitorOnly: false,
        enforceHardBlock: true,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
        dailyLossLimitPct: 15,
        weeklyLossLimitPct: 12,
        monthlyLossLimitPct: 20,
      }),
    'dailyLossLimitPct must be less than or equal to weeklyLossLimitPct'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'user',
        enabled: true,
        monitorOnly: false,
        enforceHardBlock: true,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
        dailyLossLimitPct: 5,
        weeklyLossLimitPct: 15,
        monthlyLossLimitPct: 12,
      }),
    'weeklyLossLimitPct must be less than or equal to monthlyLossLimitPct'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'user',
        enabled: true,
        monitorOnly: false,
        enforceHardBlock: true,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
        minLeverage: 6,
        maxLeverage: 5,
      }),
    'maxLeverage must be greater than or equal to minLeverage'
  );

  expectBadRequestSync(
    () =>
      validateUpsertRiskPolicyBody({
        scope: 'user',
        enabled: true,
        monitorOnly: false,
        enforceHardBlock: true,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
        minNotionalPerTrade: 0,
      }),
    'minNotionalPerTrade must be greater than 0 when provided'
  );
}

async function runRiskOverviewServiceAssertions(): Promise<void> {
  const service = new RiskOverviewService() as any;
  const timeZone = 'Asia/Calcutta';

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return timeZone;
    },
  };

  service.riskService = {
    async getRiskSummary(userId: string) {
      assert.equal(userId, 'user-1');
      return createSuccess({
        portfolioRisk: 'Watch',
        breachedRules: 2,
        liquidationWatch: 1,
        capitalAtRisk: 12000,
        drawdownBudgetUsed: '18%',
        primaryConcern: 'BTC concentration',
      });
    },
    async getRiskControls(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      createOverviewQueryAssertion(query);
      return createSuccess({
        items: [
          {
            id: 'control-1',
            snapshotId: 'snapshot-1',
            bucket: 'Margin',
            exposure: '74%',
            threshold: '70%',
            status: 'Watch',
            action: 'Reduce exposure',
            createdAt: '2026-04-09T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });
    },
    async getRiskScenarios(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      createOverviewQueryAssertion(query);
      return createSuccess({
        items: [
          {
            id: 'scenario-1',
            snapshotId: 'snapshot-1',
            scenario: 'BTC -10%',
            impact: 'High',
            commentary: 'Loss window would breach.',
            createdAt: '2026-04-09T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });
    },
    async getRiskAlerts(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      createOverviewQueryAssertion(query);
      return createSuccess({
        items: [
          {
            id: 'alert-1',
            snapshotId: 'snapshot-1',
            severity: 'High',
            message: 'BTC sleeve nearing concentration watch',
            symbol: 'BTCUSDT',
            channel: 'Risk',
            status: 'Open',
            createdAt: '2026-04-09T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      });
    },
    async getRiskPolicies(userId: string) {
      assert.equal(userId, 'user-1');
      return createSuccess({
        items: [
          {
            id: 'policy-1',
            scope: 'user',
            enabled: true,
            monitorOnly: true,
            enforceHardBlock: false,
            marginUsageWarnPct: 70,
            marginUsageCriticalPct: 85,
            concentrationWarnPct: 30,
            concentrationCriticalPct: 45,
            dailyLossLimitPct: 5,
            weeklyLossLimitPct: 12,
            monthlyLossLimitPct: 20,
            updatedAt: '2026-04-09T10:00:00.000Z',
          },
        ],
        total: 1,
      });
    },
  };

  service.brokerAccountRepository = {
    async getConnectedBrokerAccounts(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          id: 'account-1',
          brokerKey: 'mudrex',
          accountName: 'Mudrex Alpha',
        },
        {
          id: 'account-2',
          brokerKey: 'binance',
          accountName: 'Binance Primary',
        },
        {
          id: 'account-3',
          brokerKey: 'mudrex',
          accountName: 'Mudrex Beta',
        },
      ];
    },
  };

  service.riskRepository = {
    async getLatestSnapshot(userId: string) {
      assert.equal(userId, 'user-1');
      return {
        drawdownBudgetUsed: '18%',
        createdAt: new Date('2026-04-09T10:00:00.000Z'),
      };
    },
  };
  service.riskRuleEvaluationRepository = {
    async getLatestControlCreatedAtForUsers(userIds: string[]) {
      assert.deepEqual(userIds, ['user-1']);
      return new Date('2026-04-09T10:08:00.000Z');
    },
    async getLatestAlertCreatedAtForUsers(userIds: string[]) {
      assert.deepEqual(userIds, ['user-1']);
      return new Date('2026-04-09T10:09:00.000Z');
    },
  };
  service.riskScenarioRepository = {
    async getLatestCreatedAtForUsers(userIds: string[]) {
      assert.deepEqual(userIds, ['user-1']);
      return new Date('2026-04-09T10:10:00.000Z');
    },
  };

  service.fundsSnapshotRepository = {
    async getLatestSnapshot(userId: string, brokerKey: string, accountId: string) {
      assert.equal(userId, 'user-1');
      const key = `${String(brokerKey).toLowerCase()}::${accountId}`;
      if (key === 'mudrex::account-1') {
        return {
          futures_funds_json: JSON.stringify({ balance: 1200 }),
          wallet_funds_json: null,
          computed_at: new Date('2026-04-09T10:05:00.000Z'),
          created_at: new Date('2026-04-09T10:05:00.000Z'),
        };
      }
      if (key === 'binance::account-2') {
        return {
          futures_funds_json: null,
          wallet_funds_json: JSON.stringify({ total: 450 }),
          computed_at: new Date('2026-04-09T09:55:00.000Z'),
          created_at: new Date('2026-04-09T09:55:00.000Z'),
        };
      }
      return null;
    },
  };

  service.positionSnapshotRepository = {
    async getAccountOpenPositionSummary(userId: string, accountIds: string[]) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(accountIds, ['account-1', 'account-2', 'account-3']);
      return new Map([
        [
          'account-1',
          {
            accountId: 'account-1',
            openPositions: 2,
            observedAt: new Date('2026-04-09T10:06:00.000Z'),
            hasSnapshotHistory: true,
          },
        ],
        [
          'account-2',
          {
            accountId: 'account-2',
            openPositions: 0,
            observedAt: new Date('2026-04-09T09:56:00.000Z'),
            hasSnapshotHistory: true,
          },
        ],
      ]);
    },
  };

  service.activityExportRepository = {
    async listExports(userId: string, query: { limit: number; offset: number }) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, { limit: 10, offset: 0 });
      return {
        items: [
          {
            id: 'export-risk-1',
            status: 'Ready',
            fileName: 'risk-activity.csv',
            createdAt: new Date('2026-04-09T10:30:00.000Z'),
            expiresAt: new Date('2026-04-16T10:30:00.000Z'),
            filters: {
              route: 'Risk',
              referenceId: 'policy-1',
            },
          },
        ],
        total: 1,
      };
    },
  };

  service.brokerDefinitionService = {
    async listActiveDefinitions() {
      return [
        { brokerKey: 'mudrex', name: 'Mudrex' },
        { brokerKey: 'binance', name: 'Binance' },
      ];
    },
  };

  const response = await service.getOverview('user-1', {});

  assert.equal(response.success, true);
  assert.deepEqual(response.data.time, buildApiTimeContract(timeZone));
  assert.equal(response.data.meta.contractVersion, 'risk-center-phase11-2026-04-18');
  assert.equal(response.data.meta.purpose, 'operator_risk_workspace');
  assert.deepEqual(response.data.meta.time, buildApiTimeContract(timeZone));
  assert.equal(
    response.data.meta.summary,
    'Phase 11 keeps the activity-trail workflow intact and moves controls/alerts freshness plus operator read paths onto normalized risk_rule_evaluations storage while preserving persisted daily, weekly, and monthly risk windows.'
  );
  assert.deepEqual(response.data.meta.query.supported, [
    'controlsLimit',
    'controlsOffset',
    'alertsLimit',
    'alertsOffset',
    'scenariosLimit',
    'scenariosOffset',
  ]);
  assert.deepEqual(response.data.meta.query.resolved, {
    controls: { limit: 10, offset: 0 },
    alerts: { limit: 10, offset: 0 },
    scenarios: { limit: 10, offset: 0 },
  });
  assert.deepEqual(response.data.meta.sources, {
    summary: 'risk_snapshots_latest',
    controls: 'risk_rule_evaluations_derived_controls',
    scenarios: 'risk_scenarios',
    alerts: 'risk_rule_evaluations_derived_alerts',
    policies: 'risk_policies',
    brokers: 'connected_broker_accounts_plus_active_definitions',
    riskWindows: 'risk_snapshots_latest_with_persisted_loss_windows',
    brokerSnapshots:
      'risk_account_snapshots_plus_funds_snapshots_plus_position_read_models_for_connected_accounts',
    activityExports: 'activity_exports_filtered_for_recent_risk_route_context',
  });
  assert.deepEqual(response.data.meta.pageTruth, {
    riskWindowSource: 'latest_risk_snapshot_with_persisted_loss_windows',
    brokerCoverageSource: 'risk_account_snapshots_backed_connected_brokers',
    policyWorkspace: 'selected_rule_with_pending_review_history_controls',
    policyGovernance: 'manual_review_for_sensitive_policy_mutations',
    activityTrailSource: 'activity_logs_route_and_reference_filters',
    activityTrailControls: 'in_page_filters_export_and_retention_cues',
    alertHandoff: 'alerts_workspace_symbol_search',
    workspaceStructure: 'focus_coverage_policy_activity_modules',
  });
  assert.deepEqual(response.data.meta.capabilities, {
    policyWrites: true,
    policyRollback: true,
    liveBrokerKpis: false,
    snapshotBrokerKpis: true,
    weeklyMonthlyRiskWindowUsage: true,
    riskCapacity: false,
    killSwitchAutomation: false,
    recomputeExecutesRealCalculation: true,
    riskActivityTrailUsedByPage: true,
    riskActivityTrailFiltersUsedByPage: true,
    riskActivityTrailExportsUsedByPage: true,
    pageModulesSplitByConcern: true,
    workspaceFocusBannerUsedByPage: true,
    policyReviewWorkflow: true,
  });
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
    latestRiskSnapshotAt: formatApiDisplayTime('2026-04-09T10:00:00.000Z', timeZone),
    latestRiskSnapshotAtIso: '2026-04-09T10:00:00.000Z',
    latestFundsObservedAt: formatApiDisplayTime('2026-04-09T10:05:00.000Z', timeZone),
    latestFundsObservedAtIso: '2026-04-09T10:05:00.000Z',
    latestPositionsObservedAt: formatApiDisplayTime('2026-04-09T10:06:00.000Z', timeZone),
    latestPositionsObservedAtIso: '2026-04-09T10:06:00.000Z',
    latestControlAt: formatApiDisplayTime('2026-04-09T10:08:00.000Z', timeZone),
    latestControlAtIso: '2026-04-09T10:08:00.000Z',
    latestAlertAt: formatApiDisplayTime('2026-04-09T10:09:00.000Z', timeZone),
    latestAlertAtIso: '2026-04-09T10:09:00.000Z',
    latestScenarioAt: formatApiDisplayTime('2026-04-09T10:10:00.000Z', timeZone),
    latestScenarioAtIso: '2026-04-09T10:10:00.000Z',
    snapshotLagMinutes: 6,
  });
  assert.deepEqual(response.data.meta.lineage, {
    summary: 'risk_snapshots_latest',
    riskWindows: 'risk_snapshots_latest_with_persisted_loss_windows',
    brokerCoverage:
      'risk_account_snapshots_plus_funds_snapshots_plus_position_read_models_for_connected_accounts',
    recomputeWrites: [
      'risk_snapshots',
      'risk_account_snapshots',
      'risk_order_snapshots',
      'risk_position_snapshots',
      'risk_rule_evaluations',
      'risk_controls',
      'risk_alerts',
      'risk_scenarios',
    ],
  });
  assert.deepEqual(response.data.activityTrail, {
    defaultFilters: {
      route: 'Risk',
      readState: 'all',
    },
    supportedFilters: ['stream', 'status', 'readState'],
    streamOptions: [
      { value: 'all', label: 'All streams' },
      { value: 'Policies', label: 'Policy lifecycle' },
      { value: 'Controls', label: 'Enforcement' },
    ],
    statusOptions: [
      { value: 'all', label: 'All statuses' },
      { value: 'Success', label: 'Success' },
      { value: 'In progress', label: 'Needs review' },
      { value: 'Queued', label: 'Queued' },
      { value: 'Failed', label: 'Failed' },
    ],
    readStateOptions: [
      { value: 'all', label: 'All read states' },
      { value: 'unread', label: 'Unread only' },
      { value: 'read', label: 'Read only' },
    ],
    exportHistoryPath: '/activity?panel=exports&route=Risk',
    exportFormat: 'csv',
    exportRetentionDays: 7,
    exportRetentionLabel: 'Exports from this trail are retained for 7 days.',
    latestExport: {
      exportId: 'export-risk-1',
      status: 'Ready',
      fileName: 'risk-activity.csv',
      createdAt: formatApiDisplayTime('2026-04-09T10:30:00.000Z', timeZone),
      createdAtIso: '2026-04-09T10:30:00.000Z',
      expiresAt: formatApiDisplayTime('2026-04-16T10:30:00.000Z', timeZone),
      expiresAtIso: '2026-04-16T10:30:00.000Z',
      filters: {
        route: 'Risk',
        referenceId: 'policy-1',
      },
      downloadPath: '/activity/exports/export-risk-1/download',
    },
  });
  assert.deepEqual(response.data.riskWindows, [
    {
      key: 'daily',
      label: 'Daily',
      usedPct: 18,
      usedDisplay: '18%',
      availability: 'snapshot',
      observedAt: formatApiDisplayTime('2026-04-09T10:00:00.000Z', timeZone),
      observedAtIso: '2026-04-09T10:00:00.000Z',
      sourceLabel: 'Latest risk snapshot',
      note: 'Daily loss usage is sourced from risk_snapshots.drawdownBudgetUsed.',
    },
    {
      key: 'weekly',
      label: 'Weekly',
      usedPct: null,
      usedDisplay: 'Unavailable',
      availability: 'unavailable',
      observedAt: formatApiDisplayTime('2026-04-09T10:00:00.000Z', timeZone),
      observedAtIso: '2026-04-09T10:00:00.000Z',
      sourceLabel: 'Recompute required',
      note: 'Weekly loss usage will appear after the next risk recompute persists the new snapshot window fields.',
    },
    {
      key: 'monthly',
      label: 'Monthly',
      usedPct: null,
      usedDisplay: 'Unavailable',
      availability: 'unavailable',
      observedAt: formatApiDisplayTime('2026-04-09T10:00:00.000Z', timeZone),
      observedAtIso: '2026-04-09T10:00:00.000Z',
      sourceLabel: 'Recompute required',
      note: 'Monthly loss usage will appear after the next risk recompute persists the new snapshot window fields.',
    },
  ]);
  assert.deepEqual(response.data.brokers.brokerKeys, ['binance', 'mudrex']);
  assert.deepEqual(response.data.brokers.brokerKeyNameMap, {
    binance: 'Binance',
    mudrex: 'Mudrex',
  });
  assert.deepEqual(response.data.brokers.items, [
    {
      brokerKey: 'binance',
      brokerName: 'Binance',
      connectedAccountCount: 1,
      snapshotAvailability: 'snapshot',
      fundsBalance: {
        value: 450,
        availability: 'snapshot',
        observedAt: formatApiDisplayTime('2026-04-09T09:55:00.000Z', timeZone),
        observedAtIso: '2026-04-09T09:55:00.000Z',
        sourceLabel: 'Latest funds snapshot',
      },
      openPositions: {
        value: 0,
        availability: 'snapshot',
        observedAt: formatApiDisplayTime('2026-04-09T09:56:00.000Z', timeZone),
        observedAtIso: '2026-04-09T09:56:00.000Z',
        sourceLabel: 'Latest positions snapshot',
      },
      note: 'All connected accounts have snapshot-backed funds and positions coverage.',
    },
    {
      brokerKey: 'mudrex',
      brokerName: 'Mudrex',
      connectedAccountCount: 2,
      snapshotAvailability: 'partial',
      fundsBalance: {
        value: 1200,
        availability: 'snapshot',
        observedAt: formatApiDisplayTime('2026-04-09T10:05:00.000Z', timeZone),
        observedAtIso: '2026-04-09T10:05:00.000Z',
        sourceLabel: 'Latest funds snapshot',
      },
      openPositions: {
        value: 2,
        availability: 'snapshot',
        observedAt: formatApiDisplayTime('2026-04-09T10:06:00.000Z', timeZone),
        observedAtIso: '2026-04-09T10:06:00.000Z',
        sourceLabel: 'Latest positions snapshot',
      },
      note: 'Snapshot coverage is partial: funds 1/2, positions 1/2.',
    },
  ]);
  assert.equal(response.data.summary.primaryConcern, 'BTC concentration');
  assert.equal(response.data.controls.items[0].bucket, 'Margin');
  assert.equal(response.data.scenarios.items[0].scenario, 'BTC -10%');
  assert.equal(response.data.alerts.items[0].symbol, 'BTCUSDT');
  assert.equal(response.data.policies.items[0].scope, 'user');
}

async function runRiskAlertsOverviewServiceAssertions(): Promise<void> {
  const service = new RiskAlertsOverviewService() as any;

  service.riskService = {
    async getRiskAlerts(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, {
        limit: '25',
        offset: '5',
        status: 'Open',
        scope: 'Risk',
      });
      return createSuccess({
        items: [
          {
            id: 'alert-1',
            snapshotId: 'snapshot-1',
            severity: 'High',
            message: 'Risk alert',
            symbol: 'BTCUSDT',
            status: 'Open',
            channel: 'Risk',
            createdAt: '2026-04-09T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 25,
        offset: 5,
      });
    },
    async getRiskAlertsSummary(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, {
        status: 'Open',
        scope: 'Risk',
      });
      return createSuccess({
        total: 1,
        bySeverity: {
          High: 1,
        },
        byStatus: {
          Open: 1,
        },
      });
    },
  };

  const response = await service.getOverview('user-1', {
    limit: '25',
    offset: '5',
    status: 'Open',
    scope: 'Risk',
  });

  assert.equal(response.success, true);
  assert.equal(response.data.meta.contractVersion, 'risk-center-phase3-2026-04-18');
  assert.equal(response.data.meta.purpose, 'risk_alerts_digest_for_risk_center');
  assert.deepEqual(response.data.meta.query, {
    supported: ['limit', 'offset', 'status', 'scope'],
    resolved: {
      limit: 25,
      offset: 5,
      status: 'Open',
      scope: 'Risk',
    },
  });
  assert.deepEqual(response.data.meta.sources, {
    summary: 'risk_rule_evaluations_alert_aggregate',
    alerts: 'risk_rule_evaluations_derived_alerts',
  });
  assert.equal(response.data.summary.total, 1);
  assert.equal(response.data.alerts.items[0].severity, 'High');
}

async function runControllerAssertions(): Promise<void> {
  const overviewController = new RiskOverviewController() as any;
  overviewController.riskOverviewService = {
    async getOverview(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, {
        controlsLimit: '11',
        controlsOffset: '1',
        alertsLimit: '12',
        alertsOffset: '2',
        scenariosLimit: '13',
        scenariosOffset: '3',
      });
      return createSuccess({ ok: true });
    },
  };

  const overviewResponse = await overviewController.getOverview(
    { authUser: { sub: 'user-1' } } as any,
    '11',
    '1',
    '12',
    '2',
    '13',
    '3'
  );
  assert.deepEqual(overviewResponse, createSuccess({ ok: true }));

  const alertsOverviewController = new RiskAlertsOverviewController() as any;
  alertsOverviewController.riskAlertsOverviewService = {
    async getOverview(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, {
        limit: '20',
        offset: '4',
        status: 'Open',
        scope: 'Risk',
      });
      return createSuccess({ ok: true });
    },
  };

  const alertsOverviewResponse = await alertsOverviewController.getOverview(
    { authUser: { sub: 'user-1' } } as any,
    '20',
    '4',
    'Open',
    'Risk'
  );
  assert.deepEqual(alertsOverviewResponse, createSuccess({ ok: true }));
}

async function main(): Promise<void> {
  await runValidatorAssertions();
  await runRiskOverviewServiceAssertions();
  await runRiskAlertsOverviewServiceAssertions();
  await runControllerAssertions();
  console.log('risk center contract assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
