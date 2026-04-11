import { unlink } from 'node:fs/promises';
import { Inject, Service } from 'typedi';
import { ActivityExportRepository, ActivityRepository } from '../../database';
import { env } from '../../env';
import { Logger } from '../../lib/logger';

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

    log.info(
      `Starting activity maintenance loop with interval ${env.activity.maintenanceIntervalMs}ms`
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, env.activity.maintenanceIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  async runMaintenanceNow(): Promise<ActivityMaintenanceResult> {
    return this.runCleanup();
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.runCleanup();
    } catch (error) {
      log.error(
        `Activity maintenance run failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`
      );
    } finally {
      this.running = false;
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
