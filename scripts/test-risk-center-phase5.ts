import assert from 'node:assert/strict';

import { BadRequestAppError } from '../src/api/errors/AppError';
import { BrokerOrdersFacadeService } from '../src/api/services/BrokerOrdersFacadeService';
import { RemoveRiskCenterTables1763800000000 } from '../src/database/migrations/1763800000000-RemoveRiskCenterTables';
import { RestoreRiskCenterTables1763800001000 } from '../src/database/migrations/1763800001000-RestoreRiskCenterTables';
import { HardenRiskPolicyTargetIntegrity1770600000000 } from '../src/database/migrations/1770600000000-HardenRiskPolicyTargetIntegrity';

function createOrderBody(overrides: Record<string, unknown> = {}) {
  return {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    symbol: 'BTCUSDT',
    side: 'long',
    execution_mode: 'live',
    leverage: 6,
    quantity: 1,
    order_price: 100,
    order_type: 'market',
    trigger_type: 'manual',
    is_takeprofit: false,
    is_stoploss: false,
    stoploss_price: 90,
    takeprofit_price: 120,
    reduce_only: false,
    ...overrides,
  };
}

function createRoute(overrides: Record<string, unknown> = {}) {
  return {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
    ...overrides,
  };
}

function createMigrationQueryRunner(options: {
  hasTable?: Record<string, boolean>;
  hasColumn?: Record<string, boolean>;
  indexExists?: boolean;
  duplicateTargets?: Array<{ user_id?: string; normalized_target_key?: string }>;
}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  const queryRunner = {
    async hasTable(tableName: string) {
      return options.hasTable?.[tableName] ?? false;
    },
    async hasColumn(tableName: string, columnName: string) {
      return options.hasColumn?.[`${tableName}.${columnName}`] ?? false;
    },
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });

      if (sql.includes('SHOW INDEX FROM risk_policies WHERE Key_name = ?')) {
        return options.indexExists ? [{ Key_name: 'uidx_risk_policies_user_target_key' }] : [];
      }

      if (sql.includes('HAVING normalized_target_key IS NOT NULL AND duplicate_count > 1')) {
        return options.duplicateTargets || [];
      }

      return [];
    },
  };

  return { queryRunner, queries };
}

async function runBlockedOrderActivityAssertions(): Promise<void> {
  const service = new BrokerOrdersFacadeService() as any;
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  let adapterCalls = 0;

  service.brokerAccountRoutingService = {
    async resolve() {
      return createRoute();
    },
  };
  service.riskService = {
    async evaluatePreTradeOrder() {
      return {
        blocked: true,
        breaches: ['Max leverage 6 exceeds policy limit 3'],
        reason: 'Max leverage 6 exceeds policy limit 3',
        policyId: 'policy-1',
      };
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activities.push(payload);
    },
    async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
      alerts.push(payload);
    },
  };
  service.brokerRuntimeRegistry = {
    getOrdersAdapter() {
      return {
        async createOrder() {
          adapterCalls += 1;
          return { ok: true };
        },
      };
    },
  };

  await assert.rejects(
    service.createFuturesOrder('user-1', 'asset-1', createOrderBody()),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, new BadRequestAppError('x').name);
      assert.equal(error.message, 'Max leverage 6 exceeds policy limit 3');
      return true;
    }
  );

  assert.equal(adapterCalls, 0);
  assert.equal(activities.length, 2);
  assert.equal(alerts.length, 2);

  const riskActivity = activities.find((item) => item.title === 'Order blocked by risk policy');
  assert.deepEqual(riskActivity, {
    type: 'Risk control',
    title: 'Order blocked by risk policy',
    status: 'Failed',
    route: 'Risk',
    stream: 'Controls',
    related: 'mudrex · acct-1',
    referenceId: 'policy-1',
    correlationId: 'mudrex · acct-1',
    description: 'Max leverage 6 exceeds policy limit 3 (policy policy-1)',
  });

  const orderFailureActivity = activities.find((item) => item.title === 'Order create failed');
  assert.deepEqual(orderFailureActivity, {
    type: 'Order',
    title: 'Order create failed',
    status: 'Failed',
    route: 'Orders',
    stream: 'Execution',
    related: 'mudrex · acct-1',
    correlationId: 'mudrex · acct-1',
    description: 'Max leverage 6 exceeds policy limit 3',
  });

  assert.deepEqual(alerts[0], {
    channel: 'Risk',
    source: 'mudrex',
    message: 'Max leverage 6 exceeds policy limit 3',
    route: 'Risk review',
  });
  assert.deepEqual(alerts[1], {
    channel: 'Trading',
    source: 'mudrex',
    message: 'Order create failed: Max leverage 6 exceeds policy limit 3',
    route: 'Risk review',
  });
}

async function runWarningOrderActivityAssertions(): Promise<void> {
  const service = new BrokerOrdersFacadeService() as any;
  const activities: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  let adapterCalls = 0;

  service.brokerAccountRoutingService = {
    async resolve() {
      return createRoute();
    },
  };
  service.riskService = {
    async evaluatePreTradeOrder() {
      return {
        blocked: false,
        breaches: ['Max leverage 6 exceeds policy limit 3'],
        reason: null,
        policyId: 'policy-1',
      };
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activities.push(payload);
    },
    async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
      alerts.push(payload);
    },
  };
  service.brokerRuntimeRegistry = {
    getOrdersAdapter() {
      return {
        async createOrder() {
          adapterCalls += 1;
          return {
            order_id: 'ext-1',
            status: 'OPEN',
          };
        },
      };
    },
  };
  service.suggestedTradesService = {
    async linkSuggestedTradeOrder() {
      return undefined;
    },
    async syncExecutionForPaperOrderUpdates() {
      return undefined;
    },
  };

  const response = await service.createFuturesOrder('user-1', 'asset-1', createOrderBody());

  assert.equal(adapterCalls, 1);
  assert.equal((response as Record<string, unknown>).order_id, 'ext-1');
  assert.equal(activities.length, 2);
  assert.equal(alerts.length, 0);

  const warningActivity = activities.find(
    (item) => item.title === 'Order submitted with risk warnings'
  );
  assert.deepEqual(warningActivity, {
    type: 'Risk control',
    title: 'Order submitted with risk warnings',
    status: 'In progress',
    route: 'Risk',
    stream: 'Controls',
    related: 'mudrex · acct-1',
    referenceId: 'policy-1',
    correlationId: 'mudrex · acct-1',
    description: 'Max leverage 6 exceeds policy limit 3 (policy policy-1)',
  });

  const orderCreatedActivity = activities.find((item) => item.title === 'Order created: asset-1');
  assert.deepEqual(orderCreatedActivity, {
    type: 'Order',
    title: 'Order created: asset-1',
    status: 'Success',
    route: 'Orders',
    stream: 'Execution',
    related: 'mudrex · acct-1',
    referenceId: 'ext-1',
    correlationId: 'ext-1',
    description: 'Order placed via mudrex',
  });
}

async function runMigrationHygieneAssertions(): Promise<void> {
  const removeMigration = new RemoveRiskCenterTables1763800000000();
  const removeRunner = createMigrationQueryRunner({
    hasTable: {
      risk_policies: true,
    },
    hasColumn: {
      'risk_policies.liquidation_buffer_warn_pct': true,
      'risk_policies.liquidation_buffer_critical_pct': true,
      'risk_policies.drawdown_warn_pct': true,
      'risk_policies.drawdown_critical_pct': true,
    },
  });

  await removeMigration.up(removeRunner.queryRunner as any);

  assert.ok(
    removeRunner.queries.some(({ sql }) =>
      sql.includes('ALTER TABLE risk_policies DROP COLUMN liquidation_buffer_warn_pct')
    )
  );
  assert.ok(
    removeRunner.queries.some(({ sql }) => sql.includes('DROP TABLE IF EXISTS risk_controls'))
  );
  assert.ok(
    removeRunner.queries.some(({ sql }) => sql.includes('DROP TABLE IF EXISTS risk_capacity_snapshots'))
  );

  const restoreMigration = new RestoreRiskCenterTables1763800001000();
  const restoreRunner = createMigrationQueryRunner({
    hasTable: {
      risk_controls: false,
      risk_alerts: false,
      risk_scenarios: false,
    },
  });

  await restoreMigration.up(restoreRunner.queryRunner as any);

  const restoreControlsSql =
    restoreRunner.queries.find(({ sql }) => sql.includes('CREATE TABLE IF NOT EXISTS risk_controls'))
      ?.sql || '';
  const restoreAlertsSql =
    restoreRunner.queries.find(({ sql }) => sql.includes('CREATE TABLE IF NOT EXISTS risk_alerts'))
      ?.sql || '';
  const restoreScenariosSql =
    restoreRunner.queries.find(({ sql }) => sql.includes('CREATE TABLE IF NOT EXISTS risk_scenarios'))
      ?.sql || '';

  assert.ok(restoreControlsSql.includes('user_id varchar(191) NOT NULL'));
  assert.ok(restoreControlsSql.includes('CONSTRAINT FK_risk_controls_USER_ID FOREIGN KEY (user_id)'));
  assert.ok(restoreAlertsSql.includes('user_id varchar(191) NOT NULL'));
  assert.ok(restoreAlertsSql.includes('CONSTRAINT FK_risk_alerts_USER_ID FOREIGN KEY (user_id)'));
  assert.ok(restoreScenariosSql.includes('user_id varchar(191) NOT NULL'));

  const hardenMigration = new HardenRiskPolicyTargetIntegrity1770600000000();
  const hardenRunner = createMigrationQueryRunner({
    hasTable: {
      risk_policies: true,
    },
    hasColumn: {
      'risk_policies.normalized_target_key': false,
    },
    indexExists: false,
  });

  await hardenMigration.up(hardenRunner.queryRunner as any);

  assert.ok(
    hardenRunner.queries.some(({ sql }) =>
      sql.includes('SET scope = LOWER(TRIM(scope))')
    )
  );
  assert.ok(
    hardenRunner.queries.some(({ sql }) =>
      sql.includes('ADD COLUMN normalized_target_key varchar(255)')
    )
  );
  assert.ok(
    hardenRunner.queries.some(({ sql }) =>
      sql.includes('CREATE UNIQUE INDEX uidx_risk_policies_user_target_key')
    )
  );

  const hardenDownRunner = createMigrationQueryRunner({
    hasTable: {
      risk_policies: true,
    },
    hasColumn: {
      'risk_policies.normalized_target_key': true,
    },
    indexExists: true,
  });

  await hardenMigration.down(hardenDownRunner.queryRunner as any);

  assert.ok(
    hardenDownRunner.queries.some(({ sql }) =>
      sql.includes('DROP INDEX uidx_risk_policies_user_target_key ON risk_policies')
    )
  );
  assert.ok(
    hardenDownRunner.queries.some(({ sql }) =>
      sql.includes('ALTER TABLE risk_policies DROP COLUMN normalized_target_key')
    )
  );

  const duplicateRunner = createMigrationQueryRunner({
    hasTable: {
      risk_policies: true,
    },
    hasColumn: {
      'risk_policies.normalized_target_key': false,
    },
    duplicateTargets: [
      {
        user_id: 'user-1',
        normalized_target_key: 'broker::mudrex',
      },
    ],
  });

  await assert.rejects(
    hardenMigration.up(duplicateRunner.queryRunner as any),
    /Cannot harden risk policy targets because duplicate owner-scoped targets already exist: user-1:broker::mudrex/
  );
  assert.equal(
    duplicateRunner.queries.some(({ sql }) =>
      sql.includes('CREATE UNIQUE INDEX uidx_risk_policies_user_target_key')
    ),
    false
  );
}

async function main(): Promise<void> {
  await runBlockedOrderActivityAssertions();
  await runWarningOrderActivityAssertions();
  await runMigrationHygieneAssertions();
  console.log('Risk Center Phase 5 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
