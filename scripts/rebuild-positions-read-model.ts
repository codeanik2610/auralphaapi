import 'reflect-metadata';
import assert from 'node:assert/strict';
import { coreDataSource } from '../src/database/data-source';
import { initializeCoreDataSource } from '../src/database/initializeCoreDataSource';
import {
  PositionReadModelCoverageRow,
  PositionReadModelRepository,
} from '../src/database/repositories/PositionReadModelRepository';

function parseCsv(value: string): string[] {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function readBoolean(value: string, fallback = false): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function needsReadModelRebuild(row: PositionReadModelCoverageRow | undefined): boolean {
  if (!row) {
    return false;
  }
  return (
    row.rowsMissingFromReadModel > 0 ||
    row.rowsBehindSnapshot > 0 ||
    row.orphanReadModelRows > 0 ||
    (row.snapshotRows > 0 && row.readModelRows === 0)
  );
}

async function resolveAccountIds(): Promise<string[]> {
  const explicitAccountIds = parseCsv(process.env.POSITIONS_REBUILD_ACCOUNT_IDS || '');
  if (explicitAccountIds.length) {
    return explicitAccountIds;
  }

  const ownerUserId = String(process.env.POSITIONS_REBUILD_OWNER_USER_ID || '').trim();
  const brokerKey = String(process.env.POSITIONS_REBUILD_BROKER_KEY || '').trim().toLowerCase();
  const rebuildAll = readBoolean(process.env.POSITIONS_REBUILD_ALL || '', false);

  assert.ok(
    rebuildAll || ownerUserId || brokerKey,
    'Provide POSITIONS_REBUILD_ACCOUNT_IDS, POSITIONS_REBUILD_OWNER_USER_ID, POSITIONS_REBUILD_BROKER_KEY, or set POSITIONS_REBUILD_ALL=true.'
  );

  const filters = ["LOWER(status) IN ('connected', 'idle')"];
  const params: string[] = [];
  if (ownerUserId) {
    filters.push('user_id = ?');
    params.push(ownerUserId);
  }
  if (brokerKey) {
    filters.push('LOWER(broker_key) = ?');
    params.push(brokerKey);
  }

  const rows = (await coreDataSource.query(
    `SELECT id AS accountId
       FROM broker_accounts
      WHERE ${filters.join(' AND ')}
      ORDER BY id ASC`,
    params
  )) as Array<{ accountId?: string }>;

  return rows.map((row) => String(row.accountId || '').trim()).filter(Boolean);
}

async function run(): Promise<void> {
  await initializeCoreDataSource();

  try {
    const repository = new PositionReadModelRepository();
    const limit = Math.max(0, Number(process.env.POSITIONS_REBUILD_LIMIT || 0));
    const onlyDrifted = readBoolean(process.env.POSITIONS_REBUILD_ONLY_DRIFTED || 'true', true);

    const requestedAccountIds = await resolveAccountIds();
    assert.ok(requestedAccountIds.length > 0, 'No broker accounts matched the requested rebuild scope.');

    const beforeCoverageSummary = await repository.summarizeReadModelCoverageByAccountIds(
      requestedAccountIds
    );
    const beforeCoverageByAccountId = await repository.getReadModelCoverageByAccountIds(
      requestedAccountIds
    );

    let targetAccountIds = onlyDrifted
      ? requestedAccountIds.filter((accountId) =>
          needsReadModelRebuild(beforeCoverageByAccountId.get(accountId))
        )
      : requestedAccountIds;

    if (limit > 0) {
      targetAccountIds = targetAccountIds.slice(0, limit);
    }

    if (!targetAccountIds.length) {
      console.log(
        'positions-read-model-rebuild:',
        JSON.stringify({
          requestedAccounts: requestedAccountIds.length,
          targetedAccounts: 0,
          onlyDrifted,
          beforeCoverageSummary,
          message: 'No account scopes currently need a read-model rebuild.',
        })
      );
      return;
    }

    const rebuildResult = await repository.rebuildReadModelsFromSnapshots(targetAccountIds);
    const afterCoverageSummary = await repository.summarizeReadModelCoverageByAccountIds(
      targetAccountIds
    );

    console.log(
      'positions-read-model-rebuild:',
      JSON.stringify({
        requestedAccounts: requestedAccountIds.length,
        targetedAccounts: targetAccountIds.length,
        onlyDrifted,
        beforeCoverageSummary,
        rebuildResult,
        afterCoverageSummary,
      })
    );
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

run().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }
  process.exit(1);
});
