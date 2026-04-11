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
  validateAssetPriceSchedulerConfigBody,
  validateListQuery,
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
import {
  ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES,
  ASSET_PRICE_SYNC_DEFAULT_CONFIG,
  ASSET_PRICE_SYNC_DESCRIPTION,
  ASSET_PRICE_SYNC_SCHEDULER_KEY,
  ASSET_PRICE_SYNC_SCHEDULER_NAME,
  ASSET_PRICE_SYNC_SCHEDULER_OWNERSHIP,
  ASSET_PRICE_SYNC_SYSTEM_SOURCES,
} from '../utils/assetPriceContract';
import { BadRequestAppError, ServiceUnavailableAppError } from '../errors/AppError';
import {
  ExchangeAssetUpdateLogRepository,
  SchedulerCommandRepository,
  SchedulerConfig,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  ActivityRepository,
  ExchangeAssetRepository,
  AlertRepository,
} from '../../database';
import { env } from '../../env';
import { UserTimeZoneService } from './UserTimeZoneService';

const SCHEDULER_KEY = ASSET_PRICE_SYNC_SCHEDULER_KEY;
const ASSET_PRICE_SCHEDULER_OWNERSHIP = ASSET_PRICE_SYNC_SCHEDULER_OWNERSHIP;
const ASSET_PRICE_SCHEDULER_DESCRIPTION = ASSET_PRICE_SYNC_DESCRIPTION;

@Service()
export class AssetPriceSchedulerService {
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

  @Inject(() => ExchangeAssetRepository)
  private exchangeAssetRepository!: ExchangeAssetRepository;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

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
      const payload = validateAssetPriceSchedulerConfigBody(body);
      const current = await this.ensureSchedulerConfig(timeZone);
      const currentConfig = (current.config ?? {}) as Record<string, unknown>;
      const nextConfig: Record<string, unknown> = { ...currentConfig };
      const bodyRecord = (body || {}) as Record<string, unknown>;

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
      nextConfig.useSystemConnectionsOnly =
        ASSET_PRICE_SYNC_DEFAULT_CONFIG.useSystemConnectionsOnly;
      if (bodyRecord.selectionMode !== undefined) {
        const mode = String(bodyRecord.selectionMode || '').trim().toLowerCase();
        if (
          mode === ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[0] ||
          mode === ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[1]
        ) {
          nextConfig.selectionMode = mode;
        }
      }
      if (bodyRecord.selectedAssetIds !== undefined) {
        if (!Array.isArray(bodyRecord.selectedAssetIds)) {
          throw new BadRequestAppError('selectedAssetIds must be an array');
        }
        nextConfig.selectedAssetIds = Array.from(
          new Set(
            bodyRecord.selectedAssetIds
              .map((item) => String(item || '').trim())
              .filter(Boolean)
          )
        );
      }
      if (
        payload.schedulerType !== undefined &&
        String(payload.schedulerType || '').trim().toLowerCase() !==
          ASSET_PRICE_SCHEDULER_OWNERSHIP
      ) {
        throw new BadRequestAppError(
          `${ASSET_PRICE_SYNC_SCHEDULER_NAME} is a global system scheduler and cannot be switched to user scope.`
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
        schedulerType: ASSET_PRICE_SCHEDULER_OWNERSHIP,
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
        'Asset price scheduler config updated',
        'Success',
        `Updated scheduler config for ${SCHEDULER_KEY}`
      );
      return successResponse(this.mapConfig(config, timeZone));
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Asset price scheduler config update failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitSchedulerFailureAlert(
        actorUserId,
        'Asset price scheduler config update failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async runNow(
    actorUserId: string,
    body: Partial<UpdateSchedulerConfigBody> = {}
  ): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    try {
      if (!actorUserId) {
        throw new BadRequestAppError('actorUserId is required');
      }
      const manualAudit = this.buildManualAudit(actorUserId);
      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const config = await this.ensureSchedulerConfig(timeZone);
      if (!config.enabled) {
        throw new BadRequestAppError('Asset price scheduler is paused. Resume it before running now.');
      }
      const runNowOverrides = this.parseRunNowScopeOverrides(body);
      const scope = await this.buildScopeFromConfig(config, runNowOverrides);

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
        const payload = (existingRunCommand.payload || {}) as Record<string, unknown>;
        const existingRunId = String(payload.runId || '').trim();
        const existingScope =
          payload.scope && typeof payload.scope === 'object' && !Array.isArray(payload.scope)
            ? (payload.scope as Record<string, unknown>)
            : {};
        const existingScopeAssets = Array.isArray(existingScope.assets)
          ? existingScope.assets.map((item) => String(item || '').trim()).filter(Boolean)
          : [];
        return successResponse({
          queued: true,
          executionMode: 'queue',
          started: false,
          ...(existingRunId ? { runId: existingRunId } : {}),
          jobId: existingRunCommand.id,
          ...(existingScopeAssets.length ? { scopeAssetsCount: existingScopeAssets.length } : {}),
          message: 'Asset price scheduler run already queued',
        });
      }
      const running = await this.schedulerRunLogRepository.hasRunningRun(SCHEDULER_KEY);
      if (running) {
        return successResponse({
          queued: false,
          executionMode: 'queue',
          started: false,
          message: 'Asset price scheduler run already in progress',
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
          scope: {
            assets: scope.assets,
            assetsCount: scope.assets.length,
          },
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
          scope,
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      await this.logSchedulerActivity(
        actorUserId,
        'Asset price scheduler run queued',
        'Success',
        `Queued run_now for ${SCHEDULER_KEY} as command ${command.id}`
      );

      return successResponse({
        queued: true,
        executionMode: 'queue',
        started: false,
        runId,
        jobId: command.id,
        scopeAssetsCount: scope.assets.length,
        message: `Asset price scheduler run queued for ${scope.assets.length} asset(s)`,
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Asset price scheduler run queue failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitSchedulerFailureAlert(
        actorUserId,
        'Asset price scheduler run queue failed',
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
    await this.logSchedulerActivity(actorUserId, 'Asset price scheduler paused', 'Success', `Paused ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'pause',
      message: 'Asset price scheduler paused',
      state: 'applied',
    });
  }

  async resumeScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(timeZone);
    await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, { enabled: true });
    await this.logSchedulerActivity(actorUserId, 'Asset price scheduler resumed', 'Success', `Resumed ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'resume',
      message: 'Asset price scheduler resumed',
      state: 'applied',
    });
  }

  async stopScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const manualAudit = this.buildManualAudit(actorUserId);
    if (env.scheduler.executionMode !== 'queue') {
      throw new ServiceUnavailableAppError(
        'Scheduler execution must run in queue mode from trading-scheduler-worker'
      );
    }
    const cancelledPendingRuns =
      await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndType(
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
      'Asset price scheduler stop requested',
      'Success',
      `Stop request handled for ${SCHEDULER_KEY}. activeStop=${running ? 'queued' : 'not-required'}, pendingRunsCancelled=${cancelledPendingRuns}`
    );
    return successResponse({
      queued: Boolean(stopCommandId),
      action: 'stop',
      message:
        running || cancelledPendingRuns > 0
          ? 'Asset price scheduler stop requested'
          : 'No active or queued asset price scheduler run to stop',
      state: stopCommandId ? 'queued' : cancelledPendingRuns > 0 ? 'applied' : 'noop',
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
      throw new BadRequestAppError('Asset price scheduler is paused. Resume it before restarting.');
    }
    if (env.scheduler.executionMode !== 'queue') {
      throw new ServiceUnavailableAppError(
        'Scheduler execution must run in queue mode from trading-scheduler-worker'
      );
    }
    const scope = await this.buildScopeFromConfig(config);
    await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndType(
      SCHEDULER_KEY,
      'run_now',
      `Cancelled by restart request from ${actorUserId}`
    );
    const running = await this.schedulerRunLogRepository.hasRunningRun(SCHEDULER_KEY);
    const commandIds: string[] = [];
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
      commandIds.push(stopCommand.id);
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
        scope,
      },
      status: 'Pending',
      processedAt: null,
      errorMessage: null,
    });
    commandIds.push(runCommand.id);
    await this.logSchedulerActivity(
      actorUserId,
      'Asset price scheduler restart queued',
      'Success',
      `Queued restart for ${SCHEDULER_KEY} (${scope.assets.length} assets)`
    );
    return successResponse({
      queued: true,
      action: 'restart',
      message: `Asset price scheduler restart queued for ${scope.assets.length} asset(s)`,
      state: 'queued',
      commandIds,
    });
  }

  async purgeSchedulerLogs(
    actorUserId: string
  ): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const config = await this.ensureSchedulerConfig(timeZone);
    const result = await this.applyRetentionPolicy(config);
    await this.logSchedulerActivity(
      actorUserId,
      'Asset price scheduler logs purged',
      'Success',
      `Deleted ${result.runLogsDeleted} run logs and ${result.updateLogsDeleted} update logs`
    );
    return successResponse({
      message: `Asset price scheduler logs purged. Deleted ${result.runLogsDeleted} run logs and ${result.updateLogsDeleted} update logs.`,
      retentionDays: this.readRetentionDays(config),
      runLogsDeleted: result.runLogsDeleted,
      updateLogsDeleted: result.updateLogsDeleted,
    });
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
      items: await resolveSchedulerAuditDisplayLabels(items.map((item) => this.mapRun(item, timeZone))),
      total,
      limit: params.limit,
      offset: params.offset,
      time: buildSchedulerTimeContract(timeZone),
    });
  }

  async listSchedulerAssets(query: {
    limit?: string;
    offset?: string;
    search?: string;
    assetId?: string;
  }): Promise<ApiSuccessResponse<SchedulerAssetListResponse>> {
    const params = this.parseAssetListQuery(query);
    const config = await this.ensureSchedulerConfig();
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const { items, total } = await this.exchangeAssetRepository.listSystemAssetsForAssetPriceScope({
      limit: params.limit,
      offset: params.offset,
      search: params.search,
      assetId: params.assetId,
      sources: this.readConfiguredSources(configMap),
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
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      throw new BadRequestAppError('runId is required');
    }
    const listParams = validateListQuery(query);
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKey(
      normalizedRunId,
      SCHEDULER_KEY
    );
    if (!run) {
      return successResponse({
        items: [],
        total: 0,
        limit: listParams.limit,
        offset: listParams.offset,
        time: buildSchedulerTimeContract(timeZone),
      });
    }
    const sortParams = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;
    const runMeta = this.parseMeta(run.meta);
    const { items, total } = await this.exchangeAssetUpdateLogRepository.listByRunLogId(
      normalizedRunId,
      listParams.limit,
      listParams.offset,
      {
        actionType: actionType || undefined,
        source: source || undefined,
        symbol: symbol || undefined,
        sortBy: sortParams.sortBy,
        sortOrder: sortParams.sortOrder,
      }
    );
    return successResponse({
      items: items.map((item): SchedulerAssetUpdateLogItem => ({
        id: item.id,
        runLogId: item.runLogId,
        ...toSchedulerAuditContract(
          item as unknown as Record<string, unknown>,
          run as unknown as Record<string, unknown>,
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
        ...(item.detail ? { detail: item.detail } : {}),
        createdAt:
          this.formatDisplayDate(item.createdAt, timeZone) || this.formatDate(item.createdAt)!,
        createdAtIso: formatSchedulerRawIso(item.createdAt),
      })),
      total,
      limit: listParams.limit,
      offset: listParams.offset,
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
      run: await resolveSchedulerAuditDisplayLabels(this.mapRun(run, timeZone)),
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
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      throw new BadRequestAppError('runId is required');
    }
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKey(
      normalizedRunId,
      SCHEDULER_KEY
    );
    const sortParams = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;
    const runMeta = run ? this.parseMeta(run.meta) : null;

    const items = run
      ? (
          await this.exchangeAssetUpdateLogRepository.listByRunLogId(normalizedRunId, 100000, 0, {
            actionType: actionType || undefined,
            source: source || undefined,
            symbol: symbol || undefined,
            sortBy: sortParams.sortBy,
            sortOrder: sortParams.sortOrder,
          })
        ).items
      : [];

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
      fileName: `scheduler-run-${normalizedRunId}-updates.csv`,
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
      name: ASSET_PRICE_SYNC_SCHEDULER_NAME,
      description: ASSET_PRICE_SCHEDULER_DESCRIPTION,
      enabled: false,
      cronExpression: '0 1 * * *',
      timezone: normalizedTimeZone,
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 200,
      schedulerType: ASSET_PRICE_SCHEDULER_OWNERSHIP,
      config: {
        ...ASSET_PRICE_SYNC_DEFAULT_CONFIG,
      },
    });
    const normalizedSchedulerType = String(config.schedulerType || '').trim().toLowerCase();
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const requiresNormalization =
      normalizedSchedulerType !== ASSET_PRICE_SCHEDULER_OWNERSHIP ||
      String(config.description || '').trim() !== ASSET_PRICE_SCHEDULER_DESCRIPTION ||
      configMap.useSystemConnectionsOnly !== ASSET_PRICE_SYNC_DEFAULT_CONFIG.useSystemConnectionsOnly;
    if (!requiresNormalization) {
      return config;
    }
    const normalized = await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, {
      schedulerType: ASSET_PRICE_SCHEDULER_OWNERSHIP,
      description: ASSET_PRICE_SCHEDULER_DESCRIPTION,
      config: {
        ...configMap,
        useSystemConnectionsOnly: ASSET_PRICE_SYNC_DEFAULT_CONFIG.useSystemConnectionsOnly,
      },
    });
    return (
      normalized || {
        ...config,
        schedulerType: ASSET_PRICE_SCHEDULER_OWNERSHIP,
        description: ASSET_PRICE_SCHEDULER_DESCRIPTION,
      }
    );
  }

  private mapConfig(config: SchedulerConfig, timeZone: string): SchedulerConfigResponse {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : [...ASSET_PRICE_SYNC_SYSTEM_SOURCES];
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
    const selectionMode =
      String(configMap.selectionMode || '').trim().toLowerCase() ===
      ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[1]
        ? ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[1]
        : ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[0];
    const selectedAssetIds = Array.isArray(configMap.selectedAssetIds)
      ? Array.from(
          new Set(
            configMap.selectedAssetIds
              .map((item) => String(item || '').trim())
              .filter(Boolean)
          )
        )
      : [];

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
      schedulerType: ASSET_PRICE_SCHEDULER_OWNERSHIP,
      sources,
      retentionDays,
      selectionMode,
      selectedAssetIds,
      time: buildSchedulerTimeContract(timeZone),
      lastStartedAt: this.formatDisplayDate(config.lastStartedAt, timeZone),
      lastStartedAtIso: formatSchedulerRawIso(config.lastStartedAt),
      lastFinishedAt: this.formatDisplayDate(config.lastFinishedAt, timeZone),
      lastFinishedAtIso: formatSchedulerRawIso(config.lastFinishedAt),
      lastStatus: config.lastStatus || undefined,
      lastError: config.lastError || undefined,
    };
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
    },
    timeZone: string
  ): SchedulerRunLogItem {
    const meta = this.mapRunMeta(item.meta);
    return {
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
      processedAccounts: item.processedAccounts || 0,
      insertedAssets: item.insertedAssets || 0,
      updatedAssets: item.updatedAssets || 0,
      skippedAssets: item.skippedAssets || 0,
      errorMessage: item.errorMessage || undefined,
      ...meta,
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

  private readRetentionDays(config: SchedulerConfig): number {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const retentionDays = Number(configMap.retentionDays);
    if (Number.isInteger(retentionDays) && retentionDays > 0) {
      return retentionDays;
    }
    return 30;
  }

  private readConfiguredSources(configMap: Record<string, unknown>): string[] {
    const configuredSources = Array.isArray(configMap.sources)
      ? configMap.sources
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((item) =>
            ASSET_PRICE_SYNC_SYSTEM_SOURCES.some((allowedSource) => allowedSource === item)
          )
      : [];
    return configuredSources.length ? Array.from(new Set(configuredSources)) : [...ASSET_PRICE_SYNC_SYSTEM_SOURCES];
  }

  private async resolveScopeAssetIds(
    selectionMode: 'all' | 'custom',
    selectedAssetIds: string[],
    sources: string[]
  ): Promise<string[]> {
    if (selectionMode === ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[1]) {
      if (!selectedAssetIds.length) {
        throw new BadRequestAppError('Select at least one asset or switch to All assets.');
      }
      const ids = await this.exchangeAssetRepository.listSystemAssetIdsByIds(selectedAssetIds, sources);
      if (!ids.length) {
        throw new BadRequestAppError('Selected assets could not be resolved to broker asset IDs');
      }
      return ids;
    }

    const ids = await this.exchangeAssetRepository.listSystemAssetIdsBySources(sources);
    if (!ids.length) {
      throw new BadRequestAppError('No system assets available for asset price scheduler scope');
    }
    return ids;
  }

  private async buildScopeFromConfig(
    config: SchedulerConfig,
    overrides?: {
      selectionMode?: 'all' | 'custom';
      selectedAssetIds?: string[];
      sources?: string[];
    } | null
  ): Promise<{ assets: string[] }> {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const selectionMode =
      overrides?.selectionMode ||
      (String(configMap.selectionMode || '').trim().toLowerCase() ===
      ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[1]
        ? ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[1]
        : ASSET_PRICE_SYNC_ALLOWED_SELECTION_MODES[0]);
    const selectedAssetIds =
      overrides?.selectedAssetIds ||
      (Array.isArray(configMap.selectedAssetIds)
        ? Array.from(
            new Set(
              configMap.selectedAssetIds
                .map((item) => String(item || '').trim())
                .filter(Boolean)
            )
          )
        : []);
    const sources =
      overrides?.sources && overrides.sources.length
        ? overrides.sources
        : this.readConfiguredSources(configMap);
    const assets = await this.resolveScopeAssetIds(selectionMode, selectedAssetIds, sources);
    return { assets };
  }

  private parseRunNowScopeOverrides(
    body: Partial<UpdateSchedulerConfigBody> | undefined
  ):
    | {
        selectionMode?: 'all' | 'custom';
        selectedAssetIds?: string[];
        sources?: string[];
      }
    | null {
    const bodyRecord =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    if (!bodyRecord) {
      return null;
    }

    const hasScopeOverrideFields =
      bodyRecord.sources !== undefined ||
      bodyRecord.selectionMode !== undefined ||
      bodyRecord.selectedAssetIds !== undefined;

    if (!hasScopeOverrideFields) {
      return null;
    }

    const payload = validateAssetPriceSchedulerConfigBody(
      body as Partial<UpdateSchedulerConfigBody>
    );
    return {
      ...(payload.sources ? { sources: payload.sources } : {}),
      ...(payload.selectionMode ? { selectionMode: payload.selectionMode } : {}),
      ...(payload.selectedAssetIds ? { selectedAssetIds: payload.selectedAssetIds } : {}),
    };
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
    const progress = progressRaw
      ? {
          total: this.readNumber(progressRaw.total),
          processed: this.readNumber(progressRaw.processed),
          percent: this.readNumber(progressRaw.percent),
          ...(progressRaw.etaSeconds !== undefined
            ? { etaSeconds: this.readNumber(progressRaw.etaSeconds) }
            : {}),
          ...(progressRaw.currentItem && typeof progressRaw.currentItem === 'object'
            ? {
                currentItem: {
                  ...(progressRaw.currentItem as Record<string, unknown>),
                },
              }
            : {}),
        }
      : undefined;
    return {
      ...scopeMeta,
      ...(progress ? { progress } : {}),
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
        const parsed = JSON.parse(meta) as unknown;
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
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) {
      return 0;
    }
    return numberValue;
  }

  private buildManualAudit(actorUserId: string) {
    return buildSystemSchedulerManualAudit(actorUserId);
  }

  private async logSchedulerActivity(
    actorUserId: string,
    title: string,
    status: 'Success' | 'Failed',
    description: string
  ): Promise<void> {
    await this.activityRepository.createActivityLog({
      userId: actorUserId,
      type: 'Scheduler',
      title,
      status,
      route: 'Schedulers',
      stream: 'Controls',
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
      symbol: 'ASSET_PRICE',
      message: mergedMessage,
      route: 'Schedulers',
      status: 'Open',
      source: SCHEDULER_KEY,
    });
  }
}
