import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  OVERVIEW_COMMAND_CENTER_CONTRACT_VERSION,
  OverviewCommandCenterAction,
  OverviewCommandCenterCard,
  OverviewCommandCenterItem,
  OverviewCommandCenterResponse,
  OverviewCommandCenterSection,
  OverviewCommandCenterSectionId,
  OverviewCommandCenterSource,
  OverviewCommandCenterSourceType,
  OverviewCommandCenterState,
  OverviewCommandCenterTone,
} from '../contracts/OverviewCommandCenter';
import { OverviewResponse, OverviewSectionKey } from '../contracts/Overview';
import { RiskOverviewResponse } from '../contracts/RiskOverview';
import {
  SuggestedTradeItem,
  SuggestedTradesListResponse,
  SuggestedTradesSummary,
} from '../contracts/SuggestedTrade';
import { env } from '../../env';
import { successResponse } from '../utils/response';
import { OverviewService } from './OverviewService';
import { RiskOverviewService } from './RiskOverviewService';
import { SuggestedTradesService } from './SuggestedTradesService';

interface OverviewCommandCenterQuery {
  selectedSymbol?: string;
  role?: string;
}

interface LoadResult<T> {
  data: T | null;
  error: string | null;
}

interface CommandCenterBuildContext {
  userId: string;
  role: string;
  isAdmin: boolean;
  generatedAt: string;
  selectedSymbol: string | null;
  overview: LoadResult<OverviewResponse>;
  risk: LoadResult<RiskOverviewResponse>;
  suggestedTrades: LoadResult<SuggestedTradesListResponse>;
  suggestedTradesSummary: LoadResult<SuggestedTradesSummary>;
}

const SUGGESTED_TRADES_LIMIT = 5;
const RISK_ALERTS_LIMIT = 5;
const RISK_CONTROLS_LIMIT = 3;

@Service()
export class OverviewCommandCenterService {
  @Inject(() => OverviewService)
  private overviewService!: OverviewService;

  @Inject(() => RiskOverviewService)
  private riskOverviewService!: RiskOverviewService;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  async getCommandCenter(
    userId: string,
    query: OverviewCommandCenterQuery = {}
  ): Promise<ApiSuccessResponse<OverviewCommandCenterResponse>> {
    const generatedAt = new Date().toISOString();
    const role = String(query.role || '').trim();
    const isAdmin = role.toLowerCase() === 'admin';
    const selectedSymbol = this.normalizeOptionalText(query.selectedSymbol);

    const [overview, risk, suggestedTrades, suggestedTradesSummary] = await Promise.all([
      this.loadData('overview', () =>
        this.overviewService.getOverview(userId, {
          selectedSymbol: selectedSymbol ?? undefined,
        })
      ),
      this.loadData('risk overview', () =>
        this.riskOverviewService.getOverview(userId, {
          controlsLimit: String(RISK_CONTROLS_LIMIT),
          controlsOffset: '0',
          alertsLimit: String(RISK_ALERTS_LIMIT),
          alertsOffset: '0',
          scenariosLimit: '0',
          scenariosOffset: '0',
        })
      ),
      this.loadData('suggested trades', () =>
        this.suggestedTradesService.getSuggestedTrades(userId, {
          limit: String(SUGGESTED_TRADES_LIMIT),
          offset: '0',
        })
      ),
      this.loadData('suggested trades summary', () =>
        this.suggestedTradesService.getSuggestedTradesSummary(userId, {})
      ),
    ]);

    const context: CommandCenterBuildContext = {
      userId,
      role,
      isAdmin,
      generatedAt,
      selectedSymbol,
      overview,
      risk,
      suggestedTrades,
      suggestedTradesSummary,
    };

    const actionQueue = this.buildActionQueueSection(context);
    const tradingReadiness = this.buildTradingReadinessSection(context);
    const alertsSnapshot = this.buildAlertsSnapshotSection(context);
    const automationSnapshot = this.buildAutomationSnapshotSection(context);
    const bookSnapshot = this.buildBookSnapshotSection(context);
    const riskSnapshot = this.buildRiskSnapshotSection(context);
    const tradeIdeasSnapshot = this.buildTradeIdeasSnapshotSection(context);
    const brokerDataSnapshot = this.buildBrokerDataSnapshotSection(context);
    const opsSnapshot = this.buildOpsSnapshotSection(context);
    const status = this.buildStatusSection(context, [
      actionQueue,
      tradingReadiness,
      alertsSnapshot,
      automationSnapshot,
      bookSnapshot,
      riskSnapshot,
      tradeIdeasSnapshot,
      brokerDataSnapshot,
      opsSnapshot,
    ]);

    const sections = [
      status,
      actionQueue,
      tradingReadiness,
      alertsSnapshot,
      automationSnapshot,
      bookSnapshot,
      riskSnapshot,
      tradeIdeasSnapshot,
      brokerDataSnapshot,
      opsSnapshot,
    ];
    const visibleSections = sections.filter(
      (section) => section.visibility === 'all' || context.isAdmin
    );
    const redactedSections = sections
      .filter((section) => section.visibility === 'admin' && !context.isAdmin)
      .map((section) => section.id);

    return successResponse({
      meta: {
        contractVersion: OVERVIEW_COMMAND_CENTER_CONTRACT_VERSION,
        purpose: 'operator_command_center',
        generatedAt,
        actor: {
          userId,
          role,
          isAdmin,
        },
        dataPolicy: {
          directBrokerCallsOnLoad: false,
          allowedSourceTypes: [
            'db_snapshot',
            'computed_summary',
            'internal_health',
            'scheduler_output',
            'activity_log',
            'contract',
          ],
          summary:
            'The command center is assembled from database snapshots, scheduler output, computed summaries, and internal health only. It does not make live broker/reference calls during page load.',
        },
        query: {
          supported: ['selectedSymbol'],
          ignored: ['brokerKey', 'accountId', 'liveBrokerProbe'],
          selectedSymbol,
        },
        includedSections: sections.map((section) => section.id),
        redactedSections,
        degradedSections: visibleSections
          .filter((section) => section.state !== 'ok')
          .map((section) => section.id),
        summary:
          'Phase 2 exposes the production overview command-center data contract for the colorful dashboard shell without changing existing overview behavior.',
      },
      status,
      actionQueue,
      tradingReadiness,
      alertsSnapshot,
      automationSnapshot,
      bookSnapshot,
      riskSnapshot,
      tradeIdeasSnapshot,
      brokerDataSnapshot,
      opsSnapshot,
    });
  }

  private buildStatusSection(
    context: CommandCenterBuildContext,
    sections: OverviewCommandCenterSection[]
  ): OverviewCommandCenterSection {
    const visibleSections = sections.filter(
      (section) => section.visibility === 'all' || context.isAdmin
    );
    const blockedCount = visibleSections.filter((section) => section.state === 'blocked').length;
    const attentionCount = visibleSections.filter((section) =>
      ['attention', 'unknown'].includes(section.state)
    ).length;
    const state: OverviewCommandCenterState =
      blockedCount > 0 ? 'blocked' : attentionCount > 0 ? 'attention' : 'ok';
    const topActions = visibleSections
      .filter((section) => ['blocked', 'attention', 'unknown'].includes(section.state))
      .slice(0, 4)
      .map((section) => ({
        id: `status-${section.id}`,
        title: section.title,
        summary: section.summary,
        tone: section.tone,
        target: section.actions[0]?.target,
        actionLabel: section.actions[0]?.label,
      }));

    return this.createSection({
      id: 'status',
      title: 'Command status',
      summary:
        state === 'ok'
          ? 'Everything needed for the overview dashboard is assembled from safe snapshots.'
          : `${blockedCount} blocked area(s) and ${attentionCount} attention area(s) need operator review.`,
      state,
      tone: this.toneForState(state),
      cards: [
        {
          id: 'blocked',
          label: 'Blocked',
          value: blockedCount,
          tone: blockedCount > 0 ? 'red' : 'emerald',
        },
        {
          id: 'attention',
          label: 'Needs attention',
          value: attentionCount,
          tone: attentionCount > 0 ? 'amber' : 'emerald',
        },
        {
          id: 'visibleSections',
          label: 'Visible sections',
          value: visibleSections.length,
          tone: 'blue',
        },
        {
          id: 'directBrokerCalls',
          label: 'Live broker calls',
          value: false,
          valueLabel: 'Off on load',
          tone: 'emerald',
        },
      ],
      items:
        topActions.length > 0
          ? topActions
          : [
              {
                id: 'status-clear',
                title: 'No urgent dashboard blockers',
                summary:
                  'Alerts, automations, risk, trade ideas, and broker snapshots are readable.',
                tone: 'emerald',
              },
            ],
      actions: [
        {
          id: 'refresh',
          label: 'Refresh overview',
          target: '/overview',
          style: 'secondary',
        },
      ],
      lastUpdatedAt: this.latestSectionTimestamp(visibleSections) ?? context.generatedAt,
      source: this.source(
        'computed_summary',
        'Overview command center',
        'Summarizes the section states returned by this endpoint.'
      ),
    });
  }

  private buildActionQueueSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const overview = context.overview.data;
    const risk = context.risk.data;
    const alertsSummary = overview?.alertsSummary;
    const automationDiagnostics = overview?.automationsSummary.diagnostics;
    const items: OverviewCommandCenterItem[] = [];

    for (const alert of overview?.alerts.items ?? []) {
      if (!['Open', 'Acknowledged'].includes(String(alert.status || 'Open'))) {
        continue;
      }
      items.push({
        id: `alert-${alert.id}`,
        title: alert.message || `${alert.severity} alert`,
        summary: `${alert.channel || 'Alert'}${alert.symbol ? ` for ${alert.symbol}` : ''}`,
        meta: alert.time,
        severity: alert.severity,
        tone: alert.severity === 'High' ? 'red' : 'amber',
        target: this.normalizeCommandCenterActionTarget(alert.route || '/alerts'),
        source: alert.source,
        actionLabel: 'Open alert',
      });
    }

    for (const riskAlert of risk?.alerts.items ?? []) {
      items.push({
        id: `risk-${riskAlert.id}`,
        title: riskAlert.message || 'Risk alert',
        summary: `${riskAlert.severity || 'Risk'}${riskAlert.symbol ? ` for ${riskAlert.symbol}` : ''}`,
        meta: riskAlert.createdAtIso || riskAlert.createdAt,
        severity: riskAlert.severity,
        tone: this.isHighSeverity(riskAlert.severity) ? 'red' : 'amber',
        target: '/risk-center',
        source: 'risk_rule_evaluations',
        actionLabel: 'Review risk',
      });
    }

    if (automationDiagnostics?.workerStatus && automationDiagnostics.workerStatus !== 'ok') {
      items.push({
        id: 'automation-worker-health',
        title: 'Automation worker needs attention',
        summary:
          automationDiagnostics.workerDetail ||
          `Worker status is ${automationDiagnostics.workerStatus}.`,
        meta: this.formatDurationMs(automationDiagnostics.workerHeartbeatAgeMs),
        severity: automationDiagnostics.workerStatus,
        tone: automationDiagnostics.workerStatus === 'down' ? 'red' : 'amber',
        target: '/automations',
        source: 'scheduler_worker_heartbeat',
        actionLabel: 'Open automations',
      });
    }

    if (automationDiagnostics && automationDiagnostics.failedRuns24h > 0) {
      items.push({
        id: 'automation-failed-runs',
        title: 'Automation runs failed in the last 24h',
        summary: `${automationDiagnostics.failedRuns24h} failed run(s) need review.`,
        severity: 'warning',
        tone: 'amber',
        target: '/automations',
        source: 'automation_run_logs',
        actionLabel: 'Review runs',
      });
    }

    for (const load of [
      { id: 'overview-load', title: 'Overview snapshot degraded', result: context.overview },
      { id: 'risk-load', title: 'Risk snapshot degraded', result: context.risk },
      {
        id: 'suggested-trades-load',
        title: 'Suggested trades snapshot degraded',
        result: context.suggestedTrades,
      },
      {
        id: 'suggested-trades-summary-load',
        title: 'Suggested trades summary degraded',
        result: context.suggestedTradesSummary,
      },
    ]) {
      if (!load.result.error) {
        continue;
      }
      items.push({
        id: load.id,
        title: load.title,
        summary: load.result.error,
        severity: 'degraded',
        tone: 'amber',
        target: '/overview',
        source: 'command_center_loader',
        actionLabel: 'Refresh',
      });
    }

    const criticalAlerts = this.toFiniteNumber(alertsSummary?.criticalSeverity) ?? 0;
    const openAlerts = this.toFiniteNumber(alertsSummary?.openAlerts) ?? 0;
    const state: OverviewCommandCenterState =
      criticalAlerts > 0 || automationDiagnostics?.workerStatus === 'down'
        ? 'blocked'
        : items.length > 0 || openAlerts > 0
          ? 'attention'
          : 'ok';

    return this.createSection({
      id: 'actionQueue',
      title: 'Action queue',
      summary:
        items.length > 0
          ? `${items.length} operator item(s) are waiting across alerts, risk, and automation health.`
          : 'No urgent operator actions are waiting right now.',
      state,
      tone: this.toneForState(state),
      cards: [
        {
          id: 'openAlerts',
          label: 'Open alerts',
          value: openAlerts,
          tone: openAlerts > 0 ? 'amber' : 'emerald',
        },
        {
          id: 'criticalAlerts',
          label: 'Critical alerts',
          value: criticalAlerts,
          tone: criticalAlerts > 0 ? 'red' : 'emerald',
        },
        {
          id: 'failedRuns24h',
          label: 'Failed runs 24h',
          value: automationDiagnostics?.failedRuns24h ?? 0,
          tone:
            automationDiagnostics && automationDiagnostics.failedRuns24h > 0 ? 'amber' : 'emerald',
        },
      ],
      items: items.slice(0, 6),
      actions: [
        {
          id: 'openAlerts',
          label: 'Open alerts',
          target: '/alerts',
          style: 'secondary',
        },
        {
          id: 'openRisk',
          label: 'Open risk',
          target: '/risk-center',
          style: state === 'blocked' ? 'danger' : 'secondary',
        },
      ],
      lastUpdatedAt: this.latestTimestamp([
        ...(overview?.alerts.items ?? []).map((alert) => alert.updatedAt || alert.time),
        ...(risk?.alerts.items ?? []).map((alert) => alert.createdAtIso || alert.createdAt),
        automationDiagnostics?.lastCursorAt,
      ]),
      source: this.source(
        'computed_summary',
        'Alerts, risk, and scheduler diagnostics',
        'Prioritizes open alerts, risk alerts, scheduler worker state, failed automation runs, and partial source failures.'
      ),
    });
  }

  private buildTradingReadinessSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const overview = context.overview.data;
    const liveAuto = env.suggestedTrades.liveAuto;
    const rolloutEnabled = env.suggestedTrades.rolloutEnabled;
    const userAllowlist = liveAuto.userAllowlist.map((item) => String(item).trim()).filter(Boolean);
    const brokerAllowlist = liveAuto.brokerAllowlist
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
    const routeBroker =
      this.normalizeOptionalText(overview?.meta.routing.brokerKey)?.toLowerCase() ?? null;
    const routeAccount = this.normalizeOptionalText(overview?.meta.routing.accountId);
    const userAllowlisted = userAllowlist.includes(context.userId);
    const brokerAllowlisted = routeBroker ? brokerAllowlist.includes(routeBroker) : false;
    const routeResolved = Boolean(routeBroker && routeAccount);
    const executionArmed = rolloutEnabled && liveAuto.enabled && liveAuto.executionEnabled;
    const liveGuardReady = executionArmed && userAllowlisted && brokerAllowlisted && routeResolved;
    const state: OverviewCommandCenterState = liveGuardReady
      ? 'ok'
      : executionArmed
        ? 'blocked'
        : 'attention';

    const items: OverviewCommandCenterItem[] = [
      {
        id: 'rollout',
        title:
          rolloutEnabled && liveAuto.enabled
            ? 'Live auto rollout is enabled'
            : 'Live auto rollout is not armed',
        summary:
          rolloutEnabled && liveAuto.enabled
            ? 'The environment allows live-auto readiness checks.'
            : 'Live trading cannot run automatically until rollout and live-auto flags are enabled.',
        tone: rolloutEnabled && liveAuto.enabled ? 'emerald' : 'amber',
        source: 'environment',
      },
      {
        id: 'execution',
        title: liveAuto.executionEnabled
          ? 'Live broker execution is enabled'
          : 'Live broker execution is disabled',
        summary: liveAuto.executionEnabled
          ? 'The final broker placement flag is enabled.'
          : 'Suggestions can still be reviewed or paper traded, but live placement remains blocked.',
        tone: liveAuto.executionEnabled ? 'emerald' : 'amber',
        source: 'environment',
      },
      {
        id: 'user-allowlist',
        title: userAllowlisted ? 'User is allowlisted' : 'User is not allowlisted',
        summary: userAllowlisted
          ? 'This user can pass the live-auto user guard.'
          : 'Live auto will block for this user until they are added to the allowlist.',
        tone: userAllowlisted ? 'emerald' : 'red',
        source: 'environment',
      },
      {
        id: 'broker-route',
        title: routeResolved ? 'Broker route resolved' : 'Broker route needs attention',
        summary: routeResolved
          ? `${routeBroker || 'Broker'} / ${routeAccount || 'account'} is available from stored routing.`
          : 'A fixed broker/account route is required before broker-auto can place orders.',
        tone: routeResolved ? 'emerald' : 'red',
        source: 'overview_routing',
      },
    ];

    return this.createSection({
      id: 'tradingReadiness',
      title: 'Trading readiness',
      summary: liveGuardReady
        ? 'Live broker-auto guards are ready for this route.'
        : 'Broker-auto is not fully ready; manual and paper workflows remain safer until guards pass.',
      state,
      tone: this.toneForState(state),
      cards: [
        {
          id: 'rolloutEnabled',
          label: 'Live rollout',
          value: rolloutEnabled && liveAuto.enabled,
          valueLabel: rolloutEnabled && liveAuto.enabled ? 'Enabled' : 'Disabled',
          tone: rolloutEnabled && liveAuto.enabled ? 'emerald' : 'amber',
        },
        {
          id: 'executionEnabled',
          label: 'Broker execution',
          value: liveAuto.executionEnabled,
          valueLabel: liveAuto.executionEnabled ? 'Enabled' : 'Disabled',
          tone: liveAuto.executionEnabled ? 'emerald' : 'amber',
        },
        {
          id: 'userAllowlisted',
          label: 'User allowlist',
          value: userAllowlisted,
          valueLabel: userAllowlisted ? 'Pass' : 'Blocked',
          tone: userAllowlisted ? 'emerald' : 'red',
        },
        {
          id: 'brokerAllowlist',
          label: 'Broker allowlist',
          value: brokerAllowlist.length,
          valueLabel: brokerAllowlisted
            ? `${routeBroker} pass`
            : `${brokerAllowlist.length} broker(s)`,
          tone: brokerAllowlisted ? 'emerald' : 'amber',
        },
      ],
      items,
      actions: [
        {
          id: 'openAutomations',
          label: 'Review automations',
          target: '/automations',
          style: 'secondary',
        },
        {
          id: 'openBrokers',
          label: 'Review brokers',
          target: '/brokers-data',
          style: 'secondary',
        },
      ],
      lastUpdatedAt: context.generatedAt,
      source: this.source(
        'computed_summary',
        'Live-auto guard configuration',
        'Reads environment rollout flags plus snapshot-backed overview routing; no broker placement or broker probe is executed.'
      ),
    });
  }

  private buildAlertsSnapshotSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const overview = context.overview.data;
    const summary = overview?.alertsSummary;
    const openAlerts = this.toFiniteNumber(summary?.openAlerts) ?? 0;
    const highSeverityAlerts = this.toFiniteNumber(summary?.highSeverityAlerts) ?? 0;
    const criticalSeverity = this.toFiniteNumber(summary?.criticalSeverity) ?? 0;
    const state: OverviewCommandCenterState =
      criticalSeverity > 0
        ? 'blocked'
        : highSeverityAlerts > 0 || openAlerts > 0
          ? 'attention'
          : 'ok';

    return this.createSection({
      id: 'alertsSnapshot',
      title: 'Alert snapshot',
      summary:
        openAlerts > 0
          ? `${openAlerts} open alert(s), including ${highSeverityAlerts} high-severity item(s).`
          : 'No open alert pressure in the current snapshot.',
      state: context.overview.error ? 'unknown' : state,
      tone: this.toneForState(context.overview.error ? 'unknown' : state),
      cards: [
        {
          id: 'open',
          label: 'Open',
          value: openAlerts,
          tone: openAlerts > 0 ? 'amber' : 'emerald',
        },
        {
          id: 'high',
          label: 'High severity',
          value: highSeverityAlerts,
          tone: highSeverityAlerts > 0 ? 'red' : 'emerald',
        },
        {
          id: 'acknowledged',
          label: 'Acknowledged',
          value: this.toFiniteNumber(summary?.acknowledged) ?? 0,
          tone: 'blue',
        },
      ],
      items: (overview?.alerts.items ?? []).slice(0, 5).map((alert) => ({
        id: alert.id,
        title: alert.message || `${alert.severity} alert`,
        summary: `${alert.channel || 'Alert'}${alert.symbol ? ` / ${alert.symbol}` : ''}`,
        meta: alert.time,
        severity: alert.severity,
        tone: alert.severity === 'High' ? 'red' : 'amber',
        target: this.normalizeCommandCenterActionTarget(alert.route || '/alerts'),
        source: alert.source,
        actionLabel: 'Open',
      })),
      actions: [
        {
          id: 'openAlerts',
          label: 'Open alert center',
          target: '/alerts',
          style: state === 'blocked' ? 'danger' : 'secondary',
        },
      ],
      lastUpdatedAt: this.latestTimestamp(
        (overview?.alerts.items ?? []).map((alert) => alert.updatedAt || alert.time)
      ),
      source: this.source(
        'db_snapshot',
        'Alerts read model',
        'Uses alert rows and alert summary counters already persisted by the application.'
      ),
    });
  }

  private buildAutomationSnapshotSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const overview = context.overview.data;
    const summary = overview?.automationsSummary;
    const diagnostics = summary?.diagnostics;
    const healthStatus =
      summary?.healthStatus ?? (summary?.health === 'Healthy' ? 'ok' : undefined);
    const state: OverviewCommandCenterState =
      context.overview.error || !summary
        ? 'unknown'
        : healthStatus === 'down' || diagnostics?.queueStatus === 'down'
          ? 'blocked'
          : healthStatus === 'degraded' ||
              diagnostics?.workerStatus === 'degraded' ||
              (diagnostics?.failedRuns24h ?? 0) > 0 ||
              (diagnostics?.staleCursorCount ?? 0) > 0
            ? 'attention'
            : 'ok';

    return this.createSection({
      id: 'automationSnapshot',
      title: 'Automation snapshot',
      summary: summary
        ? `${summary.running} running, ${summary.paused} paused, ${summary.connectedAccounts} connected account route(s).`
        : 'Automation summary is unavailable in this snapshot.',
      state,
      tone: this.toneForState(state),
      cards: [
        {
          id: 'running',
          label: 'Running',
          value: summary?.running ?? 0,
          tone: 'emerald',
        },
        {
          id: 'paused',
          label: 'Paused',
          value: summary?.paused ?? 0,
          tone: summary && summary.paused > 0 ? 'amber' : 'slate',
        },
        {
          id: 'worker',
          label: 'Worker',
          value: diagnostics?.workerStatus ?? healthStatus ?? 'unknown',
          tone: this.toneForHealth(diagnostics?.workerStatus ?? healthStatus),
        },
        {
          id: 'queue',
          label: 'Queue',
          value: diagnostics?.queueStatus ?? 'unknown',
          tone: this.toneForHealth(diagnostics?.queueStatus),
        },
      ],
      items: (overview?.automations.items ?? []).slice(0, 5).map((automation) => ({
        id: automation.id,
        title: automation.name,
        summary: `${automation.status} / ${automation.strategy || automation.automationType || 'automation'}`,
        meta: automation.updatedAt || automation.lastRun,
        severity: automation.status,
        tone:
          automation.status === 'Running'
            ? 'emerald'
            : automation.status === 'Failed'
              ? 'red'
              : 'amber',
        target: '/automations',
        source: 'automations',
        actionLabel: 'Open',
      })),
      actions: [
        {
          id: 'openAutomations',
          label: 'Open automations',
          target: '/automations',
          style: state === 'blocked' ? 'danger' : 'secondary',
        },
      ],
      lastUpdatedAt: this.latestTimestamp([
        ...(overview?.automations.items ?? []).map(
          (automation) => automation.updatedAt || automation.lastRun
        ),
        diagnostics?.lastCursorAt,
        diagnostics?.lastTriggeredSignalAt,
      ]),
      source: this.source(
        'scheduler_output',
        'Automation scheduler output',
        'Uses automation rows, scheduler cursor diagnostics, queue state, and worker heartbeat summaries.'
      ),
    });
  }

  private buildBookSnapshotSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const overview = context.overview.data;
    const portfolio = overview?.portfolioSummary;
    const activeFunds = overview?.activeFunds;
    const portfolioFreshness = this.freshnessStateForOverviewSections(overview, [
      'portfolioSummary',
      'portfolioHoldings',
    ]);
    const state = context.overview.error
      ? 'unknown'
      : this.stateFromFreshness(portfolioFreshness, portfolio ? 'ok' : 'unknown');
    const walletBalance = this.sumActiveFunds(activeFunds?.walletItems, 'balance');
    const futuresBalance = this.sumActiveFunds(activeFunds?.futuresItems, 'balance');
    const visibleCapital = this.nullableSum([walletBalance, futuresBalance]);

    return this.createSection({
      id: 'bookSnapshot',
      title: 'Book snapshot',
      summary: portfolio
        ? `Equity ${this.formatCurrency(portfolio.equity)} with ${portfolio.netExposure} net exposure.`
        : 'Portfolio book snapshot is unavailable.',
      state,
      tone: this.toneForState(state),
      cards: [
        {
          id: 'equity',
          label: 'Equity',
          value: portfolio?.equity ?? null,
          valueLabel: this.formatCurrency(portfolio?.equity ?? null),
          tone: 'blue',
        },
        {
          id: 'dayPnl',
          label: 'Day PnL',
          value: portfolio?.dayPnL ?? null,
          valueLabel: this.formatCurrency(portfolio?.dayPnL ?? null),
          tone:
            this.toFiniteNumber(portfolio?.dayPnL) && (portfolio?.dayPnL ?? 0) < 0
              ? 'red'
              : 'emerald',
        },
        {
          id: 'visibleCapital',
          label: 'Visible capital',
          value: visibleCapital,
          valueLabel: this.formatCurrency(visibleCapital),
          tone: 'cyan',
        },
        {
          id: 'holdings',
          label: 'Holdings',
          value: overview?.portfolioHoldings.total ?? 0,
          tone: 'violet',
        },
      ],
      items: (overview?.portfolioHoldings.items ?? []).slice(0, 5).map((holding) => ({
        id: holding.id,
        title: holding.symbol,
        summary: `${holding.side} / ${holding.strategy}`,
        meta: `${holding.allocationPct}% allocation`,
        severity: holding.riskState,
        tone:
          holding.riskState === 'At risk'
            ? 'red'
            : holding.riskState === 'Watch'
              ? 'amber'
              : 'emerald',
        target: '/portfolio',
        source: 'portfolio_snapshots',
        actionLabel: 'Open portfolio',
      })),
      actions: [
        {
          id: 'openPortfolio',
          label: 'Open portfolio',
          target: '/portfolio',
          style: 'secondary',
        },
      ],
      lastUpdatedAt: this.latestTimestamp([
        portfolio?.observedAtIso,
        portfolio?.observedAt,
        overview?.portfolioHoldings.observedAtIso,
        overview?.portfolioHoldings.observedAt,
        activeFunds?.latestObservedAtIso,
        activeFunds?.latestObservedAt,
        overview?.meta.sections.portfolioSummary.observedAt,
      ]),
      source: this.source(
        'db_snapshot',
        'Portfolio and funds snapshots',
        'Uses portfolio summaries, holdings, and stored funds snapshots. No broker refresh is triggered.'
      ),
    });
  }

  private buildRiskSnapshotSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const risk = context.risk.data;
    const summary = risk?.summary;
    const breachedRules = this.toFiniteNumber(summary?.breachedRules) ?? 0;
    const liquidationWatch = this.toFiniteNumber(summary?.liquidationWatch) ?? 0;
    const alertTotal = risk?.alerts.total ?? 0;
    const freshnessState = risk?.meta.freshness.state;
    const state: OverviewCommandCenterState =
      context.risk.error || !risk
        ? 'unknown'
        : breachedRules > 0 || liquidationWatch > 0
          ? 'blocked'
          : alertTotal > 0 || freshnessState !== 'fresh'
            ? 'attention'
            : 'ok';

    return this.createSection({
      id: 'riskSnapshot',
      title: 'Risk snapshot',
      summary: summary
        ? `${summary.portfolioRisk} risk posture with ${breachedRules} breached rule(s).`
        : context.risk.error || 'Risk snapshot is unavailable.',
      state,
      tone: this.toneForState(state),
      cards: [
        {
          id: 'portfolioRisk',
          label: 'Portfolio risk',
          value: summary?.portfolioRisk ?? 'unknown',
          tone: state === 'blocked' ? 'red' : state === 'attention' ? 'amber' : 'emerald',
        },
        {
          id: 'breachedRules',
          label: 'Breached rules',
          value: breachedRules,
          tone: breachedRules > 0 ? 'red' : 'emerald',
        },
        {
          id: 'capitalAtRisk',
          label: 'Capital at risk',
          value: summary?.capitalAtRisk ?? null,
          valueLabel: this.formatCurrency(summary?.capitalAtRisk ?? null),
          tone: 'amber',
        },
        {
          id: 'freshness',
          label: 'Freshness',
          value: freshnessState ?? 'unknown',
          tone: freshnessState === 'fresh' ? 'emerald' : 'amber',
        },
      ],
      items:
        risk?.alerts.items.slice(0, 5).map((alert) => ({
          id: alert.id,
          title: alert.message,
          summary: `${alert.severity}${alert.symbol ? ` / ${alert.symbol}` : ''}`,
          meta: alert.createdAtIso || alert.createdAt,
          severity: alert.severity,
          tone: this.isHighSeverity(alert.severity) ? 'red' : 'amber',
          target: '/risk-center',
          source: 'risk_rule_evaluations',
          actionLabel: 'Open risk',
        })) ?? [],
      actions: [
        {
          id: 'openRisk',
          label: 'Open risk center',
          target: '/risk-center',
          style: state === 'blocked' ? 'danger' : 'secondary',
        },
      ],
      lastUpdatedAt: this.latestTimestamp([
        risk?.meta.generatedAtIso,
        risk?.meta.freshness.latestRiskSnapshotAtIso,
        risk?.meta.freshness.latestAlertAtIso,
        risk?.summary.fundsObservedAtIso,
        risk?.summary.positionsObservedAtIso,
      ]),
      source: this.source(
        'db_snapshot',
        'Risk overview snapshots',
        'Uses normalized risk snapshots, risk rule evaluations, and persisted broker coverage.'
      ),
    });
  }

  private buildTradeIdeasSnapshotSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const overview = context.overview.data;
    const summary = context.suggestedTradesSummary.data;
    const list = context.suggestedTrades.data;
    const signalsSummary = overview?.signalsSummary;
    const workingCount =
      (this.toFiniteNumber(summary?.queued) ?? 0) +
      (this.toFiniteNumber(summary?.submitting) ?? 0) +
      (this.toFiniteNumber(summary?.linked) ?? 0) +
      (this.toFiniteNumber(summary?.working) ?? 0);
    const sourceFailed = Boolean(
      context.suggestedTrades.error || context.suggestedTradesSummary.error
    );
    const state: OverviewCommandCenterState =
      sourceFailed && !overview ? 'unknown' : sourceFailed ? 'attention' : 'ok';

    return this.createSection({
      id: 'tradeIdeasSnapshot',
      title: 'Trade ideas snapshot',
      summary: summary
        ? `${summary.open} open idea(s), ${summary.actionable} actionable, ${workingCount} already in execution tracking.`
        : 'Trade ideas are represented by the latest signals and suggested-trade summaries.',
      state,
      tone: this.toneForState(state),
      cards: [
        {
          id: 'liveSignals',
          label: 'Signals',
          value: signalsSummary?.liveSignals ?? 0,
          tone: 'cyan',
        },
        {
          id: 'suggestedOpen',
          label: 'Open ideas',
          value: summary?.open ?? 0,
          tone: 'blue',
        },
        {
          id: 'actionable',
          label: 'Actionable',
          value: summary?.actionable ?? 0,
          tone: summary && summary.actionable > 0 ? 'amber' : 'emerald',
        },
        {
          id: 'working',
          label: 'In execution',
          value: workingCount,
          tone: workingCount > 0 ? 'violet' : 'slate',
        },
      ],
      items: this.buildTradeIdeaItems(list?.items ?? [], overview),
      actions: [
        {
          id: 'openTradeIdeas',
          label: 'Open trade ideas',
          target: '/suggested-trades',
          style: 'secondary',
        },
      ],
      lastUpdatedAt: this.latestTimestamp([
        ...(list?.items ?? []).map((item) => item.updatedAt || item.createdAt),
        ...(overview?.signals.items ?? []).map((signal) => signal.updatedAt || signal.createdAt),
      ]),
      source: this.source(
        'computed_summary',
        'Signals and suggested trades',
        'Combines signal summary counters with suggested-trade read models and execution sync state.'
      ),
    });
  }

  private buildBrokerDataSnapshotSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const overview = context.overview.data;
    const activeFunds = overview?.activeFunds;
    const accountKeys = new Set<string>();
    for (const item of [
      ...(activeFunds?.walletItems ?? []),
      ...(activeFunds?.futuresItems ?? []),
    ]) {
      accountKeys.add(`${item.brokerKey}:${item.accountId}`);
    }
    const freshnessStates = this.freshnessStateForOverviewSections(overview, [
      'activeFunds',
      'walletFunds',
      'futuresFunds',
    ]);
    const state = context.overview.error
      ? 'unknown'
      : this.stateFromFreshness(freshnessStates, accountKeys.size > 0 ? 'ok' : 'attention');
    const walletBalance = this.sumActiveFunds(activeFunds?.walletItems, 'balance');
    const futuresBalance = this.sumActiveFunds(activeFunds?.futuresItems, 'balance');

    return this.createSection({
      id: 'brokerDataSnapshot',
      title: 'Broker data snapshot',
      summary:
        accountKeys.size > 0
          ? `${accountKeys.size} broker account route(s) have visible stored funds data.`
          : 'No stored broker-account funds snapshot is visible yet.',
      state,
      tone: this.toneForState(state),
      cards: [
        {
          id: 'accounts',
          label: 'Snapshot accounts',
          value: accountKeys.size,
          tone: accountKeys.size > 0 ? 'emerald' : 'amber',
        },
        {
          id: 'walletBalance',
          label: 'Wallet',
          value: walletBalance,
          valueLabel: this.formatCurrency(walletBalance),
          tone: 'blue',
        },
        {
          id: 'futuresBalance',
          label: 'Futures',
          value: futuresBalance,
          valueLabel: this.formatCurrency(futuresBalance),
          tone: 'cyan',
        },
        {
          id: 'route',
          label: 'Default route',
          value: overview?.meta.routing.brokerKey ?? 'unknown',
          valueLabel: overview?.meta.routing.accountId ?? 'No account',
          tone: overview?.meta.routing.accountId ? 'emerald' : 'amber',
        },
      ],
      items: [...(activeFunds?.walletItems ?? []), ...(activeFunds?.futuresItems ?? [])]
        .slice(0, 6)
        .map((item) => ({
          id: `${item.brokerKey}-${item.accountId}-${item.accountKey}`,
          title: item.accountName || item.accountKey,
          summary: `${item.brokerKey} / ${item.status}`,
          meta: item.observedAtIso || item.observedAt || undefined,
          severity: item.error ? 'error' : item.status,
          tone: item.error ? 'red' : item.status === 'Connected' ? 'emerald' : 'amber',
          target: '/brokers-data',
          source: 'funds_snapshots',
          actionLabel: 'Open broker',
        })),
      actions: [
        {
          id: 'openBrokers',
          label: 'Open brokers',
          target: '/brokers-data',
          style: state === 'blocked' ? 'danger' : 'secondary',
        },
      ],
      lastUpdatedAt: this.latestTimestamp([
        activeFunds?.latestObservedAtIso,
        activeFunds?.latestObservedAt,
        activeFunds?.oldestObservedAtIso,
        activeFunds?.oldestObservedAt,
        overview?.meta.sections.activeFunds.observedAt,
      ]),
      source: this.source(
        'db_snapshot',
        'Funds snapshots and routing',
        'Shows the stored broker/account route and latest persisted wallet/futures funds snapshots.'
      ),
    });
  }

  private buildOpsSnapshotSection(
    context: CommandCenterBuildContext
  ): OverviewCommandCenterSection {
    const diagnostics = context.overview.data?.automationsSummary.diagnostics;
    if (!context.isAdmin) {
      return this.createSection({
        id: 'opsSnapshot',
        title: 'Ops snapshot',
        summary: 'Admin-only runtime details are hidden for this user.',
        state: 'unknown',
        tone: 'slate',
        visibility: 'admin',
        cards: [],
        items: [],
        actions: [],
        lastUpdatedAt: null,
        source: this.source(
          'contract',
          'Role-gated ops snapshot',
          'The section is part of the command-center contract but only returns runtime detail for admin users.'
        ),
      });
    }

    const state: OverviewCommandCenterState = !diagnostics
      ? 'unknown'
      : diagnostics.workerStatus === 'down' || diagnostics.queueStatus === 'down'
        ? 'blocked'
        : diagnostics.workerStatus === 'degraded' ||
            diagnostics.failedRuns24h > 0 ||
            diagnostics.staleCursorCount > 0
          ? 'attention'
          : 'ok';

    return this.createSection({
      id: 'opsSnapshot',
      title: 'Ops snapshot',
      summary: diagnostics
        ? `Worker ${diagnostics.workerStatus}, queue ${diagnostics.queueStatus}, ${diagnostics.activeRuns} active run(s).`
        : 'Runtime diagnostics are unavailable in this snapshot.',
      state,
      tone: this.toneForState(state),
      visibility: 'admin',
      cards: [
        {
          id: 'worker',
          label: 'Worker',
          value: diagnostics?.workerStatus ?? 'unknown',
          tone: this.toneForHealth(diagnostics?.workerStatus),
        },
        {
          id: 'queue',
          label: 'Queue',
          value: diagnostics?.queueStatus ?? 'unknown',
          tone: this.toneForHealth(diagnostics?.queueStatus),
        },
        {
          id: 'activeRuns',
          label: 'Active runs',
          value: diagnostics?.activeRuns ?? 0,
          tone: diagnostics && diagnostics.activeRuns > 0 ? 'blue' : 'slate',
        },
        {
          id: 'pollLag',
          label: 'Poll lag',
          value: diagnostics?.commandPollLagMs ?? null,
          valueLabel: this.formatDurationMs(diagnostics?.commandPollLagMs),
          tone: diagnostics?.queueStatus === 'ok' ? 'emerald' : 'amber',
        },
      ],
      items: diagnostics
        ? [
            {
              id: 'worker-heartbeat',
              title: 'Worker heartbeat',
              summary:
                diagnostics.workerDetail ||
                `Heartbeat status ${diagnostics.heartbeatStatus ?? 'unknown'}.`,
              meta: this.formatDurationMs(diagnostics.workerHeartbeatAgeMs),
              tone: this.toneForHealth(diagnostics.heartbeatStatus),
              target: '/automations',
              source: 'scheduler_worker_heartbeat',
            },
            {
              id: 'cursor-health',
              title: 'Cursor health',
              summary: `${diagnostics.staleCursorCount} stale cursor(s) out of ${diagnostics.totalCursorCount}.`,
              meta: diagnostics.lastCursorAt ?? undefined,
              tone: diagnostics.staleCursorCount > 0 ? 'amber' : 'emerald',
              target: '/automations',
              source: 'scheduler_cursors',
            },
          ]
        : [],
      actions: [
        {
          id: 'openAutomations',
          label: 'Open automations',
          target: '/automations',
          style: state === 'blocked' ? 'danger' : 'secondary',
        },
      ],
      lastUpdatedAt: this.latestTimestamp([
        diagnostics?.lastCursorAt,
        diagnostics?.lastTriggeredSignalAt,
      ]),
      source: this.source(
        'internal_health',
        'Runtime scheduler diagnostics',
        'Admin-only worker, queue, heartbeat, active-run, and cursor health summary.'
      ),
    });
  }

  private buildTradeIdeaItems(
    suggestedTrades: SuggestedTradeItem[],
    overview: OverviewResponse | null
  ): OverviewCommandCenterItem[] {
    if (suggestedTrades.length > 0) {
      return suggestedTrades.slice(0, 5).map((trade) => ({
        id: trade.id,
        title: `${trade.symbol} ${trade.side}`,
        summary: `${trade.timeframe} / ${trade.statusDisplay || trade.status}`,
        meta: trade.updatedAt || trade.createdAt,
        severity: trade.executionStage,
        tone: this.toneForSuggestedTrade(trade),
        target: '/suggested-trades',
        source: 'suggested_trades',
        actionLabel: 'Open idea',
      }));
    }

    return (overview?.signals.items ?? []).slice(0, 5).map((signal) => ({
      id: signal.id,
      title: `${signal.symbol} ${signal.direction}`,
      summary: `${signal.status} / ${signal.timeframe}`,
      meta: signal.updatedAt || signal.createdAt,
      severity: signal.status,
      tone: signal.status === 'Triggered' ? 'amber' : 'blue',
      target: '/suggested-trades',
      source: 'signals',
      actionLabel: 'Open signal',
    }));
  }

  private createSection(input: {
    id: OverviewCommandCenterSectionId;
    title: string;
    summary: string;
    state: OverviewCommandCenterState;
    tone: OverviewCommandCenterTone;
    cards: OverviewCommandCenterCard[];
    items: OverviewCommandCenterItem[];
    actions: OverviewCommandCenterAction[];
    lastUpdatedAt: string | null;
    source: OverviewCommandCenterSource;
    visibility?: 'all' | 'admin';
  }): OverviewCommandCenterSection {
    return {
      visibility: 'all',
      ...input,
    };
  }

  private async loadData<T>(
    label: string,
    run: () => Promise<ApiSuccessResponse<T>>
  ): Promise<LoadResult<T>> {
    try {
      const response = await run();
      return { data: response.data, error: null };
    } catch (error) {
      return {
        data: null,
        error: `${label}: ${this.errorMessage(error)}`,
      };
    }
  }

  private source(
    type: OverviewCommandCenterSourceType,
    label: string,
    detail: string
  ): OverviewCommandCenterSource {
    return { type, label, detail };
  }

  private toneForState(state: OverviewCommandCenterState): OverviewCommandCenterTone {
    if (state === 'ok') {
      return 'emerald';
    }
    if (state === 'blocked') {
      return 'red';
    }
    if (state === 'attention') {
      return 'amber';
    }
    if (state === 'loading') {
      return 'blue';
    }
    return 'slate';
  }

  private toneForHealth(value: string | undefined | null): OverviewCommandCenterTone {
    if (value === 'ok' || value === 'Healthy') {
      return 'emerald';
    }
    if (value === 'down' || value === 'Failed') {
      return 'red';
    }
    if (value === 'degraded') {
      return 'amber';
    }
    return 'slate';
  }

  private toneForSuggestedTrade(trade: SuggestedTradeItem): OverviewCommandCenterTone {
    const state = trade.executionStage || trade.execution?.executionState || trade.status;
    if (['rejected', 'failed', 'expired', 'Dismissed'].includes(String(state))) {
      return 'red';
    }
    if (['queued', 'submitting', 'working', 'linked', 'Accepted'].includes(String(state))) {
      return 'violet';
    }
    if (trade.status === 'Open') {
      return 'amber';
    }
    return 'blue';
  }

  private stateFromFreshness(
    states: string[],
    defaultState: OverviewCommandCenterState
  ): OverviewCommandCenterState {
    if (!states.length) {
      return defaultState;
    }
    if (states.includes('critical') || states.includes('unavailable')) {
      return 'blocked';
    }
    if (states.includes('stale') || states.includes('unknown') || states.includes('partial')) {
      return 'attention';
    }
    return 'ok';
  }

  private freshnessStateForOverviewSections(
    overview: OverviewResponse | null,
    keys: OverviewSectionKey[]
  ): string[] {
    if (!overview) {
      return [];
    }
    return keys.reduce<string[]>((states, key) => {
      const state = overview.meta.sections[key]?.freshness?.state;
      if (state) {
        states.push(state);
      }
      return states;
    }, []);
  }

  private latestSectionTimestamp(sections: OverviewCommandCenterSection[]): string | null {
    return this.latestTimestamp(sections.map((section) => section.lastUpdatedAt));
  }

  private latestTimestamp(values: Array<string | null | undefined>): string | null {
    let latest: { raw: string; time: number } | null = null;
    for (const value of values) {
      const normalized = this.normalizeOptionalText(value);
      if (!normalized) {
        continue;
      }
      const time = Date.parse(normalized);
      if (Number.isNaN(time)) {
        continue;
      }
      if (!latest || time > latest.time) {
        latest = { raw: normalized, time };
      }
    }
    return latest?.raw ?? null;
  }

  private sumActiveFunds(
    items: OverviewResponse['activeFunds']['walletItems'] | undefined,
    key: 'balance' | 'available' | 'invested'
  ): number | null {
    if (!items || items.length === 0) {
      return null;
    }
    const values = items
      .map((item) => this.toFiniteNumber(item.funds[key]))
      .filter((value): value is number => value !== null);
    if (!values.length) {
      return null;
    }
    return values.reduce((total, value) => total + value, 0);
  }

  private nullableSum(values: Array<number | null>): number | null {
    const present = values.filter((value): value is number => value !== null);
    if (!present.length) {
      return null;
    }
    return present.reduce((total, value) => total + value, 0);
  }

  private toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private formatCurrency(value: unknown): string {
    const numberValue = this.toFiniteNumber(value);
    if (numberValue === null) {
      return '--';
    }
    const sign = numberValue < 0 ? '-' : '';
    return `${sign}$${Math.abs(numberValue).toLocaleString('en-US', {
      maximumFractionDigits: 2,
    })}`;
  }

  private formatDurationMs(value: unknown): string | undefined {
    const ms = this.toFiniteNumber(value);
    if (ms === null) {
      return undefined;
    }
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    if (ms < 60_000) {
      return `${Math.round(ms / 1000)}s`;
    }
    return `${Math.round(ms / 60_000)}m`;
  }

  private isHighSeverity(value: unknown): boolean {
    return ['critical', 'high', 'blocked'].includes(
      String(value || '')
        .trim()
        .toLowerCase()
    );
  }

  private normalizeCommandCenterActionTarget(value: unknown): string {
    const raw = String(value ?? '').trim();
    const normalized = raw.toLowerCase();
    const aliases: Record<string, string> = {
      risk: '/risk-center',
      '/risk': '/risk-center',
      brokers: '/brokers-data',
      broker: '/brokers-data',
      '/brokers': '/brokers-data',
      'trade-ideas': '/suggested-trades',
      '/trade-ideas': '/suggested-trades',
      signals: '/suggested-trades?tab=signals',
      orders: '/orders',
      automations: '/automations',
      alerts: '/alerts',
    };

    if (aliases[normalized]) {
      return aliases[normalized];
    }

    if (raw.startsWith('/') && !raw.startsWith('//')) {
      return raw;
    }

    return '/alerts';
  }

  private normalizeOptionalText(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
