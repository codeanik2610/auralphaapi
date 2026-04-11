import { mkdir, open } from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Service } from 'typedi';
import { ActivityLog, ActivityExportRepository, ActivityRepository } from '../../database';
import { env } from '../../env';
import { normalizeActivityStream } from '../../lib/activityEvents';
import { Logger } from '../../lib/logger';
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

  private readonly exportRetentionMs = env.activity.exportRetentionDays * 24 * 60 * 60 * 1000;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

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

    log.info(
      `Starting activity export processor loop with interval ${env.activity.exportProcessorIntervalMs}ms`
    );
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, env.activity.exportProcessorIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async processPendingExportsOnce(): Promise<number> {
    const pending = await this.activityExportRepository.listQueuedExports(
      env.activity.exportProcessorBatchSize
    );
    let processedCount = 0;

    for (const item of pending) {
      const locked = await this.activityExportRepository.markExportProcessing(item.id);
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

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.processPendingExportsOnce();
    } catch (error) {
      log.error(
        `Activity export processor run failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`
      );
    } finally {
      this.running = false;
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
    const safeFileName = item.fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const storageDir = env.activity.exportStorageDir;
    await mkdir(storageDir, { recursive: true });
    const filePath = path.join(storageDir, `${item.id}-${safeFileName}`);
    const file = await open(filePath, 'w');
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
}
