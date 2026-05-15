import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { AlertsController } from '../src/api/controllers/AlertsController';
import { AlertsOverviewController } from '../src/api/controllers/AlertsOverviewController';
import { AlertsOverviewService } from '../src/api/services/AlertsOverviewService';
import { AlertsService } from '../src/api/services/AlertsService';
import {
  validateAlertAcknowledgeBody,
  validateAlertId,
  validateAlertMuteBody,
  validateAlertRouteBody,
  validateAlertsQuery,
} from '../src/api/validators/alerts.validator';
import { AlertRepository } from '../src/database/repositories/AlertRepository';
import { coreDataSource } from '../src/database/data-source';
import { Alert } from '../src/database/entities/Alert';
import { AlertAction } from '../src/database/entities/AlertAction';
import { getMetadataArgsStorage } from 'typeorm';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const authReq = { authUser: { sub: 'user-1' } } as any;
const unauthReq = {} as any;

async function assertAuthRequired(
  run: () => Promise<unknown>,
  message = 'Authentication required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function runAlertsControllerAssertions(): Promise<void> {
  const controller: any = new AlertsController();

  controller.alertsService = {
    getAlerts: async (...args: unknown[]) => createSuccess({ args }),
    getAlertsSummary: async (...args: unknown[]) => createSuccess({ args }),
    getAlertById: async (...args: unknown[]) => createSuccess({ args }),
    acknowledgeAlert: async (...args: unknown[]) => createSuccess({ args }),
    muteAlert: async (...args: unknown[]) => createSuccess({ args }),
    routeAlert: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getAlerts(authReq, undefined, undefined, 'Open', 'Critical', 'Risk')).data
      .args,
    [
      'user-1',
      {
        limit: undefined,
        offset: undefined,
        status: 'Open',
        search: 'Critical',
        severity: 'Risk',
        channel: undefined,
      },
    ]
  );
  assert.deepEqual((await controller.getAlertsSummary(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getAlertById(authReq, 'alert-1')).data.args, [
    'user-1',
    'alert-1',
  ]);
  assert.deepEqual(
    (await controller.acknowledgeAlert(authReq, 'alert-1', { note: 'Reviewed' })).data.args,
    ['user-1', 'alert-1', { note: 'Reviewed' }]
  );
  assert.deepEqual(
    (await controller.muteAlert(authReq, 'alert-1', { reason: 'Duplicate alert' })).data.args,
    ['user-1', 'alert-1', { reason: 'Duplicate alert' }]
  );
  assert.deepEqual(
    (await controller.routeAlert(authReq, 'alert-1', { target: 'risk', note: 'Risk team first' }))
      .data.args,
    ['user-1', 'alert-1', { target: 'risk', note: 'Risk team first' }]
  );

  await assertAuthRequired(() => controller.getAlerts(unauthReq));
  await assertAuthRequired(() => controller.getAlertsSummary(unauthReq));
  await assertAuthRequired(() => controller.getAlertById(unauthReq, 'alert-1'));
  await assertAuthRequired(() => controller.acknowledgeAlert(unauthReq, 'alert-1', {}));
}

async function runAlertsOverviewControllerAssertions(): Promise<void> {
  const controller: any = new AlertsOverviewController();

  controller.alertsOverviewService = {
    getOverview: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getOverview(
        authReq,
        '10',
        '5',
        'Open',
        'btc',
        'High',
        'Signals'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '10',
        offset: '5',
        status: 'Open',
        search: 'btc',
        severity: 'High',
        channel: 'Signals',
      },
    ]
  );

  await assertAuthRequired(() => controller.getOverview(unauthReq));
}

function runAlertsValidationAssertions(): void {
  assert.deepEqual(validateAlertsQuery({}), {
    limit: 20,
    offset: 0,
    status: undefined,
    search: undefined,
    severity: undefined,
    channel: undefined,
  });
  assert.deepEqual(
    validateAlertsQuery({
      limit: '5',
      offset: '2',
      status: 'Open',
      search: ' BTC ',
      severity: 'High',
      channel: ' Signals ',
    }),
    {
      limit: 5,
      offset: 2,
      status: 'Open',
      search: 'BTC',
      severity: 'High',
      channel: 'Signals',
    }
  );
  assert.throws(
    () => validateAlertsQuery({ limit: '0' }),
    /limit must be an integer between 1 and 100/
  );

  assert.equal(validateAlertId('  alert-1  '), 'alert-1');
  assert.throws(() => validateAlertId('  '), /alertId is required/);

  assert.deepEqual(validateAlertAcknowledgeBody({ note: ' reviewed ' }), {
    note: 'reviewed',
  });
  assert.deepEqual(validateAlertMuteBody({ reason: ' duplicate ' }), {
    reason: 'duplicate',
  });
  assert.deepEqual(
    validateAlertRouteBody({ target: ' automations ', note: ' queue ' }),
    {
      target: 'automations',
      note: 'queue',
    }
  );
  assert.throws(
    () => validateAlertRouteBody({ target: 'desk' }),
    /target must be one of: signals, risk, automations, orders/
  );
}

async function runAlertDeliveryPolicyAssertions(): Promise<void> {
  const emailOnlyRepo = new AlertRepository() as any;
  const emailOnlyAlerts: Array<Record<string, unknown>> = [];
  const emailOnlyDeliveries: Array<Record<string, unknown>> = [];

  Object.defineProperty(emailOnlyRepo, 'appSettingsRepository', {
    get: () => ({
      async findOne() {
        return {
          notifyEmail: true,
          notifyInApp: true,
          notificationChannel: 'email',
          notificationSeverity: 'all',
          escalationRoute: 'manual',
          escalationSlaMinutes: 30,
        };
      },
    }),
  });
  Object.defineProperty(emailOnlyRepo, 'userEntityRepository', {
    get: () => ({
      async findOne() {
        return { email: 'alerts@auralpha.com' };
      },
    }),
  });
  Object.defineProperty(emailOnlyRepo, 'alertRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        emailOnlyAlerts.push(payload);
        return { id: 'alert-1', ...payload };
      },
    }),
  });
  Object.defineProperty(emailOnlyRepo, 'emailDeliveryRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        emailOnlyDeliveries.push(payload);
        return payload;
      },
    }),
  });
  emailOnlyRepo.findRecentEmailDeliveryBySignature = async () => null;

  const emailOnlyResult = await emailOnlyRepo.createAlert({
    userId: 'user-1',
    severity: 'High',
    channel: 'Scheduler',
    symbol: 'SYSTEM',
    message: 'Worker heartbeat missing',
    route: 'Risk review',
    status: 'Open',
    source: 'scheduler-health',
    applyEscalationPolicy: true,
  });

  assert.equal(emailOnlyResult, null);
  assert.equal(emailOnlyAlerts.length, 0);
  assert.equal(emailOnlyDeliveries.length, 1);
  assert.equal(emailOnlyDeliveries[0].route, 'Manual triage');
  assert.match(String(emailOnlyDeliveries[0].body || ''), /Due in 30 min/);

  const suppressedRepo = new AlertRepository() as any;
  const suppressedAlerts: Array<Record<string, unknown>> = [];
  const suppressedDeliveries: Array<Record<string, unknown>> = [];

  Object.defineProperty(suppressedRepo, 'appSettingsRepository', {
    get: () => ({
      async findOne() {
        return {
          notifyEmail: true,
          notifyInApp: true,
          notificationChannel: 'both',
          notificationSeverity: 'all',
          escalationRoute: 'risk-review',
          escalationSlaMinutes: 15,
        };
      },
    }),
  });
  Object.defineProperty(suppressedRepo, 'userEntityRepository', {
    get: () => ({
      async findOne() {
        return { email: 'alerts@auralpha.com' };
      },
    }),
  });
  Object.defineProperty(suppressedRepo, 'alertRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        suppressedAlerts.push(payload);
        return { id: 'alert-suppressed', ...payload };
      },
    }),
  });
  Object.defineProperty(suppressedRepo, 'emailDeliveryRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        suppressedDeliveries.push(payload);
        return payload;
      },
    }),
  });
  suppressedRepo.findRecentEmailDeliveryBySignature = async () => null;

  const suppressedResult = await suppressedRepo.createAlert({
    userId: 'user-1',
    severity: 'Medium',
    channel: 'Broker Canary',
    symbol: 'BTCUSDT',
    message: 'Entry order snapshot is missing.',
    route: 'Orders',
    status: 'Open',
    source: 'broker-canary-monitor:submission-1',
    suppressEmailDelivery: true,
  });

  assert.equal(suppressedAlerts.length, 1);
  assert.equal(suppressedDeliveries.length, 0);
  assert.equal(suppressedResult?.id, 'alert-suppressed');
}

async function runAlertsAtomicActionAssertions(): Promise<void> {
  const service = new AlertsService() as any;
  const originalTransaction = (coreDataSource as any).transaction;
  const activityLogs: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];
  const committedAlerts = new Map<string, Record<string, unknown>>([
    [
      'alert-1',
      {
        id: 'alert-1',
        userId: 'user-1',
        severity: 'High',
        channel: 'Watchlist',
        symbol: 'BTCUSDT',
        message: 'Breakout threshold triggered',
        route: 'Signal review',
        status: 'Open',
        source: 'Momentum Core',
        urgency: 'Immediate',
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      },
    ],
    [
      'alert-2',
      {
        id: 'alert-2',
        userId: 'user-1',
        severity: 'Medium',
        channel: 'Risk',
        symbol: 'ETHUSDT',
        message: 'Margin utilization elevated',
        route: 'Risk review',
        status: 'Open',
        source: 'Portfolio Guard',
        urgency: 'Monitor',
        createdAt: new Date('2026-04-04T00:01:00.000Z'),
        updatedAt: new Date('2026-04-04T00:01:00.000Z'),
      },
    ],
  ]);
  const committedActions: Array<Record<string, unknown>> = [];
  let failingActionType: string | null = null;

  service.activityRepository = {
    async createActivityLog(payload: Record<string, unknown>) {
      activityLogs.push({ ...payload });
      return payload;
    },
  };

  service.alertRepository = {
    async findOpenAlertBySignature() {
      return null;
    },
    async createAlert(payload: Record<string, unknown>) {
      const created = {
        id: `failure-alert-${failureAlerts.length + 1}`,
        ...payload,
      };
      failureAlerts.push(created);
      return created;
    },
  };

  (coreDataSource as any).transaction = async (callback: (manager: any) => Promise<unknown>) => {
    const pendingAlerts = new Map<string, Record<string, unknown>>(
      Array.from(committedAlerts.entries()).map(([alertId, value]) => [alertId, { ...value }])
    );
    const pendingActions = committedActions.map((item) => ({ ...item }));

    const manager = {
      getRepository(entity: unknown) {
        if (entity === Alert) {
          return {
            async findOne({ where: { id, userId } }: { where: { id: string; userId: string } }) {
              const alert = pendingAlerts.get(id);
              if (!alert || alert.userId !== userId) {
                return null;
              }
              return { ...alert };
            },
            async update(
              criteria: { id: string; userId: string },
              payload: Record<string, unknown>
            ) {
              const existing = pendingAlerts.get(criteria.id);
              if (!existing || existing.userId !== criteria.userId) {
                return { affected: 0 };
              }

              pendingAlerts.set(criteria.id, {
                ...existing,
                ...payload,
                updatedAt: new Date('2026-04-04T00:05:00.000Z'),
              });
              return { affected: 1 };
            },
          };
        }

        if (entity === AlertAction) {
          return {
            create(payload: Record<string, unknown>) {
              return { ...payload };
            },
            async save(payload: Record<string, unknown>) {
              if (payload.actionType === failingActionType) {
                throw new Error(`${String(payload.actionType)} action write failed`);
              }

              const saved = {
                id: `action-${pendingActions.length + 1}`,
                createdAt: new Date('2026-04-04T00:06:00.000Z'),
                ...payload,
              };
              pendingActions.push(saved);
              return saved;
            },
          };
        }

        throw new Error('Unexpected repository request');
      },
    };

    const result = await callback(manager);
    committedAlerts.clear();
    for (const [alertId, value] of pendingAlerts.entries()) {
      committedAlerts.set(alertId, value);
    }
    committedActions.splice(0, committedActions.length, ...pendingActions);
    return result;
  };

  try {
    const acknowledged = await service.acknowledgeAlert('user-1', 'alert-1', {
      note: 'Reviewed by ops',
    });

    assert.equal(acknowledged.data.message, 'Alert acknowledged');
    assert.equal(committedAlerts.get('alert-1')?.status, 'Acknowledged');
    assert.equal(committedActions[0].actionType, 'acknowledge');
    assert.equal(activityLogs.filter((item) => item.title === 'Alert acknowledged').length, 1);

    const muted = await service.muteAlert('user-1', 'alert-2', {
      reason: 'Duplicate alert',
    });
    assert.equal(muted.data.message, 'Alert muted');
    assert.equal(committedAlerts.get('alert-2')?.status, 'Muted');
    assert.equal(committedActions[1].actionType, 'mute');

    const routed = await service.routeAlert('user-1', 'alert-2', {
      target: 'automations',
      note: 'Queue with automation desk',
    });
    assert.equal(routed.data.message, 'Alert triage updated');
    assert.equal(committedAlerts.get('alert-2')?.route, 'Automation desk');
    assert.equal(committedActions[2].actionType, 'route');
    assert.deepEqual(committedActions[2].metadata, {
      target: 'automations',
      targetLabel: 'Automation desk',
    });

    failingActionType = 'route';
    await assert.rejects(
      service.routeAlert('user-1', 'alert-1', { target: 'orders' }),
      /route action write failed/
    );
    assert.equal(committedAlerts.get('alert-1')?.route, 'Signal review');
    assert.equal(
      activityLogs.filter((item) => item.title === 'Alert triage update failed').length,
      1
    );
    assert.equal(failureAlerts.length, 1);
    assert.match(
      String(failureAlerts[0].message || ''),
      /Alert action failed \(route, alert-1\): route action write failed/
    );
  } finally {
    (coreDataSource as any).transaction = originalTransaction;
  }
}

async function runAlertDetailMappingAssertions(): Promise<void> {
  const service = new AlertsService() as any;

  service.alertRepository = {
    async getAlertById(userId: string, alertId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(alertId, 'alert-1');
      return {
        id: 'alert-1',
        userId: 'user-1',
        severity: 'High',
        channel: 'Signals',
        symbol: 'BTCUSDT',
        message: 'Breakout threshold triggered',
        route: 'Automation desk',
        status: 'Acknowledged',
        source: 'signals-promotion',
        urgency: 'Immediate',
        createdAt: new Date('2026-04-04T00:00:00.000Z'),
        updatedAt: new Date('2026-04-04T00:09:00.000Z'),
        actions: [
          {
            id: 'action-2',
            actionType: 'route',
            target: 'automations',
            note: 'Queue with automation desk',
            actor: 'user-1',
            metadata: {
              target: 'automations',
              targetLabel: 'Automation desk',
            },
            createdAt: new Date('2026-04-04T00:08:00.000Z'),
          },
          {
            id: 'action-1',
            actionType: 'acknowledge',
            target: null,
            note: 'Reviewed by ops',
            actor: 'user-1',
            metadata: null,
            createdAt: new Date('2026-04-04T00:05:00.000Z'),
          },
        ],
      };
    },
  };

  const response = await service.getAlertById('user-1', 'alert-1');

  assert.equal(response.data.id, 'alert-1');
  assert.equal(response.data.history.length, 3);
  assert.deepEqual(
    response.data.history.map((item: { title: string }) => item.title),
    ['Assigned to Automation desk', 'Alert acknowledged', 'Alert created']
  );
}

async function runScopedAlertsSummaryAssertions(): Promise<void> {
  const service = new AlertsService() as any;
  let capturedQuery: Record<string, unknown> | null = null;

  service.alertRepository = {
    async getAlertsSummary(_userId: string, query: Record<string, unknown>) {
      capturedQuery = query;
      return {
        openAlerts: 4,
        acknowledged: 1,
        highSeverityAlerts: 2,
      };
    },
  };

  const response = await service.getScopedAlertsSummary('user-1', {
    limit: '50',
    offset: '20',
    status: 'Open',
    search: 'BTC',
    severity: 'High',
    channel: 'Signals',
  });

  assert.deepEqual(capturedQuery, {
    status: 'Open',
    search: 'BTC',
    severity: 'High',
    channel: 'Signals',
  });
  assert.deepEqual(response.data, {
    openAlerts: 4,
    acknowledged: 1,
    highSeverityAlerts: 2,
    criticalSeverity: 2,
    watchlistCapable: 'Yes',
  });
}

async function runAlertsOverviewScopeAssertions(): Promise<void> {
  const service = new AlertsOverviewService() as any;
  const capturedCalls: Array<{ method: string; args: unknown[] }> = [];

  service.alertsService = {
    async getAlerts(...args: unknown[]) {
      capturedCalls.push({ method: 'getAlerts', args });
      return {
        data: {
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        },
      };
    },
    async getScopedAlertsSummary(...args: unknown[]) {
      capturedCalls.push({ method: 'getScopedAlertsSummary', args });
      return {
        data: {
          openAlerts: 2,
          acknowledged: 0,
          highSeverityAlerts: 1,
          criticalSeverity: 1,
          watchlistCapable: 'Yes',
        },
      };
    },
  };

  const query = {
    limit: '20',
    offset: '0',
    status: 'Open',
    search: 'BTC',
    severity: 'High',
    channel: 'Signals',
  };
  const response = await service.getOverview('user-1', query);

  assert.deepEqual(capturedCalls, [
    { method: 'getAlerts', args: ['user-1', query] },
    { method: 'getScopedAlertsSummary', args: ['user-1', query] },
  ]);
  assert.equal(response.data.summary.openAlerts, 2);
  assert.equal(response.data.alerts.total, 0);
}

function runAlertEntitySchemaAssertions(): void {
  const alertIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === Alert)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_alerts_user_created_at',
    'idx_alerts_user_status_created_at',
    'idx_alerts_user_severity_created_at',
  ]) {
    assert.ok(alertIndexes.includes(indexName), `Alert should define ${indexName}`);
  }
}

function runAlertsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:alerts'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-alerts.ts'
  );
  assert.equal(
    packageScripts['check:alerts-health'],
    'node --import tsx scripts/checks/check-alerts-health.ts'
  );
  assert.equal(
    packageScripts['release-gate:alerts'],
    'node --import tsx scripts/release-gates/release-gate-alerts.ts'
  );
  assert.equal(
    packageScripts['signoff:alerts'],
    'node --import tsx scripts/signoffs/signoff-alerts.ts'
  );
  assert.match(runPackageSuiteSource, /alerts:\s*\['test:alerts'\]/);
  assert.match(runPackageSuiteSource, /'release-baseline':\s*\[[\s\S]*'test:alerts'/);
  assert.equal(
    smokeModulesSource.includes('/alerts') && smokeModulesSource.includes('/alerts/summary'),
    true,
    'alerts smoke should exercise the list and summary APIs'
  );
}

async function main(): Promise<void> {
  await runAlertsControllerAssertions();
  await runAlertsOverviewControllerAssertions();
  runAlertsValidationAssertions();
  await runAlertDeliveryPolicyAssertions();
  await runAlertsAtomicActionAssertions();
  await runAlertDetailMappingAssertions();
  await runScopedAlertsSummaryAssertions();
  await runAlertsOverviewScopeAssertions();
  runAlertEntitySchemaAssertions();
  runAlertsScriptWiringAssertions();
  console.log('Alerts module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
