import { Request } from 'express';
import { Get, JsonController, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { DiscoveryDependencyHealthResponse } from '../contracts/Discovery';
import { successResponse } from '../utils/response';
import { requireAdminAuthUser, requireAdminAuthUserOrApiKey, requireAuthUserId } from '../utils/auth';
import { AutomationsService } from '../services/AutomationsService';
import { AuthLoginProtectionService } from '../services/AuthLoginProtectionService';
import { DiscoveryDependencyService } from '../services/DiscoveryDependencyService';
import { SuggestedTradesHealthService } from '../services/SuggestedTradesHealthService';
import { AlertRepository } from '../../database/repositories/AlertRepository';
import { BacktestRepository } from '../../database/repositories/BacktestRepository';
import { EmailDeliveryRepository } from '../../database/repositories/EmailDeliveryRepository';
import { assertSecureEnvironmentConfig, env } from '../../env';
import { RedisClient } from '../../lib/RedisClient';

interface HealthPayload {
  status: 'ok';
  timestamp: string;
}

interface QueueHealthPayload {
  status: 'ok' | 'down';
  queue: 'scheduler.exchange-assets.execute';
  timestamp: string;
  latencyMs?: number;
  detail?: string;
}

interface WorkerHealthPayload {
  status: 'ok' | 'down';
  key: string;
  timestamp: string;
  endpoint: string;
  heartbeatStatus?: 'ok' | 'down';
  workerHttpStatus?: 'ok' | 'down';
  workerId?: string;
  lastHeartbeatAt?: string;
  heartbeatAgeMs?: number;
  lastCommandPollAt?: string;
  lastCommandPollDurationMs?: number;
  lastCommandPollProcessedCount?: number;
  commandPollLagMs?: number;
  commandConcurrency?: number;
  activeCommandCount?: number;
  activeScopeCount?: number;
  detail?: string;
}

interface EmailWorkerHealthPayload {
  status: 'ok' | 'down' | 'degraded' | 'disabled';
  key: string;
  timestamp: string;
  emailEnabled: boolean;
  smtpConfigured: boolean;
  queuedCount?: number;
  sendingCount?: number;
  failedCount?: number;
  activeCount?: number;
  oldestPendingAt?: string;
  oldestPendingAgeMs?: number;
  workerId?: string;
  workerStatus?: 'idle' | 'sending' | 'degraded';
  lastHeartbeatAt?: string;
  heartbeatAgeMs?: number;
  heartbeatLagMs?: number;
  heartbeatStaleThresholdMs?: number;
  isHeartbeatStale?: boolean;
  lastBatchStartedAt?: string;
  lastBatchCompletedAt?: string;
  lastBatchAgeMs?: number;
  lastBatchDeliveryCount?: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  pollIntervalMs?: number;
  detail?: string;
}

interface BacktestHealthPayload {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  staleThresholdMinutes: number;
  totalRuns?: number;
  activeRuns?: number;
  queuedRuns?: number;
  runningRuns?: number;
  staleRunningRuns?: number;
  recoverableRuns?: number;
  incompleteTradeHistoryRuns?: number;
  openAlerts?: number;
  openRuntimeAlerts?: number;
  openRecoveryAlerts?: number;
  openPromotionAlerts?: number;
  oldestActiveCreatedAt?: string;
  oldestStaleUpdatedAt?: string;
  detail?: string;
}

interface AutomationHealthPayload {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  totalAutomations?: number;
  runningAutomations?: number;
  pausedAutomations?: number;
  failedAutomations?: number;
  draftAutomations?: number;
  connectedAccounts?: number;
  workerStatus?: 'ok' | 'degraded' | 'down';
  workerHttpStatus?: 'ok' | 'down';
  heartbeatStatus?: 'ok' | 'down';
  workerDetail?: string | null;
  workerHeartbeatAgeMs?: number | null;
  commandPollLagMs?: number | null;
  queueStatus?: 'ok' | 'down';
  queueLatencyMs?: number | null;
  activeRuns?: number;
  failedRuns24h?: number;
  overlapSkips24h?: number;
  staleCursorCount?: number;
  totalCursorCount?: number;
  staleCursorThresholdMinutes?: number;
  lastCursorAt?: string | null;
  lastTriggeredSignalAt?: string | null;
  openAlerts?: number;
  openControlAlerts?: number;
  openRecoveryAlerts?: number;
  openExecutionAlerts?: number;
  detail?: string;
}

interface SuggestedTradeHealthPayload {
  status: 'ok' | 'degraded' | 'down' | 'disabled';
  timestamp: string;
  rolloutEnabled: boolean;
  rolloutStage: string;
  backgroundSyncEnabled?: boolean;
  syncState?: 'healthy' | 'attention' | 'running' | 'paused';
  syncLabel?: string;
  syncSummary?: string;
  trackedTrades?: number;
  staleTrackedTrades?: number;
  terminalTrackedTrades?: number;
  totalSuggestedTrades?: number;
  openSuggestions?: number;
  reviewedSuggestions?: number;
  acceptedSuggestions?: number;
  dismissedSuggestions?: number;
  readyForOrderCount?: number;
  convertedToOrderCount?: number;
  linkedSuggestions?: number;
  workingSuggestions?: number;
  filledSuggestions?: number;
  closedSuggestions?: number;
  queueToOrderConversionRate?: number | null;
  queueToOrderSuccess24h?: number;
  summaryRuns24h?: number;
  suggestedTradesCreated24h?: number;
  duplicateSuggestions24h?: number;
  refreshFailures24h?: number;
  stateTransitionFailures24h?: number;
  openAlerts?: number;
  openActionAlerts?: number;
  openExecutionAlerts?: number;
  probeUserId?: string | null;
  overviewLatencyMs?: number | null;
  listLatencyMs?: number | null;
  summaryLatencyMs?: number | null;
  syncStatusLatencyMs?: number | null;
  latencyProbeError?: string | null;
  detail?: string;
}

interface ObservabilityHealthPayload {
  status: 'ok';
  timestamp: string;
  config: {
    autoCaptureEnabled: boolean;
    captureReadRequests: boolean;
    emitFailureAlerts: boolean;
    emit4xxMutationAlerts: boolean;
    emit5xxAlerts: boolean;
    failureAlertThrottleMinutes: number;
  };
}

interface AuthHealthPayload {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  protections: {
    loginProtectionEnabled: boolean;
    apiKeyRequired: boolean;
    apiKeyConfigured: boolean;
    seedEnabled: boolean;
    secureConfigValidated: boolean;
    secureConfigDetail?: string;
  };
  tokenPolicy: {
    accessTokenTtl: string;
    refreshTokenDays: number;
  };
  throttling: {
    pairMaxAttempts: number;
    ipMaxAttempts: number;
    windowMinutes: number;
    lockoutMinutes: number;
    trackedBuckets: number;
    activePairLockouts: number;
    activeIpLockouts: number;
    pairFailuresInWindow: number;
    ipFailuresInWindow: number;
    nextLockoutExpiresAt: string | null;
  };
  detail?: string;
}

@JsonController('/health')
@Service()
export class HealthController {
  @Inject(() => AutomationsService)
  private automationsService!: AutomationsService;

  @Inject(() => AuthLoginProtectionService)
  private authLoginProtectionService!: AuthLoginProtectionService;

  @Inject(() => DiscoveryDependencyService)
  private discoveryDependencyService!: DiscoveryDependencyService;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => BacktestRepository)
  private backtestRepository!: BacktestRepository;

  @Inject(() => EmailDeliveryRepository)
  private emailDeliveryRepository!: EmailDeliveryRepository;

  @Inject(() => SuggestedTradesHealthService)
  private suggestedTradesHealthService!: SuggestedTradesHealthService;

  private readAuthSecurityValidation(): { ok: boolean; detail?: string } {
    try {
      assertSecureEnvironmentConfig({
        node: env.node,
        appEnvironment: env.app.environment,
        appRequireApiKey: env.app.requireApiKey,
        appApiKey: env.app.apiKey,
        authAccessTokenSecret: env.auth.accessTokenSecret,
        discoverySchedulerSecret: env.scheduler.discovery.schedulerSecret,
        brokerAccountSecretsKey: env.security.brokerAccountSecretsKey,
        authSeedEnabled: env.auth.seedEnabled,
        authSeedEmail: env.auth.seedEmail,
        authSeedPassword: env.auth.seedPassword,
        authSeedFullName: env.auth.seedFullName,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
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
      EmailWorkerHealthPayload,
      | 'queuedCount'
      | 'sendingCount'
      | 'failedCount'
      | 'activeCount'
      | 'oldestPendingAt'
      | 'oldestPendingAgeMs'
    >
  > {
    try {
      const snapshot = await this.emailDeliveryRepository.getOperationalSnapshot();
      return {
        queuedCount: snapshot.queued,
        sendingCount: snapshot.sending,
        failedCount: snapshot.failed,
        activeCount: snapshot.active,
        oldestPendingAt: snapshot.oldestPendingAt?.toISOString(),
        oldestPendingAgeMs: snapshot.oldestPendingAgeMs ?? undefined,
      };
    } catch {
      return {};
    }
  }

  private async readBacktestAlertMetrics(): Promise<
    Pick<
      BacktestHealthPayload,
      'openAlerts' | 'openRuntimeAlerts' | 'openRecoveryAlerts' | 'openPromotionAlerts' | 'detail'
    >
  > {
    try {
      const snapshot = await this.alertRepository.getOpenChannelSnapshot('Backtests', [
        'backtests',
        'backtests:recovery',
        'backtests:promotion',
      ]);

      return {
        openAlerts: snapshot.openAlerts,
        openRuntimeAlerts: snapshot.openAlertsBySource.backtests ?? 0,
        openRecoveryAlerts: snapshot.openAlertsBySource['backtests:recovery'] ?? 0,
        openPromotionAlerts: snapshot.openAlertsBySource['backtests:promotion'] ?? 0,
      };
    } catch (error) {
      return {
        detail:
          error instanceof Error
            ? `Backtest alert query failed: ${error.message}`
            : `Backtest alert query failed: ${String(error)}`,
      };
    }
  }

  private async readAutomationAlertMetrics(): Promise<
    Pick<
      AutomationHealthPayload,
      'openAlerts' | 'openControlAlerts' | 'openRecoveryAlerts' | 'openExecutionAlerts' | 'detail'
    >
  > {
    try {
      const snapshot = await this.alertRepository.getOpenChannelSnapshot('Automation', [
        'automations',
        'automations:recovery',
        'automation-execution',
      ]);

      return {
        openAlerts: snapshot.openAlerts,
        openControlAlerts: snapshot.openAlertsBySource.automations ?? 0,
        openRecoveryAlerts: snapshot.openAlertsBySource['automations:recovery'] ?? 0,
        openExecutionAlerts: snapshot.openAlertsBySource['automation-execution'] ?? 0,
      };
    } catch (error) {
      return {
        detail:
          error instanceof Error
            ? `Automation alert query failed: ${error.message}`
            : `Automation alert query failed: ${String(error)}`,
      };
    }
  }

  @Get()
  getHealth(): ApiSuccessResponse<HealthPayload> {
    return successResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  @Get('/queue')
  async getQueueHealth(): Promise<ApiSuccessResponse<QueueHealthPayload>> {
    const startedAt = Date.now();
    try {
      const pong = await RedisClient.getConnection().ping();
      const latencyMs = Date.now() - startedAt;
      return successResponse({
        status: pong === 'PONG' ? 'ok' : 'down',
        queue: 'scheduler.exchange-assets.execute',
        timestamp: new Date().toISOString(),
        latencyMs,
        ...(pong === 'PONG' ? {} : { detail: `Unexpected Redis ping response: ${pong}` }),
      });
    } catch (error) {
      return successResponse({
        status: 'down',
        queue: 'scheduler.exchange-assets.execute',
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @Get('/discovery')
  async getDiscoveryDependencyHealth(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<DiscoveryDependencyHealthResponse>> {
    requireAuthUserId(request);

    const authorizationHeader = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;

    return successResponse(
      await this.discoveryDependencyService.getDependencyHealth(authorizationHeader)
    );
  }

  @Get('/worker')
  async getWorkerHealth(): Promise<ApiSuccessResponse<WorkerHealthPayload>> {
    const heartbeatKey = env.redis.workerHeartbeatKey;
    const workerEndpoint = env.scheduler.worker.baseUrl;
    const workerHttpHealth = await this.readWorkerHttpHealth(workerEndpoint);
    try {
      const rawHeartbeat = await RedisClient.getConnection().get(heartbeatKey);
      if (!rawHeartbeat) {
        return successResponse({
          status: 'down',
          key: heartbeatKey,
          endpoint: workerEndpoint,
          heartbeatStatus: 'down',
          workerHttpStatus: workerHttpHealth.status,
          timestamp: new Date().toISOString(),
          detail:
            workerHttpHealth.status === 'down'
              ? `No active worker heartbeat found; worker health check failed: ${workerHttpHealth.detail || 'unknown error'}`
              : 'No active worker heartbeat found',
        });
      }

      let parsed: {
        workerId?: string;
        timestamp?: string;
        lastCommandPollAt?: string;
        lastCommandPollDurationMs?: number;
        lastCommandPollProcessedCount?: number;
        commandConcurrency?: number;
        activeCommandCount?: number;
        activeScopeCount?: number;
      } = {};
      try {
        parsed = JSON.parse(rawHeartbeat) as { workerId?: string; timestamp?: string };
      } catch {
        parsed = {};
      }
      const parsedHeartbeatDate = parsed.timestamp ? new Date(parsed.timestamp) : null;
      const heartbeatAgeMs =
        parsedHeartbeatDate && !Number.isNaN(parsedHeartbeatDate.getTime())
          ? Math.max(0, Date.now() - parsedHeartbeatDate.getTime())
          : undefined;
      const parsedCommandPollDate = parsed.lastCommandPollAt
        ? new Date(parsed.lastCommandPollAt)
        : null;
      const commandPollLagMs =
        parsedCommandPollDate && !Number.isNaN(parsedCommandPollDate.getTime())
          ? Math.max(0, Date.now() - parsedCommandPollDate.getTime())
          : undefined;

      return successResponse({
        status: workerHttpHealth.status === 'ok' ? 'ok' : 'down',
        key: heartbeatKey,
        endpoint: workerEndpoint,
        heartbeatStatus: 'ok',
        workerHttpStatus: workerHttpHealth.status,
        timestamp: new Date().toISOString(),
        workerId: parsed.workerId,
        lastHeartbeatAt: parsed.timestamp,
        heartbeatAgeMs,
        lastCommandPollAt: parsed.lastCommandPollAt,
        lastCommandPollDurationMs:
          typeof parsed.lastCommandPollDurationMs === 'number'
            ? parsed.lastCommandPollDurationMs
            : undefined,
        lastCommandPollProcessedCount:
          typeof parsed.lastCommandPollProcessedCount === 'number'
            ? parsed.lastCommandPollProcessedCount
            : undefined,
        commandConcurrency:
          typeof parsed.commandConcurrency === 'number' ? parsed.commandConcurrency : undefined,
        activeCommandCount:
          typeof parsed.activeCommandCount === 'number' ? parsed.activeCommandCount : undefined,
        activeScopeCount:
          typeof parsed.activeScopeCount === 'number' ? parsed.activeScopeCount : undefined,
        commandPollLagMs,
        ...(workerHttpHealth.status === 'down'
          ? {
              detail: `Worker heartbeat is present but HTTP health failed: ${
                workerHttpHealth.detail || 'unknown error'
              }`,
            }
          : {}),
      });
    } catch (error) {
      return successResponse({
        status: 'down',
        key: heartbeatKey,
        endpoint: workerEndpoint,
        heartbeatStatus: 'down',
        workerHttpStatus: workerHttpHealth.status,
        timestamp: new Date().toISOString(),
        detail:
          error instanceof Error
            ? `Redis heartbeat read failed: ${error.message}`
            : `Redis heartbeat read failed: ${String(error)}`,
      });
    }
  }

  @Get('/email-worker')
  async getEmailWorkerHealth(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<EmailWorkerHealthPayload>> {
    requireAdminAuthUser(request);
    const heartbeatKey = env.redis.emailWorkerHeartbeatKey;
    const smtpConfigured = Boolean(env.email.smtp.host && env.email.smtp.from);
    const queueMetrics = await this.readEmailQueueMetrics();

    if (!env.email.enabled) {
      return successResponse({
        status: 'disabled',
        key: heartbeatKey,
        timestamp: new Date().toISOString(),
        emailEnabled: false,
        smtpConfigured,
        ...queueMetrics,
        detail: 'Email delivery is disabled in environment configuration.',
      });
    }

    try {
      const rawHeartbeat = await RedisClient.getConnection().get(heartbeatKey);
      if (!rawHeartbeat) {
        return successResponse({
          status: 'down',
          key: heartbeatKey,
          timestamp: new Date().toISOString(),
          emailEnabled: true,
          smtpConfigured,
          ...queueMetrics,
          detail: 'No active email worker heartbeat found.',
        });
      }

      let parsed: {
        workerId?: string;
        timestamp?: string;
        status?: 'idle' | 'sending' | 'degraded';
        lastBatchStartedAt?: string;
        lastBatchCompletedAt?: string;
        lastBatchDeliveryCount?: number;
        lastSuccessAt?: string;
        lastFailureAt?: string;
        lastError?: string | null;
        pollIntervalMs?: number;
      } = {};

      try {
        parsed = JSON.parse(rawHeartbeat) as typeof parsed;
      } catch {
        parsed = {};
      }

      const parsedHeartbeatDate = parsed.timestamp ? new Date(parsed.timestamp) : null;
      const heartbeatAgeMs =
        parsedHeartbeatDate && !Number.isNaN(parsedHeartbeatDate.getTime())
          ? Math.max(0, Date.now() - parsedHeartbeatDate.getTime())
          : undefined;
      const pollIntervalMs =
        typeof parsed.pollIntervalMs === 'number' ? parsed.pollIntervalMs : undefined;
      const heartbeatStaleThresholdMs =
        pollIntervalMs !== undefined ? Math.max(30_000, pollIntervalMs * 3) : undefined;
      const heartbeatLagMs =
        heartbeatAgeMs !== undefined && pollIntervalMs !== undefined
          ? Math.max(0, heartbeatAgeMs - pollIntervalMs)
          : undefined;
      const isHeartbeatStale =
        heartbeatAgeMs !== undefined && heartbeatStaleThresholdMs !== undefined
          ? heartbeatAgeMs > heartbeatStaleThresholdMs
          : undefined;
      const parsedLastBatchCompletedAt = parsed.lastBatchCompletedAt
        ? new Date(parsed.lastBatchCompletedAt)
        : null;
      const lastBatchAgeMs =
        parsedLastBatchCompletedAt && !Number.isNaN(parsedLastBatchCompletedAt.getTime())
          ? Math.max(0, Date.now() - parsedLastBatchCompletedAt.getTime())
          : undefined;
      const workerStatus = parsed.status || 'idle';
      const detailParts: string[] = [];

      if (parsed.lastError) {
        detailParts.push(parsed.lastError);
      }

      if (isHeartbeatStale) {
        detailParts.push('Email worker heartbeat is older than the expected polling window.');
      }

      return successResponse({
        status: workerStatus === 'degraded' || isHeartbeatStale ? 'degraded' : 'ok',
        key: heartbeatKey,
        timestamp: new Date().toISOString(),
        emailEnabled: true,
        smtpConfigured,
        ...queueMetrics,
        workerId: parsed.workerId,
        workerStatus,
        lastHeartbeatAt: parsed.timestamp,
        heartbeatAgeMs,
        heartbeatLagMs,
        heartbeatStaleThresholdMs,
        isHeartbeatStale,
        lastBatchStartedAt: parsed.lastBatchStartedAt,
        lastBatchCompletedAt: parsed.lastBatchCompletedAt,
        lastBatchAgeMs,
        lastBatchDeliveryCount:
          typeof parsed.lastBatchDeliveryCount === 'number'
            ? parsed.lastBatchDeliveryCount
            : undefined,
        lastSuccessAt: parsed.lastSuccessAt,
        lastFailureAt: parsed.lastFailureAt,
        lastError: parsed.lastError || undefined,
        pollIntervalMs,
        ...((workerStatus === 'degraded' || isHeartbeatStale) && detailParts.length > 0
          ? {
              detail: detailParts.join(' '),
            }
          : workerStatus === 'degraded'
            ? {
                detail: 'Email worker is alive, but the latest batch recorded failures.',
              }
            : {}),
      });
    } catch (error) {
      return successResponse({
        status: 'down',
        key: heartbeatKey,
        timestamp: new Date().toISOString(),
        emailEnabled: true,
        smtpConfigured,
        ...queueMetrics,
        detail:
          error instanceof Error
            ? `Redis heartbeat read failed: ${error.message}`
            : `Redis heartbeat read failed: ${String(error)}`,
      });
    }
  }

  @Get('/backtests')
  async getBacktestHealth(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<BacktestHealthPayload>> {
    requireAdminAuthUserOrApiKey(request);
    const staleThresholdMinutes = 30;

    try {
      const snapshot = await this.backtestRepository.getOperationalSnapshot(staleThresholdMinutes);
      const alertMetrics = await this.readBacktestAlertMetrics();
      const detailParts: string[] = [];

      if (snapshot.staleRunningRuns > 0) {
        detailParts.push(
          `${snapshot.staleRunningRuns} running backtest${snapshot.staleRunningRuns === 1 ? '' : 's'} have not updated inside the stale threshold.`
        );
      }

      if (snapshot.incompleteTradeHistoryRuns > 0) {
        detailParts.push(
          `${snapshot.incompleteTradeHistoryRuns} backtest${snapshot.incompleteTradeHistoryRuns === 1 ? '' : 's'} report fewer stored trade events than expected.`
        );
      }

      if (snapshot.recoverableRuns > 0) {
        detailParts.push(
          `${snapshot.recoverableRuns} backtest${snapshot.recoverableRuns === 1 ? ' is' : 's are'} recoverable from checkpoint.`
        );
      }

      if ((alertMetrics.openAlerts ?? 0) > 0) {
        detailParts.push(
          `${alertMetrics.openAlerts} open Backtests alert${alertMetrics.openAlerts === 1 ? '' : 's'} remain in the inbox.`
        );
      }

      if (alertMetrics.detail) {
        detailParts.push(alertMetrics.detail);
      }

      return successResponse({
        status:
          snapshot.staleRunningRuns > 0 || snapshot.incompleteTradeHistoryRuns > 0
            ? 'degraded'
            : 'ok',
        timestamp: new Date().toISOString(),
        staleThresholdMinutes,
        totalRuns: snapshot.totalRuns,
        activeRuns: snapshot.activeRuns,
        queuedRuns: snapshot.queuedRuns,
        runningRuns: snapshot.runningRuns,
        staleRunningRuns: snapshot.staleRunningRuns,
        recoverableRuns: snapshot.recoverableRuns,
        incompleteTradeHistoryRuns: snapshot.incompleteTradeHistoryRuns,
        openAlerts: alertMetrics.openAlerts,
        openRuntimeAlerts: alertMetrics.openRuntimeAlerts,
        openRecoveryAlerts: alertMetrics.openRecoveryAlerts,
        openPromotionAlerts: alertMetrics.openPromotionAlerts,
        oldestActiveCreatedAt: snapshot.oldestActiveCreatedAt?.toISOString(),
        oldestStaleUpdatedAt: snapshot.oldestStaleUpdatedAt?.toISOString(),
        ...(detailParts.length ? { detail: detailParts.join(' ') } : {}),
      });
    } catch (error) {
      return successResponse({
        status: 'down',
        timestamp: new Date().toISOString(),
        staleThresholdMinutes,
        detail:
          error instanceof Error
            ? `Backtest health query failed: ${error.message}`
            : `Backtest health query failed: ${String(error)}`,
      });
    }
  }

  @Get('/automations')
  async getAutomationHealth(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<AutomationHealthPayload>> {
    requireAdminAuthUserOrApiKey(request);

    try {
      const [snapshot, alertMetrics] = await Promise.all([
        this.automationsService.getAutomationOperationalSnapshot(),
        this.readAutomationAlertMetrics(),
      ]);
      const detailParts: string[] = [];

      if (snapshot.detail) {
        detailParts.push(snapshot.detail);
      }

      if ((alertMetrics.openAlerts ?? 0) > 0) {
        detailParts.push(
          `${alertMetrics.openAlerts} open Automation alert${alertMetrics.openAlerts === 1 ? '' : 's'} remain in the inbox.`
        );
      }

      if (alertMetrics.detail) {
        detailParts.push(alertMetrics.detail);
      }

      return successResponse({
        status:
          snapshot.healthStatus === 'down'
            ? 'down'
            : snapshot.healthStatus === 'degraded' || (alertMetrics.openAlerts ?? 0) > 0
              ? 'degraded'
              : 'ok',
        timestamp: new Date().toISOString(),
        totalAutomations: snapshot.total,
        runningAutomations: snapshot.running,
        pausedAutomations: snapshot.paused,
        failedAutomations: snapshot.failed,
        draftAutomations: snapshot.draft,
        connectedAccounts: snapshot.connectedAccounts,
        workerStatus: snapshot.summary.workerStatus,
        workerHttpStatus: snapshot.summary.workerHttpStatus,
        heartbeatStatus: snapshot.summary.heartbeatStatus,
        workerDetail: snapshot.summary.workerDetail,
        workerHeartbeatAgeMs: snapshot.summary.workerHeartbeatAgeMs ?? null,
        commandPollLagMs: snapshot.summary.commandPollLagMs ?? null,
        queueStatus: snapshot.summary.queueStatus,
        queueLatencyMs: snapshot.summary.queueLatencyMs ?? null,
        activeRuns: snapshot.summary.activeRuns,
        failedRuns24h: snapshot.summary.failedRuns24h,
        overlapSkips24h: snapshot.summary.overlapSkips24h,
        staleCursorCount: snapshot.summary.staleCursorCount,
        totalCursorCount: snapshot.summary.totalCursorCount,
        staleCursorThresholdMinutes: snapshot.summary.staleCursorThresholdMinutes,
        lastCursorAt: snapshot.summary.lastCursorAt ?? null,
        lastTriggeredSignalAt: snapshot.summary.lastTriggeredSignalAt ?? null,
        openAlerts: alertMetrics.openAlerts,
        openControlAlerts: alertMetrics.openControlAlerts,
        openRecoveryAlerts: alertMetrics.openRecoveryAlerts,
        openExecutionAlerts: alertMetrics.openExecutionAlerts,
        ...(detailParts.length ? { detail: detailParts.join(' ') } : {}),
      });
    } catch (error) {
      return successResponse({
        status: 'down',
        timestamp: new Date().toISOString(),
        detail:
          error instanceof Error
            ? `Automation health query failed: ${error.message}`
            : `Automation health query failed: ${String(error)}`,
      });
    }
  }

  @Get('/suggested-trades')
  async getSuggestedTradeHealth(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SuggestedTradeHealthPayload>> {
    const context = requireAdminAuthUserOrApiKey(request);
    const probeUserId = context?.userId ?? null;

    try {
      return successResponse(
        await this.suggestedTradesHealthService.getOperationalSnapshot({
          probeUserId,
        })
      );
    } catch (error) {
      return successResponse({
        status: 'down',
        timestamp: new Date().toISOString(),
        rolloutEnabled: env.suggestedTrades.rolloutEnabled,
        rolloutStage: env.suggestedTrades.rolloutStage,
        detail:
          error instanceof Error
            ? `Suggested trades health query failed: ${error.message}`
            : `Suggested trades health query failed: ${String(error)}`,
      });
    }
  }

  @Get('/auth')
  getAuthHealth(@Req() request: Request): ApiSuccessResponse<AuthHealthPayload> {
    requireAdminAuthUserOrApiKey(request);

    const securityValidation = this.readAuthSecurityValidation();
    const throttlingSnapshot = this.authLoginProtectionService.getSnapshot();

    let status: AuthHealthPayload['status'] = 'ok';
    let detail = '';

    if (!securityValidation.ok) {
      status = 'down';
      detail = securityValidation.detail || 'Auth security validation failed.';
    } else if (!env.auth.loginProtectionEnabled) {
      status = 'down';
      detail = 'Login throttling is disabled.';
    } else if (
      throttlingSnapshot.activePairLockouts > 0 ||
      throttlingSnapshot.activeIpLockouts > 0
    ) {
      status = 'degraded';
      detail = 'Active login lockouts detected. Review recent auth failures before rollout.';
    }

    return successResponse({
      status,
      timestamp: new Date().toISOString(),
      protections: {
        loginProtectionEnabled: env.auth.loginProtectionEnabled,
        apiKeyRequired: env.app.requireApiKey,
        apiKeyConfigured: Boolean(String(env.app.apiKey || '').trim()),
        seedEnabled: env.auth.seedEnabled,
        secureConfigValidated: securityValidation.ok,
        ...(securityValidation.ok
          ? {}
          : { secureConfigDetail: securityValidation.detail || 'Unknown validation failure' }),
      },
      tokenPolicy: {
        accessTokenTtl: String(env.auth.accessTokenTtl),
        refreshTokenDays: env.auth.refreshTokenDays,
      },
      throttling: {
        pairMaxAttempts: env.auth.loginMaxAttempts,
        ipMaxAttempts: env.auth.loginIpMaxAttempts,
        windowMinutes: env.auth.loginWindowMinutes,
        lockoutMinutes: env.auth.loginLockoutMinutes,
        trackedBuckets: throttlingSnapshot.trackedBuckets,
        activePairLockouts: throttlingSnapshot.activePairLockouts,
        activeIpLockouts: throttlingSnapshot.activeIpLockouts,
        pairFailuresInWindow: throttlingSnapshot.pairFailuresInWindow,
        ipFailuresInWindow: throttlingSnapshot.ipFailuresInWindow,
        nextLockoutExpiresAt: throttlingSnapshot.nextLockoutExpiresAt,
      },
      ...(detail ? { detail } : {}),
    });
  }

  @Get('/ops')
  getObservabilityHealth(): ApiSuccessResponse<ObservabilityHealthPayload> {
    return successResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
      config: {
        autoCaptureEnabled: env.observability.autoCaptureEnabled,
        captureReadRequests: env.observability.captureReadRequests,
        emitFailureAlerts: env.observability.emitFailureAlerts,
        emit4xxMutationAlerts: env.observability.emit4xxMutationAlerts,
        emit5xxAlerts: env.observability.emit5xxAlerts,
        failureAlertThrottleMinutes: env.observability.failureAlertThrottleMinutes,
      },
    });
  }
}
