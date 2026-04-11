import { randomUUID } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  FundsHealthThresholdProfile,
  FundsHealthThresholds,
  FundsSchedulerRunNowBody,
  SchedulerAssetUpdateLogItem,
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerFundsCoverageItem,
  SchedulerFundsCoverageListResponse,
  SchedulerFundsDiagnosticsSummaryResponse,
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
  validateFundsSchedulerRunBody,
  validateListQuery,
  validateSchedulerConfigBody,
  validateUpdateLogSortQuery,
} from '../validators/scheduler.validator';
import { successResponse } from '../utils/response';
import {
  DEFAULT_SCHEDULER_TIMEZONE,
  formatDateInTimeZone,
  normalizeTimeZone,
} from '../utils/timezone';
import {
  toSchedulerAuditContract,
} from '../utils/schedulerAuditContract';
import {
  buildSchedulerTimeContract,
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../utils/schedulerTimeContract';
import {
  BadRequestAppError,
  NotFoundAppError,
  ServiceUnavailableAppError,
} from '../errors/AppError';
import {
  ExchangeAssetUpdateLogRepository,
  SchedulerCommandRepository,
  SchedulerConfig,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  SchedulerUserConfig,
  SchedulerUserConfigRepository,
  ActivityRepository,
  AlertRepository,
  BrokerAccount,
  FundsSnapshotCoverageRow,
} from '../../database';
import { BrokerAccountRepository } from '../../database/repositories/BrokerAccountRepository';
import { FundsSnapshotRepository } from '../../database/repositories/FundsSnapshotRepository';
import { BrokerWalletLiveFetchService } from './BrokerWalletLiveFetchService';
import { env } from '../../env';
import { SchedulerRuntimeSchemaService } from './SchedulerRuntimeSchemaService';
import { UserTimeZoneService } from './UserTimeZoneService';

const SCHEDULER_KEY = 'funds-sync';
const FUNDS_SCHEDULER_OWNERSHIP = 'user' as const;
const FUNDS_SCHEDULER_NAME = 'Funds Snapshot Sync';
const FUNDS_SCHEDULER_DESCRIPTION =
  'Captures wallet and futures funds for connected broker accounts.';
const FUNDS_RUN_UPDATES_REASON =
  'Funds snapshot sync does not emit per-record update logs. Use /scheduler/funds/summary and /scheduler/funds/coverage instead.';
const FUNDS_HEALTH_THRESHOLD_KEYS = [
  'maxStaleAccounts',
  'maxMissingAccounts',
  'maxFailedLatestAttempts',
  'maxLatestSnapshotAgeMinutes',
  'maxLatestAttemptAgeMinutes',
] as const;

type FundsHealthThresholdKey = (typeof FUNDS_HEALTH_THRESHOLD_KEYS)[number];

type SnapshotFailure = {
  userId: string;
  brokerKey: string;
  accountId: string;
  error: string;
};

export type FundsSnapshotBatchResult = {
  totalAccounts: number;
  successCount: number;
  insertedCount: number;
  updatedCount: number;
  failureCount: number;
  failures: SnapshotFailure[];
};

type FundsSnapshotAccountGroup = {
  userId: string;
  accounts: BrokerAccount[];
};

type FundsSchedulerUserConfigRecord = SchedulerUserConfig;
type FundsSchedulerConfigLike = {
  batchSize?: number | null;
  config?: Record<string, unknown> | null;
};

type FundsCoverageFreshnessState = 'fresh' | 'stale' | 'missing';

type FundsScopedRun = {
  accountId?: string;
  brokerKey?: string;
  scope?: {
    accountIds?: string[];
    brokerKeys?: string[];
  };
  scopeLabel: string;
};

@Service()
export class FundsSchedulerService {
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

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => BrokerWalletLiveFetchService)
  private brokerWalletLiveFetchService!: BrokerWalletLiveFetchService;

  @Inject(() => FundsSnapshotRepository)
  private fundsSnapshotRepository!: FundsSnapshotRepository;

  @Inject(() => SchedulerRuntimeSchemaService)
  private schedulerRuntimeSchemaService!: SchedulerRuntimeSchemaService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async getSchedulerConfig(userId: string): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const config = await this.ensureSchedulerConfig(userId, timeZone);
    return successResponse(this.mapConfig(config, timeZone));
  }

  async updateSchedulerConfig(
    actorUserId: string,
    body: Partial<UpdateSchedulerConfigBody>
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    try {
      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const payload = validateSchedulerConfigBody(body);
      const current = await this.ensureSchedulerConfig(actorUserId, timeZone);
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
      if (
        payload.schedulerType !== undefined &&
        String(payload.schedulerType || '').trim().toLowerCase() !== FUNDS_SCHEDULER_OWNERSHIP
      ) {
        throw new BadRequestAppError(
          `${FUNDS_SCHEDULER_NAME} is a user scheduler and cannot be switched to global scope.`
        );
      }
      if (payload.fundsHealthThresholds !== undefined) {
        nextConfig.fundsHealthThresholds = this.normalizeFundsHealthThresholds(
          payload.fundsHealthThresholds
        );
      }

      const updated = await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(
        SCHEDULER_KEY,
        actorUserId,
        {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
        ...(payload.cronExpression !== undefined
          ? { cronExpression: payload.cronExpression }
          : {}),
        ...(payload.runAt !== undefined ? { runAt: payload.runAt } : {}),
        ...(payload.intervalDays !== undefined ? { intervalDays: payload.intervalDays } : {}),
        ...(payload.batchSize !== undefined ? { batchSize: payload.batchSize } : {}),
        schedulerType: FUNDS_SCHEDULER_OWNERSHIP,
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
        'Funds scheduler config updated',
        'Success',
        `Updated scheduler config for ${SCHEDULER_KEY}`
      );
      return successResponse(this.mapConfig(config, timeZone));
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Funds scheduler config update failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async runNow(
    actorUserId: string,
    body: Partial<FundsSchedulerRunNowBody> = {}
  ): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    try {
      if (!actorUserId) {
        throw new BadRequestAppError('actorUserId is required');
      }
      const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
      const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
      const runRequest = validateFundsSchedulerRunBody(body);
      const manualAudit = this.buildManualAudit(actorUserId);
      if (!config.enabled) {
        throw new BadRequestAppError('Funds scheduler is paused. Resume it before running now.');
      }
      if (env.scheduler.executionMode !== 'queue') {
        throw new ServiceUnavailableAppError(
          'Scheduler execution must run in queue mode from trading-scheduler-worker'
        );
      }
      await this.schedulerRuntimeSchemaService.assertFundsRuntimeSchemaReady();
      const requestedAt = this.formatDate(new Date());
      const scope = await this.resolveScopedFundsRun(actorUserId, runRequest);
      const isScopedRun = Boolean(scope.accountId || scope.brokerKey);

      if (!isScopedRun) {
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
            message: 'Funds scheduler run already queued',
          });
        }
        const running =
          await this.schedulerRunLogRepository.hasRunningRunBySchedulerKeyAndActor(
            SCHEDULER_KEY,
            actorUserId
          );
        if (running) {
          return successResponse({
            queued: false,
            executionMode: 'queue',
            started: false,
            message: 'Funds scheduler run already in progress',
          });
        }
      }

      const trigger = isScopedRun ? 'scoped-manual' : 'manual';
      const runId = randomUUID();
      await this.schedulerRunLogRepository.createRun({
        id: runId,
        schedulerKey: SCHEDULER_KEY,
        actorUserId,
        initiatedByType: manualAudit.initiatedByType,
        initiatedByUserId: manualAudit.initiatedByUserId ?? null,
        initiatedByLabel: manualAudit.initiatedByLabel ?? null,
        executionContext: manualAudit.executionContext,
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
          trigger,
          actorUserId,
          requestedByUserId: actorUserId,
          requestedAt,
          initiatedByType: manualAudit.initiatedByType,
          initiatedByUserId: manualAudit.initiatedByUserId,
          initiatedByLabel: manualAudit.initiatedByLabel,
          executionContext: manualAudit.executionContext,
          ...(scope.scope ? { scope: scope.scope } : {}),
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
          actorUserId,
          requestedByUserId: actorUserId,
          requestedAt,
          initiatedByType: manualAudit.initiatedByType,
          initiatedByUserId: manualAudit.initiatedByUserId,
          initiatedByLabel: manualAudit.initiatedByLabel,
          executionContext: manualAudit.executionContext,
          ...(scope.scope ? { scope: scope.scope } : {}),
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });
      await this.logSchedulerActivity(
        actorUserId,
        isScopedRun ? 'Funds scheduler scoped run queued' : 'Funds scheduler run queued',
        'Success',
        isScopedRun
          ? `Queued scoped funds sync for ${scope.scopeLabel} as command ${command.id}`
          : `Queued run_now for ${SCHEDULER_KEY} as command ${command.id}`
      );

      return successResponse({
        queued: true,
        executionMode: 'queue',
        started: false,
        runId,
        jobId: command.id,
        message: isScopedRun
          ? `Scoped funds sync queued for ${scope.scopeLabel}.`
          : 'Funds scheduler command queued',
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Funds scheduler run failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitSchedulerFailureAlert(
        actorUserId,
        'Funds scheduler run failed',
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
    await this.logSchedulerActivity(actorUserId, 'Funds scheduler paused', 'Success', `Paused ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'pause',
      message: 'Funds scheduler paused',
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
    await this.logSchedulerActivity(actorUserId, 'Funds scheduler resumed', 'Success', `Resumed ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'resume',
      message: 'Funds scheduler resumed',
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
    const manualAudit = this.buildManualAudit(actorUserId);
    const cancelledPendingRuns =
      await this.schedulerCommandRepository.cancelPendingBySchedulerKeyAndTypeAndActor(
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
      'Funds scheduler stop requested',
      'Success',
      `Stop request handled for ${SCHEDULER_KEY}. activeStop=${running ? 'queued' : 'not-required'}, pendingRunsCancelled=${cancelledPendingRuns}`
    );
    return successResponse({
      queued: Boolean(stopCommandId),
      action: 'stop',
      state: stopCommandId ? 'queued' : cancelledPendingRuns > 0 ? 'applied' : 'noop',
      message:
        running || cancelledPendingRuns > 0
          ? 'Funds scheduler stop requested'
          : 'No active or queued funds scheduler run to stop',
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
      throw new BadRequestAppError('Funds scheduler is paused. Resume it before restarting.');
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
      'Funds scheduler restart queued',
      'Success',
      running
        ? `Queued stop ${stopCommandId} and run ${runCommand.id} for ${SCHEDULER_KEY}`
        : `Queued run ${runCommand.id} for ${SCHEDULER_KEY}`
    );
    return successResponse({
      queued: true,
      action: 'restart',
      state: 'queued',
      message: 'Funds scheduler restart queued',
      commandIds: stopCommandId ? [stopCommandId, runCommand.id] : [runCommand.id],
    });
  }

  async purgeSchedulerLogs(actorUserId: string): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
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
      'Funds scheduler logs purged',
      'Success',
      `Purged ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs for ${SCHEDULER_KEY}`
    );
    return successResponse({
      message: `Funds scheduler logs purged. Deleted ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs.`,
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

  async getSchedulerDiagnosticsSummary(
    actorUserId: string
  ): Promise<ApiSuccessResponse<SchedulerFundsDiagnosticsSummaryResponse>> {
    const resolvedTimeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const config = await this.ensureSchedulerConfig(actorUserId, resolvedTimeZone);
    const configuredTimeZone = normalizeTimeZone(config.timezone, resolvedTimeZone);
    const referenceNow = new Date(Date.now());
    const localDate = this.resolveLocalDateKey(referenceNow, configuredTimeZone);
    const runtimeFoundation = await this.schedulerRuntimeSchemaService.inspectFundsRuntimeSchema();
    const coverageItems = await this.loadCoverageItems({
      actorUserId,
      localDateKey: localDate,
      runtimeFoundation,
    });
    const latestRunResult = await this.schedulerRunLogRepository.listRunsBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId,
      25,
      0
    );
    const latestObservedSnapshotAt = coverageItems.reduce<Date | null>(
      (current, item) =>
        this.maxDate(current, this.parseDate(item.latestObservedAt || undefined)),
      null
    );
    const latestAttemptAt = coverageItems.reduce<Date | null>(
      (current, item) =>
        this.maxDate(current, this.parseDate(item.latestAttemptAt || undefined)),
      null
    );
    const lastSuccessfulRun = latestRunResult.items.find(
      (item) => String(item.status || '').trim().toLowerCase() === 'completed'
    );
    const fundsHealthThresholds = this.readFundsHealthThresholds(config);

    return successResponse({
      schedulerKey: SCHEDULER_KEY,
      timezone: configuredTimeZone,
      localDate,
      totalConnectedAccounts: coverageItems.length,
      accountsWithFreshSnapshot: coverageItems.filter((item) => item.freshnessState === 'fresh')
        .length,
      accountsWithStaleSnapshot: coverageItems.filter((item) => item.freshnessState === 'stale')
        .length,
      accountsMissingSnapshot: coverageItems.filter((item) => item.freshnessState === 'missing')
        .length,
      accountsWithFailedLatestAttempt: coverageItems.filter(
        (item) => item.latestFetchStatus === 'failed'
      ).length,
      accountsWithSuccessfulLatestAttempt: coverageItems.filter(
        (item) => item.latestFetchStatus === 'success'
      ).length,
      latestObservedSnapshotAt: this.formatDate(latestObservedSnapshotAt),
      latestObservedSnapshotAgeMinutes: this.readAgeMinutes(latestObservedSnapshotAt),
      latestAttemptAt: this.formatDate(latestAttemptAt),
      latestAttemptAgeMinutes: this.readAgeMinutes(latestAttemptAt),
      lastSuccessfulRun: lastSuccessfulRun
        ? {
            id: lastSuccessfulRun.id,
            status: lastSuccessfulRun.status,
            startedAt: this.formatDate(lastSuccessfulRun.startedAt),
            finishedAt: this.formatDate(lastSuccessfulRun.finishedAt),
            targetedAccounts: lastSuccessfulRun.processedAccounts,
            refreshedAccounts:
              this.readNumber(lastSuccessfulRun.insertedAssets) +
              this.readNumber(lastSuccessfulRun.updatedAssets),
            failedAccounts: this.readNumber(lastSuccessfulRun.skippedAssets),
          }
        : null,
      fundsHealthThresholds,
      fundsHealthThresholdProfile: this.buildFundsHealthThresholdProfile(fundsHealthThresholds),
      runtimeFoundation,
      recoveryRunSupported: runtimeFoundation.status === 'ready',
      recoveryRunScope: 'account',
      ...(runtimeFoundation.status === 'missing'
        ? {
            recoveryRunReason:
              runtimeFoundation.note ||
              'Funds runtime schema is not ready for scoped recovery runs.',
          }
        : {}),
      runUpdatesSupported: false,
      runUpdatesSupportState: 'not_emitted',
      runUpdatesReason: FUNDS_RUN_UPDATES_REASON,
    });
  }

  async listSchedulerCoverage(
    actorUserId: string,
    query: {
      limit?: string;
      offset?: string;
      accountId?: string;
      brokerKey?: string;
      freshnessState?: string;
      latestFetchStatus?: string;
    }
  ): Promise<ApiSuccessResponse<SchedulerFundsCoverageListResponse>> {
    const resolvedTimeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const config = await this.ensureSchedulerConfig(actorUserId, resolvedTimeZone);
    const configuredTimeZone = normalizeTimeZone(config.timezone, resolvedTimeZone);
    const referenceNow = new Date(Date.now());
    const localDate = this.resolveLocalDateKey(referenceNow, configuredTimeZone);
    const { limit, offset } = validateListQuery(query);
    const accountId = String(query.accountId || '').trim();
    const brokerKey = String(query.brokerKey || '').trim().toLowerCase();
    const freshnessState = this.readFreshnessFilter(query.freshnessState);
    const latestFetchStatus = this.readLatestFetchStatusFilter(query.latestFetchStatus);
    const runtimeFoundation = await this.schedulerRuntimeSchemaService.inspectFundsRuntimeSchema();
    const filtered = (
      await this.loadCoverageItems({
        actorUserId,
        localDateKey: localDate,
        runtimeFoundation,
        brokerKey: brokerKey || undefined,
      })
    )
      .filter((item) => {
        if (accountId && item.accountId !== accountId) {
          return false;
        }
        if (freshnessState && item.freshnessState !== freshnessState) {
          return false;
        }
        if (latestFetchStatus && item.latestFetchStatus !== latestFetchStatus) {
          return false;
        }
        return true;
      });

    return successResponse({
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
      timezone: configuredTimeZone,
      localDate,
    });
  }

  async listSchedulerRuns(
    actorUserId: string,
    query: { limit?: string; offset?: string }
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    const { limit, offset } = validateListQuery(query);
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
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
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
    const run = await this.schedulerRunLogRepository.findByIdAndSchedulerKeyAndActor(
      normalizedRunId,
      SCHEDULER_KEY,
      actorUserId
    );
    if (!run) {
      throw new NotFoundAppError('Funds scheduler run not found');
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
    const runMeta = this.parseMeta(run.meta);

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
        createdAt:
          this.formatDisplayDate(item.createdAt, timeZone) || this.formatDate(item.createdAt),
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
      throw new NotFoundAppError('Funds scheduler run not found');
    }
    const sort = validateUpdateLogSortQuery(query);
    const actionType = query.actionType ? String(query.actionType).trim() : undefined;
    const source = query.source ? String(query.source).trim() : undefined;
    const symbol = query.symbol ? String(query.symbol).trim() : undefined;

    const { items } = await this.exchangeAssetUpdateLogRepository.listByRunLogId(
      normalizedRunId,
      100000,
      0,
      {
        actionType: actionType || undefined,
        source: source || undefined,
        symbol: symbol || undefined,
        sortBy: sort.sortBy,
        sortOrder: sort.sortOrder,
      }
    );
    const runMeta = this.parseMeta(run.meta);

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
      fileName: `scheduler-run-${normalizedRunId}-updates.csv`,
      rowCount: rows.length,
      csv,
    });
  }

  private normalizeTargetUserIds(input?: string[]): string[] {
    return Array.from(
      new Set(
        (Array.isArray(input) ? input : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    );
  }

  private normalizeBrokerKeys(input?: string[]): string[] {
    return Array.from(
      new Set(
        (Array.isArray(input) ? input : [])
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );
  }

  private filterScopedAccounts(
    accounts: BrokerAccount[],
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): BrokerAccount[] {
    return accounts.filter((account) => {
      if (
        brokerKeyFilter.size > 0 &&
        !brokerKeyFilter.has(String(account.brokerKey || '').trim().toLowerCase())
      ) {
        return false;
      }
      if (accountIdFilter.size > 0 && !accountIdFilter.has(String(account.id || '').trim())) {
        return false;
      }
      return true;
    });
  }

  private groupInfraAccountsByOwner(
    accounts: BrokerAccount[],
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): FundsSnapshotAccountGroup[] {
    const grouped = new Map<string, BrokerAccount[]>();

    for (const account of this.filterScopedAccounts(accounts, brokerKeyFilter, accountIdFilter)) {
      const ownerUserId = String(account.userId || '').trim();
      if (!ownerUserId) {
        continue;
      }
      const bucket = grouped.get(ownerUserId);
      if (bucket) {
        bucket.push(account);
      } else {
        grouped.set(ownerUserId, [account]);
      }
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([userId, ownerAccounts]) => ({
        userId,
        accounts: ownerAccounts.sort((left, right) =>
          String(left.id || '').localeCompare(String(right.id || ''))
        ),
      }));
  }

  async runSnapshotBatch(params: {
    targetUserIds: string[];
    brokerKeys: string[];
    accountIds: string[];
    runLogId?: string;
  }): Promise<FundsSnapshotBatchResult> {
    const targetUserIds = this.normalizeTargetUserIds(params.targetUserIds);
    const brokerKeyFilter = new Set(this.normalizeBrokerKeys(params.brokerKeys));
    const accountIdFilter = new Set(
      (Array.isArray(params.accountIds) ? params.accountIds : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    );

    let totalAccounts = 0;
    let successCount = 0;
    let insertedCount = 0;
    let updatedCount = 0;
    let failureCount = 0;
    const failures: SnapshotFailure[] = [];

    const isInfraAllAccountsRequest =
      targetUserIds.length === 1 && targetUserIds[0] === env.scheduler.systemUserId;
    const accountGroups = isInfraAllAccountsRequest
      ? this.groupInfraAccountsByOwner(
          await this.brokerAccountRepository.getAllActiveBrokerAccounts(),
          brokerKeyFilter,
          accountIdFilter
        )
      : await Promise.all(
          targetUserIds.map(async (userId): Promise<FundsSnapshotAccountGroup> => {
            const isSystemUser = userId === env.scheduler.systemUserId;
            const accounts = isSystemUser
              ? await this.brokerAccountRepository.getActiveSystemBrokerAccounts()
              : await this.brokerAccountRepository.getActiveBrokerAccounts(userId);
            return {
              userId,
              accounts: this.filterScopedAccounts(accounts, brokerKeyFilter, accountIdFilter),
            };
          })
        );

    for (const { userId, accounts } of accountGroups) {
      totalAccounts += accounts.length;

      for (const account of accounts) {
        const accountId = String(account.id || '').trim();
        const brokerKey = String(account.brokerKey || '').trim().toLowerCase();
        const accountOwnerUserId = String(account.userId || '').trim() || userId;
        try {
          const funds = await this.brokerWalletLiveFetchService.fetchAccountFunds(
            accountOwnerUserId,
            brokerKey,
            accountId
          );

          const result = await this.fundsSnapshotRepository.createSnapshot({
            userId: funds.userId,
            brokerKey: funds.brokerKey,
            accountId: funds.accountId,
            walletFunds: funds.walletFunds,
            futuresFunds: funds.futuresFunds,
            computedAt: new Date(),
            source: 'broker_runtime',
          });

          if (result.inserted) {
            insertedCount += 1;
          } else if (result.updated) {
            updatedCount += 1;
          }
          successCount += 1;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          try {
            await this.fundsSnapshotRepository.recordFetchFailure({
              userId: accountOwnerUserId,
              brokerKey,
              accountId,
              attemptedAt: new Date(),
              errorMessage,
              source: 'broker_runtime',
            });
          } catch {
            // Best-effort failure metadata should not mask the broker fetch error.
          }
          failureCount += 1;
          failures.push({
            userId: accountOwnerUserId,
            brokerKey,
            accountId,
            error: errorMessage,
          });
        }
      }
    }

    return {
      totalAccounts,
      successCount,
      insertedCount,
      updatedCount,
      failureCount,
      failures,
    };
  }

  private normalizePersistedConfigMap(value: unknown): Record<string, unknown> {
    const configMap =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['funds'];
    configMap.sources = sources.length ? Array.from(new Set(sources)) : ['funds'];

    const retentionDays = Number(configMap.retentionDays);
    configMap.retentionDays =
      Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 30;

    if (Object.prototype.hasOwnProperty.call(configMap, 'fundsHealthThresholds')) {
      configMap.fundsHealthThresholds = this.normalizeFundsHealthThresholds(
        configMap.fundsHealthThresholds
      );
    }

    return configMap;
  }

  private async ensureLegacySchedulerAnchor(): Promise<SchedulerConfig> {
    const normalizedTimeZone = normalizeTimeZone(
      DEFAULT_SCHEDULER_TIMEZONE,
      DEFAULT_SCHEDULER_TIMEZONE
    );
    let config = await this.schedulerConfigRepository.createIfMissing({
      key: SCHEDULER_KEY,
      name: FUNDS_SCHEDULER_NAME,
      description: FUNDS_SCHEDULER_DESCRIPTION,
      enabled: false,
      cronExpression: '0 1 * * *',
      timezone: normalizedTimeZone,
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 200,
      schedulerType: FUNDS_SCHEDULER_OWNERSHIP,
      config: {
        sources: ['funds'],
        retentionDays: 30,
      },
    });

    const patch: Partial<SchedulerConfig> = {};
    const normalizedPersistedConfig = this.normalizePersistedConfigMap(config.config);

    if (config.schedulerType !== FUNDS_SCHEDULER_OWNERSHIP) {
      patch.schedulerType = FUNDS_SCHEDULER_OWNERSHIP;
    }
    if (!String(config.name || '').trim()) {
      patch.name = FUNDS_SCHEDULER_NAME;
    }
    if (String(config.description || '').trim() !== FUNDS_SCHEDULER_DESCRIPTION) {
      patch.description = FUNDS_SCHEDULER_DESCRIPTION;
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
    const normalizedTimeZone = normalizeTimeZone(
      anchor.timezone,
      DEFAULT_SCHEDULER_TIMEZONE
    );
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
      schedulerType: FUNDS_SCHEDULER_OWNERSHIP,
      config: this.normalizePersistedConfigMap(anchor.config),
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      lastError: null,
      runningLockUntil: null,
    });

    const patch: Partial<SchedulerUserConfig> = {};
    if (config.schedulerType !== FUNDS_SCHEDULER_OWNERSHIP) {
      patch.schedulerType = FUNDS_SCHEDULER_OWNERSHIP;
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
    config: FundsSchedulerUserConfigRecord,
    timeZone: string
  ): SchedulerConfigResponse {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['funds'];
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
    const fundsHealthThresholds = this.readFundsHealthThresholds(config);

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
      schedulerType: FUNDS_SCHEDULER_OWNERSHIP,
      sources,
      retentionDays,
      fundsHealthThresholds,
      time: buildSchedulerTimeContract(timeZone),
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

  private resolveLocalDateKey(reference: Date, timeZone: string): string {
    const formatted = formatDateInTimeZone(reference, timeZone, { includeMs: false });
    return formatted?.slice(0, 10) || reference.toISOString().slice(0, 10);
  }

  private mapCoverageItem(
    row: FundsSnapshotCoverageRow,
    context: { localDateKey: string }
  ): SchedulerFundsCoverageItem {
    const latestObservedAt = this.pickFirstDate(
      row.latest_success_observed_at,
      row.latest_success_computed_at
    );
    const latestAttemptAt = this.pickFirstDate(row.latest_last_attempt_at, row.latest_computed_at);
    const freshnessState = this.resolveFreshnessState(
      row.latest_success_snapshot_date,
      context.localDateKey
    );
    const walletSnapshotAvailable = row.latest_success_snapshot_id
      ? row.latest_success_wallet_available
      : row.latest_wallet_available;
    const futuresSnapshotAvailable = row.latest_success_snapshot_id
      ? row.latest_success_futures_available
      : row.latest_futures_available;
    const latestSource = row.latest_source || row.latest_success_source || undefined;

    return {
      accountId: row.account_id,
      accountName: row.account_name,
      accountKey: row.account_key,
      brokerKey: row.broker_key,
      accountStatus: row.account_status,
      freshnessState,
      latestSnapshotDate: row.latest_success_snapshot_date || undefined,
      latestObservedAt: this.formatDate(latestObservedAt),
      latestObservedAgeMinutes: this.readAgeMinutes(latestObservedAt),
      latestFetchStatus: row.latest_fetch_status || undefined,
      latestAttemptAt: this.formatDate(latestAttemptAt),
      latestAttemptAgeMinutes: this.readAgeMinutes(latestAttemptAt),
      latestError:
        row.latest_fetch_status === 'failed' && row.latest_error_message
          ? row.latest_error_message
          : undefined,
      latestSource,
      walletSnapshotAvailable,
      futuresSnapshotAvailable,
      needsAttention: freshnessState !== 'fresh' || row.latest_fetch_status === 'failed',
    };
  }

  private async loadCoverageItems(
    context: {
      actorUserId: string;
      localDateKey: string;
      runtimeFoundation: SchedulerFundsDiagnosticsSummaryResponse['runtimeFoundation'];
      brokerKey?: string;
    }
  ): Promise<SchedulerFundsCoverageItem[]> {
    if (context.runtimeFoundation?.status === 'missing') {
      const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
        context.actorUserId,
        context.brokerKey
      );
      return activeAccounts.map((account) =>
        this.mapFallbackCoverageItem(account, context.runtimeFoundation)
      );
    }

    const coverageRows = await this.fundsSnapshotRepository.listLatestAccountCoverage(
      context.actorUserId,
      context.brokerKey
    );
    return coverageRows.map((row) =>
      this.mapCoverageItem(row, {
        localDateKey: context.localDateKey,
      })
    );
  }

  private mapFallbackCoverageItem(
    account: BrokerAccount,
    runtimeFoundation: SchedulerFundsDiagnosticsSummaryResponse['runtimeFoundation']
  ): SchedulerFundsCoverageItem {
    return {
      accountId: String(account.id || ''),
      accountName: String(account.accountName || ''),
      accountKey: String(account.accountKey || ''),
      brokerKey: String(account.brokerKey || '').trim().toLowerCase(),
      accountStatus: String(account.status || ''),
      freshnessState: 'missing',
      latestFetchStatus: undefined,
      latestError:
        runtimeFoundation?.status === 'missing'
          ? runtimeFoundation.note || 'Funds runtime foundation is missing.'
          : undefined,
      latestSource: 'runtime_foundation_missing',
      walletSnapshotAvailable: false,
      futuresSnapshotAvailable: false,
      needsAttention: true,
    };
  }

  private resolveFreshnessState(
    snapshotDate: string | null,
    localDateKey: string
  ): FundsCoverageFreshnessState {
    const normalizedSnapshotDate = String(snapshotDate || '').trim();
    if (!normalizedSnapshotDate) {
      return 'missing';
    }
    return normalizedSnapshotDate >= localDateKey ? 'fresh' : 'stale';
  }

  private readFreshnessFilter(value?: string): FundsCoverageFreshnessState | undefined {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (normalized === 'fresh' || normalized === 'stale' || normalized === 'missing') {
      return normalized;
    }
    throw new BadRequestAppError('freshnessState must be one of fresh, stale, missing');
  }

  private readLatestFetchStatusFilter(value?: string): 'success' | 'failed' | undefined {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (normalized === 'success' || normalized === 'failed') {
      return normalized;
    }
    throw new BadRequestAppError('latestFetchStatus must be one of success, failed');
  }

  private readAgeMinutes(value: Date | null | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const time = value.getTime();
    if (!Number.isFinite(time)) {
      return undefined;
    }
    return Math.max(0, Math.round((Date.now() - time) / 60000));
  }

  private parseDate(value?: string): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private pickFirstDate(...values: Array<Date | null | undefined>): Date | null {
    for (const value of values) {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
      }
    }
    return null;
  }

  private maxDate(current: Date | null, next: Date | null): Date | null {
    if (!current) {
      return next;
    }
    if (!next) {
      return current;
    }
    return current.getTime() >= next.getTime() ? current : next;
  }

  private async resolveScopedFundsRun(
    actorUserId: string,
    body: FundsSchedulerRunNowBody
  ): Promise<FundsScopedRun> {
    const accountId = String(body.accountId || '').trim();
    const brokerKey = String(body.brokerKey || '').trim().toLowerCase();
    if (!accountId && !brokerKey) {
      return {
        scopeLabel: 'all active broker accounts',
      };
    }

    const activeAccounts = await this.brokerAccountRepository.getActiveBrokerAccounts(
      actorUserId,
      brokerKey || undefined
    );

    if (accountId) {
      const matched = activeAccounts.find((item) => String(item.id || '').trim() === accountId);
      if (!matched) {
        throw new NotFoundAppError(
          'Funds recovery target account not found among active broker accounts'
        );
      }
      const resolvedBrokerKey = String(matched.brokerKey || brokerKey || '')
        .trim()
        .toLowerCase();
      return {
        accountId,
        brokerKey: resolvedBrokerKey || undefined,
        scope: {
          accountIds: [accountId],
          ...(resolvedBrokerKey ? { brokerKeys: [resolvedBrokerKey] } : {}),
        },
        scopeLabel: `${accountId}${resolvedBrokerKey ? ` (${resolvedBrokerKey})` : ''}`,
      };
    }

    if (!activeAccounts.length) {
      throw new NotFoundAppError('Funds recovery target broker has no active broker accounts');
    }

    const scopedAccountIds = activeAccounts
      .map((item) => String(item.id || '').trim())
      .filter(Boolean);
    const scopedBrokerKeys = Array.from(
      new Set(
        activeAccounts
          .map((item) => String(item.brokerKey || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const resolvedBrokerKey = brokerKey || scopedBrokerKeys[0] || undefined;

    return {
      ...(resolvedBrokerKey ? { brokerKey: resolvedBrokerKey } : {}),
      scope: {
        ...(scopedAccountIds.length ? { accountIds: scopedAccountIds } : {}),
        ...(scopedBrokerKeys.length ? { brokerKeys: scopedBrokerKeys } : {}),
      },
      scopeLabel: resolvedBrokerKey
        ? `${resolvedBrokerKey} (${scopedAccountIds.length} active accounts)`
        : `${scopedAccountIds.length} active accounts`,
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
        currentItem:
          progressRaw.currentItem &&
          typeof progressRaw.currentItem === 'object' &&
          !Array.isArray(progressRaw.currentItem)
            ? {
                symbol: String((progressRaw.currentItem as Record<string, unknown>).symbol || ''),
                assetId: String((progressRaw.currentItem as Record<string, unknown>).assetId || ''),
                id: String((progressRaw.currentItem as Record<string, unknown>).id || ''),
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

  private buildManualAudit(actorUserId: string) {
    const normalizedActorUserId = String(actorUserId || '').trim();
    return {
      initiatedByType: 'manual' as const,
      ...(normalizedActorUserId ? { initiatedByUserId: normalizedActorUserId } : {}),
      ...(normalizedActorUserId ? { initiatedByLabel: normalizedActorUserId } : {}),
      executionContext: 'user' as const,
    };
  }

  private formatDisplayDate(
    value: Date | string | null | undefined,
    timeZone: string
  ): string | undefined {
    return formatSchedulerDisplayTime(value, timeZone);
  }

  private normalizeFundsHealthThresholds(
    value: unknown
  ): Record<FundsHealthThresholdKey, number | null> {
    const input =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const thresholds = {} as Record<FundsHealthThresholdKey, number | null>;

    for (const key of FUNDS_HEALTH_THRESHOLD_KEYS) {
      const raw = input[key];
      if (raw === null || raw === undefined || raw === '') {
        thresholds[key] = null;
        continue;
      }
      const parsed = Number(raw);
      thresholds[key] = Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    return thresholds;
  }

  private readFundsHealthThresholds(
    config: FundsSchedulerConfigLike
  ): Record<FundsHealthThresholdKey, number | null> {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    return this.normalizeFundsHealthThresholds(configMap.fundsHealthThresholds);
  }

  private buildFundsHealthThresholdProfile(
    thresholds: FundsHealthThresholds
  ): FundsHealthThresholdProfile {
    const configuredKeys = FUNDS_HEALTH_THRESHOLD_KEYS.filter(
      (key) => thresholds[key] !== null && thresholds[key] !== undefined
    );
    const missingKeys = FUNDS_HEALTH_THRESHOLD_KEYS.filter(
      (key) => !configuredKeys.includes(key)
    );

    return {
      mode:
        configuredKeys.length === 0
          ? 'unbounded'
          : configuredKeys.length === FUNDS_HEALTH_THRESHOLD_KEYS.length
            ? 'bounded'
            : 'partial',
      configuredThresholdCount: configuredKeys.length,
      requiredThresholdCount: FUNDS_HEALTH_THRESHOLD_KEYS.length,
      configuredKeys: [...configuredKeys],
      missingKeys: [...missingKeys],
    };
  }

  private readRetentionDays(config: FundsSchedulerConfigLike): number {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const retentionDays = Number(configMap.retentionDays);
    if (Number.isInteger(retentionDays) && retentionDays > 0) {
      return retentionDays;
    }
    return 30;
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
      symbol: 'FUNDS',
      message: mergedMessage,
      route: 'Schedulers',
      status: 'Open',
      source: SCHEDULER_KEY,
    });
  }
}
