import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PositionsSchedulerService } from '../src/api/services/PositionsSchedulerService';
import { BrokerPositionsFacadeService } from '../src/api/services/BrokerPositionsFacadeService';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runPositionsRecoveryRuntimeAssertions(): Promise<void> {
  const service = new PositionsSchedulerService() as any;
  const anchorConfig = {
    key: 'positions-sync',
    name: 'Positions Sync',
    description:
      'System reconciliation scheduler for broker position snapshots, checkpoints, and read-model hydration.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    config: {
      sources: ['positions'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };
  const userConfig = {
    schedulerKey: 'positions-sync',
    userId: 'ops-admin',
    name: 'Positions Sync',
    description:
      'System reconciliation scheduler for broker position snapshots, checkpoints, and read-model hydration.',
    enabled: true,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 200,
    schedulerType: 'user',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    config: {
      sources: ['positions'],
      retentionDays: 30,
      lookbackDays: 90,
    },
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.schedulerConfigRepository = {
    async createIfMissing() {
      return anchorConfig;
    },
    async updateByKey(_key: string, payload: Record<string, unknown>) {
      Object.assign(anchorConfig, payload);
      return anchorConfig;
    },
  };
  service.schedulerUserConfigRepository = {
    async createIfMissing(payload: Record<string, unknown>) {
      assert.equal(payload.schedulerKey, 'positions-sync');
      assert.equal(payload.userId, 'ops-admin');
      return userConfig;
    },
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'positions-sync');
      assert.equal(userId, 'ops-admin');
      Object.assign(userConfig, payload);
      return userConfig;
    },
  };
  service.activityRepository = {
    async listActivity(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'ops-admin');
      assert.equal(query.referenceId, 'positions-read-model-recovery');
      return {
        items: [
          {
            id: 'activity-1',
            title: 'Positions read-model rebuild completed',
            status: 'Success',
            actor: 'ops-admin',
            route: 'Schedulers',
            description: 'Positions read-model rebuild completed for owner owner-1.',
            referenceId: 'positions-read-model-recovery',
            correlationId: 'recovery-1',
            stream: 'Runs',
            related: 'positions-sync',
            createdAt: new Date('2026-04-10T10:30:00.000Z'),
            updatedAt: new Date('2026-04-10T10:30:00.000Z'),
            flags: [
              { id: 'scope', message: 'owner' },
              { id: 'state', message: 'applied' },
              { id: 'requested-accounts', message: '3' },
              { id: 'targeted-accounts', message: '2' },
              { id: 'processed-accounts', message: '1' },
              { id: 'skipped-accounts', message: '1' },
              { id: 'deleted-rows', message: '4' },
              { id: 'inserted-rows', message: '5' },
              { id: 'snapshot-rows-processed', message: '5' },
              { id: 'before-drift-accounts', message: '2' },
              { id: 'after-drift-accounts', message: '1' },
              { id: 'filter-owner-user-id', message: 'owner-1' },
              {
                id: 'next-step',
                message: 'Refresh sync truth and inspect remaining drift.',
              },
              {
                id: 'warning-1',
                message:
                  '1 targeted account had no snapshot rows available for rebuild and was skipped.',
              },
            ],
          },
        ],
        total: 1,
      };
    },
  };

  const configResponse = await service.getSchedulerConfig('ops-admin');
  assert.equal(configResponse.data.readModelRecoveryPolicy?.supported, true);
  assert.equal(configResponse.data.readModelRecoveryPolicy?.productTrustSurface, '/positions');
  assert.deepEqual(configResponse.data.readModelRecoveryPolicy?.supportedScopes, [
    'account',
    'owner',
    'broker',
    'all',
  ]);

  const historyResponse = await service.listReadModelRecoveryHistory('ops-admin', {
    limit: '10',
    offset: '0',
    status: 'success',
  });
  assert.equal(historyResponse.data.total, 1);
  assert.equal(historyResponse.data.items[0]?.recoveryId, 'recovery-1');
  assert.equal(historyResponse.data.items[0]?.scope, 'owner');
  assert.equal(historyResponse.data.items[0]?.actor, 'ops-admin');
  assert.equal(historyResponse.data.items[0]?.filters.ownerUserId, 'owner-1');
  assert.equal(historyResponse.data.items[0]?.warnings.length, 1);
}

async function runProductTrustBoundaryAssertions(): Promise<void> {
  const service = new BrokerPositionsFacadeService() as any;
  let capturedRequest: Record<string, unknown> | null = null;

  service.userTimeZoneService = {
    async resolveUserTimeZone() {
      return 'Asia/Kolkata';
    },
  };
  service.brokerAccountRepository = {
    async getActiveBrokerAccounts(userId: string, brokerKey?: string) {
      assert.equal(userId, 'desk-user-1');
      assert.equal(brokerKey, 'mudrex');
      return [
        { id: 'acct-1', brokerKey: 'mudrex' },
        { id: 'acct-2', brokerKey: 'mudrex' },
      ];
    },
  };
  service.internalPositionsSyncService = {
    async runBatch(request: Record<string, unknown>) {
      capturedRequest = request;
      return {
        processedAccounts: 1,
        failedAccounts: 0,
        fetchedRecords: 2,
        insertedRecords: 1,
        updatedRecords: 1,
        skippedRecords: 0,
        failures: [],
      };
    },
  };

  const response = await service.requestPositionsRefresh('desk-user-1', {
    brokerKey: 'mudrex',
    accountId: 'acct-1',
  });

  assert.equal(response.requested, true);
  assert.equal(response.scope, 'account');
  assert.ok(capturedRequest, 'product refresh should delegate to internal sync');
  const normalizedRequest = capturedRequest as Record<string, unknown>;
  assert.equal(normalizedRequest.executionScope, 'product_user');
  assert.equal(normalizedRequest.requestUserId, 'desk-user-1');
  assert.deepEqual(normalizedRequest.targetUserIds, ['desk-user-1']);
  assert.deepEqual(normalizedRequest.accountIds, ['acct-1']);
  assert.deepEqual(normalizedRequest.brokerKeys, ['mudrex']);
}

async function run(): Promise<void> {
  const findings: string[] = [];

  await runPositionsRecoveryRuntimeAssertions();
  await runProductTrustBoundaryAssertions();

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE7.md');
  for (const marker of [
    'Phase 7 closes the positions-specific operational contract',
    '`positions-sync`',
    'owner-aware sync-state diagnostics',
    'read-model recovery policy',
    'persisted recovery history',
    '`/positions`',
    '`targetUserIds: [userId]`',
    '`npm run test:positions-scheduler-phase7`',
    'Phase 8 should focus only on `orders-sync`',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE7.md: missing Phase 7 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE7.md')) {
    findings.push('README.md: missing positions/orders sync Phase 7 baseline link');
  }
  if (!readme.includes('positions-specific operational freeze')) {
    findings.push('README.md: missing positions/orders sync Phase 7 summary');
  }
  if (!readme.includes('test:positions-orders-sync-phase7')) {
    findings.push('README.md: missing positions/orders sync Phase 7 verification command');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync-phase7"')) {
    findings.push('package.json: missing positions/orders sync Phase 7 test script');
  }
  if (!packageSource.includes('npm run test:positions-orders-sync-phase7')) {
    findings.push('package.json: positions/orders sync Phase 7 guard must stay wired');
  }
  if (!packageSource.includes('npm run test:positions-scheduler-phase7 && node --import tsx scripts/test-positions-orders-sync-phase7.ts')) {
    findings.push('package.json: positions/orders sync Phase 7 command should build on the dedicated positions scheduler Phase 7 suite');
  }

  const positionsServiceSource = read('src/api/services/PositionsSchedulerService.ts');
  for (const marker of [
    'async rebuildReadModel(',
    'async listReadModelRecoveryHistory(',
    "referenceId: POSITIONS_RECOVERY_ACTIVITY_REFERENCE_ID",
    "productTrustSurface: '/positions'",
    'readModelNeedsRebuild',
    'ownerUserId',
  ]) {
    if (!positionsServiceSource.includes(marker)) {
      findings.push(`PositionsSchedulerService.ts: missing Phase 7 marker ${marker}`);
    }
  }

  const positionsControllerSource = read('src/api/controllers/PositionsSchedulerController.ts');
  for (const marker of [
    "@Post('/read-model/rebuild')",
    "@Get('/read-model/recovery-history')",
    "@QueryParam('ownerUserId') ownerUserId?: string",
  ]) {
    if (!positionsControllerSource.includes(marker)) {
      findings.push(`PositionsSchedulerController.ts: missing Phase 7 marker ${marker}`);
    }
  }

  const positionsDeskSource = read('src/api/services/BrokerPositionsFacadeService.ts');
  for (const marker of [
    'buildProductOwnedPositionsSyncRequest',
    'targetUserIds: [userId]',
    'No connected or idle broker routes are available for positions refresh on this desk.',
  ]) {
    if (!positionsDeskSource.includes(marker)) {
      findings.push(`BrokerPositionsFacadeService.ts: missing Phase 7 marker ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 7 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 7 guard passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
