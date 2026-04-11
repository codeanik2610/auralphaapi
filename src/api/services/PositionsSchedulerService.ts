import { randomUUID } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  PositionsSchedulerReadModelRecoveryHistoryItem,
  PositionsSchedulerReadModelRecoveryHistoryResponse,
  PositionsSchedulerReadModelCoverageSnapshot,
  PositionsSchedulerReadModelRebuildBody,
  PositionsSchedulerReadModelRebuildResponse,
  SchedulerAssetUpdateLogItem,
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerRecordSyncSummaryResponse,
  SchedulerRecordSyncStateItem,
  SchedulerRecordSyncStateListResponse,
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
  validatePositionsSchedulerReadModelRebuildBody,
  validateSchedulerConfigBody,
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
  ExchangeAssetUpdateLogRepository,
  PositionReadModelCoverageRow,
  PositionReadModelRepository,
  SchedulerCommandRepository,
  SchedulerConfig,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  SchedulerUserConfig,
  SchedulerUserConfigRepository,
  ActivityRepository,
  ActivityLog,
  AlertRepository,
} from '../../database';
import { coreDataSource } from '../../database/data-source';
import { env } from '../../env';
import { UserTimeZoneService } from './UserTimeZoneService';
import {
  POSITIONS_SYNC_SCHEDULER_KEY,
  POSITIONS_SYNC_SCHEDULER_NAME,
  POSITIONS_SYNC_SCHEDULER_OWNERSHIP,
} from '../utils/positionsOrdersSyncScopeContract';

const SCHEDULER_KEY = POSITIONS_SYNC_SCHEDULER_KEY;
const POSITIONS_SCHEDULER_OWNERSHIP = POSITIONS_SYNC_SCHEDULER_OWNERSHIP;
const POSITIONS_SCHEDULER_NAME = POSITIONS_SYNC_SCHEDULER_NAME;
const POSITIONS_SCHEDULER_DESCRIPTION =
  'System reconciliation scheduler for broker position snapshots, checkpoints, and read-model hydration.';
const POSITIONS_REBUILD_RUNBOOK_PATH =
  '/Users/apple/Documents/Project/Backend/aurAlpha/POSITIONS_SCHEDULER_PRODUCT_SPLIT_PHASE6.md';
const POSITIONS_REBUILD_CLI_COMMAND = 'npm run rebuild:positions-read-model';
const POSITIONS_REBUILD_DEFAULT_ONLY_DRIFTED = true;
const POSITIONS_REBUILD_MAX_SCOPED_ACCOUNTS = 200;
const POSITIONS_REBUILD_CONFIRMATION_THRESHOLD = 2;
const POSITIONS_REBUILD_SUPPORTED_SCOPES = ['account', 'owner', 'broker', 'all'] as const;
const POSITIONS_REBUILD_CONFIRMATION_SCOPES = ['owner', 'broker', 'all'] as const;
const POSITIONS_RECOVERY_ACTIVITY_REFERENCE_ID = 'positions-read-model-recovery';

type PositionsConnectedAccountScope = {
  accountId: string;
  ownerUserId: string;
  brokerKey: string;
};

type PositionsSchedulerUserConfigRecord = SchedulerUserConfig;
type PositionsSchedulerConfigLike = {
  batchSize?: number | null;
  config?: Record<string, unknown> | null;
};

@Service()
export class PositionsSchedulerService {
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

  @Inject(() => PositionReadModelRepository)
  private positionReadModelRepository!: PositionReadModelRepository;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

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
      const payload = validateSchedulerConfigBody(body);
      const current = await this.ensureSchedulerConfig(actorUserId, timeZone);
      const currentConfig = this.normalizePersistedConfigMap(current.config);
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
      if (
        payload.schedulerType !== undefined &&
        String(payload.schedulerType || '').trim().toLowerCase() !== POSITIONS_SCHEDULER_OWNERSHIP
      ) {
        throw new BadRequestAppError(
          `${POSITIONS_SCHEDULER_NAME} is a user scheduler and cannot be switched to global scope.`
        );
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
          schedulerType: POSITIONS_SCHEDULER_OWNERSHIP,
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
        'Positions scheduler config updated',
        'Success',
        `Updated scheduler config for ${SCHEDULER_KEY}`
      );
      return successResponse(this.mapConfig(config, timeZone));
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Positions scheduler config update failed',
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
      const requestedAt = this.formatDate(new Date());
      const timeZone = await this.resolveUserTimeZone(actorUserId);
      const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
      if (!config.enabled) {
        throw new BadRequestAppError('Positions scheduler is paused. Resume it before running now.');
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
          message: 'Positions scheduler run already queued',
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
          message: 'Positions scheduler run already in progress',
        });
      }
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
          trigger: 'manual',
          actorUserId,
          requestedAt,
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
        actorUserId,
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
        payload: {
          runId,
          trigger: 'manual',
          actorUserId,
          requestedAt,
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
        'Positions scheduler run queued',
        'Success',
        `Queued run_now for ${SCHEDULER_KEY} as command ${command.id}`
      );

      return successResponse({
        queued: true,
        executionMode: 'queue',
        started: false,
        runId,
        jobId: command.id,
        message: 'Positions scheduler command queued',
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Positions scheduler run queue failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitSchedulerFailureAlert(
        actorUserId,
        'Positions scheduler run queue failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async rebuildReadModel(
    actorUserId: string,
    body: PositionsSchedulerReadModelRebuildBody
  ): Promise<ApiSuccessResponse<PositionsSchedulerReadModelRebuildResponse>> {
    const recoveryId = randomUUID();
    const performedAt = this.formatDate(new Date()) as string;
    const inferredScope = this.inferReadModelRebuildScopeFromBody(body);
    try {
      if (!actorUserId) {
        throw new BadRequestAppError('actorUserId is required');
      }

      const payload = validatePositionsSchedulerReadModelRebuildBody(body);
      const scope = this.resolveReadModelRebuildScope(payload);
      const requestedScopes = await this.listConnectedAccountScopes(payload);
      const requestedAccountIds = requestedScopes.map((item) => item.accountId);
      const beforeCoverage = await this.summarizeReadModelCoverageByAccountIds(requestedAccountIds);

      if (!requestedScopes.length) {
        const message = this.buildReadModelRebuildNoopMessage(scope, payload, 'no_scope_match');
        const recommendedNextStep = this.buildReadModelRebuildRecommendedNextStep('noop', beforeCoverage, beforeCoverage);
        const historyEntry = await this.logReadModelRecoveryActivity(
          actorUserId,
          {
            recoveryId,
            title: 'Positions read-model rebuild not required',
            status: 'Warning',
            state: 'noop',
            scope,
            performedAt,
            message,
            requestedAccounts: 0,
            targetedAccounts: 0,
            processedAccounts: 0,
            skippedAccounts: 0,
            deletedReadModelRows: 0,
            insertedReadModelRows: 0,
            snapshotRowsProcessed: 0,
            filters: this.mapReadModelRebuildFilters(payload),
            beforeCoverage,
            afterCoverage: beforeCoverage,
            warnings: [],
            recommendedNextStep,
          }
        );
        return successResponse({
          queued: false,
          action: 'rebuild_read_model',
          state: 'noop',
          recoveryId,
          scope,
          onlyDrifted: payload.onlyDrifted !== false,
          requestedAccounts: 0,
          targetedAccounts: 0,
          performedAt,
          message,
          warnings: [],
          recommendedNextStep,
          filters: this.mapReadModelRebuildFilters(payload),
          beforeCoverage,
          afterCoverage: beforeCoverage,
          historyEntry,
          rebuildResult: this.createEmptyReadModelRebuildResult(),
        });
      }

      const targetedScopes =
        payload.onlyDrifted === false
          ? requestedScopes
          : await this.filterScopesNeedingReadModelRebuild(requestedScopes);
      const targetedAccountIds = targetedScopes.map((item) => item.accountId);
      const targetedBeforeCoverage =
        targetedAccountIds.length > 0
          ? await this.summarizeReadModelCoverageByAccountIds(targetedAccountIds)
          : beforeCoverage;

      if (!targetedScopes.length) {
        const message = this.buildReadModelRebuildNoopMessage(scope, payload, 'no_drift_match');
        const recommendedNextStep = this.buildReadModelRebuildRecommendedNextStep(
          'noop',
          targetedBeforeCoverage,
          targetedBeforeCoverage
        );
        const historyEntry = await this.logReadModelRecoveryActivity(
          actorUserId,
          {
            recoveryId,
            title: 'Positions read-model rebuild not required',
            status: 'Warning',
            state: 'noop',
            scope,
            performedAt,
            message,
            requestedAccounts: requestedScopes.length,
            targetedAccounts: 0,
            processedAccounts: 0,
            skippedAccounts: 0,
            deletedReadModelRows: 0,
            insertedReadModelRows: 0,
            snapshotRowsProcessed: 0,
            filters: this.mapReadModelRebuildFilters(payload),
            beforeCoverage: targetedBeforeCoverage,
            afterCoverage: targetedBeforeCoverage,
            warnings: [],
            recommendedNextStep,
          }
        );
        return successResponse({
          queued: false,
          action: 'rebuild_read_model',
          state: 'noop',
          recoveryId,
          scope,
          onlyDrifted: payload.onlyDrifted !== false,
          requestedAccounts: requestedScopes.length,
          targetedAccounts: 0,
          performedAt,
          message,
          warnings: [],
          recommendedNextStep,
          filters: this.mapReadModelRebuildFilters(payload),
          beforeCoverage: targetedBeforeCoverage,
          afterCoverage: targetedBeforeCoverage,
          historyEntry,
          rebuildResult: this.createEmptyReadModelRebuildResult(),
        });
      }

      const rebuildResult = await this.positionReadModelRepository.rebuildReadModelsFromSnapshots(
        targetedAccountIds
      );
      const afterCoverage = await this.summarizeReadModelCoverageByAccountIds(targetedAccountIds);
      const warnings = this.buildReadModelRebuildWarnings(rebuildResult, afterCoverage);
      const recommendedNextStep = this.buildReadModelRebuildRecommendedNextStep(
        'applied',
        targetedBeforeCoverage,
        afterCoverage
      );
      const message = this.buildReadModelRebuildSuccessMessage(
        scope,
        payload,
        requestedScopes.length,
        targetedScopes.length,
        rebuildResult
      );

      const historyEntry = await this.logReadModelRecoveryActivity(
        actorUserId,
        {
          recoveryId,
          title: 'Positions read-model rebuild completed',
          status: 'Success',
          state: 'applied',
          scope,
          performedAt,
          message,
          requestedAccounts: requestedScopes.length,
          targetedAccounts: targetedScopes.length,
          processedAccounts: rebuildResult.processedAccounts,
          skippedAccounts: rebuildResult.skippedAccounts,
          deletedReadModelRows: rebuildResult.deletedReadModelRows,
          insertedReadModelRows: rebuildResult.insertedReadModelRows,
          snapshotRowsProcessed: rebuildResult.snapshotRowsProcessed,
          filters: this.mapReadModelRebuildFilters(payload),
          beforeCoverage: targetedBeforeCoverage,
          afterCoverage,
          warnings,
          recommendedNextStep,
        }
      );

      return successResponse({
        queued: false,
        action: 'rebuild_read_model',
        state: 'applied',
        recoveryId,
        scope,
        onlyDrifted: payload.onlyDrifted !== false,
        requestedAccounts: requestedScopes.length,
        targetedAccounts: targetedScopes.length,
        performedAt,
        message,
        warnings,
        recommendedNextStep,
        filters: this.mapReadModelRebuildFilters(payload),
        beforeCoverage: targetedBeforeCoverage,
        afterCoverage,
        historyEntry,
        rebuildResult: {
          requestedAccounts: rebuildResult.requestedAccounts,
          processedAccounts: rebuildResult.processedAccounts,
          skippedAccounts: rebuildResult.skippedAccounts,
          deletedReadModelRows: rebuildResult.deletedReadModelRows,
          insertedReadModelRows: rebuildResult.insertedReadModelRows,
          snapshotRowsProcessed: rebuildResult.snapshotRowsProcessed,
          skippedAccountIds: rebuildResult.skippedAccountIds,
          scopes: rebuildResult.scopes.map((item) => ({
            userId: item.userId,
            accountId: item.accountId,
            brokerKey: item.brokerKey,
            snapshotRows: item.snapshotRows,
            deletedReadModelRows: item.deletedReadModelRows,
            insertedReadModelRows: item.insertedReadModelRows,
          })),
        },
      });
    } catch (error) {
      if (actorUserId) {
        await this.logReadModelRecoveryActivity(
          actorUserId,
          {
            recoveryId,
            title: 'Positions read-model rebuild failed',
            status: 'Failed',
            state: 'failed',
            scope: inferredScope,
            performedAt,
            message: error instanceof Error ? error.message : String(error),
            requestedAccounts: 0,
            targetedAccounts: 0,
            processedAccounts: 0,
            skippedAccounts: 0,
            deletedReadModelRows: 0,
            insertedReadModelRows: 0,
            snapshotRowsProcessed: 0,
            filters: this.mapReadModelRebuildFiltersFromUnknown(body),
            warnings: [error instanceof Error ? error.message : String(error)],
          }
        );
        await this.emitSchedulerFailureAlert(
          actorUserId,
          'Positions read-model rebuild failed',
          error instanceof Error ? error.message : String(error)
        );
      }
      throw error;
    }
  }

  async listReadModelRecoveryHistory(
    actorUserId: string,
    query: {
      limit?: string;
      offset?: string;
      status?: string;
    }
  ): Promise<ApiSuccessResponse<PositionsSchedulerReadModelRecoveryHistoryResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }

    const { limit, offset } = validateListQuery(query);
    const status = this.normalizeRecoveryHistoryStatusFilter(query.status);
    const { items, total } = await this.activityRepository.listActivity(actorUserId, {
      limit,
      offset,
      readState: 'all',
      sortBy: 'time',
      sortOrder: 'desc',
      route: 'Schedulers',
      related: SCHEDULER_KEY,
      referenceId: POSITIONS_RECOVERY_ACTIVITY_REFERENCE_ID,
      ...(status ? { status } : {}),
    });

    return successResponse({
      items: items.map((item) => this.mapReadModelRecoveryHistoryItem(item)),
      total,
      limit,
      offset,
    });
  }

  async pauseScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(actorUserId, timeZone);
    await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(SCHEDULER_KEY, actorUserId, {
      enabled: false,
      schedulerType: POSITIONS_SCHEDULER_OWNERSHIP,
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
    await this.logSchedulerActivity(actorUserId, 'Positions scheduler paused', 'Success', `Paused ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'pause',
      message: 'Positions scheduler paused',
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
      schedulerType: POSITIONS_SCHEDULER_OWNERSHIP,
    });
    await this.logSchedulerActivity(actorUserId, 'Positions scheduler resumed', 'Success', `Resumed ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'resume',
      message: 'Positions scheduler resumed',
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
      'Positions scheduler stop requested',
      'Success',
      `Stop request handled for ${SCHEDULER_KEY}. activeStop=${running ? 'queued' : 'not-required'}, pendingRunsCancelled=${cancelledPendingRuns}`
    );
    return successResponse({
      queued: Boolean(stopCommandId),
      action: 'stop',
      state: stopCommandId ? 'queued' : cancelledPendingRuns > 0 ? 'applied' : 'noop',
      message:
        running || cancelledPendingRuns > 0
          ? 'Positions scheduler stop requested'
          : 'No active or queued positions scheduler run to stop',
      commandIds: stopCommandId ? [stopCommandId] : [],
    });
  }

  async restartScheduler(actorUserId: string): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
    if (!config.enabled) {
      throw new BadRequestAppError('Positions scheduler is paused. Resume it before restarting.');
    }
    if (env.scheduler.executionMode !== 'queue') {
      throw new ServiceUnavailableAppError('Restart is supported only in queue mode');
    }
    const manualAudit = this.buildManualAudit(actorUserId);
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
    await this.logSchedulerActivity(
      actorUserId,
      'Positions scheduler restart queued',
      'Success',
      running
        ? `Queued stop ${stopCommandId} and run ${runCommand.id} for ${SCHEDULER_KEY}`
        : `Queued run ${runCommand.id} for ${SCHEDULER_KEY}`
    );
    return successResponse({
      queued: true,
      action: 'restart',
      state: 'queued',
      message: 'Positions scheduler restart queued',
      commandIds: stopCommandId ? [stopCommandId, runCommand.id] : [runCommand.id],
    });
  }

  async purgeSchedulerLogs(actorUserId: string): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
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
      'Positions scheduler logs purged',
      'Success',
      `Purged ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs for ${SCHEDULER_KEY}`
    );
    return successResponse({
      message: `Positions scheduler logs purged. Deleted ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs.`,
      retentionDays,
      runLogsDeleted,
      updateLogsDeleted,
    });
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
      brokerKey?: string;
    }
  ): Promise<ApiSuccessResponse<SchedulerRecordSyncStateListResponse>> {
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    const { limit, offset } = validateListQuery(query);
    const accountId = String(query.accountId || '').trim();
    const ownerUserId = String(query.ownerUserId || '').trim();
    const brokerKey = String(query.brokerKey || '').trim().toLowerCase();
    const filters: string[] = [
      "LOWER(ba.status) IN ('connected', 'idle')",
      'ba.user_id IS NOT NULL',
    ];
    const params: Array<string | number> = [SCHEDULER_KEY, SCHEDULER_KEY];

    if (accountId) {
      filters.push('ba.id = ?');
      params.push(accountId);
    }
    if (ownerUserId) {
      filters.push('ba.user_id = ?');
      params.push(ownerUserId);
    }
    if (brokerKey) {
      filters.push('LOWER(ba.brokerKey) = ?');
      params.push(brokerKey);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    try {
      const rows = await coreDataSource.query(
        `SELECT
           ba.id AS accountId,
           ba.user_id AS userId,
           ba.brokerKey AS brokerKey,
           scp.checkpoint_at AS checkpointAt,
           COALESCE(SUM(CASE WHEN LOWER(spr.status) IN ('pending', 'failed') THEN 1 ELSE 0 END), 0) AS pendingRecords,
           COALESCE(SUM(CASE WHEN LOWER(spr.status) = 'failed' THEN 1 ELSE 0 END), 0) AS failedRecords,
           COALESCE(SUM(CASE WHEN LOWER(spr.status) = 'resolved' THEN 1 ELSE 0 END), 0) AS resolvedRecords,
           MAX(spr.next_retry_at) AS nextRetryAt,
           MAX(spr.updated_at) AS lastPendingUpdateAt
         FROM broker_accounts ba
         LEFT JOIN scheduler_sync_checkpoints scp
           ON scp.scheduler_key = ?
          AND scp.account_id = ba.id
         LEFT JOIN scheduler_sync_pending_records spr
           ON spr.scheduler_key = ?
          AND spr.account_id = ba.id
         ${whereClause}
         GROUP BY ba.id, ba.user_id, ba.brokerKey, scp.checkpoint_at
         ORDER BY ba.updatedAt DESC, ba.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const countRows = await coreDataSource.query(
        `SELECT COUNT(*) AS total
         FROM broker_accounts ba
         ${whereClause}`,
        params.slice(2)
      );
      const total = this.readNumber((countRows as Array<{ total?: number }>)[0]?.total);
      const typedRows = rows as Array<Record<string, unknown>>;
      const coverageByAccountId = await this.loadReadModelCoverageByAccountIds(typedRows);
      const items = typedRows.map((row) =>
        this.mapSyncStateRow(
          row,
          timeZone,
          coverageByAccountId.get(String(row.accountId || '').trim()) || null
        )
      );
      return successResponse({
        items,
        total,
        limit,
        offset,
        time: buildSchedulerTimeContract(timeZone),
      });
    } catch (error) {
      if (!this.isMissingTableError(error)) {
        throw error;
      }
      const fallbackRows = await coreDataSource.query(
        `SELECT
           ba.id AS accountId,
           ba.user_id AS userId,
           ba.brokerKey AS brokerKey
         FROM broker_accounts ba
         ${whereClause}
         ORDER BY ba.updatedAt DESC, ba.id DESC
         LIMIT ? OFFSET ?`,
        [...params.slice(2), limit, offset]
      );
      const countRows = await coreDataSource.query(
        `SELECT COUNT(*) AS total
         FROM broker_accounts ba
         ${whereClause}`,
        params.slice(2)
      );
      const total = this.readNumber((countRows as Array<{ total?: number }>)[0]?.total);
      const typedRows = fallbackRows as Array<Record<string, unknown>>;
      const coverageByAccountId = await this.loadReadModelCoverageByAccountIds(typedRows);
      const items = typedRows.map((row) =>
        this.mapSyncStateRow(
          row,
          timeZone,
          coverageByAccountId.get(String(row.accountId || '').trim()) || null
        )
      );
      return successResponse({
        items,
        total,
        limit,
        offset,
        time: buildSchedulerTimeContract(timeZone),
      });
    }
  }

  async getSchedulerSyncStateSummary(
    actorUserId: string
  ): Promise<ApiSuccessResponse<SchedulerRecordSyncSummaryResponse>> {
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    try {
      const rows = await coreDataSource.query(
        `SELECT
           COUNT(*) AS totalAccounts,
           COALESCE(SUM(CASE WHEN scp.checkpoint_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS accountsWithCheckpoint,
           COALESCE(SUM(CASE WHEN scp.checkpoint_at IS NULL THEN 1 ELSE 0 END), 0) AS accountsWithoutCheckpoint,
           COALESCE(SUM(CASE WHEN pendingAgg.pendingRecords > 0 THEN 1 ELSE 0 END), 0) AS accountsWithPending,
           COALESCE(SUM(CASE WHEN pendingAgg.failedRecords > 0 THEN 1 ELSE 0 END), 0) AS accountsWithFailed,
           COALESCE(SUM(CASE WHEN pendingAgg.nextRetryAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS accountsWithRetryScheduled,
           COALESCE(SUM(pendingAgg.pendingRecords), 0) AS pendingRecords,
           COALESCE(SUM(pendingAgg.failedRecords), 0) AS failedRecords,
           COALESCE(SUM(pendingAgg.resolvedRecords), 0) AS resolvedRecords,
           MIN(scp.checkpoint_at) AS oldestCheckpointAt,
           MAX(scp.checkpoint_at) AS latestCheckpointAt,
           MAX(pendingAgg.lastPendingUpdateAt) AS latestPendingUpdateAt,
           MIN(pendingAgg.nextRetryAt) AS nextRetryAt
         FROM broker_accounts ba
         LEFT JOIN scheduler_sync_checkpoints scp
           ON scp.scheduler_key = ?
          AND scp.account_id = ba.id
         LEFT JOIN (
           SELECT
             account_id AS accountId,
             COALESCE(SUM(CASE WHEN LOWER(status) IN ('pending', 'failed') THEN 1 ELSE 0 END), 0) AS pendingRecords,
             COALESCE(SUM(CASE WHEN LOWER(status) = 'failed' THEN 1 ELSE 0 END), 0) AS failedRecords,
             COALESCE(SUM(CASE WHEN LOWER(status) = 'resolved' THEN 1 ELSE 0 END), 0) AS resolvedRecords,
             MAX(updated_at) AS lastPendingUpdateAt,
             MIN(CASE WHEN LOWER(status) IN ('pending', 'failed') THEN next_retry_at ELSE NULL END) AS nextRetryAt
           FROM scheduler_sync_pending_records
           WHERE scheduler_key = ?
           GROUP BY account_id
         ) pendingAgg
           ON pendingAgg.accountId = ba.id
         WHERE LOWER(ba.status) IN ('connected', 'idle')
           AND ba.user_id IS NOT NULL`,
        [SCHEDULER_KEY, SCHEDULER_KEY]
      );
      const coverageSummary = await this.loadReadModelCoverageSummaryForConnectedAccounts();
      return successResponse(
        this.mapSyncStateSummaryRow(
          (rows as Array<Record<string, unknown>>)[0] || {},
          timeZone,
          coverageSummary
        )
      );
    } catch (error) {
      if (!this.isMissingTableError(error)) {
        throw error;
      }
      const fallbackRows = await coreDataSource.query(
        `SELECT COUNT(*) AS totalAccounts
         FROM broker_accounts ba
         WHERE LOWER(ba.status) IN ('connected', 'idle')
           AND ba.user_id IS NOT NULL`
      );
      const coverageSummary = await this.loadReadModelCoverageSummaryForConnectedAccounts();
      return successResponse(
        this.mapSyncStateSummaryRow(
          (fallbackRows as Array<Record<string, unknown>>)[0] || {},
          timeZone,
          coverageSummary
        )
      );
    }
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
    const timeZone = await this.resolveUserTimeZone(actorUserId);
    await this.assertRunBelongsToPositionsScheduler(actorUserId, runId);
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
    await this.assertRunBelongsToPositionsScheduler(actorUserId, runId);
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

  private resolveReadModelRebuildScope(
    payload: PositionsSchedulerReadModelRebuildBody
  ): 'account' | 'owner' | 'broker' | 'all' {
    if (String(payload.accountId || '').trim()) {
      return 'account';
    }
    if (String(payload.ownerUserId || '').trim()) {
      return 'owner';
    }
    if (String(payload.brokerKey || '').trim()) {
      return 'broker';
    }
    return 'all';
  }

  private async listConnectedAccountScopes(
    payload: PositionsSchedulerReadModelRebuildBody
  ): Promise<PositionsConnectedAccountScope[]> {
    const accountId = String(payload.accountId || '').trim();
    const ownerUserId = String(payload.ownerUserId || '').trim();
    const brokerKey = String(payload.brokerKey || '').trim().toLowerCase();
    const limit = Number(payload.limit);
    const filters: string[] = ["LOWER(ba.status) IN ('connected', 'idle')"];
    const params: Array<string | number> = [];

    if (accountId) {
      filters.push('ba.id = ?');
      params.push(accountId);
    }
    if (ownerUserId) {
      filters.push('ba.user_id = ?');
      params.push(ownerUserId);
    }
    if (brokerKey) {
      filters.push('LOWER(ba.brokerKey) = ?');
      params.push(brokerKey);
    }

    const hasLimit = Number.isInteger(limit) && limit > 0;
    const rows = (await coreDataSource.query(
      `SELECT
         ba.id AS accountId,
         ba.user_id AS ownerUserId,
         ba.brokerKey AS brokerKey
       FROM broker_accounts ba
       WHERE ${filters.join(' AND ')}
       ORDER BY ba.updatedAt DESC, ba.id DESC${hasLimit ? ' LIMIT ?' : ''}`,
      hasLimit ? [...params, limit] : params
    )) as Array<{
      accountId?: string;
      ownerUserId?: string;
      brokerKey?: string;
    }>;

    return rows
      .map((row) => ({
        accountId: String(row.accountId || '').trim(),
        ownerUserId: String(row.ownerUserId || '').trim(),
        brokerKey: String(row.brokerKey || '').trim().toLowerCase(),
      }))
      .filter((row) => row.accountId && row.ownerUserId && row.brokerKey);
  }

  private async filterScopesNeedingReadModelRebuild(
    scopes: PositionsConnectedAccountScope[]
  ): Promise<PositionsConnectedAccountScope[]> {
    if (!scopes.length) {
      return [];
    }
    const coverageByAccountId =
      await this.positionReadModelRepository.getReadModelCoverageByAccountIds(
        scopes.map((item) => item.accountId)
      );
    return scopes.filter((scope) =>
      this.readModelNeedsRebuild(coverageByAccountId.get(scope.accountId) || null)
    );
  }

  private async summarizeReadModelCoverageByAccountIds(
    accountIds: string[]
  ): Promise<PositionsSchedulerReadModelCoverageSnapshot> {
    const normalizedAccountIds = Array.from(
      new Set(accountIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (!normalizedAccountIds.length) {
      return this.createEmptyReadModelCoverageSnapshot();
    }
    const summary =
      await this.positionReadModelRepository.summarizeReadModelCoverageByAccountIds(
        normalizedAccountIds
      );
    return this.mapReadModelCoverageSnapshot(summary);
  }

  private createEmptyReadModelCoverageSnapshot(): PositionsSchedulerReadModelCoverageSnapshot {
    return {
      totalAccounts: 0,
      accountsWithSnapshotData: 0,
      accountsWithoutSnapshotData: 0,
      accountsWithReadModel: 0,
      accountsWithoutReadModel: 0,
      accountsWithReadModelDrift: 0,
      snapshotRows: 0,
      readModelRows: 0,
      rowsMissingFromReadModel: 0,
      rowsBehindSnapshot: 0,
      orphanReadModelRows: 0,
    };
  }

  private createEmptyReadModelRebuildResult(): PositionsSchedulerReadModelRebuildResponse['rebuildResult'] {
    return {
      requestedAccounts: 0,
      processedAccounts: 0,
      skippedAccounts: 0,
      deletedReadModelRows: 0,
      insertedReadModelRows: 0,
      snapshotRowsProcessed: 0,
      skippedAccountIds: [],
      scopes: [],
    };
  }

  private mapReadModelCoverageSnapshot(summary: {
    totalAccounts: number;
    accountsWithSnapshotData: number;
    accountsWithoutSnapshotData: number;
    accountsWithReadModel: number;
    accountsWithoutReadModel: number;
    accountsWithReadModelDrift: number;
    snapshotRows: number;
    readModelRows: number;
    rowsMissingFromReadModel: number;
    rowsBehindSnapshot: number;
    orphanReadModelRows: number;
    latestSnapshotSeenAt: Date | null;
    latestReadModelSeenAt: Date | null;
  }): PositionsSchedulerReadModelCoverageSnapshot {
    const latestSnapshotSeenAt = this.formatDate(summary.latestSnapshotSeenAt);
    const latestReadModelSeenAt = this.formatDate(summary.latestReadModelSeenAt);

    return {
      totalAccounts: summary.totalAccounts,
      accountsWithSnapshotData: summary.accountsWithSnapshotData,
      accountsWithoutSnapshotData: summary.accountsWithoutSnapshotData,
      accountsWithReadModel: summary.accountsWithReadModel,
      accountsWithoutReadModel: summary.accountsWithoutReadModel,
      accountsWithReadModelDrift: summary.accountsWithReadModelDrift,
      snapshotRows: summary.snapshotRows,
      readModelRows: summary.readModelRows,
      rowsMissingFromReadModel: summary.rowsMissingFromReadModel,
      rowsBehindSnapshot: summary.rowsBehindSnapshot,
      orphanReadModelRows: summary.orphanReadModelRows,
      ...(latestSnapshotSeenAt ? { latestSnapshotSeenAt } : {}),
      ...(latestReadModelSeenAt ? { latestReadModelSeenAt } : {}),
    };
  }

  private mapReadModelRebuildFilters(
    payload: PositionsSchedulerReadModelRebuildBody
  ): PositionsSchedulerReadModelRebuildResponse['filters'] {
    const limit = Number(payload.limit);
    return {
      ...(payload.accountId ? { accountId: String(payload.accountId).trim() } : {}),
      ...(payload.ownerUserId ? { ownerUserId: String(payload.ownerUserId).trim() } : {}),
      ...(payload.brokerKey ? { brokerKey: String(payload.brokerKey).trim().toLowerCase() } : {}),
      ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
    };
  }

  private mapReadModelRebuildFiltersFromUnknown(
    value: unknown
  ): PositionsSchedulerReadModelRebuildResponse['filters'] {
    const payload =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const limit = Number(payload.limit);
    const accountId = String(payload.accountId || '').trim();
    const ownerUserId = String(payload.ownerUserId || '').trim();
    const brokerKey = String(payload.brokerKey || '').trim().toLowerCase();

    return {
      ...(accountId ? { accountId } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(brokerKey ? { brokerKey } : {}),
      ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
    };
  }

  private inferReadModelRebuildScopeFromBody(
    value: unknown
  ): 'account' | 'owner' | 'broker' | 'all' {
    const payload =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    if (payload.rebuildAll === true) {
      return 'all';
    }
    if (String(payload.accountId || '').trim()) {
      return 'account';
    }
    if (String(payload.ownerUserId || '').trim()) {
      return 'owner';
    }
    if (String(payload.brokerKey || '').trim()) {
      return 'broker';
    }
    return 'account';
  }

  private normalizeRecoveryHistoryStatusFilter(value: unknown): 'Success' | 'Warning' | 'Failed' | '' {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return '';
    }
    if (['success', 'succeeded', 'completed'].includes(normalized)) {
      return 'Success';
    }
    if (['warning', 'warn', 'noop'].includes(normalized)) {
      return 'Warning';
    }
    if (['failed', 'error'].includes(normalized)) {
      return 'Failed';
    }
    throw new BadRequestAppError('status must be one of success, warning, or failed when provided');
  }

  private buildReadModelRecoveryActivityFlags(params: {
    recoveryId: string;
    performedAt: string;
    status: 'Success' | 'Warning' | 'Failed';
    state: 'applied' | 'noop' | 'failed';
    scope: 'account' | 'owner' | 'broker' | 'all';
    requestedAccounts: number;
    targetedAccounts: number;
    processedAccounts: number;
    skippedAccounts: number;
    deletedReadModelRows: number;
    insertedReadModelRows: number;
    snapshotRowsProcessed: number;
    filters: PositionsSchedulerReadModelRebuildResponse['filters'];
    beforeCoverage?: PositionsSchedulerReadModelCoverageSnapshot;
    afterCoverage?: PositionsSchedulerReadModelCoverageSnapshot;
    warnings: string[];
    recommendedNextStep?: string;
  }): NonNullable<ActivityLog['flags']> {
    const baseStatus = params.status;
    const baseChannel = 'Recovery';
    const flags: NonNullable<ActivityLog['flags']> = [
      {
        id: 'recovery-id',
        message: params.recoveryId,
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'scope',
        message: params.scope,
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'state',
        message: params.state,
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'requested-accounts',
        message: String(params.requestedAccounts),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'targeted-accounts',
        message: String(params.targetedAccounts),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'processed-accounts',
        message: String(params.processedAccounts),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'skipped-accounts',
        message: String(params.skippedAccounts),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'deleted-rows',
        message: String(params.deletedReadModelRows),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'inserted-rows',
        message: String(params.insertedReadModelRows),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
      {
        id: 'snapshot-rows-processed',
        message: String(params.snapshotRowsProcessed),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      },
    ];

    if (params.beforeCoverage) {
      flags.push({
        id: 'before-drift-accounts',
        message: String(params.beforeCoverage.accountsWithReadModelDrift),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      });
    }

    if (params.afterCoverage) {
      flags.push({
        id: 'after-drift-accounts',
        message: String(params.afterCoverage.accountsWithReadModelDrift),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      });
    }

    if (params.filters.accountId) {
      flags.push({
        id: 'filter-account-id',
        message: params.filters.accountId,
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      });
    }
    if (params.filters.ownerUserId) {
      flags.push({
        id: 'filter-owner-user-id',
        message: params.filters.ownerUserId,
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      });
    }
    if (params.filters.brokerKey) {
      flags.push({
        id: 'filter-broker-key',
        message: params.filters.brokerKey,
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      });
    }
    if (params.filters.limit !== undefined) {
      flags.push({
        id: 'filter-limit',
        message: String(params.filters.limit),
        channel: baseChannel,
        time: params.performedAt,
        status: baseStatus,
      });
    }
    if (params.recommendedNextStep) {
      flags.push({
        id: 'next-step',
        message: params.recommendedNextStep,
        channel: 'Recovery guidance',
        time: params.performedAt,
        status: baseStatus,
      });
    }

    params.warnings.forEach((warning, index) => {
      flags.push({
        id: `warning-${index + 1}`,
        message: warning,
        channel: 'Recovery warning',
        time: params.performedAt,
        status: 'Warning',
      });
    });

    return flags;
  }

  private mapReadModelRecoveryHistoryItem(
    activity: ActivityLog
  ): PositionsSchedulerReadModelRecoveryHistoryItem {
    const flags = Array.isArray(activity.flags) ? activity.flags : [];
    const getFlag = (id: string): string =>
      String(flags.find((item) => item?.id === id)?.message || '').trim();
    const warnings = flags
      .filter((item) => String(item?.id || '').startsWith('warning-'))
      .map((item) => String(item?.message || '').trim())
      .filter(Boolean);
    const readFlagNumber = (id: string): number => {
      const parsed = Number(getFlag(id));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const scope = getFlag('scope');
    const state = getFlag('state');

    return {
      id: activity.id,
      recoveryId: String(activity.correlationId || getFlag('recovery-id') || activity.id).trim(),
      time:
        this.formatDate(activity.createdAt) ||
        this.formatDate(activity.updatedAt) ||
        new Date().toISOString(),
      title: String(activity.title || '').trim() || 'Positions recovery activity',
      status:
        String(activity.status || '').trim() === 'Failed'
          ? 'Failed'
          : String(activity.status || '').trim() === 'Warning'
            ? 'Warning'
            : 'Success',
      state:
        state === 'failed' ? 'failed' : state === 'noop' ? 'noop' : 'applied',
      scope:
        scope === 'owner' || scope === 'broker' || scope === 'all' ? scope : 'account',
      ...(activity.actor ? { actor: String(activity.actor).trim() } : {}),
      message: String(activity.description || activity.title || '').trim(),
      requestedAccounts: readFlagNumber('requested-accounts'),
      targetedAccounts: readFlagNumber('targeted-accounts'),
      processedAccounts: readFlagNumber('processed-accounts'),
      skippedAccounts: readFlagNumber('skipped-accounts'),
      deletedReadModelRows: readFlagNumber('deleted-rows'),
      insertedReadModelRows: readFlagNumber('inserted-rows'),
      snapshotRowsProcessed: readFlagNumber('snapshot-rows-processed'),
      beforeDriftAccounts: readFlagNumber('before-drift-accounts'),
      afterDriftAccounts: readFlagNumber('after-drift-accounts'),
      warnings,
      ...(getFlag('next-step') ? { recommendedNextStep: getFlag('next-step') } : {}),
      filters: {
        ...(getFlag('filter-account-id') ? { accountId: getFlag('filter-account-id') } : {}),
        ...(getFlag('filter-owner-user-id')
          ? { ownerUserId: getFlag('filter-owner-user-id') }
          : {}),
        ...(getFlag('filter-broker-key') ? { brokerKey: getFlag('filter-broker-key') } : {}),
        ...(getFlag('filter-limit')
          ? { limit: readFlagNumber('filter-limit') }
          : {}),
      },
    };
  }

  private async logReadModelRecoveryActivity(
    userId: string,
    payload: {
      recoveryId: string;
      title: string;
      status: 'Success' | 'Warning' | 'Failed';
      state: 'applied' | 'noop' | 'failed';
      scope: 'account' | 'owner' | 'broker' | 'all';
      performedAt: string;
      message: string;
      requestedAccounts: number;
      targetedAccounts: number;
      processedAccounts: number;
      skippedAccounts: number;
      deletedReadModelRows: number;
      insertedReadModelRows: number;
      snapshotRowsProcessed: number;
      filters: PositionsSchedulerReadModelRebuildResponse['filters'];
      beforeCoverage?: PositionsSchedulerReadModelCoverageSnapshot;
      afterCoverage?: PositionsSchedulerReadModelCoverageSnapshot;
      warnings: string[];
      recommendedNextStep?: string;
    }
  ): Promise<PositionsSchedulerReadModelRecoveryHistoryItem> {
    const flags = this.buildReadModelRecoveryActivityFlags(payload);
    const saved = await this.activityRepository.createActivityLog({
      userId,
      type: 'Scheduler run',
      title: payload.title,
      status: payload.status,
      actor: userId,
      route: 'Schedulers',
      stream: 'Runs',
      related: SCHEDULER_KEY,
      referenceId: POSITIONS_RECOVERY_ACTIVITY_REFERENCE_ID,
      correlationId: payload.recoveryId,
      description: payload.message,
      flags,
    });

    const fallbackTimestamp = new Date(payload.performedAt);
    const mappedActivity = Object.assign(new ActivityLog(), saved || {});
    mappedActivity.id = String(saved?.id || payload.recoveryId).trim();
    mappedActivity.correlationId = String(saved?.correlationId || payload.recoveryId).trim();
    mappedActivity.createdAt = Number.isNaN(fallbackTimestamp.getTime()) ? new Date() : fallbackTimestamp;
    mappedActivity.updatedAt = Number.isNaN(fallbackTimestamp.getTime()) ? new Date() : fallbackTimestamp;
    mappedActivity.title = String(saved?.title || payload.title).trim();
    mappedActivity.status = String(saved?.status || payload.status).trim();
    mappedActivity.actor = String(saved?.actor || userId).trim();
    mappedActivity.description = String(saved?.description || payload.message).trim();
    mappedActivity.flags = Array.isArray(saved?.flags) ? saved.flags : flags;

    return this.mapReadModelRecoveryHistoryItem(mappedActivity);
  }

  private buildReadModelRebuildNoopMessage(
    scope: 'account' | 'owner' | 'broker' | 'all',
    payload: PositionsSchedulerReadModelRebuildBody,
    reason: 'no_scope_match' | 'no_drift_match'
  ): string {
    const scopeLabel = this.describeReadModelRebuildScope(scope, payload);
    if (reason === 'no_scope_match') {
      return `No connected positions accounts matched ${scopeLabel}. Nothing was rebuilt.`;
    }
    return `No positions read-model drift matched ${scopeLabel}. Nothing was rebuilt.`;
  }

  private buildReadModelRebuildSuccessMessage(
    scope: 'account' | 'owner' | 'broker' | 'all',
    payload: PositionsSchedulerReadModelRebuildBody,
    requestedAccounts: number,
    targetedAccounts: number,
    rebuildResult: {
      processedAccounts: number;
      skippedAccounts: number;
      deletedReadModelRows: number;
      insertedReadModelRows: number;
      snapshotRowsProcessed: number;
    }
  ): string {
    const scopeLabel = this.describeReadModelRebuildScope(scope, payload);
    const driftModeLabel = payload.onlyDrifted === false ? 'selected' : 'drifted';
    return [
      `Positions read-model rebuild completed for ${scopeLabel}.`,
      `Matched ${requestedAccounts} account${requestedAccounts === 1 ? '' : 's'} and targeted ${targetedAccounts} ${driftModeLabel} account${targetedAccounts === 1 ? '' : 's'}.`,
      `Processed ${rebuildResult.processedAccounts}, skipped ${rebuildResult.skippedAccounts}, replaced ${rebuildResult.deletedReadModelRows} read-model row${rebuildResult.deletedReadModelRows === 1 ? '' : 's'} with ${rebuildResult.insertedReadModelRows} snapshot-derived row${rebuildResult.insertedReadModelRows === 1 ? '' : 's'} from ${rebuildResult.snapshotRowsProcessed} snapshot row${rebuildResult.snapshotRowsProcessed === 1 ? '' : 's'}.`,
    ].join(' ');
  }

  private buildReadModelRebuildWarnings(
    rebuildResult: {
      skippedAccounts: number;
      deletedReadModelRows: number;
      insertedReadModelRows: number;
    },
    afterCoverage: PositionsSchedulerReadModelCoverageSnapshot
  ): string[] {
    const warnings: string[] = [];

    if (rebuildResult.skippedAccounts > 0) {
      warnings.push(
        `${rebuildResult.skippedAccounts} targeted account${rebuildResult.skippedAccounts === 1 ? '' : 's'} had no snapshot rows available for rebuild and were skipped.`
      );
    }
    if (afterCoverage.accountsWithReadModelDrift > 0) {
      warnings.push(
        `Read-model drift still remains on ${afterCoverage.accountsWithReadModelDrift} targeted account${afterCoverage.accountsWithReadModelDrift === 1 ? '' : 's'} after rebuild.`
      );
    }
    if (
      rebuildResult.deletedReadModelRows === 0 &&
      rebuildResult.insertedReadModelRows === 0 &&
      afterCoverage.accountsWithReadModelDrift === 0
    ) {
      warnings.push('The rebuild completed, but no read-model rows needed replacement for the targeted scope.');
    }

    return warnings;
  }

  private buildReadModelRebuildRecommendedNextStep(
    state: 'applied' | 'noop',
    beforeCoverage: PositionsSchedulerReadModelCoverageSnapshot,
    afterCoverage: PositionsSchedulerReadModelCoverageSnapshot
  ): string {
    if (state === 'noop') {
      return 'Keep using the sync-state table for scoped inspection. Run a full Positions Sync only if checkpoint or snapshot freshness is also stale.';
    }
    if (afterCoverage.accountsWithReadModelDrift > 0) {
      return 'Refresh sync truth, inspect the remaining drifted accounts, and queue a full Positions Sync only if snapshot freshness or pending records still look unhealthy.';
    }
    if (beforeCoverage.accountsWithReadModelDrift > 0) {
      return 'Refresh sync truth, then return to `/positions` only after checkpoint and snapshot freshness also look healthy for the affected routes.';
    }
    return 'Refresh sync truth and keep the script drill as the fallback if a later reconciliation pass reintroduces drift.';
  }

  private describeReadModelRebuildScope(
    scope: 'account' | 'owner' | 'broker' | 'all',
    payload: PositionsSchedulerReadModelRebuildBody
  ): string {
    if (scope === 'account') {
      const accountId = String(payload.accountId || '').trim();
      const brokerKey = String(payload.brokerKey || '').trim().toLowerCase();
      return brokerKey ? `account ${accountId} on ${brokerKey}` : `account ${accountId}`;
    }
    if (scope === 'owner') {
      return `owner ${String(payload.ownerUserId || '').trim()}`;
    }
    if (scope === 'broker') {
      return `broker ${String(payload.brokerKey || '').trim().toLowerCase()}`;
    }
    return 'all connected positions accounts';
  }

  private normalizePersistedConfigMap(value: unknown): Record<string, unknown> {
    const configMap =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['positions'];
    configMap.sources = sources.length ? Array.from(new Set(sources)) : ['positions'];

    const retentionDays = Number(configMap.retentionDays);
    configMap.retentionDays =
      Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 30;

    const lookbackDays = Number(configMap.lookbackDays);
    configMap.lookbackDays =
      Number.isInteger(lookbackDays) && lookbackDays > 0 ? lookbackDays : 90;

    return configMap;
  }

  private async ensureLegacySchedulerAnchor(): Promise<SchedulerConfig> {
    const normalizedTimeZone = normalizeTimeZone(
      DEFAULT_SCHEDULER_TIMEZONE,
      DEFAULT_SCHEDULER_TIMEZONE
    );
    let config = await this.schedulerConfigRepository.createIfMissing({
      key: SCHEDULER_KEY,
      name: POSITIONS_SCHEDULER_NAME,
      description: POSITIONS_SCHEDULER_DESCRIPTION,
      enabled: false,
      cronExpression: '0 1 * * *',
      timezone: normalizedTimeZone,
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 200,
      schedulerType: POSITIONS_SCHEDULER_OWNERSHIP,
      config: {
        sources: ['positions'],
        retentionDays: 30,
        lookbackDays: 90,
      },
    });

    const patch: Partial<SchedulerConfig> = {};
    const normalizedPersistedConfig = this.normalizePersistedConfigMap(config.config);

    if (config.schedulerType !== POSITIONS_SCHEDULER_OWNERSHIP) {
      patch.schedulerType = POSITIONS_SCHEDULER_OWNERSHIP;
    }
    if (String(config.name || '').trim() !== POSITIONS_SCHEDULER_NAME) {
      patch.name = POSITIONS_SCHEDULER_NAME;
    }
    if (String(config.description || '').trim() !== POSITIONS_SCHEDULER_DESCRIPTION) {
      patch.description = POSITIONS_SCHEDULER_DESCRIPTION;
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
    _resolvedUserTimeZone?: string
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
      schedulerType: POSITIONS_SCHEDULER_OWNERSHIP,
      config: this.normalizePersistedConfigMap(anchor.config),
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      lastError: null,
      runningLockUntil: null,
    });

    const patch: Partial<SchedulerUserConfig> = {};
    if (config.schedulerType !== POSITIONS_SCHEDULER_OWNERSHIP) {
      patch.schedulerType = POSITIONS_SCHEDULER_OWNERSHIP;
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
    config: PositionsSchedulerUserConfigRecord,
    timeZone: string
  ): SchedulerConfigResponse {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['positions'];
    const retentionDays = this.readRetentionDays(config);
    const lookbackDays = this.readLookbackDays(config);
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
      schedulerType: POSITIONS_SCHEDULER_OWNERSHIP,
      sources,
      retentionDays,
      lookbackDays,
      time: buildSchedulerTimeContract(timeZone),
      readModelRecoveryPolicy: {
        supported: true,
        supportedScopes: [...POSITIONS_REBUILD_SUPPORTED_SCOPES],
        recommendedScopeOrder: [...POSITIONS_REBUILD_SUPPORTED_SCOPES],
        confirmationRequiredScopes: [...POSITIONS_REBUILD_CONFIRMATION_SCOPES],
        confirmationRequiredAboveAccounts: POSITIONS_REBUILD_CONFIRMATION_THRESHOLD,
        defaultOnlyDrifted: POSITIONS_REBUILD_DEFAULT_ONLY_DRIFTED,
        allowRebuildAll: true,
        maxScopedAccounts: POSITIONS_REBUILD_MAX_SCOPED_ACCOUNTS,
        cliCommand: POSITIONS_REBUILD_CLI_COMMAND,
        runbookPath: POSITIONS_REBUILD_RUNBOOK_PATH,
        adminSurface: '/schedulers?scheduler=positions-sync',
        productTrustSurface: '/positions',
      },
      lastStartedAt: this.formatDisplayDate(config.lastStartedAt, timeZone),
      lastStartedAtIso: formatSchedulerRawIso(config.lastStartedAt),
      lastFinishedAt: this.formatDisplayDate(config.lastFinishedAt, timeZone),
      lastFinishedAtIso: formatSchedulerRawIso(config.lastFinishedAt),
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
    row: Record<string, unknown>,
    timeZone: string,
    coverage: PositionReadModelCoverageRow | null = null
  ): SchedulerRecordSyncStateItem {
    const ownerUserId = String(row.userId || '').trim();
    const checkpointAt =
      this.formatDisplayDate(row.checkpointAt as Date | string | null | undefined, timeZone) ||
      this.toIsoString(row.checkpointAt);
    const nextRetryAt =
      this.formatDisplayDate(row.nextRetryAt as Date | string | null | undefined, timeZone) ||
      this.toIsoString(row.nextRetryAt);
    const lastPendingUpdateAt =
      this.formatDisplayDate(row.lastPendingUpdateAt as Date | string | null | undefined, timeZone) ||
      this.toIsoString(row.lastPendingUpdateAt);
    const latestSnapshotSeenAt =
      this.formatDisplayDate(coverage?.latestSnapshotSeenAt, timeZone) ||
      this.toIsoString(coverage?.latestSnapshotSeenAt);
    const latestReadModelSeenAt =
      this.formatDisplayDate(coverage?.latestReadModelSeenAt, timeZone) ||
      this.toIsoString(coverage?.latestReadModelSeenAt);
    const readModelState = this.getReadModelState(coverage);
    const readModelNeedsRebuild = this.readModelNeedsRebuild(coverage);

    return {
      accountId: String(row.accountId || ''),
      userId: ownerUserId,
      ownerUserId,
      brokerKey: String(row.brokerKey || ''),
      ...(checkpointAt ? { checkpointAt } : {}),
      ...(coverage
        ? {
            snapshotRows: coverage.snapshotRows,
            readModelRows: coverage.readModelRows,
            rowsMissingFromReadModel: coverage.rowsMissingFromReadModel,
            rowsBehindSnapshot: coverage.rowsBehindSnapshot,
            orphanReadModelRows: coverage.orphanReadModelRows,
            ...(latestSnapshotSeenAt ? { latestSnapshotSeenAt } : {}),
            ...(latestReadModelSeenAt ? { latestReadModelSeenAt } : {}),
            ...(readModelState ? { readModelState } : {}),
            readModelNeedsRebuild,
          }
        : {}),
      pendingRecords: this.readNumber(row.pendingRecords),
      failedRecords: this.readNumber(row.failedRecords),
      resolvedRecords: this.readNumber(row.resolvedRecords),
      ...(nextRetryAt ? { nextRetryAt } : {}),
      ...(lastPendingUpdateAt ? { lastPendingUpdateAt } : {}),
    };
  }

  private mapSyncStateSummaryRow(
    row: Record<string, unknown>,
    timeZone: string,
    coverageSummary?: {
      accountsWithSnapshotData: number;
      accountsWithoutSnapshotData: number;
      accountsWithReadModel: number;
      accountsWithoutReadModel: number;
      accountsWithReadModelDrift: number;
      snapshotRows: number;
      readModelRows: number;
      rowsMissingFromReadModel: number;
      rowsBehindSnapshot: number;
      orphanReadModelRows: number;
      latestSnapshotSeenAt: Date | null;
      latestReadModelSeenAt: Date | null;
    } | null
  ): SchedulerRecordSyncSummaryResponse {
    const nowMs = Date.now();
    const oldestCheckpointAtRaw = row.oldestCheckpointAt;
    const oldestCheckpointAt =
      this.formatDisplayDate(
        oldestCheckpointAtRaw as Date | string | null | undefined,
        timeZone
      ) || this.toIsoString(oldestCheckpointAtRaw);
    const latestCheckpointAt =
      this.formatDisplayDate(
        row.latestCheckpointAt as Date | string | null | undefined,
        timeZone
      ) || this.toIsoString(row.latestCheckpointAt);
    const latestSnapshotSeenAt =
      this.formatDisplayDate(coverageSummary?.latestSnapshotSeenAt, timeZone) ||
      this.toIsoString(coverageSummary?.latestSnapshotSeenAt);
    const latestReadModelSeenAt =
      this.formatDisplayDate(coverageSummary?.latestReadModelSeenAt, timeZone) ||
      this.toIsoString(coverageSummary?.latestReadModelSeenAt);
    const latestPendingUpdateAt =
      this.formatDisplayDate(
        row.latestPendingUpdateAt as Date | string | null | undefined,
        timeZone
      ) ||
      this.toIsoString(row.latestPendingUpdateAt);
    const nextRetryAt =
      this.formatDisplayDate(row.nextRetryAt as Date | string | null | undefined, timeZone) ||
      this.toIsoString(row.nextRetryAt);
    const oldestCheckpointAtDate = oldestCheckpointAtRaw
      ? oldestCheckpointAtRaw instanceof Date
        ? oldestCheckpointAtRaw
        : new Date(String(oldestCheckpointAtRaw))
      : null;
    const oldestCheckpointAgeHours = oldestCheckpointAtDate && !Number.isNaN(oldestCheckpointAtDate.getTime())
      ? Math.max(0, Math.floor((nowMs - oldestCheckpointAtDate.getTime()) / (60 * 60 * 1000)))
      : undefined;

    return {
      schedulerKey: SCHEDULER_KEY,
      totalAccounts: this.readNumber(row.totalAccounts),
      accountsWithCheckpoint: this.readNumber(row.accountsWithCheckpoint),
      accountsWithoutCheckpoint: this.readNumber(row.accountsWithoutCheckpoint),
      ...(coverageSummary
        ? {
            accountsWithSnapshotData: coverageSummary.accountsWithSnapshotData,
            accountsWithoutSnapshotData: coverageSummary.accountsWithoutSnapshotData,
            accountsWithReadModel: coverageSummary.accountsWithReadModel,
            accountsWithoutReadModel: coverageSummary.accountsWithoutReadModel,
            accountsWithReadModelDrift: coverageSummary.accountsWithReadModelDrift,
            snapshotRows: coverageSummary.snapshotRows,
            readModelRows: coverageSummary.readModelRows,
            rowsMissingFromReadModel: coverageSummary.rowsMissingFromReadModel,
            rowsBehindSnapshot: coverageSummary.rowsBehindSnapshot,
            orphanReadModelRows: coverageSummary.orphanReadModelRows,
            ...(latestSnapshotSeenAt ? { latestSnapshotSeenAt } : {}),
            ...(latestReadModelSeenAt ? { latestReadModelSeenAt } : {}),
          }
        : {}),
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
      time: buildSchedulerTimeContract(timeZone),
    };
  }

  private toIsoString(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    return this.formatDate(date);
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

  private async assertRunBelongsToPositionsScheduler(
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
      throw new NotFoundAppError('Positions scheduler run not found');
    }
  }

  private isMissingTableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const code = String((error as { code?: unknown }).code || '');
    return code === 'ER_NO_SUCH_TABLE';
  }

  private readNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private buildManualAudit(actorUserId: string) {
    return buildSystemSchedulerManualAudit(actorUserId);
  }

  private readRetentionDays(config: PositionsSchedulerConfigLike): number {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const retentionDays = Number(configMap.retentionDays);
    if (Number.isInteger(retentionDays) && retentionDays > 0) {
      return retentionDays;
    }
    return 30;
  }

  private readLookbackDays(config: PositionsSchedulerConfigLike): number {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const lookbackDays = Number(configMap.lookbackDays);
    if (Number.isInteger(lookbackDays) && lookbackDays > 0) {
      return lookbackDays;
    }
    return 90;
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

  private async loadReadModelCoverageByAccountIds(
    rows: Array<Record<string, unknown>>
  ): Promise<Map<string, PositionReadModelCoverageRow>> {
    if (!this.positionReadModelRepository?.getReadModelCoverageByAccountIds) {
      return new Map();
    }
    const accountIds = Array.from(
      new Set(
        rows.map((row) => String(row.accountId || '').trim()).filter(Boolean)
      )
    );
    if (!accountIds.length) {
      return new Map();
    }
    return await this.positionReadModelRepository.getReadModelCoverageByAccountIds(accountIds);
  }

  private async loadReadModelCoverageSummaryForConnectedAccounts(): Promise<{
    accountsWithSnapshotData: number;
    accountsWithoutSnapshotData: number;
    accountsWithReadModel: number;
    accountsWithoutReadModel: number;
    accountsWithReadModelDrift: number;
    snapshotRows: number;
    readModelRows: number;
    rowsMissingFromReadModel: number;
    rowsBehindSnapshot: number;
    orphanReadModelRows: number;
    latestSnapshotSeenAt: Date | null;
    latestReadModelSeenAt: Date | null;
  }> {
    if (!this.positionReadModelRepository?.summarizeReadModelCoverageByAccountIds) {
      return {
        accountsWithSnapshotData: 0,
        accountsWithoutSnapshotData: 0,
        accountsWithReadModel: 0,
        accountsWithoutReadModel: 0,
        accountsWithReadModelDrift: 0,
        snapshotRows: 0,
        readModelRows: 0,
        rowsMissingFromReadModel: 0,
        rowsBehindSnapshot: 0,
        orphanReadModelRows: 0,
        latestSnapshotSeenAt: null,
        latestReadModelSeenAt: null,
      };
    }
    const rows = (await coreDataSource.query(
      `SELECT ba.id AS accountId
         FROM broker_accounts ba
        WHERE LOWER(ba.status) IN ('connected', 'idle')
          AND ba.user_id IS NOT NULL`
    )) as Array<{ accountId?: string }>;
    const accountIds = rows.map((row) => String(row.accountId || '').trim()).filter(Boolean);
    return await this.positionReadModelRepository.summarizeReadModelCoverageByAccountIds(accountIds);
  }

  private getReadModelState(
    coverage: PositionReadModelCoverageRow | null
  ): 'empty' | 'synced' | 'missing' | 'behind' | 'orphaned' | undefined {
    if (!coverage) {
      return undefined;
    }
    if (coverage.snapshotRows === 0 && coverage.readModelRows === 0) {
      return 'empty';
    }
    if (coverage.snapshotRows === 0 && coverage.readModelRows > 0) {
      return 'orphaned';
    }
    if (coverage.snapshotRows > 0 && coverage.readModelRows === 0) {
      return 'missing';
    }
    if (
      coverage.rowsMissingFromReadModel > 0 ||
      coverage.rowsBehindSnapshot > 0 ||
      coverage.orphanReadModelRows > 0
    ) {
      return 'behind';
    }
    return 'synced';
  }

  private readModelNeedsRebuild(coverage: PositionReadModelCoverageRow | null): boolean {
    if (!coverage) {
      return false;
    }
    return this.getReadModelState(coverage) === 'missing' || this.getReadModelState(coverage) === 'behind' || this.getReadModelState(coverage) === 'orphaned';
  }
}
