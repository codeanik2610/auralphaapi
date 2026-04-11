import { Inject, Service } from 'typedi';
import { AlertItem } from '../contracts/Alert';
import {
  SignalItem,
  SignalPageAction,
  SignalPromoteActionResult,
  SignalPromoteTarget,
  SignalsListResponse,
  SignalStatusActionResult,
  SignalSummary,
} from '../contracts/Signal';
import { NotFoundAppError } from '../errors/AppError';
import {
  AcknowledgeSignalBody,
  MuteSignalBody,
  PromoteSignalBody,
  SignalsQuery,
  validateAcknowledgeSignalBody,
  validateMuteSignalBody,
  validatePromoteSignalBody,
  validateSignalId,
  validateSignalsQuery,
} from '../validators/signals.validator';
import { successResponse } from '../utils/response';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  Alert,
  AlertRepository,
  AutomationRunRepository,
  Signal,
  SignalAlertLinkRepository,
  SignalClusterRecord,
  SignalRepository,
  SuggestedTradeRepository,
} from '../../database';
import { OperationalEventService } from './OperationalEventService';
import { StrategyLabService } from './StrategyLabService';
import { AutomationsService } from './AutomationsService';

interface PromotionExecutionResult {
  targetId: string;
  targetName?: string;
  targetUrl?: string;
  targetEntity?: string;
  promotionState: string;
  message: string;
  meta?: Record<string, unknown> | null;
}

@Service()
export class SignalsService {
  @Inject(() => SignalRepository)
  private signalRepository!: SignalRepository;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => SignalAlertLinkRepository)
  private signalAlertLinkRepository!: SignalAlertLinkRepository;

  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => AutomationRunRepository)
  private automationRunRepository!: AutomationRunRepository;

  @Inject(() => StrategyLabService)
  private strategyLabService!: StrategyLabService;

  @Inject(() => AutomationsService)
  private automationsService!: AutomationsService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getSignals(userId: string, query: SignalsQuery): Promise<ApiSuccessResponse<SignalsListResponse>> {
    const params = validateSignalsQuery(query);
    const { data, total } = await this.signalRepository.listSignals({ ...params, userId });

    return successResponse({
      items: data.map((signal) => this.mapSignalRecord(signal)),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getSignalsSummary(
    userId: string,
    query: SignalsQuery = {}
  ): Promise<ApiSuccessResponse<SignalSummary>> {
    const params = validateSignalsQuery(query);
    const summary = await this.signalRepository.getSignalSummary(userId, params);
    return successResponse(summary);
  }

  async getSignalById(
    userId: string,
    signalId: string
  ): Promise<ApiSuccessResponse<SignalItem>> {
    const signal = await this.requireSignal(userId, signalId);
    const alerts = await this.loadRelatedAlerts(userId, signal);

    return successResponse(this.mapSignal(signal, alerts));
  }

  async acknowledgeSignal(
    userId: string,
    signalId: string,
    body: AcknowledgeSignalBody
  ): Promise<ApiSuccessResponse<SignalStatusActionResult>> {
    const validatedSignalId = validateSignalId(signalId);
    try {
      const payload = validateAcknowledgeSignalBody(body);
      await this.requireSignal(userId, validatedSignalId);

      await this.signalRepository.updateSignal(userId, validatedSignalId, {
        status: 'Watching',
        promotionState: 'Reviewed',
      });
      await this.signalRepository.createSignalAction({
        signalId: validatedSignalId,
        actionType: 'acknowledge',
        note: payload.note,
      });

      const signal = await this.requireSignal(userId, validatedSignalId);
      await this.operationalEventService.logActivity(userId, {
        type: 'Signal',
        title: `Signal acknowledged: ${signal.symbol}`,
        status: 'Success',
        route: 'Signals',
        stream: 'Review',
        related: signal.source,
        referenceId: signal.id,
        description: payload.note || 'Signal acknowledged',
        flags: [
          {
            id: 'signal-acknowledged',
            message: 'Signal moved into the acknowledged review state.',
            channel: 'Signals',
            time: new Date().toISOString(),
            status: 'Ready',
          },
        ],
      });

      return successResponse({
        message: 'Signal acknowledged',
        signal: {
          id: signal.id,
          status: signal.status as SignalStatusActionResult['signal']['status'],
          updatedAt: signal.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Signal',
        title: 'Signal acknowledge failed',
        status: 'Failed',
        route: 'Signals',
        stream: 'Review',
        referenceId: validatedSignalId,
        description: error instanceof Error ? error.message : String(error),
        flags: [
          {
            id: 'signal-acknowledge-review',
            message: 'Review signal state before retrying acknowledgement.',
            channel: 'Signals',
            time: new Date().toISOString(),
            status: 'Needs review',
          },
        ],
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Signals',
        source: 'signals',
        message: `Signal acknowledge failed (${validatedSignalId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  async muteSignal(
    userId: string,
    signalId: string,
    body: MuteSignalBody
  ): Promise<ApiSuccessResponse<SignalStatusActionResult>> {
    const validatedSignalId = validateSignalId(signalId);
    try {
      const payload = validateMuteSignalBody(body);
      await this.requireSignal(userId, validatedSignalId);

      await this.signalRepository.updateSignal(userId, validatedSignalId, {
        status: 'Muted',
        promotionState: 'Muted',
        route: 'muted',
      });
      await this.signalRepository.createSignalAction({
        signalId: validatedSignalId,
        actionType: 'mute',
        note: payload.reason,
      });

      const signal = await this.requireSignal(userId, validatedSignalId);
      await this.operationalEventService.logActivity(userId, {
        type: 'Signal',
        title: `Signal muted: ${signal.symbol}`,
        status: 'Success',
        route: 'Signals',
        stream: 'Review',
        related: signal.source,
        referenceId: signal.id,
        description: payload.reason || 'Signal muted',
        flags: [
          {
            id: 'signal-muted',
            message: 'Signal muted and removed from active review queues.',
            channel: 'Signals',
            time: new Date().toISOString(),
            status: 'Ready',
          },
        ],
      });

      return successResponse({
        message: 'Signal muted',
        signal: {
          id: signal.id,
          status: signal.status as SignalStatusActionResult['signal']['status'],
          updatedAt: signal.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Signal',
        title: 'Signal mute failed',
        status: 'Failed',
        route: 'Signals',
        stream: 'Review',
        referenceId: validatedSignalId,
        description: error instanceof Error ? error.message : String(error),
        flags: [
          {
            id: 'signal-mute-review',
            message: 'Review signal eligibility before muting this item.',
            channel: 'Signals',
            time: new Date().toISOString(),
            status: 'Needs review',
          },
        ],
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Signals',
        source: 'signals',
        message: `Signal mute failed (${validatedSignalId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  async promoteSignal(
    userId: string,
    signalId: string,
    body: PromoteSignalBody
  ): Promise<ApiSuccessResponse<SignalPromoteActionResult>> {
    const validatedSignalId = validateSignalId(signalId);
    try {
      const { target } = validatePromoteSignalBody(body);
      const signal = await this.requireSignal(userId, validatedSignalId);
      const promotion = await this.executePromotionTarget(userId, signal, target);

      await this.signalRepository.updateSignal(userId, validatedSignalId, {
        route: target,
        promotionState: promotion.promotionState,
      });
      await this.signalRepository.createSignalAction({
        signalId: validatedSignalId,
        actionType: 'promote',
        target,
        metadata: {
          target,
          targetId: promotion.targetId,
          targetName: promotion.targetName ?? null,
          targetUrl: promotion.targetUrl ?? null,
          targetEntity: promotion.targetEntity ?? null,
          promotionState: promotion.promotionState,
          message: promotion.message,
          ...(promotion.meta ?? {}),
        },
      });

      const updatedSignal = await this.requireSignal(userId, validatedSignalId);
      await this.operationalEventService.logActivity(userId, {
        type: 'Signal',
        title: `Signal promoted: ${updatedSignal.symbol}`,
        status: 'Success',
        route: 'Signals',
        stream: 'Review',
        related: target,
        referenceId: updatedSignal.id,
        description: promotion.message,
        flags: [
          {
            id: 'signal-promoted',
            message: `Signal routed to ${target}.`,
            channel: 'Signals',
            time: new Date().toISOString(),
            status: 'Ready',
          },
        ],
      });

      return successResponse({
        message: promotion.message,
        signalId: validatedSignalId,
        target,
        targetId: promotion.targetId,
        targetName: promotion.targetName,
        targetUrl: promotion.targetUrl,
        targetEntity: promotion.targetEntity,
        meta: promotion.meta ?? null,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Signal',
        title: 'Signal promote failed',
        status: 'Failed',
        route: 'Signals',
        stream: 'Review',
        referenceId: validatedSignalId,
        description: error instanceof Error ? error.message : String(error),
        flags: [
          {
            id: 'signal-promote-review',
            message: 'Promotion target could not be completed. Review the signal before retrying.',
            channel: 'Signals',
            time: new Date().toISOString(),
            status: 'Needs review',
          },
        ],
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Signals',
        source: 'signals',
        message: `Signal promote failed (${validatedSignalId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  private async loadRelatedAlerts(userId: string, signal: Signal): Promise<Alert[]> {
    const linkedAlertIds = await this.signalAlertLinkRepository.listLinkedAlertIds(
      userId,
      signal.id,
      6
    );
    const actionAlertIds = Array.from(
      new Set(
        (signal.actions ?? [])
          .map((action) => this.parseRecord(action.metadata))
          .map((metadata) => this.readString(metadata?.alertId, metadata?.targetId))
          .filter((alertId): alertId is string => Boolean(alertId))
      )
    );

    const exactAlertIds = Array.from(new Set([...linkedAlertIds, ...actionAlertIds])).slice(0, 6);
    if (!exactAlertIds.length) {
      return [];
    }

    return this.alertRepository.getAlertsByIds(userId, exactAlertIds);
  }

  private async executePromotionTarget(
    userId: string,
    signal: Signal,
    target: SignalPromoteTarget
  ): Promise<PromotionExecutionResult> {
    const existing = this.findExistingPromotion(signal, target);
    if (existing) {
      return existing;
    }

    switch (target) {
      case 'strategy':
        return this.createStrategyDraftPromotion(userId, signal);
      case 'alerts':
        return this.createAlertPromotion(userId, signal);
      case 'automations':
        return this.createAutomationPromotion(userId, signal);
      case 'execution_queue':
      default:
        return this.createExecutionQueuePromotion(userId, signal);
    }
  }

  private findExistingPromotion(
    signal: Signal,
    target: SignalPromoteTarget
  ): PromotionExecutionResult | null {
    const action = (signal.actions ?? []).find((item) => {
      const metadata = this.parseRecord(item.metadata);
      const actionTarget = this.normalizePromotionTarget(item.target);
      return (
        item.actionType === 'promote' &&
        actionTarget === target &&
        Boolean(this.readString(metadata?.targetId))
      );
    });

    if (!action) {
      return null;
    }

    const metadata = this.parseRecord(action.metadata) ?? {};
    const targetId = this.readString(metadata.targetId);
    if (!targetId) {
      return null;
    }

    const targetName = this.readString(metadata.targetName);
    return {
      targetId,
      targetName: targetName ?? undefined,
      targetUrl: this.readString(metadata.targetUrl) ?? undefined,
      targetEntity: this.readString(metadata.targetEntity) ?? undefined,
      promotionState:
        this.readString(metadata.promotionState) ?? this.getPromotionState(target),
      message:
        this.readString(metadata.message) ??
        this.buildExistingPromotionMessage(target, targetName),
      meta: metadata,
    };
  }

  private async createStrategyDraftPromotion(
    userId: string,
    signal: Signal
  ): Promise<PromotionExecutionResult> {
    const timeframe = this.resolveTimeframe(signal);
    const market = this.resolveMarket(signal);
    const lineage = this.buildSignalLineage(signal);
    const name = `${signal.symbol} ${timeframe} ${signal.direction ?? 'Signal'} Draft`;
    const response = await this.strategyLabService.saveStrategyLabDraft(userId, {
      name,
      description:
        signal.thesis?.trim() || `Promoted from ${signal.symbol} ${timeframe} signal`,
      market,
      timeframe,
      timeframes: [timeframe],
      assets: [{ symbol: signal.symbol }],
      authoringMode: 'no_code',
      objective: 'signal-promotion',
      parameters: {
        signalId: signal.id,
        source: signal.source,
        confidence: signal.confidence,
        aiScore: signal.aiScore ?? null,
        direction: signal.direction ?? 'Long',
        signalTime: signal.signalTime?.toISOString() ?? null,
      },
      riskConfig: {
        maxRisk: '1.5',
        sizingNotes: signal.riskNote || 'Promoted from the Signals desk.',
      },
      sourceTemplateId: this.readString(lineage.sourceTemplateId) ?? undefined,
      sourceTemplateVersion: this.readNumber(lineage.sourceTemplateVersion) ?? undefined,
      sourceTemplateName:
        this.readString(lineage.sourceTemplateName) ?? signal.source,
      visualDefinition: {
        origin: 'signal-promotion',
        signalId: signal.id,
        symbol: signal.symbol,
        timeframe,
        direction: signal.direction ?? 'Long',
        thesis: signal.thesis ?? null,
      },
    });

    const project = response.data.project;
    return {
      targetId: project.id,
      targetName: project.name,
      targetUrl: `/strategy-lab?projectId=${encodeURIComponent(project.id)}`,
      targetEntity: 'strategy-lab-project',
      promotionState: 'Strategy draft created',
      message: `Strategy draft created: ${project.name}`,
      meta: {
        projectId: project.id,
        projectVersion: project.projectVersion,
        lineage,
      },
    };
  }

  private async createAutomationPromotion(
    userId: string,
    signal: Signal
  ): Promise<PromotionExecutionResult> {
    const timeframe = this.resolveTimeframe(signal);
    const name = `${signal.symbol} ${timeframe} Signal Automation`;
    const response = await this.automationsService.createAutomation(userId, {
      name,
      strategy: signal.source,
      broker: `${signal.symbol} · ${timeframe}`,
      market: this.resolveMarket(signal),
      trigger: 'manual-signal-promotion',
      status: 'Draft',
      automationType: 'trade-suggestion',
      config: this.buildTradeSuggestionConfig(signal, 'signal-automation'),
    });

    const automation = response.data;
    return {
      targetId: automation.id,
      targetName: automation.name,
      targetUrl: `/automations?selected=${encodeURIComponent(automation.id)}`,
      targetEntity: 'automation',
      promotionState: 'Automation draft created',
      message: `Automation draft created: ${automation.name}`,
      meta: {
        automationId: automation.id,
        automationType: automation.automationType ?? 'trade-suggestion',
        lineage: automation.lineage ?? this.buildSignalLineage(signal),
      },
    };
  }

  private async createAlertPromotion(
    userId: string,
    signal: Signal
  ): Promise<PromotionExecutionResult> {
    const timeframe = this.resolveTimeframe(signal);
    const direction = signal.direction ?? 'Long';
    const alert = await this.alertRepository.createManualAlert({
      userId,
      severity: this.resolveAlertSeverity(signal.confidence),
      channel: 'Signals',
      symbol: signal.symbol,
      message: `${signal.symbol} ${timeframe} ${direction} signal routed for alert review`,
      route: 'Signal review',
      status: 'Open',
      source: 'signals-promotion',
      urgency: signal.confidence >= 0.85 ? 'Immediate review' : 'Review queued',
    });

    await this.signalAlertLinkRepository.createLink({
      userId,
      signalId: signal.id,
      alertId: alert.id,
      relationType: 'promoted-alert',
    });

    return {
      targetId: alert.id,
      targetName: `${signal.symbol} ${timeframe} alert`,
      targetUrl: `/alerts?selected=${encodeURIComponent(alert.id)}`,
      targetEntity: 'alert',
      promotionState: 'Alert created',
      message: `Alert created for ${signal.symbol} ${timeframe}`,
      meta: {
        alertId: alert.id,
        lineage: this.buildSignalLineage(signal),
      },
    };
  }

  private async createExecutionQueuePromotion(
    userId: string,
    signal: Signal
  ): Promise<PromotionExecutionResult> {
    const timeframe = this.resolveTimeframe(signal);
    const automationResponse = await this.automationsService.createAutomation(userId, {
      name: `${signal.symbol} ${timeframe} Execution Queue`,
      strategy: signal.source,
      broker: 'Execution Queue',
      market: this.resolveMarket(signal),
      trigger: 'manual-signal-promotion',
      status: 'Draft',
      automationType: 'trade-suggestion',
      config: this.buildTradeSuggestionConfig(signal, 'execution-queue'),
    });

    const automation = automationResponse.data;
    const now = new Date();
    const run = await this.automationRunRepository.createRun({
      automationId: automation.id,
      userId,
      status: 'Succeeded',
      scheduledFor: null,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      meta: {
        source: 'signal-promotion',
        signalId: signal.id,
        handoffType: 'execution-queue',
      },
    });

    const sourceTemplateId = this.resolveSourceTemplateId(signal);
    const created = await this.suggestedTradeRepository.createSuggestedTrade({
      automationId: automation.id,
      automationRunId: run.id,
      userId,
      sourceTemplateId,
      sourceSetupKey: signal.dedupeKey,
      symbol: signal.symbol,
      timeframe,
      side: String(signal.direction || '').toLowerCase() === 'short' ? 'SELL' : 'BUY',
      signalTime: signal.signalTime ?? now,
      status: 'Open',
      confidence: signal.confidence,
      score: signal.aiScore ?? Math.round(signal.confidence * 100),
      entryPrice: this.readDecimal(signal.entryPrice),
      rationale:
        signal.thesis?.trim() ||
        `${signal.symbol} ${timeframe} signal promoted from the Signals desk`,
      entryRule: `${signal.source} signal promotion`,
      exitRule: signal.riskNote ?? null,
      dedupeKey: `signal-promotion:${signal.id}:orders`,
      meta: {
        signalId: signal.id,
        signalSource: signal.source,
        sourceRefType: signal.sourceRefType,
        sourceRefId: signal.sourceRefId,
        market: this.resolveMarket(signal),
        lineage: this.buildSignalLineage(signal),
      },
    });

    const suggestedTrade = created.item;
    if (!suggestedTrade) {
      throw new NotFoundAppError('Unable to create execution queue item');
    }

    return {
      targetId: suggestedTrade.id,
      targetName: `${suggestedTrade.symbol} ${suggestedTrade.timeframe} ${suggestedTrade.side}`,
      targetUrl: `/suggested-trades?selected=${encodeURIComponent(suggestedTrade.id)}`,
      targetEntity: 'suggested-trade',
      promotionState: 'Execution queue item created',
      message: created.duplicate
        ? `Execution queue item already exists for ${signal.symbol} ${timeframe}`
        : `Execution queue item created for ${signal.symbol} ${timeframe}`,
      meta: {
        suggestedTradeId: suggestedTrade.id,
        automationId: automation.id,
        automationRunId: run.id,
        lineage: this.buildSignalLineage(signal),
      },
    };
  }

  private buildTradeSuggestionConfig(
    signal: Signal,
    source: string
  ): Record<string, unknown> {
    const timeframe = this.resolveTimeframe(signal);
    const market = this.resolveMarket(signal);
    const lineage = this.buildSignalLineage(signal);
    const templateId = this.resolveSourceTemplateId(signal) ?? signal.id;
    const sourceTemplateName = this.readString(lineage.sourceTemplateName) ?? signal.source;
    const sourceTemplateVersion = this.readNumber(lineage.sourceTemplateVersion);
    const setupScope = {
      symbol: signal.symbol,
      timeframe,
      direction: signal.direction ?? 'Long',
      confidence: signal.confidence,
      aiScore: signal.aiScore ?? null,
    };

    return {
      source,
      symbol: signal.symbol,
      timeframe,
      market,
      strategy: signal.source,
      templateId,
      sourceTemplateId: templateId,
      sourceTemplateName,
      ...(sourceTemplateVersion !== null ? { sourceTemplateVersion } : {}),
      setupScope,
      signal: {
        id: signal.id,
        signalTime: signal.signalTime?.toISOString() ?? null,
        direction: signal.direction ?? 'Long',
        confidence: signal.confidence,
        aiScore: signal.aiScore ?? null,
        thesis: signal.thesis ?? null,
        entryPrice: this.readDecimal(signal.entryPrice),
        riskNote: signal.riskNote ?? null,
      },
      lineage,
      tradeSuggestion: {
        kind: 'trade-suggestion',
        source,
        symbol: signal.symbol,
        timeframe,
        market,
        strategy: signal.source,
        templateId,
        sourceTemplateId: templateId,
        sourceTemplateName,
        ...(sourceTemplateVersion !== null ? { sourceTemplateVersion } : {}),
        setupScope,
      },
    };
  }

  private buildSignalLineage(signal: Signal): Record<string, unknown> {
    const metadata = this.parseRecord(signal.metadata) ?? {};
    return {
      signalId: signal.id,
      sourceType: signal.sourceRefType ?? null,
      sourceId: signal.sourceRefId ?? null,
      sourceTemplateId: this.resolveSourceTemplateId(signal),
      sourceTemplateName: this.readString(metadata.sourceTemplateName, signal.source),
      sourceTemplateVersion: this.readNumber(metadata.sourceTemplateVersion),
      projectVersion: this.readNumber(metadata.projectVersion),
      signalTime: signal.signalTime?.toISOString() ?? null,
    };
  }

  private resolveSourceTemplateId(signal: Signal): string | null {
    const metadata = this.parseRecord(signal.metadata);
    return this.readString(
      metadata?.sourceTemplateId,
      signal.sourceRefType === 'strategy_library' ? signal.sourceRefId : null,
      signal.sourceRefId,
      signal.id
    );
  }

  private resolveTimeframe(signal: Signal): string {
    return signal.timeframe?.trim() || '1h';
  }

  private resolveMarket(signal: Signal): string {
    return signal.market?.trim() || 'crypto-futures';
  }

  private resolveAlertSeverity(confidence: number): string {
    if (confidence >= 0.85) {
      return 'High';
    }
    if (confidence >= 0.75) {
      return 'Medium';
    }
    return 'Low';
  }

  private buildExistingPromotionMessage(
    target: SignalPromoteTarget,
    targetName?: string | null
  ): string {
    if (targetName) {
      return `${this.getPromotionState(target)}: ${targetName}`;
    }
    return this.getPromotionState(target);
  }

  private async requireSignal(userId: string, signalId: string): Promise<Signal> {
    const validatedSignalId = validateSignalId(signalId);
    const signal = await this.signalRepository.getSignalById(userId, validatedSignalId);

    if (!signal) {
      throw new NotFoundAppError('Signal not found');
    }

    return signal;
  }

  private mapSignalRecord(record: Signal | SignalClusterRecord, alerts: Alert[] = []): SignalItem {
    if (this.isClusterRecord(record)) {
      return this.mapSignal(record.signal, alerts, record);
    }

    return this.mapSignal(record, alerts);
  }

  private isClusterRecord(record: Signal | SignalClusterRecord): record is SignalClusterRecord {
    return Boolean(record && typeof record === 'object' && 'signal' in record && 'clusterCount' in record);
  }

  private mapSignal(signal: Signal, alerts: Alert[] = [], cluster?: SignalClusterRecord): SignalItem {
    const relatedAlerts = alerts.length
      ? { alerts: alerts.map((alert) => this.mapRelatedAlert(alert)) }
      : {};

    return {
      id: signal.id,
      symbol: signal.symbol,
      source: signal.source,
      confidence: signal.confidence,
      direction: (signal.direction ?? 'Long') as SignalItem['direction'],
      timeframe: signal.timeframe ?? '--',
      status: signal.status as SignalItem['status'],
      regime: signal.regime ?? '--',
      aiScore: signal.aiScore ?? 0,
      thesis: signal.thesis ?? '',
      route: signal.route ?? '',
      createdAt: signal.createdAt.toISOString(),
      updatedAt: signal.updatedAt.toISOString(),
      market: signal.market ?? undefined,
      signalTime: signal.signalTime?.toISOString(),
      entryPrice: this.readDecimal(signal.entryPrice),
      sourceRefType:
        (signal.sourceRefType as SignalItem['sourceRefType']) ?? undefined,
      sourceRefId: signal.sourceRefId ?? undefined,
      expiresAt: signal.expiresAt?.toISOString() ?? null,
      riskNote: signal.riskNote ?? undefined,
      promotionState: signal.promotionState ?? undefined,
      metadata: signal.metadata ?? undefined,
      allowedActions: this.buildAllowedActions(signal),
      statusReason: this.buildStatusReason(signal),
      statusDisplay: this.buildStatusDisplay(signal),
      freshness: this.buildFreshness(signal),
      linkedEntities: this.buildLinkedEntities(signal, alerts),
      queueStage: this.buildQueueStage(signal, cluster),
      journeyStage: this.buildJourneyStage(signal),
      clusterCount: cluster?.clusterCount,
      clusterTriggeredCount: cluster?.clusterTriggeredCount,
      clusterWatchingCount: cluster?.clusterWatchingCount,
      clusterQueuedCount: cluster?.clusterQueuedCount,
      clusterLatestSignalTime: cluster?.clusterLatestSignalTime?.toISOString(),
      clusterStrongestConfidence: cluster?.clusterStrongestConfidence,
      ...relatedAlerts,
    };
  }

  private mapRelatedAlert(alert: Alert): AlertItem {
    return {
      id: alert.id,
      severity: alert.severity as AlertItem['severity'],
      channel: alert.channel,
      symbol: alert.symbol,
      message: alert.message,
      route: alert.route ?? '',
      time: alert.createdAt.toISOString(),
      status: alert.status as AlertItem['status'],
      source: alert.source ?? '',
      urgency: alert.urgency ?? '',
      updatedAt: alert.updatedAt.toISOString(),
    };
  }

  private buildAllowedActions(signal: Signal): SignalPageAction[] {
    const status = String(signal.status || '').trim();
    if (status === 'Muted') {
      return [];
    }

    const actions: SignalPageAction[] = [];
    if (status === 'Triggered' || status === 'Queued') {
      actions.push('acknowledge');
    }

    actions.push(
      'mute',
      'promote_strategy',
      'promote_execution_queue',
      'promote_alerts',
      'promote_automations'
    );

    return actions;
  }

  private buildStatusReason(signal: Signal): string {
    const status = String(signal.status || '').trim();
    const expiresAt = signal.expiresAt?.getTime() ?? null;

    if (expiresAt !== null && expiresAt <= Date.now()) {
      return 'Signal has expired and should be reviewed before action';
    }
    if (status === 'Watching') {
      return 'Signal acknowledged and being monitored';
    }
    if (status === 'Queued') {
      return 'Signal queued for review';
    }
    if (status === 'Muted') {
      return 'Signal muted and removed from active review queues';
    }

    return 'Fresh signal awaiting review';
  }

  private buildStatusDisplay(signal: Signal): string {
    const status = String(signal.status || '').trim();
    if (status === 'Watching') {
      return 'Watching';
    }
    if (status === 'Queued') {
      return 'Queued';
    }
    if (status === 'Muted') {
      return 'Muted';
    }
    return 'Needs Review';
  }

  private buildQueueStage(
    signal: Signal,
    cluster?: SignalClusterRecord
  ): SignalItem['queueStage'] {
    if (signal.status === 'Muted') {
      return 'muted';
    }
    if (cluster) {
      return 'clustered';
    }
    return 'inbox';
  }

  private buildJourneyStage(signal: Signal): SignalItem['journeyStage'] {
    const status = String(signal.status || '').trim();
    if (status === 'Watching') {
      return 'signal_review';
    }
    if (status === 'Queued') {
      return 'signal_queued';
    }
    if (status === 'Muted') {
      return 'signal_muted';
    }
    return 'signal_detected';
  }

  private buildFreshness(signal: Signal): SignalItem['freshness'] {
    const observedAt = signal.signalTime?.toISOString() ?? signal.createdAt.toISOString();
    const observedMs = this.toTimestamp(observedAt);
    const expiresMs = signal.expiresAt?.getTime() ?? null;
    const timeframeMs = this.parseTimeframeMs(signal.timeframe);
    const staleAfterMs =
      expiresMs !== null
        ? Math.max(0, expiresMs - observedMs)
        : timeframeMs !== null
          ? timeframeMs * 2
          : 24 * 60 * 60 * 1000;
    const freshnessMs = Math.max(0, Date.now() - observedMs);

    return {
      observedAt,
      freshnessMs,
      staleAfterMs,
      isStale:
        (expiresMs !== null && expiresMs <= Date.now()) ||
        freshnessMs > staleAfterMs,
      source: 'signal',
    };
  }

  private buildLinkedEntities(signal: Signal, alerts: Alert[]): SignalItem['linkedEntities'] {
    const linkedEntities: NonNullable<SignalItem['linkedEntities']> = [];
    const seen = new Set<string>();

    const push = (entity: string, id: string | null, extras: Record<string, unknown> = {}) => {
      const normalizedId = this.readString(id);
      if (!normalizedId) {
        return;
      }
      const key = `${entity}:${normalizedId}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      linkedEntities.push({
        entity,
        id: normalizedId,
        label: this.readString(extras.label) ?? undefined,
        url: this.readString(extras.url) ?? undefined,
        relation: this.readString(extras.relation) ?? undefined,
        status: this.readString(extras.status),
      });
    };

    for (const alert of alerts) {
      push('alert', alert.id, {
        label: `${alert.symbol || signal.symbol} alert`,
        url: `/alerts?selected=${encodeURIComponent(alert.id)}`,
        relation: 'alert',
        status: alert.status,
      });
    }

    for (const action of signal.actions ?? []) {
      const metadata = this.parseRecord(action.metadata) ?? {};
      if (action.actionType !== 'promote') {
        continue;
      }

      const target = this.normalizePromotionTarget(action.target);
      const targetId = this.readString(metadata.targetId);
      const targetEntity =
        this.readString(metadata.targetEntity) ??
        (target === 'execution_queue' ? 'suggested-trade' : target);

      push(targetEntity ?? 'promotion', targetId, {
        label: this.readString(metadata.targetName) ?? this.buildExistingPromotionMessage(target ?? 'strategy'),
        url: this.readString(metadata.targetUrl),
        relation: 'promotion',
        status: this.readString(metadata.promotionState),
      });
    }

    return linkedEntities;
  }

  private readDecimal(value: string | null): number | null {
    if (!value) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private readString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private readNumber(...values: unknown[]): number | null {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private toTimestamp(value: string | Date | null | undefined): number {
    if (!value) {
      return 0;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  private parseTimeframeMs(timeframe: string | null | undefined): number | null {
    const normalized = String(timeframe || '')
      .trim()
      .toLowerCase();
    const match = normalized.match(/^(\d+)(m|h|d|w)$/);
    if (!match) {
      return null;
    }

    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    const unit = match[2];
    if (unit === 'm') {
      return amount * 60 * 1000;
    }
    if (unit === 'h') {
      return amount * 60 * 60 * 1000;
    }
    if (unit === 'd') {
      return amount * 24 * 60 * 60 * 1000;
    }
    if (unit === 'w') {
      return amount * 7 * 24 * 60 * 60 * 1000;
    }

    return null;
  }

  private getPromotionState(target: SignalPromoteTarget): string {
    switch (target) {
      case 'execution_queue':
        return 'Execution queue item created';
      case 'alerts':
        return 'Alert created';
      case 'automations':
        return 'Automation draft created';
      case 'strategy':
      default:
        return 'Strategy draft created';
    }
  }

  private normalizePromotionTarget(value: string | null | undefined): SignalPromoteTarget | null {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();

    if (!normalized) {
      return null;
    }
    if (normalized === 'orders') {
      return 'execution_queue';
    }
    if (
      normalized === 'strategy' ||
      normalized === 'execution_queue' ||
      normalized === 'alerts' ||
      normalized === 'automations'
    ) {
      return normalized as SignalPromoteTarget;
    }

    return null;
  }
}
