import { randomUUID } from 'node:crypto';
import { Inject, Service } from 'typedi';
import {
  ActivityExportRepository,
  EmailDeliveryRepository,
  SchedulerCommandRepository,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  SchedulerUserConfigRepository,
} from '../../database';
import { env } from '../../env';
import { RedisClient } from '../../lib/RedisClient';
import {
  RuntimeLoopSnapshot,
  RuntimeOverviewResponse,
  RuntimeRepairResult,
  RuntimeStaleItem,
  RuntimeStaleItemsResponse,
  RuntimeStatus,
} from '../contracts/Runtime';
import {
  BadRequestAppError,
  NotFoundAppError,
} from '../errors/AppError';
import {
  buildRuntimeSchedulerAudit,
} from '../utils/schedulerAuditContract';
import { buildSignedSchedulerHeaders } from '../utils/schedulerRequestAuth';
import { ActivityExportProcessorService } from './ActivityExportProcessorService';
import { ActivityMaintenanceService } from './ActivityMaintenanceService';
import { AutomationsService } from './AutomationsService';
import { OperationalEventService } from './OperationalEventService';
import { PaperOrdersSchedulerService } from './PaperOrdersSchedulerService';
import { SuggestedTradeExecutionSyncService } from './SuggestedTradeExecutionSyncService';

type WorkerHealthSummary = RuntimeOverviewResponse['worker'];
type EmailWorkerHealthSummary = RuntimeOverviewResponse['emailWorker'];
type DiscoveryRuntimeSummary = RuntimeOverviewResponse['discovery'];

type DiscoveryRuntimePayload = {
  worker_id?: string;
  lifecycle_state?: string;
  stale_threshold_seconds?: number;
  stale_bots?: Array<Record<string, unknown>>;
  stale_discovery_runs?: Array<Record<string, unknown>>;
  stale_template_improvement_runs?: Array<Record<string, unknown>>;
};

@Service()
export class RuntimeDiagnosticsService {
  private static readonly WORKER_STALE_COMMAND_THRESHOLD_MS = 15 * 60 * 1000;
  private static readonly WORKER_STALE_RUN_THRESHOLD_MS = 15 * 60 * 1000;

  @Inject(() => SchedulerCommandRepository)
  private schedulerCommandRepository!: SchedulerCommandRepository;

  @Inject(() => SchedulerRunLogRepository)
  private schedulerRunLogRepository!: SchedulerRunLogRepository;

  @Inject(() => SchedulerConfigRepository)
  private schedulerConfigRepository!: SchedulerConfigRepository;

  @Inject(() => SchedulerUserConfigRepository)
  private schedulerUserConfigRepository!: SchedulerUserConfigRepository;

  @Inject(() => ActivityExportRepository)
  private activityExportRepository!: ActivityExportRepository;

  @Inject(() => EmailDeliveryRepository)
  private emailDeliveryRepository!: EmailDeliveryRepository;

  @Inject(() => ActivityExportProcessorService)
  private activityExportProcessorService!: ActivityExportProcessorService;

  @Inject(() => ActivityMaintenanceService)
  private activityMaintenanceService!: ActivityMaintenanceService;

  @Inject(() => PaperOrdersSchedulerService)
  private paperOrdersSchedulerService!: PaperOrdersSchedulerService;

  @Inject(() => SuggestedTradeExecutionSyncService)
  private suggestedTradeExecutionSyncService!: SuggestedTradeExecutionSyncService;

  @Inject(() => AutomationsService)
  private automationsService!: AutomationsService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getWorkerHealth(): Promise<WorkerHealthSummary> {
    const heartbeatKey = env.redis.workerHeartbeatKey;
    const workerEndpoint = env.scheduler.worker.baseUrl;
    const workerHttpHealth = await this.readWorkerHttpHealth(workerEndpoint);

    try {
      const rawHeartbeat = await RedisClient.getConnection().get(heartbeatKey);
      if (!rawHeartbeat) {
        return {
          status: 'down',
          endpoint: workerEndpoint,
          heartbeatStatus: 'down',
          httpStatus: workerHttpHealth.status,
          detail:
            workerHttpHealth.status === 'down'
              ? `No active worker heartbeat found; worker health check failed: ${workerHttpHealth.detail || 'unknown error'}`
              : 'No active worker heartbeat found.',
        };
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawHeartbeat) as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      const lastHeartbeatAt = this.readIsoString(parsed.timestamp);
      const lastCommandPollAt = this.readIsoString(parsed.lastCommandPollAt);
      const heartbeatAgeMs = this.computeAgeMs(lastHeartbeatAt);
      const commandPollLagMs = this.computeAgeMs(lastCommandPollAt);

      return {
        status: workerHttpHealth.status === 'ok' ? 'ok' : 'down',
        endpoint: workerEndpoint,
        heartbeatStatus: 'ok',
        httpStatus: workerHttpHealth.status,
        workerId: this.readString(parsed.workerId),
        lastHeartbeatAt,
        heartbeatAgeMs,
        lastCommandPollAt,
        commandPollLagMs,
        activeCommandCount: this.readNumber(parsed.activeCommandCount),
        activeScopeCount: this.readNumber(parsed.activeScopeCount),
        detail:
          workerHttpHealth.status === 'down'
            ? `Worker heartbeat is present but HTTP health failed: ${workerHttpHealth.detail || 'unknown error'}`
            : null,
      };
    } catch (error) {
      return {
        status: 'down',
        endpoint: workerEndpoint,
        heartbeatStatus: 'down',
        httpStatus: workerHttpHealth.status,
        detail:
          error instanceof Error
            ? `Redis heartbeat read failed: ${error.message}`
            : `Redis heartbeat read failed: ${String(error)}`,
      };
    }
  }

  async getEmailWorkerHealth(): Promise<EmailWorkerHealthSummary> {
    const heartbeatKey = env.redis.emailWorkerHeartbeatKey;
    const smtpConfigured = Boolean(env.email.smtp.host && env.email.smtp.from);
    const queueMetrics = await this.readEmailQueueMetrics();

    if (!env.email.enabled) {
      return {
        status: 'disabled',
        enabled: false,
        smtpConfigured,
        ...queueMetrics,
        detail: 'Email delivery is disabled in environment configuration.',
      };
    }

    try {
      const rawHeartbeat = await RedisClient.getConnection().get(heartbeatKey);
      if (!rawHeartbeat) {
        return {
          status: 'down',
          enabled: true,
          smtpConfigured,
          ...queueMetrics,
          detail: 'No active email worker heartbeat found.',
        };
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawHeartbeat) as Record<string, unknown>;
      } catch {
        parsed = {};
      }

      const lastHeartbeatAt = this.readIsoString(parsed.timestamp);
      const heartbeatAgeMs = this.computeAgeMs(lastHeartbeatAt);
      const pollIntervalMs = this.readNumber(parsed.pollIntervalMs) ?? env.email.pollIntervalMs;
      const staleThresholdMs = Math.max(30_000, pollIntervalMs * 3);
      const isStale = typeof heartbeatAgeMs === 'number' ? heartbeatAgeMs > staleThresholdMs : false;
      const workerStatus = this.readString(parsed.status) || 'idle';

      return {
        status: workerStatus === 'degraded' || isStale ? 'degraded' : 'ok',
        enabled: true,
        smtpConfigured,
        ...queueMetrics,
        workerId: this.readString(parsed.workerId),
        workerStatus,
        lastHeartbeatAt,
        heartbeatAgeMs,
        detail:
          workerStatus === 'degraded'
            ? this.readString(parsed.lastError) || 'Email worker is alive, but the latest batch recorded failures.'
            : isStale
              ? 'Email worker heartbeat is older than the expected polling window.'
              : null,
      };
    } catch (error) {
      return {
        status: 'down',
        enabled: true,
        smtpConfigured,
        ...queueMetrics,
        detail:
          error instanceof Error
            ? `Redis heartbeat read failed: ${error.message}`
            : `Redis heartbeat read failed: ${String(error)}`,
      };
    }
  }

  async getRuntimeOverview(previewLimit = 10): Promise<RuntimeOverviewResponse> {
    const [worker, emailWorker, automations, stale, discovery] = await Promise.all([
      this.getWorkerHealth(),
      this.getEmailWorkerHealth(),
      this.automationsService.getAutomationOperationalSnapshot(),
      this.collectStaleItems(Math.max(25, previewLimit * 5), true),
      this.getDiscoveryRuntimeSummary(),
    ]);

    const apiLoops = this.getApiLoopSnapshots();
    const staleCounts = {
      total: stale.length,
      schedulerCommands: stale.filter((item) => item.type === 'scheduler-command').length,
      schedulerRuns: stale.filter((item) => item.type === 'scheduler-run').length,
      schedulerLocks: stale.filter((item) => item.type === 'scheduler-lock').length,
      automationRuns: stale.filter((item) => item.type === 'automation-run').length,
      activityExports: stale.filter((item) => item.type === 'activity-export').length,
      discoveryItems: stale.filter((item) => item.source === 'discovery-engine').length,
    };

    const automationStatus: RuntimeStatus =
      automations.healthStatus === 'down'
        ? 'down'
        : automations.healthStatus === 'degraded'
          ? 'degraded'
          : 'ok';

    const overallStatus: RuntimeStatus =
      worker.status === 'down' || emailWorker.status === 'down' || discovery.status === 'down'
        ? 'down'
        : staleCounts.total > 0 ||
            automationStatus === 'degraded' ||
            apiLoops.some((loop) => loop.state === 'draining' || Boolean(loop.lastError))
          ? 'degraded'
          : 'ok';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      staleCounts,
      worker,
      emailWorker,
      discovery,
      automations: {
        status: automationStatus,
        total: automations.total,
        running: automations.running,
        paused: automations.paused,
        failed: automations.failed,
        draft: automations.draft,
        activeRuns: automations.summary.activeRuns,
        failedRuns24h: automations.summary.failedRuns24h,
        overlapSkips24h: automations.summary.overlapSkips24h,
        staleCursorCount: automations.summary.staleCursorCount,
        totalCursorCount: automations.summary.totalCursorCount,
        workerStatus: automations.summary.workerStatus,
        heartbeatStatus: automations.summary.heartbeatStatus,
        workerHeartbeatAgeMs: automations.summary.workerHeartbeatAgeMs ?? null,
        detail: automations.detail,
      },
      apiLoops,
      stalePreview: stale.slice(0, Math.max(1, previewLimit)),
    };
  }

  async listStaleItems(limit = 100): Promise<RuntimeStaleItemsResponse> {
    const items = await this.collectStaleItems(limit, true);
    return {
      timestamp: new Date().toISOString(),
      total: items.length,
      items,
    };
  }

  async repairSchedulerCommand(
    commandId: string,
    options: {
      actorUserId?: string | null;
      status?: 'Failed' | 'Cancelled';
      reason?: string | null;
    } = {}
  ): Promise<RuntimeRepairResult> {
    const normalizedCommandId = String(commandId || '').trim();
    if (!normalizedCommandId) {
      throw new BadRequestAppError('commandId is required');
    }

    const command = await this.schedulerCommandRepository.findById(normalizedCommandId);
    if (!command) {
      throw new NotFoundAppError('Scheduler command not found');
    }

    const nextStatus = options.status || 'Failed';
    if (nextStatus !== 'Failed' && nextStatus !== 'Cancelled') {
      throw new BadRequestAppError('Scheduler commands can only be repaired to Failed or Cancelled');
    }

    const actorUserId = String(options.actorUserId || env.scheduler.systemUserId).trim();
    const repairedAt = new Date();
    const reason =
      String(options.reason || '').trim() ||
      `Runtime diagnostics repaired stale scheduler command on ${repairedAt.toISOString()}`;

    const linkedRun = await this.schedulerRunLogRepository.findLatestActiveByCommandId(command.id);
    if (linkedRun) {
      await this.schedulerRunLogRepository.markRunRepaired(linkedRun.id, {
        status: nextStatus,
        reason,
        workerId: null,
        finishedAt: repairedAt,
        repairedAt,
      });
      await this.syncSchedulerConfigRepairState(
        linkedRun.schedulerKey,
        linkedRun.actorUserId,
        nextStatus,
        reason,
        repairedAt
      );
    }

    const repaired = await this.schedulerCommandRepository.markCommandRepaired(command.id, {
      status: nextStatus,
      reason,
      processedAt: repairedAt,
      repairedAt,
      workerId: null,
    });
    await this.syncSchedulerConfigRepairState(
      command.schedulerKey,
      command.actorUserId,
      nextStatus,
      reason,
      repairedAt
    );
    await this.logSchedulerRepairActivity(
      command.schedulerKey,
      command.actorUserId,
      actorUserId,
      `Runtime diagnostics repaired scheduler command ${command.id}`,
      reason
    );

    return {
      repaired: Boolean(repaired),
      itemType: 'scheduler-command',
      id: command.id,
      status: repaired?.status || nextStatus,
      message: repaired
        ? 'Scheduler command repaired successfully.'
        : 'Scheduler command repair did not update the record.',
    };
  }

  async repairSchedulerRun(
    runId: string,
    options: {
      actorUserId?: string | null;
      status?: 'Failed' | 'Cancelled';
      reason?: string | null;
    } = {}
  ): Promise<RuntimeRepairResult> {
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      throw new BadRequestAppError('runId is required');
    }

    const run = await this.schedulerRunLogRepository.findById(normalizedRunId);
    if (!run) {
      throw new NotFoundAppError('Scheduler run not found');
    }

    const nextStatus = options.status || 'Failed';
    if (nextStatus !== 'Failed' && nextStatus !== 'Cancelled') {
      throw new BadRequestAppError('Scheduler runs can only be repaired to Failed or Cancelled');
    }

    const actorUserId = String(options.actorUserId || env.scheduler.systemUserId).trim();
    const repairedAt = new Date();
    const reason =
      String(options.reason || '').trim() ||
      `Runtime diagnostics repaired stale scheduler run on ${repairedAt.toISOString()}`;

    const repaired = await this.schedulerRunLogRepository.markRunRepaired(run.id, {
      status: nextStatus,
      reason,
      workerId: null,
      finishedAt: repairedAt,
      repairedAt,
    });

    if (run.commandId) {
      await this.schedulerCommandRepository.markCommandRepaired(run.commandId, {
        status: nextStatus,
        reason,
        processedAt: repairedAt,
        repairedAt,
        workerId: null,
      });
    }

    await this.syncSchedulerConfigRepairState(
      run.schedulerKey,
      run.actorUserId,
      nextStatus,
      reason,
      repairedAt
    );
    await this.logSchedulerRepairActivity(
      run.schedulerKey,
      run.actorUserId,
      actorUserId,
      `Runtime diagnostics repaired scheduler run ${run.id}`,
      reason
    );

    return {
      repaired: Boolean(repaired),
      itemType: 'scheduler-run',
      id: run.id,
      status: repaired?.status || nextStatus,
      message: repaired
        ? 'Scheduler run repaired successfully.'
        : 'Scheduler run repair did not update the record.',
    };
  }

  async repairAutomationRun(
    runId: string,
    options: {
      actorUserId?: string | null;
      reason?: string | null;
    } = {}
  ): Promise<RuntimeRepairResult> {
    return this.automationsService.repairRuntimeRun(runId, options);
  }

  async repairActivityExport(
    exportId: string,
    options: {
      actorUserId?: string | null;
      status?: 'Queued' | 'Failed';
      reason?: string | null;
    } = {}
  ): Promise<RuntimeRepairResult> {
    const normalizedExportId = String(exportId || '').trim();
    if (!normalizedExportId) {
      throw new BadRequestAppError('exportId is required');
    }

    const activityExport = await this.activityExportRepository.getExportByIdAny(normalizedExportId);
    if (!activityExport) {
      throw new NotFoundAppError('Activity export not found');
    }

    const nextStatus = options.status || 'Queued';
    if (nextStatus !== 'Queued' && nextStatus !== 'Failed') {
      throw new BadRequestAppError('Activity exports can only be repaired to Queued or Failed');
    }

    const repairedAt = new Date();
    const reason =
      String(options.reason || '').trim() ||
      `Runtime diagnostics repaired stale activity export on ${repairedAt.toISOString()}`;
    const repaired = await this.activityExportRepository.markExportRepaired(activityExport.id, {
      status: nextStatus,
      reason,
      repairedAt,
    });

    await this.operationalEventService.logActivity(activityExport.userId, {
      type: 'Activity Export',
      title: `Runtime repair updated export: ${activityExport.fileName}`,
      status: 'Success',
      route: 'Activity',
      stream: 'Recovery',
      related: activityExport.scope,
      referenceId: activityExport.id,
      correlationId: activityExport.id,
      description: reason,
    });

    return {
      repaired: Boolean(repaired),
      itemType: 'activity-export',
      id: activityExport.id,
      status: repaired?.status || nextStatus,
      message: repaired
        ? 'Activity export repaired successfully.'
        : 'Activity export repair did not update the record.',
    };
  }

  async requeueScheduler(
    schedulerKey: string,
    options: {
      actorUserId?: string | null;
      schedulerUserId?: string | null;
    } = {}
  ): Promise<RuntimeRepairResult> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    if (!normalizedSchedulerKey) {
      throw new BadRequestAppError('schedulerKey is required');
    }

    if (normalizedSchedulerKey === 'paper-orders-execution') {
      await this.paperOrdersSchedulerService.runBatchOnce();
      return {
        repaired: true,
        itemType: 'scheduler-requeue',
        id: normalizedSchedulerKey,
        status: 'Started',
        message: 'Paper order execution loop ran once successfully.',
      };
    }

    if (normalizedSchedulerKey === 'suggested-trades-execution-sync') {
      await this.suggestedTradeExecutionSyncService.runBatchOnce();
      return {
        repaired: true,
        itemType: 'scheduler-requeue',
        id: normalizedSchedulerKey,
        status: 'Started',
        message: 'Suggested trade execution sync ran once successfully.',
      };
    }

    const targetUserId = String(options.schedulerUserId || '').trim() || null;
    const actorUserId = String(options.actorUserId || env.scheduler.systemUserId).trim();
    const audit = buildRuntimeSchedulerAudit({
      actorUserId,
      executionContext: targetUserId ? 'user' : 'system',
    });
    const requestedAt = new Date();
    const runId = randomUUID();

    if (targetUserId) {
      const config = await this.schedulerUserConfigRepository.getBySchedulerKeyAndUserId(
        normalizedSchedulerKey,
        targetUserId
      );
      if (!config) {
        throw new NotFoundAppError('Scheduler user configuration not found');
      }
      if (!config.enabled) {
        throw new BadRequestAppError('Scheduler is paused. Resume it before requeueing a run.');
      }

      const existingCommand =
        await this.schedulerCommandRepository.findLatestBySchedulerKeyAndTypeAndActorInStatuses(
          normalizedSchedulerKey,
          'run_now',
          targetUserId,
          ['Pending', 'Processing']
        );
      if (existingCommand) {
        return {
          repaired: false,
          itemType: 'scheduler-requeue',
          id: normalizedSchedulerKey,
          status: 'Pending',
          message: 'A scheduler command is already queued for this user scope.',
        };
      }

      const running = await this.schedulerRunLogRepository.hasRunningRunBySchedulerKeyAndActor(
        normalizedSchedulerKey,
        targetUserId
      );
      if (running) {
        return {
          repaired: false,
          itemType: 'scheduler-requeue',
          id: normalizedSchedulerKey,
          status: 'Running',
          message: 'A scheduler run is already active for this user scope.',
        };
      }

      await this.schedulerRunLogRepository.createRun({
        id: runId,
        schedulerKey: normalizedSchedulerKey,
        actorUserId: targetUserId,
        status: 'Queued',
        initiatedByType: audit.initiatedByType,
        initiatedByUserId: audit.initiatedByUserId ?? null,
        initiatedByLabel: audit.initiatedByLabel ?? null,
        executionContext: audit.executionContext,
        startedAt: requestedAt,
        finishedAt: null,
        durationMs: null,
        processedAccounts: 0,
        insertedAssets: 0,
        updatedAssets: 0,
        skippedAssets: 0,
        errorMessage: null,
        meta: {
          trigger: 'manual',
          actorUserId: targetUserId,
          requestedByUserId: actorUserId,
          requestedAt: requestedAt.toISOString(),
          initiatedByType: audit.initiatedByType,
          initiatedByUserId: audit.initiatedByUserId,
          initiatedByLabel: audit.initiatedByLabel,
          executionContext: audit.executionContext,
          progress: {
            total: 0,
            processed: 0,
            percent: 0,
          },
        },
      });
      await this.schedulerCommandRepository.createCommand({
        schedulerKey: normalizedSchedulerKey,
        commandType: 'run_now',
        actorUserId: targetUserId,
        initiatedByType: audit.initiatedByType,
        initiatedByUserId: audit.initiatedByUserId ?? null,
        initiatedByLabel: audit.initiatedByLabel ?? null,
        executionContext: audit.executionContext,
        payload: {
          runId,
          trigger: 'manual',
          actorUserId: targetUserId,
          requestedByUserId: actorUserId,
          requestedAt: requestedAt.toISOString(),
          initiatedByType: audit.initiatedByType,
          initiatedByUserId: audit.initiatedByUserId,
          initiatedByLabel: audit.initiatedByLabel,
          executionContext: audit.executionContext,
        },
        status: 'Pending',
        processedAt: null,
        errorMessage: null,
      });

      await this.logSchedulerRepairActivity(
        normalizedSchedulerKey,
        targetUserId,
        actorUserId,
        `Runtime diagnostics requeued scheduler ${normalizedSchedulerKey}`,
        `Queued a fresh run for user scope ${targetUserId}.`
      );

      return {
        repaired: true,
        itemType: 'scheduler-requeue',
        id: normalizedSchedulerKey,
        status: 'Pending',
        message: 'Scheduler run queued successfully for the requested user scope.',
      };
    }

    const config = await this.schedulerConfigRepository.getByKey(normalizedSchedulerKey);
    if (!config) {
      throw new NotFoundAppError('Scheduler configuration not found');
    }
    if (!config.enabled) {
      throw new BadRequestAppError('Scheduler is paused. Resume it before requeueing a run.');
    }

    const existingCommand =
      await this.schedulerCommandRepository.findLatestBySchedulerKeyAndTypeInStatuses(
        normalizedSchedulerKey,
        'run_now',
        ['Pending', 'Processing']
      );
    if (existingCommand) {
      return {
        repaired: false,
        itemType: 'scheduler-requeue',
        id: normalizedSchedulerKey,
        status: 'Pending',
        message: 'A scheduler command is already queued.',
      };
    }

    const running = await this.schedulerRunLogRepository.hasRunningRun(normalizedSchedulerKey);
    if (running) {
      return {
        repaired: false,
        itemType: 'scheduler-requeue',
        id: normalizedSchedulerKey,
        status: 'Running',
        message: 'A scheduler run is already active.',
      };
    }

    await this.schedulerRunLogRepository.createRun({
      id: runId,
      schedulerKey: normalizedSchedulerKey,
      status: 'Queued',
      initiatedByType: audit.initiatedByType,
      initiatedByUserId: audit.initiatedByUserId ?? null,
      initiatedByLabel: audit.initiatedByLabel ?? null,
      executionContext: audit.executionContext,
      startedAt: requestedAt,
      finishedAt: null,
      durationMs: null,
      processedAccounts: 0,
      insertedAssets: 0,
      updatedAssets: 0,
      skippedAssets: 0,
      errorMessage: null,
      meta: {
        trigger: 'manual',
        requestedAt: requestedAt.toISOString(),
        initiatedByType: audit.initiatedByType,
        initiatedByUserId: audit.initiatedByUserId,
        initiatedByLabel: audit.initiatedByLabel,
        executionContext: audit.executionContext,
        progress: {
          total: 0,
          processed: 0,
          percent: 0,
        },
      },
    });
    await this.schedulerCommandRepository.createCommand({
      schedulerKey: normalizedSchedulerKey,
      commandType: 'run_now',
      initiatedByType: audit.initiatedByType,
      initiatedByUserId: audit.initiatedByUserId ?? null,
      initiatedByLabel: audit.initiatedByLabel ?? null,
      executionContext: audit.executionContext,
      payload: {
        runId,
        trigger: 'manual',
        requestedAt: requestedAt.toISOString(),
        initiatedByType: audit.initiatedByType,
        initiatedByUserId: audit.initiatedByUserId,
        initiatedByLabel: audit.initiatedByLabel,
        executionContext: audit.executionContext,
      },
      status: 'Pending',
      processedAt: null,
      errorMessage: null,
    });

    await this.logSchedulerRepairActivity(
      normalizedSchedulerKey,
      null,
      actorUserId,
      `Runtime diagnostics requeued scheduler ${normalizedSchedulerKey}`,
      'Queued a fresh global scheduler run.'
    );

    return {
      repaired: true,
      itemType: 'scheduler-requeue',
      id: normalizedSchedulerKey,
      status: 'Pending',
      message: 'Scheduler run queued successfully.',
    };
  }

  async releaseSchedulerLock(
    schedulerKey: string,
    options: {
      actorUserId?: string | null;
      schedulerUserId?: string | null;
      reason?: string | null;
    } = {}
  ): Promise<RuntimeRepairResult> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    if (!normalizedSchedulerKey) {
      throw new BadRequestAppError('schedulerKey is required');
    }

    const actorUserId = String(options.actorUserId || env.scheduler.systemUserId).trim();
    const reason =
      String(options.reason || '').trim() ||
      `Runtime diagnostics released a stale scheduler lock on ${new Date().toISOString()}`;
    const now = new Date();
    const targetUserId = String(options.schedulerUserId || '').trim() || null;

    if (targetUserId) {
      const config = await this.schedulerUserConfigRepository.getBySchedulerKeyAndUserId(
        normalizedSchedulerKey,
        targetUserId
      );
      if (!config) {
        throw new NotFoundAppError('Scheduler user configuration not found');
      }
      if (!config.runningLockUntil) {
        return {
          repaired: false,
          itemType: 'scheduler-lock',
          id: `${normalizedSchedulerKey}:${targetUserId}`,
          status: 'Unlocked',
          message: 'No active lock is present for this user-scoped scheduler.',
        };
      }
      if (config.runningLockUntil.getTime() > now.getTime()) {
        return {
          repaired: false,
          itemType: 'scheduler-lock',
          id: `${normalizedSchedulerKey}:${targetUserId}`,
          status: 'Locked',
          message: 'Lock is still inside its live window and was not released.',
        };
      }

      await this.schedulerUserConfigRepository.releaseRunLock(normalizedSchedulerKey, targetUserId);
      await this.logSchedulerRepairActivity(
        normalizedSchedulerKey,
        targetUserId,
        actorUserId,
        `Runtime diagnostics released stale scheduler lock for ${normalizedSchedulerKey}`,
        reason
      );
      return {
        repaired: true,
        itemType: 'scheduler-lock',
        id: `${normalizedSchedulerKey}:${targetUserId}`,
        status: 'Unlocked',
        message: 'Released stale user-scoped scheduler lock.',
      };
    }

    const config = await this.schedulerConfigRepository.getByKey(normalizedSchedulerKey);
    if (!config) {
      throw new NotFoundAppError('Scheduler configuration not found');
    }
    if (!config.runningLockUntil) {
      return {
        repaired: false,
        itemType: 'scheduler-lock',
        id: normalizedSchedulerKey,
        status: 'Unlocked',
        message: 'No active lock is present for this scheduler.',
      };
    }
    if (config.runningLockUntil.getTime() > now.getTime()) {
      return {
        repaired: false,
        itemType: 'scheduler-lock',
        id: normalizedSchedulerKey,
        status: 'Locked',
        message: 'Lock is still inside its live window and was not released.',
      };
    }

    await this.schedulerConfigRepository.releaseRunLock(normalizedSchedulerKey);
    await this.logSchedulerRepairActivity(
      normalizedSchedulerKey,
      null,
      actorUserId,
      `Runtime diagnostics released stale scheduler lock for ${normalizedSchedulerKey}`,
      reason
    );
    return {
      repaired: true,
      itemType: 'scheduler-lock',
      id: normalizedSchedulerKey,
      status: 'Unlocked',
      message: 'Released stale scheduler lock.',
    };
  }

  private async collectStaleItems(
    limit: number,
    includeDiscovery: boolean
  ): Promise<RuntimeStaleItem[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const now = new Date();
    const [staleCommands, staleRuns, staleGlobalLocks, staleUserLocks, staleAutomations, staleExports] =
      await Promise.all([
        this.schedulerCommandRepository.findStaleCommands({
          olderThan: new Date(Date.now() - RuntimeDiagnosticsService.WORKER_STALE_COMMAND_THRESHOLD_MS),
          statuses: ['Processing'],
          limit: safeLimit,
        }),
        this.schedulerRunLogRepository.findStaleRuns({
          olderThan: new Date(Date.now() - RuntimeDiagnosticsService.WORKER_STALE_RUN_THRESHOLD_MS),
          statuses: ['Running'],
          limit: safeLimit,
        }),
        this.schedulerConfigRepository.listLockedBefore(now),
        this.schedulerUserConfigRepository.listLockedBefore(now),
        this.automationsService.getRuntimeStaleRunCandidates(safeLimit),
        this.activityExportRepository.findStaleProcessingExports({
          olderThan: new Date(
            Date.now() - Math.max(60_000, env.activity.exportProcessorIntervalMs * 4)
          ),
          statuses: ['Processing'],
          limit: safeLimit,
        }),
      ]);

    const items: RuntimeStaleItem[] = [];

    for (const command of staleCommands) {
      const claimedAt = command.claimedAt ?? command.updatedAt ?? command.createdAt;
      items.push({
        id: command.id,
        type: 'scheduler-command',
        source: 'auralpha',
        status: command.status,
        title: `Scheduler command stalled: ${command.schedulerKey}`,
        detail: command.errorMessage || 'Command stayed in Processing past the worker stale threshold.',
        schedulerKey: command.schedulerKey,
        actorUserId: command.actorUserId,
        workerId: command.workerId,
        startedAt: command.createdAt?.toISOString() ?? null,
        updatedAt: command.updatedAt?.toISOString() ?? null,
        ageMs: this.computeAgeFromDate(claimedAt),
        staleThresholdMs: RuntimeDiagnosticsService.WORKER_STALE_COMMAND_THRESHOLD_MS,
        repairable: true,
        repairAction: 'mark-command-terminal',
      });
    }

    for (const run of staleRuns) {
      const referenceTime = run.lastProgressAt ?? run.startedAt;
      items.push({
        id: run.id,
        type: 'scheduler-run',
        source: 'auralpha',
        status: run.status,
        title: `Scheduler run stalled: ${run.schedulerKey}`,
        detail: run.errorMessage || 'Run stayed in Running past the worker stale threshold.',
        schedulerKey: run.schedulerKey,
        actorUserId: run.actorUserId,
        workerId: run.workerId,
        startedAt: run.startedAt?.toISOString() ?? null,
        lastProgressAt: run.lastProgressAt?.toISOString() ?? null,
        ageMs: this.computeAgeFromDate(referenceTime),
        staleThresholdMs: RuntimeDiagnosticsService.WORKER_STALE_RUN_THRESHOLD_MS,
        repairable: true,
        repairAction: 'mark-run-terminal',
      });
    }

    for (const config of staleGlobalLocks) {
      items.push({
        id: config.key,
        type: 'scheduler-lock',
        source: 'auralpha',
        status: 'Locked',
        title: `Scheduler lock expired: ${config.key}`,
        detail: 'The global run lock is past its expiry time and can be released safely.',
        schedulerKey: config.key,
        updatedAt: config.runningLockUntil?.toISOString() ?? null,
        ageMs: this.computeAgeFromDate(config.runningLockUntil),
        repairable: true,
        repairAction: 'release-lock',
      });
    }

    for (const config of staleUserLocks) {
      items.push({
        id: `${config.schedulerKey}:${config.userId}`,
        type: 'scheduler-lock',
        source: 'auralpha',
        status: 'Locked',
        title: `Scheduler lock expired: ${config.schedulerKey}`,
        detail: 'The user-scoped run lock is past its expiry time and can be released safely.',
        schedulerKey: config.schedulerKey,
        userId: config.userId,
        updatedAt: config.runningLockUntil?.toISOString() ?? null,
        ageMs: this.computeAgeFromDate(config.runningLockUntil),
        repairable: true,
        repairAction: 'release-lock',
      });
    }

    items.push(...staleAutomations);

    const exportThresholdMs = Math.max(60_000, env.activity.exportProcessorIntervalMs * 4);
    for (const activityExport of staleExports) {
      const referenceTime = activityExport.processingStartedAt ?? activityExport.updatedAt;
      items.push({
        id: activityExport.id,
        type: 'activity-export',
        source: 'auralpha',
        status: activityExport.status,
        title: `Activity export stalled: ${activityExport.fileName}`,
        detail: activityExport.errorMessage || 'Export stayed in Processing past the processor stale threshold.',
        userId: activityExport.userId,
        workerId: activityExport.workerId,
        startedAt: activityExport.processingStartedAt?.toISOString() ?? null,
        updatedAt: activityExport.updatedAt?.toISOString() ?? null,
        ageMs: this.computeAgeFromDate(referenceTime),
        staleThresholdMs: exportThresholdMs,
        repairable: true,
        repairAction: 'reset-export',
      });
    }

    if (includeDiscovery) {
      const discovery = await this.fetchDiscoveryRuntimePayload();
      if (discovery?.payload) {
        const staleThresholdMs =
          Math.max(60, Number(discovery.payload.stale_threshold_seconds || 0)) * 1000;
        for (const bot of discovery.payload.stale_bots || []) {
          items.push(this.mapDiscoveryRuntimeItem(bot, 'discovery-bot', staleThresholdMs));
        }
        for (const run of discovery.payload.stale_discovery_runs || []) {
          items.push(this.mapDiscoveryRuntimeItem(run, 'discovery-run', staleThresholdMs));
        }
        for (const run of discovery.payload.stale_template_improvement_runs || []) {
          items.push(
            this.mapDiscoveryRuntimeItem(
              run,
              'discovery-template-improvement',
              staleThresholdMs
            )
          );
        }
      }
    }

    return items
      .sort((left, right) => (right.ageMs || 0) - (left.ageMs || 0))
      .slice(0, safeLimit);
  }

  private getApiLoopSnapshots(): RuntimeLoopSnapshot[] {
    return [
      this.activityExportProcessorService.getRuntimeSnapshot(),
      this.activityMaintenanceService.getRuntimeSnapshot(),
      this.paperOrdersSchedulerService.getRuntimeSnapshot(),
      this.suggestedTradeExecutionSyncService.getRuntimeSnapshot(),
    ];
  }

  private async getDiscoveryRuntimeSummary(): Promise<DiscoveryRuntimeSummary> {
    const result = await this.fetchDiscoveryRuntimePayload();
    if (!result.ok || !result.payload) {
      return {
        status: 'down',
        endpoint: `${String(env.discovery.apiBaseUrl).replace(/\/+$/, '')}/runs/scheduler/runtime-status`,
        detail: result.detail,
      };
    }

    const payload = result.payload;
    const staleBotCount = Array.isArray(payload.stale_bots) ? payload.stale_bots.length : 0;
    const staleRunCount = Array.isArray(payload.stale_discovery_runs)
      ? payload.stale_discovery_runs.length
      : 0;
    const staleTemplateImprovementCount = Array.isArray(
      payload.stale_template_improvement_runs
    )
      ? payload.stale_template_improvement_runs.length
      : 0;
    const totalStale =
      staleBotCount + staleRunCount + staleTemplateImprovementCount;

    return {
      status: totalStale > 0 ? 'degraded' : 'ok',
      endpoint: result.url,
      workerId: this.readString(payload.worker_id),
      lifecycleState: this.readString(payload.lifecycle_state),
      staleThresholdSeconds: this.readNumber(payload.stale_threshold_seconds),
      staleBotCount,
      staleRunCount,
      staleTemplateImprovementCount,
      detail:
        totalStale > 0
          ? `${totalStale} stale discovery runtime item${totalStale === 1 ? '' : 's'} reported by discovery-engine.`
          : null,
    };
  }

  private async fetchDiscoveryRuntimePayload(): Promise<{
    ok: boolean;
    url: string;
    payload?: DiscoveryRuntimePayload;
    detail?: string;
  }> {
    const url = `${String(env.discovery.apiBaseUrl).replace(/\/+$/, '')}/runs/scheduler/runtime-status`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildSignedSchedulerHeaders({
          method: 'GET',
          url,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          url,
          detail: `Discovery runtime endpoint HTTP ${response.status}`,
        };
      }

      const payload = (await response.json()) as DiscoveryRuntimePayload;
      return {
        ok: true,
        url,
        payload,
      };
    } catch (error) {
      return {
        ok: false,
        url,
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
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

  private async readEmailQueueMetrics(): Promise<
    Pick<
      EmailWorkerHealthSummary,
      'queuedCount' | 'sendingCount' | 'failedCount' | 'activeCount'
    >
  > {
    try {
      const snapshot = await this.emailDeliveryRepository.getOperationalSnapshot();
      return {
        queuedCount: snapshot.queued,
        sendingCount: snapshot.sending,
        failedCount: snapshot.failed,
        activeCount: snapshot.active,
      };
    } catch {
      return {};
    }
  }

  private async syncSchedulerConfigRepairState(
    schedulerKey: string,
    actorUserId: string | null,
    status: string,
    reason: string,
    finishedAt: Date
  ): Promise<void> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    if (!normalizedSchedulerKey) {
      return;
    }

    const normalizedActorUserId = String(actorUserId || '').trim();
    if (normalizedActorUserId) {
      await this.schedulerUserConfigRepository.updateBySchedulerKeyAndUserId(
        normalizedSchedulerKey,
        normalizedActorUserId,
        {
          lastStatus: status,
          lastFinishedAt: finishedAt,
          lastError: reason,
          runningLockUntil: null,
        }
      );
      return;
    }

    await this.schedulerConfigRepository.updateByKey(normalizedSchedulerKey, {
      lastStatus: status,
      lastFinishedAt: finishedAt,
      lastError: reason,
      runningLockUntil: null,
    });
  }

  private async logSchedulerRepairActivity(
    schedulerKey: string,
    targetUserId: string | null,
    actorUserId: string,
    title: string,
    description: string
  ): Promise<void> {
    const activityUserId = String(targetUserId || env.scheduler.systemUserId).trim();
    await this.operationalEventService.logActivity(activityUserId, {
      type: 'Scheduler',
      title,
      status: 'Success',
      route: 'Schedulers',
      stream: 'Recovery',
      related: schedulerKey,
      referenceId: schedulerKey,
      actor: actorUserId,
      description,
    });
  }

  private mapDiscoveryRuntimeItem(
    record: Record<string, unknown>,
    type: RuntimeStaleItem['type'],
    staleThresholdMs: number
  ): RuntimeStaleItem {
    const lastProgressAt = this.readIsoString(record.last_progress_at);
    const startedAt = this.readIsoString(record.started_at);
    const detail = this.readString(record.detail);
    const id = this.readString(record.id) || randomUUID();

    return {
      id,
      type,
      source: 'discovery-engine',
      status: this.readString(record.status) || 'Running',
      title:
        type === 'discovery-bot'
          ? `Discovery bot stalled: ${id}`
          : type === 'discovery-template-improvement'
            ? `Discovery template improvement stalled: ${id}`
            : `Discovery run stalled: ${id}`,
      detail,
      userId: this.readString(record.user_id),
      workerId: this.readString(record.worker_id),
      startedAt,
      lastProgressAt,
      ageMs: this.computeAgeMs(lastProgressAt || startedAt),
      staleThresholdMs,
      repairable: false,
      repairAction: null,
    };
  }

  private readString(value: unknown): string | null {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  private readNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private readIsoString(value: unknown): string | null {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  }

  private computeAgeMs(value: string | null): number | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return Math.max(0, Date.now() - parsed.getTime());
  }

  private computeAgeFromDate(value: Date | null | undefined): number | null {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      return null;
    }
    return Math.max(0, Date.now() - value.getTime());
  }
}
