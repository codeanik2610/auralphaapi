import { randomUUID } from 'node:crypto';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SchedulerAssetUpdateLogItem,
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerRiskDiagnosticsBlockerItem,
  SchedulerRiskDiagnosticsSummaryResponse,
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
  toSchedulerAuditContract,
} from '../utils/schedulerAuditContract';
import {
  buildSchedulerTimeContract,
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../utils/schedulerTimeContract';
import { BadRequestAppError, ServiceUnavailableAppError } from '../errors/AppError';
import {
  BrokerAccountRepository,
  ExchangeAssetUpdateLogRepository,
  FundsSnapshotRepository,
  PositionSnapshotRepository,
  RiskAlertRepository,
  RiskControlRepository,
  RiskRepository,
  RiskScenarioRepository,
  SchedulerCommandRepository,
  SchedulerConfig,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  SchedulerUserConfig,
  SchedulerUserConfigRepository,
  ActivityRepository,
  AlertRepository,
} from '../../database';
import { env } from '../../env';
import { UserTimeZoneService } from './UserTimeZoneService';

const SCHEDULER_KEY = 'risk-recompute-sync';
const RISK_SCHEDULER_OWNERSHIP = 'user' as const;
const RISK_SCHEDULER_NAME = 'Risk Snapshot Refresh';
const RISK_SCHEDULER_DESCRIPTION =
  'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.';
const RISK_STALE_DRIFT_TOLERANCE_MS = 5 * 60 * 1000;
const RISK_BLOCKER_LABELS: Record<SchedulerRiskDiagnosticsBlockerItem['blocker'], string> = {
  missing_snapshot: 'Missing risk snapshot',
  missing_funds_snapshot: 'Missing funds snapshot coverage',
  missing_positions_snapshot: 'Missing positions snapshot coverage',
  stale_snapshot: 'Risk snapshot is behind source snapshots',
};

interface RiskSchedulerTargetAccount {
  id: string;
  brokerKey: string;
}

interface RiskSchedulerTargetUser {
  userId: string;
  accounts: RiskSchedulerTargetAccount[];
}

interface RiskSchedulerTargetUserCoverage {
  userId: string;
  blockers: Set<SchedulerRiskDiagnosticsBlockerItem['blocker']>;
  latestSnapshotAt: Date | null;
  hasFreshSnapshot: boolean;
}

type RiskSchedulerUserConfigRecord = SchedulerUserConfig;
type RiskSchedulerConfigLike = {
  config?: Record<string, unknown> | null;
};

@Service()
export class RiskSchedulerService {
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

  @Inject(() => FundsSnapshotRepository)
  private fundsSnapshotRepository!: FundsSnapshotRepository;

  @Inject(() => PositionSnapshotRepository)
  private positionSnapshotRepository!: PositionSnapshotRepository;

  @Inject(() => RiskRepository)
  private riskRepository!: RiskRepository;

  @Inject(() => RiskControlRepository)
  private riskControlRepository!: RiskControlRepository;

  @Inject(() => RiskAlertRepository)
  private riskAlertRepository!: RiskAlertRepository;

  @Inject(() => RiskScenarioRepository)
  private riskScenarioRepository!: RiskScenarioRepository;

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
        String(payload.schedulerType || '').trim().toLowerCase() !== RISK_SCHEDULER_OWNERSHIP
      ) {
        throw new BadRequestAppError(
          'Risk Snapshot Refresh is a user scheduler and cannot be switched to global scope.'
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
          schedulerType: RISK_SCHEDULER_OWNERSHIP,
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
        'Risk scheduler config updated',
        'Success',
        `Updated scheduler config for ${SCHEDULER_KEY}`
      );
      return successResponse(this.mapConfig(config, timeZone));
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Risk scheduler config update failed',
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
      const manualAudit = this.buildManualAudit(actorUserId);
      const config = await this.ensureSchedulerConfig(actorUserId, timeZone);
      if (!config.enabled) {
        throw new BadRequestAppError('Risk scheduler is paused. Resume it before running now.');
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
          message: 'Risk scheduler run already queued',
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
          message: 'Risk scheduler run already in progress',
        });
      }
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
          trigger: 'manual',
          requestedAt: this.formatDate(new Date()),
          actorUserId,
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
          requestedAt: this.formatDate(new Date()),
          actorUserId,
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
        'Risk scheduler run queued',
        'Success',
        `Queued run_now for ${SCHEDULER_KEY} as command ${command.id}`
      );

      return successResponse({
        queued: true,
        executionMode: 'queue',
        started: false,
        runId,
        jobId: command.id,
        message: 'Risk scheduler command queued',
      });
    } catch (error) {
      await this.logSchedulerActivity(
        actorUserId,
        'Risk scheduler run queue failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitSchedulerFailureAlert(
        actorUserId,
        'Risk scheduler run queue failed',
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
    await this.logSchedulerActivity(actorUserId, 'Risk scheduler paused', 'Success', `Paused ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'pause',
      message: 'Risk scheduler paused',
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
    await this.logSchedulerActivity(actorUserId, 'Risk scheduler resumed', 'Success', `Resumed ${SCHEDULER_KEY}`);
    return successResponse({
      queued: false,
      action: 'resume',
      message: 'Risk scheduler resumed',
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
      'Risk scheduler stop requested',
      'Success',
      `Stop request handled for ${SCHEDULER_KEY}. activeStop=${running ? 'queued' : 'not-required'}, pendingRunsCancelled=${cancelledPendingRuns}`
    );
    return successResponse({
      queued: Boolean(stopCommandId),
      action: 'stop',
      state: stopCommandId ? 'queued' : cancelledPendingRuns > 0 ? 'applied' : 'noop',
      message:
        running || cancelledPendingRuns > 0
          ? 'Risk scheduler stop requested'
          : 'No active or queued risk scheduler run to stop',
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
      throw new BadRequestAppError('Risk scheduler is paused. Resume it before restarting.');
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
      'Risk scheduler restart queued',
      'Success',
      running
        ? `Queued stop ${stopCommandId} and run ${runCommand.id} for ${SCHEDULER_KEY}`
        : `Queued run ${runCommand.id} for ${SCHEDULER_KEY}`
    );
    return successResponse({
      queued: true,
      action: 'restart',
      state: 'queued',
      message: 'Risk scheduler restart queued',
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
      'Risk scheduler logs purged',
      'Success',
      `Purged ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs for ${SCHEDULER_KEY}`
    );
    return successResponse({
      message: `Risk scheduler logs purged. Deleted ${runLogsDeleted} run logs and ${updateLogsDeleted} update logs.`,
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
  ): Promise<ApiSuccessResponse<SchedulerRiskDiagnosticsSummaryResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
    await this.ensureSchedulerConfig(actorUserId, timeZone);

    const targetUsers = await this.listRiskTargetUsers();
    const userIds = targetUsers.map((item) => item.userId);
    const latestRunResult = await this.schedulerRunLogRepository.listRunsBySchedulerKeyAndActor(
      SCHEDULER_KEY,
      actorUserId,
      1,
      0
    );
    let latestSnapshotsByUser = new Map<string, { createdAt: Date }>();
    let latestControlAt: Date | null = null;
    let latestAlertAt: Date | null = null;
    let latestScenarioAt: Date | null = null;
    let coverage: RiskSchedulerTargetUserCoverage[] = [];

    if (userIds.length > 0) {
      [latestSnapshotsByUser, latestControlAt, latestAlertAt, latestScenarioAt] =
        await Promise.all([
          this.riskRepository.listLatestSnapshotsForUsers(userIds),
          this.riskControlRepository.getLatestCreatedAtForUsers(userIds),
          this.riskAlertRepository.getLatestCreatedAtForUsers(userIds),
          this.riskScenarioRepository.getLatestCreatedAtForUsers(userIds),
        ]);

      coverage = await Promise.all(
        targetUsers.map((item) => this.buildTargetUserCoverage(item, latestSnapshotsByUser))
      );
    }

    const blockerCounts = new Map<SchedulerRiskDiagnosticsBlockerItem['blocker'], number>();
    let usersWithFreshSnapshot = 0;
    let usersMissingSnapshot = 0;

    coverage.forEach((item) => {
      if (item.hasFreshSnapshot) {
        usersWithFreshSnapshot += 1;
      }
      if (item.blockers.has('missing_snapshot')) {
        usersMissingSnapshot += 1;
      }
      item.blockers.forEach((blocker) => {
        blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
      });
    });

    const latestSnapshotAt = Array.from(latestSnapshotsByUser.values()).reduce<Date | null>(
      (current, item) => this.maxDate(current, item.createdAt),
      null
    );
    const nowMs = Date.now();
    const latestRun = latestRunResult.items[0] || null;
    const latestRunAudit = latestRun
      ? toSchedulerAuditContract(
          latestRun as unknown as Record<string, unknown>,
          this.parseMeta((latestRun as { meta?: unknown }).meta)
        )
      : {};
    const blockers = (Object.keys(RISK_BLOCKER_LABELS) as Array<
      SchedulerRiskDiagnosticsBlockerItem['blocker']
    >)
      .map((blocker) => ({
        blocker,
        label: RISK_BLOCKER_LABELS[blocker],
        count: blockerCounts.get(blocker) || 0,
      }))
      .filter((item) => item.count > 0);

    return successResponse({
      schedulerKey: SCHEDULER_KEY,
      usersTargeted: targetUsers.length,
      usersWithFreshSnapshot,
      usersMissingSnapshot,
      usersWithSourceBlockers: coverage.filter((item) => item.blockers.size > 0).length,
      latestSnapshotAt:
        this.formatDisplayDate(latestSnapshotAt, timeZone) || this.formatDate(latestSnapshotAt),
      latestSnapshotAtIso: formatSchedulerRawIso(latestSnapshotAt),
      latestSnapshotAgeMinutes:
        latestSnapshotAt && Number.isFinite(nowMs)
          ? Math.max(0, Math.round((nowMs - latestSnapshotAt.getTime()) / 60000))
          : undefined,
      latestControlAt:
        this.formatDisplayDate(latestControlAt, timeZone) || this.formatDate(latestControlAt),
      latestControlAtIso: formatSchedulerRawIso(latestControlAt),
      latestAlertAt:
        this.formatDisplayDate(latestAlertAt, timeZone) || this.formatDate(latestAlertAt),
      latestAlertAtIso: formatSchedulerRawIso(latestAlertAt),
      latestScenarioAt:
        this.formatDisplayDate(latestScenarioAt, timeZone) || this.formatDate(latestScenarioAt),
      latestScenarioAtIso: formatSchedulerRawIso(latestScenarioAt),
      latestRun: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            ...(latestRunAudit.initiatedBy
              ? { initiatedBy: latestRunAudit.initiatedBy }
              : {}),
            ...(latestRunAudit.executionContext
              ? { executionContext: latestRunAudit.executionContext }
              : {}),
            startedAt:
              this.formatDisplayDate(latestRun.startedAt, timeZone) ||
              this.formatDate(latestRun.startedAt),
            startedAtIso: formatSchedulerRawIso(latestRun.startedAt),
            finishedAt:
              this.formatDisplayDate(latestRun.finishedAt, timeZone) ||
              this.formatDate(latestRun.finishedAt),
            finishedAtIso: formatSchedulerRawIso(latestRun.finishedAt),
            targetedUsers: latestRun.processedAccounts,
            refreshedUsers: latestRun.insertedAssets,
            failedUsers: latestRun.skippedAssets,
          }
        : null,
      blockers,
      time: buildSchedulerTimeContract(timeZone),
    });
  }

  async listSchedulerRuns(
    actorUserId: string,
    query: { limit?: string; offset?: string }
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(actorUserId);
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
      throw new BadRequestAppError('Risk scheduler run not found');
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
      throw new BadRequestAppError('Risk scheduler run not found');
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
      fileName: `scheduler-run-${runId}-updates.csv`,
      rowCount: rows.length,
      csv,
    });
  }

  private async listRiskTargetUsers(): Promise<RiskSchedulerTargetUser[]> {
    const brokerAccounts = await this.brokerAccountRepository.getAllActiveBrokerAccounts();
    const groupedByUserId = new Map<string, RiskSchedulerTargetUser>();

    brokerAccounts.forEach((account) => {
      const userId = String(account.userId || '').trim();
      const accountId = String(account.id || '').trim();
      const brokerKey = String(account.brokerKey || '').trim().toLowerCase();
      if (!userId || !accountId || !brokerKey) {
        return;
      }

      const current = groupedByUserId.get(userId) || {
        userId,
        accounts: [],
      };

      if (!current.accounts.some((item) => item.id === accountId)) {
        current.accounts.push({ id: accountId, brokerKey });
      }

      groupedByUserId.set(userId, current);
    });

    return Array.from(groupedByUserId.values()).sort((left, right) =>
      left.userId.localeCompare(right.userId)
    );
  }

  private async buildTargetUserCoverage(
    targetUser: RiskSchedulerTargetUser,
    latestSnapshotsByUser: Map<string, { createdAt: Date }>
  ): Promise<RiskSchedulerTargetUserCoverage> {
    const accountIds = targetUser.accounts.map((item) => item.id);
    const [positionSummaryByAccount, fundsSnapshots] = await Promise.all([
      this.positionSnapshotRepository.getAccountOpenPositionSummary(targetUser.userId, accountIds),
      Promise.all(
        targetUser.accounts.map((account) =>
          this.fundsSnapshotRepository.getLatestSnapshot(targetUser.userId, account.brokerKey, account.id)
        )
      ),
    ]);

    let latestFundsObservedAt: Date | null = null;
    let latestPositionsObservedAt: Date | null = null;
    let missingFundsSnapshot = false;
    let missingPositionsSnapshot = false;

    targetUser.accounts.forEach((account, index) => {
      const fundsSnapshot = fundsSnapshots[index];
      const fundsObservedAt = this.extractFundsObservedAt(fundsSnapshot);
      if (fundsObservedAt) {
        latestFundsObservedAt = this.maxDate(latestFundsObservedAt, fundsObservedAt);
      } else {
        missingFundsSnapshot = true;
      }

      const positionSummary = positionSummaryByAccount.get(account.id);
      if (positionSummary?.hasSnapshotHistory && positionSummary.observedAt) {
        latestPositionsObservedAt = this.maxDate(latestPositionsObservedAt, positionSummary.observedAt);
      } else {
        missingPositionsSnapshot = true;
      }
    });

    const latestSnapshot = latestSnapshotsByUser.get(targetUser.userId)?.createdAt || null;
    const freshestSourceAt = this.maxDate(latestFundsObservedAt, latestPositionsObservedAt);
    const blockers = new Set<SchedulerRiskDiagnosticsBlockerItem['blocker']>();

    if (!latestSnapshot) {
      blockers.add('missing_snapshot');
    }
    if (missingFundsSnapshot) {
      blockers.add('missing_funds_snapshot');
    }
    if (missingPositionsSnapshot) {
      blockers.add('missing_positions_snapshot');
    }
    if (
      latestSnapshot &&
      freshestSourceAt &&
      latestSnapshot.getTime() + RISK_STALE_DRIFT_TOLERANCE_MS < freshestSourceAt.getTime()
    ) {
      blockers.add('stale_snapshot');
    }

    return {
      userId: targetUser.userId,
      blockers,
      latestSnapshotAt: latestSnapshot,
      hasFreshSnapshot: Boolean(latestSnapshot) && blockers.size === 0,
    };
  }

  private normalizePersistedConfigMap(value: unknown): Record<string, unknown> {
    const configMap =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['risk'];
    configMap.sources = sources.length ? Array.from(new Set(sources)) : ['risk'];

    const retentionDays = Number(configMap.retentionDays);
    configMap.retentionDays =
      Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 30;

    return configMap;
  }

  private async ensureLegacySchedulerAnchor(): Promise<SchedulerConfig> {
    const normalizedTimeZone = normalizeTimeZone(
      DEFAULT_SCHEDULER_TIMEZONE,
      DEFAULT_SCHEDULER_TIMEZONE
    );
    let config = await this.schedulerConfigRepository.createIfMissing({
      key: SCHEDULER_KEY,
      name: RISK_SCHEDULER_NAME,
      description: RISK_SCHEDULER_DESCRIPTION,
      enabled: false,
      cronExpression: '0 1 * * *',
      timezone: normalizedTimeZone,
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 200,
      schedulerType: RISK_SCHEDULER_OWNERSHIP,
      config: {
        sources: ['risk'],
        retentionDays: 30,
      },
    });

    const patch: Partial<SchedulerConfig> = {};
    const normalizedPersistedConfig = this.normalizePersistedConfigMap(config.config);

    if (config.schedulerType !== RISK_SCHEDULER_OWNERSHIP) {
      patch.schedulerType = RISK_SCHEDULER_OWNERSHIP;
    }
    if (String(config.name || '').trim() !== RISK_SCHEDULER_NAME) {
      patch.name = RISK_SCHEDULER_NAME;
    }
    if (String(config.description || '').trim() !== RISK_SCHEDULER_DESCRIPTION) {
      patch.description = RISK_SCHEDULER_DESCRIPTION;
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
      schedulerType: RISK_SCHEDULER_OWNERSHIP,
      config: this.normalizePersistedConfigMap(anchor.config),
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      lastError: null,
      runningLockUntil: null,
    });

    const patch: Partial<SchedulerUserConfig> = {};
    if (config.schedulerType !== RISK_SCHEDULER_OWNERSHIP) {
      patch.schedulerType = RISK_SCHEDULER_OWNERSHIP;
    }
    if (!String(config.timezone || '').trim()) {
      patch.timezone = normalizedTimeZone;
    }
    if (String(config.name || '').trim() !== anchor.name) {
      patch.name = anchor.name;
    }
    if (String(config.description || '').trim() !== String(anchor.description || '').trim()) {
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
    config: RiskSchedulerUserConfigRecord,
    timeZone: string
  ): SchedulerConfigResponse {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const sources = Array.isArray(configMap.sources)
      ? configMap.sources.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : ['risk'];
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

    return {
      key: config.schedulerKey,
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
      schedulerType: RISK_SCHEDULER_OWNERSHIP,
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

  private extractFundsObservedAt(
    snapshot: {
      observed_at?: Date | string | null;
      computed_at?: Date | string | null;
      created_at?: Date | string | null;
    } | null
  ): Date | null {
    const value = snapshot?.observed_at ?? snapshot?.computed_at ?? snapshot?.created_at ?? null;
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
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
    const currentItemRaw =
      progressRaw?.currentItem &&
      typeof progressRaw.currentItem === 'object' &&
      !Array.isArray(progressRaw.currentItem)
        ? (progressRaw.currentItem as Record<string, unknown>)
        : null;
    const currentItem = currentItemRaw
      ? {
          ...(String(currentItemRaw.symbol || '').trim()
            ? { symbol: String(currentItemRaw.symbol || '').trim() }
            : {}),
          ...(String(currentItemRaw.assetId || '').trim()
            ? { assetId: String(currentItemRaw.assetId || '').trim() }
            : {}),
          ...(String(currentItemRaw.id || '').trim()
            ? { id: String(currentItemRaw.id || '').trim() }
            : {}),
        }
      : undefined;
    if (!progressRaw) {
      return {};
    }
    return {
      progress: {
        total: this.readNumber(progressRaw.total),
        processed: this.readNumber(progressRaw.processed),
        percent: this.readNumber(progressRaw.percent),
        etaSeconds: this.readNumber(progressRaw.etaSeconds),
        currentItem: currentItem && Object.keys(currentItem).length ? currentItem : undefined,
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

  private readRetentionDays(config: RiskSchedulerConfigLike): number {
    const configMap = (config.config ?? {}) as Record<string, unknown>;
    const retentionDays = Number(configMap.retentionDays);
    if (Number.isInteger(retentionDays) && retentionDays > 0) {
      return retentionDays;
    }
    return 30;
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
