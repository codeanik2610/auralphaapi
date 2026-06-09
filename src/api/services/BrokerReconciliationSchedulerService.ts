import { Inject, Service } from 'typedi';
import { SchedulerConfig } from '../../database/entities/SchedulerConfig';
import { SchedulerConfigRepository, SchedulerRunLogRepository } from '../../database/repositories';
import { env } from '../../env';
import {
  BrokerReconciliationBatchResponse,
  BrokerReconciliationScheduledRunBody,
  BrokerReconciliationScheduledRunResponse,
} from '../contracts/BrokerReconciliation';
import { BrokerReconciliationBatchService } from './BrokerReconciliationBatchService';

const SCHEDULER_KEY = 'broker-reconciliation-sync';
const SCHEDULER_NAME = 'Broker Reconciliation Sync';
const SCHEDULER_DESCRIPTION =
  'Runs read-only Mudrex/Delta broker evidence sync and app-vs-broker reconciliation matching.';
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_LOCK_MINUTES = 30;
const DEFAULT_FALLBACK_WINDOW_MINUTES = 45;

interface ResolvedWindow {
  startDate: string | null;
  endDate: string | null;
  lookbackHours: number;
}

@Service()
export class BrokerReconciliationSchedulerService {
  @Inject(() => SchedulerConfigRepository)
  private schedulerConfigRepository!: SchedulerConfigRepository;

  @Inject(() => SchedulerRunLogRepository)
  private schedulerRunLogRepository!: SchedulerRunLogRepository;

  @Inject(() => BrokerReconciliationBatchService)
  private brokerReconciliationBatchService!: BrokerReconciliationBatchService;

  async runScheduledBatch(
    body: BrokerReconciliationScheduledRunBody = {}
  ): Promise<BrokerReconciliationScheduledRunResponse> {
    const startedAt = new Date();
    const config = await this.ensureSchedulerConfig();
    const configMap = this.normalizeConfigMap(config.config);
    const force = body.force === true;
    const window = this.resolveWindow(body, configMap);
    const trigger = this.readString(body.trigger) || 'scheduled';

    if (!config.enabled && !force) {
      const runLogId = await this.createOrUpdateRunLog({
        body,
        startedAt,
        status: 'Skipped',
        errorMessage: 'Broker reconciliation scheduler is disabled.',
        meta: {
          phase: 8,
          schedulerKey: SCHEDULER_KEY,
          trigger,
          reason: 'disabled',
          window,
        },
      });
      const finishedAt = new Date();
      await this.markSchedulerFinished(
        config,
        startedAt,
        finishedAt,
        'Warning',
        'Scheduler disabled'
      );
      return {
        schedulerKey: SCHEDULER_KEY,
        runLogId,
        status: 'skipped_disabled',
        locked: false,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        window,
        batch: null,
        errorMessage: 'Broker reconciliation scheduler is disabled.',
      };
    }

    const lockMinutes = this.resolveBoundedInteger(
      body.lockMinutes,
      configMap.lockMinutes,
      DEFAULT_LOCK_MINUTES,
      1,
      240
    );
    const lockUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
    const locked = await this.schedulerConfigRepository.tryAcquireRunLock(SCHEDULER_KEY, lockUntil);

    if (!locked) {
      const runLogId = await this.createOrUpdateRunLog({
        body,
        startedAt,
        status: 'Skipped',
        errorMessage: 'Broker reconciliation batch already running.',
        meta: {
          phase: 8,
          schedulerKey: SCHEDULER_KEY,
          trigger,
          reason: 'lock_active',
          window,
        },
      });
      const finishedAt = new Date();
      await this.markSchedulerFinished(config, startedAt, finishedAt, 'Warning', 'Run lock active');
      return {
        schedulerKey: SCHEDULER_KEY,
        runLogId,
        status: 'skipped_locked',
        locked: false,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        window,
        batch: null,
        errorMessage: 'Broker reconciliation batch already running.',
      };
    }

    let runLogId: string | null = null;
    try {
      runLogId = await this.createOrUpdateRunLog({
        body,
        startedAt,
        status: 'Running',
        meta: {
          phase: 8,
          schedulerKey: SCHEDULER_KEY,
          trigger,
          lockUntil: lockUntil.toISOString(),
          window,
          progress: { total: 0, processed: 0, percent: 0 },
        },
      });

      const batch = await this.brokerReconciliationBatchService.runBatch({
        targetUserIds: this.resolveStringList(body.targetUserIds, [env.scheduler.systemUserId]),
        brokerKeys: this.resolveStringList(body.brokerKeys, this.resolveBrokerKeys(configMap)),
        accountIds: this.resolveStringList(body.accountIds, []),
        accounts: Array.isArray(body.accounts) ? body.accounts : null,
        startDate: window.startDate,
        endDate: window.endDate,
        fallbackWindowMinutes: this.resolveBoundedInteger(
          body.fallbackWindowMinutes,
          configMap.fallbackWindowMinutes,
          DEFAULT_FALLBACK_WINDOW_MINUTES,
          1,
          240
        ),
        sync: this.resolveBoolean(body.sync, configMap.sync, true),
        match: this.resolveBoolean(body.match, configMap.match, true),
      });
      const finishedAt = new Date();
      const warningCount =
        batch.summary.syncFailedAccounts +
        batch.summary.matchFailedAccounts +
        batch.summary.unsupportedBrokerAccounts +
        batch.summary.skippedAccounts;
      const terminalStatus = warningCount > 0 ? 'Warning' : 'Completed';
      const errorMessage =
        warningCount > 0
          ? `Broker reconciliation completed with ${warningCount} account issue(s).`
          : null;

      await this.finishRunLog(runLogId, startedAt, finishedAt, terminalStatus, batch, errorMessage);
      await this.markSchedulerFinished(config, startedAt, finishedAt, terminalStatus, errorMessage);

      return {
        schedulerKey: SCHEDULER_KEY,
        runLogId,
        status: warningCount > 0 ? 'warning' : 'completed',
        locked: true,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        window,
        batch,
        errorMessage,
      };
    } catch (error) {
      const finishedAt = new Date();
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (runLogId) {
        await this.schedulerRunLogRepository.updateRun(runLogId, {
          status: 'Failed',
          finishedAt,
          durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          lastProgressAt: finishedAt,
          errorMessage,
          meta: {
            phase: 8,
            schedulerKey: SCHEDULER_KEY,
            trigger,
            window,
            failure: true,
            errorMessage,
          },
        });
      }
      await this.markSchedulerFinished(config, startedAt, finishedAt, 'Failed', errorMessage);
      return {
        schedulerKey: SCHEDULER_KEY,
        runLogId,
        status: 'failed',
        locked: true,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        window,
        batch: null,
        errorMessage,
      };
    } finally {
      await this.schedulerConfigRepository.releaseRunLock(SCHEDULER_KEY);
    }
  }

  private async ensureSchedulerConfig(): Promise<SchedulerConfig> {
    let config = await this.schedulerConfigRepository.createIfMissing({
      key: SCHEDULER_KEY,
      name: SCHEDULER_NAME,
      description: SCHEDULER_DESCRIPTION,
      enabled: false,
      cronExpression: '*/15 * * * *',
      timezone: 'Asia/Kolkata',
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 200,
      schedulerType: 'user',
      config: {
        sources: ['mudrex', 'delta_exchange'],
        brokerKeys: ['mudrex', 'delta_exchange'],
        retentionDays: 30,
        lookbackHours: DEFAULT_LOOKBACK_HOURS,
        lockMinutes: DEFAULT_LOCK_MINUTES,
        fallbackWindowMinutes: DEFAULT_FALLBACK_WINDOW_MINUTES,
        sync: true,
        match: true,
      },
    });
    const normalizedConfig = this.normalizeConfigMap(config.config);
    const patch: Partial<SchedulerConfig> = {};

    if (String(config.name || '').trim() !== SCHEDULER_NAME) {
      patch.name = SCHEDULER_NAME;
    }
    if (String(config.description || '').trim() !== SCHEDULER_DESCRIPTION) {
      patch.description = SCHEDULER_DESCRIPTION;
    }
    if (!String(config.cronExpression || '').trim()) {
      patch.cronExpression = '*/15 * * * *';
    }
    if (!String(config.timezone || '').trim()) {
      patch.timezone = 'Asia/Kolkata';
    }
    if (!String(config.runAt || '').trim()) {
      patch.runAt = '01:00';
    }
    if (
      String(config.schedulerType || '')
        .trim()
        .toLowerCase() !== 'user'
    ) {
      patch.schedulerType = 'user';
    }
    if (JSON.stringify(config.config ?? null) !== JSON.stringify(normalizedConfig)) {
      patch.config = normalizedConfig;
    }

    if (Object.keys(patch).length > 0) {
      const updated = await this.schedulerConfigRepository.updateByKey(SCHEDULER_KEY, patch);
      if (updated) {
        config = updated;
      }
    }
    return config;
  }

  private async createOrUpdateRunLog(input: {
    body: BrokerReconciliationScheduledRunBody;
    startedAt: Date;
    status: string;
    errorMessage?: string | null;
    meta: Record<string, unknown>;
  }): Promise<string> {
    const runLogId = this.readString(input.body.runLogId);
    const payload = {
      schedulerKey: SCHEDULER_KEY,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: input.status === 'Running' ? null : new Date(),
      durationMs:
        input.status === 'Running' ? null : Math.max(0, Date.now() - input.startedAt.getTime()),
      lastProgressAt: new Date(),
      processedAccounts: 0,
      insertedAssets: 0,
      updatedAssets: 0,
      skippedAssets: 0,
      errorMessage: input.errorMessage ?? null,
      actorUserId: env.scheduler.systemUserId,
      initiatedByType: this.resolveInitiatedByType(input.body.trigger),
      initiatedByUserId: env.scheduler.systemUserId,
      initiatedByLabel: 'Broker reconciliation scheduler',
      executionContext: 'system',
      meta: input.meta,
    };

    if (runLogId) {
      await this.schedulerRunLogRepository.updateRun(runLogId, payload as any);
      return runLogId;
    }

    const run = await this.schedulerRunLogRepository.createRun(payload);
    return run.id;
  }

  private async finishRunLog(
    runLogId: string,
    startedAt: Date,
    finishedAt: Date,
    status: 'Completed' | 'Warning' | 'Failed',
    batch: BrokerReconciliationBatchResponse,
    errorMessage: string | null
  ): Promise<void> {
    await this.schedulerRunLogRepository.updateRun(runLogId, {
      status,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      lastProgressAt: finishedAt,
      processedAccounts: batch.summary.totalAccounts,
      insertedAssets: batch.summary.completedAccounts,
      updatedAssets: batch.summary.syncFailedAccounts + batch.summary.matchFailedAccounts,
      skippedAssets: batch.summary.skippedAccounts + batch.summary.unsupportedBrokerAccounts,
      errorMessage,
      meta: {
        phase: 8,
        schedulerKey: SCHEDULER_KEY,
        batchSummary: batch.summary,
        batchRequested: batch.requested,
        runIds: batch.results.map((item) => ({
          userId: item.userId,
          brokerKey: item.brokerKey,
          accountId: item.accountId,
          status: item.status,
          syncRunId: item.sync.runId,
          matchRunId: item.match.runId,
        })),
        progress: {
          total: batch.summary.totalAccounts,
          processed: batch.summary.totalAccounts,
          percent: 100,
        },
      },
    });
  }

  private async markSchedulerFinished(
    config: SchedulerConfig,
    startedAt: Date,
    finishedAt: Date,
    lastStatus: string,
    lastError: string | null
  ): Promise<void> {
    await this.schedulerConfigRepository.updateByKey(config.key || SCHEDULER_KEY, {
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      lastStatus,
      lastError,
    });
  }

  private resolveWindow(
    body: BrokerReconciliationScheduledRunBody,
    configMap: Record<string, unknown>
  ): ResolvedWindow {
    const lookbackHours = this.resolveBoundedInteger(
      body.lookbackHours,
      configMap.lookbackHours,
      DEFAULT_LOOKBACK_HOURS,
      1,
      24 * 30
    );
    const explicitEnd = this.readString(body.endDate);
    const explicitStart = this.readString(body.startDate);
    const endDate = explicitEnd || new Date().toISOString();
    const startDate =
      explicitStart ||
      new Date(new Date(endDate).getTime() - lookbackHours * 60 * 60 * 1000).toISOString();

    return { startDate, endDate, lookbackHours };
  }

  private normalizeConfigMap(value: unknown): Record<string, unknown> {
    const configMap =
      value && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {};
    const brokerKeys = this.resolveStringList(
      configMap.brokerKeys,
      this.resolveBrokerKeys(configMap)
    );
    configMap.sources = brokerKeys;
    configMap.brokerKeys = brokerKeys;
    configMap.retentionDays = this.resolveBoundedInteger(configMap.retentionDays, null, 30, 1, 365);
    configMap.lookbackHours = this.resolveBoundedInteger(
      configMap.lookbackHours,
      null,
      DEFAULT_LOOKBACK_HOURS,
      1,
      24 * 30
    );
    configMap.lockMinutes = this.resolveBoundedInteger(
      configMap.lockMinutes,
      null,
      DEFAULT_LOCK_MINUTES,
      1,
      240
    );
    configMap.fallbackWindowMinutes = this.resolveBoundedInteger(
      configMap.fallbackWindowMinutes,
      null,
      DEFAULT_FALLBACK_WINDOW_MINUTES,
      1,
      240
    );
    configMap.sync = this.resolveBoolean(configMap.sync, null, true);
    configMap.match = this.resolveBoolean(configMap.match, null, true);
    return configMap;
  }

  private resolveBrokerKeys(configMap: Record<string, unknown>): string[] {
    const brokerKeys = this.resolveStringList(configMap.brokerKeys, []);
    if (brokerKeys.length) {
      return brokerKeys;
    }
    const sources = this.resolveStringList(configMap.sources, []);
    const supportedSources = sources.filter((item) =>
      ['mudrex', 'delta_exchange'].includes(item.toLowerCase())
    );
    return supportedSources.length ? supportedSources : ['mudrex', 'delta_exchange'];
  }

  private resolveStringList(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
    return normalized.length ? Array.from(new Set(normalized)) : fallback;
  }

  private resolveBoundedInteger(
    primary: unknown,
    secondary: unknown,
    fallback: number,
    min: number,
    max: number
  ): number {
    const parsed = Number(primary ?? secondary);
    if (!Number.isInteger(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  private resolveBoolean(primary: unknown, secondary: unknown, fallback: boolean): boolean {
    if (typeof primary === 'boolean') {
      return primary;
    }
    if (typeof secondary === 'boolean') {
      return secondary;
    }
    return fallback;
  }

  private resolveInitiatedByType(value: unknown): string {
    const trigger = this.readString(value)?.toLowerCase() || '';
    if (!trigger) {
      return 'scheduler';
    }
    if (trigger.includes('manual') || trigger.includes('dry_run')) {
      return 'manual';
    }
    if (trigger.includes('cron') || trigger.includes('scheduled') || trigger === 'worker') {
      return 'cron';
    }
    const normalized = trigger.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.slice(0, 32) || 'scheduler';
  }

  private readString(value: unknown): string | null {
    const text = String(value || '').trim();
    return text || null;
  }
}
