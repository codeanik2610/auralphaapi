import { Inject, Service } from 'typedi';
import {
  PaperOrderRepository,
  SchedulerConfigRepository,
  SchedulerRunLogRepository,
} from '../../database';
import { env } from '../../env';
import { Logger } from '../../lib/logger';
import { OperationalEventService } from './OperationalEventService';
import { PaperOrderExecutionService } from './PaperOrderExecutionService';
import { SuggestedTradesService } from './SuggestedTradesService';

const log = new Logger(__filename);
const SCHEDULER_KEY = 'paper-orders-execution';
const SCHEDULER_NAME = 'Paper Order Execution';
const SCHEDULER_DESCRIPTION =
  'Background paper-order simulator that advances open and filled paper orders using latest candle ranges with price-snapshot fallback.';
const SIMULATION_MODE = 'candle-high-low-with-snapshot-fallback';

@Service()
export class PaperOrdersSchedulerService {
  @Inject(() => SchedulerConfigRepository)
  private schedulerConfigRepository!: SchedulerConfigRepository;

  @Inject(() => SchedulerRunLogRepository)
  private schedulerRunLogRepository!: SchedulerRunLogRepository;

  @Inject(() => PaperOrderRepository)
  private paperOrderRepository!: PaperOrderRepository;

  @Inject(() => PaperOrderExecutionService)
  private paperOrderExecutionService!: PaperOrderExecutionService;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  private timer: NodeJS.Timeout | null = null;
  private running = false;

  async start(): Promise<void> {
    await this.ensureSchedulerConfig();

    if (env.isTest || !env.paperOrders.backgroundEnabled) {
      log.info(
        `Paper order execution background loop is disabled (enabled=${env.paperOrders.backgroundEnabled}, test=${env.isTest})`
      );
      return;
    }

    if (this.timer) {
      return;
    }

    log.info(
      `Starting ${SCHEDULER_KEY} background loop with poll interval ${env.paperOrders.pollIntervalMs}ms`
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, env.paperOrders.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      await this.runBatch();
    } catch (error) {
      log.error(
        `Paper order execution batch failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`
      );
    } finally {
      this.running = false;
    }
  }

  private async runBatch(): Promise<void> {
    const config = await this.ensureSchedulerConfig();
    if (!config.enabled) {
      return;
    }

    const executableCount = await this.paperOrderRepository.countExecutablePaperOrdersGlobal();
    if (executableCount <= 0) {
      return;
    }

    const lockTtlMs = Math.max(60_000, env.paperOrders.pollIntervalMs * 2);
    const acquired = await this.schedulerConfigRepository.tryAcquireRunLock(
      SCHEDULER_KEY,
      new Date(Date.now() + lockTtlMs)
    );
    if (!acquired) {
      return;
    }

    const startedAt = new Date();
    const batchSize = Math.max(1, Number(config.batchSize) || env.paperOrders.batchSize);

    try {
      const result = await this.paperOrderExecutionService.simulateActivePaperOrders({
        limit: batchSize,
      });

      let syncedSuggestions = 0;
      if (result.updatedOrders.length) {
        const paperOrderIdsByUser = new Map<string, string[]>();
        for (const item of result.updatedOrders) {
          const userId = String(item.userId || '').trim();
          if (!userId) {
            continue;
          }
          const next = paperOrderIdsByUser.get(userId) || [];
          next.push(item.paperOrderId);
          paperOrderIdsByUser.set(userId, next);
        }

        for (const [userId, paperOrderIds] of paperOrderIdsByUser.entries()) {
          syncedSuggestions += await this.suggestedTradesService.syncExecutionForPaperOrderUpdates(
            userId,
            paperOrderIds
          );
        }
      }

      const finishedAt = new Date();
      await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, {
        batchSize,
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        lastStatus: 'Success',
        lastError: null,
      });

      if (result.updatedOrders.length > 0) {
        await this.schedulerRunLogRepository.createRun({
          schedulerKey: SCHEDULER_KEY,
          status: 'Success',
          actorUserId: env.scheduler.systemUserId,
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          processedAccounts: result.processedOrders,
          insertedAssets: 0,
          updatedAssets: result.updatedOrders.length,
          skippedAssets: Math.max(0, result.processedOrders - result.updatedOrders.length),
          errorMessage: null,
          meta: {
            trigger: 'background-poll',
            progress: {
              total: result.processedOrders,
              processed: result.processedOrders,
              percent: 100,
              etaSeconds: 0,
              currentItem: null,
            },
            paper: {
              executableOrdersSeen: executableCount,
              processedOrders: result.processedOrders,
              updatedOrders: result.updatedOrders.length,
              distinctUsers: result.distinctUsers,
              syncedSuggestedTrades: syncedSuggestions,
              batchSize,
              pollIntervalMs: env.paperOrders.pollIntervalMs,
              simulationMode: SIMULATION_MODE,
            },
          },
        });
      }
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
          paper: {
            executableOrdersSeen: executableCount,
            batchSize,
            pollIntervalMs: env.paperOrders.pollIntervalMs,
            simulationMode: SIMULATION_MODE,
          },
        },
      });
      await this.operationalEventService.logActivity(env.scheduler.systemUserId, {
        type: 'Paper order scheduler',
        title: 'Paper order background execution failed',
        status: 'Failed',
        route: 'Orders',
        stream: 'Paper execution',
        related: SCHEDULER_KEY,
        description: message,
      });
      await this.operationalEventService.emitFailureAlert(env.scheduler.systemUserId, {
        channel: 'Orders',
        source: SCHEDULER_KEY,
        message: `Paper order background execution failed: ${message}`,
        route: 'Alerts',
      });
      throw error;
    } finally {
      await this.schedulerConfigRepository.releaseRunLock(SCHEDULER_KEY);
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
      batchSize: env.paperOrders.batchSize,
      schedulerType: 'global',
      config: {
        pollIntervalMs: env.paperOrders.pollIntervalMs,
        logStrategy: 'updates-only',
        simulationMode: 'latest-price-snapshot',
      },
    });

    const nextConfig = created.config && typeof created.config === 'object' ? { ...created.config } : {};
    let needsUpdate = false;

    if (created.name !== SCHEDULER_NAME) {
      created.name = SCHEDULER_NAME;
      needsUpdate = true;
    }
    if (created.description !== SCHEDULER_DESCRIPTION) {
      created.description = SCHEDULER_DESCRIPTION;
      needsUpdate = true;
    }
    if (created.schedulerType !== 'global') {
      created.schedulerType = 'global';
      needsUpdate = true;
    }
    if ((Number(created.batchSize) || 0) <= 0) {
      created.batchSize = env.paperOrders.batchSize;
      needsUpdate = true;
    }
    if (Number(nextConfig.pollIntervalMs) !== env.paperOrders.pollIntervalMs) {
      nextConfig.pollIntervalMs = env.paperOrders.pollIntervalMs;
      needsUpdate = true;
    }
    if (String(nextConfig.logStrategy || '') !== 'updates-only') {
      nextConfig.logStrategy = 'updates-only';
      needsUpdate = true;
    }
    if (String(nextConfig.simulationMode || '') !== 'latest-price-snapshot') {
      nextConfig.simulationMode = 'latest-price-snapshot';
      needsUpdate = true;
    }

    if (needsUpdate) {
      const updated = await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, {
        name: created.name,
        description: created.description,
        schedulerType: created.schedulerType,
        batchSize: created.batchSize,
        config: nextConfig,
      });
      return updated || created;
    }

    return created;
  }
}
