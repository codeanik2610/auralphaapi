import { unlink } from 'node:fs/promises';
import { Inject, Service } from 'typedi';
import { ActivityExportRepository, ActivityRepository } from '../../database';
import { env } from '../../env';
import { Logger } from '../../lib/logger';
import { RuntimeLoopSnapshot } from '../contracts/Runtime';

const log = new Logger(__filename);

export interface ActivityMaintenanceResult {
  deletedActivityLogs: number;
  deletedExpiredExports: number;
  retentionDays: number;
}

@Service()
export class ActivityMaintenanceService {
  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => ActivityExportRepository)
  private activityExportRepository!: ActivityExportRepository;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopRequested = false;
  private activeRunPromise: Promise<void> | null = null;
  private lastStartedAt: Date | null = null;
  private lastFinishedAt: Date | null = null;
  private lastError: string | null = null;

  async start(): Promise<void> {
    if (env.isTest || !env.activity.maintenanceEnabled) {
      log.info(
        `Activity maintenance loop is disabled (enabled=${env.activity.maintenanceEnabled}, test=${env.isTest})`
      );
      return;
    }

    if (this.timer) {
      return;
    }

    this.stopRequested = false;
    log.info(
      `Starting activity maintenance loop with interval ${env.activity.maintenanceIntervalMs}ms`
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, env.activity.maintenanceIntervalMs);
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

  async runMaintenanceNow(): Promise<ActivityMaintenanceResult> {
    return this.runCleanup();
  }

  getRuntimeSnapshot(): RuntimeLoopSnapshot {
    const state = !env.activity.maintenanceEnabled
      ? 'disabled'
      : this.stopRequested
        ? 'draining'
        : this.running
          ? 'running'
          : this.timer
            ? 'idle'
            : 'stopped';

    return {
      key: 'activity-maintenance',
      label: 'Activity Maintenance',
      enabled: env.activity.maintenanceEnabled,
      state,
      timerActive: Boolean(this.timer),
      running: this.running,
      stopRequested: this.stopRequested,
      pollIntervalMs: env.activity.maintenanceIntervalMs,
      lastStartedAt: this.lastStartedAt?.toISOString() ?? null,
      lastFinishedAt: this.lastFinishedAt?.toISOString() ?? null,
      lastError: this.lastError,
      detail:
        state === 'disabled'
          ? 'Activity maintenance is disabled in configuration.'
          : this.lastError,
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
        await this.runCleanup();
        this.lastError = null;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        log.error(
          `Activity maintenance run failed: ${
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

  private async runCleanup(): Promise<ActivityMaintenanceResult> {
    const now = new Date();
    const retentionDays = env.activity.retentionDays;
    const [expiredExportCount, staleActivityCount] = await Promise.all([
      this.activityExportRepository.countExpiredExports(now),
      this.activityRepository.countOlderThanDays(retentionDays),
    ]);

    const [deletedExpiredExports, deletedActivityLogs] = await Promise.all([
      expiredExportCount > 0 ? this.deleteExpiredExportsWithFiles(now) : 0,
      staleActivityCount > 0 ? this.activityRepository.deleteOlderThanDays(retentionDays) : 0,
    ]);

    if (deletedExpiredExports > 0 || deletedActivityLogs > 0) {
      log.info(
        `Activity maintenance deleted ${deletedActivityLogs} activity logs older than ${retentionDays} days and ${deletedExpiredExports} expired exports`
      );
    }

    return {
      deletedActivityLogs,
      deletedExpiredExports,
      retentionDays,
    };
  }

  private async deleteExpiredExportsWithFiles(now: Date): Promise<number> {
    let deletedCount = 0;

    while (true) {
      const expired = await this.activityExportRepository.listExpiredExports(now, 100);
      if (!expired.length) {
        break;
      }

      for (const item of expired) {
        if (!item.storagePath) {
          continue;
        }
        try {
          await unlink(item.storagePath);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException | undefined)?.code;
          if (code !== 'ENOENT') {
            log.warn(
              `Activity maintenance could not delete export file ${item.storagePath}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      }

      deletedCount += await this.activityExportRepository.deleteExportsByIds(
        expired.map((item) => item.id)
      );
    }

    return deletedCount;
  }
}
