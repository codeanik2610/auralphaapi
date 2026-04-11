import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('POSITIONS_ORDERS_SYNC_PHASE1.md');
  for (const marker of [
    '`positions-sync`',
    '`orders-sync`',
    '`/scheduler/positions`',
    '`/scheduler/orders`',
    '`/positions/futures/refresh`',
    '`/orders/futures/refresh`',
    '`/internal/positions/sync`',
    '`/internal/orders/sync`',
    'Phase 1 does not change runtime execution semantics yet.',
    'target ownership is a user-scoped scheduler record',
    'Phase 2 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`POSITIONS_ORDERS_SYNC_PHASE1.md: missing contract marker ${marker}`);
    }
  }

  const positionsChecklist = read('POSITIONS_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `positions-sync`',
    'Scheduler is normalized to `schedulerType = user`.',
    'Product route base: `/positions`',
    'Internal sync route: `/internal/positions/sync`',
    '## 5. Scheduler And Cron All-Users Execution Scope',
    '## 6. Product Page Own-User Execution Scope',
  ]) {
    if (!positionsChecklist.includes(marker)) {
      findings.push(`POSITIONS_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const ordersChecklist = read('ORDERS_SYNC_FUNCTIONAL_CHECKLIST.md');
  for (const marker of [
    'Scheduler key: `orders-sync`',
    'Scheduler is normalized to `schedulerType = user`.',
    'Product route base: `/orders`',
    'Internal sync route: `/internal/orders/sync`',
    '## 5. Scheduler And Cron All-Users Execution Scope',
    '## 6. Product Page Own-User Execution Scope',
  ]) {
    if (!ordersChecklist.includes(marker)) {
      findings.push(`ORDERS_SYNC_FUNCTIONAL_CHECKLIST.md: missing marker ${marker}`);
    }
  }

  const contractSource = read('src/api/utils/positionsOrdersSyncScopeContract.ts');
  for (const marker of [
    "export const POSITIONS_SYNC_SCHEDULER_KEY = 'positions-sync';",
    "export const ORDERS_SYNC_SCHEDULER_KEY = 'orders-sync';",
    "export const POSITIONS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;",
    "export const ORDERS_SYNC_SCHEDULER_OWNERSHIP = 'user' as const;",
    "export const POSITIONS_SYNC_ADMIN_ROUTE = '/scheduler/positions';",
    "export const ORDERS_SYNC_ADMIN_ROUTE = '/scheduler/orders';",
    "export const POSITIONS_INTERNAL_SYNC_ROUTE = '/internal/positions/sync';",
    "export const ORDERS_INTERNAL_SYNC_ROUTE = '/internal/orders/sync';",
    'export const ALL_USERS_BATCH_SYNC_SCHEDULERS = [',
    'export const USER_OWNED_PRODUCT_REFRESH_SURFACES = [',
  ]) {
    if (!contractSource.includes(marker)) {
      findings.push(`positionsOrdersSyncScopeContract.ts: missing Phase 1 marker ${marker}`);
    }
  }

  const positionsFacadeSource = read('src/api/services/BrokerPositionsFacadeService.ts');
  if (!positionsFacadeSource.includes('targetUserIds: [userId],')) {
    findings.push(
      'BrokerPositionsFacadeService.ts: /positions refresh must remain user-owned in Phase 1'
    );
  }

  const ordersFacadeSource = read('src/api/services/BrokerOrdersFacadeService.ts');
  if (!ordersFacadeSource.includes('targetUserIds: [userId],')) {
    findings.push(
      'BrokerOrdersFacadeService.ts: /orders refresh must remain user-owned in Phase 1'
    );
  }

  const positionsControllerSource = read('src/api/controllers/PositionsSchedulerController.ts');
  if (!positionsControllerSource.includes("@JsonController('/scheduler/positions')")) {
    findings.push('PositionsSchedulerController.ts: missing canonical admin route marker');
  }

  const ordersControllerSource = read('src/api/controllers/OrdersSchedulerController.ts');
  if (!ordersControllerSource.includes("@JsonController('/scheduler/orders')")) {
    findings.push('OrdersSchedulerController.ts: missing canonical admin route marker');
  }

  const internalPositionsControllerSource = read(
    'src/api/controllers/InternalPositionsSchedulerController.ts'
  );
  if (!internalPositionsControllerSource.includes("@JsonController('/internal/positions')")) {
    findings.push(
      'InternalPositionsSchedulerController.ts: missing canonical internal positions route marker'
    );
  }

  const internalOrdersControllerSource = read(
    'src/api/controllers/InternalOrdersSchedulerController.ts'
  );
  if (!internalOrdersControllerSource.includes("@JsonController('/internal/orders')")) {
    findings.push(
      'InternalOrdersSchedulerController.ts: missing canonical internal orders route marker'
    );
  }

  const readme = read('README.md');
  if (!readme.includes('POSITIONS_ORDERS_SYNC_PHASE1.md')) {
    findings.push('README.md: missing positions/orders sync Phase 1 baseline link');
  }
  if (!readme.includes('test:positions-orders-sync-phase1')) {
    findings.push('README.md: missing positions/orders sync Phase 1 verification command');
  }
  if (!readme.includes('frozen Phase 1 trust contract for `positions-sync` and `orders-sync`')) {
    findings.push('README.md: missing positions/orders sync Phase 1 baseline summary');
  }
  if (!readme.includes('target user-owned scheduler contract')) {
    findings.push('README.md: missing positions/orders sync target-contract summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:positions-orders-sync-phase1"')) {
    findings.push('package.json: missing positions/orders sync Phase 1 test script');
  }
  if (!packageSource.includes('npm run test:positions-orders-sync-phase1')) {
    findings.push('package.json: positions/orders sync Phase 1 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Positions/orders sync Phase 1 guard failed:\n${findings.join('\n')}`
  );
  console.log('Positions/orders sync Phase 1 guard passed.');
}

run();
