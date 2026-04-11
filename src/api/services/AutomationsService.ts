import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  AutomationActionResult,
  AutomationItem,
  AutomationsListResponse,
  AutomationsSummary,
  AutomationRunItem,
  AutomationRunListResponse,
} from '../contracts/Automation';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  AutomationSchedule,
  computeNextRun,
  normalizeAutomationScheduleRecord,
  resolveAutomationSchedule,
} from '../utils/automationSchedule';
import { extractAutomationLineage } from '../utils/automationLineage';
import { normalizeAutomationConfig, normalizeAutomationType } from '../utils/automationType';
import {
  AutomationActionBody,
  AutomationsQuery,
  CreateAutomationBody,
  UpdateAutomationBody,
  validateAutomationActionBody,
  validateAutomationCreateBody,
  validateAutomationId,
  validateAutomationUpdateBody,
  validateAutomationsQuery,
} from '../validators/automations.validator';
import { Automation, AutomationRun } from '../../database';
import {
  AutomationCursorRepository,
  AutomationRepository,
  AutomationRunRepository,
  BacktestRepository,
} from '../../database';
import { OperationalEventService } from './OperationalEventService';
import { UserTimeZoneService } from './UserTimeZoneService';
import { normalizeTimeZone } from '../utils/timezone';
import { validateListQuery } from '../validators/scheduler.validator';
import { formatDateInTimeZone } from '../utils/timezone';
import { AutomationExecutionService, ExecuteAutomationResult } from './AutomationExecutionService';
import { env } from '../../env';
import { RedisClient } from '../../lib/RedisClient';

@Service()
export class AutomationsService {
  private static readonly WORKER_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
  private static readonly CURSOR_STALE_MINUTES = 120;
  private static readonly TRADE_SUGGESTION_RUN_STALE_MINUTES = 20;
  private static readonly BACKTEST_RUN_STALE_MINUTES = 180;

  @Inject(() => AutomationRepository)
  private automationRepository!: AutomationRepository;

  @Inject(() => BacktestRepository)
  private backtestRepository!: BacktestRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  @Inject(() => AutomationRunRepository)
  private automationRunRepository!: AutomationRunRepository;

  @Inject(() => AutomationExecutionService)
  private automationExecutionService!: AutomationExecutionService;

  @Inject(() => AutomationCursorRepository)
  private automationCursorRepository!: AutomationCursorRepository;

  async getAutomations(
    userId: string,
    query: AutomationsQuery
  ): Promise<ApiSuccessResponse<AutomationsListResponse>> {
    const params = validateAutomationsQuery(query);
    const { data, total } = await this.automationRepository.listAutomations({
      ...params,
      userId,
    });

    return successResponse({
      items: data.map((automation) => this.mapAutomation(automation)),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getAutomationsSummary(userId: string): Promise<ApiSuccessResponse<AutomationsSummary>> {
    const [summary, diagnostics] = await Promise.all([
      this.automationRepository.getAutomationsSummary(userId),
      this.buildAutomationDiagnostics(userId),
    ]);

    return successResponse({
      running: summary.running,
      paused: summary.paused,
      connectedAccounts: summary.connectedAccounts,
      health: diagnostics.health,
      healthStatus: diagnostics.healthStatus,
      diagnostics: diagnostics.summary,
    });
  }

  async getAutomationOperationalSnapshot(): Promise<{
    total: number;
    running: number;
    paused: number;
    failed: number;
    draft: number;
    connectedAccounts: number;
    health: string;
    healthStatus: 'ok' | 'degraded' | 'down';
    detail: string | null;
    summary: NonNullable<AutomationsSummary['diagnostics']>;
  }> {
    const [summary, diagnostics] = await Promise.all([
      this.automationRepository.getAutomationsSummary(),
      this.buildAutomationDiagnostics(),
    ]);

    return {
      total: summary.total,
      running: summary.running,
      paused: summary.paused,
      failed: summary.failed,
      draft: summary.draft,
      connectedAccounts: summary.connectedAccounts,
      health: diagnostics.health,
      healthStatus: diagnostics.healthStatus,
      detail: diagnostics.detail,
      summary: diagnostics.summary,
    };
  }

  async getAutomationById(
    userId: string,
    automationId: string
  ): Promise<ApiSuccessResponse<AutomationItem>> {
    const automation = await this.requireAutomation(userId, automationId);
    await this.automationExecutionService.syncBacktestRunnerLifecycle(userId, automation.id);
    const refreshed = await this.requireAutomation(userId, automationId);
    return successResponse(this.mapAutomation(refreshed));
  }

  async getAutomationRuns(
    userId: string,
    automationId: string,
    query: { limit?: string; offset?: string }
  ): Promise<ApiSuccessResponse<AutomationRunListResponse>> {
    const automation = await this.requireAutomation(userId, automationId);
    await this.automationExecutionService.syncBacktestRunnerLifecycle(userId, automation.id);
    const { limit, offset } = validateListQuery(query);
    const timeZone = await this.resolveAutomationTimeZone(userId, automation.timeZone);
    const { items, total } = await this.automationRunRepository.listRunsByAutomation(
      automation.id,
      userId,
      limit,
      offset
    );

    return successResponse({
      items: items.map((item) => this.mapAutomationRun(item, timeZone)),
      total,
      limit,
      offset,
    });
  }

  async runAutomationNow(
    userId: string,
    automationId: string
  ): Promise<ApiSuccessResponse<ExecuteAutomationResult>> {
    const automation = await this.requireAutomation(userId, automationId);
    const normalizedStatus = String(automation.status || '').trim().toLowerCase();
    if (normalizedStatus !== 'running') {
      throw new BadRequestAppError(
        normalizedStatus === 'paused'
          ? 'Automation is paused. Resume it before running now.'
          : 'Automation must be running before manual execution.'
      );
    }

    const result = await this.automationExecutionService.execute({
      automationId,
      actorUserId: userId,
      trigger: 'manual',
    });
    return successResponse(result);
  }

  async reconcileAutomationState(
    userId: string,
    automationId: string,
    body: AutomationActionBody = {}
  ): Promise<ApiSuccessResponse<AutomationActionResult>> {
    const validatedAutomationId = validateAutomationId(automationId);
    try {
      const payload = validateAutomationActionBody(body);
      const automation = await this.requireAutomation(userId, validatedAutomationId);

      await this.automationExecutionService.syncBacktestRunnerLifecycle(userId, automation.id);

      const activeRuns = await this.automationRunRepository.listRunsByAutomationStatuses(
        automation.id,
        userId,
        ['Queued', 'Running'],
        10
      );

      let message = 'Automation state reconciled. No stuck runs required repair.';

      if (activeRuns.length) {
        const reconciliation = await this.reconcileActiveRun(
          userId,
          automation,
          activeRuns[0],
          payload.reason
        );
        message = reconciliation.message;
      }

      const refreshed = await this.requireAutomation(userId, validatedAutomationId);

      await this.automationRepository.createAutomationEvent({
        automationId: refreshed.id,
        type: 'State reconciled',
        entity: 'Operator',
        outcome: 'Success',
        meta: {
          reason: payload.reason ?? null,
          message,
        },
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: `Automation reconciled: ${refreshed.name}`,
        status: 'Success',
        route: 'Automations',
        stream: 'Recovery',
        related: refreshed.strategy,
        referenceId: refreshed.id,
        description: payload.reason || message,
      });

      return successResponse({
        message,
        automation: {
          id: refreshed.id,
          status: refreshed.status as AutomationActionResult['automation']['status'],
          updatedAt: refreshed.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: 'Automation reconcile failed',
        status: 'Failed',
        route: 'Automations',
        stream: 'Recovery',
        referenceId: validatedAutomationId,
        description: error instanceof Error ? error.message : String(error),
        flags: [
          {
            id: 'automation-reconcile-review',
            message: 'Review worker, run history, and child backtest state before retrying reconcile.',
            channel: 'Automations',
            time: new Date().toISOString(),
            status: 'Needs review',
          },
        ],
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Automation',
        source: 'automations:recovery',
        message: `Automation reconcile failed (${validatedAutomationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async pauseAutomation(
    userId: string,
    automationId: string,
    body: AutomationActionBody = {}
  ): Promise<ApiSuccessResponse<AutomationActionResult>> {
    const validatedAutomationId = validateAutomationId(automationId);
    try {
      const payload = validateAutomationActionBody(body);
      const existing = await this.requireAutomation(userId, validatedAutomationId);
      if (String(existing.status || '').trim().toLowerCase() === 'paused') {
        return successResponse({
          message: 'Automation already paused',
          automation: {
            id: existing.id,
            status: existing.status as AutomationActionResult['automation']['status'],
            updatedAt: existing.updatedAt.toISOString(),
          },
        });
      }

      await this.automationRepository.updateAutomationStatus(
        userId,
        validatedAutomationId,
        'Paused',
        null
      );
      await this.automationRepository.createAutomationEvent({
        automationId: validatedAutomationId,
        type: 'Bot paused',
        outcome: 'Operator review',
      });

      const automation = await this.requireAutomation(userId, validatedAutomationId);

      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: `Automation paused: ${automation.name}`,
        status: 'Success',
        route: 'Automations',
        stream: 'Controls',
        related: automation.strategy,
        referenceId: automation.id,
        description: payload.reason || 'Automation paused by operator',
        flags: [
          {
            id: 'automation-paused',
            message: 'Next run has been cleared pending operator review.',
            channel: 'Automations',
            time: new Date().toISOString(),
            status: 'Ready',
          },
        ],
      });

      return successResponse({
        message: 'Automation paused',
        automation: {
          id: automation.id,
          status: automation.status as AutomationActionResult['automation']['status'],
          updatedAt: automation.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: 'Automation pause failed',
        status: 'Failed',
        route: 'Automations',
        stream: 'Controls',
        referenceId: validatedAutomationId,
        description: error instanceof Error ? error.message : String(error),
        flags: [
          {
            id: 'automation-pause-review',
            message: 'Review automation state before retrying the pause action.',
            channel: 'Automations',
            time: new Date().toISOString(),
            status: 'Needs review',
          },
        ],
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Automation',
        source: 'automations',
        message: `Automation pause failed (${validatedAutomationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async resumeAutomation(
    userId: string,
    automationId: string,
    body: AutomationActionBody = {}
  ): Promise<ApiSuccessResponse<AutomationActionResult>> {
    const validatedAutomationId = validateAutomationId(automationId);
    try {
      const payload = validateAutomationActionBody(body);
      const automation = await this.requireAutomation(userId, validatedAutomationId);
      const schedule = resolveAutomationSchedule(automation.schedule ?? null, automation.trigger);
      if (!schedule) {
        throw new BadRequestAppError('schedule is required to resume automation');
      }
      const timeZone = await this.resolveAutomationTimeZone(userId, automation.timeZone);
      const nextRun = computeNextRun(schedule, timeZone, new Date());
      if (!nextRun) {
        throw new BadRequestAppError('Unable to compute next run from schedule');
      }

      const normalizedStatus = String(automation.status || '').trim().toLowerCase();
      if (normalizedStatus === 'running' && automation.nextRun instanceof Date) {
        return successResponse({
          message: 'Automation already running',
          automation: {
            id: automation.id,
            status: automation.status as AutomationActionResult['automation']['status'],
            updatedAt: automation.updatedAt.toISOString(),
          },
        });
      }

      await this.automationRepository.updateAutomationStatus(
        userId,
        validatedAutomationId,
        'Running',
        nextRun
      );
      await this.automationRepository.createAutomationEvent({
        automationId: validatedAutomationId,
        type: 'Bot resumed',
        outcome: 'Success',
      });

      const updated = await this.requireAutomation(userId, validatedAutomationId);

      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: `Automation resumed: ${updated.name}`,
        status: 'Success',
        route: 'Automations',
        stream: 'Controls',
        related: updated.strategy,
        referenceId: updated.id,
        description: payload.reason || 'Automation resumed by operator',
        flags: [
          {
            id: 'automation-resumed',
            message: 'Next run has been recalculated from the active schedule.',
            channel: 'Automations',
            time: new Date().toISOString(),
            status: 'Ready',
          },
        ],
      });

      return successResponse({
        message: 'Automation resumed',
        automation: {
          id: updated.id,
          status: updated.status as AutomationActionResult['automation']['status'],
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: 'Automation resume failed',
        status: 'Failed',
        route: 'Automations',
        stream: 'Controls',
        referenceId: validatedAutomationId,
        description: error instanceof Error ? error.message : String(error),
        flags: [
          {
            id: 'automation-resume-review',
            message: 'Verify schedule configuration before resuming this automation.',
            channel: 'Automations',
            time: new Date().toISOString(),
            status: 'Needs review',
          },
        ],
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Automation',
        source: 'automations',
        message: `Automation resume failed (${validatedAutomationId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async createAutomation(
    userId: string,
    body: CreateAutomationBody
  ): Promise<ApiSuccessResponse<AutomationItem>> {
    const validated = validateAutomationCreateBody(body);
    const normalizedConfig = await this.prepareAutomationConfig(
      userId,
      validated.automationType,
      validated.config
    );
    const scheduleCandidate = resolveAutomationSchedule(validated.schedule ?? null, validated.trigger);
    const resolvedFields = this.deriveAutomationCoreFields(validated.automationType, normalizedConfig, {
      name: validated.name,
      strategy: validated.strategy,
      broker: validated.broker,
      market: validated.market,
      trigger: validated.trigger,
      schedule: scheduleCandidate,
    });
    const schedule = resolveAutomationSchedule(validated.schedule ?? null, resolvedFields.trigger);
    const normalizedSchedule = normalizeAutomationScheduleRecord(
      validated.schedule ?? null,
      resolvedFields.trigger
    );
    if (validated.status === 'Running' && !schedule) {
      throw new BadRequestAppError('schedule is required to create a running automation');
    }
    const timeZone = await this.resolveAutomationTimeZone(userId, validated.timeZone);
    const nextRun =
      validated.status === 'Running' && schedule ? computeNextRun(schedule, timeZone, new Date()) : null;
    if (validated.status === 'Running' && !nextRun) {
      throw new BadRequestAppError('Unable to compute next run from schedule');
    }
    const automation = await this.automationRepository.createAutomation({
      userId,
      name: validated.name,
      strategy: resolvedFields.strategy,
      broker: resolvedFields.broker,
      market: resolvedFields.market,
      trigger: resolvedFields.trigger,
      status: validated.status,
      automationType: validated.automationType,
      timeZone: validated.timeZone,
      schedule: normalizedSchedule,
      riskMode: validated.riskMode ?? null,
      config: normalizedConfig,
    });
    if (nextRun) {
      automation.nextRun = nextRun;
      await this.automationRepository.saveAutomation(automation);
    }

    await this.automationRepository.createAutomationEvent({
      automationId: automation.id,
      type: 'Created',
      entity: 'Manual',
      outcome: 'Success',
    });

    return successResponse(this.mapAutomation(automation));
  }

  async updateAutomation(
    userId: string,
    automationId: string,
    body: UpdateAutomationBody
  ): Promise<ApiSuccessResponse<AutomationItem>> {
    const validatedAutomationId = validateAutomationId(automationId);
    const validated = validateAutomationUpdateBody(body);
    const automation = await this.requireAutomation(userId, validatedAutomationId);
    const nextAutomationType =
      validated.automationType ??
      normalizeAutomationType(automation.automationType, automation.config);
    const nextConfigInput = validated.config === undefined ? automation.config : validated.config;
    const nextConfig = await this.prepareAutomationConfig(userId, nextAutomationType, nextConfigInput);
    const nextSchedule =
      validated.schedule === undefined ? automation.schedule : validated.schedule;
    const nextTimeZone =
      validated.timeZone === undefined ? automation.timeZone : validated.timeZone;
    const scheduleCandidate = resolveAutomationSchedule(
      nextSchedule ?? null,
      validated.trigger ?? automation.trigger
    );
    const resolvedFields = this.deriveAutomationCoreFields(nextAutomationType, nextConfig, {
      name: validated.name ?? automation.name,
      strategy: validated.strategy ?? automation.strategy,
      broker: validated.broker ?? automation.broker,
      market: validated.market ?? automation.market,
      trigger: validated.trigger ?? automation.trigger,
      schedule: scheduleCandidate,
    });

    const nextStatus = validated.status ?? automation.status;
    const nextTrigger = resolvedFields.trigger;

    const schedule = resolveAutomationSchedule(nextSchedule ?? null, nextTrigger);
    const normalizedSchedule = normalizeAutomationScheduleRecord(nextSchedule ?? null, nextTrigger);
    if (nextStatus === 'Running' && !schedule) {
      throw new BadRequestAppError('schedule is required to run automation');
    }
    const timeZone = await this.resolveAutomationTimeZone(userId, nextTimeZone);
    const nextRun =
      nextStatus === 'Running' && schedule ? computeNextRun(schedule, timeZone, new Date()) : null;
    if (nextStatus === 'Running' && !nextRun) {
      throw new BadRequestAppError('Unable to compute next run from schedule');
    }

    Object.assign(automation, {
      name: resolvedFields.name,
      strategy: resolvedFields.strategy,
      broker: resolvedFields.broker,
      market: resolvedFields.market,
      trigger: resolvedFields.trigger,
      status: nextStatus,
      automationType: nextAutomationType,
      timeZone: nextTimeZone ?? automation.timeZone,
      schedule: normalizedSchedule,
      riskMode: validated.riskMode === undefined ? automation.riskMode : validated.riskMode,
      config: nextConfig,
      nextRun,
    });

    const saved = await this.automationRepository.saveAutomation(automation);

    await this.automationRepository.createAutomationEvent({
      automationId: saved.id,
      type: 'Updated',
      entity: 'Manual',
      outcome: 'Success',
    });

    return successResponse(this.mapAutomation(saved));
  }

  private async requireAutomation(userId: string, automationId: string): Promise<Automation> {
    const validatedAutomationId = validateAutomationId(automationId);
    const automation = await this.automationRepository.getAutomationById(userId, validatedAutomationId);

    if (!automation) {
      throw new NotFoundAppError('Automation not found');
    }

    return automation;
  }

  private mapAutomation(automation: Automation): AutomationItem {
    const automationType = normalizeAutomationType(automation.automationType, automation.config);
    const normalizedConfig = normalizeAutomationConfig(automationType, automation.config);
    const derivedFields = this.deriveAutomationCoreFields(automationType, normalizedConfig, {
      name: automation.name,
      strategy: automation.strategy,
      broker: automation.broker,
      market: automation.market,
      trigger: automation.trigger,
    });
    const lineage = extractAutomationLineage(normalizedConfig);

    return {
      id: automation.id,
      automationType,
      name: derivedFields.name,
      strategy: derivedFields.strategy,
      broker: derivedFields.broker,
      market: derivedFields.market,
      trigger: derivedFields.trigger,
      status: automation.status as AutomationItem['status'],
      lastRun: automation.lastRun ? automation.lastRun.toISOString() : '--',
      nextRun: automation.nextRun ? automation.nextRun.toISOString() : 'Paused',
      timeZone: automation.timeZone ?? null,
      schedule: automation.schedule ?? null,
      accounts: automation.accounts,
      riskMode: automation.riskMode ?? '--',
      config: normalizedConfig,
      lineage,
      updatedAt: automation.updatedAt.toISOString(),
      events: (automation.events ?? []).map((event) => ({
        id: event.id,
        type: event.type,
        entity: event.entity ?? '--',
        time: event.createdAt.toISOString(),
        outcome: event.outcome ?? '--',
        lineage: extractAutomationLineage(event.meta?.lineage ?? event.meta),
      })),
      alerts: (automation.alerts ?? []).map((alert) => ({
        id: alert.id,
        message: alert.message,
        time: alert.createdAt.toISOString(),
        severity: alert.severity,
        status: alert.status,
        lineage: extractAutomationLineage(alert.meta?.lineage ?? alert.meta),
      })),
    };
  }

  private mapAutomationRun(run: AutomationRun, timeZone: string): AutomationRunItem {
    const meta =
      run?.meta && typeof run.meta === 'object' && !Array.isArray(run.meta)
        ? (run.meta as Record<string, unknown>)
        : {};
    const lineage = extractAutomationLineage(meta.lineage ?? meta);
    const backtestId =
      typeof meta.backtestId === 'string' && meta.backtestId.trim()
        ? meta.backtestId
        : lineage?.backtestId ?? null;
    const backtestStatus =
      typeof meta.childBacktestStatus === 'string' && meta.childBacktestStatus.trim()
        ? meta.childBacktestStatus
        : null;
    const trigger =
      typeof meta.trigger === 'string' && meta.trigger.trim() ? meta.trigger : null;
    const backtestProgress =
      meta.backtestProgress && typeof meta.backtestProgress === 'object' && !Array.isArray(meta.backtestProgress)
        ? (meta.backtestProgress as Record<string, unknown>)
        : null;
    const resultSummary =
      meta.backtestResultSummary &&
      typeof meta.backtestResultSummary === 'object' &&
      !Array.isArray(meta.backtestResultSummary)
        ? (meta.backtestResultSummary as Record<string, unknown>)
        : null;
    const recovery = this.buildAutomationRunRecovery(run, backtestId, backtestStatus);

    return {
      id: run.id,
      status: run.status,
      scheduledFor: run.scheduledFor ? formatDateInTimeZone(run.scheduledFor, timeZone) : undefined,
      scheduledForIso: run.scheduledFor ? run.scheduledFor.toISOString() : undefined,
      startedAt: formatDateInTimeZone(run.startedAt, timeZone) ?? new Date().toISOString(),
      startedAtIso: run.startedAt ? run.startedAt.toISOString() : undefined,
      finishedAt: run.finishedAt ? formatDateInTimeZone(run.finishedAt, timeZone) : undefined,
      finishedAtIso: run.finishedAt ? run.finishedAt.toISOString() : undefined,
      durationMs: run.durationMs ?? null,
      errorMessage: run.errorMessage ?? null,
      backtestId,
      backtestStatus,
      backtestProgress,
      resultSummary,
      trigger,
      lineage,
      recovery,
    };
  }

  private async reconcileActiveRun(
    userId: string,
    automation: Automation,
    run: AutomationRun,
    reason?: string
  ): Promise<{ message: string }> {
    const meta = this.parseRecord(run.meta) ?? {};
    const lineage = extractAutomationLineage(meta.lineage ?? meta);
    const backtestId = this.readString(meta.backtestId, lineage?.backtestId);

    if (backtestId) {
      await this.automationExecutionService.syncBacktestRunnerLifecycleByBacktestId(backtestId);
      const syncedRun = await this.automationRunRepository.findById(run.id);
      if (syncedRun && !this.isAutomationRunActive(syncedRun.status)) {
        return {
          message: `Automation state reconciled from child backtest ${backtestId}.`,
        };
      }

      const childBacktest = await this.backtestRepository.getBacktestById(userId, backtestId);
      const childStatus = childBacktest
        ? this.resolveChildBacktestStatus(childBacktest.status, childBacktest.stability)
        : null;

      if (childStatus === 'Queued' || childStatus === 'Running') {
        return {
          message: `Child backtest ${backtestId} is still ${childStatus.toLowerCase()}. No stale run was cleared.`,
        };
      }
    }

    const recovery = this.buildAutomationRunRecovery(run, backtestId, null);
    if (!recovery?.isStaleCandidate) {
      return {
        message:
          recovery?.note ||
          'Automation state reconciled. Active run is still within the guarded recovery window.',
      };
    }

    await this.clearStaleAutomationRun(userId, automation, run, {
      backtestId,
      reason,
    });

    return {
      message: backtestId
        ? `Cleared stale automation run and released child backtest ${backtestId} for operator review.`
        : 'Cleared stale automation run and restored normal scheduling.',
    };
  }

  private async clearStaleAutomationRun(
    userId: string,
    automation: Automation,
    run: AutomationRun,
    options: { backtestId?: string | null; reason?: string }
  ): Promise<void> {
    const finishedAt = new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - run.startedAt.getTime());
    const meta = this.parseRecord(run.meta) ?? {};
    const nextMeta: Record<string, unknown> = {
      ...meta,
      repair: {
        mode: 'stale-run-clear',
        repairedAt: finishedAt.toISOString(),
        repairedBy: userId,
        reason: options.reason ?? null,
        previousStatus: run.status,
      },
    };

    await this.automationRunRepository.updateRun(run.id, {
      status: 'Failed',
      finishedAt,
      durationMs,
      errorMessage:
        options.reason?.trim() ||
        'Operator reconciled a stale active run after no terminal update was received.',
      meta: nextMeta,
    });

    let nextRun: Date | null | undefined = undefined;
    if (String(automation.status || '').toLowerCase() === 'running') {
      const schedule = resolveAutomationSchedule(automation.schedule ?? null, automation.trigger);
      if (schedule) {
        const timeZone = await this.resolveAutomationTimeZone(userId, automation.timeZone);
        nextRun = computeNextRun(schedule, timeZone, finishedAt);
      }
    }

    await this.automationRepository.updateAutomationStatus(
      userId,
      automation.id,
      automation.status,
      nextRun
    );

    await this.automationRepository.createAutomationEvent({
      automationId: automation.id,
      type: 'Run reconciled',
      entity: 'Operator',
      outcome: 'Recovered',
      meta: {
        runId: run.id,
        backtestId: options.backtestId ?? null,
        reason: options.reason ?? null,
        previousStatus: run.status,
      },
    });
  }

  private async resolveAutomationTimeZone(
    userId: string,
    automationTimeZone?: string | null
  ): Promise<string> {
    const userTimeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    return normalizeTimeZone(automationTimeZone ?? userTimeZone, userTimeZone);
  }

  private async readWorkerHttpHealth(
    workerEndpoint: string
  ): Promise<{ status: 'ok' | 'down'; detail?: string }> {
    const healthUrl = `${String(workerEndpoint).replace(/\/+$/, '')}/health`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          status: 'down',
          detail: `Worker health HTTP ${response.status}`,
        };
      }
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'down',
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async buildAutomationDiagnostics(userId?: string | null): Promise<{
    health: string;
    healthStatus: 'ok' | 'degraded' | 'down';
    detail: string | null;
    summary: NonNullable<AutomationsSummary['diagnostics']>;
  }> {
    const normalizedUserId = this.readString(userId);
    const now = Date.now();
    const since = new Date(now - 24 * 60 * 60 * 1000);
    const staleBefore = new Date(
      now - AutomationsService.CURSOR_STALE_MINUTES * 60 * 1000
    );

    const [queueHealth, workerHealth, runDiagnostics, eventDiagnostics, cursorDiagnostics] =
      await Promise.all([
        this.readQueueHealth(),
        this.readWorkerHealth(),
        normalizedUserId
          ? this.automationRunRepository.getUserRunDiagnostics(normalizedUserId, since)
          : this.automationRunRepository.getOperationalRunDiagnostics(since),
        this.automationRepository.getAutomationEventDiagnostics(normalizedUserId, since),
        normalizedUserId
          ? this.automationCursorRepository.getUserCursorDiagnostics(normalizedUserId, staleBefore)
          : this.automationCursorRepository.getOperationalCursorDiagnostics(staleBefore),
      ]);

    let healthStatus: 'ok' | 'degraded' | 'down' = 'ok';
    const issues: string[] = [];

    if (queueHealth.status === 'down') {
      healthStatus = 'down';
      issues.push(queueHealth.detail || 'Redis queue transport is unavailable');
    }

    if (workerHealth.status === 'down') {
      healthStatus = 'down';
      issues.push(workerHealth.detail || 'Automation worker heartbeat is missing');
    } else if (workerHealth.status === 'degraded' && healthStatus !== 'down') {
      healthStatus = 'degraded';
      if (workerHealth.detail) {
        issues.push(workerHealth.detail);
      }
    }

    if (healthStatus === 'ok' && runDiagnostics.failedRuns24h > 0) {
      healthStatus = 'degraded';
      issues.push(
        `${runDiagnostics.failedRuns24h} automation run${
          runDiagnostics.failedRuns24h === 1 ? '' : 's'
        } failed in the last 24h`
      );
    }

    if (healthStatus === 'ok' && eventDiagnostics.overlapSkips24h > 0) {
      healthStatus = 'degraded';
      issues.push(
        `${eventDiagnostics.overlapSkips24h} run${
          eventDiagnostics.overlapSkips24h === 1 ? '' : 's'
        } skipped due to overlap protection in the last 24h`
      );
    }

    if (healthStatus === 'ok' && cursorDiagnostics.staleCursorCount > 0) {
      healthStatus = 'degraded';
      issues.push(
        `${cursorDiagnostics.staleCursorCount} stale cursor${
          cursorDiagnostics.staleCursorCount === 1 ? '' : 's'
        } older than ${AutomationsService.CURSOR_STALE_MINUTES} minutes`
      );
    }

    const health =
      healthStatus === 'ok' ? 'Healthy' : healthStatus === 'down' ? 'Down' : 'Degraded';

    return {
      health,
      healthStatus,
      detail: issues.length > 0 ? issues.join(' ') : null,
      summary: {
        workerStatus: workerHealth.status,
        workerHttpStatus: workerHealth.workerHttpStatus,
        heartbeatStatus: workerHealth.heartbeatStatus,
        workerDetail: issues[0] ?? workerHealth.detail ?? null,
        workerHeartbeatAgeMs: workerHealth.heartbeatAgeMs,
        commandPollLagMs: workerHealth.commandPollLagMs,
        queueStatus: queueHealth.status,
        queueLatencyMs: queueHealth.latencyMs,
        activeRuns: runDiagnostics.activeRuns,
        failedRuns24h: runDiagnostics.failedRuns24h,
        overlapSkips24h: eventDiagnostics.overlapSkips24h,
        staleCursorCount: cursorDiagnostics.staleCursorCount,
        totalCursorCount: cursorDiagnostics.totalCursorCount,
        staleCursorThresholdMinutes: AutomationsService.CURSOR_STALE_MINUTES,
        lastCursorAt: cursorDiagnostics.lastCursorAt,
        lastTriggeredSignalAt: cursorDiagnostics.lastTriggeredSignalAt,
      },
    };
  }

  private async readQueueHealth(): Promise<{
    status: 'ok' | 'down';
    latencyMs?: number;
    detail?: string;
  }> {
    const startedAt = Date.now();
    try {
      const pong = await RedisClient.getConnection().ping();
      const latencyMs = Date.now() - startedAt;
      return {
        status: pong === 'PONG' ? 'ok' : 'down',
        latencyMs,
        ...(pong === 'PONG' ? {} : { detail: `Unexpected Redis ping response: ${pong}` }),
      };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async readWorkerHealth(): Promise<{
    status: 'ok' | 'degraded' | 'down';
    heartbeatStatus?: 'ok' | 'down';
    workerHttpStatus?: 'ok' | 'down';
    heartbeatAgeMs?: number;
    commandPollLagMs?: number;
    detail?: string;
  }> {
    const heartbeatKey = env.redis.workerHeartbeatKey;
    const workerEndpoint = env.scheduler.worker.baseUrl;
    const workerHttpHealth = await this.readWorkerHttpHealth(workerEndpoint);

    try {
      const rawHeartbeat = await RedisClient.getConnection().get(heartbeatKey);
      if (!rawHeartbeat) {
        return {
          status: 'down',
          heartbeatStatus: 'down',
          workerHttpStatus: workerHttpHealth.status,
          detail:
            workerHttpHealth.status === 'down'
              ? `No active worker heartbeat found; worker health check failed: ${
                  workerHttpHealth.detail || 'unknown error'
                }`
              : 'No active worker heartbeat found',
        };
      }

      let parsed: {
        timestamp?: string;
        lastCommandPollAt?: string;
      } = {};
      try {
        parsed = JSON.parse(rawHeartbeat) as {
          timestamp?: string;
          lastCommandPollAt?: string;
        };
      } catch {
        parsed = {};
      }

      const heartbeatDate = parsed.timestamp ? new Date(parsed.timestamp) : null;
      const commandPollDate = parsed.lastCommandPollAt
        ? new Date(parsed.lastCommandPollAt)
        : null;
      const heartbeatAgeMs =
        heartbeatDate && !Number.isNaN(heartbeatDate.getTime())
          ? Math.max(0, Date.now() - heartbeatDate.getTime())
          : undefined;
      const commandPollLagMs =
        commandPollDate && !Number.isNaN(commandPollDate.getTime())
          ? Math.max(0, Date.now() - commandPollDate.getTime())
          : undefined;

      const heartbeatStale =
        typeof heartbeatAgeMs === 'number' &&
        heartbeatAgeMs > AutomationsService.WORKER_HEARTBEAT_STALE_MS;
      const pollLagStale =
        typeof commandPollLagMs === 'number' &&
        commandPollLagMs > AutomationsService.WORKER_HEARTBEAT_STALE_MS;

      if (workerHttpHealth.status === 'down' || heartbeatStale || pollLagStale) {
        const detailParts = [
          workerHttpHealth.status === 'down'
            ? `Worker HTTP health failed: ${workerHttpHealth.detail || 'unknown error'}`
            : null,
          heartbeatStale
            ? `Worker heartbeat is stale by ${Math.round((heartbeatAgeMs ?? 0) / 1000)}s`
            : null,
          pollLagStale
            ? `Command polling is stale by ${Math.round((commandPollLagMs ?? 0) / 1000)}s`
            : null,
        ].filter(Boolean);

        return {
          status: 'degraded',
          heartbeatStatus: 'ok',
          workerHttpStatus: workerHttpHealth.status,
          heartbeatAgeMs,
          commandPollLagMs,
          detail: detailParts.join(' · ') || 'Worker heartbeat is stale',
        };
      }

      return {
        status: 'ok',
        heartbeatStatus: 'ok',
        workerHttpStatus: workerHttpHealth.status,
        heartbeatAgeMs,
        commandPollLagMs,
      };
    } catch (error) {
      return {
        status: 'down',
        heartbeatStatus: 'down',
        workerHttpStatus: workerHttpHealth.status,
        detail:
          error instanceof Error
            ? `Redis heartbeat read failed: ${error.message}`
            : `Redis heartbeat read failed: ${String(error)}`,
      };
    }
  }

  private buildAutomationRunRecovery(
    run: AutomationRun,
    backtestId: string | null,
    backtestStatus: string | null
  ): AutomationRunItem['recovery'] {
    const normalizedStatus = String(run.status || '').trim().toLowerCase();
    const active = normalizedStatus === 'queued' || normalizedStatus === 'running';
    const canRetry = normalizedStatus === 'failed';
    const staleThresholdMinutes = active
      ? backtestId
        ? AutomationsService.BACKTEST_RUN_STALE_MINUTES
        : AutomationsService.TRADE_SUGGESTION_RUN_STALE_MINUTES
      : null;
    const backtestPending =
      String(backtestStatus || '').toLowerCase() === 'queued' ||
      String(backtestStatus || '').toLowerCase() === 'running';
    const ageMs =
      run.startedAt instanceof Date ? Math.max(0, Date.now() - run.startedAt.getTime()) : 0;
    const isStaleCandidate = Boolean(
      active &&
        staleThresholdMinutes &&
        ageMs >= staleThresholdMinutes * 60 * 1000 &&
        !backtestPending
    );

    let note: string | null = null;
    if (isStaleCandidate) {
      note = `No terminal update arrived within ${staleThresholdMinutes} minutes. Reconcile can clear this stale run if the worker is no longer active.`;
    } else if (active && backtestPending) {
      note = `Child backtest is still ${String(backtestStatus).toLowerCase()}. Reconcile will sync lifecycle before attempting any repair.`;
    } else if (active && staleThresholdMinutes) {
      note = `Run is active. Reconcile only clears it after ${staleThresholdMinutes} minutes without a terminal update.`;
    } else if (canRetry) {
      note = 'Retry is safe once no active run is blocking this automation.';
    }

    return {
      active,
      canReconcile: active,
      canRetry,
      isStaleCandidate,
      staleThresholdMinutes,
      note,
    };
  }

  private isAutomationRunActive(status: string | null | undefined): boolean {
    const normalized = String(status || '').trim().toLowerCase();
    return normalized === 'queued' || normalized === 'running';
  }

  private resolveChildBacktestStatus(
    status: unknown,
    stability: unknown
  ): 'Queued' | 'Running' | 'Completed' | 'Failed' | null {
    const normalize = (value: unknown): 'Queued' | 'Running' | 'Completed' | 'Failed' | null => {
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
        normalized === 'succeeded'
      ) {
        return 'Completed';
      }
      return null;
    };

    return normalize(status) ?? normalize(stability);
  }

  private async prepareAutomationConfig(
    userId: string,
    automationType: AutomationItem['automationType'],
    rawConfig: Record<string, unknown> | null
  ): Promise<Record<string, unknown> | null> {
    const normalizedType = normalizeAutomationType(automationType, rawConfig);
    const normalizedConfig = normalizeAutomationConfig(normalizedType, rawConfig);

    if (normalizedType === 'backtest-runner') {
      return this.prepareBacktestRunnerConfig(userId, normalizedConfig);
    }

    return this.prepareTradeSuggestionConfig(userId, normalizedConfig);
  }

  private async prepareBacktestRunnerConfig(
    userId: string,
    rawConfig: Record<string, unknown> | null
  ): Promise<Record<string, unknown> | null> {
    const normalized = normalizeAutomationConfig('backtest-runner', rawConfig);
    const root = this.parseRecord(normalized) ?? {};
    const runner = this.parseRecord(root.backtestRunner) ?? {};
    const backtestId = this.readString(root.backtestId, runner.backtestId);
    if (!backtestId) {
      return normalized;
    }

    const sourceBacktest = await this.backtestRepository.getBacktestById(userId, backtestId);
    if (!sourceBacktest) {
      throw new NotFoundAppError('Source backtest not found for backtest-runner automation');
    }

    const sourceConfig = this.parseRecord(sourceBacktest.result?.config) ?? {};
    const inputSnapshot = this.parseRecord(sourceConfig.inputSnapshot) ?? {};
    const clonedRunBody = this.sanitizeBacktestRunnerSourceConfig(
      this.parseRecord(runner.runBody) ?? this.parseRecord(root.config) ?? sourceConfig
    );
    const market = this.readString(root.market, sourceConfig.market, inputSnapshot.market) ?? 'crypto-futures';
    const source = this.readString(runner.source, root.source) ?? 'backtest';

    return normalizeAutomationConfig('backtest-runner', {
      ...root,
      source,
      backtestId,
      strategy: this.readString(root.strategy, sourceBacktest.strategy) ?? 'Backtest Runner',
      market,
      config: clonedRunBody,
      backtestRunner: {
        ...runner,
        kind: 'backtest-runner',
        source,
        backtestId,
        runBody: clonedRunBody,
      },
    });
  }

  private async prepareTradeSuggestionConfig(
    userId: string,
    rawConfig: Record<string, unknown> | null
  ): Promise<Record<string, unknown> | null> {
    const normalized = normalizeAutomationConfig('trade-suggestion', rawConfig);
    const root = this.parseRecord(normalized) ?? {};
    const tradeSuggestion = this.parseRecord(root.tradeSuggestion) ?? {};
    const setupScope = this.parseRecord(tradeSuggestion.setupScope) ?? this.parseRecord(root.setupScope);
    const backtestId = this.readString(root.backtestId, tradeSuggestion.backtestId);
    const symbol = this.readString(root.symbol, tradeSuggestion.symbol, setupScope?.symbol);
    const timeframe = this.readString(root.timeframe, tradeSuggestion.timeframe, setupScope?.timeframe);

    if (!backtestId) {
      return normalized;
    }

    const sourceBacktest = await this.backtestRepository.getBacktestById(userId, backtestId);
    if (!sourceBacktest) {
      throw new NotFoundAppError('Source backtest not found for trade-suggestion automation');
    }

    const sourceConfig = this.parseRecord(sourceBacktest.result?.config) ?? {};
    const inputSnapshot = this.parseRecord(sourceConfig.inputSnapshot) ?? {};
    const template = this.parseRecord(inputSnapshot.template) ?? this.parseRecord(sourceConfig.template) ?? {};
    const hydratedSetupScope =
      setupScope ?? this.findBacktestSetupScope(sourceConfig, symbol, timeframe);
    const sourceTemplateId = this.readString(
      root.sourceTemplateId,
      root.templateId,
      tradeSuggestion.sourceTemplateId,
      tradeSuggestion.templateId,
      inputSnapshot.sourceTemplateId,
      inputSnapshot.templateId,
      sourceConfig.sourceTemplateId,
      sourceConfig.templateId,
      template.id
    );
    const sourceTemplateName = this.readString(
      root.sourceTemplateName,
      tradeSuggestion.sourceTemplateName,
      inputSnapshot.sourceTemplateName,
      sourceConfig.sourceTemplateName,
      sourceConfig.templateName,
      template.sourceTemplateName,
      template.name
    );
    const sourceTemplateVersion = this.readNumber(
      root.sourceTemplateVersion,
      tradeSuggestion.sourceTemplateVersion,
      inputSnapshot.sourceTemplateVersion,
      sourceConfig.sourceTemplateVersion,
      sourceConfig.templateVersion,
      template.sourceTemplateVersion,
      template.templateVersion
    );
    const market =
      this.readString(root.market, tradeSuggestion.market, inputSnapshot.market, sourceConfig.market) ??
      'crypto-futures';
    const strategy =
      this.readString(
        root.strategy,
        tradeSuggestion.strategy,
        sourceTemplateName,
        sourceBacktest.strategy,
        sourceBacktest.name
      ) ?? 'Trade Suggestion';

    return normalizeAutomationConfig('trade-suggestion', {
      ...root,
      source: this.readString(root.source, tradeSuggestion.source) ?? 'top-setup',
      backtestId,
      symbol,
      timeframe,
      market,
      strategy,
      ...(sourceTemplateId ? { sourceTemplateId } : {}),
      ...(sourceTemplateName ? { sourceTemplateName } : {}),
      ...(sourceTemplateVersion !== null ? { sourceTemplateVersion } : {}),
      ...(hydratedSetupScope ? { setupScope: hydratedSetupScope } : {}),
      tradeSuggestion: {
        ...tradeSuggestion,
        kind: 'trade-suggestion',
        source: this.readString(root.source, tradeSuggestion.source) ?? 'top-setup',
        backtestId,
        symbol,
        timeframe,
        market,
        strategy,
        ...(sourceTemplateId ? { sourceTemplateId } : {}),
        ...(sourceTemplateName ? { sourceTemplateName } : {}),
        ...(sourceTemplateVersion !== null ? { sourceTemplateVersion } : {}),
        ...(hydratedSetupScope ? { setupScope: hydratedSetupScope } : {}),
      },
    });
  }

  private sanitizeBacktestRunnerSourceConfig(
    value: Record<string, unknown> | null
  ): Record<string, unknown> | null {
    const config = this.parseRecord(value);
    if (!config) {
      return null;
    }
    const {
      progress,
      progressPercent,
      progressProcessed,
      progressTotal,
      performanceSurface,
      tradeEventCount,
      resultCount,
      automationId,
      automationRunId,
      ...rest
    } = config;
    void progress;
    void progressPercent;
    void progressProcessed;
    void progressTotal;
    void performanceSurface;
    void tradeEventCount;
    void resultCount;
    void automationId;
    void automationRunId;
    return rest;
  }

  private deriveAutomationCoreFields(
    automationType: AutomationItem['automationType'],
    rawConfig: Record<string, unknown> | null,
    fallbacks: {
      name: string;
      strategy?: string;
      broker?: string;
      market?: string;
      trigger?: string;
      schedule?: AutomationSchedule | null;
    }
  ): {
    name: string;
    strategy: string;
    broker: string;
    market: string;
    trigger: string;
  } {
    const root = this.parseRecord(rawConfig) ?? {};
    const tradeSuggestion = this.parseRecord(root.tradeSuggestion) ?? {};
    const backtestRunner = this.parseRecord(root.backtestRunner) ?? {};
    const setupScope = this.parseRecord(tradeSuggestion.setupScope) ?? this.parseRecord(root.setupScope);
    const strategy =
      this.readString(
        fallbacks.strategy,
        root.strategy,
        tradeSuggestion.strategy,
        root.sourceTemplateName,
        tradeSuggestion.sourceTemplateName,
        root.templateName,
        root.sourceTemplateId,
        root.templateId,
        backtestRunner.strategy
      ) ??
      (automationType === 'backtest-runner' ? 'Backtest Runner' : 'Trade Suggestion');
    const market =
      this.readString(
        fallbacks.market,
        root.market,
        tradeSuggestion.market,
        backtestRunner.market,
        this.parseRecord(root.config)?.market
      ) ?? 'crypto-futures';
    const scopeLabel = [this.readString(root.symbol, tradeSuggestion.symbol, setupScope?.symbol), this.readString(root.timeframe, tradeSuggestion.timeframe, setupScope?.timeframe)]
      .filter(Boolean)
      .join(' · ');
    const broker =
      this.readString(fallbacks.broker) ??
      (automationType === 'backtest-runner' ? 'Backtest Engine' : scopeLabel || 'Signal Engine');
    const trigger =
      this.readString(fallbacks.trigger) ??
      (fallbacks.schedule ? this.describeAutomationSchedule(fallbacks.schedule) : null) ??
      'manual';

    return {
      name: fallbacks.name,
      strategy,
      broker,
      market,
      trigger,
    };
  }

  private findBacktestSetupScope(
    sourceConfig: Record<string, unknown>,
    symbol: string | null,
    timeframe: string | null
  ): Record<string, unknown> | null {
    if (!symbol || !timeframe) {
      return null;
    }

    const surface = this.parseRecord(sourceConfig.performanceSurface);
    const results = Array.isArray(surface?.results) ? surface.results : [];
    const match = results.find((item) => {
      const record = this.parseRecord(item);
      return (
        record &&
        this.readString(record.symbol)?.toUpperCase() === symbol.toUpperCase() &&
        this.readString(record.timeframe) === timeframe
      );
    });
    const record = this.parseRecord(match);
    if (!record) {
      return null;
    }

    return {
      symbol,
      timeframe,
      score: this.readNumber(record.score),
      trades:
        this.readNumber(record.total_trades, record.totalTrades, record.trades) ?? null,
      winRate: this.readNumber(record.win_rate, record.winRate),
      profitFactor: this.readNumber(record.profit_factor, record.profitFactor),
      returnPct: this.readNumber(record.total_return_pct, record.returnPct),
      maxDrawdownPct: this.readNumber(record.max_drawdown_pct, record.maxDrawdownPct),
      dedupeKey: [sourceConfig.backtestId, symbol, timeframe].filter(Boolean).join(':') || null,
    };
  }

  private describeAutomationSchedule(schedule: AutomationSchedule): string {
    if (schedule.type === 'interval') {
      return `every ${schedule.intervalMinutes}m`;
    }
    if (schedule.type === 'every_n_seconds') {
      return `every ${schedule.intervalSeconds}s`;
    }
    if (schedule.type === 'hourly_at_minute') {
      return `hourly :${String(schedule.minute).padStart(2, '0')}`;
    }
    if (schedule.type === 'weekly') {
      const days = schedule.weekdays?.length ? schedule.weekdays.join(',') : 'custom';
      return `weekly ${days} ${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
    }
    const intervalDays = schedule.intervalDays ?? 1;
    return intervalDays > 1
      ? `every ${intervalDays}d ${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
      : `daily ${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
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
