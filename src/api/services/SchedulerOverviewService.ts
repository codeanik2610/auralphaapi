import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SchedulerHealthCheckCounts,
  SchedulerOverviewItem,
  SchedulerOverviewResponse,
} from '../contracts/Scheduler';
import { successResponse } from '../utils/response';
import {
  buildSchedulerTimeContract,
  formatSchedulerDisplayTime,
  formatSchedulerRawIso,
} from '../utils/schedulerTimeContract';
import {
  resolveSchedulerAuditDisplayLabels,
  toSchedulerAuditContract,
} from '../utils/schedulerAuditContract';
import { coreDataSource } from '../../database/data-source';
import { UserTimeZoneService } from './UserTimeZoneService';

const RUNNING_STATUS = 'Running';
const RETIRED_SCHEDULER_KEYS = new Set([
  'discovery-self-identify-sync',
  'signals-scan-sync',
]);
const SYSTEM_OWNED_SCHEDULER_KEYS = new Set([
  'broker-assets-sync',
  'exchange-assets-sync',
  'binance-candles-3m-1m-sync',
  'system-health-sync',
  'asset-price-sync',
]);

type SchedulerOverviewConfigRecord = {
  key: string;
  name: string;
  enabled: boolean;
  lastFinishedAt?: Date | string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  schedulerType: 'global' | 'user';
};

@Service()
export class SchedulerOverviewService {
  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async getOverview(userId: string): Promise<ApiSuccessResponse<SchedulerOverviewResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const time = buildSchedulerTimeContract(timeZone);
    const [
      globalConfigRows,
      userConfigRows,
      globalRunningRows,
      userRunningRows,
      globalLatestRunRows,
      userLatestRunRows,
      globalQueuedCommandRows,
      userQueuedCommandRows,
    ] = await Promise.all([
      coreDataSource.query(
        `SELECT \`key\`, name, enabled, last_finished_at, last_status, last_error, scheduler_type
         FROM scheduler_configs`
      ),
      coreDataSource.query(
        `SELECT scheduler_key AS \`key\`, name, enabled, last_finished_at, last_status, last_error, scheduler_type
         FROM scheduler_user_configs
         WHERE user_id = ?`,
        [userId]
      ),
      coreDataSource.query(
        `SELECT r.id, r.scheduler_key AS schedulerKey, r.status, r.started_at AS startedAt, r.finished_at AS finishedAt,
                r.duration_ms AS durationMs,
                r.processed_accounts AS processedAccounts,
                r.inserted_assets AS insertedAssets,
                r.updated_assets AS updatedAssets,
                r.skipped_assets AS skippedAssets,
                r.error_message AS errorMessage, r.meta_json AS meta,
                r.initiated_by_type AS initiatedByType,
                r.initiated_by_user_id AS initiatedByUserId,
                r.initiated_by_label AS initiatedByLabel,
                r.execution_context AS executionContext
         FROM scheduler_run_logs r
         INNER JOIN (
           SELECT scheduler_key, MAX(started_at) AS started_at
           FROM scheduler_run_logs
           WHERE status = ?
             AND actor_user_id IS NULL
           GROUP BY scheduler_key
         ) latest
         ON r.scheduler_key = latest.scheduler_key AND r.started_at = latest.started_at`,
        [RUNNING_STATUS]
      ),
      coreDataSource.query(
        `SELECT r.id, r.scheduler_key AS schedulerKey, r.status, r.started_at AS startedAt, r.finished_at AS finishedAt,
                r.duration_ms AS durationMs,
                r.processed_accounts AS processedAccounts,
                r.inserted_assets AS insertedAssets,
                r.updated_assets AS updatedAssets,
                r.skipped_assets AS skippedAssets,
                r.error_message AS errorMessage, r.meta_json AS meta,
                r.initiated_by_type AS initiatedByType,
                r.initiated_by_user_id AS initiatedByUserId,
                r.initiated_by_label AS initiatedByLabel,
                r.execution_context AS executionContext
         FROM scheduler_run_logs r
         INNER JOIN (
           SELECT scheduler_key, MAX(started_at) AS started_at
           FROM scheduler_run_logs
           WHERE status = ?
             AND actor_user_id = ?
           GROUP BY scheduler_key
        ) latest
         ON r.scheduler_key = latest.scheduler_key AND r.started_at = latest.started_at`,
        [RUNNING_STATUS, userId]
      ),
      coreDataSource.query(
        `SELECT r.id, r.scheduler_key AS schedulerKey, r.status, r.started_at AS startedAt, r.finished_at AS finishedAt,
                r.duration_ms AS durationMs,
                r.processed_accounts AS processedAccounts,
                r.inserted_assets AS insertedAssets,
                r.updated_assets AS updatedAssets,
                r.skipped_assets AS skippedAssets,
                r.error_message AS errorMessage, r.meta_json AS meta,
                r.initiated_by_type AS initiatedByType,
                r.initiated_by_user_id AS initiatedByUserId,
                r.initiated_by_label AS initiatedByLabel,
                r.execution_context AS executionContext
         FROM scheduler_run_logs r
         INNER JOIN (
           SELECT scheduler_key, MAX(started_at) AS started_at
           FROM scheduler_run_logs
           WHERE actor_user_id IS NULL
           GROUP BY scheduler_key
         ) latest
         ON r.scheduler_key = latest.scheduler_key AND r.started_at = latest.started_at`
      ),
      coreDataSource.query(
        `SELECT r.id, r.scheduler_key AS schedulerKey, r.status, r.started_at AS startedAt, r.finished_at AS finishedAt,
                r.duration_ms AS durationMs,
                r.processed_accounts AS processedAccounts,
                r.inserted_assets AS insertedAssets,
                r.updated_assets AS updatedAssets,
                r.skipped_assets AS skippedAssets,
                r.error_message AS errorMessage, r.meta_json AS meta,
                r.initiated_by_type AS initiatedByType,
                r.initiated_by_user_id AS initiatedByUserId,
                r.initiated_by_label AS initiatedByLabel,
                r.execution_context AS executionContext
         FROM scheduler_run_logs r
         INNER JOIN (
           SELECT scheduler_key, MAX(started_at) AS started_at
           FROM scheduler_run_logs
           WHERE actor_user_id = ?
           GROUP BY scheduler_key
         ) latest
         ON r.scheduler_key = latest.scheduler_key AND r.started_at = latest.started_at`,
        [userId]
      ),
      coreDataSource.query(
        `SELECT c.id, c.scheduler_key AS schedulerKey, c.status, c.created_at AS createdAt, c.updated_at AS updatedAt,
                c.initiated_by_type AS initiatedByType,
                c.initiated_by_user_id AS initiatedByUserId,
                c.initiated_by_label AS initiatedByLabel,
                c.execution_context AS executionContext
         FROM scheduler_commands c
         INNER JOIN (
           SELECT scheduler_key, MAX(updated_at) AS updated_at
           FROM scheduler_commands
           WHERE command_type = 'run_now'
             AND status IN ('Pending', 'Processing')
             AND actor_user_id IS NULL
           GROUP BY scheduler_key
         ) latest
         ON c.scheduler_key = latest.scheduler_key AND c.updated_at = latest.updated_at`
      ),
      coreDataSource.query(
        `SELECT c.id, c.scheduler_key AS schedulerKey, c.status, c.created_at AS createdAt, c.updated_at AS updatedAt,
                c.initiated_by_type AS initiatedByType,
                c.initiated_by_user_id AS initiatedByUserId,
                c.initiated_by_label AS initiatedByLabel,
                c.execution_context AS executionContext
         FROM scheduler_commands c
         INNER JOIN (
           SELECT scheduler_key, MAX(updated_at) AS updated_at
           FROM scheduler_commands
           WHERE command_type = 'run_now'
             AND status IN ('Pending', 'Processing')
             AND actor_user_id = ?
           GROUP BY scheduler_key
         ) latest
         ON c.scheduler_key = latest.scheduler_key AND c.updated_at = latest.updated_at`,
        [userId]
      ),
    ]);

    const configs = this.buildEffectiveConfigRows(globalConfigRows || [], userConfigRows || []);
    const globalRunningByKey = this.indexRowsBySchedulerKey(globalRunningRows || []);
    const userRunningByKey = this.indexRowsBySchedulerKey(userRunningRows || []);
    const globalLatestRunByKey = this.indexRowsBySchedulerKey(globalLatestRunRows || []);
    const userLatestRunByKey = this.indexRowsBySchedulerKey(userLatestRunRows || []);
    const globalQueuedCommandsByKey = this.indexRowsBySchedulerKey(globalQueuedCommandRows || []);
    const userQueuedCommandsByKey = this.indexRowsBySchedulerKey(userQueuedCommandRows || []);

    const items: SchedulerOverviewItem[] = configs.map((row) => {
      const key = row.key;
      const isUserScoped = row.schedulerType === 'user';
      const running = isUserScoped ? userRunningByKey.get(key) : globalRunningByKey.get(key);
      const latestRun = isUserScoped ? userLatestRunByKey.get(key) : globalLatestRunByKey.get(key);
      const queuedCommand = isUserScoped
        ? userQueuedCommandsByKey.get(key)
        : globalQueuedCommandsByKey.get(key);
      const hasQueuedWork = Boolean(queuedCommand);
      const recentRun = this.buildOverviewRunSnapshot(
        latestRun || running,
        time.displayTimeZone
      );
      if (running) {
        const progress = this.readProgress(running.meta);
        const ops = this.buildOverviewOpsSnapshot(
          'running',
          hasQueuedWork,
          recentRun,
          row,
          time.displayTimeZone
        );
        return {
          key,
          name: row.name,
          enabled: row.enabled,
          status: 'running',
          hasQueuedWork,
          runId: String(running.id || ''),
          ...toSchedulerAuditContract(running, this.parseMeta(running.meta)),
          startedAt: this.formatDisplayDate(
            running.startedAt as Date | string | null | undefined,
            time.displayTimeZone
          ),
          startedAtIso: formatSchedulerRawIso(
            running.startedAt as Date | string | null | undefined
          ),
          ...(queuedCommand
            ? {
                queuedAt: this.formatDisplayDate(
                  this.readQueuedAt(queuedCommand),
                  time.displayTimeZone
                ),
                queuedAtIso: formatSchedulerRawIso(this.readQueuedAt(queuedCommand)),
              }
            : {}),
          lastStatus: row.lastStatus || undefined,
          lastError: row.lastError || undefined,
          lastFinishedAt: this.formatDisplayDate(row.lastFinishedAt, time.displayTimeZone),
          lastFinishedAtIso: formatSchedulerRawIso(row.lastFinishedAt),
          ...(recentRun ? { recentRun } : {}),
          ...(ops ? { ops } : {}),
          ...(progress ? { progress } : {}),
        };
      }

      if (queuedCommand) {
        const ops = this.buildOverviewOpsSnapshot(
          'queued',
          hasQueuedWork,
          recentRun,
          row,
          time.displayTimeZone
        );
        return {
          key,
          name: row.name,
          enabled: row.enabled,
          status: 'queued',
          hasQueuedWork,
          runId: String(queuedCommand.id || ''),
          ...toSchedulerAuditContract(queuedCommand),
          queuedAt: this.formatDisplayDate(
            this.readQueuedAt(queuedCommand),
            time.displayTimeZone
          ),
          queuedAtIso: formatSchedulerRawIso(this.readQueuedAt(queuedCommand)),
          lastStatus: row.lastStatus || undefined,
          lastError: row.lastError || undefined,
          lastFinishedAt: this.formatDisplayDate(row.lastFinishedAt, time.displayTimeZone),
          lastFinishedAtIso: formatSchedulerRawIso(row.lastFinishedAt),
          ...(recentRun ? { recentRun } : {}),
          ...(ops ? { ops } : {}),
        };
      }

      const lastStatus = row.lastStatus ? String(row.lastStatus) : '';
      const status = lastStatus.toLowerCase() === 'failed' ? 'failed' : 'idle';
      const ops = this.buildOverviewOpsSnapshot(
        status,
        hasQueuedWork,
        recentRun,
        row,
        time.displayTimeZone
      );
      return {
        key,
        name: row.name,
        enabled: row.enabled,
        status,
        hasQueuedWork,
        ...toSchedulerAuditContract(
          latestRun,
          latestRun ? this.parseMeta(latestRun.meta) : null
        ),
        lastStatus: row.lastStatus || undefined,
        lastError: row.lastError || undefined,
        lastFinishedAt: this.formatDisplayDate(row.lastFinishedAt, time.displayTimeZone),
        lastFinishedAtIso: formatSchedulerRawIso(row.lastFinishedAt),
        ...(recentRun ? { recentRun } : {}),
        ...(ops ? { ops } : {}),
      };
    });

    return successResponse({
      items: await resolveSchedulerAuditDisplayLabels(items),
      time,
    });
  }

  private buildEffectiveConfigRows(
    baseRows: Array<Record<string, unknown>>,
    userRows: Array<Record<string, unknown>>
  ): SchedulerOverviewConfigRecord[] {
    const indexed = new Map<string, SchedulerOverviewConfigRecord>();

    for (const row of baseRows) {
      const normalized = this.normalizeConfigRow(row);
      if (normalized) {
        indexed.set(normalized.key, normalized);
      }
    }

    for (const row of userRows) {
      const normalized = this.normalizeConfigRow(row);
      if (normalized) {
        if (SYSTEM_OWNED_SCHEDULER_KEYS.has(normalized.key)) {
          continue;
        }
        indexed.set(normalized.key, normalized);
      }
    }

    return Array.from(indexed.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  private normalizeConfigRow(row: Record<string, unknown>): SchedulerOverviewConfigRecord | null {
    const key = String(row.key || '').trim();
    if (!key || RETIRED_SCHEDULER_KEYS.has(key)) {
      return null;
    }

    return {
      key,
      name: String(row.name || key).trim() || key,
      enabled: Boolean(row.enabled),
      lastFinishedAt:
        (row.last_finished_at as Date | string | null | undefined) ??
        (row.lastFinishedAt as Date | string | null | undefined) ??
        null,
      lastStatus: row.last_status ? String(row.last_status) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      schedulerType: SYSTEM_OWNED_SCHEDULER_KEYS.has(key)
        ? 'global'
        : String(row.scheduler_type || '').trim().toLowerCase() === 'user'
          ? 'user'
          : 'global',
    };
  }

  private indexRowsBySchedulerKey(rows: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
    const indexed = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = String(row.schedulerKey || row.scheduler_key || '').trim();
      if (key) {
        indexed.set(key, row);
      }
    }
    return indexed;
  }

  private formatDisplayDate(
    value: Date | string | null | undefined,
    timeZone: string
  ): string | undefined {
    return formatSchedulerDisplayTime(value, timeZone);
  }

  private readQueuedAt(row: Record<string, unknown>): Date | string | null | undefined {
    return (
      (row.updatedAt as Date | string | null | undefined) ??
      (row.startedAt as Date | string | null | undefined) ??
      (row.createdAt as Date | string | null | undefined) ??
      null
    );
  }

  private buildOverviewRunSnapshot(
    row: Record<string, unknown> | undefined,
    timeZone: string
  ): SchedulerOverviewItem['recentRun'] | undefined {
    if (!row) {
      return undefined;
    }

    const parsedMeta = this.parseMeta(row.meta);
    const progress = this.readProgress(parsedMeta);
    const healthCheckCounts = this.readHealthCheckCounts(
      String(row.schedulerKey || ''),
      parsedMeta,
      row
    );
    const startedAt = row.startedAt as Date | string | null | undefined;
    const finishedAt = row.finishedAt as Date | string | null | undefined;
    const status = String(row.status || '').trim();

    return {
      id: String(row.id || ''),
      status,
      ...toSchedulerAuditContract(row, parsedMeta),
      startedAt: this.formatDisplayDate(startedAt, timeZone),
      startedAtIso: formatSchedulerRawIso(startedAt),
      finishedAt: this.formatDisplayDate(finishedAt, timeZone),
      finishedAtIso: formatSchedulerRawIso(finishedAt),
      durationMs: this.readOptionalNumber(row.durationMs),
      processedAccounts: this.readNumber(row.processedAccounts),
      insertedAssets: this.readNumber(row.insertedAssets),
      updatedAssets: this.readNumber(row.updatedAssets),
      skippedAssets: this.readNumber(row.skippedAssets),
      ...(healthCheckCounts ? { healthCheckCounts } : {}),
      errorMessage: this.readOptionalText(row.errorMessage),
      ...(progress ? { progress } : {}),
    };
  }

  private buildOverviewOpsSnapshot(
    activeStatus: SchedulerOverviewItem['status'],
    hasQueuedWork: boolean,
    recentRun: SchedulerOverviewItem['recentRun'],
    row: SchedulerOverviewConfigRecord,
    timeZone: string
  ): SchedulerOverviewItem['ops'] {
    const latestRunStatus = recentRun?.status || this.readOptionalText(row.lastStatus);
    const latestOutcome = this.readOptionalText(row.lastStatus) || recentRun?.status;
    const latestError = this.readOptionalText(row.lastError) || recentRun?.errorMessage;
    const latestFinishedAtSource =
      row.lastFinishedAt ?? recentRun?.finishedAtIso ?? recentRun?.finishedAt ?? null;

    return {
      activeStatus,
      hasQueuedWork,
      latestRunId: recentRun?.id,
      latestRunStatus,
      latestOutcome,
      latestError,
      latestFinishedAt: this.formatDisplayDate(latestFinishedAtSource, timeZone),
      latestFinishedAtIso: formatSchedulerRawIso(latestFinishedAtSource),
    };
  }

  private readProgress(meta: unknown): SchedulerOverviewItem['progress'] | undefined {
    const parsed = this.parseMeta(meta);
    const progressRaw =
      parsed.progress && typeof parsed.progress === 'object' && !Array.isArray(parsed.progress)
        ? (parsed.progress as Record<string, unknown>)
        : null;
    if (!progressRaw) {
      return undefined;
    }
    return {
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
    };
  }

  private readHealthCheckCounts(
    schedulerKey: string,
    meta: Record<string, unknown>,
    row: Record<string, unknown>
  ): SchedulerHealthCheckCounts | undefined {
    if (schedulerKey !== 'system-health-sync') {
      return undefined;
    }

    const explicitRaw =
      meta.healthCheckCounts &&
      typeof meta.healthCheckCounts === 'object' &&
      !Array.isArray(meta.healthCheckCounts)
        ? (meta.healthCheckCounts as Record<string, unknown>)
        : null;

    if (explicitRaw) {
      return {
        checked: Math.max(0, this.readNumber(explicitRaw.checked)),
        passed: Math.max(0, this.readNumber(explicitRaw.passed)),
        failed: Math.max(0, this.readNumber(explicitRaw.failed)),
        skipped: Math.max(0, this.readNumber(explicitRaw.skipped)),
      };
    }

    return {
      checked: Math.max(0, this.readNumber(row.processedAccounts)),
      passed: Math.max(0, this.readNumber(row.insertedAssets)),
      failed: Math.max(0, this.readNumber(row.updatedAssets)),
      skipped: Math.max(0, this.readNumber(row.skippedAssets)),
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

  private readOptionalNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private readOptionalText(value: unknown): string | undefined {
    const normalized = String(value || '').trim();
    return normalized || undefined;
  }
}
