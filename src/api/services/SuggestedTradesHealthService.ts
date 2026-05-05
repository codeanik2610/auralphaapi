import { Inject, Service } from 'typedi';
import { ActivityRepository } from '../../database/repositories/ActivityRepository';
import { AlertRepository } from '../../database/repositories/AlertRepository';
import { AutomationRunOutputRepository } from '../../database/repositories/AutomationRunOutputRepository';
import { SuggestedTradeRepository } from '../../database/repositories/SuggestedTradeRepository';
import { SuggestedTradesFreshnessAudit } from '../contracts/SuggestedTrade';
import { env } from '../../env';
import { SuggestedTradeExecutionSyncService } from './SuggestedTradeExecutionSyncService';
import { SuggestedTradesOverviewService } from './SuggestedTradesOverviewService';
import { SuggestedTradesService } from './SuggestedTradesService';

const HEALTH_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PROTECTION_MANUAL_RECOVERY_STALE_MS = 10 * 60 * 1000;
const PROTECTION_ATTACHING_STALE_MS =
  Math.max(1, Number(process.env.SUGGESTED_TRADES_PROTECTION_ATTACHING_STALE_MINUTES || 10)) *
  60 *
  1000;

export interface SuggestedTradesHealthSnapshot {
  status: 'ok' | 'degraded' | 'down' | 'disabled';
  timestamp: string;
  rolloutEnabled: boolean;
  rolloutStage: string;
  backgroundSyncEnabled: boolean;
  syncState: 'healthy' | 'attention' | 'running' | 'paused';
  syncLabel: string;
  syncSummary: string;
  trackedTrades: number;
  staleTrackedTrades: number;
  terminalTrackedTrades: number;
  totalSuggestedTrades: number;
  openSuggestions: number;
  reviewedSuggestions: number;
  acceptedSuggestions: number;
  dismissedSuggestions: number;
  readyForOrderCount: number;
  convertedToOrderCount: number;
  queuedSuggestions: number;
  submittingSuggestions: number;
  linkedSuggestions: number;
  workingSuggestions: number;
  filledSuggestions: number;
  closedSuggestions: number;
  queueToOrderConversionRate: number | null;
  protectionTrackedTrades: number;
  protectionPendingTrades: number;
  protectionWaitingForFillTrades: number;
  protectionWaitingForPositionTrades: number;
  protectionAttachingTrades: number;
  protectionAttachedTrades: number;
  protectionFailedTrades: number;
  protectionManualActionTrades: number;
  protectionStaleManualActionTrades: number;
  protectionManualRecoveryStaleAfterMs: number;
  protectionStaleAttachingTrades: number;
  protectionAttachingStaleAfterMs: number;
  protectionNotRequiredTrades: number;
  protectionUnknownTrades: number;
  protectionActionableTrades: number;
  protectionUnresolvedTrades: number;
  protectionRetriableFailedTrades: number;
  protectionAttachmentRate: number | null;
  protectionLastCheckedAt: string | null;
  protectionLastAttachedAt: string | null;
  protectionLastManualActionAt: string | null;
  queueToOrderSuccess24h: number;
  summaryRuns24h: number;
  suggestedTradesCreated24h: number;
  duplicateSuggestions24h: number;
  refreshFailures24h: number;
  stateTransitionFailures24h: number;
  openAlerts: number;
  openActionAlerts: number;
  openExecutionAlerts: number;
  probeUserId: string | null;
  overviewLatencyMs: number | null;
  listLatencyMs: number | null;
  summaryLatencyMs: number | null;
  syncStatusLatencyMs: number | null;
  latencyProbeError?: string | null;
  freshnessAudit?: SuggestedTradesFreshnessAudit;
  detail?: string;
}

@Service()
export class SuggestedTradesHealthService {
  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => SuggestedTradeExecutionSyncService)
  private suggestedTradeExecutionSyncService!: SuggestedTradeExecutionSyncService;

  @Inject(() => AutomationRunOutputRepository)
  private automationRunOutputRepository!: AutomationRunOutputRepository;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => SuggestedTradesOverviewService)
  private suggestedTradesOverviewService!: SuggestedTradesOverviewService;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  async getOperationalSnapshot(
    options: {
      probeUserId?: string | null;
    } = {}
  ): Promise<SuggestedTradesHealthSnapshot> {
    const createdAfter = new Date(Date.now() - HEALTH_LOOKBACK_MS);
    const protectionManualRecoveryStaleBefore = new Date(
      Date.now() - PROTECTION_MANUAL_RECOVERY_STALE_MS
    );
    const protectionAttachingStaleBefore = new Date(Date.now() - PROTECTION_ATTACHING_STALE_MS);
    const normalizedProbeUserId = this.normalizeOptionalText(options.probeUserId);

    const [
      operationalSnapshot,
      syncStatus,
      generationMetrics,
      alertMetrics,
      refreshFailures24h,
      stateTransitionFailures24h,
      queueToOrderSuccess24h,
      protectionSnapshot,
      freshnessAudit,
      latencyProbe,
    ] = await Promise.all([
      this.suggestedTradeRepository.getOperationalSnapshot(),
      this.suggestedTradeExecutionSyncService.getOperationalStatus(),
      this.automationRunOutputRepository.getSuggestedTradeGenerationMetrics(createdAfter),
      this.readAlertMetrics(),
      this.activityRepository.countOperationalActivities({
        type: 'Suggested Trade',
        route: 'Suggested Trades',
        stream: 'Execution',
        status: 'Failed',
        createdAfter,
      }),
      this.activityRepository.countOperationalActivities({
        type: 'Suggested Trade',
        route: 'Suggested Trades',
        stream: 'Review',
        status: 'Failed',
        createdAfter,
      }),
      this.activityRepository.countOperationalActivities({
        type: 'Suggested Trade',
        route: 'Orders',
        stream: 'Execution',
        status: 'Success',
        titleLike: 'routed to orders',
        createdAfter,
      }),
      this.suggestedTradeRepository.getProtectionOperationalSnapshot(
        protectionManualRecoveryStaleBefore,
        protectionAttachingStaleBefore
      ),
      this.suggestedTradesService.getSuggestedTradesFreshnessAudit({
        lookbackDays: 7,
      }),
      this.runLatencyProbe(normalizedProbeUserId),
    ]);

    const detailParts: string[] = [];
    if (!env.suggestedTrades.rolloutEnabled) {
      detailParts.push('Suggested trades rollout is disabled.');
    }
    if (syncStatus.state === 'attention' || syncStatus.state === 'paused') {
      detailParts.push(syncStatus.summary);
    }
    if (refreshFailures24h > 0) {
      detailParts.push(
        `${refreshFailures24h} execution refresh failure${refreshFailures24h === 1 ? '' : 's'} recorded in the last 24h.`
      );
    }
    if (stateTransitionFailures24h > 0) {
      detailParts.push(
        `${stateTransitionFailures24h} state transition failure${stateTransitionFailures24h === 1 ? '' : 's'} recorded in the last 24h.`
      );
    }
    if (alertMetrics.openAlerts > 0) {
      detailParts.push(
        `${alertMetrics.openAlerts} open Suggested Trades alert${alertMetrics.openAlerts === 1 ? '' : 's'} remain in the inbox.`
      );
    }
    if (protectionSnapshot.failed > 0) {
      detailParts.push(
        `${protectionSnapshot.failed} live protection remediation failure${protectionSnapshot.failed === 1 ? '' : 's'} remain.`
      );
    }
    if (protectionSnapshot.manualUnlinked > 0) {
      detailParts.push(
        `${protectionSnapshot.manualUnlinked} live position${protectionSnapshot.manualUnlinked === 1 ? '' : 's'} need manual SL/TP protection action.`
      );
    }
    if (protectionSnapshot.staleManualUnlinked > 0) {
      detailParts.push(
        `${protectionSnapshot.staleManualUnlinked} manual SL/TP protection recovery check${protectionSnapshot.staleManualUnlinked === 1 ? '' : 's'} are stale.`
      );
    }
    if (protectionSnapshot.staleAttaching > 0) {
      detailParts.push(
        `${protectionSnapshot.staleAttaching} live protection replacement submission${protectionSnapshot.staleAttaching === 1 ? '' : 's'} are stuck waiting for active order snapshots.`
      );
    }
    if (protectionSnapshot.unresolved > 0) {
      detailParts.push(
        `${protectionSnapshot.unresolved} live protection state${protectionSnapshot.unresolved === 1 ? '' : 's'} remain unresolved.`
      );
    }
    if (latencyProbe.latencyProbeError) {
      detailParts.push(`Latency probe failed: ${latencyProbe.latencyProbeError}`);
    }

    const protectionAttachmentDenominator =
      protectionSnapshot.attached +
      protectionSnapshot.failed +
      protectionSnapshot.manualUnlinked +
      protectionSnapshot.pending +
      protectionSnapshot.waitingForFill +
      protectionSnapshot.waitingForPosition +
      protectionSnapshot.attaching;
    const protectionAttachmentRate =
      protectionAttachmentDenominator > 0
        ? Number((protectionSnapshot.attached / protectionAttachmentDenominator).toFixed(4))
        : null;
    const degraded =
      env.suggestedTrades.rolloutEnabled &&
      (syncStatus.state === 'attention' ||
        syncStatus.state === 'paused' ||
        refreshFailures24h > 0 ||
        stateTransitionFailures24h > 0 ||
        alertMetrics.openAlerts > 0 ||
        protectionSnapshot.failed > 0 ||
        protectionSnapshot.manualUnlinked > 0 ||
        protectionSnapshot.staleManualUnlinked > 0 ||
        protectionSnapshot.staleAttaching > 0 ||
        protectionSnapshot.unresolved > 0 ||
        Boolean(latencyProbe.latencyProbeError));

    return {
      status: !env.suggestedTrades.rolloutEnabled ? 'disabled' : degraded ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      rolloutEnabled: env.suggestedTrades.rolloutEnabled,
      rolloutStage: env.suggestedTrades.rolloutStage,
      backgroundSyncEnabled: env.suggestedTradesSync.backgroundEnabled,
      syncState: syncStatus.state,
      syncLabel: syncStatus.label,
      syncSummary: syncStatus.summary,
      trackedTrades: syncStatus.tracked,
      staleTrackedTrades: syncStatus.stale,
      terminalTrackedTrades: syncStatus.terminal,
      totalSuggestedTrades: operationalSnapshot.total,
      openSuggestions: operationalSnapshot.open,
      reviewedSuggestions: operationalSnapshot.reviewed,
      acceptedSuggestions: operationalSnapshot.accepted,
      dismissedSuggestions: operationalSnapshot.dismissed,
      readyForOrderCount: operationalSnapshot.queuedForOrder,
      convertedToOrderCount: operationalSnapshot.convertedToOrder,
      queuedSuggestions: operationalSnapshot.queued,
      submittingSuggestions: operationalSnapshot.submitting,
      linkedSuggestions: operationalSnapshot.linked,
      workingSuggestions: operationalSnapshot.working,
      filledSuggestions: operationalSnapshot.filled,
      closedSuggestions: operationalSnapshot.closed,
      queueToOrderConversionRate: operationalSnapshot.queueToOrderConversionRate,
      protectionTrackedTrades: protectionSnapshot.tracked,
      protectionPendingTrades: protectionSnapshot.pending,
      protectionWaitingForFillTrades: protectionSnapshot.waitingForFill,
      protectionWaitingForPositionTrades: protectionSnapshot.waitingForPosition,
      protectionAttachingTrades: protectionSnapshot.attaching,
      protectionAttachedTrades: protectionSnapshot.attached,
      protectionFailedTrades: protectionSnapshot.failed,
      protectionManualActionTrades: protectionSnapshot.manualUnlinked,
      protectionStaleManualActionTrades: protectionSnapshot.staleManualUnlinked,
      protectionManualRecoveryStaleAfterMs: PROTECTION_MANUAL_RECOVERY_STALE_MS,
      protectionStaleAttachingTrades: protectionSnapshot.staleAttaching,
      protectionAttachingStaleAfterMs: PROTECTION_ATTACHING_STALE_MS,
      protectionNotRequiredTrades: protectionSnapshot.notRequired,
      protectionUnknownTrades: protectionSnapshot.unknown,
      protectionActionableTrades: protectionSnapshot.actionable,
      protectionUnresolvedTrades: protectionSnapshot.unresolved,
      protectionRetriableFailedTrades: protectionSnapshot.retriableFailed,
      protectionAttachmentRate,
      protectionLastCheckedAt: this.toIsoString(protectionSnapshot.lastCheckedAt),
      protectionLastAttachedAt: this.toIsoString(protectionSnapshot.lastAttachedAt),
      protectionLastManualActionAt: this.toIsoString(protectionSnapshot.lastManualActionAt),
      queueToOrderSuccess24h,
      summaryRuns24h: generationMetrics.summaryRuns,
      suggestedTradesCreated24h: generationMetrics.suggestedTradesCreated,
      duplicateSuggestions24h: generationMetrics.duplicateSuggestions,
      refreshFailures24h,
      stateTransitionFailures24h,
      openAlerts: alertMetrics.openAlerts,
      openActionAlerts: alertMetrics.openActionAlerts,
      openExecutionAlerts: alertMetrics.openExecutionAlerts,
      probeUserId: latencyProbe.probeUserId,
      overviewLatencyMs: latencyProbe.overviewLatencyMs,
      listLatencyMs: latencyProbe.listLatencyMs,
      summaryLatencyMs: latencyProbe.summaryLatencyMs,
      syncStatusLatencyMs: latencyProbe.syncStatusLatencyMs,
      latencyProbeError: latencyProbe.latencyProbeError,
      freshnessAudit,
      ...(detailParts.length ? { detail: detailParts.join(' ') } : {}),
    };
  }

  private async readAlertMetrics(): Promise<{
    openAlerts: number;
    openActionAlerts: number;
    openExecutionAlerts: number;
  }> {
    const snapshot = await this.alertRepository.getOpenChannelSnapshot('Suggested Trades', [
      'suggested-trades',
      'suggested-trades-execution-sync',
    ]);

    return {
      openAlerts: snapshot.openAlerts,
      openActionAlerts: snapshot.openAlertsBySource['suggested-trades'] ?? 0,
      openExecutionAlerts: snapshot.openAlertsBySource['suggested-trades-execution-sync'] ?? 0,
    };
  }

  private async runLatencyProbe(probeUserId: string | null): Promise<{
    probeUserId: string | null;
    overviewLatencyMs: number | null;
    listLatencyMs: number | null;
    summaryLatencyMs: number | null;
    syncStatusLatencyMs: number | null;
    latencyProbeError?: string | null;
  }> {
    if (!probeUserId || !env.suggestedTrades.rolloutEnabled) {
      return {
        probeUserId,
        overviewLatencyMs: null,
        listLatencyMs: null,
        summaryLatencyMs: null,
        syncStatusLatencyMs: null,
        latencyProbeError: null,
      };
    }

    try {
      const overview = await this.measureLatency(() =>
        this.suggestedTradesOverviewService.getOverview(probeUserId, {
          limit: '20',
          offset: '0',
        })
      );
      const list = await this.measureLatency(() =>
        this.suggestedTradesService.getSuggestedTrades(probeUserId, {
          limit: '20',
          offset: '0',
        })
      );
      const summary = await this.measureLatency(() =>
        this.suggestedTradesService.getSuggestedTradesSummary(probeUserId, {})
      );
      const syncStatus = await this.measureLatency(() =>
        this.suggestedTradeExecutionSyncService.getSyncStatus(probeUserId, {})
      );

      return {
        probeUserId,
        overviewLatencyMs: overview.durationMs,
        listLatencyMs: list.durationMs,
        summaryLatencyMs: summary.durationMs,
        syncStatusLatencyMs: syncStatus.durationMs,
        latencyProbeError: null,
      };
    } catch (error) {
      return {
        probeUserId,
        overviewLatencyMs: null,
        listLatencyMs: null,
        summaryLatencyMs: null,
        syncStatusLatencyMs: null,
        latencyProbeError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async measureLatency<T>(
    operation: () => Promise<T>
  ): Promise<{ value: T; durationMs: number }> {
    const startedAt = Date.now();
    const value = await operation();
    return {
      value,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  private normalizeOptionalText(value: unknown): string | null {
    const normalized = String(value || '').trim();
    return normalized ? normalized : null;
  }

  private toIsoString(value: Date | string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }
}
