import { randomUUID } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SchedulerAssetItem,
  SchedulerAssetListResponse,
  SchedulerAssetUpdateLogItem,
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerRunLogItem,
  SchedulerRunLogListResponse,
  SchedulerRunProgressResponse,
  SchedulerRunNowResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import {
  validateListQuery,
  validateSchedulerConfigBody,
  validateUpdateLogSortQuery,
} from '../validators/scheduler.validator';
import { successResponse } from '../utils/response';
import {
  DEFAULT_SCHEDULER_TIMEZONE,
  normalizeTimeZone,
} from '../utils/timezone';
import {
  buildSchedulerTimeContract,
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../utils/schedulerTimeContract';
import {
  buildSystemSchedulerManualAudit,
  resolveSchedulerAuditDisplayLabels,
  toSchedulerAuditContract,
} from '../utils/schedulerAuditContract';
import { BadRequestAppError, ServiceUnavailableAppError } from '../errors/AppError';
import {
  ExchangeAssetUpdateLogRepository,
  SchedulerCommandRepository,
  SchedulerConfig,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  ActivityRepository,
  AlertRepository,
  ExchangeAssetRepository,
} from '../../database';
import { strategyDataSource } from '../../database/pg-data-source';
import { env } from '../../env';
import { UserTimeZoneService } from './UserTimeZoneService';

const SCHEDULER_KEY = 'broker-assets-sync';
const BROKER_ASSETS_SCHEDULER_OWNERSHIP = 'global' as const;
const BROKER_ASSETS_SCHEDULER_DESCRIPTION =
  'Fetches provider assets for system broker accounts and updates the global broker assets catalog.';

@Service()
export class SchedulerService {
  @Inject(() => SchedulerConfigRepository)
  private schedulerConfigRepository!: SchedulerConfigRepository;

  @Inject(() => SchedulerRunLogRepository)
  private schedulerRunLogRepository!: SchedulerRunLogRepository;

  @Inject(() => ExchangeAssetUpdateLogRepository)
  private exchangeAssetUpdateLogRepository!: ExchangeAssetUpdateLogRepository;

  @Inject(() => SchedulerCommandRepository)
  private schedulerCommandRepository!: SchedulerCommandRepository;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async getSchedulerConfig(userId: string): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const config = await this.ensureSchedulerConfig(timeZone);
    return successResponse(this.mapConfig(config, timeZone));
  }

  async updateSchedulerConfig(
    actorUserId: string,
    body: Partial<UpdateSchedulerConfigBody>
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    try {
      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const payload = validateSchedulerConfigBody(body);
      const current = await this.ensureSchedulerConfig(timeZone);
      const currentConfig = (current.config ?? {}) as Record<string, unknown>;
      const nextConfig: Record<string, unknown> = { ...currentConfig };

      if (payload.sources) {
        nextConfig.sources = payload.sources;
      }
      if (payload.retentionDays !== undefined) {
        nextConfig.retentionDays = payload.retentionDays;
      }
      if (payload.scheduleMode !== undefined) {
        nextConfig.scheduleMode = payload.scheduleMode;
      }
      if (payload.intervalMinutes !== undefined) {
        nextConfig.intervalMinutes = payload.intervalMinutes;
      }
      if (payload.intervalSeconds !== undefined) {
        nextConfig.intervalSeconds = payload.intervalSeconds;
      }
      if (payload.hourlyMinute !== undefined) {
        nextConfig.hourlyMinute = payload.hourlyMinute;
      }
      nextConfig.useSystemConnectionsOnly = true;
      nextConfig.useSystemAccountsOnly = true;
      if (
        payload.schedulerType !== undefined &&
        String(payload.schedulerType || '').trim().toLowerCase() !==
          BROKER_ASSETS_SCHEDULER_OWNERSHIP
      ) {
        throw new BadRequestAppError(
          'Broker Assets Sync is a global system scheduler and cannot be switched to user scope.'
        );
      }

      const updated = await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
        ...(payload.cronExpression !== undefined ? { cronExpression: payload.cronExpression } : {}),
        ...(payload.runAt !== undefined ? { runAt: payload.runAt } : {}),
        ...(payload.intervalDays !== undefined ? { intervalDays: payload.intervalDays } : {}),
        ...(payload.batchSize !== undefined ? { batchSize: payload.batchSize } : {}),
        schedulerType: BROKER_ASSETS_SCHEDULER_OWNERSHIP,
        config: nextConfig,
      });
      if (payload.enabled === false) {
        await this.schedulerCommandRepository.cancelPendingBySchedulerKey(
          SCHEDULER_KEY,
          `Cancelled because scheduler disabled by ${actorUserId}`
        );
      }
      const config = updated || (await this.ensureSchedulerConfig(timeZone));
      await this.logSchedulerActivity(
        actorUserId,
        'Scheduler config updated',
        'Success',
        `Updated scheduler config for ${SCHEDULER_KEY}`
      );
      return successResponse(this.mapConfig(config, timeZone));
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Scheduler config update failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async runNow(actorUserId: string): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    try {
      if (!actorUserId) {
        throw new BadRequestAppError('actorUserId is required');
      }
      const manualAudit = this.buildManualAudit(actorUserId);
      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const config = await this.ensureSchedulerConfig(timeZone);
      if (!config.enabled) {
        throw new BadRequestAppError('Scheduler is paused. Resume it before running now.');
      }

      if (env.scheduler.executionMode !== 'queue') {
        throw new ServiceUnavailableAppError(
          'Scheduler execution must run in queue mode from trading-scheduler-worker'
        );
      }
      const existingRunCommand =
        await this.schedulerCommandRepository.findLatestBySchedulerKeyAndTypeInStatuses(
          SCHEDULER_KEY,
          'run_now',
          ['Pending', 'Processing']
        );
      if (existingRunCommand) {
        const existingPayload =
          existingRunCommand.payload &&
          typeof existingRunCommand.payload === 'object' &&
          !Array.isArray(existingRunCommand.payload)
            ? (existingRunCommand.payload as Record<string, unknown>)
            : {};
        const existingRunId = String(existingPayload.runId || '').trim();
        return successResponse({
          queued: true,
          executionMode: 'queue',
          started: false,
          ...(existingRunId ? { runId: existingRunId } : {}),
          jobId: existingRunCommand.id,
          message: 'Scheduler run already queued',
        });
      }
      const running = await this.schedulerRunLogRepository.hasRunningRun(SCHEDULER_KEY);
      if (running) {
        return successResponse({
          queued: false,
          executionMode: 'queue',
          started: false,
          message: 'Scheduler run already in progress',
        });
      }
      const runId = randomUUID();
      await this.schedulerRunLogRepository.createRun({
        id: runId,
        schedulerKey: SCHEDULER_KEY,
        status: 'Queued',
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
        startedAt: new Date(),
        finishedAt: null,
        durationMs: null,
        processedAccounts: 0,
        insertedAssets: 0,
        updatedAssets: 0,
        skippedAssets: 0,
        errorMessage: null,
        meta: {
          trigger: 'manual',
          requestedAt: this.formatDate(new Date()),
          initiatedByType: manualAudit.initiatedByType,
          initiatedByUserId: manualAudit.initiatedByUserId,
          initiatedByLabel: manualAudit.initiatedByLabel,
          executionContext: manualAudit.executionContext,
          progress: {
            total: 0,
            processed: 0,
            percent: 0,
          },
        },
      });
      const command = await this.schedulerCommandRepository.createCommand({
        schedulerKey: SCHEDULER_KEY,
        commandType: 'run_now',
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
        payload: {
          runId,
          trigger: 'manual',
          requestedAt: this.formatDate(new Date()),
          initiatedByType: manualAudit.initiatedByType,
          initiatedByUserId: manualAudit.initiatedByUserId,
          initiatedByLabel: manualAudit.initiatedByLabel,
          executionContext: manualAudit.executionContext,
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      await this.logSchedulerActivity(
        actorUserId,
        'Scheduler run queued',
        'Success',
        `Queued run_now for ${SCHEDULER_KEY} as command ${command.id}`
      );

      return successResponse({
        queued: true,
        executionMode: 'queue',
        started: false,
        runId,
        jobId: command.id,
        message: 'Scheduler command queued',
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Scheduler run queue failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitSchedulerFailureAlert(
        actorUserId,
        'Scheduler run queue failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async pauseScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(timeZone);
    await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, { enabled: false });
    await this.schedulerCommandRepository.cancelPendingBySchedulerKey(
      SCHEDULER_KEY,
      `Cancelled because scheduler disabled by ${actorUserId}`
    );
    await this.logSchedulerActivity(actorUserId, 'Scheduler paused', 'Success', `Paused ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'pause',
      message: 'Scheduler paused',
      state: 'applied',
      commandIds: [],
    });
  }

  async resumeScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(timeZone);
    await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, { enabled: true });
    await this.logSchedulerActivity(actorUserId, 'Scheduler resumed', 'Success', `Resumed ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'resume',
      message: 'Scheduler resumed',
      state: 'applied',
      commandIds: [],
    });
  }

  async stopScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const manualAudit = this.buildManualAudit(actorUserId);
    if (env.scheduler.executionMode !== 'queue') {
      throw new ServiceUnavailableAppError('Stop is supported only in queue mode');
    }
    const cancelledPendingRuns = await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndType(
      SCHEDULER_KEY,
      'run_now',
      `Cancelled by stop request from ${actorUserId}`
    );
    const running = await this.schedulerRunLogRepository.hasRunningRun(SCHEDULER_KEY);
    let stopCommandId: string | null = null;
    if (running) {
      const stopCommand = await this.schedulerCommandRepository.createCommand({
        schedulerKey: SCHEDULER_KEY,
        commandType: 'stop_now',
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
        payload: {
          requestedAt: this.formatDate(new Date()),
          initiatedByType: manualAudit.initiatedByType,
          initiatedByUserId: manualAudit.initiatedByUserId,
          initiatedByLabel: manualAudit.initiatedByLabel,
          executionContext: manualAudit.executionContext,
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      stopCommandId = stopCommand.id;
    }
    await this.logSchedulerActivity(
      actorUserId,
      'Scheduler stop requested',
      'Success',
      `Stop request handled for ${SCHEDULER_KEY}. activeStop=${running ? 'queued' : 'not-required'}, pendingRunsCancelled=${cancelledPendingRuns}`
    );
    return successResponse({
      queued: Boolean(stopCommandId),
      action: 'stop',
      state: stopCommandId ? 'queued' : cancelledPendingRuns > 0 ? 'applied' : 'noop',
      message:
        running || cancelledPendingRuns > 0
          ? 'Scheduler stop requested'
          : 'No active or queued scheduler run to stop',
      commandIds: stopCommandId ? [stopCommandId] : [],
    });
  }

  async restartScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const manualAudit = this.buildManualAudit(actorUserId);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const config = await this.ensureSchedulerConfig(timeZone);
    if (!config.enabled) {
      throw new BadRequestAppError('Scheduler is paused. Resume it before restarting.');
    }
    if (env.scheduler.executionMode !== 'queue') {
      throw new ServiceUnavailableAppError('Restart is supported only in queue mode');
    }
    await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndType(
      SCHEDULER_KEY,
      'run_now',
      `Cancelled by restart request from ${actorUserId}`
    );
    const running = await this.schedulerRunLogRepository.hasRunningRun(SCHEDULER_KEY);
    let stopCommandId: string | null = null;
    if (running) {
      const stopCommand = await this.schedulerCommandRepository.createCommand({
        schedulerKey: SCHEDULER_KEY,
        commandType: 'stop_now',
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
        payload: {
          requestedAt: this.formatDate(new Date()),
          initiatedByType: manualAudit.initiatedByType,
          initiatedByUserId: manualAudit.initiatedByUserId,
          initiatedByLabel: manualAudit.initiatedByLabel,
          executionContext: manualAudit.executionContext,
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      stopCommandId = stopCommand.id;
    }
    const runCommand = await this.schedulerCommandRepository.createCommand({
      schedulerKey: SCHEDULER_KEY,
      commandType: 'run_now',
      initiatedByType: manualAudit.initiatedByType,
      initiatedByUserId: manualAudit.initiatedByUserId ?? null,
      initiatedByLabel: manualAudit.initiatedByLabel ?? null,
      executionContext: manualAudit.executionContext,
      payload: {
        trigger: 'manual',
        requestedAt: this.formatDate(new Date()),
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId,
        initiatedByLabel: manualAudit.initiatedByLabel,
        executionContext: manualAudit.executionContext,
      },
      status: 'Pending',
      processedAt: null,
      errorMessage: null,
    });
    await this.logSchedulerActivity(
      actorUserId,
      'Scheduler restart queued',
      'Success',
      running
        ? `Queued stop ${stopCommandId} and run ${runCommand.id} for ${SCHEDULER_KEY}`
        : `Queued run ${runCommand.id} for ${SCHEDULER_KEY}`
    );
    return successResponse({
      queued: true,
      action: 'restart',
      state: 'queued',
      message: 'Scheduler restart queued',
      commandIds: stopCommandId ? [stopCommandId, runCommand.id] : [runCommand.id],
    });
  }

  async purgeSchedulerLogs(actorUserId: string): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    try {
      if (!actorUserId) {
        throw new BadRequestAppError('actorUserId is required');
      }

      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const config = await this.ensureSchedulerConfig(timeZone);
      const retentionDays = this.readRetentionDays(config);
      const purgeResult = await this.applyRetentionPolicy(config);
      await this.logSchedulerActivity(
        actorUserId,
        'Scheduler logs purged',
        'Success',
        `Purged ${purgeResult.runLogsDeleted} run logs and ${purgeResult.updateLogsDeleted} update logs for ${SCHEDULER_KEY}`
      );

      return successResponse({
        message: `Scheduler logs purged. Deleted ${purgeResult.runLogsDeleted} run logs and ${purgeResult.updateLogsDeleted} update logs.`,
        retentionDays,
        runLogsDeleted: purgeResult.runLogsDeleted,
        updateLogsDeleted: purgeResult.updateLogsDeleted,
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Scheduler logs purge failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async getSchedulerPurgePreview(
    actorUserId: string
  ): Promise<ApiSuccessResponse<SchedulerPurgePreviewResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }

    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const config = await this.ensureSchedulerConfig(timeZone);
    const retentionDays = this.readRetentionDays(config);
    const [runLogsToDelete, updateLogsToDelete] = await Promise.all([
      this.schedulerRunLogRepository.countOlderThanDays(SCHEDULER_KEY, retentionDays),
      this.exchangeAssetUpdateLogRepository.countOlderThanDaysBySchedulerKey(
        SCHEDULER_KEY,
        retentionDays
      ),
    ]);

    return successResponse({
      retentionDays,
      runLogsToDelete,
      updateLogsToDelete,
    });
  }

  async listSchedulerRuns(
    actorUserId: string,
    query: { limit?: string; offset?: string }
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const params = validateListQuery(query);
    const { items, total } = await this.schedulerRunLogRepository.listRunsBySchedulerKey(
      SCHEDULER_KEY,
      params.limit,
      params.offset
    );
    return successResponse({
      items: await resolveSchedulerAuditDisplayLabels(
        items.map((item): SchedulerRunLogItem => this.toRunLogItem(item, timeZone))
      ),
      total,
      limit: params.limit,
      offset: params.offset,
      time: buildSchedulerTimeContract(timeZone),
    });
  }

  async getSchedulerRunProgress(
    actorUserId: string,
    runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      throw new BadRequestAppError('runId is required');
    }
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKey(
      normalizedRunId,
      SCHEDULER_KEY
    );
    if (!run) {
      return successResponse({ run: null, time: buildSchedulerTimeContract(timeZone) });
    }
    return successResponse({
      run: await resolveSchedulerAuditDisplayLabels(this.toRunLogItem(run, timeZone)),
      time: buildSchedulerTimeContract(timeZone),
    });
  }

  async listSchedulerAssets(
    query: { limit?: string; offset?: string; search?: string; assetId?: string }
  ): Promise<ApiSuccessResponse<SchedulerAssetListResponse>> {
    const params = this.parseAssetListQuery(query);
    const candleBackedSymbols = await this.listCandleBackedAssetSymbols(params.search);
    const { items, total } = await this.exchangeAssetRepository.listSystemAssetsDistinctSymbols({
      limit: params.limit,
      offset: params.offset,
      search: params.search,
      assetId: params.assetId,
      symbols: candleBackedSymbols ?? undefined,
    });

    return successResponse({
      items: items.map(
        (item): SchedulerAssetItem => ({
          id: item.id,
          symbol: item.symbol,
          source: item.source,
        })
      ),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  private async listCandleBackedAssetSymbols(search?: string): Promise<string[] | null> {
    if (!env.pg.enabled) {
      return null;
    }

    if (!strategyDataSource.isInitialized) {
      await strategyDataSource.initialize();
    }

    const normalizedSearch = String(search || '').trim().toUpperCase();
    const params = normalizedSearch ? [`%${normalizedSearch}%`] : [];
    const rows = await strategyDataSource.query(
      `SELECT DISTINCT UPPER(symbol) AS symbol
         FROM market_candles_1m
        WHERE symbol IS NOT NULL
          AND BTRIM(symbol) <> ''
          ${normalizedSearch ? 'AND UPPER(symbol) LIKE $1' : ''}
        ORDER BY UPPER(symbol) ASC`,
      params
    );

    return Array.from(
      new Set(
        rows
          .map((row: { symbol?: unknown }) => String(row.symbol || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
  }

  async listSchedulerRunUpdates(
    actorUserId: string,
    runId: string,
    query: {
      limit?: string;
      offset?: string;
      actionType?: string;
      source?: string;
      symbol?: string;
      sortBy?: string;
      sortOrder?: string;
    }
  ): Promise<ApiSuccessResponse<SchedulerAssetUpdateLogListResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const params = validateListQuery(query);
    const sort = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKey(
      runId,
      SCHEDULER_KEY
    );
    const runMeta =
      run?.meta && typeof run.meta === 'object' && !Array.isArray(run.meta)
        ? (run.meta as Record<string, unknown>)
        : null;
    const { items, total } = await this.exchangeAssetUpdateLogRepository.listByRunLogId(
      runId,
      params.limit,
      params.offset,
      {
        actionType: actionType || undefined,
        source: source || undefined,
        symbol: symbol || undefined,
        sortBy: sort.sortBy,
        sortOrder: sort.sortOrder,
      }
    );

    return successResponse({
      items: items.map((item): SchedulerAssetUpdateLogItem => ({
        id: item.id,
        runLogId: item.runLogId,
        ...toSchedulerAuditContract(
          item as unknown as Record<string, unknown>,
          run as unknown as Record<string, unknown> | null,
          runMeta
        ),
        source: item.source,
        accountId: item.accountId || undefined,
        connectionId: item.connectionId || undefined,
        actionType: item.actionType,
        symbol: item.symbol || undefined,
        externalId: item.externalId || undefined,
        assetId: item.assetId || undefined,
        message: item.message || undefined,
        createdAt: this.formatDisplayDate(item.createdAt, timeZone) || this.formatDate(item.createdAt)!,
        createdAtIso: formatSchedulerRawIso(item.createdAt),
      })),
      total,
      limit: params.limit,
      offset: params.offset,
      time: buildSchedulerTimeContract(timeZone),
    });
  }

  async exportSchedulerRunUpdates(
    actorUserId: string,
    runId: string,
    query: {
      actionType?: string;
      source?: string;
      symbol?: string;
      sortBy?: string;
      sortOrder?: string;
    }
  ): Promise<ApiSuccessResponse<SchedulerRunUpdatesExportResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKey(
      runId,
      SCHEDULER_KEY
    );
    const sort = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;
    const runMeta =
      run?.meta && typeof run.meta === 'object' && !Array.isArray(run.meta)
        ? (run.meta as Record<string, unknown>)
        : null;

    const { items } = await this.exchangeAssetUpdateLogRepository.listByRunLogId(runId, 100000, 0, {
      actionType: actionType || undefined,
      source: source || undefined,
      symbol: symbol || undefined,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    });

    const header = [
      'id',
      'runLogId',
      'initiatedByType',
      'initiatedByUserId',
      'initiatedByLabel',
      'executionContext',
      'source',
      'accountId',
      'connectionId',
      'actionType',
      'symbol',
      'externalId',
      'assetId',
      'message',
      'createdAt',
      'createdAtIso',
    ];
    const rows = items.map((item) => {
      const audit = toSchedulerAuditContract(
        item as unknown as Record<string, unknown>,
        run as unknown as Record<string, unknown> | null,
        runMeta
      );
      return [
        item.id,
        item.runLogId,
        audit.initiatedBy?.type || '',
        audit.initiatedBy?.userId || '',
        audit.initiatedBy?.label || '',
        audit.executionContext || '',
        item.source,
        item.accountId || '',
        item.connectionId || '',
        item.actionType,
        item.symbol || '',
        item.externalId || '',
        item.assetId || '',
        item.message || '',
        this.formatDisplayDate(item.createdAt, timeZone),
        formatSchedulerRawIso(item.createdAt) || '',
      ];
    });

    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');

    return successResponse({
      fileName: `scheduler-run-${runId}-updates.csv`,
      rowCount: rows.length,
      csv,
    });
  }

  private async ensureSchedulerConfig(_timeZone?: string): Promise<SchedulerConfig> {
    const normalizedTimeZone = normalizeTimeZone(
      DEFAULT_SCHEDULER_TIMEZONE,
      DEFAULT_SCHEDULER_TIMEZONE
    );
    const config = await this.schedulerConfigRepository.createIfMissing({
      key: SCHEDULER_KEY,
      name: 'Broker Assets Daily Sync',
      description: BROKER_ASSETS_SCHEDULER_DESCRIPTION,
      enabled: false,
      cronExpression: '0 1 * * *',
      timezone: normalizedTimeZone,
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 200,
      schedulerType: BROKER_ASSETS_SCHEDULER_OWNERSHIP,
      config: {
        sources: ['mudrex', 'delta_exchange'],
        useSystemConnectionsOnly: true,
        useSystemAccountsOnly: true,
        retentionDays: 30,
      },
    });
    const normalizedSchedulerType = String(config.schedulerType || '').trim().toLowerCase();
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const requiresNormalization =
      normalizedSchedulerType !== BROKER_ASSETS_SCHEDULER_OWNERSHIP ||
      String(config.description || '').trim() !== BROKER_ASSETS_SCHEDULER_DESCRIPTION ||
      configMap.useSystemConnectionsOnly !== true ||
      configMap.useSystemAccountsOnly !== true;
    if (!requiresNormalization) {
      return config;
    }
    const normalized = await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, {
      schedulerType: BROKER_ASSETS_SCHEDULER_OWNERSHIP,
      description: BROKER_ASSETS_SCHEDULER_DESCRIPTION,
      config: {
        ...configMap,
        useSystemConnectionsOnly: true,
        useSystemAccountsOnly: true,
      },
    });
    return (
      normalized || {
        ...config,
        schedulerType: BROKER_ASSETS_SCHEDULER_OWNERSHIP,
        description: BROKER_ASSETS_SCHEDULER_DESCRIPTION,
      }
    );
  }

  private mapConfig(config: SchedulerConfig, timeZone: string): SchedulerConfigResponse {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['mudrex', 'delta_exchange'];
    const retentionDaysValue = Number(configMap.retentionDays);
    const retentionDays =
      Number.isInteger(retentionDaysValue) && retentionDaysValue > 0 ? retentionDaysValue : 30;
    const scheduleModeRaw = String(configMap.scheduleMode || '').trim().toLowerCase();
    const scheduleMode =
      scheduleModeRaw === 'every_n_minutes' ||
      scheduleModeRaw === 'every_n_seconds' ||
      scheduleModeRaw === 'hourly_at_minute'
        ? scheduleModeRaw
        : 'daily';
    const intervalMinutesRaw = Number(configMap.intervalMinutes);
    const intervalMinutes =
      Number.isInteger(intervalMinutesRaw) && intervalMinutesRaw >= 1 && intervalMinutesRaw <= 60
        ? intervalMinutesRaw
        : 5;
    const intervalSecondsRaw = Number(configMap.intervalSeconds);
    const intervalSeconds =
      Number.isInteger(intervalSecondsRaw) && intervalSecondsRaw >= 1 && intervalSecondsRaw <= 60
        ? intervalSecondsRaw
        : 1;
    const hourlyMinuteRaw = Number(configMap.hourlyMinute);
    const hourlyMinute =
      Number.isInteger(hourlyMinuteRaw) && hourlyMinuteRaw >= 0 && hourlyMinuteRaw <= 59
        ? hourlyMinuteRaw
        : 0;

    return {
      key: config.key,
      name: config.name,
      description: config.description || undefined,
      enabled: config.enabled,
      cronExpression: config.cronExpression,
      timezone: config.timezone,
      runAt: config.runAt,
      intervalDays: config.intervalDays,
      scheduleMode,
      intervalMinutes,
      intervalSeconds,
      hourlyMinute,
      batchSize: config.batchSize,
      schedulerType: BROKER_ASSETS_SCHEDULER_OWNERSHIP,
      sources,
      retentionDays,
      time: buildSchedulerTimeContract(timeZone),
      lastStartedAt: this.formatDisplayDate(config.lastStartedAt, timeZone),
      lastStartedAtIso: formatSchedulerRawIso(config.lastStartedAt),
      lastFinishedAt: this.formatDisplayDate(config.lastFinishedAt, timeZone),
      lastFinishedAtIso: formatSchedulerRawIso(config.lastFinishedAt),
      lastStatus: config.lastStatus || undefined,
      lastError: config.lastError || undefined,
    };
  }

  private readRetentionDays(config: SchedulerConfig): number {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const retentionDays = Number(configMap.retentionDays);
    if (Number.isInteger(retentionDays) && retentionDays > 0) {
      return retentionDays;
    }
    return 30;
  }

  private async applyRetentionPolicy(config: SchedulerConfig): Promise<{
    runLogsDeleted: number;
    updateLogsDeleted: number;
  }> {
    const retentionDays = this.readRetentionDays(config);
    const updateLogsDeleted =
      await this.exchangeAssetUpdateLogRepository.deleteOlderThanDaysBySchedulerKey(
        SCHEDULER_KEY,
        retentionDays
      );
    const runLogsDeleted = await this.schedulerRunLogRepository.deleteOlderThanDays(
      SCHEDULER_KEY,
      retentionDays
    );
    return {
      runLogsDeleted,
      updateLogsDeleted,
    };
  }

  private mapRunMeta(meta: unknown): Pick<SchedulerRunLogItem, 'progress' | 'scopeAssetsCount'> {
    const parsed = this.parseMeta(meta);
    const scopeRaw =
      parsed.scope && typeof parsed.scope === 'object' && !Array.isArray(parsed.scope)
        ? (parsed.scope as Record<string, unknown>)
        : null;
    const scopeAssetsCount = scopeRaw
      ? Math.max(
          this.readNumber(scopeRaw.assetsCount),
          Array.isArray(scopeRaw.assets)
            ? scopeRaw.assets
                .map((item) => String(item || '').trim())
                .filter(Boolean).length
            : 0
        )
      : 0;
    const scopeMeta =
      scopeAssetsCount > 0
        ? {
            scopeAssetsCount,
          }
        : {};
    const progressRaw =
      parsed.progress && typeof parsed.progress === 'object' && !Array.isArray(parsed.progress)
        ? (parsed.progress as Record<string, unknown>)
        : null;
    if (!progressRaw) {
      return scopeMeta;
    }

    const total = this.readNumber(progressRaw.total);
    const processed = this.readNumber(progressRaw.processed);
    const percent = this.readNumber(progressRaw.percent);
    const etaSeconds = this.readNumber(progressRaw.etaSeconds);
    const currentItemRaw =
      progressRaw.currentItem &&
      typeof progressRaw.currentItem === 'object' &&
      !Array.isArray(progressRaw.currentItem)
        ? (progressRaw.currentItem as Record<string, unknown>)
        : null;

    return {
      ...scopeMeta,
      progress: {
        total,
        processed,
        percent,
        ...(etaSeconds > 0 ? { etaSeconds } : {}),
        ...(currentItemRaw
          ? {
              currentItem: {
                ...(currentItemRaw.symbol ? { symbol: String(currentItemRaw.symbol) } : {}),
                ...(currentItemRaw.assetId ? { assetId: String(currentItemRaw.assetId) } : {}),
                ...(currentItemRaw.id ? { id: String(currentItemRaw.id) } : {}),
              },
            }
          : {}),
      },
    };
  }

  private toRunLogItem(
    item: {
      id: string;
      schedulerKey: string;
      status: string;
      startedAt: Date;
      finishedAt: Date | null;
      durationMs: number | null;
      processedAccounts: number;
      insertedAssets: number;
      updatedAssets: number;
      skippedAssets: number;
      errorMessage: string | null;
      meta: unknown;
    },
    timeZone: string
  ): SchedulerRunLogItem {
    return {
      ...(this.mapRunMeta(item.meta || null)),
      id: item.id,
      schedulerKey: item.schedulerKey,
      status: item.status,
      ...toSchedulerAuditContract(
        item as unknown as Record<string, unknown>,
        this.parseMeta(item.meta)
      ),
      startedAt: this.formatDisplayDate(item.startedAt, timeZone) || this.formatDate(item.startedAt)!,
      startedAtIso: formatSchedulerRawIso(item.startedAt),
      finishedAt: this.formatDisplayDate(item.finishedAt, timeZone),
      finishedAtIso: formatSchedulerRawIso(item.finishedAt),
      durationMs: item.durationMs ?? undefined,
      processedAccounts: item.processedAccounts,
      insertedAssets: item.insertedAssets,
      updatedAssets: item.updatedAssets,
      skippedAssets: item.skippedAssets,
      errorMessage: item.errorMessage || undefined,
    };
  }

  private formatDate(value: Date): string;
  private formatDate(value: Date | null | undefined): string | undefined;
  private formatDate(value: Date | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  private formatDisplayDate(
    value: Date | string | null | undefined,
    timeZone: string
  ): string | undefined {
    return formatSchedulerDisplayTime(value, timeZone);
  }

  private parseMeta(meta: unknown): Record<string, unknown> {
    if (!meta) return {};
    if (typeof meta === 'object' && !Array.isArray(meta)) {
      return meta as Record<string, unknown>;
    }
    try {
      const parsed = JSON.parse(String(meta));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  private buildManualAudit(actorUserId: string) {
    return buildSystemSchedulerManualAudit(actorUserId);
  }

  private parseAssetListQuery(query: {
    limit?: string;
    offset?: string;
    search?: string;
    assetId?: string;
  }): { limit: number; offset: number; search?: string; assetId?: string } {
    const rawLimit = query.limit !== undefined ? Number(query.limit) : 200;
    const rawOffset = query.offset !== undefined ? Number(query.offset) : 0;
    if (!Number.isInteger(rawLimit) || rawLimit <= 0 || rawLimit > 5000) {
      throw new BadRequestAppError('limit must be an integer between 1 and 5000');
    }
    if (!Number.isInteger(rawOffset) || rawOffset < 0) {
      throw new BadRequestAppError('offset must be a non-negative integer');
    }

    const search = query.search ? String(query.search).trim() : '';
    const assetId = query.assetId ? String(query.assetId).trim() : '';
    return {
      limit: rawLimit,
      offset: rawOffset,
      ...(search ? { search } : {}),
      ...(assetId ? { assetId } : {}),
    };
  }

  private async logSchedulerActivity(
    userId: string,
    title: string,
    status: string,
    description: string
  ): Promise<void> {
    try {
      if (!userId) {
        return;
      }
      await this.activityRepository.createActivityLog({
        userId,
        type: 'Scheduler',
        title,
        status,
        actor: userId,
        route: 'Schedulers',
        stream: 'Automation',
        related: SCHEDULER_KEY,
        description,
      });
    } catch {
      // Keep scheduler operations non-blocking if activity logging fails.
    }
  }

  private async emitSchedulerFailureAlert(
    userId: string,
    title: string,
    detail: string
  ): Promise<void> {
    try {
      if (!userId) {
        return;
      }
      const throttled = await this.alertRepository.findRecentOpenAlertBySource({
        userId,
        channel: 'Scheduler',
        source: SCHEDULER_KEY,
        withinMinutes: env.observability.failureAlertThrottleMinutes,
      });
      if (throttled) {
        return;
      }
      const message = `${title}: ${detail}`.slice(0, 255);
      const existing = await this.alertRepository.findOpenAlertBySignature({
        userId,
        channel: 'Scheduler',
        source: SCHEDULER_KEY,
        message,
      });
      if (existing) {
        return;
      }
      await this.alertRepository.createAlert({
        userId,
        severity: 'High',
        channel: 'Scheduler',
        symbol: 'SYSTEM',
        message,
        route: 'Automation desk',
        status: 'Open',
        source: SCHEDULER_KEY,
        urgency: 'Immediate',
      });
    } catch {
      // Keep scheduler operations non-blocking if alert emission fails.
    }
  }

}
