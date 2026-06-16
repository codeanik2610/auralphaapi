import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Container } from 'typedi';
import { InternalPositionsSyncService } from '../../src/api/services/InternalPositionsSyncService';
import { POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE } from '../../src/api/utils/positionsOrdersSyncScopeContract';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import {
  PositionReadModelCoverageRow,
  PositionReadModelRepository,
} from '../../src/database/repositories/PositionReadModelRepository';

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
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function readPositiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
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
  const explicitAccountIds = parseCsv(process.env.POSITIONS_BACKFILL_ACCOUNT_IDS || '');
  if (explicitAccountIds.length) {
    return explicitAccountIds;
  }

  const ownerUserId = String(process.env.POSITIONS_BACKFILL_OWNER_USER_ID || '').trim();
  const brokerKey = String(process.env.POSITIONS_BACKFILL_BROKER_KEY || '')
    .trim()
    .toLowerCase();
  const rebuildAll = readBoolean(process.env.POSITIONS_BACKFILL_ALL || '', false);

  assert.ok(
    rebuildAll || ownerUserId || brokerKey,
    'Provide POSITIONS_BACKFILL_ACCOUNT_IDS, POSITIONS_BACKFILL_OWNER_USER_ID, POSITIONS_BACKFILL_BROKER_KEY, or set POSITIONS_BACKFILL_ALL=true.'
  );

  const filters = ["LOWER(status) IN ('connected', 'idle')"];
  const params: string[] = [];
  if (ownerUserId) {
    filters.push('user_id = ?');
    params.push(ownerUserId);
  }
  if (brokerKey) {
    filters.push('LOWER(brokerKey) = ?');
    params.push(brokerKey);
  }

  const rows = (await coreDataSource.query(
    `SELECT id AS accountId
       FROM broker_accounts
      WHERE ${filters.join(' AND ')}
      ORDER BY brokerKey ASC, id ASC`,
    params
  )) as Array<{ accountId?: string }>;

  return rows.map((row) => String(row.accountId || '').trim()).filter(Boolean);
}

async function resolveAccountRoutes(accountIds: string[]): Promise<
  Array<{
    accountId: string;
    userId: string;
    brokerKey: string;
  }>
> {
  if (!accountIds.length) {
    return [];
  }
  const rows = (await coreDataSource.query(
    `SELECT id AS accountId,
            user_id AS userId,
            LOWER(brokerKey) AS brokerKey
       FROM broker_accounts
      WHERE id IN (${accountIds.map(() => '?').join(', ')})
      ORDER BY brokerKey ASC, id ASC`,
    accountIds
  )) as Array<{ accountId?: string; userId?: string; brokerKey?: string }>;

  return rows
    .map((row) => ({
      accountId: String(row.accountId || '').trim(),
      userId: String(row.userId || '').trim(),
      brokerKey: String(row.brokerKey || '')
        .trim()
        .toLowerCase(),
    }))
    .filter((row) => row.accountId && row.userId && row.brokerKey);
}

async function run(): Promise<void> {
  await initializeCoreDataSource();

  try {
    const apply = readBoolean(process.env.POSITIONS_BACKFILL_APPLY || '', false);
    const dryRun = apply ? readBoolean(process.env.POSITIONS_BACKFILL_DRY_RUN || '', false) : true;
    const startDate = String(process.env.POSITIONS_BACKFILL_START_DATE || '').trim() || undefined;
    const endDate = String(process.env.POSITIONS_BACKFILL_END_DATE || '').trim() || undefined;
    const historyWindowDays = readPositiveInteger(
      process.env.POSITIONS_BACKFILL_HISTORY_WINDOW_DAYS || '',
      30
    );
    const limit = Math.max(0, Number(process.env.POSITIONS_BACKFILL_LIMIT || 0));
    const onlyDrifted = readBoolean(process.env.POSITIONS_BACKFILL_ONLY_DRIFTED || 'false', false);
    const repository = new PositionReadModelRepository();

    assert.ok(
      !apply || !dryRun,
      'POSITIONS_BACKFILL_APPLY=true cannot be combined with POSITIONS_BACKFILL_DRY_RUN=true.'
    );
    assert.ok(
      startDate && endDate,
      'Provide POSITIONS_BACKFILL_START_DATE and POSITIONS_BACKFILL_END_DATE in YYYY-MM-DD format.'
    );

    const requestedAccountIds = await resolveAccountIds();
    assert.ok(requestedAccountIds.length > 0, 'No broker accounts matched the requested scope.');

    const routes = await resolveAccountRoutes(requestedAccountIds);
    const knownAccountIds = routes.map((route) => route.accountId);
    const beforeCoverageSummary =
      await repository.summarizeReadModelCoverageByAccountIds(knownAccountIds);
    const beforeCoverageByAccountId =
      await repository.getReadModelCoverageByAccountIds(knownAccountIds);

    let targetAccountIds = onlyDrifted
      ? knownAccountIds.filter((accountId) =>
          needsReadModelRebuild(beforeCoverageByAccountId.get(accountId))
        )
      : knownAccountIds;
    if (limit > 0) {
      targetAccountIds = targetAccountIds.slice(0, limit);
    }
    const targetRoutes = routes.filter((route) => targetAccountIds.includes(route.accountId));
    const targetUserIds = Array.from(new Set(targetRoutes.map((route) => route.userId)));
    const targetBrokerKeys = Array.from(new Set(targetRoutes.map((route) => route.brokerKey)));

    const syncRequest = {
      executionScope: POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE,
      targetUserIds,
      brokerKeys: targetBrokerKeys,
      accountIds: targetAccountIds,
      startDate,
      endDate,
      historyWindowDays,
      backfill: true,
    };

    if (dryRun) {
      console.log(
        'positions-history-backfill-rebuild:',
        JSON.stringify({
          state: 'dry_run',
          requestedAccounts: requestedAccountIds.length,
          knownAccounts: knownAccountIds.length,
          targetedAccounts: targetAccountIds.length,
          onlyDrifted,
          beforeCoverageSummary,
          syncRequest,
          message:
            'Dry run only. Set POSITIONS_BACKFILL_APPLY=true and POSITIONS_BACKFILL_DRY_RUN=false to refresh snapshots and rebuild read models.',
        })
      );
      return;
    }

    assert.ok(targetAccountIds.length > 0, 'No account scopes matched the rebuild target filter.');

    const syncService = Container.get(InternalPositionsSyncService);
    const syncResult = await syncService.runBatch(syncRequest);
    const rebuildResult = await repository.rebuildReadModelsFromSnapshots(targetAccountIds);
    const afterCoverageSummary =
      await repository.summarizeReadModelCoverageByAccountIds(targetAccountIds);

    console.log(
      'positions-history-backfill-rebuild:',
      JSON.stringify({
        state: 'applied',
        requestedAccounts: requestedAccountIds.length,
        knownAccounts: knownAccountIds.length,
        targetedAccounts: targetAccountIds.length,
        onlyDrifted,
        beforeCoverageSummary,
        syncRequest,
        syncResult,
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
