import { coreDataSource } from '../../src/database/data-source';
import { env } from '../../src/env';

type Row = Record<string, unknown>;
type GateStatus = 'pass' | 'warn' | 'block';

interface Gate {
  key: string;
  status: GateStatus;
  summary: string;
  detail?: string;
}

interface BrokerRouteSnapshot {
  brokerKey: string;
  accountId: string | null;
  accountName: string | null;
  accountStatus: string | null;
  accountMode: string | null;
  connectionId: string | null;
  connectionStatus: string | null;
  connectionScope: string | null;
  isDefault: boolean;
  hasSettings: boolean;
  settingsKeyCount: number;
  lastSyncAt: string | null;
  updatedAt: string | null;
}

const DEFAULT_CANARY_USER_EMAIL = 'admin@auralpha.com';
const DEFAULT_CANARY_BROKER = 'mudrex';
const SUPPORTED_DRY_RUN_CANARY_BROKERS = new Set(['mudrex', 'delta_exchange']);
const SUPPORTED_LIVE_AUTO_BROKERS = new Set(['mudrex', 'delta_exchange']);
const REQUIRED_USER_SCHEDULERS = [
  'funds-sync',
  'orders-sync',
  'positions-sync',
  'risk-recompute-sync',
];

function readString(value: unknown): string {
  return String(value ?? '').trim();
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value);
  return normalized || null;
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = readString(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function readDateIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function minutesSince(value: unknown): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
}

function readList(value: string | undefined, fallback: string[]): string[] {
  const items = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(items.length ? items : fallback));
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

async function queryRows<T extends Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await coreDataSource.query(sql, params)) as T[];
}

function addGate(gates: Gate[], gate: Gate): void {
  gates.push(gate);
}

function findLatest(rows: Row[], field: string): unknown {
  return rows
    .map((row) => row[field])
    .filter(Boolean)
    .sort((a, b) => {
      const left = new Date(String(a)).getTime();
      const right = new Date(String(b)).getTime();
      return right - left;
    })[0];
}

function mapRoute(row: Row | undefined): BrokerRouteSnapshot | null {
  if (!row) return null;
  return {
    brokerKey: readString(row.brokerKey).toLowerCase(),
    accountId: readNullableString(row.accountId),
    accountName: readNullableString(row.accountName),
    accountStatus: readNullableString(row.accountStatus),
    accountMode: readNullableString(row.accountMode),
    connectionId: readNullableString(row.connectionId),
    connectionStatus: readNullableString(row.connectionStatus),
    connectionScope: readNullableString(row.connectionScope),
    isDefault: readBoolean(row.isDefault),
    hasSettings: readString(row.settingsType).toUpperCase() === 'OBJECT',
    settingsKeyCount: readNumber(row.settingsKeyCount),
    lastSyncAt: readDateIso(row.lastSyncAt),
    updatedAt: readDateIso(row.updatedAt),
  };
}

function isConnectedStatus(value: string | null): boolean {
  const normalized = readString(value).toLowerCase();
  return normalized === 'connected' || normalized === 'idle';
}

function summarizeFreshness(
  gates: Gate[],
  key: string,
  label: string,
  latest: unknown,
  maxAgeMinutes: number,
  required = true
): void {
  const ageMinutes = minutesSince(latest);
  if (ageMinutes === null) {
    addGate(gates, {
      key,
      status: required ? 'block' : 'warn',
      summary: `${label} is missing`,
      detail: `No ${label.toLowerCase()} timestamp was found for the target route.`,
    });
    return;
  }

  if (ageMinutes > maxAgeMinutes) {
    addGate(gates, {
      key,
      status: required ? 'block' : 'warn',
      summary: `${label} is stale`,
      detail: `${label} age is ${ageMinutes}m; threshold is ${maxAgeMinutes}m.`,
    });
    return;
  }

  addGate(gates, {
    key,
    status: 'pass',
    summary: `${label} is fresh`,
    detail: `${label} age is ${ageMinutes}m.`,
  });
}

function buildNextActions(gates: Gate[]): string[] {
  const blockedKeys = new Set(gates.filter((gate) => gate.status === 'block').map((gate) => gate.key));
  const actions: string[] = [];

  if (blockedKeys.has('live_auto_control_plane_enabled')) {
    actions.push('Enable SUGGESTED_TRADES_LIVE_AUTO_ENABLED only when you are ready for broker-auto canary evaluation.');
  }
  if (blockedKeys.has('live_auto_execution_enabled')) {
    actions.push('Keep SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED=false for dry-run proof; enable it only for the final live canary.');
  }
  if (blockedKeys.has('target_user_allowlisted')) {
    actions.push('Add the target admin user id to SUGGESTED_TRADES_LIVE_AUTO_USER_ALLOWLIST.');
  }
  if (blockedKeys.has('target_broker_allowlisted')) {
    actions.push('Add the target broker key to SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST.');
  }
  if (blockedKeys.has('canary_live_automation')) {
    actions.push('Create or update one tiny canary automation: live_trade_auto, auto_if_safe, fixed route, explicit live consent, max 1 order/run/day/open trade.');
  }
  if (blockedKeys.has('suggested_trade_candidate')) {
    actions.push('Run or wait for the canary automation to produce one open suggested trade before attempting broker-auto.');
  }
  if (blockedKeys.has('target_broker_supported')) {
    actions.push('Use a broker with a certified live-auto placement path: mudrex or delta_exchange.');
  }
  if (blockedKeys.has('admin_broker_route') || blockedKeys.has('admin_broker_credentials')) {
    actions.push('Fix the admin broker connection/account before canary execution.');
  }
  if (blockedKeys.has('system_broker_route')) {
    actions.push('Fix the system broker route so schedulers can refresh broker data before the canary.');
  }
  if (blockedKeys.has('risk_policy_hard_block')) {
    actions.push('Enable an enforcing risk policy for the target broker route.');
  }
  if (blockedKeys.has('target_broker_asset_mapping')) {
    actions.push('Refresh exchange-assets-sync so the canary symbol maps to the current live broker product.');
  }
  if (blockedKeys.has('target_delta_product_live')) {
    actions.push('Refresh the Delta broker_assets mapping before enabling live execution; stale or expired products are blocked.');
  }

  return actions.length
    ? actions
    : ['All blocking gates passed; run the canary with max-1 limits and watch order submission reconciliation.'];
}

async function fetchDeltaProduct(productId: string): Promise<{ product: Row | null; error?: string }> {
  try {
    const response = await fetch(
      `https://api.delta.exchange/v2/products/${encodeURIComponent(productId)}`
    );
    if (!response.ok) {
      return { product: null, error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as Row;
    const product = payload.result && typeof payload.result === 'object'
      ? (payload.result as Row)
      : null;
    return { product };
  } catch (error) {
    return {
      product: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function run(): Promise<void> {
  const targetEmail = readString(process.env.BROKER_AUTO_CANARY_USER_EMAIL) || DEFAULT_CANARY_USER_EMAIL;
  const targetBroker = (
    readString(process.env.BROKER_AUTO_CANARY_BROKER) || DEFAULT_CANARY_BROKER
  ).toLowerCase();
  const requestedCanarySymbol = readString(process.env.BROKER_AUTO_CANARY_SYMBOL).toUpperCase();
  const auditedBrokers = readList(process.env.BROKER_AUTO_CANARY_BROKERS, [targetBroker]).map(
    (broker) => broker.toLowerCase()
  );
  const maxSnapshotAgeMinutes = Math.max(
    5,
    Number(process.env.BROKER_AUTO_CANARY_MAX_SNAPSHOT_AGE_MINUTES || 360)
  );
  const strict =
    String(process.env.BROKER_AUTO_CANARY_READINESS_STRICT || 'false')
      .trim()
      .toLowerCase() === 'true';

  await coreDataSource.initialize();

  try {
    const gates: Gate[] = [];
    const [targetUser] = await queryRows<{
      id: string;
      email: string;
      role: string;
      status: string;
    }>('SELECT id, email, role, status FROM users WHERE email = ? LIMIT 1', [targetEmail]);
    const targetUserId = readNullableString(targetUser?.id);
    const targetUserActive = readString(targetUser?.status).toLowerCase() === 'active';

    addGate(gates, {
      key: 'target_user_active',
      status: targetUserId && targetUserActive ? 'pass' : 'block',
      summary:
        targetUserId && targetUserActive
          ? `Target user ${targetEmail} is active`
          : `Target user ${targetEmail} is not active`,
    });

    const runtime = {
      rolloutEnabled: env.suggestedTrades.rolloutEnabled,
      rolloutStage: env.suggestedTrades.rolloutStage,
      liveAutoEnabled: env.suggestedTrades.liveAuto.enabled,
      liveAutoExecutionEnabled: env.suggestedTrades.liveAuto.executionEnabled,
      requireFixedRouting: env.suggestedTrades.liveAuto.requireFixedRouting,
      userAllowlistSize: env.suggestedTrades.liveAuto.userAllowlist.length,
      brokerAllowlist: env.suggestedTrades.liveAuto.brokerAllowlist,
    };
    const userAllowlisted = Boolean(
      targetUserId && env.suggestedTrades.liveAuto.userAllowlist.includes(targetUserId)
    );
    const brokerAllowlisted = env.suggestedTrades.liveAuto.brokerAllowlist.includes(targetBroker);

    addGate(gates, {
      key: 'suggested_trades_rollout_enabled',
      status: runtime.rolloutEnabled ? 'pass' : 'block',
      summary: runtime.rolloutEnabled
        ? 'Suggested-trades rollout is enabled'
        : 'Suggested-trades rollout is disabled',
    });
    addGate(gates, {
      key: 'live_auto_control_plane_enabled',
      status: runtime.liveAutoEnabled ? 'pass' : 'block',
      summary: runtime.liveAutoEnabled
        ? 'Live auto control plane is enabled'
        : 'Live auto control plane is disabled',
    });
    addGate(gates, {
      key: 'live_auto_execution_enabled',
      status: runtime.liveAutoExecutionEnabled ? 'pass' : 'block',
      summary: runtime.liveAutoExecutionEnabled
        ? 'Live broker placement is enabled'
        : 'Live broker placement is disabled',
      detail: 'This should stay disabled for dry-run proof and be enabled only for the final live canary.',
    });
    addGate(gates, {
      key: 'target_user_allowlisted',
      status: userAllowlisted ? 'pass' : 'block',
      summary: userAllowlisted
        ? 'Target user is allowlisted for live auto'
        : 'Target user is not allowlisted for live auto',
      detail: targetUserId ? `Target user id: ${targetUserId}` : undefined,
    });
    addGate(gates, {
      key: 'target_broker_allowlisted',
      status: brokerAllowlisted ? 'pass' : 'block',
      summary: brokerAllowlisted
        ? `Broker ${targetBroker} is allowlisted`
        : `Broker ${targetBroker} is not allowlisted`,
    });
    const brokerLiveSupported = SUPPORTED_LIVE_AUTO_BROKERS.has(targetBroker);
    const brokerDryRunSupported = SUPPORTED_DRY_RUN_CANARY_BROKERS.has(targetBroker);
    const brokerSupportedForCurrentStage = runtime.liveAutoExecutionEnabled
      ? brokerLiveSupported
      : brokerDryRunSupported;
    addGate(gates, {
      key: 'target_broker_supported',
      status: brokerSupportedForCurrentStage ? 'pass' : 'block',
      summary: runtime.liveAutoExecutionEnabled
        ? brokerLiveSupported
          ? `Broker ${targetBroker} is supported by the live-auto placement path`
          : `Broker ${targetBroker} is not supported by the live-auto placement path`
        : brokerDryRunSupported
          ? `Broker ${targetBroker} is supported for dry-run canary proof`
          : `Broker ${targetBroker} is not supported for dry-run canary proof`,
      detail:
        !runtime.liveAutoExecutionEnabled && brokerDryRunSupported && !brokerLiveSupported
          ? 'Dry-run proof can evaluate routing and risk gates; live broker placement remains blocked until this broker is certified.'
          : undefined,
    });

    const brokerParams = auditedBrokers.length ? auditedBrokers : [targetBroker];
    const accountRows = targetUserId
      ? await queryRows<Row>(
          `SELECT
             ba.id AS accountId,
             ba.user_id AS userId,
             ba.connectionId AS connectionId,
             ba.brokerKey AS brokerKey,
             ba.accountName AS accountName,
             ba.status AS accountStatus,
             ba.mode AS accountMode,
             ba.isDefault AS isDefault,
             JSON_TYPE(ba.settings) AS settingsType,
             JSON_LENGTH(JSON_KEYS(CAST(ba.settings AS JSON))) AS settingsKeyCount,
             ba.lastSyncAt AS lastSyncAt,
             ba.updatedAt AS updatedAt,
             c.status AS connectionStatus,
             c.scope AS connectionScope
           FROM broker_accounts ba
           JOIN connections c ON c.id = ba.connectionId
           WHERE ba.brokerKey IN (${placeholders(brokerParams)})
             AND (ba.user_id = ? OR ba.user_id IS NULL)
           ORDER BY ba.user_id IS NULL ASC, ba.brokerKey ASC, ba.isDefault DESC, ba.updatedAt DESC`,
          [...brokerParams, targetUserId]
        )
      : [];

    const adminTargetRoute = mapRoute(
      accountRows.find(
        (row) =>
          readString(row.userId) === targetUserId &&
          readString(row.brokerKey).toLowerCase() === targetBroker
      )
    );
    const systemTargetRoute = mapRoute(
      accountRows.find(
        (row) => !readString(row.userId) && readString(row.brokerKey).toLowerCase() === targetBroker
      )
    );

    addGate(gates, {
      key: 'admin_broker_route',
      status:
        adminTargetRoute &&
        isConnectedStatus(adminTargetRoute.accountStatus) &&
        isConnectedStatus(adminTargetRoute.connectionStatus)
          ? 'pass'
          : 'block',
      summary: adminTargetRoute
        ? `Admin ${targetBroker} account route is ${adminTargetRoute.accountStatus}/${adminTargetRoute.connectionStatus}`
        : `Admin ${targetBroker} account route is missing`,
      detail: adminTargetRoute?.accountId ? `Account id: ${adminTargetRoute.accountId}` : undefined,
    });
    addGate(gates, {
      key: 'admin_broker_credentials',
      status:
        adminTargetRoute?.hasSettings && adminTargetRoute.settingsKeyCount > 0 ? 'pass' : 'block',
      summary:
        adminTargetRoute?.hasSettings && adminTargetRoute.settingsKeyCount > 0
          ? 'Admin broker account has encrypted settings'
          : 'Admin broker account is missing encrypted settings',
      detail: adminTargetRoute
        ? `Settings keys present: ${adminTargetRoute.settingsKeyCount}; secret values are not printed.`
        : undefined,
    });
    addGate(gates, {
      key: 'system_broker_route',
      status:
        systemTargetRoute &&
        isConnectedStatus(systemTargetRoute.accountStatus) &&
        isConnectedStatus(systemTargetRoute.connectionStatus)
          ? 'pass'
          : 'block',
      summary: systemTargetRoute
        ? `System ${targetBroker} account route is ${systemTargetRoute.accountStatus}/${systemTargetRoute.connectionStatus}`
        : `System ${targetBroker} account route is missing`,
    });

    const assetRows = await queryRows<Row>(
      `SELECT source, COUNT(*) AS total, MAX(updatedAt) AS latestUpdatedAt
       FROM broker_assets
       WHERE source IN (${placeholders(brokerParams)})
       GROUP BY source`,
      brokerParams
    );
    const targetAssetRow = assetRows.find(
      (row) => readString(row.source).toLowerCase() === targetBroker
    );
    addGate(gates, {
      key: 'broker_assets_available',
      status: readNumber(targetAssetRow?.total) > 0 ? 'pass' : 'block',
      summary:
        readNumber(targetAssetRow?.total) > 0
          ? `${targetBroker} broker assets are available`
          : `${targetBroker} broker assets are missing`,
      detail: `${readNumber(targetAssetRow?.total)} assets; latest update ${readDateIso(
        targetAssetRow?.latestUpdatedAt
      ) ?? 'unknown'}.`,
    });

    const schedulerRows = targetUserId
      ? await queryRows<Row>(
          `SELECT scheduler_key, enabled, last_status, last_started_at, last_finished_at, running_lock_until
           FROM scheduler_user_configs
           WHERE user_id = ?
             AND scheduler_key IN (${placeholders(REQUIRED_USER_SCHEDULERS)})
           ORDER BY scheduler_key`,
          [targetUserId, ...REQUIRED_USER_SCHEDULERS]
        )
      : [];
    const schedulerRowsByKey = new Map(
      schedulerRows.map((row) => [readString(row.scheduler_key), row] as const)
    );
    const readSuccessfulSchedulerFinishedAt = (schedulerKey: string): unknown => {
      const row = schedulerRowsByKey.get(schedulerKey);
      if (!row || readString(row.last_status).toLowerCase() !== 'success') {
        return null;
      }
      return row.last_finished_at;
    };
    for (const schedulerKey of REQUIRED_USER_SCHEDULERS) {
      const row = schedulerRowsByKey.get(schedulerKey);
      const enabled = readBoolean(row?.enabled);
      const status = readString(row?.last_status);
      addGate(gates, {
        key: `${schedulerKey}_enabled`,
        status: enabled ? 'pass' : 'block',
        summary: enabled
          ? `${schedulerKey} is enabled for the target user`
          : `${schedulerKey} is disabled or missing for the target user`,
        detail: row
          ? `Last status: ${status || 'unknown'}; finished: ${readDateIso(row.last_finished_at) ?? 'never'}.`
          : undefined,
      });
    }

    if (targetUserId && adminTargetRoute?.accountId) {
      const [fundsSnapshot] = await queryRows<Row>(
        `SELECT MAX(observed_at) AS latestObservedAt, MAX(last_attempt_at) AS latestAttemptAt
         FROM funds_snapshots
         WHERE user_id = ?
           AND broker_key = ?
           AND account_id = ?
           AND fetch_status = 'success'`,
        [targetUserId, targetBroker, adminTargetRoute.accountId]
      );
      const [positionsSnapshot] = await queryRows<Row>(
        `SELECT COUNT(*) AS total, MAX(last_seen_at) AS latestSeenAt
         FROM scheduler_positions_snapshots
         WHERE user_id = ?
           AND broker_key = ?
           AND account_id = ?`,
        [targetUserId, targetBroker, adminTargetRoute.accountId]
      );
      const [ordersSnapshot] = await queryRows<Row>(
        `SELECT COUNT(*) AS total, MAX(last_seen_at) AS latestSeenAt
         FROM scheduler_orders_snapshots
         WHERE user_id = ?
           AND broker_key = ?
           AND account_id = ?`,
        [targetUserId, targetBroker, adminTargetRoute.accountId]
      );
      const [riskSnapshot] = await queryRows<Row>(
        'SELECT MAX(createdAt) AS latestCreatedAt, MAX(funds_observed_at) AS fundsObservedAt, MAX(positions_observed_at) AS positionsObservedAt, MAX(orders_observed_at) AS ordersObservedAt FROM risk_snapshots WHERE user_id = ?',
        [targetUserId]
      );

      summarizeFreshness(
        gates,
        'funds_snapshot_fresh',
        'Funds snapshot',
        fundsSnapshot?.latestObservedAt || fundsSnapshot?.latestAttemptAt,
        maxSnapshotAgeMinutes
      );
      summarizeFreshness(
        gates,
        'positions_snapshot_fresh',
        'Positions snapshot',
        positionsSnapshot?.latestSeenAt ||
          (readNumber(positionsSnapshot?.total) === 0
            ? readSuccessfulSchedulerFinishedAt('positions-sync')
            : null),
        maxSnapshotAgeMinutes
      );
      summarizeFreshness(
        gates,
        'orders_snapshot_fresh',
        'Orders snapshot',
        ordersSnapshot?.latestSeenAt ||
          (readNumber(ordersSnapshot?.total) === 0
            ? readSuccessfulSchedulerFinishedAt('orders-sync')
            : null),
        maxSnapshotAgeMinutes
      );
      summarizeFreshness(
        gates,
        'risk_snapshot_fresh',
        'Risk snapshot',
        riskSnapshot?.latestCreatedAt,
        maxSnapshotAgeMinutes
      );
    }

    const policyRows = targetUserId
      ? await queryRows<Row>(
          `SELECT id, scope, broker_key, account_id, enabled, monitor_only, enforce_hard_block,
                  min_leverage, max_leverage, min_notional_per_trade, max_order_allocation,
                  max_total_allocation, max_avg_leverage, updated_at
           FROM risk_policies
           WHERE user_id = ?
             AND enabled = 1
             AND (
               (scope = 'broker' AND broker_key = ?)
               OR scope = 'user'
             )
           ORDER BY CASE WHEN scope = 'broker' AND broker_key = ? THEN 0 ELSE 1 END, updated_at DESC`,
          [targetUserId, targetBroker, targetBroker]
        )
      : [];
    const activePolicy = policyRows[0];
    const policyEnforces =
      Boolean(activePolicy) &&
      !readBoolean(activePolicy.monitor_only) &&
      readBoolean(activePolicy.enforce_hard_block);
    addGate(gates, {
      key: 'risk_policy_hard_block',
      status: policyEnforces ? 'pass' : 'block',
      summary: policyEnforces
        ? 'Target route has an enforcing risk policy'
        : 'Target route does not have an enforcing risk policy',
      detail: activePolicy
        ? `Scope: ${readString(activePolicy.scope)}; monitor_only=${readBoolean(
            activePolicy.monitor_only
          )}; enforce_hard_block=${readBoolean(activePolicy.enforce_hard_block)}.`
        : undefined,
    });
    if (activePolicy && !readNumber(activePolicy.min_notional_per_trade)) {
      addGate(gates, {
        key: 'risk_policy_min_notional',
        status: 'warn',
        summary: 'Risk policy has no minimum notional per trade',
      });
    }
    if (activePolicy && !readNumber(activePolicy.min_leverage)) {
      addGate(gates, {
        key: 'risk_policy_min_leverage',
        status: 'warn',
        summary: 'Risk policy has no minimum leverage',
      });
    }

    const automationRows = targetUserId
      ? await queryRows<Row>(
          `SELECT
             id, name, status, automationType, scopeSymbol, scopeTimeframe, nextRun, lastRun, updatedAt,
             JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.execution.executionMode')) AS executionMode,
             JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.execution.approvalMode')) AS approvalMode,
             JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.execution.routing.routeMode')) AS routeMode,
             JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.execution.routing.brokerKey')) AS brokerKey,
             JSON_UNQUOTE(JSON_EXTRACT(config, '$.tradeSuggestion.execution.routing.accountId')) AS accountId,
             JSON_EXTRACT(config, '$.tradeSuggestion.execution.liveConsent.enabled') AS liveConsent,
             JSON_EXTRACT(config, '$.tradeSuggestion.execution.limits.maxOrdersPerRun') AS maxOrdersPerRun,
             JSON_EXTRACT(config, '$.tradeSuggestion.execution.limits.maxOrdersPerDay') AS maxOrdersPerDay,
             JSON_EXTRACT(config, '$.tradeSuggestion.execution.limits.maxConcurrentOpenTrades') AS maxConcurrentOpenTrades
           FROM automations
           WHERE user_id = ?
             AND (
               automationType IN ('trade-suggestion', 'trade_suggestion')
               OR JSON_CONTAINS_PATH(config, 'one', '$.tradeSuggestion')
             )
           ORDER BY updatedAt DESC`,
          [targetUserId]
        )
      : [];
    const liveAutomationCandidates = automationRows.filter((row) => {
      const accountId = readString(row.accountId);
      return (
        readString(row.status).toLowerCase() === 'running' &&
        readString(row.executionMode) === 'live_trade_auto' &&
        readString(row.approvalMode) === 'auto_if_safe' &&
        readString(row.routeMode) === 'fixed' &&
        readString(row.brokerKey).toLowerCase() === targetBroker &&
        Boolean(adminTargetRoute?.accountId && accountId === adminTargetRoute.accountId) &&
        readBoolean(row.liveConsent) &&
        readNumber(row.maxOrdersPerRun) >= 1 &&
        readNumber(row.maxOrdersPerDay) >= 1 &&
        readNumber(row.maxConcurrentOpenTrades) >= 1
      );
    });
    addGate(gates, {
      key: 'canary_live_automation',
      status: liveAutomationCandidates.length > 0 ? 'pass' : 'block',
      summary:
        liveAutomationCandidates.length > 0
          ? 'At least one live-auto fixed-route canary automation exists'
          : 'No live-auto fixed-route canary automation exists',
      detail: `${automationRows.length} trade-suggestion automation(s) inspected.`,
    });

    const targetCanarySymbol =
      requestedCanarySymbol ||
      readString(liveAutomationCandidates[0]?.scopeSymbol).toUpperCase() ||
      'BTCUSDT';
    const [targetBrokerAsset] = await queryRows<Row>(
      `SELECT id, source, symbol, name, externalId, assetId, updatedAt
       FROM broker_assets
       WHERE source = ?
         AND UPPER(symbol) = UPPER(?)
       LIMIT 1`,
      [targetBroker, targetCanarySymbol]
    );
    if (targetBroker === 'delta_exchange') {
      addGate(gates, {
        key: 'target_broker_asset_mapping',
        status: targetBrokerAsset ? 'pass' : 'block',
        summary: targetBrokerAsset
          ? `Delta mapping exists for ${targetCanarySymbol}`
          : `Delta mapping is missing for ${targetCanarySymbol}`,
        detail: targetBrokerAsset
          ? `externalId/product_id=${readString(targetBrokerAsset.externalId)}, updated=${readDateIso(
              targetBrokerAsset.updatedAt
            ) ?? 'unknown'}.`
          : undefined,
      });

      if (targetBrokerAsset) {
        const productId = readString(targetBrokerAsset.externalId);
        const deltaProduct = productId
          ? await fetchDeltaProduct(productId)
          : { product: null, error: 'missing product id' };
        const product = deltaProduct.product;
        const state = readString(product?.state).toLowerCase();
        const tradingStatus = readString(product?.trading_status).toLowerCase();
        const contractType = readString(product?.contract_type).toLowerCase();
        const productSymbol = readString(product?.symbol).toUpperCase();
        const isLive =
          productSymbol === targetCanarySymbol &&
          state === 'live' &&
          tradingStatus === 'operational' &&
          contractType === 'perpetual_futures';
        addGate(gates, {
          key: 'target_delta_product_live',
          status: isLive ? 'pass' : 'block',
          summary: isLive
            ? `Delta product ${productId} is live for ${targetCanarySymbol}`
            : `Delta product ${productId || 'unknown'} is not live for ${targetCanarySymbol}`,
          detail: product
            ? `symbol=${productSymbol || 'unknown'}, state=${state || 'unknown'}, trading_status=${
                tradingStatus || 'unknown'
              }, contract_type=${contractType || 'unknown'}.`
            : deltaProduct.error
              ? `Product lookup failed: ${deltaProduct.error}.`
              : undefined,
        });
      }
    }

    const [suggestedTradeSnapshot] = targetUserId
      ? await queryRows<Row>(
          `SELECT COUNT(*) AS total,
                  SUM(status = 'Open') AS openCount,
                  MAX(created_at) AS latestCreatedAt
           FROM suggested_trades
           WHERE user_id = ?`,
          [targetUserId]
        )
      : [];
    addGate(gates, {
      key: 'suggested_trade_candidate',
      status: readNumber(suggestedTradeSnapshot?.openCount) > 0 ? 'pass' : 'block',
      summary:
        readNumber(suggestedTradeSnapshot?.openCount) > 0
          ? 'Open suggested-trade candidate exists'
          : 'No open suggested-trade candidate exists',
      detail: `${readNumber(suggestedTradeSnapshot?.total)} total suggested trade(s); latest ${readDateIso(
        suggestedTradeSnapshot?.latestCreatedAt
      ) ?? 'never'}.`,
    });

    const [submissionSnapshot] = targetUserId
      ? await queryRows<Row>(
          `SELECT COUNT(*) AS total,
                  SUM(execution_mode = 'live') AS liveCount,
                  SUM(reconciliation_state IN ('pending', 'missing')) AS unresolvedCount,
                  MAX(created_at) AS latestCreatedAt
           FROM order_submission_requests
           WHERE user_id = ?`,
          [targetUserId]
        )
      : [];
    addGate(gates, {
      key: 'order_submission_reconciliation_clean',
      status: readNumber(submissionSnapshot?.unresolvedCount) === 0 ? 'pass' : 'block',
      summary:
        readNumber(submissionSnapshot?.unresolvedCount) === 0
          ? 'Order-submission reconciliation has no unresolved rows'
          : 'Order-submission reconciliation has unresolved rows',
      detail: `${readNumber(submissionSnapshot?.total)} submission(s), ${readNumber(
        submissionSnapshot?.liveCount
      )} live, latest ${readDateIso(submissionSnapshot?.latestCreatedAt) ?? 'never'}.`,
    });

    const blockingGates = gates.filter((gate) => gate.status === 'block');
    const warningGates = gates.filter((gate) => gate.status === 'warn');
    const foundationGateKeys = [
      'target_user_active',
      'admin_broker_route',
      'admin_broker_credentials',
      'system_broker_route',
      'broker_assets_available',
      ...REQUIRED_USER_SCHEDULERS.map((key) => `${key}_enabled`),
      'funds_snapshot_fresh',
      'positions_snapshot_fresh',
      'orders_snapshot_fresh',
      'risk_snapshot_fresh',
      'risk_policy_hard_block',
      'order_submission_reconciliation_clean',
      ...(targetBroker === 'delta_exchange'
        ? ['target_broker_asset_mapping', 'target_delta_product_live']
        : []),
    ];
    const foundationReady = foundationGateKeys.every(
      (key) => gates.find((gate) => gate.key === key)?.status === 'pass'
    );
    const decision = blockingGates.length ? 'blocked' : 'ready';
    const report = {
      decision,
      strict,
      generatedAt: new Date().toISOString(),
      target: {
        email: targetEmail,
        userId: targetUserId,
        brokerKey: targetBroker,
        auditedBrokers,
        maxSnapshotAgeMinutes,
      },
      runtime,
      foundationReady,
      blockingGateCount: blockingGates.length,
      warningGateCount: warningGates.length,
      adminTargetRoute,
      systemTargetRoute,
      brokerAssets: assetRows.map((row) => ({
        source: readString(row.source),
        total: readNumber(row.total),
        latestUpdatedAt: readDateIso(row.latestUpdatedAt),
      })),
      targetBrokerAsset: targetBrokerAsset
        ? {
            source: readString(targetBrokerAsset.source),
            symbol: readString(targetBrokerAsset.symbol),
            externalId: readString(targetBrokerAsset.externalId),
            assetId: readString(targetBrokerAsset.assetId),
            updatedAt: readDateIso(targetBrokerAsset.updatedAt),
          }
        : null,
      automationSummary: {
        tradeSuggestionAutomations: automationRows.length,
        liveAutoCanaryCandidates: liveAutomationCandidates.length,
        latestAutomationUpdatedAt: readDateIso(findLatest(automationRows, 'updatedAt')),
      },
      suggestedTradeSummary: {
        total: readNumber(suggestedTradeSnapshot?.total),
        open: readNumber(suggestedTradeSnapshot?.openCount),
        latestCreatedAt: readDateIso(suggestedTradeSnapshot?.latestCreatedAt),
      },
      orderSubmissionSummary: {
        total: readNumber(submissionSnapshot?.total),
        live: readNumber(submissionSnapshot?.liveCount),
        unresolved: readNumber(submissionSnapshot?.unresolvedCount),
        latestCreatedAt: readDateIso(submissionSnapshot?.latestCreatedAt),
      },
      gates,
      nextActions: buildNextActions(gates),
    };

    console.log('broker-auto-canary-readiness:', JSON.stringify(report));

    if (strict && blockingGates.length) {
      process.exitCode = 1;
    }
  } finally {
    await coreDataSource.destroy();
  }
}

run().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }
  process.exit(1);
});
