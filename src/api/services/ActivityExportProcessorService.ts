import os from 'node:os';
import { Inject, Service } from 'typedi';
import { ActivityLog, ActivityExportRepository, ActivityRepository } from '../../database';
import { env } from '../../env';
import { normalizeActivityStream } from '../../lib/activityEvents';
import { Logger } from '../../lib/logger';
import { RuntimeLoopSnapshot } from '../contracts/Runtime';
import { ActivityExportStorageService } from './ActivityExportStorageService';
import { OperationalEventService } from './OperationalEventService';

const log = new Logger(__filename);

@Service()
export class ActivityExportProcessorService {
  @Inject(() => ActivityExportRepository)
  private activityExportRepository!: ActivityExportRepository;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => ActivityExportStorageService)
  private activityExportStorageService!: ActivityExportStorageService;

  private readonly exportRetentionMs = env.activity.exportRetentionDays * 24 * 60 * 60 * 1000;
  private readonly workerId = `${os.hostname()}:${process.pid}:activity-export-processor`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopRequested = false;
  private activeRunPromise: Promise<void> | null = null;
  private lastStartedAt: Date | null = null;
  private lastFinishedAt: Date | null = null;
  private lastError: string | null = null;

  async start(): Promise<void> {
    if (env.isTest || !env.activity.exportProcessorEnabled) {
      log.info(
        `Activity export processor loop is disabled (enabled=${env.activity.exportProcessorEnabled}, test=${env.isTest})`
      );
      return;
    }

    if (this.timer) {
      return;
    }

    this.stopRequested = false;
    const recoveredCount = await this.recoverStaleProcessingExports();
    if (recoveredCount > 0) {
      log.warn(
        `Recovered ${recoveredCount} stale activity export job${
          recoveredCount === 1 ? '' : 's'
        } before starting the processor loop`
      );
    }

    log.info(
      `Starting activity export processor loop with interval ${env.activity.exportProcessorIntervalMs}ms`
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, env.activity.exportProcessorIntervalMs);
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

  async processPendingExportsOnce(): Promise<number> {
    const pending = await this.activityExportRepository.listQueuedExports(
      env.activity.exportProcessorBatchSize
    );
    let processedCount = 0;

    for (const item of pending) {
      if (this.stopRequested) {
        break;
      }

      const locked = await this.activityExportRepository.markExportProcessing(item.id, this.workerId);
      if (!locked) {
        continue;
      }

      processedCount += 1;
      await this.processQueuedExport(locked);
    }

    return processedCount;
  }

  async rebuildExportFile(item: {
    id: string;
    userId: string;
    scope: string;
    format: string;
    fileName: string;
    filters: Record<string, string> | null;
  }): Promise<{ filePath: string; exportedCount: number }> {
    return this.writeExportFile(item);
  }

  getRuntimeSnapshot(): RuntimeLoopSnapshot {
    const state = !env.activity.exportProcessorEnabled
      ? 'disabled'
      : this.stopRequested
        ? 'draining'
        : this.running
          ? 'running'
          : this.timer
            ? 'idle'
            : 'stopped';

    return {
      key: 'activity-export-processor',
      label: 'Activity Export Processor',
      enabled: env.activity.exportProcessorEnabled,
      state,
      timerActive: Boolean(this.timer),
      running: this.running,
      stopRequested: this.stopRequested,
      pollIntervalMs: env.activity.exportProcessorIntervalMs,
      lastStartedAt: this.lastStartedAt?.toISOString() ?? null,
      lastFinishedAt: this.lastFinishedAt?.toISOString() ?? null,
      lastError: this.lastError,
      workerId: this.workerId,
      detail:
        state === 'disabled'
          ? 'Activity export processing is disabled in configuration.'
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
        await this.processPendingExportsOnce();
        this.lastError = null;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        log.error(
          `Activity export processor run failed: ${
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

  private async processQueuedExport(item: {
    id: string;
    userId: string;
    scope: string;
    format: string;
    fileName: string;
    filters: Record<string, string> | null;
  }): Promise<void> {
    try {
      const { filePath, exportedCount } = await this.writeExportFile(item);
      const completed = await this.activityExportRepository.markExportReady(item.id, {
        exportedCount,
        storagePath: filePath,
        expiresAt: new Date(Date.now() + this.exportRetentionMs),
      });

      await this.operationalEventService.logActivity(item.userId, {
        type: 'Activity Export',
        title: `Activity export ready: ${item.fileName}`,
        status: 'Success',
        route: 'Activity',
        stream: 'Controls',
        related: item.scope,
        referenceId: item.id,
        correlationId: item.id,
        description: `Activity export ready (${exportedCount} row${exportedCount === 1 ? '' : 's'})`,
      });

      if (!completed) {
        log.warn(`Activity export ${item.id} completed but could not be reloaded after update`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.activityExportRepository.markExportFailed(item.id, message);
      await this.operationalEventService.logActivity(item.userId, {
        type: 'Activity Export',
        title: 'Activity export failed',
        status: 'Failed',
        route: 'Activity',
        stream: 'Controls',
        related: item.scope,
        referenceId: item.id,
        correlationId: item.id,
        description: message,
      });
      await this.operationalEventService.emitFailureAlert(item.userId, {
        channel: 'Activity',
        source: 'activity-export-processor',
        message: `Activity export failed (${item.scope}): ${message}`,
        route: 'Alerts',
      });
    }
  }

  private buildExportQuery(scope: string, filters?: Record<string, string> | null) {
    const scopedStream = this.resolveScopedStream(scope, filters?.stream);
    const readState: 'all' | 'read' | 'unread' =
      filters?.readState === 'read' || filters?.readState === 'unread'
        ? filters.readState
        : 'all';

    return {
      limit: env.activity.exportChunkSize,
      type: filters?.type,
      status: filters?.status,
      search: filters?.search,
      stream: scopedStream,
      route: filters?.route,
      referenceId: filters?.referenceId,
      correlationId: filters?.correlationId,
      related: filters?.related,
      readState,
      sortBy: 'time' as const,
      sortOrder: 'desc' as const,
    };
  }

  private buildCsvHeader(): string {
    return [
      'id',
      'time',
      'isRead',
      'readAt',
      'stream',
      'type',
      'title',
      'status',
      'actor',
      'symbol',
      'route',
      'referenceId',
      'correlationId',
      'related',
      'description',
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(',');
  }

  private buildCsvLines(rows: Array<Record<string, string>>): string {
    const csvHeader = [
      'id',
      'time',
      'isRead',
      'readAt',
      'stream',
      'type',
      'title',
      'status',
      'actor',
      'symbol',
      'route',
      'referenceId',
      'correlationId',
      'related',
      'description',
    ];

    return rows
      .map((row) => csvHeader.map((column) => row[column] || ''))
      .map((columns) =>
        columns.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');
  }

  private async writeExportFile(
    item: {
      id: string;
      userId: string;
      scope: string;
      format: string;
      fileName: string;
      filters: Record<string, string> | null;
    }
  ): Promise<{ filePath: string; exportedCount: number }> {
    const { filePath, file } = await this.activityExportStorageService.openWritableExportFile({
      id: item.id,
      fileName: item.fileName,
    });
    const query = this.buildExportQuery(item.scope, item.filters ?? undefined);
    let cursor: { createdAt: Date; id: string } | undefined;
    let exportedCount = 0;
    let wroteJsonRows = false;

    try {
      if (item.format === 'json') {
        await file.writeFile('[', 'utf8');
      } else {
        await file.writeFile(`${this.buildCsvHeader()}\n`, 'utf8');
      }

      while (true) {
        const batch = await this.activityRepository.listActivityWindow(item.userId, query, cursor);
        if (!batch.length) {
          break;
        }

        const rows = batch.map((activity) => this.mapExportRow(activity));
        if (item.format === 'json') {
          const serialized = rows
            .map((row) => `${wroteJsonRows ? ',' : ''}\n${JSON.stringify(row, null, 2)}`)
            .join('');
          if (serialized) {
            await file.writeFile(serialized, 'utf8');
            wroteJsonRows = true;
          }
        } else {
          const serialized = this.buildCsvLines(rows);
          if (serialized) {
            await file.writeFile(`${serialized}\n`, 'utf8');
          }
        }

        exportedCount += rows.length;
        const last = batch[batch.length - 1];
        cursor = {
          createdAt: last.createdAt,
          id: last.id,
        };

        if (batch.length < query.limit) {
          break;
        }
      }

      if (item.format === 'json') {
        await file.writeFile(wroteJsonRows ? '\n]\n' : ']\n', 'utf8');
      }
    } finally {
      await file.close();
    }

    return { filePath, exportedCount };
  }

  private resolveScopedStream(scope: string, explicitStream?: string): string | undefined {
    if (explicitStream) {
      return explicitStream;
    }
    return scope === 'controls' || scope === 'execution' || scope === 'automation'
      ? scope
      : undefined;
  }

  private mapExportRow(activity: ActivityLog): Record<string, string> {
    return {
      id: activity.id,
      time: activity.createdAt.toISOString(),
      isRead: activity.readAt ? 'true' : 'false',
      readAt: activity.readAt?.toISOString() || '',
      stream: normalizeActivityStream(activity.stream) || '',
      type: activity.type,
      title: activity.title,
      status: activity.status,
      actor: activity.actor ?? '',
      symbol: activity.symbol ?? '',
      route: activity.route ?? '',
      referenceId: activity.referenceId ?? '',
      correlationId: activity.correlationId ?? '',
      related: activity.related ?? '',
      description: activity.description ?? '',
    };
  }

  private async recoverStaleProcessingExports(): Promise<number> {
    const staleExports = await this.activityExportRepository.findStaleProcessingExports({
      olderThan: new Date(Date.now() - this.getStaleProcessingThresholdMs()),
      limit: Math.max(10, env.activity.exportProcessorBatchSize * 5),
    });

    let recoveredCount = 0;
    for (const item of staleExports) {
      const repaired = await this.activityExportRepository.markExportRepaired(item.id, {
        status: 'Queued',
        reason: `Recovered stale Processing export after API restart/deploy on ${new Date().toISOString()}`,
      });
      if (repaired) {
        recoveredCount += 1;
      }
    }

    return recoveredCount;
  }

  private getStaleProcessingThresholdMs(): number {
    return Math.max(60_000, env.activity.exportProcessorIntervalMs * 4);
  }
}
