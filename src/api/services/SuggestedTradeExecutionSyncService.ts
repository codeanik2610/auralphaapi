import { Inject, Service } from 'typedi';
import { SuggestedTradesExecutionSyncStatus } from '../contracts/SuggestedTradesOverview';
import {
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
  SuggestedTradeRepository,
  SuggestedTradeSummaryQuery,
} from '../../database';
import { env } from '../../env';
import { Logger } from '../../lib/logger';
import { RuntimeLoopSnapshot } from '../contracts/Runtime';
import { OperationalEventService } from './OperationalEventService';
import { SuggestedTradesService } from './SuggestedTradesService';

const log = new Logger(__filename);
const SCHEDULER_KEY = 'suggested-trades-execution-sync';
const SCHEDULER_NAME = 'Suggested Trade Execution Sync';
const SCHEDULER_DESCRIPTION =
  'Background execution sync that refreshes stale linked suggested trades from live order, position, and paper-order state.';

@Service()
export class SuggestedTradeExecutionSyncService {
  @Inject(() => SchedulerConfigRepository)
  private schedulerConfigRepository!: SchedulerConfigRepository;

  @Inject(() => SchedulerRunLogRepository)
  private schedulerRunLogRepository!: SchedulerRunLogRepository;

  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopRequested = false;
  private activeRunPromise: Promise<void> | null = null;
  private lastStartedAt: Date | null = null;
  private lastFinishedAt: Date | null = null;
  private lastError: string | null = null;

  async start(): Promise<void> {
    await this.ensureSchedulerConfig();

    if (env.isTest || !env.suggestedTradesSync.backgroundEnabled) {
      log.info(
        `Suggested trade execution sync background loop is disabled (enabled=${env.suggestedTradesSync.backgroundEnabled}, test=${env.isTest})`
      );
      return;
    }

    if (this.timer) {
      return;
    }

    this.stopRequested = false;
    log.info(
      `Starting ${SCHEDULER_KEY} background loop with poll interval ${env.suggestedTradesSync.pollIntervalMs}ms`
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, env.suggestedTradesSync.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.activeRunPromise;
  }

  async runBatchOnce(): Promise<{
    processed: number;
    refreshed: number;
    userCount: number;
    suggestedTradeIds: string[];
    skipped: boolean;
  }> {
    if (this.stopRequested) {
      return {
        processed: 0,
        refreshed: 0,
        userCount: 0,
        suggestedTradeIds: [],
        skipped: true,
      };
    }

    const config = await this.ensureSchedulerConfig();
    if (!config.enabled) {
      return {
        processed: 0,
        refreshed: 0,
        userCount: 0,
        suggestedTradeIds: [],
        skipped: true,
      };
    }

    const lockTtlMs = Math.max(60_000, env.suggestedTradesSync.pollIntervalMs * 2);
    if (this.stopRequested) {
      return {
        processed: 0,
        refreshed: 0,
        userCount: 0,
        suggestedTradeIds: [],
        skipped: true,
      };
    }
    const acquired = await this.schedulerConfigRepository.tryAcquireRunLock(
      SCHEDULER_KEY,
      new Date(Date.now() + lockTtlMs)
    );
    if (!acquired) {
      return {
        processed: 0,
        refreshed: 0,
        userCount: 0,
        suggestedTradeIds: [],
        skipped: true,
      };
    }

    const startedAt = new Date();
    const batchSize = Math.max(1, Number(config.batchSize) || env.suggestedTradesSync.batchSize);
    const staleAfterMs = this.resolveStaleAfterMs(config);

    try {
      const result = await this.suggestedTradesService.syncStaleTrackedExecutionTrades({
        limit: batchSize,
        staleBefore: new Date(Date.now() - staleAfterMs),
      });
      const finishedAt = new Date();

      await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, {
        batchSize,
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        lastStatus: 'Success',
        lastError: null,
      });

      if (result.processed > 0) {
        await this.schedulerRunLogRepository.createRun({
          schedulerKey: SCHEDULER_KEY,
          status: 'Success',
          actorUserId: env.scheduler.systemUserId,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          processedAccounts: result.userCount,
          insertedAssets: 0,
          updatedAssets: result.refreshed,
          skippedAssets: Math.max(0, result.processed - result.refreshed),
          errorMessage: null,
          meta: {
            trigger: 'background-poll',
            progress: {
              total: result.processed,
              processed: result.processed,
              percent: 100,
              etaSeconds: 0,
              currentItem: null,
            },
            suggestedTrades: {
              processed: result.processed,
              refreshed: result.refreshed,
              userCount: result.userCount,
              staleAfterMs,
              batchSize,
              pollIntervalMs: env.suggestedTradesSync.pollIntervalMs,
            },
          },
        });
      }

      return {
        ...result,
        skipped: result.processed === 0,
      };
    } catch (error) {
      const finishedAt = new Date();
      const message = error instanceof Error ? error.message : String(error);

      await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, {
        batchSize,
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        lastStatus: 'Failed',
        lastError: message.slice(0, 4000),
      });
      await this.schedulerRunLogRepository.createRun({
        schedulerKey: SCHEDULER_KEY,
        status: 'Failed',
        actorUserId: env.scheduler.systemUserId,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        processedAccounts: 0,
        insertedAssets: 0,
        updatedAssets: 0,
        skippedAssets: 0,
        errorMessage: message,
        meta: {
          trigger: 'background-poll',
          suggestedTrades: {
            staleAfterMs,
            batchSize,
            pollIntervalMs: env.suggestedTradesSync.pollIntervalMs,
          },
        },
      });
      await this.operationalEventService.logActivity(env.scheduler.systemUserId, {
        type: 'Suggested Trade scheduler',
        title: 'Suggested trade execution background sync failed',
        status: 'Failed',
        route: 'Suggested Trades',
        stream: 'Execution',
        related: SCHEDULER_KEY,
        description: message,
      });
      await this.operationalEventService.emitFailureAlert(env.scheduler.systemUserId, {
        channel: 'Suggested Trades',
        source: SCHEDULER_KEY,
        message: `Suggested trade execution background sync failed: ${message}`,
        route: 'Alerts',
      });
      throw error;
    } finally {
      await this.schedulerConfigRepository.releaseRunLock(SCHEDULER_KEY);
    }
  }

  getRuntimeSnapshot(): RuntimeLoopSnapshot {
    const state = !env.suggestedTradesSync.backgroundEnabled
      ? 'disabled'
      : this.stopRequested
        ? 'draining'
        : this.running
          ? 'running'
          : this.timer
            ? 'idle'
            : 'stopped';

    return {
      key: SCHEDULER_KEY,
      label: SCHEDULER_NAME,
      enabled: env.suggestedTradesSync.backgroundEnabled,
      state,
      timerActive: Boolean(this.timer),
      running: this.running,
      stopRequested: this.stopRequested,
      pollIntervalMs: env.suggestedTradesSync.pollIntervalMs,
      lastStartedAt: this.lastStartedAt?.toISOString() ?? null,
      lastFinishedAt: this.lastFinishedAt?.toISOString() ?? null,
      lastError: this.lastError,
      detail:
        state === 'disabled'
          ? 'Suggested trade execution sync background loop is disabled in configuration.'
          : this.lastError,
    };
  }

  async getSyncStatus(
    userId: string,
    query: Omit<SuggestedTradeSummaryQuery, 'userId'> = {}
  ): Promise<SuggestedTradesExecutionSyncStatus> {
    const config = await this.ensureSchedulerConfig();
    const latestRun = await this.schedulerRunLogRepository.findLatestBySchedulerKeyAndStatuses(
      SCHEDULER_KEY,
      ['Queued', 'Running', 'Success', 'Failed', 'Cancelled']
    );
    const staleAfterMs = this.resolveStaleAfterMs(config);
    const counts = await this.suggestedTradeRepository.getExecutionSyncSummary(
      userId,
      query,
      new Date(Date.now() - staleAfterMs)
    );
    return this.buildSyncStatus(config, latestRun, counts, staleAfterMs);
  }

  async getOperationalStatus(): Promise<SuggestedTradesExecutionSyncStatus> {
    const config = await this.ensureSchedulerConfig();
    const latestRun = await this.schedulerRunLogRepository.findLatestBySchedulerKeyAndStatuses(
      SCHEDULER_KEY,
      ['Queued', 'Running', 'Success', 'Failed', 'Cancelled']
    );
    const staleAfterMs = this.resolveStaleAfterMs(config);
    const counts = await this.suggestedTradeRepository.getGlobalExecutionSyncSummary(
      new Date(Date.now() - staleAfterMs)
    );
    return this.buildSyncStatus(config, latestRun, counts, staleAfterMs);
  }

  private buildSyncStatus(
    config: {
      enabled: boolean;
      lastStartedAt?: Date | null;
      lastFinishedAt?: Date | null;
      lastStatus?: string | null;
      lastError?: string | null;
    },
    latestRun: {
      id?: string;
      status?: string | null;
      startedAt?: Date | null;
      finishedAt?: Date | null;
    } | null,
    counts: {
      tracked: number;
      stale: number;
      terminal: number;
    },
    staleAfterMs: number
  ): SuggestedTradesExecutionSyncStatus {
    const configTimestamp = Math.max(
      config.lastFinishedAt?.getTime?.() ?? 0,
      config.lastStartedAt?.getTime?.() ?? 0
    );
    const latestRunTimestamp = Math.max(
      latestRun?.finishedAt?.getTime?.() ?? 0,
      latestRun?.startedAt?.getTime?.() ?? 0
    );
    const preferConfigState = configTimestamp >= latestRunTimestamp;
    const effectiveStatus = preferConfigState
      ? config.lastStatus ?? latestRun?.status ?? undefined
      : latestRun?.status ?? config.lastStatus ?? undefined;
    const effectiveLastStartedAt = preferConfigState
      ? config.lastStartedAt?.toISOString?.() ?? latestRun?.startedAt?.toISOString?.()
      : latestRun?.startedAt?.toISOString?.() ?? config.lastStartedAt?.toISOString?.();
    const effectiveLastFinishedAt = preferConfigState
      ? config.lastFinishedAt?.toISOString?.() ?? latestRun?.finishedAt?.toISOString?.()
      : latestRun?.finishedAt?.toISOString?.() ?? config.lastFinishedAt?.toISOString?.();
    const effectiveLastError = preferConfigState
      ? config.lastError ?? undefined
      : config.lastError ?? undefined;
    const latestStatus = String(effectiveStatus || '').trim().toLowerCase();

    if (latestStatus === 'running' || latestStatus === 'queued') {
      return {
        state: 'running',
        label: latestStatus === 'queued' ? 'Queued' : 'Running',
        summary:
          latestStatus === 'queued'
            ? 'A background execution sync is queued and will refresh tracked trades shortly.'
            : 'A background execution sync is actively refreshing tracked trades.',
        enabled: config.enabled,
        tracked: counts.tracked,
        stale: counts.stale,
        terminal: counts.terminal,
        staleAfterMs,
        lastStartedAt: effectiveLastStartedAt,
        lastFinishedAt: effectiveLastFinishedAt,
        lastStatus: effectiveStatus,
        lastError: effectiveLastError,
        activeRunId: latestRun?.id,
      };
    }

    if (!config.enabled) {
      return {
        state: 'paused',
        label: 'Paused',
        summary:
          counts.stale > 0
            ? `${counts.stale} tracked trades are stale while background sync is paused.`
            : 'Background execution sync is paused.',
        enabled: config.enabled,
        tracked: counts.tracked,
        stale: counts.stale,
        terminal: counts.terminal,
        staleAfterMs,
        lastStartedAt: effectiveLastStartedAt,
        lastFinishedAt: effectiveLastFinishedAt,
        lastStatus: effectiveStatus,
        lastError: effectiveLastError,
      };
    }

    if (latestStatus === 'failed' || effectiveLastError || counts.stale > 0) {
      return {
        state: 'attention',
        label: effectiveLastError || latestStatus === 'failed' ? 'Needs Attention' : 'Stale Trades',
        summary:
          effectiveLastError || latestStatus === 'failed'
            ? 'The most recent execution sync did not complete cleanly.'
            : `${counts.stale} tracked trades need a refresh from order or position state.`,
        enabled: config.enabled,
        tracked: counts.tracked,
        stale: counts.stale,
        terminal: counts.terminal,
        staleAfterMs,
        lastStartedAt: effectiveLastStartedAt,
        lastFinishedAt: effectiveLastFinishedAt,
        lastStatus: effectiveStatus,
        lastError: effectiveLastError,
      };
    }

    return {
      state: 'healthy',
      label: 'Healthy',
      summary:
        counts.tracked > 0
          ? 'Tracked trades are in sync with the latest execution snapshots.'
          : 'No linked trades currently require execution tracking.',
      enabled: config.enabled,
      tracked: counts.tracked,
      stale: counts.stale,
      terminal: counts.terminal,
      staleAfterMs,
      lastStartedAt: effectiveLastStartedAt,
      lastFinishedAt: effectiveLastFinishedAt,
      lastStatus: effectiveStatus,
      lastError: effectiveLastError,
    };
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopRequested) {
      return;
    }

    const runPromise = (async () => {
      this.running = true;
      this.lastStartedAt = new Date();
      try {
        await this.runBatchOnce();
        this.lastError = null;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        log.error(
          `Suggested trade execution sync batch failed: ${
            error instanceof Error ? error.stack || error.message : String(error)
          }`
        );
      } finally {
        this.lastFinishedAt = new Date();
        this.running = false;
      }
    })();

    this.activeRunPromise = runPromise;
    try {
      await runPromise;
    } finally {
      if (this.activeRunPromise === runPromise) {
        this.activeRunPromise = null;
      }
    }
  }

  private async ensureSchedulerConfig() {
    const created = await this.schedulerConfigRepository.createIfMissing({
      key: SCHEDULER_KEY,
      name: SCHEDULER_NAME,
      description: SCHEDULER_DESCRIPTION,
      enabled: true,
      cronExpression: '*/1 * * * *',
      timezone: 'UTC',
      runAt: '00:00',
      intervalDays: 1,
      batchSize: env.suggestedTradesSync.batchSize,
      schedulerType: 'global',
      config: {
        pollIntervalMs: env.suggestedTradesSync.pollIntervalMs,
        staleAfterMs: env.suggestedTradesSync.staleAfterMs,
      },
    });

    const nextConfig =
      created.config && typeof created.config === 'object' ? { ...created.config } : {};
    let needsUpdate = false;

    if (created.batchSize !== env.suggestedTradesSync.batchSize) {
      created.batchSize = env.suggestedTradesSync.batchSize;
      needsUpdate = true;
    }
    if (Number(nextConfig.pollIntervalMs) !== env.suggestedTradesSync.pollIntervalMs) {
      nextConfig.pollIntervalMs = env.suggestedTradesSync.pollIntervalMs;
      needsUpdate = true;
    }
    if (Number(nextConfig.staleAfterMs) !== env.suggestedTradesSync.staleAfterMs) {
      nextConfig.staleAfterMs = env.suggestedTradesSync.staleAfterMs;
      needsUpdate = true;
    }

    if (!needsUpdate) {
      return created;
    }

    return (
      (await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, {
        batchSize: created.batchSize,
        config: nextConfig,
      })) ?? created
    );
  }

  private resolveStaleAfterMs(config: {
    config?: Record<string, unknown> | null;
  }): number {
    const configured = Number((config.config ?? {})?.staleAfterMs);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.max(30_000, configured);
    }
    return env.suggestedTradesSync.staleAfterMs;
  }
}
