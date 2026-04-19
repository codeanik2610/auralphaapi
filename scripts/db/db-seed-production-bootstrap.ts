import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import { IsNull } from 'typeorm';
import { createDefaultBacktestPromotionRules } from '../../src/api/utils/backtestPromotionRules';
import { env } from '../../src/env';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { strategyDataSource } from '../../src/database/pg-data-source';
import {
  AppSetting,
  Broker,
  BrokerAccount,
  Connection,
  Exchange,
  RiskPolicy,
  RiskPolicyVersion,
  SchedulerConfig,
  SchedulerUserConfig,
  StrategyTemplate,
  User,
} from '../../src/database/entities';

type BrokerSeedDefinition = {
  brokerKey: 'mudrex' | 'delta_exchange';
  name: string;
  baseUrl: string;
  capabilities: string[];
  accountFields: Array<Record<string, unknown>>;
  integrationGuide: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
};

type BrokerAccountScope = 'system' | 'admin';

const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_ADMIN_ROLE = 'Admin';
const ADMIN_SEED_EMAIL = 'admin@auralpha.com';
const ADMIN_SEED_FULL_NAME = 'AurAlpha Admin';
const SUPPORTED_BROKER_KEYS = ['mudrex', 'delta_exchange'] as const;
const DEFAULT_BROKER_KEYS: BrokerSeedDefinition['brokerKey'][] = [...SUPPORTED_BROKER_KEYS];

const readEnv = (key: string, fallback = ''): string => {
  const value = String(process.env[key] ?? '').trim();
  return value || fallback;
};

const requireEnv = (key: string): string => {
  const value = readEnv(key);
  if (!value) {
    throw new Error(`${key} is required for the production bootstrap seed.`);
  }
  return value;
};

const readBooleanEnv = (key: string, fallback = false): boolean => {
  const value = readEnv(key).toLowerCase();
  if (!value) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'y', 'on'].includes(value);
};

const readListEnv = (key: string, fallback: string[]): string[] => {
  const value = readEnv(key);
  if (!value) {
    return fallback;
  }
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const normalizeBrokerKey = (value: string): BrokerSeedDefinition['brokerKey'] => {
  const normalized = value.trim().toLowerCase();
  if (SUPPORTED_BROKER_KEYS.includes(normalized as BrokerSeedDefinition['brokerKey'])) {
    return normalized as BrokerSeedDefinition['brokerKey'];
  }
  throw new Error(
    `Unsupported production bootstrap broker "${value}". Supported values: ${SUPPORTED_BROKER_KEYS.join(', ')}.`
  );
};

const readBrokerKeys = (): BrokerSeedDefinition['brokerKey'][] => {
  const rawValue =
    readEnv('PRODUCTION_BOOTSTRAP_BROKER_KEYS') ||
    readEnv('PRODUCTION_BOOTSTRAP_BROKER_KEY') ||
    DEFAULT_BROKER_KEYS.join(',');
  const brokerKeys = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeBrokerKey(item));

  return Array.from(new Set(brokerKeys.length ? brokerKeys : DEFAULT_BROKER_KEYS));
};

const readAdminSeed = () => ({
  email: ADMIN_SEED_EMAIL,
  password: requireEnv('PRODUCTION_BOOTSTRAP_ADMIN_PASSWORD'),
  fullName: readEnv('PRODUCTION_BOOTSTRAP_ADMIN_FULL_NAME', ADMIN_SEED_FULL_NAME),
});

const assertAdminSeedTarget = (): void => {
  const configuredEmail = readEnv(
    'PRODUCTION_BOOTSTRAP_ADMIN_EMAIL',
    ADMIN_SEED_EMAIL
  ).toLowerCase();
  if (configuredEmail !== ADMIN_SEED_EMAIL) {
    throw new Error(
      `Production bootstrap seed only supports ${ADMIN_SEED_EMAIL}; got ${configuredEmail}.`
    );
  }
};

const readBrokerAccountScopes = (): BrokerAccountScope[] => {
  const scopes = readListEnv('PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_SCOPES', ['system', 'admin']);
  const invalid = scopes.filter((scope) => scope !== 'system' && scope !== 'admin');
  if (invalid.length) {
    throw new Error(
      `PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_SCOPES has unsupported values: ${invalid.join(', ')}`
    );
  }
  return Array.from(new Set(scopes)) as BrokerAccountScope[];
};

const brokerDefinitions: Record<BrokerSeedDefinition['brokerKey'], BrokerSeedDefinition> = {
  mudrex: {
    brokerKey: 'mudrex',
    name: 'Mudrex',
    baseUrl: readEnv('PRODUCTION_BOOTSTRAP_MUDREX_BASE_URL', 'https://trade.mudrex.com'),
    capabilities: ['assets', 'diagnostics', 'leverage', 'market', 'orders', 'positions', 'wallet'],
    accountFields: [
      {
        key: 'apiSecret',
        label: 'API secret',
        type: 'secret',
        required: true,
        secret: true,
        placeholder: 'Paste Mudrex API secret',
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        placeholder: 'https://trade.mudrex.com',
      },
    ],
    integrationGuide: {
      summary: 'Mudrex live account for assets, funds, positions, orders, and risk checks.',
      steps: [
        {
          title: 'Create API access',
          description:
            'Create a Mudrex API secret with the minimum permissions required for live sync and execution.',
        },
        {
          title: 'Store credentials',
          description:
            'Provide the secret through the production bootstrap environment and run the seed.',
        },
      ],
      notes: ['Credentials are encrypted before they are stored in broker_accounts.settings.'],
      docsUrl: 'https://trade.mudrex.com',
    },
    diagnostics: {
      requiresAccount: true,
      executorKey: 'mudrex-public',
      successStatus: 'Connected',
      failureStatus: 'Disconnected',
      resetStatus: 'Idle',
    },
  },
  delta_exchange: {
    brokerKey: 'delta_exchange',
    name: 'Delta Exchange',
    baseUrl: readEnv('PRODUCTION_BOOTSTRAP_DELTA_BASE_URL', 'https://api.india.delta.exchange'),
    capabilities: ['assets', 'diagnostics', 'market', 'orders', 'positions', 'wallet'],
    accountFields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'secret',
        required: true,
        secret: true,
        placeholder: 'Paste Delta Exchange API key',
      },
      {
        key: 'apiSecret',
        label: 'API secret',
        type: 'secret',
        required: true,
        secret: true,
        placeholder: 'Paste Delta Exchange API secret',
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: false,
        placeholder: 'https://api.india.delta.exchange',
      },
    ],
    integrationGuide: {
      summary: 'Delta Exchange live account for market data, funds, positions, and order sync.',
      steps: [
        {
          title: 'Create API access',
          description:
            'Create a Delta Exchange API key and secret with the minimum required permissions.',
        },
        {
          title: 'Store credentials',
          description:
            'Provide the key and secret through the production bootstrap environment and run the seed.',
        },
      ],
      notes: ['Credentials are encrypted before they are stored in broker_accounts.settings.'],
      docsUrl: 'https://www.delta.exchange',
    },
    diagnostics: {
      requiresAccount: true,
      executorKey: 'delta-exchange',
      successStatus: 'Connected',
      failureStatus: 'Disconnected',
      resetStatus: 'Idle',
    },
  },
};

const schedulerConfigs: Array<Partial<SchedulerConfig> & Pick<SchedulerConfig, 'key'>> = [
  {
    key: 'broker-assets-sync',
    name: 'Broker Assets Daily Sync',
    description: 'System-owned scheduler for broker asset catalog refreshes.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['mudrex', 'delta_exchange'],
      useSystemConnectionsOnly: true,
      useSystemAccountsOnly: true,
      retentionDays: 30,
    },
  },
  {
    key: 'exchange-assets-sync',
    name: 'Exchange Assets Sync',
    description: 'System-owned scheduler for exchange asset catalog refreshes.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 50,
    schedulerType: 'global',
    config: {
      sources: ['binance-futures'],
      useSystemConnectionsOnly: true,
      retentionDays: 30,
    },
  },
  {
    key: 'binance-candles-3m-1m-sync',
    name: 'OHLCV Data Sync',
    description: 'System-owned scheduler for Binance futures candle ingestion.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['binance'],
      useSystemConnectionsOnly: true,
      useSystemAccountsOnly: true,
      retentionDays: 30,
    },
  },
  {
    key: 'asset-price-sync',
    name: 'Asset Price Sync',
    description: 'System-owned scheduler for latest asset price snapshots.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'global',
    config: {
      sources: ['mudrex', 'delta_exchange'],
      useSystemConnectionsOnly: true,
      selectionMode: 'all',
      selectedAssetIds: [],
      retentionDays: 30,
      scheduleMode: 'daily',
      intervalMinutes: 5,
      intervalSeconds: 1,
      hourlyMinute: 0,
    },
  },
  {
    key: 'system-health-sync',
    name: 'System Health Sync',
    description: 'System-owned scheduler for platform health checks.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 50,
    schedulerType: 'global',
    config: {
      sources: ['health'],
      useSystemConnectionsOnly: true,
      retentionDays: 30,
    },
  },
  {
    key: 'risk-recompute-sync',
    name: 'Risk Snapshot Refresh',
    description:
      'Admin-owned scheduler for background risk snapshot refresh and risk-center diagnostics across all user-owned connections.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['risk'],
      retentionDays: 30,
    },
  },
  {
    key: 'positions-sync',
    name: 'Positions Sync',
    description: 'Admin-owned scheduler for broker positions read-model refreshes.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['positions'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  },
  {
    key: 'orders-sync',
    name: 'Orders Sync',
    description: 'Admin-owned scheduler for broker order history refreshes.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['orders'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  },
  {
    key: 'funds-sync',
    name: 'Funds Snapshot Sync',
    description: 'Admin-owned scheduler for broker funds snapshot refreshes.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: DEFAULT_TIMEZONE,
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    config: {
      sources: ['funds'],
      retentionDays: 30,
    },
  },
];

const userSchedulerKeys = ['risk-recompute-sync', 'positions-sync', 'orders-sync', 'funds-sync'];

const ensureAdminUser = async (): Promise<User> => {
  const admin = readAdminSeed();
  const users = coreDataSource.getRepository(User);
  const existing = await users.findOne({ where: { email: admin.email } });
  const shouldResetPassword = readBooleanEnv('PRODUCTION_BOOTSTRAP_ADMIN_RESET_PASSWORD', false);

  if (existing) {
    let changed = false;
    if (existing.role !== DEFAULT_ADMIN_ROLE) {
      existing.role = DEFAULT_ADMIN_ROLE;
      changed = true;
    }
    if (existing.status !== 'active') {
      existing.status = 'active';
      changed = true;
    }
    if (!existing.fullName.trim()) {
      existing.fullName = admin.fullName;
      changed = true;
    }
    if (shouldResetPassword) {
      existing.passwordHash = await hash(admin.password, 10);
      changed = true;
    }
    return changed ? users.save(existing) : existing;
  }

  return users.save(
    users.create({
      id: randomUUID(),
      email: admin.email,
      passwordHash: await hash(admin.password, 10),
      fullName: admin.fullName,
      role: DEFAULT_ADMIN_ROLE,
      status: 'active',
      lastLoginAt: null,
    })
  );
};

const ensureAppSettings = async (user: User): Promise<void> => {
  const settings = coreDataSource.getRepository(AppSetting);
  const existing = await settings.findOne({ where: { userId: user.id } });
  if (existing) {
    return;
  }

  await settings.save(
    settings.create({
      userId: user.id,
      timezone: readEnv('PRODUCTION_BOOTSTRAP_TIMEZONE', DEFAULT_TIMEZONE),
      notifyEmail: true,
      notifyInApp: true,
      confirmDestructive: true,
      notificationChannel: 'both',
      notificationSeverity: 'all',
      escalationRoute: 'risk-review',
      escalationSlaMinutes: 15,
      backtestPromotionRules: createDefaultBacktestPromotionRules(),
    })
  );
};

const ensureExchange = async (): Promise<void> => {
  const exchanges = coreDataSource.getRepository(Exchange);
  const existing = await exchanges.findOne({ where: { exchangeKey: 'binance' } });
  if (existing) {
    return;
  }

  await exchanges.save(
    exchanges.create({
      id: randomUUID(),
      exchangeKey: 'binance',
      name: 'Binance',
      status: 'active',
      baseUrl: 'https://fapi.binance.com',
    })
  );
};

const ensureBroker = async (definition: BrokerSeedDefinition): Promise<Broker> => {
  const brokers = coreDataSource.getRepository(Broker);
  const existing = await brokers.findOne({ where: { brokerKey: definition.brokerKey } });
  if (existing) {
    return existing;
  }

  return brokers.save(
    brokers.create({
      id: randomUUID(),
      brokerKey: definition.brokerKey,
      name: definition.name,
      category: 'broker',
      status: 'active',
      providerType: 'broker',
      linkedExchangeKey: null,
      baseUrl: definition.baseUrl,
      capabilities: definition.capabilities,
      accountConfig: {
        fields: definition.accountFields,
      },
      integrationGuide: definition.integrationGuide,
      diagnosticsConfig: definition.diagnostics,
    })
  );
};

const ensureConnection = async (
  scope: BrokerAccountScope,
  user: User,
  broker: Broker
): Promise<Connection> => {
  const connections = coreDataSource.getRepository(Connection);
  const userId = scope === 'admin' ? user.id : null;
  const name = `${broker.name} ${scope === 'admin' ? 'Admin' : 'System'} Connection`;
  const existing = await connections.findOne({
    where: {
      ...(userId ? { userId } : { userId: IsNull() }),
      brokerKey: broker.brokerKey,
      name,
    },
  });

  if (existing) {
    return existing;
  }

  return connections.save(
    connections.create({
      id: randomUUID(),
      userId,
      name,
      broker: broker.name,
      brokerKey: broker.brokerKey,
      brokerId: broker.id,
      type: 'broker',
      status: readEnv('PRODUCTION_BOOTSTRAP_CONNECTION_STATUS', 'Connected'),
      latency: null,
      mode: readEnv('PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_MODE', 'live'),
      lastSyncAt: null,
      diagnosticSummary: 'Seeded production bootstrap connection',
      route: 'broker-accounts',
      scope,
    })
  );
};

const ensureBrokerAccount = async (
  scope: BrokerAccountScope,
  user: User,
  broker: Broker,
  connection: Connection
): Promise<void> => {
  const accounts = coreDataSource.getRepository(BrokerAccount);
  const userId = scope === 'admin' ? user.id : null;
  const accountKey =
    readEnv(
      `PRODUCTION_BOOTSTRAP_${broker.brokerKey.toUpperCase()}_${scope.toUpperCase()}_ACCOUNT_KEY`
    ) || `${broker.brokerKey}-${scope}-primary`;
  const existing = await accounts.findOne({
    where: {
      ...(userId ? { userId } : { userId: IsNull() }),
      accountKey,
    },
  });

  if (existing) {
    return;
  }

  await accounts.save(
    accounts.create({
      id: randomUUID(),
      userId,
      connectionId: connection.id,
      brokerKey: broker.brokerKey,
      brokerId: broker.id,
      accountKey,
      accountName:
        readEnv(
          `PRODUCTION_BOOTSTRAP_${broker.brokerKey.toUpperCase()}_${scope.toUpperCase()}_ACCOUNT_NAME`
        ) || `${broker.name} ${scope === 'admin' ? 'Admin' : 'System'} Primary`,
      status: readEnv('PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_STATUS', 'Idle'),
      mode: readEnv('PRODUCTION_BOOTSTRAP_BROKER_ACCOUNT_MODE', 'live'),
      lastSyncAt: null,
      purpose: scope === 'admin' ? 'admin-user-schedulers' : 'system-global-schedulers',
      capabilities: broker.capabilities?.join(',') || null,
      settings: null,
      isDefault: true,
    })
  );
};

const ensureBrokerConnectionsAndAccounts = async (user: User, broker: Broker): Promise<void> => {
  for (const scope of readBrokerAccountScopes()) {
    const connection = await ensureConnection(scope, user, broker);
    await ensureBrokerAccount(scope, user, broker, connection);
  }
};

const ensureSchedulerConfigs = async (): Promise<void> => {
  const configs = coreDataSource.getRepository(SchedulerConfig);
  for (const seed of schedulerConfigs) {
    const existing = await configs.findOne({ where: { key: seed.key } });
    if (existing) {
      continue;
    }
    await configs.save(
      configs.create({
        id: randomUUID(),
        name: seed.name ?? seed.key,
        description: seed.description ?? null,
        enabled: Boolean(seed.enabled),
        cronExpression: seed.cronExpression ?? '0 1 * * *',
        timezone: seed.timezone ?? DEFAULT_TIMEZONE,
        runAt: seed.runAt ?? '01:00',
        intervalDays: seed.intervalDays ?? 1,
        batchSize: seed.batchSize ?? 200,
        schedulerType: seed.schedulerType ?? 'global',
        config: seed.config ?? null,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        runningLockUntil: null,
        key: seed.key,
      })
    );
  }
};

const ensureSchedulerUserConfigs = async (user: User): Promise<void> => {
  const userConfigs = coreDataSource.getRepository(SchedulerUserConfig);
  const configs = coreDataSource.getRepository(SchedulerConfig);

  for (const schedulerKey of userSchedulerKeys) {
    const existing = await userConfigs.findOne({
      where: {
        schedulerKey,
        userId: user.id,
      },
    });
    if (existing) {
      continue;
    }

    const anchor = await configs.findOne({ where: { key: schedulerKey } });
    if (!anchor) {
      throw new Error(`Missing scheduler anchor for ${schedulerKey}`);
    }

    await userConfigs.save(
      userConfigs.create({
        id: randomUUID(),
        schedulerKey,
        userId: user.id,
        name: anchor.name,
        description: anchor.description,
        enabled: false,
        cronExpression: anchor.cronExpression,
        timezone: anchor.timezone,
        runAt: anchor.runAt,
        intervalDays: anchor.intervalDays,
        batchSize: anchor.batchSize,
        schedulerType: 'user',
        config: anchor.config,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastStatus: null,
        lastError: null,
        runningLockUntil: null,
      })
    );
  }
};

const buildDefaultRiskPolicySnapshot = (policy: RiskPolicy): Record<string, unknown> => {
  const updatedAtIso = (policy.updatedAt ?? new Date()).toISOString();
  return {
    id: policy.id,
    scope: policy.scope,
    mode: 'monitor',
    enabled: policy.enabled,
    monitorOnly: policy.monitorOnly,
    enforceHardBlock: policy.enforceHardBlock,
    marginUsageWarnPct: policy.marginUsageWarnPct,
    marginUsageCriticalPct: policy.marginUsageCriticalPct,
    concentrationWarnPct: policy.concentrationWarnPct,
    concentrationCriticalPct: policy.concentrationCriticalPct,
    dailyLossLimitPct: policy.dailyLossLimitPct,
    weeklyLossLimitPct: policy.weeklyLossLimitPct,
    monthlyLossLimitPct: policy.monthlyLossLimitPct,
    maxLeverage: policy.maxLeverage ?? undefined,
    maxOrderAllocation: policy.maxOrderAllocation ?? undefined,
    maxTotalAllocation: policy.maxTotalAllocation ?? undefined,
    maxAvgLeverage: policy.maxAvgLeverage ?? undefined,
    approvalMode: 'auto_approved',
    approvalState: 'approved',
    pendingVersionCount: 0,
    updatedAt: updatedAtIso,
    updatedAtIso,
  };
};

const ensureRiskPolicy = async (user: User): Promise<void> => {
  const policies = coreDataSource.getRepository(RiskPolicy);
  const versions = coreDataSource.getRepository(RiskPolicyVersion);
  let policy = await policies.findOne({
    where: {
      userId: user.id,
      scope: 'user',
    },
  });

  if (!policy) {
    policy = await policies.save(
      policies.create({
        id: randomUUID(),
        userId: user.id,
        scope: 'user',
        brokerKey: null,
        accountId: null,
        enabled: true,
        monitorOnly: true,
        enforceHardBlock: false,
        marginUsageWarnPct: 70,
        marginUsageCriticalPct: 85,
        concentrationWarnPct: 30,
        concentrationCriticalPct: 45,
        dailyLossLimitPct: 5,
        weeklyLossLimitPct: 12,
        monthlyLossLimitPct: 20,
        maxLeverage: 5,
        maxOrderAllocation: null,
        maxTotalAllocation: 80,
        maxAvgLeverage: 4,
      })
    );
  }

  const existingVersion = await versions.findOne({
    where: {
      policyId: policy.id,
      userId: user.id,
    },
    order: {
      createdAt: 'DESC',
    },
  });
  if (existingVersion) {
    return;
  }

  const approvedAt = new Date().toISOString();
  await versions.save(
    versions.create({
      id: randomUUID(),
      policyId: policy.id,
      userId: user.id,
      actorUserId: user.id,
      versionPayload: JSON.stringify({
        snapshot: buildDefaultRiskPolicySnapshot(policy),
        lifecycle: {
          operation: 'create',
          reason: 'Production bootstrap seed',
          approvalMode: 'auto_approved',
          approvalState: 'approved',
          approvedAt,
          approvedByUserId: user.id,
          reviewedAt: approvedAt,
          reviewedByUserId: user.id,
        },
      }),
    })
  );
};

const ensureStrategyTemplate = async (user: User): Promise<void> => {
  if (!env.pg.enabled) {
    console.log('Skipping strategy_templates seed because PG_DB_ENABLED=false.');
    return;
  }

  if (!strategyDataSource.isInitialized) {
    await strategyDataSource.initialize();
  }

  const templates = strategyDataSource.getRepository(StrategyTemplate);
  const name = readEnv('PRODUCTION_BOOTSTRAP_STRATEGY_TEMPLATE_NAME', 'Bootstrap Momentum Guard');
  const existing = await templates.findOne({
    where: {
      userId: user.id,
      name,
    },
  });
  if (existing) {
    return;
  }

  await templates.save(
    templates.create({
      id: randomUUID(),
      userId: user.id,
      name,
      description:
        'Seeded starter template for controlled live-market evaluation. No backtest results are seeded.',
      status: 'Active',
      templateVersion: 1,
      config: {
        codeTarget: 'python',
        codeDefinition: '',
        market: 'crypto-futures',
        entryLogic: 'Trend-following momentum entry with liquidity and volatility checks.',
        exitLogic: 'Exit on momentum failure, protective stop, or risk-policy breach.',
        entryShortLogic: '',
        exitShortLogic: '',
        risk: {
          maxRisk: '1%',
          sizingNotes: 'Start small and keep broker risk policy in monitor mode until validated.',
        },
        parameters: {
          signalThreshold: '0.65',
        },
        notes: 'Bootstrap seed only. Tune before live execution.',
        filters: {
          useAiFilter: false,
          useRegimeFilter: true,
          paperTradeFirst: true,
        },
        description:
          'Starter template seeded for production bootstrap without demo trades or backtest history.',
      },
    })
  );
};

const run = async (): Promise<void> => {
  await initializeCoreDataSource();
  assertAdminSeedTarget();

  const brokerKeys = readBrokerKeys();
  const brokerSeedInputs = brokerKeys.map((brokerKey) => brokerDefinitions[brokerKey]);

  try {
    const user = await ensureAdminUser();
    await ensureAppSettings(user);
    await ensureExchange();
    const seededBrokerKeys: string[] = [];

    for (const brokerDefinition of brokerSeedInputs) {
      const broker = await ensureBroker(brokerDefinition);
      await ensureBrokerConnectionsAndAccounts(user, broker);
      seededBrokerKeys.push(broker.brokerKey);
    }

    await ensureSchedulerConfigs();
    await ensureSchedulerUserConfigs(user);
    await ensureRiskPolicy(user);
    await ensureStrategyTemplate(user);

    console.log(
      `Production bootstrap seed completed for ${user.email} with brokers ${seededBrokerKeys.join(', ')}.`
    );
  } finally {
    if (strategyDataSource.isInitialized) {
      await strategyDataSource.destroy();
    }
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
};

run().catch(async (error) => {
  console.error('Failed to run production bootstrap seed.');
  console.error(error);

  if (strategyDataSource.isInitialized) {
    await strategyDataSource.destroy();
  }
  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }

  process.exit(1);
});
