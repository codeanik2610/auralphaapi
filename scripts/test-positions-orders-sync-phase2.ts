import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../src/env';
import {
  ALL_USERS_BATCH_SYNC_SCHEDULERS,
  buildProductOwnedOrdersSyncRequest,
  buildProductOwnedPositionsSyncRequest,
  buildSystemOwnedOrdersSyncRequest,
  buildSystemOwnedPositionsSyncRequest,
  ORDERS_SYNC_RUNTIME_OWNERSHIP_LEGACY,
  ORDERS_SYNC_SCHEDULER_OWNERSHIP,
  POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE,
  POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE,
  POSITIONS_SYNC_RUNTIME_OWNERSHIP_LEGACY,
  POSITIONS_SYNC_SCHEDULER_OWNERSHIP,
} from '../src/api/utils/positionsOrdersSyncScopeContract';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function testSharedOwnershipContract(): void {
  assert.equal(POSITIONS_SYNC_SCHEDULER_OWNERSHIP, 'user');
  assert.equal(ORDERS_SYNC_SCHEDULER_OWNERSHIP, 'user');
  assert.equal(POSITIONS_SYNC_RUNTIME_OWNERSHIP_LEGACY, 'global');
  assert.equal(ORDERS_SYNC_RUNTIME_OWNERSHIP_LEGACY, 'global');
  assert.deepEqual(ALL_USERS_BATCH_SYNC_SCHEDULERS, ['positions-sync', 'orders-sync']);
}

function testSharedExecutionRequestBuilders(): void {
  const systemPositions = buildSystemOwnedPositionsSyncRequest({
    targetUserIds: ['someone-else'],
    brokerKeys: ['delta_exchange'],
    accountIds: ['acct-1'],
  });
  assert.equal(systemPositions.executionScope, POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE);
  assert.deepEqual(systemPositions.targetUserIds, [env.scheduler.systemUserId]);
  assert.equal(systemPositions.requestUserId, env.scheduler.systemUserId);
  assert.deepEqual(systemPositions.brokerKeys, ['delta_exchange']);
  assert.deepEqual(systemPositions.accountIds, ['acct-1']);

  const systemOrders = buildSystemOwnedOrdersSyncRequest({
    targetUserIds: ['someone-else'],
    brokerKeys: ['mudrex'],
    accountIds: ['acct-2'],
  });
  assert.equal(systemOrders.executionScope, POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE);
  assert.deepEqual(systemOrders.targetUserIds, [env.scheduler.systemUserId]);
  assert.equal(systemOrders.requestUserId, env.scheduler.systemUserId);
  assert.deepEqual(systemOrders.brokerKeys, ['mudrex']);
  assert.deepEqual(systemOrders.accountIds, ['acct-2']);

  const productPositions = buildProductOwnedPositionsSyncRequest('user-7', {
    targetUserIds: ['ignored-user'],
    brokerKeys: ['delta_exchange'],
  });
  assert.equal(productPositions.executionScope, POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE);
  assert.deepEqual(productPositions.targetUserIds, ['user-7']);
  assert.equal(productPositions.requestUserId, 'user-7');

  const productOrders = buildProductOwnedOrdersSyncRequest('user-9', {
    targetUserIds: ['ignored-user'],
    accountIds: ['acct-9'],
  });
  assert.equal(productOrders.executionScope, POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE);
  assert.deepEqual(productOrders.targetUserIds, ['user-9']);
  assert.equal(productOrders.requestUserId, 'user-9');
  assert.deepEqual(productOrders.accountIds, ['acct-9']);
}

function testPhase2Markers(): void {
  const findings: string[] = [];

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE2.md');
  for (const marker of [
    '`orders-sync`',
    '`positions-sync`',
    'positionsOrdersSyncScopeContract.ts',
    'target user-owned scheduler',
    'shared contract layer',
    'Phase 3 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE2.md: missing marker ${marker}`);
    }
  }

  const contractSource = read('src/api/utils/positionsOrdersSyncScopeContract.ts');
  for (const marker of [
    "export const POSITIONS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;",
    "export const ORDERS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;",
    "export const POSITIONS_SYNC_RUNTIME_OWNERSHIP_LEGACY = 'global' as const;",
    "export const ORDERS_SYNC_RUNTIME_OWNERSHIP_LEGACY = 'global' as const;",
    'export const ALL_USERS_BATCH_SYNC_SCHEDULERS = [',
    'export const ALL_USERS_SYSTEM_SYNC_SCHEDULERS = ALL_USERS_BATCH_SYNC_SCHEDULERS;',
    'buildSystemOwnedPositionsSyncRequest(',
    'buildSystemOwnedOrdersSyncRequest(',
    'buildProductOwnedPositionsSyncRequest(',
    'buildProductOwnedOrdersSyncRequest(',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`positionsOrdersSyncScopeContract.ts: missing Phase 2 marker ${marker}`);
    }
  }

  const ordersServiceSource = read('src/api/services/OrdersSchedulerService.ts');
  for (const marker of [
    'ORDERS_SYNC_SCHEDULER_OWNERSHIP',
    'ORDERS_SYNC_SCHEDULER_NAME',
    'resolveSystemExecutionActorUserId(',
  ]) {
    if (!ordersServiceSource.includes(marker)) {
      findings.push(`OrdersSchedulerService.ts: missing Phase 2 transition marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE2.md')) {
    findings.push('README.md: missing positions/orders sync Phase 2 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync-phase2')) {
    findings.push('README.md: missing positions/orders sync Phase 2 verification command');
  }
  if (!readme.includes('shared contract alignment')) {
    findings.push('README.md: missing positions/orders sync Phase 2 shared-contract summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync-phase2"')) {
    findings.push('package.json: missing positions/orders sync Phase 2 test script');
  }
  if (!packageSource.includes('npm run test:positions-orders-sync-phase2')) {
    findings.push('package.json: positions/orders sync Phase 2 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 2 markers failed:\n${findings.join('\n')}`
  );
}

async function run(): Promise<void> {
  testSharedOwnershipContract();
  testSharedExecutionRequestBuilders();
  testPhase2Markers();
  console.log('Positions/orders sync Phase 2 assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
