import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BrokerReconciliationController } from '../src/api/controllers/BrokerReconciliationController';
import { BrokerReconciliationReadService } from '../src/api/services/BrokerReconciliationReadService';
import { coreDataSource } from '../src/database/data-source';
import {
  BrokerReconciliationRepository,
  BrokerReconciliationRunReadRow,
  BrokerReconciliationUnmatchedEvidenceRow,
} from '../src/database/repositories/BrokerReconciliationRepository';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

const authReq = { authUser: { sub: 'user-1' } } as any;
const unauthReq = {} as any;

function createRunRow(
  overrides: Partial<BrokerReconciliationRunReadRow> = {}
): BrokerReconciliationRunReadRow {
  return {
    id: 'run-1',
    user_id: 'user-1',
    broker_key: 'delta_exchange',
    account_id: 'acct-1',
    run_type: 'broker_app_match',
    status: 'completed',
    window_start_at: new Date('2026-06-08T00:00:00.000Z'),
    window_end_at: new Date('2026-06-09T00:00:00.000Z'),
    started_at: new Date('2026-06-09T10:00:00.000Z'),
    finished_at: new Date('2026-06-09T10:01:00.000Z'),
    fills_count: '5',
    fee_entries_count: '2',
    funding_entries_count: '1',
    wallet_transactions_count: '3',
    balance_snapshots_count: '1',
    gross_pnl: '9',
    fees_total: '-0.4',
    funding_total: '0.12',
    net_pnl: '8.72',
    balance_delta: null,
    unmatched_delta: '0.72',
    summary_json: JSON.stringify({ phase: 5, coverage: { matchedFillCoveragePct: 80 } }),
    error_message: null,
    created_at: new Date('2026-06-09T10:00:00.000Z'),
    updated_at: new Date('2026-06-09T10:01:00.000Z'),
    ...overrides,
  };
}

function createEvidenceRow(
  overrides: Partial<BrokerReconciliationUnmatchedEvidenceRow> = {}
): BrokerReconciliationUnmatchedEvidenceRow {
  return {
    kind: 'fills',
    id: 'fill-1',
    broker_key: 'delta_exchange',
    account_id: 'acct-1',
    external_id: 'delta_exchange:fill:1',
    symbol: 'BTCUSD',
    order_id: 'order-1',
    position_id: '27',
    suggested_trade_id: null,
    side: 'buy',
    amount: '200',
    quantity: '0.002',
    price: '100000',
    occurred_at: new Date('2026-06-08T10:00:00.000Z'),
    match_state: 'unmatched',
    match_confidence: 'unknown',
    source: 'delta_fills',
    raw_payload_json: JSON.stringify({ id: 'fill-1' }),
    ...overrides,
  };
}

async function runRepositoryReadAssertions(): Promise<void> {
  const repository = new BrokerReconciliationRepository();
  const originalQuery = (coreDataSource as any).query;
  const capturedQueries: Array<{ sql: string; params: unknown[] }> = [];

  (coreDataSource as any).query = async (sql: string, params: unknown[] = []) => {
    capturedQueries.push({ sql, params });
    if (sql.includes('COUNT(*) AS total') && sql.includes('broker_reconciliation_runs')) {
      return [{ total: '2' }];
    }
    if (sql.includes('FROM broker_reconciliation_runs') && sql.includes('LIMIT ? OFFSET ?')) {
      return [createRunRow(), createRunRow({ id: 'run-2', broker_key: 'mudrex' })];
    }
    if (sql.includes('WHERE user_id = ? AND id = ?')) {
      return [createRunRow({ id: 'run-detail-1' })];
    }
    if (sql.includes('COUNT(*) AS total') && sql.includes('evidence')) {
      return [{ total: '1' }];
    }
    if (sql.includes('SELECT * FROM') && sql.includes('evidence')) {
      return [createEvidenceRow()];
    }
    throw new Error(`Unexpected SQL in repository read test: ${sql}`);
  };

  try {
    const list = await repository.listReconciliationRuns({
      userId: 'user-1',
      brokerKey: 'DELTA_EXCHANGE',
      accountId: 'acct-1',
      status: 'completed',
      runType: 'broker_app_match',
      limit: 10,
      offset: 5,
    });
    assert.equal(list.total, 2);
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0].id, 'run-1');

    const detail = await repository.getReconciliationRunById('user-1', 'run-detail-1');
    assert.equal(detail?.id, 'run-detail-1');

    const unmatched = await repository.listUnmatchedEvidence({
      userId: 'user-1',
      brokerKey: 'delta_exchange',
      accountId: 'acct-1',
      kind: 'fills',
      windowStartAt: '2026-06-08T00:00:00.000Z',
      windowEndAt: '2026-06-09T00:00:00.000Z',
      limit: 10,
      offset: 0,
    });
    assert.equal(unmatched.total, 1);
    assert.equal(unmatched.items[0].kind, 'fills');

    const listSelect = capturedQueries.find((entry) =>
      entry.sql.includes('FROM broker_reconciliation_runs')
    );
    assert.ok(listSelect?.params.includes('delta_exchange'));
    assert.ok(listSelect?.params.includes('completed'));
    assert.ok(listSelect?.params.includes('broker_app_match'));
    assert.match(
      capturedQueries.find((entry) => entry.sql.includes('evidence'))?.sql || '',
      /broker_fills fill/
    );
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runServiceAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationReadService();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  service.brokerReconciliationRepository = {
    async listReconciliationRuns(...args: unknown[]) {
      calls.push({ method: 'listReconciliationRuns', args });
      return {
        items: [createRunRow()],
        total: 1,
      };
    },
    async getReconciliationRunById(...args: unknown[]) {
      calls.push({ method: 'getReconciliationRunById', args });
      return createRunRow({ id: args[1] as string });
    },
    async listUnmatchedEvidence(...args: unknown[]) {
      calls.push({ method: 'listUnmatchedEvidence', args });
      return {
        items: [createEvidenceRow()],
        total: 1,
      };
    },
  };

  const listResponse = await service.listRuns('user-1', {
    limit: '500',
    offset: '2',
    brokerKey: 'delta_exchange',
  });
  assert.equal(listResponse.data.limit, 200);
  assert.equal(listResponse.data.offset, 2);
  assert.equal(listResponse.data.items[0].summary?.phase, 5);
  assert.equal(listResponse.data.items[0].counts.fills, 5);
  assert.equal(listResponse.data.items[0].pnl.net, 8.72);

  const detailResponse = await service.getRunDetail('user-1', 'run-1');
  assert.equal(detailResponse.data.id, 'run-1');
  assert.equal(detailResponse.data.unmatchedEvidencePreview.total, 1);
  assert.equal(detailResponse.data.unmatchedEvidencePreview.items[0].rawPayload?.id, 'fill-1');

  const unmatchedResponse = await service.listRunUnmatchedEvidence('user-1', 'run-1', {
    kind: 'bad-kind',
    limit: '5',
    offset: '1',
  });
  assert.equal(unmatchedResponse.data.kind, 'all');
  assert.equal(unmatchedResponse.data.limit, 5);
  assert.equal(unmatchedResponse.data.offset, 1);
  assert.equal(unmatchedResponse.data.items[0].amount, 200);
  assert.equal(unmatchedResponse.data.items[0].occurredAt, '2026-06-08T10:00:00.000Z');

  const unmatchedCall = calls.filter((call) => call.method === 'listUnmatchedEvidence').at(-1);
  const unmatchedPayload = unmatchedCall?.args[0] as Record<string, unknown>;
  assert.equal(unmatchedPayload.brokerKey, 'delta_exchange');
  assert.equal(unmatchedPayload.accountId, 'acct-1');
  assert.equal(unmatchedPayload.kind, 'all');
}

async function runServiceNotFoundAssertions(): Promise<void> {
  const service: any = new BrokerReconciliationReadService();
  service.brokerReconciliationRepository = {
    async getReconciliationRunById() {
      return null;
    },
  };

  await assert.rejects(
    () => service.getRunDetail('user-1', 'missing-run'),
    /Broker reconciliation run not found/
  );
}

async function runControllerAssertions(): Promise<void> {
  const controller: any = new BrokerReconciliationController();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  controller.brokerReconciliationReadService = {
    async listRuns(...args: unknown[]) {
      calls.push({ method: 'listRuns', args });
      return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
    },
    async getRunDetail(...args: unknown[]) {
      calls.push({ method: 'getRunDetail', args });
      return createSuccess({ id: 'run-1' });
    },
    async listRunUnmatchedEvidence(...args: unknown[]) {
      calls.push({ method: 'listRunUnmatchedEvidence', args });
      return createSuccess({ items: [], total: 0, limit: 10, offset: 0, kind: 'fills' });
    },
  };

  await controller.listRuns(
    authReq,
    '10',
    '0',
    'delta_exchange',
    'acct-1',
    'completed',
    'broker_app_match'
  );
  await controller.getRunDetail(authReq, 'run-1');
  await controller.listRunUnmatchedEvidence(authReq, 'run-1', '10', '0', 'fills');

  assert.deepEqual(calls[0], {
    method: 'listRuns',
    args: [
      'user-1',
      {
        limit: '10',
        offset: '0',
        brokerKey: 'delta_exchange',
        accountId: 'acct-1',
        status: 'completed',
        runType: 'broker_app_match',
      },
    ],
  });
  assert.deepEqual(calls[1], { method: 'getRunDetail', args: ['user-1', 'run-1'] });
  assert.deepEqual(calls[2], {
    method: 'listRunUnmatchedEvidence',
    args: ['user-1', 'run-1', { limit: '10', offset: '0', kind: 'fills' }],
  });
  await assert.rejects(() => controller.listRuns(unauthReq), /Authentication required/);
}

function runScriptAndSourceWiringAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['test:broker-reconciliation-read'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-broker-reconciliation-read.ts'
  );

  const suiteSource = read('scripts/_support/run-package-suite.ts');
  assert.match(suiteSource, /'broker-reconciliation-read':\s*'baseline'/);
  assert.match(
    suiteSource,
    /'broker-reconciliation-read':\s*\['test:broker-reconciliation-read'\]/
  );
  assert.match(suiteSource, /'test:broker-reconciliation-read'/);

  const controllerSource = read('src/api/controllers/BrokerReconciliationController.ts');
  assert.match(controllerSource, /@JsonController\('\/broker-reconciliation'\)/);
  assert.match(controllerSource, /@Get\('\/runs'\)/);
  assert.match(controllerSource, /@Get\('\/runs\/:runId\/unmatched'\)/);

  const serviceSource = read('src/api/services/BrokerReconciliationReadService.ts');
  assert.match(serviceSource, /listRuns/);
  assert.match(serviceSource, /getRunDetail/);
  assert.match(serviceSource, /listRunUnmatchedEvidence/);
}

async function main(): Promise<void> {
  await runRepositoryReadAssertions();
  await runServiceAssertions();
  await runServiceNotFoundAssertions();
  await runControllerAssertions();
  runScriptAndSourceWiringAssertions();
  console.log('Broker reconciliation read assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
