import { randomUUID } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SchedulerAssetUpdateLogItem,
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunLogItem,
  SchedulerRunLogListResponse,
  SchedulerRunNowResponse,
  SchedulerRunProgressResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import {
  validateListQuery,
  validateSchedulerConfigBody,
  validateUpdateLogSortQuery,
} from '../validators/scheduler.validator';
import { successResponse } from '../utils/response';
import { normalizeTimeZone } from '../utils/timezone';
import {
  BadRequestAppError,
  NotFoundAppError,
  ServiceUnavailableAppError,
} from '../errors/AppError';
import {
  ActivityRepository,
  AlertRepository,
  ExchangeAssetUpdateLogRepository,
  SchedulerCommandRepository,
  SchedulerConfig,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  SchedulerUserConfig,
  SchedulerUserConfigRepository,
} from '../../database';
import { env } from '../../env';
import { UserTimeZoneService } from './UserTimeZoneService';

const SCHEDULER_KEY = 'signals-scan-sync';
const SCHEDULER_DISPLAY_NAME = 'Signals Scan';
const DEFAULT_SOURCES = ['strategy_library'];
const ALLOWED_SOURCES = new Set(DEFAULT_SOURCES);
type SignalsSchedulerUserConfigRecord = SchedulerUserConfig;
type SignalsSchedulerConfigLike = {
  batchSize?: number | null;
  config?: Record<string, unknown> | null;
};

@Service()
export class SignalsSchedulerService {
  @Inject(() => SchedulerConfigRepository)
  private schedulerConfigRepository!: SchedulerConfigRepository;

  @Inject(() => SchedulerUserConfigRepository)
  private schedulerUserConfigRepository!: SchedulerUserConfigRepository;

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

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async getSchedulerConfig(userId: string): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    let config = await this.ensureSchedulerConfig(userId, timeZone);
    if (String(config.timezone || '') !== timeZone) {
      const updated = await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(
        SCHEDULER_KEY,
        userId,
        {
          timezone: timeZone,
          schedulerType: 'user',
        }
      );
      if (updated) {
        config = updated;
      }
    }
    return successResponse(this.mapConfig(config));
  }

  async updateSchedulerConfig(
    actorUserId: string,
    body: Partial<UpdateSchedulerConfigBody>
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    try {
      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const payload = validateSchedulerConfigBody(body);
      if (payload.batchSize !== undefined && payload.batchSize > 50) {
        throw new BadRequestAppError('batchSize must be an integer between 10 and 50 for signals scan');
      }
      const current = await this.ensureSchedulerConfig(actorUserId, timeZone);
      const currentConfig = (current.config ?? {}) as Record<string, unknown>;
      const nextConfig: Record<string, unknown> = { ...currentConfig };

      if (payload.sources) {
        const sources = this.normalizeSources(payload.sources);
        if (!sources.length) {
          throw new BadRequestAppError('At least one signal source must be enabled');
        }
        nextConfig.sources = sources;
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

      const updated = await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(
        SCHEDULER_KEY,
        actorUserId,
        {
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.description !== undefined ? { description: payload.description } : {}),
          ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
          ...(payload.cronExpression !== undefined ? { cronExpression: payload.cronExpression } : {}),
          ...(payload.runAt !== undefined ? { runAt: payload.runAt } : {}),
          ...(payload.intervalDays !== undefined ? { intervalDays: payload.intervalDays } : {}),
          ...(payload.batchSize !== undefined ? { batchSize: payload.batchSize } : {}),
          schedulerType: 'user',
          config: this.normalizePersistedConfigMap(nextConfig),
        }
      );

      if (payload.enabled === false) {
        await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndActor(
          SCHEDULER_KEY,
          actorUserId,
          `Cancelled because scheduler disabled by ${actorUserId}`
        );
        await this.schedulerRunLogRepository.cancelQueuedRunsBySchedulerKeyAndActor(
          SCHEDULER_KEY,
          actorUserId,
          `Cancelled because scheduler disabled by ${actorUserId}`
        );
      }

      const config = updated || (await this.ensureSchedulerConfig(actorUserId, timeZone));
      await this.logSchedulerActivity(
        actorUserId,
        'Signals scheduler config updated',
        'Success',
        `Updated scheduler config for ${SCHEDULER_KEY}`
      );
      return successResponse(this.mapConfig(config));
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Signals scheduler config update failed',
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
      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
      if (!config.enabled) {
        throw new BadRequestAppError('Signals scheduler is paused. Resume it before running now.');
      }
      if (env.scheduler.executionMode !== 'queue') {
        throw new ServiceUnavailableAppError(
          'Scheduler execution must run in queue mode from trading-scheduler-worker'
        );
      }

      const existingRunCommand =
        await this.schedulerCommandRepository.findLatestBySchedulerKeyAndTypeAndActorInStatuses(
          SCHEDULER_KEY,
          'run_now',
          actorUserId,
          ['Pending', 'Processing']
        );
      if (existingRunCommand) {
        const payload = (existingRunCommand.payload || {}) as Record<string, unknown>;
        const existingRunId = String(payload.runId || '').trim();
        return successResponse({
          queued: true,
          executionMode: 'queue',
          started: false,
          ...(existingRunId ? { runId: existingRunId } : {}),
          jobId: existingRunCommand.id,
          message: 'Signals scheduler run already queued',
        });
      }

      const running = await this.schedulerRunLogRepository.hasRunningRunBySchedulerKeyAndActor(
        SCHEDULER_KEY,
        actorUserId
      );
      if (running) {
        return successResponse({
          queued: false,
          executionMode: 'queue',
          started: false,
          message: 'Signals scheduler run already in progress',
        });
      }

      const sources = this.resolveSourcesFromConfigMap((config.config ?? {}) as Record<string, unknown>);
      if (!sources.length) {
        throw new BadRequestAppError('At least one signal source must be enabled before running now');
      }
      const maxSources = this.resolveMaxSources(config);
      const runId = randomUUID();
      await this.schedulerRunLogRepository.createRun({
        id: runId,
        schedulerKey: SCHEDULER_KEY,
        actorUserId,
        status: 'Queued',
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
          actorUserId,
          requestedAt: this.formatDate(new Date()),
          signals: {
            sources,
            maxSources,
          },
          progress: {
            total: sources.length,
            processed: 0,
            percent: 0,
          },
        },
      });
      const command = await this.schedulerCommandRepository.createCommand({
        schedulerKey: SCHEDULER_KEY,
        commandType: 'run_now',
        actorUserId,
        payload: {
          runId,
          trigger: 'manual',
          actorUserId,
          requestedAt: this.formatDate(new Date()),
          sources,
          maxSources,
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      await this.logSchedulerActivity(
        actorUserId,
        'Signals scheduler run queued',
        'Success',
        `Queued run_now for ${SCHEDULER_KEY} as command ${command.id}`
      );
      return successResponse({
        queued: true,
        executionMode: 'queue',
        started: false,
        runId,
        jobId: command.id,
        message: `Signals scheduler command queued for ${sources.length} source(s)`,
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Signals scheduler run queue failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitSchedulerFailureAlert(
        actorUserId,
        'Signals scheduler run queue failed',
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
    await this.ensureSchedulerConfig(actorUserId, timeZone);
    await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(
      SCHEDULER_KEY,
      actorUserId,
      { enabled: false }
    );
    await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId,
      `Cancelled because scheduler disabled by ${actorUserId}`
    );
    await this.schedulerRunLogRepository.cancelQueuedRunsBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId,
      `Cancelled because scheduler disabled by ${actorUserId}`
    );
    await this.logSchedulerActivity(actorUserId, 'Signals scheduler paused', 'Success', `Paused ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'pause',
      message: 'Signals scheduler paused',
      state: 'applied',
      commandIds: [],
    });
  }

  async resumeScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(actorUserId, timeZone);
    await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(
      SCHEDULER_KEY,
      actorUserId,
      { enabled: true }
    );
    await this.logSchedulerActivity(actorUserId, 'Signals scheduler resumed', 'Success', `Resumed ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'resume',
      message: 'Signals scheduler resumed',
      state: 'applied',
      commandIds: [],
    });
  }

  async stopScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    if (env.scheduler.executionMode !== 'queue') {
      throw new ServiceUnavailableAppError('Stop is supported only in queue mode');
    }
    const cancelledPendingRuns = await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndTypeAndActor(
      SCHEDULER_KEY,
      'run_now',
      actorUserId,
      `Cancelled by stop request from ${actorUserId}`
    );
    await this.schedulerRunLogRepository.cancelQueuedRunsBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId,
      `Cancelled by stop request from ${actorUserId}`
    );
    const running = await this.schedulerRunLogRepository.hasRunningRunBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId
    );
    let stopCommandId: string | null = null;
    if (running) {
      const stopCommand = await this.schedulerCommandRepository.createCommand({
        schedulerKey: SCHEDULER_KEY,
        commandType: 'stop_now',
        actorUserId,
        payload: {
          actorUserId,
          requestedAt: this.formatDate(new Date()),
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      stopCommandId = stopCommand.id;
    }
    await this.logSchedulerActivity(
      actorUserId,
      'Signals scheduler stop requested',
      'Success',
      `Stop request handled for ${SCHEDULER_KEY}. activeStop=${running ? 'queued' : 'not-required'}, pendingRunsCancelled=${cancelledPendingRuns}`
    );
    return successResponse({
      queued: Boolean(stopCommandId),
      action: 'stop',
      state: stopCommandId ? 'queued' : cancelledPendingRuns > 0 ? 'applied' : 'noop',
      message:
        running || cancelledPendingRuns > 0
          ? 'Signals scheduler stop requested'
          : 'No active or queued signals scheduler run to stop',
      commandIds: stopCommandId ? [stopCommandId] : [],
    });
  }

  async restartScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
    if (!config.enabled) {
      throw new BadRequestAppError('Signals scheduler is paused. Resume it before restarting.');
    }
    if (env.scheduler.executionMode !== 'queue') {
      throw new ServiceUnavailableAppError('Restart is supported only in queue mode');
    }

    await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndTypeAndActor(
      SCHEDULER_KEY,
      'run_now',
      actorUserId,
      `Cancelled by restart request from ${actorUserId}`
    );
    await this.schedulerRunLogRepository.cancelQueuedRunsBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId,
      `Cancelled by restart request from ${actorUserId}`
    );
    const running = await this.schedulerRunLogRepository.hasRunningRunBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId
    );
    let stopCommandId: string | null = null;
    if (running) {
      const stopCommand = await this.schedulerCommandRepository.createCommand({
        schedulerKey: SCHEDULER_KEY,
        commandType: 'stop_now',
        actorUserId,
        payload: {
          actorUserId,
          requestedAt: this.formatDate(new Date()),
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      stopCommandId = stopCommand.id;
    }

    const sources = this.resolveSourcesFromConfigMap((config.config ?? {}) as Record<string, unknown>);
    const maxSources = this.resolveMaxSources(config);
    const runCommand = await this.schedulerCommandRepository.createCommand({
      schedulerKey: SCHEDULER_KEY,
      commandType: 'run_now',
      actorUserId,
      payload: {
        trigger: 'manual',
        actorUserId,
        requestedAt: this.formatDate(new Date()),
        sources,
        maxSources,
      },
      status: 'Pending',
      processedAt: null,
      errorMessage: null,
    });
    await this.logSchedulerActivity(
      actorUserId,
      'Signals scheduler restart queued',
      'Success',
      running
        ? `Queued stop ${stopCommandId} and run ${runCommand.id} for ${SCHEDULER_KEY}`
        : `Queued run ${runCommand.id} for ${SCHEDULER_KEY}`
    );
    return successResponse({
      queued: true,
      action: 'restart',
      state: 'queued',
      message: 'Signals scheduler restart queued',
      commandIds: stopCommandId ? [stopCommandId, runCommand.id] : [runCommand.id],
    });
  }

  async purgeSchedulerLogs(actorUserId: string): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    try {
      if (!actorUserId) {
        throw new BadRequestAppError('actorUserId is required');
      }
      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
      const retentionDays = this.readRetentionDays(config);
      const updateLogsDeleted =
        await this.exchangeAssetUpdateLogRepository.deleteOlderThanDaysBySchedulerKeyAndActor(
          SCHEDULER_KEY,
          actorUserId,
          retentionDays
        );
      const runLogsDeleted =
        await this.schedulerRunLogRepository.deleteOlderThanDaysBySchedulerKeyAndActor(
          SCHEDULER_KEY,
          actorUserId,
          retentionDays
        );
      await this.logSchedulerActivity(
        actorUserId,
        'Signals scheduler logs purged',
        'Success',
        `Purged ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs for ${SCHEDULER_KEY}`
      );
      return successResponse({
        message: `Signals scheduler logs purged. Deleted ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs.`,
        retentionDays,
        runLogsDeleted,
        updateLogsDeleted,
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Signals scheduler logs purge failed',
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
    const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
    const retentionDays = this.readRetentionDays(config);
    const [runLogsToDelete, updateLogsToDelete] = await Promise.all([
      this.schedulerRunLogRepository.countOlderThanDaysBySchedulerKeyAndActor(
        SCHEDULER_KEY,
        actorUserId,
        retentionDays
      ),
      this.exchangeAssetUpdateLogRepository.countOlderThanDaysBySchedulerKeyAndActor(
        SCHEDULER_KEY,
        actorUserId,
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
    await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const { limit, offset } = validateListQuery(query);
    const { items, total } = await this.schedulerRunLogRepository.listRunsBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId,
      limit,
      offset
    );

    return successResponse({
      items: items.map((item) => this.mapRun(item)),
      total,
      limit,
      offset,
    });
  }

  async getSchedulerRunProgress(
    actorUserId: string,
    runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      throw new BadRequestAppError('runId is required');
    }
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKeyAndActor(
      normalizedRunId,
      SCHEDULER_KEY,
      actorUserId
    );
    if (!run) {
      return successResponse({ run: null });
    }

    return successResponse({
      run: this.mapRun(run),
    });
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
    await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      throw new BadRequestAppError('runId is required');
    }
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKeyAndActor(
      normalizedRunId,
      SCHEDULER_KEY,
      actorUserId
    );
    if (!run) {
      throw new NotFoundAppError('Signals scheduler run not found');
    }

    const params = validateListQuery(query);
    const sort = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;
    const { items, total } = await this.exchangeAssetUpdateLogRepository.listByRunLogId(
      normalizedRunId,
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
        source: item.source,
        accountId: item.accountId || undefined,
        connectionId: item.connectionId || undefined,
        actionType: item.actionType,
        symbol: item.symbol || undefined,
        externalId: item.externalId || undefined,
        assetId: item.assetId || undefined,
        message: item.message || undefined,
        detail: item.detail || undefined,
        createdAt: this.formatDate(item.createdAt),
      })),
      total,
      limit: params.limit,
      offset: params.offset,
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
    await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      throw new BadRequestAppError('runId is required');
    }
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKeyAndActor(
      normalizedRunId,
      SCHEDULER_KEY,
      actorUserId
    );
    if (!run) {
      throw new NotFoundAppError('Signals scheduler run not found');
    }

    const sort = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;

    const { items } = await this.exchangeAssetUpdateLogRepository.listByRunLogId(normalizedRunId, 100000, 0, {
      actionType: actionType || undefined,
      source: source || undefined,
      symbol: symbol || undefined,
      sortBy: sort.sortBy,
      sortOrder: sort.sortOrder,
    });

    const header = [
      'id',
      'runLogId',
      'source',
      'accountId',
      'connectionId',
      'actionType',
      'symbol',
      'externalId',
      'assetId',
      'message',
      'createdAt',
    ];
    const rows = items.map((item) => [
      item.id,
      item.runLogId,
      item.source,
      item.accountId || '',
      item.connectionId || '',
      item.actionType,
      item.symbol || '',
      item.externalId || '',
      item.assetId || '',
      item.message || '',
      this.formatDate(item.createdAt),
    ]);

    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');

    return successResponse({
      fileName: `signals-scheduler-run-${normalizedRunId}-updates.csv`,
      rowCount: rows.length,
      csv,
    });
  }

  private async ensureLegacySchedulerAnchor(timeZone?: string): Promise<SchedulerConfig> {
    const normalizedTimeZone = normalizeTimeZone(timeZone);
    let config = await this.schedulerConfigRepository.createIfMissing({
      key: SCHEDULER_KEY,
      name: SCHEDULER_DISPLAY_NAME,
      description: 'Scans active strategy library entries to refresh the Signals inbox.',
      enabled: false,
      cronExpression: '0 1 * * *',
      timezone: normalizedTimeZone,
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 12,
      schedulerType: 'global',
      config: {
        sources: DEFAULT_SOURCES,
        retentionDays: 30,
      },
    });

    const normalizedConfig = this.normalizePersistedConfigMap(config.config);
    const patch: Partial<SchedulerConfig> = {};
    if (config.name !== SCHEDULER_DISPLAY_NAME) {
      patch.name = SCHEDULER_DISPLAY_NAME;
    }
    if ((config.description || '') !== 'Scans active strategy library entries to refresh the Signals inbox.') {
      patch.description = 'Scans active strategy library entries to refresh the Signals inbox.';
    }
    if (config.enabled) {
      patch.enabled = false;
    }
    if (config.schedulerType !== 'global') {
      patch.schedulerType = 'global';
    }
    if (JSON.stringify(config.config ?? null) !== JSON.stringify(normalizedConfig)) {
      patch.config = normalizedConfig;
    }
    if (Object.keys(patch).length > 0) {
      const updated = await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, patch);
      if (updated) {
        config = updated;
      }
    }
    return config;
  }

  private async ensureSchedulerConfig(
    actorUserId: string,
    timeZone?: string
  ): Promise<SchedulerUserConfig> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }

    const normalizedTimeZone = normalizeTimeZone(timeZone);
    const anchor = await this.ensureLegacySchedulerAnchor(normalizedTimeZone);
    let config = await this.schedulerUserConfigRepository.createIfMissing({
      schedulerKey: SCHEDULER_KEY,
      userId: normalizedActorUserId,
      name: anchor.name,
      description: anchor.description,
      enabled: false,
      cronExpression: anchor.cronExpression,
      timezone: normalizedTimeZone,
      runAt: anchor.runAt,
      intervalDays: anchor.intervalDays,
      batchSize: anchor.batchSize,
      schedulerType: 'user',
      config: this.normalizePersistedConfigMap(anchor.config),
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      lastError: null,
      runningLockUntil: null,
    });

    const patch: Partial<SchedulerUserConfig> = {};
    if (config.schedulerType !== 'user') {
      patch.schedulerType = 'user';
    }
    if (String(config.timezone || '').trim() !== normalizedTimeZone) {
      patch.timezone = normalizedTimeZone;
    }
    if (!String(config.name || '').trim()) {
      patch.name = anchor.name;
    }
    if (!String(config.cronExpression || '').trim()) {
      patch.cronExpression = anchor.cronExpression;
    }
    if (!String(config.runAt || '').trim()) {
      patch.runAt = anchor.runAt;
    }
    if (!Number.isInteger(Number(config.intervalDays)) || Number(config.intervalDays) <= 0) {
      patch.intervalDays = anchor.intervalDays;
    }
    if (!Number.isInteger(Number(config.batchSize)) || Number(config.batchSize) <= 0) {
      patch.batchSize = anchor.batchSize;
    }

    const normalizedPersistedConfig = this.normalizePersistedConfigMap(config.config);
    if (JSON.stringify(config.config ?? null) !== JSON.stringify(normalizedPersistedConfig)) {
      patch.config = normalizedPersistedConfig;
    }

    if (Object.keys(patch).length > 0) {
      const updated = await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(
        SCHEDULER_KEY,
        normalizedActorUserId,
        patch
      );
      if (updated) {
        config = updated;
      }
    }

    return config;
  }

  private mapConfig(config: SignalsSchedulerUserConfigRecord): SchedulerConfigResponse {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const sources = this.resolveSourcesFromConfigMap(configMap);
    const retentionDays = this.readRetentionDays(config);
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
    const key = String(config.schedulerKey || SCHEDULER_KEY).trim() || SCHEDULER_KEY;

    return {
      key,
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
      schedulerType: 'user',
      sources,
      retentionDays,
      lastStartedAt: this.formatDate(config.lastStartedAt),
      lastFinishedAt: this.formatDate(config.lastFinishedAt),
      lastStatus: config.lastStatus || undefined,
      lastError: config.lastError || undefined,
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

  private mapRun(
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
      meta?: unknown;
    }
  ): SchedulerRunLogItem {
    const meta = this.mapRunMeta(item.meta);
    return {
      id: item.id,
      schedulerKey: item.schedulerKey,
      status: item.status,
      startedAt: this.formatDate(item.startedAt),
      finishedAt: item.finishedAt ? this.formatDate(item.finishedAt) : undefined,
      durationMs: item.durationMs ?? undefined,
      processedAccounts: item.processedAccounts,
      insertedAssets: item.insertedAssets,
      updatedAssets: item.updatedAssets,
      skippedAssets: item.skippedAssets,
      errorMessage: item.errorMessage || undefined,
      ...meta,
    };
  }

  private mapRunMeta(meta: unknown): Pick<SchedulerRunLogItem, 'progress'> {
    const parsed = this.parseMeta(meta);
    const progressRaw =
      parsed.progress && typeof parsed.progress === 'object' && !Array.isArray(parsed.progress)
        ? (parsed.progress as Record<string, unknown>)
        : null;
    if (!progressRaw) {
      return {};
    }
    return {
      progress: {
        total: this.readNumber(progressRaw.total),
        processed: this.readNumber(progressRaw.processed),
        percent: this.readNumber(progressRaw.percent),
        etaSeconds: this.readNumber(progressRaw.etaSeconds),
        currentItem:
          progressRaw.currentItem &&
          typeof progressRaw.currentItem === 'object' &&
          !Array.isArray(progressRaw.currentItem)
            ? {
                id: String((progressRaw.currentItem as Record<string, unknown>).id || ''),
                symbol: String((progressRaw.currentItem as Record<string, unknown>).symbol || ''),
                assetId: String((progressRaw.currentItem as Record<string, unknown>).assetId || ''),
              }
            : undefined,
      },
    };
  }

  private parseMeta(meta: unknown): Record<string, unknown> {
    if (!meta) {
      return {};
    }
    if (typeof meta === 'object' && !Array.isArray(meta)) {
      return meta as Record<string, unknown>;
    }
    if (typeof meta === 'string') {
      try {
        const parsed = JSON.parse(meta);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return {};
      }
    }
    return {};
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private readRetentionDays(config: SignalsSchedulerConfigLike): number {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const retentionDays = Number(configMap.retentionDays);
    if (Number.isInteger(retentionDays) && retentionDays > 0) {
      return retentionDays;
    }
    return 30;
  }

  private normalizeSources(rawSources: unknown[]): string[] {
    return Array.from(
      new Set(
        rawSources
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((item) => ALLOWED_SOURCES.has(item))
      )
    );
  }

  private resolveSourcesFromConfigMap(configMap: Record<string, unknown>): string[] {
    const configured = Array.isArray(configMap.sources) ? this.normalizeSources(configMap.sources) : [];
    return configured.length ? configured : [...DEFAULT_SOURCES];
  }

  private resolveMaxSources(config: SignalsSchedulerConfigLike): number {
    const raw = Number(config.batchSize || 12);
    if (!Number.isInteger(raw) || raw <= 0) {
      return 12;
    }
    return Math.min(50, Math.max(1, raw));
  }

  private normalizePersistedConfigMap(raw: unknown): Record<string, unknown> {
    const configMap =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? { ...(raw as Record<string, unknown>) }
        : {};
    return {
      ...configMap,
      sources: this.resolveSourcesFromConfigMap(configMap),
      retentionDays: this.readRetentionDays({ config: configMap }),
    };
  }

  private async logSchedulerActivity(
    userId: string,
    title: string,
    status: 'Success' | 'Failed' | 'Warning',
    description: string
  ): Promise<void> {
    await this.activityRepository.createActivityLog({
      userId,
      type: 'Scheduler run',
      title,
      status,
      route: 'Schedulers',
      stream: 'Runs',
      related: SCHEDULER_KEY,
      description,
    });
  }

  private async emitSchedulerFailureAlert(
    userId: string,
    title: string,
    message: string
  ): Promise<void> {
    const mergedMessage = `${title}: ${message}`.slice(0, 255);
    const throttled = await this.alertRepository.findRecentOpenAlertBySource({
      userId,
      channel: 'Scheduler',
      source: SCHEDULER_KEY,
      withinMinutes: env.observability.failureAlertThrottleMinutes,
    });
    if (throttled) {
      return;
    }
    await this.alertRepository.createAlert({
      userId,
      severity: 'High',
      channel: 'Scheduler',
      symbol: 'SIGNALS',
      message: mergedMessage,
      route: 'Schedulers',
      status: 'Open',
      source: SCHEDULER_KEY,
    });
  }
}
