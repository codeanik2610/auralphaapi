import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({
  path: path.join(process.cwd(), '.env'),
});

const defaultDiscoveryEngineRoot = path.resolve(process.cwd(), '..', 'discovery-engine');
const defaultLocalAccessTokenSecret = 'auralpha-local-access-secret';
const defaultLocalDiscoverySchedulerSecret = 'auralpha-discovery-scheduler-secret';
const defaultLocalBrokerAccountSecretsKey = 'auralpha-local-broker-account-secrets-key';
const defaultLocalSeedEmail = 'admin@auralpha.com';
const defaultLocalSeedPassword = 'Admin@123';
const defaultLocalSeedFullName = 'AurAlpha Admin';

const normalizeEnvValue = (value: string | undefined): string => String(value || '').trim();

const resolveEmailProvider = (value: string | undefined): 'smtp' | 'resend' => {
  const normalized = normalizeEnvValue(value).toLowerCase();
  if (!normalized || normalized === 'smtp') {
    return 'smtp';
  }

  if (normalized === 'resend') {
    return 'resend';
  }

  throw new Error('EMAIL_PROVIDER must be set to "smtp" or "resend"');
};

const getNumber = (key: string, fallback: number): number => {
  const value = process.env[key];
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
};

const getBool = (key: string, fallback: boolean): boolean => {
  const value = process.env[key];
  if (value === undefined) {
    return fallback;
  }
  return value === 'true' || value === '1';
};

const getArray = (key: string): string[] => {
  const value = process.env[key];
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const resolveActivityExportStorageMode = (value: string | undefined): 'filesystem' => {
  const normalized = normalizeEnvValue(value).toLowerCase();
  if (!normalized || normalized === 'filesystem') {
    return 'filesystem';
  }

  throw new Error('ACTIVITY_EXPORT_STORAGE_MODE must be set to "filesystem"');
};

const resolveSuggestedTradesAdaptiveRoutingMode = (
  value: string | undefined
): 'off' | 'shadow' | 'live' => {
  const normalized = normalizeEnvValue(value).toLowerCase();
  if (!normalized || normalized === 'live') {
    return 'live';
  }
  if (normalized === 'shadow' || normalized === 'off') {
    return normalized;
  }

  throw new Error(
    'SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE must be set to "off", "shadow", or "live"'
  );
};

const resolveStringWithLocalFallback = (
  value: string | undefined,
  localFallback: string,
  localEnvironment: boolean
): string => {
  const normalized = normalizeEnvValue(value);
  if (normalized) {
    return normalized;
  }

  return localEnvironment ? localFallback : '';
};

export function isLocalAppEnvironment(environment: string | undefined): boolean {
  return normalizeEnvValue(environment || 'localhost').toLowerCase() === 'localhost';
}

export function resolveAuthSeedConfig(
  rawEnv: NodeJS.ProcessEnv,
  appEnvironment = rawEnv.APP_ENV || 'localhost'
): {
  enabled: boolean;
  email: string;
  password: string;
  fullName: string;
} {
  const localEnvironment = isLocalAppEnvironment(appEnvironment);
  const enabled =
    rawEnv.AUTH_SEED_ENABLED !== undefined
      ? rawEnv.AUTH_SEED_ENABLED === 'true' || rawEnv.AUTH_SEED_ENABLED === '1'
      : localEnvironment;

  return {
    enabled,
    email:
      normalizeEnvValue(rawEnv.AUTH_SEED_EMAIL) || (localEnvironment ? defaultLocalSeedEmail : ''),
    password:
      normalizeEnvValue(rawEnv.AUTH_SEED_PASSWORD) ||
      (localEnvironment ? defaultLocalSeedPassword : ''),
    fullName:
      normalizeEnvValue(rawEnv.AUTH_SEED_FULL_NAME) ||
      (localEnvironment ? defaultLocalSeedFullName : ''),
  };
}

type SecurityConfigValidationInput = {
  node: string;
  appEnvironment: string;
  appRequireApiKey: boolean;
  appApiKey: string;
  authAccessTokenSecret: string;
  discoverySchedulerSecret: string;
  brokerAccountSecretsKey: string;
  authSeedEnabled: boolean;
  authSeedEmail: string;
  authSeedPassword: string;
  authSeedFullName: string;
  schedulerExecutionMode: 'direct' | 'queue';
  schedulerWorkerBaseUrl: string;
  redisHost: string;
  redisAutoStart: boolean;
  dbHost: string;
  dbUsername: string;
  dbPassword: string;
  dbDatabase: string;
  dbSynchronize: boolean;
  pgEnabled: boolean;
  pgHost: string;
  pgUsername: string;
  pgPassword: string;
  pgDatabase: string;
  activityExportStorageMode: 'filesystem';
  activityExportStorageDir: string;
};

function isUnsafeConfiguredValue(value: string | undefined, disallowed: string[] = []): boolean {
  const normalized = normalizeEnvValue(value);
  if (!normalized) {
    return true;
  }

  return disallowed.includes(normalized);
}

export function assertSecureEnvironmentConfig(config: SecurityConfigValidationInput): void {
  if (config.node === 'test' || isLocalAppEnvironment(config.appEnvironment)) {
    return;
  }

  if (
    isUnsafeConfiguredValue(config.authAccessTokenSecret, [
      defaultLocalAccessTokenSecret,
      'change-me',
    ])
  ) {
    throw new Error(
      'AUTH_ACCESS_TOKEN_SECRET must be set to a strong custom value outside localhost'
    );
  }

  if (
    isUnsafeConfiguredValue(config.discoverySchedulerSecret, [
      defaultLocalDiscoverySchedulerSecret,
      'change-me',
    ])
  ) {
    throw new Error(
      'DISCOVERY_SCHEDULER_SECRET must be set to a strong custom value outside localhost'
    );
  }

  if (
    isUnsafeConfiguredValue(config.brokerAccountSecretsKey, [
      defaultLocalBrokerAccountSecretsKey,
      'change-me',
      'change-me-strong-random-secret',
    ])
  ) {
    throw new Error(
      'BROKER_ACCOUNT_SECRETS_KEY must be set to a strong custom value outside localhost'
    );
  }

  if (config.appRequireApiKey && isUnsafeConfiguredValue(config.appApiKey, ['change-me'])) {
    throw new Error(
      'APP_API_KEY must be set to a strong custom value when APP_REQUIRE_API_KEY is enabled outside localhost'
    );
  }

  if (config.authSeedEnabled) {
    if (
      isUnsafeConfiguredValue(config.authSeedEmail, [defaultLocalSeedEmail]) ||
      isUnsafeConfiguredValue(config.authSeedPassword, [defaultLocalSeedPassword]) ||
      isUnsafeConfiguredValue(config.authSeedFullName)
    ) {
      throw new Error(
        'AUTH_SEED_EMAIL, AUTH_SEED_PASSWORD, and AUTH_SEED_FULL_NAME must be set to explicit non-default values when AUTH_SEED_ENABLED is true outside localhost'
      );
    }
  }

  if (config.redisAutoStart) {
    throw new Error('REDIS_AUTO_START must remain disabled outside localhost');
  }

  if (
    config.schedulerExecutionMode === 'queue' &&
    isUnsafeConfiguredValue(config.schedulerWorkerBaseUrl)
  ) {
    throw new Error(
      'SCHEDULER_WORKER_BASE_URL must be explicitly set when SCHEDULER_EXECUTION_MODE=queue outside localhost'
    );
  }

  if (isUnsafeConfiguredValue(config.redisHost)) {
    throw new Error('REDIS_HOST must be explicitly set outside localhost');
  }

  if (isUnsafeConfiguredValue(config.dbHost)) {
    throw new Error('DB_HOST must be explicitly set outside localhost');
  }

  if (isUnsafeConfiguredValue(config.dbUsername)) {
    throw new Error('DB_USERNAME must be explicitly set outside localhost');
  }

  if (isUnsafeConfiguredValue(config.dbPassword)) {
    throw new Error('DB_PASSWORD must be explicitly set outside localhost');
  }

  if (isUnsafeConfiguredValue(config.dbDatabase)) {
    throw new Error('DB_NAME must be explicitly set outside localhost');
  }

  if (config.dbSynchronize) {
    throw new Error('DB_SYNCHRONIZE must remain disabled outside localhost');
  }

  if (config.pgEnabled) {
    if (isUnsafeConfiguredValue(config.pgHost)) {
      throw new Error(
        'PG_DB_HOST must be explicitly set when PG_DB_ENABLED=true outside localhost'
      );
    }

    if (isUnsafeConfiguredValue(config.pgUsername)) {
      throw new Error(
        'PG_DB_USERNAME must be explicitly set when PG_DB_ENABLED=true outside localhost'
      );
    }

    if (isUnsafeConfiguredValue(config.pgPassword)) {
      throw new Error(
        'PG_DB_PASSWORD must be explicitly set when PG_DB_ENABLED=true outside localhost'
      );
    }

    if (isUnsafeConfiguredValue(config.pgDatabase)) {
      throw new Error(
        'PG_DB_NAME must be explicitly set when PG_DB_ENABLED=true outside localhost'
      );
    }
  }

  if (
    config.activityExportStorageMode === 'filesystem' &&
    isUnsafeConfiguredValue(config.activityExportStorageDir)
  ) {
    throw new Error(
      'ACTIVITY_EXPORT_STORAGE_DIR must be explicitly set when ACTIVITY_EXPORT_STORAGE_MODE=filesystem outside localhost'
    );
  }

  if (getBool('WHATSAPP_DELIVERY_ENABLED', false)) {
    if (isUnsafeConfiguredValue(process.env.WHATSAPP_TWILIO_ACCOUNT_SID)) {
      throw new Error(
        'WHATSAPP_TWILIO_ACCOUNT_SID must be explicitly set when WHATSAPP_DELIVERY_ENABLED=true outside localhost'
      );
    }

    if (isUnsafeConfiguredValue(process.env.WHATSAPP_TWILIO_AUTH_TOKEN)) {
      throw new Error(
        'WHATSAPP_TWILIO_AUTH_TOKEN must be explicitly set when WHATSAPP_DELIVERY_ENABLED=true outside localhost'
      );
    }

    if (isUnsafeConfiguredValue(process.env.WHATSAPP_TWILIO_FROM)) {
      throw new Error(
        'WHATSAPP_TWILIO_FROM must be explicitly set when WHATSAPP_DELIVERY_ENABLED=true outside localhost'
      );
    }
  }
}

const appEnvironment = process.env.APP_ENV || 'localhost';
const localAppEnvironment = isLocalAppEnvironment(appEnvironment);
const authSeedConfig = resolveAuthSeedConfig(process.env, appEnvironment);
const schedulerExecutionMode: 'direct' | 'queue' =
  process.env.SCHEDULER_EXECUTION_MODE === 'queue' ? 'queue' : 'direct';
const loginMaxAttempts = Math.max(1, getNumber('AUTH_LOGIN_MAX_ATTEMPTS', 5));
const loginIpMaxAttempts = Math.max(loginMaxAttempts, getNumber('AUTH_LOGIN_IP_MAX_ATTEMPTS', 20));
const automationSignalTimeoutMs = Math.max(
  1000,
  getNumber('AUTOMATION_SIGNAL_TIMEOUT_MS', 60000)
);
const automationSignalTimeoutPerSymbolMs = Math.max(
  0,
  getNumber('AUTOMATION_SIGNAL_TIMEOUT_PER_SYMBOL_MS', 2000)
);
const automationSignalMaxTimeoutMs = Math.max(
  automationSignalTimeoutMs,
  getNumber('AUTOMATION_SIGNAL_MAX_TIMEOUT_MS', 300000)
);

export const env = {
  node: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  app: {
    name: process.env.APP_NAME || 'trading-apis',
    schema: process.env.APP_SCHEMA || 'http',
    host: resolveStringWithLocalFallback(process.env.APP_HOST, 'localhost', localAppEnvironment),
    banner: getBool('APP_BANNER', true),
    shutdownDrainTimeoutMs: Math.max(5_000, getNumber('APP_SHUTDOWN_DRAIN_TIMEOUT_MS', 20_000)),
    routePrefix: process.env.APP_ROUTE_PREFIX || '/api/v1',
    environment: appEnvironment,
    apiKey: process.env.APP_API_KEY || '',
    requireApiKey: getBool('APP_REQUIRE_API_KEY', true),
    corsOrigins: getArray('APP_CORS_ORIGINS'),
    port: getNumber('PORT', 3000),
    dirs: {
      controllers: [path.join(__dirname, 'api/controllers/**/*Controller{.js,.ts}')],
      middlewares: [path.join(__dirname, 'api/middlewares/**/*Middleware{.js,.ts}')],
    },
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
  auth: {
    accessTokenSecret: process.env.AUTH_ACCESS_TOKEN_SECRET || defaultLocalAccessTokenSecret,
    accessTokenTtl: process.env.AUTH_ACCESS_TOKEN_TTL || '15m',
    refreshTokenDays: getNumber('AUTH_REFRESH_TOKEN_DAYS', 7),
    loginProtectionEnabled:
      process.env.AUTH_LOGIN_PROTECTION_ENABLED !== undefined
        ? getBool('AUTH_LOGIN_PROTECTION_ENABLED', true)
        : true,
    loginMaxAttempts,
    loginIpMaxAttempts,
    loginWindowMinutes: Math.max(1, getNumber('AUTH_LOGIN_WINDOW_MINUTES', 15)),
    loginLockoutMinutes: Math.max(1, getNumber('AUTH_LOGIN_LOCKOUT_MINUTES', 15)),
    seedEnabled: authSeedConfig.enabled,
    seedEmail: authSeedConfig.email,
    seedPassword: authSeedConfig.password,
    seedFullName: authSeedConfig.fullName,
  },
  http: {
    requestTimeoutMs: getNumber('HTTP_REQUEST_TIMEOUT_MS', 10000),
  },
  discovery: {
    apiBaseUrl: resolveStringWithLocalFallback(
      process.env.DISCOVERY_API_BASE_URL,
      'http://localhost:8000/api/v1/discovery',
      localAppEnvironment
    ),
  },
  observability: {
    autoCaptureEnabled: getBool('OPS_AUTO_CAPTURE_ENABLED', true),
    captureReadRequests: getBool('OPS_CAPTURE_READ_REQUESTS', true),
    emitFailureAlerts: getBool('OPS_EMIT_FAILURE_ALERTS', true),
    emit5xxAlerts: getBool('OPS_EMIT_5XX_ALERTS', true),
    emit4xxMutationAlerts: getBool('OPS_EMIT_4XX_MUTATION_ALERTS', true),
    failureAlertThrottleMinutes: getNumber('OPS_FAILURE_ALERT_THROTTLE_MINUTES', 15),
    activityReadWarnMs: Math.max(50, getNumber('OPS_ACTIVITY_READ_WARN_MS', 400)),
    activityWriteWarnMs: Math.max(10, getNumber('OPS_ACTIVITY_WRITE_WARN_MS', 250)),
    activityFeedVolumeInfoThreshold: Math.max(
      25,
      getNumber('OPS_ACTIVITY_FEED_VOLUME_INFO_THRESHOLD', 250)
    ),
  },
  activity: {
    maintenanceEnabled: getBool('ACTIVITY_MAINTENANCE_ENABLED', true),
    maintenanceIntervalMs: Math.max(
      60_000,
      getNumber('ACTIVITY_MAINTENANCE_INTERVAL_MS', 60 * 60 * 1000)
    ),
    retentionDays: Math.max(30, getNumber('ACTIVITY_RETENTION_DAYS', 90)),
    exportRetentionDays: Math.max(1, getNumber('ACTIVITY_EXPORT_RETENTION_DAYS', 7)),
    exportProcessorEnabled:
      process.env.ACTIVITY_EXPORT_PROCESSOR_ENABLED !== undefined
        ? getBool('ACTIVITY_EXPORT_PROCESSOR_ENABLED', true)
        : !process.env.NODE_ENV || process.env.NODE_ENV !== 'test',
    exportProcessorIntervalMs: Math.max(
      5_000,
      getNumber('ACTIVITY_EXPORT_PROCESSOR_INTERVAL_MS', 15_000)
    ),
    exportProcessorBatchSize: Math.max(1, getNumber('ACTIVITY_EXPORT_PROCESSOR_BATCH_SIZE', 10)),
    exportChunkSize: Math.max(100, getNumber('ACTIVITY_EXPORT_CHUNK_SIZE', 1000)),
    exportStorageMode: resolveActivityExportStorageMode(process.env.ACTIVITY_EXPORT_STORAGE_MODE),
    exportStorageDir: resolveStringWithLocalFallback(
      process.env.ACTIVITY_EXPORT_STORAGE_DIR,
      path.resolve(process.cwd(), 'storage', 'activity-exports'),
      localAppEnvironment
    ),
  },
  email: {
    enabled: getBool('EMAIL_DELIVERY_ENABLED', false),
    pollIntervalMs: Math.max(1000, getNumber('EMAIL_DELIVERY_POLL_INTERVAL_MS', 5000)),
    batchSize: Math.max(1, getNumber('EMAIL_DELIVERY_BATCH_SIZE', 10)),
    maxAttempts: Math.max(1, getNumber('EMAIL_DELIVERY_MAX_ATTEMPTS', 5)),
    staleMinutes: Math.max(1, getNumber('EMAIL_DELIVERY_STALE_MINUTES', 10)),
    provider: resolveEmailProvider(process.env.EMAIL_PROVIDER),
    smtp: {
      host: process.env.EMAIL_SMTP_HOST || '',
      port: getNumber('EMAIL_SMTP_PORT', 587),
      secure: getBool('EMAIL_SMTP_SECURE', false),
      user: process.env.EMAIL_SMTP_USER || '',
      password: process.env.EMAIL_SMTP_PASSWORD || '',
      from: process.env.EMAIL_SMTP_FROM || '',
      replyTo: process.env.EMAIL_SMTP_REPLY_TO || '',
    },
    resend: {
      apiKey: process.env.EMAIL_RESEND_API_KEY || '',
      apiBaseUrl: process.env.EMAIL_RESEND_API_BASE_URL || 'https://api.resend.com',
      from: process.env.EMAIL_RESEND_FROM || '',
      replyTo: process.env.EMAIL_RESEND_REPLY_TO || '',
    },
  },
  whatsapp: {
    enabled: getBool('WHATSAPP_DELIVERY_ENABLED', false),
    pollIntervalMs: Math.max(1000, getNumber('WHATSAPP_DELIVERY_POLL_INTERVAL_MS', 5000)),
    batchSize: Math.max(1, getNumber('WHATSAPP_DELIVERY_BATCH_SIZE', 10)),
    maxAttempts: Math.max(1, getNumber('WHATSAPP_DELIVERY_MAX_ATTEMPTS', 5)),
    staleMinutes: Math.max(1, getNumber('WHATSAPP_DELIVERY_STALE_MINUTES', 10)),
    provider:
      normalizeEnvValue(process.env.WHATSAPP_DELIVERY_PROVIDER).toLowerCase() === 'twilio'
        ? 'twilio'
        : 'twilio',
    twilio: {
      accountSid: process.env.WHATSAPP_TWILIO_ACCOUNT_SID || '',
      authToken: process.env.WHATSAPP_TWILIO_AUTH_TOKEN || '',
      from: process.env.WHATSAPP_TWILIO_FROM || '',
      apiBaseUrl: process.env.WHATSAPP_TWILIO_API_BASE_URL || 'https://api.twilio.com/2010-04-01',
    },
  },
  scheduler: {
    executionMode: schedulerExecutionMode,
    systemUserId: process.env.SCHEDULER_SYSTEM_USER_ID || 'system',
    discovery: {
      schedulerSecret:
        process.env.DISCOVERY_SCHEDULER_SECRET || defaultLocalDiscoverySchedulerSecret,
      signatureMaxSkewSeconds: Math.max(
        30,
        getNumber('DISCOVERY_SCHEDULER_SIGNATURE_MAX_SKEW_SECONDS', 300)
      ),
      nonceTtlSeconds: Math.max(60, getNumber('DISCOVERY_SCHEDULER_NONCE_TTL_SECONDS', 600)),
    },
    worker: {
      schema: process.env.SCHEDULER_WORKER_SCHEMA || 'http',
      host: resolveStringWithLocalFallback(
        process.env.SCHEDULER_WORKER_HOST,
        'localhost',
        localAppEnvironment
      ),
      port: getNumber('SCHEDULER_WORKER_PORT', 3001),
      baseUrl:
        normalizeEnvValue(process.env.SCHEDULER_WORKER_BASE_URL) ||
        (resolveStringWithLocalFallback(
          process.env.SCHEDULER_WORKER_HOST,
          'localhost',
          localAppEnvironment
        )
          ? `${process.env.SCHEDULER_WORKER_SCHEMA || 'http'}://${resolveStringWithLocalFallback(
              process.env.SCHEDULER_WORKER_HOST,
              'localhost',
              localAppEnvironment
            )}:${process.env.SCHEDULER_WORKER_PORT || '3001'}`
          : ''),
    },
  },
  automationSignals: {
    discoveryEngineRoot:
      process.env.AUTOMATION_SIGNAL_DISCOVERY_ENGINE_ROOT || defaultDiscoveryEngineRoot,
    pythonBin:
      process.env.AUTOMATION_SIGNAL_PYTHON_BIN ||
      path.join(
        process.env.AUTOMATION_SIGNAL_DISCOVERY_ENGINE_ROOT || defaultDiscoveryEngineRoot,
        '.venv/bin/python'
      ),
    timeoutMs: automationSignalTimeoutMs,
    timeoutPerSymbolMs: automationSignalTimeoutPerSymbolMs,
    maxTimeoutMs: automationSignalMaxTimeoutMs,
    evalBars: Math.max(50, getNumber('AUTOMATION_SIGNAL_EVAL_BARS', 300)),
  },
  paperOrders: {
    backgroundEnabled:
      process.env.PAPER_ORDER_EXECUTION_BACKGROUND_ENABLED !== undefined
        ? getBool('PAPER_ORDER_EXECUTION_BACKGROUND_ENABLED', true)
        : !process.env.NODE_ENV || process.env.NODE_ENV !== 'test',
    pollIntervalMs: Math.max(5000, getNumber('PAPER_ORDER_EXECUTION_POLL_INTERVAL_MS', 30000)),
    batchSize: Math.max(1, getNumber('PAPER_ORDER_EXECUTION_BATCH_SIZE', 200)),
  },
  suggestedTradesSync: {
    backgroundEnabled:
      process.env.SUGGESTED_TRADE_EXECUTION_SYNC_BACKGROUND_ENABLED !== undefined
        ? getBool('SUGGESTED_TRADE_EXECUTION_SYNC_BACKGROUND_ENABLED', true)
        : !process.env.NODE_ENV || process.env.NODE_ENV !== 'test',
    pollIntervalMs: Math.max(
      5000,
      getNumber('SUGGESTED_TRADE_EXECUTION_SYNC_POLL_INTERVAL_MS', 45000)
    ),
    batchSize: Math.max(1, getNumber('SUGGESTED_TRADE_EXECUTION_SYNC_BATCH_SIZE', 100)),
    staleAfterMs: Math.max(
      30000,
      getNumber('SUGGESTED_TRADE_EXECUTION_SYNC_STALE_AFTER_MS', 120000)
    ),
  },
  suggestedTrades: {
    rolloutEnabled:
      process.env.SUGGESTED_TRADES_ROLLOUT_ENABLED !== undefined
        ? getBool('SUGGESTED_TRADES_ROLLOUT_ENABLED', true)
        : !process.env.NODE_ENV || process.env.NODE_ENV !== 'test',
    rolloutStage: process.env.SUGGESTED_TRADES_ROLLOUT_STAGE || 'internal',
    liveAuto: {
      enabled: getBool('SUGGESTED_TRADES_LIVE_AUTO_ENABLED', false),
      executionEnabled: getBool('SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED', false),
      adaptiveRoutingMode: resolveSuggestedTradesAdaptiveRoutingMode(
        process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE
      ),
      requireFixedRouting:
        process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING !== undefined
          ? getBool('SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING', true)
          : false,
      userAllowlist: getArray('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST'),
      brokerAllowlist: getArray('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST').map((item) =>
        item.trim().toLowerCase()
      ),
      shadowBrokerAllowlist: getArray('SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST').map(
        (item) => item.trim().toLowerCase()
      ),
    },
  },
  brokerCanaryMonitor: {
    enabled: getBool('BROKER_CANARY_MONITOR_ENABLED', true),
    backgroundEnabled: getBool('BROKER_CANARY_MONITOR_BACKGROUND_ENABLED', true),
    lookbackHours: Math.max(1, getNumber('BROKER_CANARY_MONITOR_LOOKBACK_HOURS', 24 * 30)),
    maxSubmissions: Math.max(1, getNumber('BROKER_CANARY_MONITOR_MAX_SUBMISSIONS', 100)),
    pollIntervalMs: Math.max(
      60_000,
      getNumber('BROKER_CANARY_MONITOR_POLL_INTERVAL_MS', 5 * 60 * 1000)
    ),
    snapshotStaleAfterMs: Math.max(
      60_000,
      getNumber('BROKER_CANARY_MONITOR_SNAPSHOT_STALE_AFTER_MS', 15 * 60 * 1000)
    ),
    autoFreezeOnCritical: getBool('BROKER_CANARY_MONITOR_AUTO_FREEZE_ON_CRITICAL', false),
    includeSuggestedTrades: getBool('BROKER_CANARY_MONITOR_INCLUDE_SUGGESTED_TRADES', false),
  },
  suggestedTradesProtectionGuardrails: {
    enabled: getBool('SUGGESTED_TRADES_PROTECTION_GUARDRAIL_ENABLED', true),
    backgroundEnabled:
      process.env.SUGGESTED_TRADES_PROTECTION_GUARDRAIL_BACKGROUND_ENABLED !== undefined
        ? getBool('SUGGESTED_TRADES_PROTECTION_GUARDRAIL_BACKGROUND_ENABLED', true)
        : !process.env.NODE_ENV || process.env.NODE_ENV !== 'test',
    pollIntervalMs: Math.max(
      60_000,
      getNumber('SUGGESTED_TRADES_PROTECTION_GUARDRAIL_POLL_INTERVAL_MS', 5 * 60 * 1000)
    ),
    maxTrades: Math.max(1, getNumber('SUGGESTED_TRADES_PROTECTION_GUARDRAIL_MAX_TRADES', 100)),
    staleAfterMs: Math.max(
      60_000,
      getNumber('SUGGESTED_TRADES_PROTECTION_GUARDRAIL_STALE_AFTER_MS', 10 * 60 * 1000)
    ),
  },
  positions: {
    liveSnapshotStaleAfterMs: Math.max(
      60_000,
      getNumber('POSITIONS_LIVE_SNAPSHOT_STALE_AFTER_MS', 5 * 60 * 1000)
    ),
    liveSnapshotCriticalAfterMs: Math.max(
      2 * 60_000,
      getNumber('POSITIONS_LIVE_SNAPSHOT_CRITICAL_AFTER_MS', 15 * 60 * 1000)
    ),
    syncCheckpointStaleAfterMs: Math.max(
      2 * 60_000,
      getNumber('POSITIONS_SYNC_CHECKPOINT_STALE_AFTER_MS', 15 * 60 * 1000)
    ),
    syncCheckpointCriticalAfterMs: Math.max(
      5 * 60_000,
      getNumber('POSITIONS_SYNC_CHECKPOINT_CRITICAL_AFTER_MS', 45 * 60 * 1000)
    ),
  },
  orders: {
    liveSnapshotStaleAfterMs: Math.max(
      60_000,
      getNumber('ORDERS_LIVE_SNAPSHOT_STALE_AFTER_MS', 5 * 60 * 1000)
    ),
    liveSnapshotCriticalAfterMs: Math.max(
      2 * 60_000,
      getNumber('ORDERS_LIVE_SNAPSHOT_CRITICAL_AFTER_MS', 15 * 60 * 1000)
    ),
    syncCheckpointStaleAfterMs: Math.max(
      2 * 60_000,
      getNumber('ORDERS_SYNC_CHECKPOINT_STALE_AFTER_MS', 15 * 60 * 1000)
    ),
    syncCheckpointCriticalAfterMs: Math.max(
      5 * 60_000,
      getNumber('ORDERS_SYNC_CHECKPOINT_CRITICAL_AFTER_MS', 45 * 60 * 1000)
    ),
  },
  sync: {
    readPositionsFromSnapshot: getBool('SYNC_READ_POSITIONS_FROM_SNAPSHOT', false),
    readOrdersFromSnapshot: getBool('SYNC_READ_ORDERS_FROM_SNAPSHOT', false),
  },
  redis: {
    host: resolveStringWithLocalFallback(process.env.REDIS_HOST, '127.0.0.1', localAppEnvironment),
    port: getNumber('REDIS_PORT', 6379),
    username: process.env.REDIS_USERNAME || '',
    password: process.env.REDIS_PASSWORD || '',
    db: getNumber('REDIS_DB', 0),
    tls: getBool('REDIS_TLS', false),
    autoStart:
      process.env.REDIS_AUTO_START !== undefined
        ? getBool('REDIS_AUTO_START', false)
        : process.env.NODE_ENV === 'development' && localAppEnvironment,
    workerHeartbeatKey: process.env.WORKER_HEARTBEAT_KEY || 'scheduler:worker:heartbeat',
    emailWorkerHeartbeatKey: process.env.EMAIL_WORKER_HEARTBEAT_KEY || 'email:worker:heartbeat',
    whatsappWorkerHeartbeatKey:
      process.env.WHATSAPP_WORKER_HEARTBEAT_KEY || 'whatsapp:worker:heartbeat',
  },
  security: {
    brokerAccountSecretsKey:
      process.env.BROKER_ACCOUNT_SECRETS_KEY || defaultLocalBrokerAccountSecretsKey,
  },
  db: {
    host: resolveStringWithLocalFallback(process.env.DB_HOST, '127.0.0.1', localAppEnvironment),
    port: getNumber('DB_PORT', 3306),
    username: resolveStringWithLocalFallback(process.env.DB_USERNAME, 'root', localAppEnvironment),
    password: resolveStringWithLocalFallback(process.env.DB_PASSWORD, 'root', localAppEnvironment),
    database: resolveStringWithLocalFallback(process.env.DB_NAME, 'auralpha', localAppEnvironment),
    synchronize: getBool('DB_SYNCHRONIZE', localAppEnvironment),
    logging: getBool('DB_LOGGING', false),
  },
  pg: {
    enabled: getBool('PG_DB_ENABLED', false),
    host: resolveStringWithLocalFallback(process.env.PG_DB_HOST, '127.0.0.1', localAppEnvironment),
    port: getNumber('PG_DB_PORT', 5432),
    username: resolveStringWithLocalFallback(
      process.env.PG_DB_USERNAME,
      'postgres',
      localAppEnvironment
    ),
    password: resolveStringWithLocalFallback(process.env.PG_DB_PASSWORD, '', localAppEnvironment),
    database: resolveStringWithLocalFallback(
      process.env.PG_DB_NAME,
      'auralpha',
      localAppEnvironment
    ),
    ssl: getBool('PG_DB_SSL', false),
    logging: getBool('PG_DB_LOGGING', false),
  },
};

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
  schedulerExecutionMode: env.scheduler.executionMode,
  schedulerWorkerBaseUrl: env.scheduler.worker.baseUrl,
  redisHost: env.redis.host,
  redisAutoStart: env.redis.autoStart,
  dbHost: env.db.host,
  dbUsername: env.db.username,
  dbPassword: env.db.password,
  dbDatabase: env.db.database,
  dbSynchronize: env.db.synchronize,
  pgEnabled: env.pg.enabled,
  pgHost: env.pg.host,
  pgUsername: env.pg.username,
  pgPassword: env.pg.password,
  pgDatabase: env.pg.database,
  activityExportStorageMode: env.activity.exportStorageMode,
  activityExportStorageDir: env.activity.exportStorageDir,
});
