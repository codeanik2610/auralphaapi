import 'reflect-metadata';
import { randomUUID } from 'crypto';
import type { QueryRunner } from 'typeorm';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';

type BrokerKey = 'mudrex' | 'delta_exchange';
type QueryExecutor = Pick<QueryRunner, 'query'>;

type SourceBrokerAccount = {
  id: string;
  userId: string;
  brokerKey: BrokerKey;
  brokerId: string | null;
  accountKey: string;
  accountName: string;
  status: string;
  mode: string | null;
  settings: Record<string, unknown>;
  brokerName: string;
  capabilities: string | null;
};

const ADMIN_EMAIL = 'admin@auralpha.com';
const TARGET_BROKERS: BrokerKey[] = ['mudrex', 'delta_exchange'];
const APPLY =
  process.argv.includes('--apply') || process.env.BROKER_SETTINGS_SYSTEM_SYNC_APPLY === 'true';

const requiredSettingsByBroker: Record<BrokerKey, string[]> = {
  mudrex: ['apiSecret'],
  delta_exchange: ['apiKey', 'apiSecret'],
};

const systemAccountDefaults: Record<BrokerKey, { accountKey: string; accountName: string }> = {
  mudrex: {
    accountKey: 'mudrex-system-primary',
    accountName: 'Mudrex System Primary',
  },
  delta_exchange: {
    accountKey: 'delta_exchange-system-primary',
    accountName: 'Delta Exchange System Primary',
  },
};

const normalizeBrokerKey = (value: unknown): BrokerKey | null => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return TARGET_BROKERS.includes(normalized as BrokerKey) ? (normalized as BrokerKey) : null;
};

const normalizeSettings = (value: unknown): Record<string, unknown> => {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const validateSettings = (brokerKey: BrokerKey, settings: Record<string, unknown>): void => {
  const missingKeys = requiredSettingsByBroker[brokerKey].filter((key) => {
    const value = settings[key];
    return typeof value !== 'string' || !value.trim();
  });

  if (missingKeys.length > 0) {
    throw new Error(
      `${brokerKey} admin account settings are missing required key(s): ${missingKeys.join(', ')}`
    );
  }
};

const maskSettings = (settings: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key,
      /secret|key|token|password/i.test(key) && typeof value === 'string' && value.trim()
        ? '<redacted>'
        : value,
    ])
  );

const readAffectedRows = (result: unknown): number => {
  if (result && typeof result === 'object' && 'affectedRows' in result) {
    return Number((result as { affectedRows?: unknown }).affectedRows || 0);
  }
  return 0;
};

const loadAdminSourceAccount = async (brokerKey: BrokerKey): Promise<SourceBrokerAccount> => {
  const rows = (await coreDataSource.query(
    `SELECT
       ba.id,
       ba.user_id AS userId,
       ba.brokerKey AS brokerKey,
       ba.broker_id AS brokerId,
       ba.accountKey AS accountKey,
       ba.accountName AS accountName,
       ba.status,
       ba.mode,
       ba.settings,
       b.name AS brokerName,
       ba.capabilities
     FROM broker_accounts ba
     INNER JOIN users u
       ON u.id = ba.user_id
     LEFT JOIN brokers b
       ON LOWER(b.broker_key) = LOWER(ba.brokerKey)
     WHERE LOWER(u.email) = ?
       AND LOWER(ba.brokerKey) = ?
       AND ba.settings IS NOT NULL
       AND JSON_LENGTH(ba.settings) > 0
     ORDER BY
       CASE LOWER(TRIM(COALESCE(ba.status, '')))
         WHEN 'connected' THEN 0
         WHEN 'idle' THEN 1
         ELSE 2
       END,
       ba.isDefault DESC,
       ba.updatedAt DESC
     LIMIT 1`,
    [ADMIN_EMAIL, brokerKey]
  )) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) {
    throw new Error(`No admin-owned ${brokerKey} broker account with non-empty settings found.`);
  }

  const normalizedBrokerKey = normalizeBrokerKey(row.brokerKey);
  if (!normalizedBrokerKey) {
    throw new Error(`Unexpected brokerKey from source account: ${String(row.brokerKey || '')}`);
  }

  const settings = normalizeSettings(row.settings);
  validateSettings(normalizedBrokerKey, settings);

  return {
    id: String(row.id || ''),
    userId: String(row.userId || ''),
    brokerKey: normalizedBrokerKey,
    brokerId: row.brokerId ? String(row.brokerId) : null,
    accountKey: String(row.accountKey || ''),
    accountName: String(row.accountName || ''),
    status: String(row.status || ''),
    mode: row.mode ? String(row.mode) : null,
    settings,
    brokerName: String(row.brokerName || normalizedBrokerKey),
    capabilities: row.capabilities ? String(row.capabilities) : null,
  };
};

const deleteInactiveBrokerAccounts = async (
  executor: QueryExecutor,
  preservedAccountIds: string[]
): Promise<number> => {
  const placeholders = preservedAccountIds.map(() => '?').join(',');
  const preserveClause = placeholders ? `AND id NOT IN (${placeholders})` : '';
  const result = await executor.query(
    `DELETE FROM broker_accounts
     WHERE LOWER(TRIM(COALESCE(status, ''))) <> 'connected'
     ${preserveClause}`,
    preservedAccountIds
  );
  return readAffectedRows(result);
};

const ensureSystemConnection = async (
  executor: QueryExecutor,
  source: SourceBrokerAccount
): Promise<string> => {
  const existing = (await executor.query(
    `SELECT id
     FROM connections
     WHERE user_id IS NULL
       AND LOWER(brokerKey) = ?
     ORDER BY updatedAt DESC
     LIMIT 1`,
    [source.brokerKey]
  )) as Array<{ id: string }>;

  const connectionId = existing[0]?.id || randomUUID();
  const displayName = source.brokerName || source.brokerKey;

  if (existing[0]?.id) {
    await executor.query(
      `UPDATE connections
       SET name = ?,
           broker = ?,
           brokerKey = ?,
           broker_id = ?,
           type = 'broker',
           status = 'Connected',
           mode = ?,
           diagnosticSummary = 'System account settings copied from admin@auralpha.com',
           route = 'broker-accounts',
           scope = 'system',
           updatedAt = NOW(6)
       WHERE id = ?`,
      [
        `${displayName} System Connection`,
        displayName,
        source.brokerKey,
        source.brokerId,
        source.mode || 'live',
        connectionId,
      ]
    );
    return connectionId;
  }

  await executor.query(
    `INSERT INTO connections
       (id, name, broker, brokerKey, broker_id, type, status, mode, lastSyncAt,
        diagnosticSummary, route, scope, user_id, createdAt, updatedAt)
     VALUES
       (?, ?, ?, ?, ?, 'broker', 'Connected', ?, NULL,
        'System account settings copied from admin@auralpha.com', 'broker-accounts', 'system',
        NULL, NOW(6), NOW(6))`,
    [
      connectionId,
      `${displayName} System Connection`,
      displayName,
      source.brokerKey,
      source.brokerId,
      source.mode || 'live',
    ]
  );

  return connectionId;
};

const upsertSystemBrokerAccount = async (
  executor: QueryExecutor,
  source: SourceBrokerAccount,
  connectionId: string
): Promise<string> => {
  const existing = (await executor.query(
    `SELECT id
     FROM broker_accounts
     WHERE user_id IS NULL
       AND LOWER(brokerKey) = ?
     ORDER BY isDefault DESC, updatedAt DESC
     LIMIT 1`,
    [source.brokerKey]
  )) as Array<{ id: string }>;

  await executor.query(
    `UPDATE broker_accounts
     SET isDefault = 0,
         updatedAt = NOW(6)
     WHERE user_id IS NULL
       AND LOWER(brokerKey) = ?`,
    [source.brokerKey]
  );

  const defaults = systemAccountDefaults[source.brokerKey];
  const settingsJson = JSON.stringify(source.settings);
  const capabilities = source.capabilities || null;

  if (existing[0]?.id) {
    await executor.query(
      `UPDATE broker_accounts
       SET connectionId = ?,
           brokerKey = ?,
           broker_id = ?,
           accountKey = ?,
           accountName = ?,
           status = 'Connected',
           mode = ?,
           lastSyncAt = NULL,
           purpose = 'system-global-schedulers',
           capabilities = ?,
           settings = ?,
           isDefault = 1,
           updatedAt = NOW(6)
       WHERE id = ?`,
      [
        connectionId,
        source.brokerKey,
        source.brokerId,
        defaults.accountKey,
        defaults.accountName,
        source.mode || 'live',
        capabilities,
        settingsJson,
        existing[0].id,
      ]
    );
    return existing[0].id;
  }

  const accountId = randomUUID();
  await executor.query(
    `INSERT INTO broker_accounts
       (id, connectionId, brokerKey, broker_id, accountKey, accountName, status, mode,
        lastSyncAt, purpose, capabilities, settings, isDefault, user_id, createdAt, updatedAt)
     VALUES
       (?, ?, ?, ?, ?, ?, 'Connected', ?, NULL, 'system-global-schedulers', ?, ?, 1, NULL, NOW(6), NOW(6))`,
    [
      accountId,
      connectionId,
      source.brokerKey,
      source.brokerId,
      defaults.accountKey,
      defaults.accountName,
      source.mode || 'live',
      capabilities,
      settingsJson,
    ]
  );
  return accountId;
};

const run = async (): Promise<void> => {
  await initializeCoreDataSource();

  try {
    const sources = await Promise.all(
      TARGET_BROKERS.map((brokerKey) => loadAdminSourceAccount(brokerKey))
    );
    console.log(
      JSON.stringify(
        {
          mode: APPLY ? 'apply' : 'dry-run',
          sourceAccounts: sources.map((source) => ({
            id: source.id,
            brokerKey: source.brokerKey,
            userId: source.userId,
            accountKey: source.accountKey,
            status: source.status,
            settings: maskSettings(source.settings),
          })),
        },
        null,
        2
      )
    );

    const queryRunner = coreDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const deletedInactiveBrokerAccounts = await deleteInactiveBrokerAccounts(
        queryRunner,
        sources.map((source) => source.id)
      );
      const copiedAccounts: Array<{
        brokerKey: BrokerKey;
        connectionId: string;
        systemAccountId: string;
        copiedSettings: Record<string, unknown>;
      }> = [];

      for (const source of sources) {
        const connectionId = await ensureSystemConnection(queryRunner, source);
        const systemAccountId = await upsertSystemBrokerAccount(queryRunner, source, connectionId);
        copiedAccounts.push({
          brokerKey: source.brokerKey,
          connectionId,
          systemAccountId,
          copiedSettings: maskSettings(source.settings),
        });
      }

      console.log(
        JSON.stringify(
          {
            deletedInactiveBrokerAccounts,
            copiedAccounts,
            applied: APPLY,
          },
          null,
          2
        )
      );

      if (APPLY) {
        await queryRunner.commitTransaction();
        console.log('Admin broker settings copied to system broker accounts.');
      } else {
        await queryRunner.rollbackTransaction();
        console.log('Dry run completed. Re-run with --apply to make changes.');
      }
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
};

run().catch(async (error) => {
  console.error('Failed to copy admin broker settings to system accounts.');
  console.error(error);

  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }

  process.exit(1);
});
