import { randomUUID } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  OrdersSchedulerPolicy,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  OrdersSchedulerRunNowBody,
  SchedulerRecordSyncSummaryResponse,
  SchedulerRecordSyncStateItem,
  SchedulerRecordSyncStateListResponse,
  SchedulerRunLogItem,
  SchedulerRunLogListResponse,
  SchedulerRunProgressResponse,
  SchedulerRunUpdateLogItem,
  SchedulerRunUpdateLogListResponse,
  SchedulerRunNowResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import {
  validateListQuery,
  validateOrdersSchedulerConfigBody,
  validateOrdersSchedulerRunBody,
  validateOrdersSchedulerSyncStateQuery,
  validateUpdateLogSortQuery,
} from '../validators/scheduler.validator';
import { successResponse } from '../utils/response';
import {
  buildSystemSchedulerManualAudit,
  toSchedulerAuditContract,
} from '../utils/schedulerAuditContract';
import {
  buildSchedulerTimeContract,
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../utils/schedulerTimeContract';
import {
  DEFAULT_SCHEDULER_TIMEZONE,
  normalizeTimeZone,
} from '../utils/timezone';
import {
  BadRequestAppError,
  NotFoundAppError,
  ServiceUnavailableAppError,
} from '../errors/AppError';
import {
  BrokerAccountRepository,
  ExchangeAssetUpdateLogRepository,
  SchedulerCommandRepository,
  SchedulerConfig,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  SchedulerUserConfig,
  SchedulerUserConfigRepository,
  ActivityRepository,
  AlertRepository,
} from '../../database';
import { coreDataSource } from '../../database/data-source';
import { env } from '../../env';
import { SchedulerRuntimeSchemaService } from './SchedulerRuntimeSchemaService';
import { UserTimeZoneService } from './UserTimeZoneService';
import {
  OrdersSchedulerSyncStateRecord,
  OrdersSchedulerSyncStateSummaryRecord,
  OrdersSyncDiagnosticsService,
} from './OrdersSyncDiagnosticsService';
import {
  ORDERS_SYNC_SCHEDULER_KEY,
  ORDERS_SYNC_SCHEDULER_NAME,
  ORDERS_SYNC_SCHEDULER_OWNERSHIP,
} from '../utils/positionsOrdersSyncScopeContract';

const SCHEDULER_KEY = ORDERS_SYNC_SCHEDULER_KEY;
const ORDERS_SCHEDULER_OWNERSHIP = ORDERS_SYNC_SCHEDULER_OWNERSHIP;
const ORDERS_SCHEDULER_NAME = ORDERS_SYNC_SCHEDULER_NAME;
const ORDERS_SCHEDULER_DESCRIPTION =
  'System reconciliation scheduler for broker order snapshots, checkpoints, and repair replay tooling.';
const ORDERS_MAX_LOOKBACK_DAYS = 90;
const ORDERS_HISTORY_WINDOW_DAYS = 7;
const ORDERS_INCREMENTAL_OVERLAP_DAYS = 1;

type OrdersSchedulerUserConfigRecord = SchedulerUserConfig;
type OrdersSchedulerConfigLike = {
  batchSize?: number | null;
  config?: Record<string, unknown> | null;
};

@Service()
export class OrdersSchedulerService {
  @Inject(() => SchedulerConfigRepository)
  private schedulerConfigRepository!: SchedulerConfigRepository;

  @Inject(() => SchedulerUserConfigRepository)
  private schedulerUserConfigRepository!: SchedulerUserConfigRepository;

  @Inject(() => SchedulerRunLogRepository)
  private schedulerRunLogRepository!: SchedulerRunLogRepository;

  @Inject(() => ExchangeAssetUpdateLogRepository)
  private exchangeAssetUpdateLogRepository!: ExchangeAssetUpdateLogRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => SchedulerCommandRepository)
  private schedulerCommandRepository!: SchedulerCommandRepository;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => SchedulerRuntimeSchemaService)
  private schedulerRuntimeSchemaService!: SchedulerRuntimeSchemaService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  @Inject(() => OrdersSyncDiagnosticsService)
  private ordersSyncDiagnosticsService: OrdersSyncDiagnosticsService =
    new OrdersSyncDiagnosticsService();

  async getSchedulerConfig(userId: string): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    const timeZone = await this.resolveUserTimeZone(userId);
    const config = await this.ensureSchedulerConfig(userId, timeZone);
    return successResponse(this.mapConfig(config, timeZone));
  }

  async updateSchedulerConfig(
    actorUserId: string,
    body: Partial<UpdateSchedulerConfigBody>
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    try {
      const timeZone = await this.resolveUserTimeZone(actorUserId);
      const payload = validateOrdersSchedulerConfigBody(body);
      const current = await this.ensureSchedulerConfig(actorUserId, timeZone);
      const currentConfig = this.normalizePersistedConfigMap(current.config);
      const nextConfig: Record<string, unknown> = {
        ...currentConfig,
        sources: ['orders'],
        lookbackDays: this.readOrdersLookbackDays(currentConfig),
      };

      if (payload.sources) {
        nextConfig.sources = payload.sources;
      }
      if (payload.retentionDays !== undefined) {
        nextConfig.retentionDays = payload.retentionDays;
      }
      if (payload.lookbackDays !== undefined) {
        nextConfig.lookbackDays = payload.lookbackDays;
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
      if (
        payload.schedulerType !== undefined &&
        String(payload.schedulerType || '').trim().toLowerCase() !==
          ORDERS_SCHEDULER_OWNERSHIP
      ) {
        throw new BadRequestAppError(
          `${ORDERS_SCHEDULER_NAME} is a user scheduler and cannot be switched to global scope.`
        );
      }
      this.assertResolvedScheduleConfig({
        runAt: payload.runAt ?? current.runAt,
        intervalDays: payload.intervalDays ?? current.intervalDays,
        scheduleMode:
          payload.scheduleMode ?? String(nextConfig.scheduleMode || currentConfig.scheduleMode || 'daily'),
        intervalMinutes:
          payload.intervalMinutes ?? Number(nextConfig.intervalMinutes ?? currentConfig.intervalMinutes),
        intervalSeconds:
          payload.intervalSeconds ?? Number(nextConfig.intervalSeconds ?? currentConfig.intervalSeconds),
        hourlyMinute:
          payload.hourlyMinute ?? Number(nextConfig.hourlyMinute ?? currentConfig.hourlyMinute),
      });

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
          schedulerType: ORDERS_SCHEDULER_OWNERSHIP,
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
        'Orders scheduler config updated',
        'Success',
        `Updated scheduler config for ${SCHEDULER_KEY}`
      );
      return successResponse(this.mapConfig(config, timeZone));
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Orders scheduler config update failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async runNow(
    actorUserId: string,
    body: Partial<OrdersSchedulerRunNowBody> = {}
  ): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    try {
      if (!actorUserId) {
        throw new BadRequestAppError('actorUserId is required');
      }
      const timeZone = await this.resolveUserTimeZone(actorUserId);
      const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
      const runRequest = validateOrdersSchedulerRunBody(body);
      if (!config.enabled) {
        throw new BadRequestAppError('Orders scheduler is paused. Resume it before running now.');
      }
      if (env.scheduler.executionMode !== 'queue') {
        throw new ServiceUnavailableAppError(
          'Scheduler execution must run in queue mode from trading-scheduler-worker'
        );
      }
      const requestedAt = this.formatDate(new Date());
      const lookbackDays = this.readOrdersLookbackDays((config.config ?? {}) as Record<string, unknown>);
      const scope = await this.resolveScopedOrdersRun(runRequest);
      const isScopedReplay = Boolean(scope.accountId || scope.brokerKey || runRequest.resetCheckpoint);
      const executionActorUserId = this.resolveSystemExecutionActorUserId(actorUserId);
      const manualAudit = this.buildManualAudit(actorUserId);

      if (!isScopedReplay) {
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
            message: 'Orders scheduler run already queued',
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
            message: 'Orders scheduler run already in progress',
          });
        }
      }

      if (runRequest.resetCheckpoint && scope.accountId) {
        await this.resetCheckpointForAccount(scope.accountId);
      }

      const trigger = runRequest.resetCheckpoint
        ? 'repair-replay'
        : scope.accountId || scope.brokerKey
          ? 'scoped-manual'
          : 'manual';
      const runId = randomUUID();
      await this.schedulerRunLogRepository.createRun({
        id: runId,
        schedulerKey: SCHEDULER_KEY,
        actorUserId,
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
          trigger,
          actorUserId: executionActorUserId,
          requestedByUserId: actorUserId,
          requestedAt,
          initiatedByType: manualAudit.initiatedByType,
          initiatedByUserId: manualAudit.initiatedByUserId,
          initiatedByLabel: manualAudit.initiatedByLabel,
          executionContext: manualAudit.executionContext,
          ...(scope.scope ? { scope: scope.scope } : {}),
          ...(runRequest.resetCheckpoint && scope.accountId
            ? {
                replay: {
                  mode: 'checkpoint_reset_then_scoped_run',
                  accountId: scope.accountId,
                  brokerKey: scope.brokerKey || null,
                  lookbackDays,
                },
              }
            : {}),
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
        actorUserId,
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
        payload: {
          runId,
          trigger,
          actorUserId: executionActorUserId,
          requestedByUserId: actorUserId,
          requestedAt,
          initiatedByType: manualAudit.initiatedByType,
          initiatedByUserId: manualAudit.initiatedByUserId,
          initiatedByLabel: manualAudit.initiatedByLabel,
          executionContext: manualAudit.executionContext,
          ...(scope.scope ? { scope: scope.scope } : {}),
          ...(runRequest.resetCheckpoint && scope.accountId
            ? {
                replay: {
                  mode: 'checkpoint_reset_then_scoped_run',
                  accountId: scope.accountId,
                  brokerKey: scope.brokerKey || null,
                  checkpointReset: true,
                  lookbackDays,
                },
              }
            : {}),
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      await this.logSchedulerActivity(
        actorUserId,
        runRequest.resetCheckpoint && scope.accountId
          ? 'Orders scheduler replay queued'
          : scope.accountId || scope.brokerKey
            ? 'Orders scheduler scoped run queued'
            : 'Orders scheduler run queued',
        'Success',
        runRequest.resetCheckpoint && scope.accountId
          ? `Reset checkpoint and queued replay for ${scope.scopeLabel} using ${lookbackDays}-day lookback as command ${command.id}`
          : scope.accountId || scope.brokerKey
            ? `Queued scoped run for ${scope.scopeLabel} as command ${command.id}`
            : `Queued run_now for ${SCHEDULER_KEY} as command ${command.id}`
      );

      return successResponse({
        queued: true,
        executionMode: 'queue',
        started: false,
        runId,
        jobId: command.id,
        message:
          runRequest.resetCheckpoint && scope.accountId
            ? `Orders replay queued for ${scope.scopeLabel}. Checkpoint reset; next run will backfill up to ${lookbackDays} days.`
            : scope.accountId || scope.brokerKey
              ? `Scoped orders run queued for ${scope.scopeLabel}.`
              : 'Orders scheduler command queued',
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Orders scheduler run queue failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitSchedulerFailureAlert(
        actorUserId,
        'Orders scheduler run queue failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async pauseScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(actorUserId, timeZone);
    await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(SCHEDULER_KEY, actorUserId, {
      enabled: false,
      schedulerType: ORDERS_SCHEDULER_OWNERSHIP,
    });
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
    await this.logSchedulerActivity(actorUserId, 'Orders scheduler paused', 'Success', `Paused ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'pause',
      message: 'Orders scheduler paused',
      state: 'applied',
      commandIds: [],
    });
  }

  async resumeScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(actorUserId, timeZone);
    await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(SCHEDULER_KEY, actorUserId, {
      enabled: true,
      schedulerType: ORDERS_SCHEDULER_OWNERSHIP,
    });
    await this.logSchedulerActivity(actorUserId, 'Orders scheduler resumed', 'Success', `Resumed ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'resume',
      message: 'Orders scheduler resumed',
      state: 'applied',
      commandIds: [],
    });
  }

  async stopScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(actorUserId, timeZone);
    if (env.scheduler.executionMode !== 'queue') {
      throw new ServiceUnavailableAppError('Stop is supported only in queue mode');
    }
    const cancelledPendingRuns =
      await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndTypeAndActor(
        SCHEDULER_KEY,
        'run_now',
        actorUserId,
        `Cancelled by stop request from ${actorUserId}`
      );
    const manualAudit = this.buildManualAudit(actorUserId);
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
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
        payload: {
          actorUserId,
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
      'Orders scheduler stop requested',
      'Success',
      `Stop request handled for ${SCHEDULER_KEY}. activeStop=${running ? 'queued' : 'not-required'}, pendingRunsCancelled=${cancelledPendingRuns}`
    );
    return successResponse({
      queued: Boolean(stopCommandId),
      action: 'stop',
      state: stopCommandId ? 'queued' : cancelledPendingRuns > 0 ? 'applied' : 'noop',
      message:
        running || cancelledPendingRuns > 0
          ? 'Orders scheduler stop requested'
          : 'No active or queued orders scheduler run to stop',
      commandIds: stopCommandId ? [stopCommandId] : [],
    });
  }

  async restartScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
    const executionActorUserId = this.resolveSystemExecutionActorUserId(actorUserId);
    const manualAudit = this.buildManualAudit(actorUserId);
    if (!config.enabled) {
      throw new BadRequestAppError('Orders scheduler is paused. Resume it before restarting.');
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
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
        payload: {
          actorUserId,
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
      actorUserId,
      initiatedByType: manualAudit.initiatedByType,
      initiatedByUserId: manualAudit.initiatedByUserId ?? null,
      initiatedByLabel: manualAudit.initiatedByLabel ?? null,
      executionContext: manualAudit.executionContext,
      payload: {
        trigger: 'manual',
        actorUserId: executionActorUserId,
        requestedByUserId: actorUserId,
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
      'Orders scheduler restart queued',
      'Success',
      running
        ? `Queued stop ${stopCommandId} and run ${runCommand.id} for ${SCHEDULER_KEY}`
        : `Queued run ${runCommand.id} for ${SCHEDULER_KEY}`
    );
    return successResponse({
      queued: true,
      action: 'restart',
      state: 'queued',
      message: 'Orders scheduler restart queued',
      commandIds: stopCommandId ? [stopCommandId, runCommand.id] : [runCommand.id],
    });
  }

  async purgeSchedulerLogs(actorUserId: string): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    try {
      if (!actorUserId) {
        throw new BadRequestAppError('actorUserId is required');
      }
      const timeZone = await this.resolveUserTimeZone(actorUserId);
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
        'Orders scheduler logs purged',
        'Success',
        `Purged ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs for ${SCHEDULER_KEY}`
      );
      return successResponse({
        message: `Orders scheduler logs purged. Deleted ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs.`,
        retentionDays,
        runLogsDeleted,
        updateLogsDeleted,
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Orders scheduler logs purge failed',
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
    const timeZone = await this.resolveUserTimeZone(actorUserId);
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
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    const { limit, offset } = validateListQuery(query);
    await this.ensureSchedulerConfig(actorUserId, timeZone);
    const { items, total } = await this.schedulerRunLogRepository.listRunsBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId,
      limit,
      offset
    );

    return successResponse({
      items: items.map((item) => this.mapRun(item, timeZone)),
      total,
      limit,
      offset,
      time: buildSchedulerTimeContract(timeZone),
    });
  }

  async getSchedulerRunProgress(
    actorUserId: string,
    runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    const timeZone = await this.resolveUserTimeZone(actorUserId);
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
      return successResponse({ run: null, time: buildSchedulerTimeContract(timeZone) });
    }

    return successResponse({
      run: this.mapRun(run, timeZone),
      time: buildSchedulerTimeContract(timeZone),
    });
  }

  async listSchedulerSyncState(
    actorUserId: string,
    query: {
      limit?: string;
      offset?: string;
      accountId?: string;
      ownerUserId?: string;
      userId?: string;
      brokerKey?: string;
    }
  ): Promise<ApiSuccessResponse<SchedulerRecordSyncStateListResponse>> {
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    const { limit, offset, accountId, ownerUserId, brokerKey } =
      validateOrdersSchedulerSyncStateQuery(query);
    const runtimeFoundation = await this.schedulerRuntimeSchemaService.inspectOrdersRuntimeSchema();
    const { items, total } = await this.ordersSyncDiagnosticsService.listSchedulerSyncStateRecords(
      {
        accountId,
        ownerUserId,
        brokerKey,
      },
      {
        limit,
        offset,
        includeRuntimeState: runtimeFoundation.status === 'ready',
      }
    );
    return successResponse({
      items: items.map((item) => this.mapSyncStateRow(item, timeZone)),
      total,
      limit,
      offset,
      time: buildSchedulerTimeContract(timeZone),
    });
  }

  async getSchedulerSyncStateSummary(
    actorUserId: string
  ): Promise<ApiSuccessResponse<SchedulerRecordSyncSummaryResponse>> {
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    const runtimeFoundation = await this.schedulerRuntimeSchemaService.inspectOrdersRuntimeSchema();
    const summary = await this.ordersSyncDiagnosticsService.getSchedulerSyncStateSummaryRecord(
      runtimeFoundation.status === 'ready'
    );
    return successResponse(
      this.mapSyncStateSummaryRow(summary, timeZone, runtimeFoundation)
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
  ): Promise<ApiSuccessResponse<SchedulerRunUpdateLogListResponse>> {
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    await this.assertRunBelongsToOrdersScheduler(actorUserId, runId);
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKeyAndActor(
      runId,
      SCHEDULER_KEY,
      actorUserId
    );
    const runMeta = this.parseMeta(run?.meta);
    const params = validateListQuery(query);
    const sort = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;
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
      items: items.map((item): SchedulerRunUpdateLogItem => ({
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
        detail: item.detail || undefined,
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
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    await this.assertRunBelongsToOrdersScheduler(actorUserId, runId);
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKeyAndActor(
      runId,
      SCHEDULER_KEY,
      actorUserId
    );
    const runMeta = this.parseMeta(run?.meta);
    const sort = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;

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
        this.formatDisplayDate(item.createdAt, timeZone) || this.formatDate(item.createdAt),
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

  private normalizePersistedConfigMap(value: unknown): Record<string, unknown> {
    const configMap =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['orders'];
    configMap.sources = sources.length ? Array.from(new Set(sources)) : ['orders'];

    const retentionDays = Number(configMap.retentionDays);
    configMap.retentionDays =
      Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 30;

    const lookbackDays = Number(configMap.lookbackDays);
    configMap.lookbackDays = this.normalizeLookbackDays(lookbackDays);

    return configMap;
  }

  private async ensureLegacySchedulerAnchor(): Promise<SchedulerConfig> {
    const normalizedTimeZone = normalizeTimeZone(
      DEFAULT_SCHEDULER_TIMEZONE,
      DEFAULT_SCHEDULER_TIMEZONE
    );
    let config = await this.schedulerConfigRepository.createIfMissing({
      key: SCHEDULER_KEY,
      name: ORDERS_SCHEDULER_NAME,
      description: ORDERS_SCHEDULER_DESCRIPTION,
      enabled: false,
      cronExpression: '0 1 * * *',
      timezone: normalizedTimeZone,
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 200,
      schedulerType: ORDERS_SCHEDULER_OWNERSHIP,
      config: {
        sources: ['orders'],
        retentionDays: 30,
        lookbackDays: 90,
      },
    });

    const patch: Partial<SchedulerConfig> = {};
    const normalizedPersistedConfig = this.normalizePersistedConfigMap(config.config);

    if (config.schedulerType !== ORDERS_SCHEDULER_OWNERSHIP) {
      patch.schedulerType = ORDERS_SCHEDULER_OWNERSHIP;
    }
    if (String(config.name || '').trim() !== ORDERS_SCHEDULER_NAME) {
      patch.name = ORDERS_SCHEDULER_NAME;
    }
    if (String(config.description || '').trim() !== ORDERS_SCHEDULER_DESCRIPTION) {
      patch.description = ORDERS_SCHEDULER_DESCRIPTION;
    }
    if (!String(config.cronExpression || '').trim()) {
      patch.cronExpression = '0 1 * * *';
    }
    if (!String(config.timezone || '').trim()) {
      patch.timezone = normalizedTimeZone;
    }
    if (!String(config.runAt || '').trim()) {
      patch.runAt = '01:00';
    }
    if (!Number.isInteger(Number(config.intervalDays)) || Number(config.intervalDays) <= 0) {
      patch.intervalDays = 1;
    }
    if (!Number.isInteger(Number(config.batchSize)) || Number(config.batchSize) <= 0) {
      patch.batchSize = 200;
    }
    if (JSON.stringify(config.config ?? null) !== JSON.stringify(normalizedPersistedConfig)) {
      patch.config = normalizedPersistedConfig;
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
    _timeZone?: string
  ): Promise<SchedulerUserConfig> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }

    const anchor = await this.ensureLegacySchedulerAnchor();
    const normalizedTimeZone = normalizeTimeZone(anchor.timezone, DEFAULT_SCHEDULER_TIMEZONE);
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
      schedulerType: ORDERS_SCHEDULER_OWNERSHIP,
      config: this.normalizePersistedConfigMap(anchor.config),
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      lastError: null,
      runningLockUntil: null,
    });

    const patch: Partial<SchedulerUserConfig> = {};
    if (config.schedulerType !== ORDERS_SCHEDULER_OWNERSHIP) {
      patch.schedulerType = ORDERS_SCHEDULER_OWNERSHIP;
    }
    if (!String(config.timezone || '').trim()) {
      patch.timezone = normalizedTimeZone;
    }
    if (!String(config.name || '').trim()) {
      patch.name = anchor.name;
    }
    if (!String(config.description || '').trim()) {
      patch.description = anchor.description;
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

  private mapConfig(
    config: OrdersSchedulerUserConfigRecord,
    timeZone: string
  ): SchedulerConfigResponse {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const sources = ['orders'];
    const retentionDays = this.readRetentionDays(config);
    const lookbackDays = this.readOrdersLookbackDays(configMap);
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
      key: String(config.schedulerKey || SCHEDULER_KEY).trim() || SCHEDULER_KEY,
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
      schedulerType: ORDERS_SCHEDULER_OWNERSHIP,
      sources,
      retentionDays,
      lookbackDays,
      ordersPolicy: this.buildOrdersPolicy(lookbackDays),
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
      initiatedByType?: string | null;
      initiatedByUserId?: string | null;
      initiatedByLabel?: string | null;
      executionContext?: string | null;
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
      processedAccounts: item.processedAccounts,
      insertedAssets: item.insertedAssets,
      updatedAssets: item.updatedAssets,
      skippedAssets: item.skippedAssets,
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

  private async resolveUserTimeZone(userId?: string | null): Promise<string> {
    if (this.userTimeZoneService?.resolveUserTimeZone) {
      return this.userTimeZoneService.resolveUserTimeZone(userId);
    }
    return normalizeTimeZone(DEFAULT_SCHEDULER_TIMEZONE, DEFAULT_SCHEDULER_TIMEZONE);
  }

  private mapRunMeta(meta: unknown): Pick<SchedulerRunLogItem, 'progress' | 'scopeAssetsCount'> {
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
        ...(progressRaw.currentItem &&
        typeof progressRaw.currentItem === 'object' &&
        !Array.isArray(progressRaw.currentItem)
          ? {
              currentItem: {
                ...(String((progressRaw.currentItem as Record<string, unknown>).symbol || '').trim()
                  ? { symbol: String((progressRaw.currentItem as Record<string, unknown>).symbol) }
                  : {}),
                ...(String((progressRaw.currentItem as Record<string, unknown>).assetId || '').trim()
                  ? { assetId: String((progressRaw.currentItem as Record<string, unknown>).assetId) }
                  : {}),
                ...(String((progressRaw.currentItem as Record<string, unknown>).id || '').trim()
                  ? { id: String((progressRaw.currentItem as Record<string, unknown>).id) }
                  : {}),
              },
            }
          : {}),
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

  private mapSyncStateRow(
    row: OrdersSchedulerSyncStateRecord,
    timeZone: string
  ): SchedulerRecordSyncStateItem {
    const ownerUserId = String(row.userId || '').trim();

    return {
      accountId: String(row.accountId || ''),
      userId: ownerUserId,
      ownerUserId,
      brokerKey: String(row.brokerKey || ''),
      ...(row.checkpointAt
        ? {
            checkpointAt:
              this.formatDisplayDate(row.checkpointAt, timeZone) || row.checkpointAt,
          }
        : {}),
      pendingRecords: this.readNumber(row.pendingRecords),
      failedRecords: this.readNumber(row.failedRecords),
      resolvedRecords: this.readNumber(row.resolvedRecords),
      ...(row.nextRetryAt
        ? {
            nextRetryAt:
              this.formatDisplayDate(row.nextRetryAt, timeZone) || row.nextRetryAt,
          }
        : {}),
      ...(row.lastPendingUpdateAt
        ? {
            lastPendingUpdateAt:
              this.formatDisplayDate(row.lastPendingUpdateAt, timeZone) ||
              row.lastPendingUpdateAt,
          }
        : {}),
    };
  }

  private mapSyncStateSummaryRow(
    row: OrdersSchedulerSyncStateSummaryRecord,
    timeZone: string,
    runtimeFoundation?: SchedulerRecordSyncSummaryResponse['runtimeFoundation']
  ): SchedulerRecordSyncSummaryResponse {
    const nowMs = Date.now();
    const oldestCheckpointAtRaw = row.oldestCheckpointAt || undefined;
    const oldestCheckpointAt =
      this.formatDisplayDate(oldestCheckpointAtRaw, timeZone) || oldestCheckpointAtRaw;
    const latestCheckpointAt =
      this.formatDisplayDate(row.latestCheckpointAt || undefined, timeZone) ||
      row.latestCheckpointAt ||
      undefined;
    const latestPendingUpdateAt =
      this.formatDisplayDate(row.latestPendingUpdateAt || undefined, timeZone) ||
      row.latestPendingUpdateAt ||
      undefined;
    const nextRetryAt =
      this.formatDisplayDate(row.nextRetryAt || undefined, timeZone) ||
      row.nextRetryAt ||
      undefined;
    const oldestCheckpointAtDate = oldestCheckpointAtRaw
      ? new Date(oldestCheckpointAtRaw)
      : null;
    const oldestCheckpointAgeHours = oldestCheckpointAtDate && !Number.isNaN(oldestCheckpointAtDate.getTime())
      ? Math.max(0, Math.floor((nowMs - oldestCheckpointAtDate.getTime()) / (60 * 60 * 1000)))
      : undefined;

    return {
      schedulerKey: SCHEDULER_KEY,
      totalAccounts: this.readNumber(row.totalAccounts),
      accountsWithCheckpoint: this.readNumber(row.accountsWithCheckpoint),
      accountsWithoutCheckpoint: this.readNumber(row.accountsWithoutCheckpoint),
      accountsWithPending: this.readNumber(row.accountsWithPending),
      accountsWithFailed: this.readNumber(row.accountsWithFailed),
      accountsWithRetryScheduled: this.readNumber(row.accountsWithRetryScheduled),
      pendingRecords: this.readNumber(row.pendingRecords),
      failedRecords: this.readNumber(row.failedRecords),
      resolvedRecords: this.readNumber(row.resolvedRecords),
      ...(oldestCheckpointAt ? { oldestCheckpointAt } : {}),
      ...(oldestCheckpointAgeHours !== undefined ? { oldestCheckpointAgeHours } : {}),
      ...(latestCheckpointAt ? { latestCheckpointAt } : {}),
      ...(latestPendingUpdateAt ? { latestPendingUpdateAt } : {}),
      ...(nextRetryAt ? { nextRetryAt } : {}),
      ...(runtimeFoundation ? { runtimeFoundation } : {}),
      time: buildSchedulerTimeContract(timeZone),
    };
  }

  private async assertRunBelongsToOrdersScheduler(
    actorUserId: string,
    runId: string
  ): Promise<void> {
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
      throw new NotFoundAppError('Orders scheduler run not found');
    }
  }

  private async resolveScopedOrdersRun(body: OrdersSchedulerRunNowBody): Promise<{
    accountId?: string;
    brokerKey?: string;
    scope?: { accountIds?: string[]; brokerKeys?: string[] };
    scopeLabel: string;
  }> {
    const accountId = String(body.accountId || '').trim();
    const brokerKey = String(body.brokerKey || '').trim().toLowerCase();
    if (!accountId && !brokerKey) {
      return {
        scopeLabel: 'all active broker accounts',
      };
    }

    const activeAccounts = await this.brokerAccountRepository.getAllActiveBrokerAccounts(
      brokerKey || undefined
    );
    const matchedAccounts = activeAccounts.filter((account) => {
      if (!String(account.userId || '').trim()) {
        return false;
      }
      const currentAccountId = String(account.id || '').trim();
      const currentBrokerKey = String(account.brokerKey || '').trim().toLowerCase();
      if (accountId && currentAccountId !== accountId) {
        return false;
      }
      if (brokerKey && currentBrokerKey !== brokerKey) {
        return false;
      }
      return true;
    });

    if (!matchedAccounts.length) {
      throw new NotFoundAppError(
        accountId
          ? 'Orders replay target account not found among active broker accounts'
          : 'No active broker accounts found for the requested broker scope'
      );
    }

    const scopedBrokerKeys = Array.from(
      new Set(
        matchedAccounts
          .map((account) => String(account.brokerKey || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const scopedAccountIds = Array.from(
      new Set(
        matchedAccounts
          .map((account) => String(account.id || '').trim())
          .filter(Boolean)
      )
    );
    const resolvedAccountId =
      accountId || (scopedAccountIds.length === 1 ? scopedAccountIds[0] : undefined);
    const resolvedBrokerKey =
      brokerKey || (scopedBrokerKeys.length === 1 ? scopedBrokerKeys[0] : undefined);

    return {
      ...(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
      ...(resolvedBrokerKey ? { brokerKey: resolvedBrokerKey } : {}),
      scope: {
        ...(scopedAccountIds.length ? { accountIds: scopedAccountIds } : {}),
        ...(scopedBrokerKeys.length ? { brokerKeys: scopedBrokerKeys } : {}),
      },
      scopeLabel: resolvedAccountId
        ? `${resolvedAccountId}${resolvedBrokerKey ? ` (${resolvedBrokerKey})` : ''}`
        : resolvedBrokerKey || `${scopedAccountIds.length} active accounts`,
    };
  }

  private async resetCheckpointForAccount(accountId: string): Promise<void> {
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) {
      throw new BadRequestAppError('accountId is required to reset an orders checkpoint');
    }

    await this.schedulerRuntimeSchemaService.assertOrdersRuntimeSchemaReady();
    await coreDataSource.query(
      `DELETE FROM scheduler_sync_checkpoints
       WHERE scheduler_key = ?
         AND account_id = ?`,
      [SCHEDULER_KEY, normalizedAccountId]
    );
  }

  private resolveSystemExecutionActorUserId(actorUserId: string): string {
    const systemUserId = String(env.scheduler.systemUserId || '').trim();
    return systemUserId || actorUserId;
  }

  private buildManualAudit(actorUserId: string) {
    return buildSystemSchedulerManualAudit(actorUserId);
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private readRetentionDays(config: OrdersSchedulerConfigLike): number {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const retentionDays = Number(configMap.retentionDays);
    if (Number.isInteger(retentionDays) && retentionDays > 0) {
      return retentionDays;
    }
    return 30;
  }

  private readOrdersLookbackDays(configMap: Record<string, unknown>): number {
    const lookbackDays = Number(configMap.lookbackDays);
    return this.normalizeLookbackDays(lookbackDays);
  }

  private normalizeLookbackDays(lookbackDays: number): number {
    if (
      Number.isInteger(lookbackDays) &&
      lookbackDays >= 1 &&
      lookbackDays <= ORDERS_MAX_LOOKBACK_DAYS
    ) {
      return lookbackDays;
    }
    return ORDERS_MAX_LOOKBACK_DAYS;
  }

  private buildOrdersPolicy(lookbackDays: number): OrdersSchedulerPolicy {
    return {
      lookbackDays,
      maxLookbackDays: ORDERS_MAX_LOOKBACK_DAYS,
      historyWindowDays: ORDERS_HISTORY_WINDOW_DAYS,
      incrementalCheckpointOverlapDays: ORDERS_INCREMENTAL_OVERLAP_DAYS,
      openOrdersSweepEnabled: true,
      staleMissingOpenOrdersCloseEnabled: true,
      replayMode: 'checkpoint_reset_then_scoped_run',
    };
  }

  private assertResolvedScheduleConfig(candidate: {
    runAt?: unknown;
    intervalDays?: unknown;
    scheduleMode?: unknown;
    intervalMinutes?: unknown;
    intervalSeconds?: unknown;
    hourlyMinute?: unknown;
  }): void {
    const scheduleMode = String(candidate.scheduleMode || 'daily').trim().toLowerCase();

    if (scheduleMode === 'daily') {
      const runAt = String(candidate.runAt || '').trim();
      const intervalDays = Number(candidate.intervalDays);
      if (!/^\d{2}:\d{2}$/.test(runAt)) {
        throw new BadRequestAppError(
          'Orders scheduler daily mode requires a valid runAt value in HH:mm format'
        );
      }
      if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 30) {
        throw new BadRequestAppError(
          'Orders scheduler daily mode requires intervalDays between 1 and 30'
        );
      }
      return;
    }

    if (scheduleMode === 'every_n_minutes') {
      const intervalMinutes = Number(candidate.intervalMinutes);
      if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 60) {
        throw new BadRequestAppError(
          'Orders scheduler every_n_minutes mode requires intervalMinutes between 1 and 60'
        );
      }
      return;
    }

    if (scheduleMode === 'every_n_seconds') {
      const intervalSeconds = Number(candidate.intervalSeconds);
      if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 60) {
        throw new BadRequestAppError(
          'Orders scheduler every_n_seconds mode requires intervalSeconds between 1 and 60'
        );
      }
      return;
    }

    if (scheduleMode === 'hourly_at_minute') {
      const hourlyMinute = Number(candidate.hourlyMinute);
      if (!Number.isInteger(hourlyMinute) || hourlyMinute < 0 || hourlyMinute > 59) {
        throw new BadRequestAppError(
          'Orders scheduler hourly_at_minute mode requires hourlyMinute between 0 and 59'
        );
      }
      return;
    }

    throw new BadRequestAppError(
      'Orders scheduler scheduleMode must be daily, every_n_minutes, every_n_seconds, or hourly_at_minute'
    );
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
      symbol: 'RISK',
      message: mergedMessage,
      route: 'Schedulers',
      status: 'Open',
      source: SCHEDULER_KEY,
    });
  }
}
