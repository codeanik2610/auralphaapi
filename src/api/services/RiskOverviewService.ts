import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  RiskOverviewResponse,
  RiskActivityTrailExportItem,
  RiskActivityTrailOverview,
  RiskBrokerOverviewItem,
  RiskOverviewFreshnessMeta,
  RiskWindowOverviewItem,
} from '../contracts/RiskOverview';
import { successResponse } from '../utils/response';
import { RiskService } from './RiskService';
import { BrokerDefinitionService } from '../../brokers';
import {
  ActivityExportRepository,
  BrokerAccountRepository,
  FundsSnapshotRepository,
  PositionSnapshotRepository,
  RiskRuleEvaluationRepository,
  RiskRepository,
  RiskScenarioRepository,
} from '../../database';
import { BrokerAccount } from '../../database/entities/BrokerAccount';
import { ActivityExport } from '../../database/entities/ActivityExport';
import { FundsSnapshotRow } from '../../database/repositories/FundsSnapshotRepository';
import { env } from '../../env';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';
import { UserTimeZoneService } from './UserTimeZoneService';

interface RiskOverviewQuery {
  controlsLimit?: string;
  controlsOffset?: string;
  alertsLimit?: string;
  alertsOffset?: string;
  scenariosLimit?: string;
  scenariosOffset?: string;
}

const DEFAULT_LIMIT = 10;
const RISK_CENTER_CONTRACT_VERSION = 'risk-center-phase11-2026-04-18' as const;
const RISK_SNAPSHOT_LAG_TOLERANCE_MS = 5 * 60 * 1000;

interface BrokerCoverageAggregate {
  connectedAccountCount: number;
  fundsAccountsWithSnapshot: number;
  positionsAccountsWithSnapshot: number;
  latestFundsObservedAt: Date | null;
  latestPositionsObservedAt: Date | null;
}

interface BrokerCoverageResult {
  items: RiskBrokerOverviewItem[];
  aggregate: BrokerCoverageAggregate;
}

@Service()
export class RiskOverviewService {
  @Inject(() => RiskService)
  private riskService!: RiskService;

  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => RiskRepository)
  private riskRepository!: RiskRepository;

  @Inject(() => FundsSnapshotRepository)
  private fundsSnapshotRepository!: FundsSnapshotRepository;

  @Inject(() => PositionSnapshotRepository)
  private positionSnapshotRepository!: PositionSnapshotRepository;

  @Inject(() => RiskRuleEvaluationRepository)
  private riskRuleEvaluationRepository!: RiskRuleEvaluationRepository;

  @Inject(() => RiskScenarioRepository)
  private riskScenarioRepository!: RiskScenarioRepository;

  @Inject(() => ActivityExportRepository)
  private activityExportRepository!: ActivityExportRepository;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async getOverview(
    userId: string,
    query: RiskOverviewQuery
  ): Promise<ApiSuccessResponse<RiskOverviewResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const controlsLimit = query.controlsLimit ?? String(DEFAULT_LIMIT);
    const controlsOffset = query.controlsOffset ?? '0';
    const alertsLimit = query.alertsLimit ?? String(DEFAULT_LIMIT);
    const alertsOffset = query.alertsOffset ?? '0';
    const scenariosLimit = query.scenariosLimit ?? String(DEFAULT_LIMIT);
    const scenariosOffset = query.scenariosOffset ?? '0';

    const [
      summaryResponse,
      controlsResponse,
      scenariosResponse,
      alertsResponse,
      policiesResponse,
      brokerAccounts,
      brokerDefinitions,
      recentActivityExports,
      latestRiskSnapshot,
      latestControlAt,
      latestAlertAt,
      latestScenarioAt,
    ] = await Promise.all([
      this.riskService.getRiskSummary(userId),
      this.riskService.getRiskControls(userId, { limit: controlsLimit, offset: controlsOffset }),
      this.riskService.getRiskScenarios(userId, { limit: scenariosLimit, offset: scenariosOffset }),
      this.riskService.getRiskAlerts(userId, { limit: alertsLimit, offset: alertsOffset }),
      this.riskService.getRiskPolicies(userId),
      this.brokerAccountRepository.getConnectedBrokerAccounts(userId),
      this.brokerDefinitionService.listActiveDefinitions(),
      this.activityExportRepository.listExports(userId, { limit: 10, offset: 0 }),
      this.riskRepository.getLatestSnapshot(userId),
      this.riskRuleEvaluationRepository.getLatestControlCreatedAtForUsers([userId]),
      this.riskRuleEvaluationRepository.getLatestAlertCreatedAtForUsers([userId]),
      this.riskScenarioRepository.getLatestCreatedAtForUsers([userId]),
    ]);

    const brokerKeyNameMap = brokerDefinitions.reduce<Record<string, string>>((acc, def) => {
      const key = String(def.brokerKey || '').trim().toLowerCase();
      const name = String(def.name || '').trim();
      if (key && name) {
        acc[key] = name;
      }
      return acc;
    }, {});

    const brokerKeys = Array.from(
      new Set(
        brokerAccounts
          .map((account) => String(account.brokerKey || '').trim().toLowerCase())
          .filter(Boolean)
      )
    ).sort();

    const summary = summaryResponse.data ?? summaryResponse;
    const controls = controlsResponse.data ?? controlsResponse;
    const scenarios = scenariosResponse.data ?? scenariosResponse;
    const alerts = alertsResponse.data ?? alertsResponse;
    const policies = policiesResponse.data ?? policiesResponse;
    const riskWindows = this.buildRiskWindowItems(summary, latestRiskSnapshot, timeZone);
    const brokerCoverage = await this.buildBrokerItems(userId, brokerAccounts, brokerKeyNameMap, timeZone);
    const activityTrail = this.buildActivityTrailOverview(recentActivityExports.items, timeZone);
    const freshness = this.buildFreshnessMeta({
      latestRiskSnapshotAt: latestRiskSnapshot?.createdAt || null,
      latestFundsObservedAt: brokerCoverage.aggregate.latestFundsObservedAt,
      latestPositionsObservedAt: brokerCoverage.aggregate.latestPositionsObservedAt,
      latestControlAt,
      latestAlertAt,
      latestScenarioAt,
      connectedAccountCount: brokerCoverage.aggregate.connectedAccountCount,
      fundsAccountsWithSnapshot: brokerCoverage.aggregate.fundsAccountsWithSnapshot,
      positionsAccountsWithSnapshot: brokerCoverage.aggregate.positionsAccountsWithSnapshot,
    }, timeZone);
    const generatedAtIso = new Date().toISOString();

    return successResponse({
      meta: {
        contractVersion: RISK_CENTER_CONTRACT_VERSION,
        purpose: 'operator_risk_workspace',
        generatedAt: this.formatDisplayTime(generatedAtIso, timeZone) || generatedAtIso,
        generatedAtIso,
        summary:
          'Phase 11 keeps the activity-trail workflow intact and moves controls/alerts freshness plus operator read paths onto normalized risk_rule_evaluations storage while preserving persisted daily, weekly, and monthly risk windows.',
        query: {
          supported: [
            'controlsLimit',
            'controlsOffset',
            'alertsLimit',
            'alertsOffset',
            'scenariosLimit',
            'scenariosOffset',
          ],
          unsupported: ['brokerKey', 'accountId', 'status', 'scope', 'sort', 'order'],
          resolved: {
            controls: {
              limit: controls.limit,
              offset: controls.offset,
            },
            alerts: {
              limit: alerts.limit,
              offset: alerts.offset,
            },
            scenarios: {
              limit: scenarios.limit,
              offset: scenarios.offset,
            },
          },
        },
        sources: {
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
        },
        pageTruth: {
          riskWindowSource: 'latest_risk_snapshot_with_persisted_loss_windows',
          brokerCoverageSource: 'risk_account_snapshots_backed_connected_brokers',
          policyWorkspace: 'selected_rule_with_pending_review_history_controls',
          policyGovernance: 'manual_review_for_sensitive_policy_mutations',
          activityTrailSource: 'activity_logs_route_and_reference_filters',
          activityTrailControls: 'in_page_filters_export_and_retention_cues',
          alertHandoff: 'alerts_workspace_symbol_search',
          workspaceStructure: 'focus_coverage_policy_activity_modules',
        },
        capabilities: {
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
        },
        freshness,
        lineage: {
          summary: 'risk_snapshots_latest',
          riskWindows: 'risk_snapshots_latest_with_persisted_loss_windows',
          brokerCoverage: 'risk_account_snapshots_plus_funds_snapshots_plus_position_read_models_for_connected_accounts',
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
        },
        time: buildApiTimeContract(timeZone),
      },
      summary,
      controls,
      scenarios,
      alerts,
      policies,
      riskWindows,
      brokers: {
        brokerKeys,
        brokerKeyNameMap,
        items: brokerCoverage.items,
      },
      activityTrail,
      time: buildApiTimeContract(timeZone),
    });
  }

  private buildActivityTrailOverview(
    exports: ActivityExport[],
    timeZone: string
  ): RiskActivityTrailOverview {
    const latestRiskExport = exports.find((item) => {
      const route = String(item.filters?.route || '').trim().toLowerCase();
      return route === 'risk';
    });

    return {
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
      exportRetentionDays: env.activity.exportRetentionDays,
      exportRetentionLabel: `Exports from this trail are retained for ${env.activity.exportRetentionDays} day${env.activity.exportRetentionDays === 1 ? '' : 's'}.`,
      latestExport: latestRiskExport ? this.mapActivityTrailExport(latestRiskExport, timeZone) : null,
    };
  }

  private mapActivityTrailExport(
    item: ActivityExport,
    timeZone: string
  ): RiskActivityTrailExportItem {
    const createdAtIso = this.formatRawIso(item.createdAt);
    const expiresAtIso = this.formatRawIso(item.expiresAt);
    return {
      exportId: item.id,
      status: item.status as RiskActivityTrailExportItem['status'],
      fileName: item.fileName,
      createdAt: this.formatDisplayTime(createdAtIso, timeZone) || item.createdAt.toISOString(),
      createdAtIso: createdAtIso || undefined,
      expiresAt: this.formatDisplayTime(expiresAtIso, timeZone),
      expiresAtIso: expiresAtIso || null,
      filters: item.filters ?? {},
      downloadPath: item.status === 'Ready' ? `/activity/exports/${item.id}/download` : undefined,
    };
  }

  private buildRiskWindowItems(
    summary:
      | {
          drawdownBudgetUsed?: unknown;
          weeklyDrawdownBudgetUsed?: unknown;
          monthlyDrawdownBudgetUsed?: unknown;
        }
      | null
      | undefined,
    latestRiskSnapshot:
      | {
          createdAt?: Date | null;
          drawdownBudgetUsed?: string | null;
          weeklyDrawdownBudgetUsed?: string | null;
          monthlyDrawdownBudgetUsed?: string | null;
        }
      | null,
    timeZone: string
  ): RiskWindowOverviewItem[] {
    const drawdownBudgetUsed = String(
      summary?.drawdownBudgetUsed ?? latestRiskSnapshot?.drawdownBudgetUsed ?? ''
    ).trim();
    const weeklyDrawdownBudgetUsed = String(
      summary?.weeklyDrawdownBudgetUsed ?? latestRiskSnapshot?.weeklyDrawdownBudgetUsed ?? ''
    ).trim();
    const monthlyDrawdownBudgetUsed = String(
      summary?.monthlyDrawdownBudgetUsed ?? latestRiskSnapshot?.monthlyDrawdownBudgetUsed ?? ''
    ).trim();
    const dailyObservedAt =
      latestRiskSnapshot?.createdAt instanceof Date
        ? this.formatRawIso(latestRiskSnapshot.createdAt)
        : null;

    return [
      {
        key: 'daily',
        label: 'Daily',
        usedPct: this.parsePercent(drawdownBudgetUsed),
        usedDisplay: drawdownBudgetUsed || 'Unavailable',
        availability: drawdownBudgetUsed ? 'snapshot' : 'unavailable',
        observedAt: this.formatDisplayTime(dailyObservedAt, timeZone),
        observedAtIso: dailyObservedAt,
        sourceLabel: 'Latest risk snapshot',
        note: 'Daily loss usage is sourced from risk_snapshots.drawdownBudgetUsed.',
      },
      {
        key: 'weekly',
        label: 'Weekly',
        usedPct: this.parsePercent(weeklyDrawdownBudgetUsed),
        usedDisplay: weeklyDrawdownBudgetUsed || 'Unavailable',
        availability: weeklyDrawdownBudgetUsed ? 'snapshot' : 'unavailable',
        observedAt: this.formatDisplayTime(dailyObservedAt, timeZone),
        observedAtIso: dailyObservedAt,
        sourceLabel: weeklyDrawdownBudgetUsed ? 'Latest risk snapshot' : 'Recompute required',
        note: weeklyDrawdownBudgetUsed
          ? 'Weekly loss usage is sourced from risk_snapshots.weeklyDrawdownBudgetUsed and represents trailing 7-day realized loss usage.'
          : 'Weekly loss usage will appear after the next risk recompute persists the new snapshot window fields.',
      },
      {
        key: 'monthly',
        label: 'Monthly',
        usedPct: this.parsePercent(monthlyDrawdownBudgetUsed),
        usedDisplay: monthlyDrawdownBudgetUsed || 'Unavailable',
        availability: monthlyDrawdownBudgetUsed ? 'snapshot' : 'unavailable',
        observedAt: this.formatDisplayTime(dailyObservedAt, timeZone),
        observedAtIso: dailyObservedAt,
        sourceLabel: monthlyDrawdownBudgetUsed ? 'Latest risk snapshot' : 'Recompute required',
        note: monthlyDrawdownBudgetUsed
          ? 'Monthly loss usage is sourced from risk_snapshots.monthlyDrawdownBudgetUsed and represents trailing 30-day realized loss usage.'
          : 'Monthly loss usage will appear after the next risk recompute persists the new snapshot window fields.',
      },
    ];
  }

  private async buildBrokerItems(
    userId: string,
    brokerAccounts: BrokerAccount[],
    brokerKeyNameMap: Record<string, string>,
    timeZone: string
  ): Promise<BrokerCoverageResult> {
    const uniqueAccounts = Array.from(
      new Map(
        brokerAccounts
          .filter((account) => Boolean(String(account.id || '').trim()))
          .map((account) => [account.id, account])
      ).values()
    );

    const positionSummaryByAccount = await this.positionSnapshotRepository.getAccountOpenPositionSummary(
      userId,
      uniqueAccounts.map((account) => account.id)
    );

    const fundsSnapshotByAccount = new Map<string, FundsSnapshotRow | null>();
    await Promise.all(
      uniqueAccounts.map(async (account) => {
        const snapshot = await this.fundsSnapshotRepository.getLatestSnapshot(
          userId,
          account.brokerKey,
          account.id
        );
        fundsSnapshotByAccount.set(account.id, snapshot);
      })
    );

    const groupedByBroker = new Map<
      string,
      {
        brokerName: string;
        connectedAccountCount: number;
        fundsBalanceTotal: number;
        fundsAccountsWithSnapshot: number;
        latestFundsObservedAt: Date | null;
        openPositionsTotal: number;
        positionsAccountsWithSnapshot: number;
        latestPositionsObservedAt: Date | null;
      }
    >();

    uniqueAccounts.forEach((account) => {
      const normalizedBrokerKey = String(account.brokerKey || '').trim().toLowerCase();
      if (!normalizedBrokerKey) {
        return;
      }

      const current = groupedByBroker.get(normalizedBrokerKey) || {
        brokerName: brokerKeyNameMap[normalizedBrokerKey] || account.brokerKey || '--',
        connectedAccountCount: 0,
        fundsBalanceTotal: 0,
        fundsAccountsWithSnapshot: 0,
        latestFundsObservedAt: null,
        openPositionsTotal: 0,
        positionsAccountsWithSnapshot: 0,
        latestPositionsObservedAt: null,
      };

      current.connectedAccountCount += 1;

      const fundsMetric = this.extractFundsBalance(fundsSnapshotByAccount.get(account.id) || null);
      if (fundsMetric.value !== null) {
        current.fundsBalanceTotal += fundsMetric.value;
        current.fundsAccountsWithSnapshot += 1;
        current.latestFundsObservedAt = this.maxDate(
          current.latestFundsObservedAt,
          this.toDate(fundsMetric.observedAt)
        );
      }

      const positionSummary = positionSummaryByAccount.get(account.id);
      if (positionSummary?.hasSnapshotHistory) {
        current.openPositionsTotal += positionSummary.openPositions;
        current.positionsAccountsWithSnapshot += 1;
        current.latestPositionsObservedAt = this.maxDate(
          current.latestPositionsObservedAt,
          positionSummary.observedAt
        );
      }

      groupedByBroker.set(normalizedBrokerKey, current);
    });

    const items = Array.from(groupedByBroker.entries())
      .map(([brokerKey, value]) => {
        const hasAnySnapshot =
          value.fundsAccountsWithSnapshot > 0 || value.positionsAccountsWithSnapshot > 0;
        const hasFullSnapshotCoverage =
          value.connectedAccountCount > 0 &&
          value.fundsAccountsWithSnapshot === value.connectedAccountCount &&
          value.positionsAccountsWithSnapshot === value.connectedAccountCount;

        const snapshotAvailability: RiskBrokerOverviewItem['snapshotAvailability'] =
          hasFullSnapshotCoverage
          ? 'snapshot'
          : hasAnySnapshot
            ? 'partial'
            : 'unavailable';
        const fundsAvailability: RiskBrokerOverviewItem['fundsBalance']['availability'] =
          value.fundsAccountsWithSnapshot > 0 ? 'snapshot' : 'unavailable';
        const openPositionsAvailability: RiskBrokerOverviewItem['openPositions']['availability'] =
          value.positionsAccountsWithSnapshot > 0 ? 'snapshot' : 'unavailable';

        return {
          brokerKey,
          brokerName: value.brokerName,
          connectedAccountCount: value.connectedAccountCount,
          snapshotAvailability,
          fundsBalance: {
            value:
              value.fundsAccountsWithSnapshot > 0 ? value.fundsBalanceTotal : null,
            availability: fundsAvailability,
            observedAt: this.formatDisplayTime(value.latestFundsObservedAt, timeZone),
            observedAtIso: this.formatRawIso(value.latestFundsObservedAt),
            sourceLabel: 'Latest funds snapshot',
          },
          openPositions: {
            value:
              value.positionsAccountsWithSnapshot > 0 ? value.openPositionsTotal : null,
            availability: openPositionsAvailability,
            observedAt: this.formatDisplayTime(value.latestPositionsObservedAt, timeZone),
            observedAtIso: this.formatRawIso(value.latestPositionsObservedAt),
            sourceLabel: 'Latest positions snapshot',
          },
          note: this.buildBrokerSnapshotNote(
            snapshotAvailability,
            value.connectedAccountCount,
            value.fundsAccountsWithSnapshot,
            value.positionsAccountsWithSnapshot
          ),
        };
      })
      .sort((left, right) =>
        String(left.brokerName || '').localeCompare(String(right.brokerName || ''))
      );

    const aggregate = Array.from(groupedByBroker.values()).reduce<BrokerCoverageAggregate>(
      (acc, item) => ({
        connectedAccountCount: acc.connectedAccountCount + item.connectedAccountCount,
        fundsAccountsWithSnapshot: acc.fundsAccountsWithSnapshot + item.fundsAccountsWithSnapshot,
        positionsAccountsWithSnapshot:
          acc.positionsAccountsWithSnapshot + item.positionsAccountsWithSnapshot,
        latestFundsObservedAt: this.maxDate(acc.latestFundsObservedAt, item.latestFundsObservedAt),
        latestPositionsObservedAt: this.maxDate(
          acc.latestPositionsObservedAt,
          item.latestPositionsObservedAt
        ),
      }),
      {
        connectedAccountCount: 0,
        fundsAccountsWithSnapshot: 0,
        positionsAccountsWithSnapshot: 0,
        latestFundsObservedAt: null,
        latestPositionsObservedAt: null,
      }
    );

    return {
      items,
      aggregate,
    };
  }

  private buildFreshnessMeta(input: {
    latestRiskSnapshotAt: Date | null;
    latestFundsObservedAt: Date | null;
    latestPositionsObservedAt: Date | null;
    latestControlAt: Date | null;
    latestAlertAt: Date | null;
    latestScenarioAt: Date | null;
    connectedAccountCount: number;
    fundsAccountsWithSnapshot: number;
    positionsAccountsWithSnapshot: number;
  }, timeZone: string): RiskOverviewFreshnessMeta {
    const blockers: RiskOverviewFreshnessMeta['blockers'] = [];
    const freshestSourceAt = this.maxDate(
      input.latestFundsObservedAt,
      input.latestPositionsObservedAt
    );
    const snapshotLagMinutes =
      input.latestRiskSnapshotAt && freshestSourceAt
        ? Math.max(
            0,
            Math.round((freshestSourceAt.getTime() - input.latestRiskSnapshotAt.getTime()) / 60000)
          )
        : null;

    if (!input.latestRiskSnapshotAt) {
      blockers.push('missing_risk_snapshot');
    }
    if (
      input.connectedAccountCount > 0 &&
      input.fundsAccountsWithSnapshot < input.connectedAccountCount
    ) {
      blockers.push('missing_funds_snapshot_coverage');
    }
    if (
      input.connectedAccountCount > 0 &&
      input.positionsAccountsWithSnapshot < input.connectedAccountCount
    ) {
      blockers.push('missing_positions_snapshot_coverage');
    }
    if (
      input.latestRiskSnapshotAt &&
      freshestSourceAt &&
      input.latestRiskSnapshotAt.getTime() + RISK_SNAPSHOT_LAG_TOLERANCE_MS <
        freshestSourceAt.getTime()
    ) {
      blockers.push('risk_snapshot_behind_sources');
    }

    let state: RiskOverviewFreshnessMeta['state'] = 'unavailable';
    if (
      input.latestRiskSnapshotAt &&
      blockers.length === 0 &&
      input.connectedAccountCount > 0
    ) {
      state = 'fresh';
    } else if (blockers.includes('risk_snapshot_behind_sources')) {
      state = 'lagging';
    } else if (
      blockers.includes('missing_funds_snapshot_coverage') ||
      blockers.includes('missing_positions_snapshot_coverage')
    ) {
      state = 'partial';
    } else if (input.latestRiskSnapshotAt) {
      state = 'partial';
    }

    return {
      state,
      blockers,
      connectedAccountCount: input.connectedAccountCount,
      fundsAccountsWithSnapshot: input.fundsAccountsWithSnapshot,
      positionsAccountsWithSnapshot: input.positionsAccountsWithSnapshot,
      latestRiskSnapshotAt: this.formatDisplayTime(input.latestRiskSnapshotAt, timeZone),
      latestRiskSnapshotAtIso: this.formatRawIso(input.latestRiskSnapshotAt),
      latestFundsObservedAt: this.formatDisplayTime(input.latestFundsObservedAt, timeZone),
      latestFundsObservedAtIso: this.formatRawIso(input.latestFundsObservedAt),
      latestPositionsObservedAt: this.formatDisplayTime(input.latestPositionsObservedAt, timeZone),
      latestPositionsObservedAtIso: this.formatRawIso(input.latestPositionsObservedAt),
      latestControlAt: this.formatDisplayTime(input.latestControlAt, timeZone),
      latestControlAtIso: this.formatRawIso(input.latestControlAt),
      latestAlertAt: this.formatDisplayTime(input.latestAlertAt, timeZone),
      latestAlertAtIso: this.formatRawIso(input.latestAlertAt),
      latestScenarioAt: this.formatDisplayTime(input.latestScenarioAt, timeZone),
      latestScenarioAtIso: this.formatRawIso(input.latestScenarioAt),
      snapshotLagMinutes:
        snapshotLagMinutes !== null && snapshotLagMinutes > 0 ? snapshotLagMinutes : null,
    };
  }

  private buildBrokerSnapshotNote(
    availability: RiskBrokerOverviewItem['snapshotAvailability'],
    connectedAccountCount: number,
    fundsAccountsWithSnapshot: number,
    positionsAccountsWithSnapshot: number
  ): string {
    if (availability === 'snapshot') {
      return 'All connected accounts have snapshot-backed funds and positions coverage.';
    }

    if (availability === 'partial') {
      return `Snapshot coverage is partial: funds ${fundsAccountsWithSnapshot}/${connectedAccountCount}, positions ${positionsAccountsWithSnapshot}/${connectedAccountCount}.`;
    }

    return 'No funds or positions snapshots are available for the connected accounts yet.';
  }

  private extractFundsBalance(
    snapshot: FundsSnapshotRow | null
  ): { value: number | null; observedAt: string | null } {
    if (!snapshot) {
      return { value: null, observedAt: null };
    }

    const futuresFunds = this.parseSnapshotJson(snapshot.futures_funds_json);
    const walletFunds = this.parseSnapshotJson(snapshot.wallet_funds_json);

    const brokerKey = String(snapshot.broker_key || '').trim().toLowerCase();
    const value =
      this.extractFundsBalanceValue(futuresFunds, brokerKey) ??
      this.extractFundsBalanceValue(walletFunds, brokerKey);

    return {
      value,
      observedAt: this.toIsoString(
        snapshot.observed_at ?? snapshot.computed_at ?? snapshot.created_at ?? null
      ),
    };
  }

  private extractFundsBalanceValue(
    funds: Record<string, unknown> | null,
    brokerKey?: string
  ): number | null {
    if (!funds) {
      return null;
    }

    const equityLikeBalance = this.toNumber(
      funds.equity ??
        funds.futures_equity ??
        funds.futuresEquity ??
        funds.margin_balance ??
        funds.marginBalance ??
        funds.total_balance ??
        funds.totalBalance ??
        funds.account_equity ??
        funds.accountEquity
    );
    if (equityLikeBalance !== null) {
      return equityLikeBalance;
    }

    const totalBalance = this.toNumber(
      funds.total ?? funds.wallet_balance ?? funds.walletBalance
    );
    if (totalBalance !== null) {
      return totalBalance;
    }

    const balance = this.toNumber(funds.balance);
    const lockedAmount = this.toNumber(funds.locked_amount ?? funds.lockedAmount);
    if (String(brokerKey || '').trim().toLowerCase() === 'mudrex' && balance !== null) {
      return Number((balance + Math.max(0, lockedAmount ?? 0)).toFixed(2));
    }

    return this.toNumber(
      funds.balance ??
        funds.available_balance ??
        funds.availableBalance ??
        funds.free_balance ??
        funds.freeBalance
    );
  }

  private parseSnapshotJson(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private parsePercent(value: unknown): number | null {
    const normalized = String(value || '')
      .trim()
      .replace('%', '');
    if (!normalized) {
      return null;
    }

    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private toNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toIsoString(value: unknown): string | null {
    return this.formatRawIso(this.toDate(value)) || null;
  }

  private maxDate(left: Date | null, right: Date | null): Date | null {
    if (!left) {
      return right;
    }
    if (!right) {
      return left;
    }
    return left.getTime() >= right.getTime() ? left : right;
  }

  private formatDisplayTime(
    value: Date | string | null | undefined,
    timeZone: string
  ): string | null {
    return formatApiDisplayTime(value, timeZone) || null;
  }

  private formatRawIso(value: Date | string | null | undefined): string | null {
    return formatApiRawIso(value) || null;
  }
}
