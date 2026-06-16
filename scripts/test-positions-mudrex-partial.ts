import assert from 'node:assert/strict';

async function runMudrexPartialLifecycleAssertions(): Promise<void> {
  const { InternalPositionsSyncService } =
    await import('../src/api/services/InternalPositionsSyncService');
  const service = new InternalPositionsSyncService() as any;

  const base = {
    asset_uuid: 'asset-sol',
    symbol: 'SOLUSDT',
    position_type: 'long',
    created_at: '2026-06-16T04:00:00.000Z',
    entry_price: '73.18929104477611',
  };
  const closed = {
    ...base,
    id: 'closed-position-id',
    status: 'closed',
    quantity: '28.1',
    closed_price: '75.35',
    pnl: '19.62899999',
    updated_at: '2026-06-16T08:50:57.000Z',
  };
  const partial = {
    ...base,
    id: 'partial-position-id',
    status: 'partial',
    quantity: '16',
    closed_price: '73.67',
    pnl: '7.69134328',
    updated_at: '2026-06-16T05:26:55.000Z',
  };

  const closedRow = service.buildPositionRow('user-1', 'account-1', 'mudrex', { ...closed });
  const partialRow = service.buildPositionRow('user-1', 'account-1', 'mudrex', { ...partial });

  assert.equal(closedRow.externalId, 'mudrex:asset-sol:2026-06-16T04:00:00.000Z:LONG');
  assert.equal(
    partialRow.externalId,
    'mudrex:asset-sol:2026-06-16T04:00:00.000Z:LONG:PARTIAL:partial-position-id'
  );
  assert.equal(partialRow.legacyExternalId, 'partial-position-id');

  const deduped = service.deduplicateByExternalId([{ ...closed }, { ...partial }], 'mudrex');
  assert.equal(deduped.length, 2);
  assert.deepEqual(
    deduped.map((item: Record<string, unknown>) => String(item.status || '').toLowerCase()).sort(),
    ['closed', 'partial']
  );
}

async function run(): Promise<void> {
  await runMudrexPartialLifecycleAssertions();
  console.log('Mudrex partial lifecycle assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
