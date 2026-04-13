import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { Inject, Service } from 'typedi';
import { Automation, AutomationRun, Backtest } from '../../database';
import {
  AutomationRepository,
  AutomationCursorRepository,
  AutomationRunOutputRepository,
  AutomationRunRepository,
  BacktestRepository,
  SuggestedTradeRepository,
} from '../../database';
import { coreDataSource } from '../../database/data-source';
import { StrategyLibraryService } from './StrategyLibraryService';
import { OperationalEventService } from './OperationalEventService';
import { StrategyTemplateRepository } from '../../database/repositories/StrategyTemplateRepository';
import { UserTimeZoneService } from './UserTimeZoneService';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { computeNextRun, resolveAutomationSchedule } from '../utils/automationSchedule';
import { extractAutomationLineage } from '../utils/automationLineage';
import { normalizeAutomationConfig, normalizeAutomationType } from '../utils/automationType';
import {
  buildStrategyTemplateAutomationProfile,
  StrategyTemplateAutomationProfile,
  StrategyTemplateTradePlanLeg,
} from '../utils/strategyTemplateAutomation';
import { normalizeTimeZone } from '../utils/timezone';
import { Logger } from '../../lib/logger';
import type { StrategyLibraryRunBody } from '../contracts/StrategyLibrary';
import { AutomationSignalEvaluatorService } from './AutomationSignalEvaluatorService';

const log = new Logger('AutomationExecutionService');
const AUTOMATION_RUNTIME_WORKER_ID = `${os.hostname()}:${process.pid}:automation-api`;

export interface ExecuteAutomationPayload {
  automationId?: string;
  scheduledFor?: string;
  actorUserId?: string | null;
  trigger?: string;
}

export interface ExecuteAutomationResult {
  runId?: string;
  status: 'started' | 'skipped' | 'failed';
  message?: string;
  nextRun?: string | null;
  backtestId?: string;
}

@Service()
export class AutomationExecutionService {
  private static readonly ACTIVE_RUN_STATUSES = ['Queued', 'Running'] as const;

  @Inject(() => AutomationRepository)
  private automationRepository!: AutomationRepository;

  @Inject(() => AutomationCursorRepository)
  private automationCursorRepository!: AutomationCursorRepository;

  @Inject(() => AutomationRunRepository)
  private automationRunRepository!: AutomationRunRepository;

  @Inject(() => AutomationRunOutputRepository)
  private automationRunOutputRepository!: AutomationRunOutputRepository;

  @Inject(() => BacktestRepository)
  private backtestRepository!: BacktestRepository;

  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => StrategyTemplateRepository)
  private strategyTemplateRepository!: StrategyTemplateRepository;

  @Inject(() => StrategyLibraryService)
  private strategyLibraryService!: StrategyLibraryService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  @Inject(() => AutomationSignalEvaluatorService)
  private automationSignalEvaluatorService!: AutomationSignalEvaluatorService;

  async execute(payload: ExecuteAutomationPayload): Promise<ExecuteAutomationResult> {
    const automationId = String(payload.automationId || '').trim();
    if (!automationId) {
      throw new BadRequestAppError('automationId is required');
    }
    const trigger = payload.trigger === 'scheduled' ? 'scheduled' : 'manual';
    const scheduledFor = this.parseScheduledFor(payload.scheduledFor);
    const now = new Date();

    const queryRunner = coreDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let automation: Automation | null = null;
    let runId: string | null = null;
    let nextRun: Date | null = null;
    let scheduledAt: Date | null = null;
    let automationType = normalizeAutomationType(null, null);
    let normalizedConfig: Record<string, unknown> | null = null;
    try {
      automation = await queryRunner.manager.findOne(Automation, {
        where: { id: automationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!automation) {
        throw new NotFoundAppError('Automation not found');
      }

      automationType = normalizeAutomationType(automation.automationType, automation.config);
      normalizedConfig = normalizeAutomationConfig(automationType, automation.config);

      if (automation.status !== 'Running') {
        await queryRunner.commitTransaction();
        return {
          status: 'skipped',
          message: `Automation ${automation.id} is not running`,
        };
      }

      const schedule = resolveAutomationSchedule(automation.schedule ?? null, automation.trigger);
      if (!schedule) {
        automation.status = 'Failed';
        automation.nextRun = null;
        await queryRunner.manager.save(automation);
        await queryRunner.commitTransaction();
        await this.automationRepository.createAutomationAlert({
          automationId: automation.id,
          message: 'Automation schedule is missing or invalid. Update the schedule to resume.',
          severity: 'high',
          status: 'open',
        });
        return {
          status: 'failed',
          message: 'Automation schedule is missing or invalid',
        };
      }

      const activeRun = await queryRunner.manager
        .createQueryBuilder(AutomationRun, 'automation_run')
        .setLock('pessimistic_read')
        .where('automation_run.automationId = :automationId', { automationId: automation.id })
        .andWhere('automation_run.status IN (:...statuses)', {
          statuses: [...AutomationExecutionService.ACTIVE_RUN_STATUSES],
        })
        .orderBy('automation_run.startedAt', 'DESC')
        .getOne();

      if (activeRun) {
        await queryRunner.commitTransaction();
        await this.automationRepository.createAutomationEvent({
          automationId: automation.id,
          type: 'Run skipped',
          entity: 'Automation',
          outcome: 'Skipped',
          meta: {
            trigger,
            reason: 'overlap-protected',
            activeRunId: activeRun.id,
            activeRunStatus: activeRun.status,
          },
        });
        return {
          status: 'skipped',
          message: `Automation ${automation.id} already has an active run`,
        };
      }

      const timeZone = await this.resolveAutomationTimeZone(automation.userId, automation.timeZone);
      nextRun = computeNextRun(schedule, timeZone, now);
      if (!nextRun) {
        throw new BadRequestAppError('Unable to compute next run from schedule');
      }

      scheduledAt = scheduledFor ?? automation.nextRun ?? now;
      runId = randomUUID();
      const startLineage = this.buildRunLineage(normalizedConfig);
      const startMeta: Record<string, unknown> = {
        trigger,
        scheduledFor: scheduledAt instanceof Date ? scheduledAt.toISOString() : String(scheduledAt),
        ...(startLineage ? { lineage: startLineage } : {}),
      };
      if (payload.actorUserId) {
        startMeta.actorUserId = payload.actorUserId;
      }

      try {
        await queryRunner.manager.insert(AutomationRun, {
          id: runId,
          automationId: automation.id,
          userId: automation.userId,
          status: 'Running',
          workerId: AUTOMATION_RUNTIME_WORKER_ID,
          scheduledFor: scheduledAt,
          startedAt: now,
          lastProgressAt: now,
          meta: startMeta,
        } as any);
      } catch (error) {
        if (this.isDuplicateKeyError(error)) {
          await queryRunner.rollbackTransaction();
          await this.automationRepository.createAutomationEvent({
            automationId: automation.id,
            type: 'Run skipped',
            entity: 'Automation',
            outcome: 'Skipped',
            meta: {
              trigger,
              reason: 'duplicate-schedule',
              scheduledFor: (scheduledAt ?? scheduledFor ?? now).toISOString(),
            },
          });
          return {
            status: 'skipped',
            message: 'Automation run already queued for this schedule',
          };
        }
        throw error;
      }

      automation.lastRun = now;
      automation.nextRun = nextRun;
      await queryRunner.manager.save(automation);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    if (!automation || !runId || !nextRun) {
      return {
        status: 'failed',
        message: 'Automation execution could not be started',
      };
    }

    await this.automationRepository.createAutomationEvent({
      automationId: automation.id,
      type: 'Run started',
      entity: trigger === 'scheduled' ? 'Scheduled' : 'Manual',
      outcome: 'Queued',
    });

    let backtestId: string | undefined;
    let suggestedTradesInserted = 0;
    let suggestedTradesDuplicates = 0;
    let suggestionSymbolsProcessed = 0;
    let suggestionSymbolsSkipped = 0;
    let suggestionSymbolsEvaluated = 0;
    let suggestionSignalsDetected = 0;
    try {
      if (automationType === 'backtest-runner') {
        const { libraryId, runBody } = this.resolveLibraryRunConfig(normalizedConfig);
        if (libraryId) {
          const response = await this.strategyLibraryService.runLibraryStrategy(
            automation.userId,
            libraryId,
            {
              ...runBody,
              automationId: automation.id,
              automationRunId: runId,
            }
          );
          backtestId = response.data?.backtestId;
        } else {
          const queuedBacktest = await this.queueStrategyBacktest(automation, runId, normalizedConfig);
          backtestId = queuedBacktest?.id;
        }

        if (!backtestId) {
          throw new Error('Backtest runner automation did not return a child backtest id');
        }
      } else {
        const suggestionResult = await this.generateTradeSuggestions(
          automation,
          runId,
          normalizedConfig,
          scheduledAt ?? scheduledFor ?? now
        );
        suggestedTradesInserted = suggestionResult.inserted;
        suggestedTradesDuplicates = suggestionResult.duplicates;
        suggestionSymbolsProcessed = suggestionResult.symbolsProcessed;
        suggestionSymbolsSkipped = suggestionResult.symbolsSkipped;
        suggestionSymbolsEvaluated = suggestionResult.symbolsEvaluated;
        suggestionSignalsDetected = suggestionResult.signalsDetected;
      }

      const finishedAt = new Date();
      const lineage = this.buildRunLineage(normalizedConfig, backtestId);
      const successMeta: Record<string, unknown> = {
        trigger,
        scheduledFor: (scheduledAt ?? scheduledFor ?? now).toISOString(),
        ...(backtestId ? { backtestId } : {}),
        ...(lineage ? { lineage } : {}),
        ...(automationType === 'trade-suggestion'
          ? {
              suggestedTradesCount: suggestedTradesInserted,
              duplicateSuggestionsCount: suggestedTradesDuplicates,
              symbolsProcessed: suggestionSymbolsProcessed,
              symbolsSkipped: suggestionSymbolsSkipped,
              symbolsEvaluated: suggestionSymbolsEvaluated,
              signalsDetected: suggestionSignalsDetected,
            }
          : {}),
      };
      if (payload.actorUserId) {
        successMeta.actorUserId = payload.actorUserId;
      }

      if (automationType === 'backtest-runner') {
        successMeta.childBacktestStatus = 'Queued';
        successMeta.backtestLifecycle = 'pending';

        await this.automationRunRepository.updateRun(runId, {
          status: 'Running',
          workerId: null,
          lastProgressAt: finishedAt,
          meta: successMeta,
        });

        await this.automationRepository.createAutomationEvent({
          automationId: automation.id,
          type: 'Backtest queued',
          entity: 'Backtest',
          outcome: 'Queued',
          meta: {
            backtestId,
            trigger,
            scheduledFor: (scheduledAt ?? scheduledFor ?? now).toISOString(),
            ...(lineage ? { lineage } : {}),
          },
        });

        await this.automationRunOutputRepository.createOutput({
          automationId: automation.id,
          automationRunId: runId,
          userId: automation.userId,
          outputType: 'backtest-runner.backtest',
          status: 'Queued',
          title: 'Backtest runner queued child backtest',
          dedupeKey: 'queued-backtest',
          payload: {
            automationType,
            backtestId,
            trigger,
            scheduledFor: (scheduledAt ?? scheduledFor ?? now).toISOString(),
          },
        });

        return {
          status: 'started',
          runId,
          nextRun: nextRun.toISOString(),
          backtestId,
        };
      }

      await this.automationRunRepository.updateRun(runId, {
        status: 'Success',
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - now.getTime()),
        workerId: null,
        lastProgressAt: finishedAt,
        meta: successMeta,
      });

      await this.automationRepository.createAutomationEvent({
        automationId: automation.id,
        type: 'Run completed',
        entity: backtestId ? 'Backtest' : 'Automation',
        outcome: 'Success',
      });

      await this.automationRunOutputRepository.createOutput({
        automationId: automation.id,
        automationRunId: runId,
        userId: automation.userId,
        outputType: `${automationType}.summary`,
        status: 'Created',
        title: 'Trade suggestion execution completed',
        dedupeKey: 'summary',
        payload: {
          automationType,
          trigger,
          scheduledFor: (scheduledAt ?? scheduledFor ?? now).toISOString(),
          backtestId: backtestId ?? null,
          suggestedTradesCount: suggestedTradesInserted,
          duplicateSuggestionsCount: suggestedTradesDuplicates,
          symbolsProcessed: suggestionSymbolsProcessed,
          symbolsSkipped: suggestionSymbolsSkipped,
          symbolsEvaluated: suggestionSymbolsEvaluated,
          signalsDetected: suggestionSignalsDetected,
          note:
            suggestionSignalsDetected > 0
              ? 'Fresh entry signals were detected on the latest closed candle and persisted as suggested trades.'
              : 'The automation scan completed successfully but no fresh entry signals were detected on the latest closed candle.',
        },
      });

      return {
        status: 'started',
        runId,
        nextRun: nextRun.toISOString(),
        ...(backtestId ? { backtestId } : {}),
      };
    } catch (error) {
      const finishedAt = new Date();
      const lineage = this.buildRunLineage(normalizedConfig);
      const failureMeta: Record<string, unknown> = {
        trigger,
        scheduledFor: (scheduledAt ?? scheduledFor ?? now).toISOString(),
        ...(lineage ? { lineage } : {}),
      };
      if (payload.actorUserId) {
        failureMeta.actorUserId = payload.actorUserId;
      }
      await this.automationRunRepository.updateRun(runId, {
        status: 'Failed',
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - now.getTime()),
        errorMessage: error instanceof Error ? error.message : String(error),
        workerId: null,
        lastProgressAt: finishedAt,
        meta: failureMeta,
      });

      await this.automationRepository.createAutomationEvent({
        automationId: automation.id,
        type: 'Run failed',
        entity: automationType,
        outcome: 'Failed',
      });

      await this.automationRunOutputRepository.createOutput({
        automationId: automation.id,
        automationRunId: runId,
        userId: automation.userId,
        outputType: `${automationType}.summary`,
        status: 'Failed',
        title:
          automationType === 'backtest-runner'
            ? 'Backtest runner execution failed'
            : 'Trade suggestion execution failed',
        dedupeKey: 'summary',
        payload: {
          automationType,
          trigger,
          scheduledFor: (scheduledAt ?? scheduledFor ?? now).toISOString(),
          backtestId: null,
          suggestedTradesCount: 0,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      await this.automationRepository.createAutomationAlert({
        automationId: automation.id,
        message: error instanceof Error ? error.message : String(error),
        severity: 'high',
        status: 'open',
      });

      await this.operationalEventService.logActivity(automation.userId, {
        type: 'Automation',
        title: `Automation run failed: ${automation.name}`,
        status: 'Failed',
        route: 'Automations',
        stream: 'Runs',
        referenceId: automation.id,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(automation.userId, {
        channel: 'Automation',
        source: 'automation-execution',
        message: `Automation run failed (${automation.id}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });

      const fatal = error instanceof BadRequestAppError || error instanceof NotFoundAppError;
      if (fatal) {
        await this.automationRepository.updateAutomationStatus(automation.userId, automation.id, 'Failed', null);
      }

      log.error(`Automation ${automation.id} run failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        status: 'failed',
        runId,
        message: error instanceof Error ? error.message : String(error),
        nextRun: nextRun.toISOString(),
      };
    }
  }

  async syncBacktestRunnerLifecycle(userId: string, automationId: string): Promise<void> {
    const automation = await this.automationRepository.getAutomationById(userId, automationId);
    if (!automation) {
      return;
    }

    const automationType = normalizeAutomationType(automation.automationType, automation.config);
    if (automationType !== 'backtest-runner') {
      return;
    }

    const runs = await this.automationRunRepository.listRunsByAutomationStatuses(
      automation.id,
      userId,
      ['Queued', 'Running', 'Success'],
      25
    );

    for (const run of runs) {
      await this.syncBacktestRunnerRun(automation, run);
    }
  }

  async syncBacktestRunnerLifecycleByBacktestId(
    backtestId: string
  ): Promise<{ synced: boolean; automationId?: string; automationRunId?: string }> {
    const normalizedBacktestId = String(backtestId || '').trim();
    if (!normalizedBacktestId) {
      return { synced: false };
    }

    const backtest = await this.backtestRepository.getBacktestByIdAny(normalizedBacktestId);
    if (!backtest) {
      return { synced: false };
    }

    const config = this.parseRecord(backtest.result?.config) ?? {};
    const inputSnapshot = this.parseRecord(config.inputSnapshot) ?? {};
    const automationId = this.readString(
      config.automationId,
      inputSnapshot.automationId
    );
    const automationRunId = this.readString(
      config.automationRunId,
      inputSnapshot.automationRunId
    );

    if (!automationId || !automationRunId) {
      return { synced: false };
    }

    const automation = await this.automationRepository.getAutomationById(backtest.userId, automationId);
    if (!automation) {
      return { synced: false, automationId, automationRunId };
    }

    const run = await this.automationRunRepository.findById(automationRunId);
    if (!run || run.automationId !== automation.id || run.userId !== backtest.userId) {
      return { synced: false, automationId, automationRunId };
    }

    await this.syncBacktestRunnerRun(automation, run);
    return { synced: true, automationId, automationRunId };
  }

  private resolveLibraryRunConfig(
    config: Record<string, unknown> | null
  ): { libraryId: string | null; runBody: StrategyLibraryRunBody } {
    const resolved = this.parseRecord(config);
    const nested = this.parseRecord(resolved?.config);
    const nestedSnapshot = this.parseRecord(nested?.inputSnapshot);
    const rootSnapshot = this.parseRecord(resolved?.inputSnapshot);
    const libraryId =
      String(
        resolved?.libraryId ||
          resolved?.strategyLibraryId ||
          resolved?.library ||
          nested?.libraryId ||
          nested?.strategyLibraryId ||
          nested?.library ||
          nestedSnapshot?.libraryId ||
          nestedSnapshot?.sourceId ||
          rootSnapshot?.libraryId ||
          rootSnapshot?.sourceId ||
          ''
      ).trim() || null;

    const runBody: StrategyLibraryRunBody = {};
    const sources = [resolved, nested, nestedSnapshot, rootSnapshot];
    for (const source of sources) {
      if (!source) continue;
      if (!runBody.assets && Array.isArray(source.assets)) {
        runBody.assets = source.assets as Record<string, unknown>[];
      }
      if (!runBody.timeframes && Array.isArray(source.timeframes)) {
        runBody.timeframes = source.timeframes as string[];
      }
      if (!runBody.overrides && source.overrides && typeof source.overrides === 'object') {
        runBody.overrides = source.overrides as Record<string, unknown>;
      }
      const start = source.start || source.startDate || source.from;
      if (!runBody.start && typeof start === 'string') {
        runBody.start = start;
      }
      const end = source.end || source.endDate || source.to;
      if (!runBody.end && typeof end === 'string') {
        runBody.end = end;
      }
    }

    return { libraryId, runBody };
  }

  private async queueStrategyBacktest(
    automation: Automation,
    runId: string,
    normalizedConfig?: Record<string, unknown> | null
  ): Promise<Backtest | null> {
    const config = this.parseRecord(normalizedConfig ?? automation.config);
    const nestedConfig = this.parseRecord(config?.config);
    const runConfig = nestedConfig ?? config ?? {};

    const symbol =
      (typeof config?.symbol === 'string' && config.symbol.trim()) ||
      (typeof runConfig.benchmark === 'string' && String(runConfig.benchmark).trim()) ||
      (typeof runConfig.symbol === 'string' && String(runConfig.symbol).trim()) ||
      'Automation';

    const parameter =
      (typeof config?.parameter === 'string' && config.parameter.trim()) ||
      (typeof runConfig.universe === 'string' && String(runConfig.universe).trim()) ||
      automation.trigger ||
      automation.strategy;

    const strategy =
      (typeof config?.strategy === 'string' && config.strategy.trim()) || automation.strategy;

    const queued = await this.backtestRepository.createQueuedBacktest(automation.userId, {
      name: automation.name,
      strategy,
      symbol,
      parameter,
      status: 'Queued',
      config: {
        ...(runConfig && typeof runConfig === 'object' ? runConfig : {}),
        automationId: automation.id,
        automationRunId: runId,
      },
    });

    await this.operationalEventService.logActivity(automation.userId, {
      type: 'Automation',
      title: `Automation run queued: ${automation.name}`,
      status: 'Success',
      route: 'Automations',
      stream: 'Runs',
      referenceId: automation.id,
      description: `Backtest queued as ${queued.id}`,
    });

    return queued;
  }

  private async generateTradeSuggestions(
    automation: Automation,
    runId: string,
    normalizedConfig: Record<string, unknown> | null,
    signalBaseTime: Date
  ): Promise<{
    inserted: number;
    duplicates: number;
    symbolsProcessed: number;
    symbolsSkipped: number;
    symbolsEvaluated: number;
    signalsDetected: number;
  }> {
    const config = this.parseRecord(normalizedConfig) ?? {};
    const tradeSuggestion = this.parseRecord(config.tradeSuggestion) ?? {};
    const setupScope = this.parseRecord(tradeSuggestion.setupScope) ?? this.parseRecord(config.setupScope);
    const profileInfo = await this.resolveTradeSuggestionProfile(automation.userId, config);
    const profile = profileInfo.profile;

    if (!profile.automationReady) {
      throw new BadRequestAppError(
        `Template is not automation-ready: ${profile.readinessReasons.join(', ')}`
      );
    }

    const symbols = this.resolveTradeSuggestionSymbols(config);
    if (!symbols.length) {
      throw new BadRequestAppError('trade-suggestion automation config must include at least one symbol');
    }

    const timeframe = this.resolveTradeSuggestionTimeframe(config);
    if (!timeframe) {
      throw new BadRequestAppError(
        'trade-suggestion automation config must include a timeframe'
      );
    }

    const activeLegs = [profile.tradePlan.long, profile.tradePlan.short].filter(
      (item): item is StrategyTemplateTradePlanLeg => Boolean(item?.enabled)
    );
    if (!activeLegs.length) {
      throw new BadRequestAppError('No active trade plan legs are available for this automation');
    }

    const sourceBacktestId =
      this.readString(tradeSuggestion.backtestId, config.backtestId) ?? null;
    const sourceSetupKey =
      this.readString(setupScope?.dedupeKey, tradeSuggestion.sourceSetupKey, config.sourceSetupKey) ??
      null;
    const score = this.readNumber(setupScope?.score, tradeSuggestion.score);
    const confidence =
      this.readNumber(tradeSuggestion.confidence, config.confidence, score) ??
      profile.signalThreshold;

    let inserted = 0;
    let duplicates = 0;
    let symbolsProcessed = 0;
    let symbolsSkipped = 0;
    let signalsDetected = 0;

    const candleSettings = this.resolveTradeSuggestionCandleSettings(config);
    const existingCursors = await this.automationCursorRepository.listByAutomationAndScope(
      automation.id,
      automation.userId,
      timeframe,
      symbols
    );
    const cursorMap = new Map(
      existingCursors.map((cursor) => [cursor.symbol.trim().toUpperCase(), cursor])
    );
    const evaluation = await this.automationSignalEvaluatorService.evaluateLatestSignals({
      templateId: profileInfo.sourceTemplateId,
      templateName:
        this.readString(
          this.parseRecord(config.template)?.name,
          this.parseRecord(this.parseRecord(config.inputSnapshot)?.template)?.name,
          this.parseRecord(this.parseRecord(config.tradeSuggestion)?.template)?.name
        ) ?? automation.strategy,
      templateConfig: profileInfo.templateConfig,
      symbols,
      timeframe,
      evaluatedAt: signalBaseTime,
      maxBars: candleSettings.maxBars ?? undefined,
      warmupBars: candleSettings.warmupBars ?? undefined,
      candlesTable: candleSettings.candlesTable,
      candlesSchema: candleSettings.candlesSchema,
      candlesMaxRows: candleSettings.candlesMaxRows,
      cursorBySymbol: Object.fromEntries(
        Array.from(cursorMap.entries()).flatMap(([symbol, cursor]) =>
          cursor.lastEvaluatedSignalTime
            ? [[symbol, cursor.lastEvaluatedSignalTime.toISOString()]]
            : []
        )
      ),
    });

    for (const item of evaluation.items) {
      symbolsProcessed += 1;
      const currentCursor = cursorMap.get(item.symbol) ?? null;
      const latestClosedSignalTime = item.latestClosedSignalTime
        ? new Date(item.latestClosedSignalTime)
        : null;
      let latestTriggeredSignalTime = currentCursor?.lastTriggeredSignalTime ?? null;

      if (item.status !== 'ok') {
        symbolsSkipped += 1;
        await this.automationCursorRepository.upsertCursor({
          automationId: automation.id,
          userId: automation.userId,
          symbol: item.symbol,
          timeframe,
          lastEvaluatedSignalTime: currentCursor?.lastEvaluatedSignalTime ?? null,
          lastTriggeredSignalTime: latestTriggeredSignalTime,
          lastRunId: runId,
          lastStatus: item.status,
          meta: {
            reason: item.reason ?? null,
            evaluationMode: 'closed-candle-window',
          },
        });
        continue;
      }

      const signalEvents = Array.isArray(item.signals) ? item.signals : [];
      const normalizedSignalEvents = signalEvents
        .map((event) => {
          const signalTime = event?.signalTime ? new Date(event.signalTime) : null;
          const entryPrice = this.readNumber(event?.entryPrice);
          if (!signalTime || Number.isNaN(signalTime.getTime()) || entryPrice === null || entryPrice <= 0) {
            return null;
          }
          const leg = activeLegs.find((candidate) => candidate.side === event.side);
          if (!leg) {
            return null;
          }
          return {
            leg,
            signalTime,
            entryPrice,
          };
        })
        .filter(
          (
            event
          ): event is {
            leg: StrategyTemplateTradePlanLeg;
            signalTime: Date;
            entryPrice: number;
          } => Boolean(event)
        );

      if (!normalizedSignalEvents.length) {
        await this.automationCursorRepository.upsertCursor({
          automationId: automation.id,
          userId: automation.userId,
          symbol: item.symbol,
          timeframe,
          lastEvaluatedSignalTime:
            latestClosedSignalTime && !Number.isNaN(latestClosedSignalTime.getTime())
              ? latestClosedSignalTime
              : currentCursor?.lastEvaluatedSignalTime ?? null,
          lastTriggeredSignalTime: latestTriggeredSignalTime,
          lastRunId: runId,
          lastStatus: 'ok',
          meta: {
            latestClosedSignalTime: latestClosedSignalTime?.toISOString() ?? null,
            evaluationMode: 'closed-candle-window',
            signalCount: 0,
          },
        });
        continue;
      }

      signalsDetected += normalizedSignalEvents.length;

      for (const event of normalizedSignalEvents) {
        const { leg, signalTime, entryPrice } = event;
        const stopLossPrice = this.computeStopLossPrice(entryPrice, leg);
        const takeProfitTargets = this.computeTakeProfitTargets(entryPrice, leg);
        const dedupeKey = [
          automation.id,
          item.symbol,
          timeframe,
          leg.side.toUpperCase(),
          signalTime.toISOString(),
          sourceSetupKey ?? '',
        ].join(':');
        const rationale = this.buildSuggestionRationale(leg, {
          score,
          confidence,
          sourceBacktestId,
          timeframe,
        });

        const created = await this.suggestedTradeRepository.createSuggestedTrade({
          automationId: automation.id,
          automationRunId: runId,
          userId: automation.userId,
          sourceBacktestId,
          sourceTemplateId: profileInfo.sourceTemplateId,
          sourceSetupKey,
          symbol: item.symbol,
          timeframe,
          side: leg.side === 'long' ? 'BUY' : 'SELL',
          signalTime,
          confidence,
          score,
          entryPrice,
          stopLossPrice,
          takeProfitTargets,
          entryRule: leg.entryRule,
          exitRule: leg.exitRule,
          rationale,
          dedupeKey,
          meta: {
            contractVersion: profile.contractVersion,
            market: profile.market,
            setupScore: score,
            confidence,
            sourceBacktestId,
            sourceSetupKey,
            evaluationMode: 'latest-closed-candle',
          },
        });

        if (created.duplicate) {
          duplicates += 1;
        } else {
          inserted += 1;
        }

        await this.automationRunOutputRepository.createOutput({
          automationId: automation.id,
          automationRunId: runId,
          userId: automation.userId,
          suggestedTradeId: created.item?.id ?? null,
          outputType: 'trade-suggestion.suggested-trade',
          status: created.duplicate ? 'Duplicate' : 'Created',
          title: `${item.symbol} ${timeframe} ${leg.side.toUpperCase()} suggestion`,
          dedupeKey,
          payload: {
            symbol: item.symbol,
            timeframe,
            side: leg.side,
            signalTime: signalTime.toISOString(),
            entryPrice: this.formatPrice(entryPrice),
            stopLossPrice,
            takeProfitTargets,
            sourceBacktestId,
            sourceTemplateId: profileInfo.sourceTemplateId,
            score,
            confidence,
          },
        });

        if (!latestTriggeredSignalTime || signalTime.getTime() > latestTriggeredSignalTime.getTime()) {
          latestTriggeredSignalTime = signalTime;
        }
      }

      await this.automationCursorRepository.upsertCursor({
        automationId: automation.id,
        userId: automation.userId,
        symbol: item.symbol,
        timeframe,
        lastEvaluatedSignalTime:
          latestClosedSignalTime && !Number.isNaN(latestClosedSignalTime.getTime())
            ? latestClosedSignalTime
            : currentCursor?.lastEvaluatedSignalTime ?? null,
        lastTriggeredSignalTime: latestTriggeredSignalTime,
        lastRunId: runId,
        lastStatus: 'signal',
        meta: {
          latestClosedSignalTime: latestClosedSignalTime?.toISOString() ?? null,
          evaluationMode: 'closed-candle-window',
          signalCount: normalizedSignalEvents.length,
        },
      });
    }

    if (evaluation.evaluatedSymbols === 0) {
      throw new BadRequestAppError(
        'No recent closed candles were available to evaluate this automation'
      );
    }

    await this.operationalEventService.logActivity(automation.userId, {
      type: 'Automation',
      title: `Trade suggestions generated: ${automation.name}`,
      status: 'Success',
      route: 'Automations',
      stream: 'Suggestions',
      referenceId: automation.id,
      description:
        signalsDetected > 0
          ? `Detected ${signalsDetected} signal(s), inserted ${inserted} suggestion(s), ${duplicates} duplicate(s), ${symbolsSkipped} symbol(s) skipped`
          : `No fresh entry signals detected across ${evaluation.evaluatedSymbols} evaluated symbol(s); ${symbolsSkipped} symbol(s) skipped`,
    });

    return {
      inserted,
      duplicates,
      symbolsProcessed,
      symbolsSkipped,
      symbolsEvaluated: evaluation.evaluatedSymbols,
      signalsDetected,
    };
  }

  private async syncBacktestRunnerRun(
    automation: Automation,
    run: AutomationRun
  ): Promise<void> {
    const meta = this.parseRecord(run.meta) ?? {};
    const lineage = this.parseRecord(meta.lineage) ?? {};
    const backtestId = this.readString(meta.backtestId, lineage.backtestId);
    if (!backtestId) {
      return;
    }

    const backtest = await this.backtestRepository.getBacktestById(automation.userId, backtestId);
    if (!backtest) {
      return;
    }

    const childStatus = this.resolveChildBacktestStatus(backtest);
    const progress = this.extractChildBacktestProgress(backtest);
    const summary = this.buildChildBacktestSummary(backtest);
    const nextMeta: Record<string, unknown> = {
      ...meta,
      backtestId,
      childBacktestStatus: childStatus,
      childBacktestUpdatedAt: backtest.updatedAt.toISOString(),
      ...(progress ? { backtestProgress: progress } : {}),
      ...(summary ? { backtestResultSummary: summary } : {}),
    };

    if (childStatus === 'Queued' || childStatus === 'Running') {
      delete nextMeta.backtestFinalizedAt;
      nextMeta.backtestLifecycle = 'pending';

      await this.automationRunRepository.updateRun(run.id, {
        status: 'Running',
        finishedAt: null,
        durationMs: null,
        errorMessage: null,
        workerId: null,
        lastProgressAt: backtest.updatedAt instanceof Date ? backtest.updatedAt : new Date(),
        meta: nextMeta,
      });
      return;
    }

    const finishedAt = backtest.updatedAt instanceof Date ? backtest.updatedAt : new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - run.startedAt.getTime());
    nextMeta.backtestLifecycle = 'finalized';
    nextMeta.backtestFinalizedAt = finishedAt.toISOString();

    if (childStatus === 'Completed') {
      await this.automationRunRepository.updateRun(run.id, {
        status: 'Success',
        finishedAt,
        durationMs,
        errorMessage: null,
        workerId: null,
        lastProgressAt: finishedAt,
        meta: nextMeta,
      });

      await this.automationRepository.createAutomationEvent({
        automationId: automation.id,
        type: 'Run completed',
        entity: 'Backtest',
        outcome: 'Success',
        meta: {
          backtestId,
          summary,
          lineage: this.buildRunLineage(
            normalizeAutomationConfig(
              normalizeAutomationType(automation.automationType, automation.config),
              automation.config
            ),
            backtestId
          ),
        },
      });

      await this.automationRunOutputRepository.createOutput({
        automationId: automation.id,
        automationRunId: run.id,
        userId: automation.userId,
        outputType: 'backtest-runner.summary',
        status: 'Created',
        title: 'Backtest runner execution completed',
        dedupeKey: 'final-summary',
        payload: {
          backtestId,
          childBacktestStatus: childStatus,
          summary,
          progress,
        },
      });

      await this.operationalEventService.logActivity(automation.userId, {
        type: 'Automation',
        title: `Backtest automation completed: ${automation.name}`,
        status: 'Success',
        route: 'Automations',
        stream: 'Runs',
        referenceId: automation.id,
        description: `Child backtest ${backtestId} completed with ${backtest.trades} trades`,
      });
      return;
    }

    const backtestConfig = this.parseRecord(backtest.result?.config) ?? {};
    const errorMessage =
      this.readString(
        this.parseRecord(backtestConfig.progress)?.error,
        backtestConfig.error,
        backtest.stability,
        backtest.status
      ) ?? 'Backtest execution failed';

    await this.automationRunRepository.updateRun(run.id, {
      status: 'Failed',
      finishedAt,
      durationMs,
      errorMessage,
      workerId: null,
      lastProgressAt: finishedAt,
      meta: nextMeta,
    });

    await this.automationRepository.createAutomationEvent({
      automationId: automation.id,
      type: 'Run failed',
      entity: 'Backtest',
      outcome: 'Failed',
      meta: {
        backtestId,
        error: errorMessage,
        summary,
        lineage: this.buildRunLineage(
          normalizeAutomationConfig(
            normalizeAutomationType(automation.automationType, automation.config),
            automation.config
          ),
          backtestId
        ),
      },
    });

    await this.automationRunOutputRepository.createOutput({
      automationId: automation.id,
      automationRunId: run.id,
      userId: automation.userId,
      outputType: 'backtest-runner.summary',
      status: 'Failed',
      title: 'Backtest runner execution failed',
      dedupeKey: 'final-summary',
      payload: {
        backtestId,
        childBacktestStatus: childStatus,
        summary,
        progress,
        error: errorMessage,
      },
    });

    await this.automationRepository.createAutomationAlert({
      automationId: automation.id,
      message: errorMessage,
      severity: 'high',
      status: 'open',
      meta: { backtestId },
    });

    await this.operationalEventService.logActivity(automation.userId, {
      type: 'Automation',
      title: `Backtest automation failed: ${automation.name}`,
      status: 'Failed',
      route: 'Automations',
      stream: 'Runs',
      referenceId: automation.id,
      description: `Child backtest ${backtestId} failed: ${errorMessage}`,
    });
  }

  private resolveChildBacktestStatus(backtest: Backtest): 'Queued' | 'Running' | 'Completed' | 'Failed' {
    const fromStatus = this.normalizeChildBacktestStatus(backtest.status);
    if (fromStatus) {
      return fromStatus;
    }

    const fromStability = this.normalizeChildBacktestStatus(backtest.stability);
    if (fromStability) {
      return fromStability;
    }

    const progressState = this.readString(
      this.parseRecord(this.parseRecord(backtest.result?.config)?.progress)?.state
    );
    const fromProgress = this.normalizeChildBacktestStatus(progressState);
    if (fromProgress) {
      return fromProgress;
    }

    return 'Queued';
  }

  private normalizeChildBacktestStatus(
    value: unknown
  ): 'Queued' | 'Running' | 'Completed' | 'Failed' | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized === 'failed' || normalized === 'error') {
      return 'Failed';
    }
    if (
      normalized === 'queued' ||
      normalized === 'running' ||
      normalized === 'started' ||
      normalized === 'processing' ||
      normalized === 'in_progress' ||
      normalized === 'in-progress'
    ) {
      return normalized === 'queued' ? 'Queued' : 'Running';
    }
    if (
      normalized === 'completed' ||
      normalized === 'complete' ||
      normalized === 'finished' ||
      normalized === 'done' ||
      normalized === 'success' ||
      normalized === 'succeeded' ||
      normalized === 'stable' ||
      normalized === 'review'
    ) {
      return 'Completed';
    }
    return null;
  }

  private extractChildBacktestProgress(backtest: Backtest): Record<string, unknown> | null {
    const config = this.parseRecord(backtest.result?.config) ?? {};
    const progress = this.parseRecord(config.progress);
    return progress ? { ...progress } : null;
  }

  private buildChildBacktestSummary(backtest: Backtest): Record<string, unknown> | null {
    const summary: Record<string, unknown> = {
      trades: typeof backtest.trades === 'number' ? backtest.trades : 0,
    };

    const cagr = this.readNumber(backtest.result?.cagr);
    if (cagr !== null) {
      summary.cagr = cagr;
    }
    const sharpe = this.readNumber(backtest.result?.sharpe);
    if (sharpe !== null) {
      summary.sharpe = sharpe;
    }
    const drawdown = this.readNumber(backtest.result?.drawdown);
    if (drawdown !== null) {
      summary.drawdown = drawdown;
    }
    const winRate = this.readNumber(backtest.result?.winRate);
    if (winRate !== null) {
      summary.winRate = winRate;
    }
    const profitFactor = this.readNumber(backtest.result?.profitFactor);
    if (profitFactor !== null) {
      summary.profitFactor = profitFactor;
    }

    return Object.keys(summary).length ? summary : null;
  }

  private parseRecord(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  private parseScheduledFor(value?: string): Date | null {
    if (!value) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000;
      const parsed = new Date(ms);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = (error as { code?: string }).code;
    return code === 'ER_DUP_ENTRY' || code === '23505';
  }

  private async resolveAutomationTimeZone(userId: string, automationTimeZone?: string | null): Promise<string> {
    const userTimeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    return normalizeTimeZone(automationTimeZone ?? userTimeZone, userTimeZone);
  }

  private buildRunLineage(
    config: Record<string, unknown> | null,
    backtestId?: string
  ): Record<string, unknown> | null {
    const lineage = extractAutomationLineage(config);
    if (!lineage && !backtestId) {
      return null;
    }
    const nextLineage: Record<string, unknown> = {
      ...(lineage ?? {}),
      ...(backtestId ? { backtestId } : {}),
    };
    return Object.keys(nextLineage).length ? nextLineage : null;
  }

  private async resolveTradeSuggestionProfile(
    userId: string,
    config: Record<string, unknown>
  ): Promise<{
    profile: StrategyTemplateAutomationProfile;
    sourceTemplateId: string | null;
    templateConfig: Record<string, unknown>;
  }> {
    const embeddedTemplate =
      this.parseRecord(config.template) ??
      this.parseRecord(this.parseRecord(config.inputSnapshot)?.template) ??
      this.parseRecord(this.parseRecord(config.tradeSuggestion)?.template);
    const embeddedTemplateConfig =
      this.parseRecord(embeddedTemplate?.config) ?? this.parseRecord(embeddedTemplate);

    if (embeddedTemplateConfig) {
      return {
        profile: buildStrategyTemplateAutomationProfile(embeddedTemplateConfig),
        sourceTemplateId: this.readString(
          embeddedTemplate?.id,
          embeddedTemplate?.templateId,
          config.sourceTemplateId,
          config.templateId
        ),
        templateConfig: embeddedTemplateConfig,
      };
    }

    const templateId = this.readString(
      config.sourceTemplateId,
      config.templateId,
      this.parseRecord(config.inputSnapshot)?.sourceTemplateId,
      this.parseRecord(config.inputSnapshot)?.templateId
    );
    if (!templateId) {
      throw new BadRequestAppError('trade-suggestion automation is missing a source template');
    }

    const template = await this.strategyTemplateRepository.getStrategyTemplateById(userId, templateId);
    if (!template) {
      throw new NotFoundAppError('Strategy template not found for trade-suggestion automation');
    }

    return {
      profile: buildStrategyTemplateAutomationProfile(template.config ?? null),
      sourceTemplateId: template.id,
      templateConfig:
        this.parseRecord(template.config) ?? {},
    };
  }

  private resolveTradeSuggestionCandleSettings(config: Record<string, unknown>): {
    maxBars: number | null;
    warmupBars: number | null;
    candlesTable: string | null;
    candlesSchema: string | null;
    candlesMaxRows: number | null;
  } {
    const nestedConfig = this.parseRecord(config.config) ?? {};
    const inputSnapshot = this.parseRecord(config.inputSnapshot) ?? {};
    const tradeSuggestion = this.parseRecord(config.tradeSuggestion) ?? {};

    const maxBars =
      this.readNumber(
        tradeSuggestion.signalEvaluationBars,
        config.signalEvaluationBars,
        nestedConfig.signalEvaluationBars,
        inputSnapshot.signalEvaluationBars,
        config.limit,
        nestedConfig.limit
      ) ?? null;
    const warmupBars =
      this.readNumber(
        tradeSuggestion.signalWarmupBars,
        config.signalWarmupBars,
        nestedConfig.signalWarmupBars,
        inputSnapshot.signalWarmupBars
      ) ?? null;
    const candlesMaxRows =
      this.readNumber(
        tradeSuggestion.candlesMaxRows,
        config.candlesMaxRows,
        nestedConfig.candlesMaxRows
      ) ?? null;

    return {
      maxBars:
        maxBars !== null && Number.isFinite(maxBars)
          ? Math.max(50, Math.round(maxBars))
          : null,
      warmupBars:
        warmupBars !== null && Number.isFinite(warmupBars)
          ? Math.max(10, Math.round(warmupBars))
          : null,
      candlesTable: this.readString(
        tradeSuggestion.candlesTable,
        config.candlesTable,
        nestedConfig.candlesTable
      ),
      candlesSchema: this.readString(
        tradeSuggestion.candlesSchema,
        config.candlesSchema,
        nestedConfig.candlesSchema
      ),
      candlesMaxRows:
        candlesMaxRows !== null && Number.isFinite(candlesMaxRows)
          ? Math.max(1000, Math.round(candlesMaxRows))
          : null,
    };
  }

  private resolveTradeSuggestionSymbols(config: Record<string, unknown>): string[] {
    const tradeSuggestion = this.parseRecord(config.tradeSuggestion) ?? {};
    const nestedConfig = this.parseRecord(config.config) ?? {};
    const inputSnapshot = this.parseRecord(config.inputSnapshot) ?? {};
    const setupScope = this.parseRecord(tradeSuggestion.setupScope) ?? this.parseRecord(config.setupScope);

    const direct = [
      this.readString(tradeSuggestion.symbol),
      this.readString(setupScope?.symbol),
      this.readString(config.symbol),
      this.readString(nestedConfig.symbol),
      this.readString(inputSnapshot.symbol),
    ].filter((item): item is string => Boolean(item));
    if (direct.length) {
      return Array.from(new Set(direct.map((item) => item.trim().toUpperCase())));
    }

    const assetsCandidates = [
      tradeSuggestion.assets,
      nestedConfig.assets,
      inputSnapshot.assets,
      config.assets,
    ];
    const symbols = assetsCandidates.flatMap((value) => this.extractSymbolsFromAssets(value));
    return Array.from(new Set(symbols.map((item) => item.trim().toUpperCase())));
  }

  private resolveTradeSuggestionTimeframe(config: Record<string, unknown>): string | null {
    const tradeSuggestion = this.parseRecord(config.tradeSuggestion) ?? {};
    const nestedConfig = this.parseRecord(config.config) ?? {};
    const inputSnapshot = this.parseRecord(config.inputSnapshot) ?? {};
    const setupScope = this.parseRecord(tradeSuggestion.setupScope) ?? this.parseRecord(config.setupScope);

    return (
      this.readString(
        tradeSuggestion.timeframe,
        setupScope?.timeframe,
        config.timeframe,
        nestedConfig.timeframe,
        Array.isArray(nestedConfig.timeframes) ? nestedConfig.timeframes[0] : null,
        Array.isArray(inputSnapshot.timeframes) ? inputSnapshot.timeframes[0] : null,
        Array.isArray(config.timeframes) ? config.timeframes[0] : null
      ) ?? null
    );
  }

  private extractSymbolsFromAssets(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.parseAssetSymbol(item))
      .filter((item): item is string => Boolean(item));
  }

  private parseAssetSymbol(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().toUpperCase();
    }
    const record = this.parseRecord(value);
    if (!record) {
      return null;
    }
    return this.readString(
      record.symbol,
      record.asset,
      record.ticker,
      record.sourceSymbol,
      record.source_symbol
    )?.toUpperCase() ?? null;
  }

  private computeStopLossPrice(
    entryPrice: number,
    leg: StrategyTemplateTradePlanLeg
  ): string | null {
    const pct = Number(leg.stopLossPct || 0);
    if (!Number.isFinite(entryPrice) || !Number.isFinite(pct) || pct <= 0) {
      return null;
    }
    const multiplier = leg.side === 'long' ? 1 - pct / 100 : 1 + pct / 100;
    return this.formatPrice(entryPrice * multiplier);
  }

  private computeTakeProfitTargets(
    entryPrice: number,
    leg: StrategyTemplateTradePlanLeg
  ): string[] {
    return (Array.isArray(leg.takeProfitTargetsPct) ? leg.takeProfitTargetsPct : [])
      .map((pct) => Number(pct))
      .filter((pct) => Number.isFinite(pct) && pct > 0)
      .map((pct) => {
        const multiplier = leg.side === 'long' ? 1 + pct / 100 : 1 - pct / 100;
        return this.formatPrice(entryPrice * multiplier);
      });
  }

  private formatPrice(value: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return value.toFixed(12).replace(/\.?0+$/, '');
  }

  private buildSuggestionRationale(
    leg: StrategyTemplateTradePlanLeg,
    context: {
      score: number | null;
      confidence: number | null;
      sourceBacktestId: string | null;
      timeframe: string;
    }
  ): string {
    const parts = [leg.rationale];
    if (context.score !== null) {
      parts.push(`Backtest setup score: ${context.score.toFixed(3)}.`);
    }
    if (context.confidence !== null) {
      parts.push(`Confidence: ${context.confidence.toFixed(3)}.`);
    }
    if (context.sourceBacktestId) {
      parts.push(`Derived from backtest ${context.sourceBacktestId}.`);
    }
    parts.push(`Execution timeframe: ${context.timeframe}.`);
    return parts.join(' ');
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
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }
}
