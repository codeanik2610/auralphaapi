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
      normalizeEnvValue(rawEnv.AUTH_SEED_EMAIL) ||
      (localEnvironment ? defaultLocalSeedEmail : ''),
    password:
      normalizeEnvValue(rawEnv.AUTH_SEED_PASSWORD) ||
      (localEnvironment ? defaultLocalSeedPassword : ''),
    fullName:
      normalizeEnvValue(rawEnv.AUTH_SEED_FULL_NAME) ||
      (localEnvironment ? defaultLocalSeedFullName : '')
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
};

function isUnsafeConfiguredValue(value: string, disallowed: string[] = []): boolean {
  const normalized = normalizeEnvValue(value);
  if (!normalized) {
    return true;
  }

  return disallowed.includes(normalized);
}

export function assertSecureEnvironmentConfig(
  config: SecurityConfigValidationInput
): void {
  if (config.node === 'test' || isLocalAppEnvironment(config.appEnvironment)) {
    return;
  }

  if (
    isUnsafeConfiguredValue(config.authAccessTokenSecret, [
      defaultLocalAccessTokenSecret,
      'change-me'
    ])
  ) {
    throw new Error(
      'AUTH_ACCESS_TOKEN_SECRET must be set to a strong custom value outside localhost'
    );
  }

  if (
    isUnsafeConfiguredValue(config.discoverySchedulerSecret, [
      defaultLocalDiscoverySchedulerSecret,
      'change-me'
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
      'change-me-strong-random-secret'
    ])
  ) {
    throw new Error(
      'BROKER_ACCOUNT_SECRETS_KEY must be set to a strong custom value outside localhost'
    );
  }

  if (
    config.appRequireApiKey &&
    isUnsafeConfiguredValue(config.appApiKey, ['change-me'])
  ) {
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
}

const appEnvironment = process.env.APP_ENV || 'localhost';
const authSeedConfig = resolveAuthSeedConfig(process.env, appEnvironment);
const loginMaxAttempts = Math.max(1, getNumber('AUTH_LOGIN_MAX_ATTEMPTS', 5));
const loginIpMaxAttempts = Math.max(
  loginMaxAttempts,
  getNumber('AUTH_LOGIN_IP_MAX_ATTEMPTS', 20)
);

export const env = {
  node: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  app: {
    name: process.env.APP_NAME || 'trading-apis',
    schema: process.env.APP_SCHEMA || 'http',
    host: process.env.APP_HOST || 'localhost',
    banner: getBool('APP_BANNER', true),
    shutdownDrainTimeoutMs: Math.max(
      5_000,
      getNumber('APP_SHUTDOWN_DRAIN_TIMEOUT_MS', 20_000)
    ),
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
    accessTokenSecret:
      process.env.AUTH_ACCESS_TOKEN_SECRET || defaultLocalAccessTokenSecret,
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
    seedFullName: authSeedConfig.fullName
  },
  http: {
    requestTimeoutMs: getNumber('HTTP_REQUEST_TIMEOUT_MS', 10000),
  },
  discovery: {
    apiBaseUrl:
      process.env.DISCOVERY_API_BASE_URL || 'http://localhost:8000/api/v1/discovery',
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
    exportProcessorBatchSize: Math.max(
      1,
      getNumber('ACTIVITY_EXPORT_PROCESSOR_BATCH_SIZE', 10)
    ),
    exportChunkSize: Math.max(100, getNumber('ACTIVITY_EXPORT_CHUNK_SIZE', 1000)),
    exportStorageDir:
      process.env.ACTIVITY_EXPORT_STORAGE_DIR ||
      path.resolve(process.cwd(), 'storage', 'activity-exports'),
  },
  email: {
    enabled: getBool('EMAIL_DELIVERY_ENABLED', false),
    pollIntervalMs: Math.max(1000, getNumber('EMAIL_DELIVERY_POLL_INTERVAL_MS', 5000)),
    batchSize: Math.max(1, getNumber('EMAIL_DELIVERY_BATCH_SIZE', 10)),
    maxAttempts: Math.max(1, getNumber('EMAIL_DELIVERY_MAX_ATTEMPTS', 5)),
    staleMinutes: Math.max(1, getNumber('EMAIL_DELIVERY_STALE_MINUTES', 10)),
    smtp: {
      host: process.env.EMAIL_SMTP_HOST || '',
      port: getNumber('EMAIL_SMTP_PORT', 587),
      secure: getBool('EMAIL_SMTP_SECURE', false),
      user: process.env.EMAIL_SMTP_USER || '',
      password: process.env.EMAIL_SMTP_PASSWORD || '',
      from: process.env.EMAIL_SMTP_FROM || '',
      replyTo: process.env.EMAIL_SMTP_REPLY_TO || '',
    },
  },
  scheduler: {
    executionMode:
      process.env.SCHEDULER_EXECUTION_MODE === 'queue' ? 'queue' : 'direct',
    systemUserId: process.env.SCHEDULER_SYSTEM_USER_ID || 'system',
    discovery: {
      schedulerSecret:
        process.env.DISCOVERY_SCHEDULER_SECRET ||
        defaultLocalDiscoverySchedulerSecret,
      signatureMaxSkewSeconds: Math.max(
        30,
        getNumber('DISCOVERY_SCHEDULER_SIGNATURE_MAX_SKEW_SECONDS', 300)
      ),
      nonceTtlSeconds: Math.max(
        60,
        getNumber('DISCOVERY_SCHEDULER_NONCE_TTL_SECONDS', 600)
      ),
    },
    worker: {
      schema: process.env.SCHEDULER_WORKER_SCHEMA || 'http',
      host: process.env.SCHEDULER_WORKER_HOST || 'localhost',
      port: getNumber('SCHEDULER_WORKER_PORT', 3001),
      baseUrl:
        process.env.SCHEDULER_WORKER_BASE_URL ||
        `${process.env.SCHEDULER_WORKER_SCHEMA || 'http'}://${process.env.SCHEDULER_WORKER_HOST || 'localhost'}:${process.env.SCHEDULER_WORKER_PORT || '3001'}`,
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
    timeoutMs: Math.max(1000, getNumber('AUTOMATION_SIGNAL_TIMEOUT_MS', 30000)),
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
      requireFixedRouting:
        process.env.SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING !== undefined
          ? getBool('SUGGESTED_TRADES_LIVE_AUTO_REQUIRE_FIXED_ROUTING', true)
          : true,
      userAllowlist: getArray('SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST'),
      brokerAllowlist: getArray('SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST').map((item) =>
        item.trim().toLowerCase()
      ),
    },
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
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: getNumber('REDIS_PORT', 6379),
    username: process.env.REDIS_USERNAME || '',
    password: process.env.REDIS_PASSWORD || '',
    db: getNumber('REDIS_DB', 0),
    tls: getBool('REDIS_TLS', false),
    autoStart:
      process.env.REDIS_AUTO_START !== undefined
        ? getBool('REDIS_AUTO_START', false)
        : process.env.NODE_ENV === 'development' && (process.env.APP_ENV || 'localhost') === 'localhost',
    workerHeartbeatKey: process.env.WORKER_HEARTBEAT_KEY || 'scheduler:worker:heartbeat',
    emailWorkerHeartbeatKey:
      process.env.EMAIL_WORKER_HEARTBEAT_KEY || 'email:worker:heartbeat',
  },
  security: {
    brokerAccountSecretsKey:
      process.env.BROKER_ACCOUNT_SECRETS_KEY ||
      defaultLocalBrokerAccountSecretsKey,
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: getNumber('DB_PORT', 3306),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'auralpha',
    synchronize: getBool('DB_SYNCHRONIZE', true),
    logging: getBool('DB_LOGGING', false),
  },
  pg: {
    enabled: getBool('PG_DB_ENABLED', false),
    host: process.env.PG_DB_HOST || '127.0.0.1',
    port: getNumber('PG_DB_PORT', 5432),
    username: process.env.PG_DB_USERNAME || 'postgres',
    password: process.env.PG_DB_PASSWORD || '',
    database: process.env.PG_DB_NAME || 'auralpha',
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
  authSeedFullName: env.auth.seedFullName
});
