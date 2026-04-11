import { Service } from 'typedi';
import { PositionRecord } from '../../api/contracts/Positions';
import {
  buildPositionReadModelUpsert,
  buildPositionRecordFromReadModelRow,
  PositionReadModelRow,
  PositionReadModelUpsert,
} from '../../api/utils/positionsReadModel';
import { coreDataSource } from '../data-source';

const POSITIONS_CHECKPOINT_SCHEDULER_KEY = 'positions-sync';

type SqlExecutor = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

type PositionSnapshotSourceRow = {
  userId?: string;
  accountId?: string;
  brokerKey?: string;
  externalId?: string;
  statusRank?: number | string | null;
  payloadJson?: unknown;
  payloadHash?: string | null;
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
};

export interface PositionAccountFreshnessRow {
  accountId: string;
  observedAt: Date | null;
  checkpointAt: Date | null;
  openPositions: number;
  totalRows: number;
}

export interface PositionReadModelCoverageRow {
  accountId: string;
  snapshotRows: number;
  readModelRows: number;
  rowsMissingFromReadModel: number;
  rowsBehindSnapshot: number;
  orphanReadModelRows: number;
  latestSnapshotSeenAt: Date | null;
  latestReadModelSeenAt: Date | null;
}

export interface PositionReadModelCoverageSummary {
  totalAccounts: number;
  accountsWithSnapshotData: number;
  accountsWithoutSnapshotData: number;
  accountsWithReadModel: number;
  accountsWithoutReadModel: number;
  accountsWithReadModelDrift: number;
  snapshotRows: number;
  readModelRows: number;
  rowsMissingFromReadModel: number;
  rowsBehindSnapshot: number;
  orphanReadModelRows: number;
  latestSnapshotSeenAt: Date | null;
  latestReadModelSeenAt: Date | null;
}

export interface PositionReadModelRebuildScopeResult {
  userId: string;
  accountId: string;
  brokerKey: string;
  snapshotRows: number;
  deletedReadModelRows: number;
  insertedReadModelRows: number;
}

export interface PositionReadModelRebuildResult {
  requestedAccounts: number;
  processedAccounts: number;
  skippedAccounts: number;
  deletedReadModelRows: number;
  insertedReadModelRows: number;
  snapshotRowsProcessed: number;
  skippedAccountIds: string[];
  scopes: PositionReadModelRebuildScopeResult[];
}

@Service()
export class PositionReadModelRepository {
  private static readonly UPSERT_CHUNK_SIZE = 250;

  async ensureHydratedFromSnapshots(userId: string, accountIds: string[]): Promise<void> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return;
    }

    let snapshotCounts = new Map<string, number>();
    try {
      snapshotCounts = await this.getSnapshotCounts(userId, normalizedAccountIds);
    } catch (error) {
      if (this.isMissingTableError(error, 'scheduler_positions_snapshots')) {
        return;
      }
      throw error;
    }

    if (!snapshotCounts.size) {
      return;
    }

    const readModelCounts = await this.getReadModelCounts(userId, normalizedAccountIds);
    const accountsToHydrate = normalizedAccountIds.filter((accountId) => {
      const snapshotCount = snapshotCounts.get(accountId) || 0;
      const readModelCount = readModelCounts.get(accountId) || 0;
      return snapshotCount > readModelCount;
    });

    if (!accountsToHydrate.length) {
      return;
    }

    const snapshotRows = (await coreDataSource.query(
      `SELECT user_id AS userId,
              account_id AS accountId,
              broker_key AS brokerKey,
              external_id AS externalId,
              status_rank AS statusRank,
              payload_json AS payloadJson,
              payload_hash AS payloadHash,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
         FROM scheduler_positions_snapshots
        WHERE user_id = ?
          AND account_id IN (${accountsToHydrate.map(() => '?').join(', ')})`,
      [userId, ...accountsToHydrate]
    )) as PositionSnapshotSourceRow[];

    const upserts = this.buildReadModelUpsertsFromSnapshotRows(snapshotRows, userId);

    if (upserts.length) {
      await this.upsertReadModels(upserts);
    }
  }

  async upsertReadModels(rows: PositionReadModelUpsert[]): Promise<void> {
    const normalizedRows = rows.filter((row) => row.accountId && row.externalId);
    if (!normalizedRows.length) {
      return;
    }

    await this.upsertReadModelsWithExecutor(coreDataSource, normalizedRows);
  }

  async getReadModelCoverageByAccountIds(
    accountIds: string[]
  ): Promise<Map<string, PositionReadModelCoverageRow>> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    const coverageByAccountId = new Map<string, PositionReadModelCoverageRow>();
    normalizedAccountIds.forEach((accountId) => {
      coverageByAccountId.set(accountId, this.createEmptyCoverageRow(accountId));
    });

    try {
      const rows = (await coreDataSource.query(
        `SELECT s.account_id AS accountId,
                COUNT(*) AS snapshotRows,
                MAX(s.last_seen_at) AS latestSnapshotSeenAt,
                COALESCE(SUM(CASE WHEN prm.external_id IS NULL THEN 1 ELSE 0 END), 0) AS rowsMissingFromReadModel,
                COALESCE(SUM(
                  CASE
                    WHEN prm.external_id IS NOT NULL
                     AND (
                       (s.payload_hash IS NOT NULL AND COALESCE(prm.payload_hash, '') <> s.payload_hash)
                       OR COALESCE(prm.status_rank, -1) <> COALESCE(s.status_rank, -1)
                       OR (
                         s.last_seen_at IS NOT NULL
                         AND (prm.last_seen_at IS NULL OR prm.last_seen_at < s.last_seen_at)
                       )
                     )
                    THEN 1
                    ELSE 0
                  END
                ), 0) AS rowsBehindSnapshot
           FROM scheduler_positions_snapshots s
           LEFT JOIN position_read_models prm
             ON prm.user_id = s.user_id
            AND prm.account_id = s.account_id
            AND prm.external_id = s.external_id
          WHERE s.account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
          GROUP BY s.account_id`,
        normalizedAccountIds
      )) as Array<{
        accountId?: string;
        snapshotRows?: number | string;
        latestSnapshotSeenAt?: Date | string | null;
        rowsMissingFromReadModel?: number | string;
        rowsBehindSnapshot?: number | string;
      }>;

      rows.forEach((row) => {
        const accountId = String(row.accountId || '').trim();
        if (!accountId) {
          return;
        }
        const existing = coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
        coverageByAccountId.set(accountId, {
          ...existing,
          snapshotRows: Number(row.snapshotRows || 0),
          rowsMissingFromReadModel: Number(row.rowsMissingFromReadModel || 0),
          rowsBehindSnapshot: Number(row.rowsBehindSnapshot || 0),
          latestSnapshotSeenAt: this.toDate(row.latestSnapshotSeenAt),
        });
      });
    } catch (error) {
      if (this.isMissingTableError(error, 'scheduler_positions_snapshots')) {
        return await this.populateReadModelOnlyCoverage(coverageByAccountId, normalizedAccountIds);
      }
      if (this.isMissingTableError(error, 'position_read_models')) {
        const rows = (await coreDataSource.query(
          `SELECT account_id AS accountId,
                  COUNT(*) AS snapshotRows,
                  MAX(last_seen_at) AS latestSnapshotSeenAt
             FROM scheduler_positions_snapshots
            WHERE account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
            GROUP BY account_id`,
          normalizedAccountIds
        )) as Array<{
          accountId?: string;
          snapshotRows?: number | string;
          latestSnapshotSeenAt?: Date | string | null;
        }>;

        rows.forEach((row) => {
          const accountId = String(row.accountId || '').trim();
          if (!accountId) {
            return;
          }
          const existing = coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
          const snapshotRows = Number(row.snapshotRows || 0);
          coverageByAccountId.set(accountId, {
            ...existing,
            snapshotRows,
            rowsMissingFromReadModel: snapshotRows,
            latestSnapshotSeenAt: this.toDate(row.latestSnapshotSeenAt),
          });
        });
      } else {
        throw error;
      }
    }

    try {
      const rows = (await coreDataSource.query(
        `SELECT prm.account_id AS accountId,
                COUNT(*) AS readModelRows,
                MAX(prm.last_seen_at) AS latestReadModelSeenAt,
                COALESCE(SUM(CASE WHEN s.external_id IS NULL THEN 1 ELSE 0 END), 0) AS orphanReadModelRows
           FROM position_read_models prm
           LEFT JOIN scheduler_positions_snapshots s
             ON s.user_id = prm.user_id
            AND s.account_id = prm.account_id
            AND s.external_id = prm.external_id
          WHERE prm.account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
          GROUP BY prm.account_id`,
        normalizedAccountIds
      )) as Array<{
        accountId?: string;
        readModelRows?: number | string;
        latestReadModelSeenAt?: Date | string | null;
        orphanReadModelRows?: number | string;
      }>;

      rows.forEach((row) => {
        const accountId = String(row.accountId || '').trim();
        if (!accountId) {
          return;
        }
        const existing = coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
        coverageByAccountId.set(accountId, {
          ...existing,
          readModelRows: Number(row.readModelRows || 0),
          orphanReadModelRows: Number(row.orphanReadModelRows || 0),
          latestReadModelSeenAt: this.toDate(row.latestReadModelSeenAt),
        });
      });
    } catch (error) {
      if (this.isMissingTableError(error, 'position_read_models')) {
        return coverageByAccountId;
      }
      if (this.isMissingTableError(error, 'scheduler_positions_snapshots')) {
        return await this.populateReadModelOnlyCoverage(coverageByAccountId, normalizedAccountIds);
      }
      throw error;
    }

    return coverageByAccountId;
  }

  async summarizeReadModelCoverageByAccountIds(
    accountIds: string[]
  ): Promise<PositionReadModelCoverageSummary> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    const coverageByAccountId = await this.getReadModelCoverageByAccountIds(normalizedAccountIds);

    let accountsWithSnapshotData = 0;
    let accountsWithReadModel = 0;
    let accountsWithReadModelDrift = 0;
    let snapshotRows = 0;
    let readModelRows = 0;
    let rowsMissingFromReadModel = 0;
    let rowsBehindSnapshot = 0;
    let orphanReadModelRows = 0;
    let latestSnapshotSeenAt: Date | null = null;
    let latestReadModelSeenAt: Date | null = null;

    normalizedAccountIds.forEach((accountId) => {
      const row = coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
      if (row.snapshotRows > 0) {
        accountsWithSnapshotData += 1;
      }
      if (row.readModelRows > 0) {
        accountsWithReadModel += 1;
      }
      if (this.needsReadModelRebuild(row)) {
        accountsWithReadModelDrift += 1;
      }
      snapshotRows += row.snapshotRows;
      readModelRows += row.readModelRows;
      rowsMissingFromReadModel += row.rowsMissingFromReadModel;
      rowsBehindSnapshot += row.rowsBehindSnapshot;
      orphanReadModelRows += row.orphanReadModelRows;
      latestSnapshotSeenAt = this.maxDate(latestSnapshotSeenAt, row.latestSnapshotSeenAt);
      latestReadModelSeenAt = this.maxDate(latestReadModelSeenAt, row.latestReadModelSeenAt);
    });

    return {
      totalAccounts: normalizedAccountIds.length,
      accountsWithSnapshotData,
      accountsWithoutSnapshotData: Math.max(0, normalizedAccountIds.length - accountsWithSnapshotData),
      accountsWithReadModel,
      accountsWithoutReadModel: Math.max(0, normalizedAccountIds.length - accountsWithReadModel),
      accountsWithReadModelDrift,
      snapshotRows,
      readModelRows,
      rowsMissingFromReadModel,
      rowsBehindSnapshot,
      orphanReadModelRows,
      latestSnapshotSeenAt,
      latestReadModelSeenAt,
    };
  }

  async rebuildReadModelsFromSnapshots(
    accountIds: string[]
  ): Promise<PositionReadModelRebuildResult> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return {
        requestedAccounts: 0,
        processedAccounts: 0,
        skippedAccounts: 0,
        deletedReadModelRows: 0,
        insertedReadModelRows: 0,
        snapshotRowsProcessed: 0,
        skippedAccountIds: [],
        scopes: [],
      };
    }

    const snapshotRows = (await coreDataSource.query(
      `SELECT user_id AS userId,
              account_id AS accountId,
              broker_key AS brokerKey,
              external_id AS externalId,
              status_rank AS statusRank,
              payload_json AS payloadJson,
              payload_hash AS payloadHash,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
         FROM scheduler_positions_snapshots
        WHERE account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
        ORDER BY account_id ASC, external_id ASC`,
      normalizedAccountIds
    )) as PositionSnapshotSourceRow[];

    const rowsByAccountId = new Map<string, PositionSnapshotSourceRow[]>();
    snapshotRows.forEach((row) => {
      const accountId = String(row.accountId || '').trim();
      if (!accountId) {
        return;
      }
      const bucket = rowsByAccountId.get(accountId);
      if (bucket) {
        bucket.push(row);
      } else {
        rowsByAccountId.set(accountId, [row]);
      }
    });

    const scopes: PositionReadModelRebuildScopeResult[] = [];
    let deletedReadModelRows = 0;
    let insertedReadModelRows = 0;
    let snapshotRowsProcessed = 0;

    for (const [accountId, scopedSnapshotRows] of rowsByAccountId.entries()) {
      const accountUserId = String(scopedSnapshotRows[0]?.userId || '').trim();
      const brokerKey = String(scopedSnapshotRows[0]?.brokerKey || '').trim().toLowerCase();
      if (!accountUserId) {
        continue;
      }

      const upserts = this.buildReadModelUpsertsFromSnapshotRows(scopedSnapshotRows, accountUserId);
      const queryRunner = coreDataSource.createQueryRunner();

      try {
        if (typeof queryRunner.connect === 'function') {
          await queryRunner.connect();
        }
        await queryRunner.startTransaction();

        const existingRows = (await queryRunner.query(
          `SELECT COUNT(*) AS totalRows
             FROM position_read_models
            WHERE user_id = ?
              AND account_id = ?`,
          [accountUserId, accountId]
        )) as Array<{ totalRows?: number | string }>;
        const deletedForScope = Number(existingRows?.[0]?.totalRows || 0);

        await queryRunner.query(
          `DELETE FROM position_read_models
            WHERE user_id = ?
              AND account_id = ?`,
          [accountUserId, accountId]
        );

        if (upserts.length) {
          await this.upsertReadModelsWithExecutor(queryRunner, upserts);
        }

        await queryRunner.commitTransaction();

        deletedReadModelRows += deletedForScope;
        insertedReadModelRows += upserts.length;
        snapshotRowsProcessed += scopedSnapshotRows.length;
        scopes.push({
          userId: accountUserId,
          accountId,
          brokerKey,
          snapshotRows: scopedSnapshotRows.length,
          deletedReadModelRows: deletedForScope,
          insertedReadModelRows: upserts.length,
        });
      } catch (error) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // Ignore rollback failures; preserve the original rebuild error.
        }
        throw error;
      } finally {
        if (typeof queryRunner.release === 'function') {
          await queryRunner.release();
        }
      }
    }

    const skippedAccountIds = normalizedAccountIds.filter((accountId) => !rowsByAccountId.has(accountId));

    return {
      requestedAccounts: normalizedAccountIds.length,
      processedAccounts: scopes.length,
      skippedAccounts: skippedAccountIds.length,
      deletedReadModelRows,
      insertedReadModelRows,
      snapshotRowsProcessed,
      skippedAccountIds,
      scopes,
    };
  }

  private async upsertReadModelsWithExecutor(
    executor: SqlExecutor,
    rows: PositionReadModelUpsert[]
  ): Promise<void> {
    const normalizedRows = rows.filter((row) => row.accountId && row.externalId);
    if (!normalizedRows.length) {
      return;
    }

    for (let index = 0; index < normalizedRows.length; index += PositionReadModelRepository.UPSERT_CHUNK_SIZE) {
      const chunk = normalizedRows.slice(index, index + PositionReadModelRepository.UPSERT_CHUNK_SIZE);
      const placeholders = chunk
        .map(
          () =>
            '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())'
        )
        .join(', ');
      const params: Array<unknown> = [];

      for (const row of chunk) {
        params.push(
          row.userId,
          row.accountId,
          row.brokerKey,
          row.externalId,
          row.symbol,
          row.side,
          row.sideKey,
          row.sideRaw,
          row.status,
          row.statusKey,
          row.statusRaw,
          row.statusRank,
          row.quantity,
          row.entryPrice,
          row.currentPrice,
          row.closedPrice,
          row.unrealizedPnl,
          row.realizedPnl,
          row.leverage,
          row.liquidationPrice,
          row.exposure,
          row.orderPrice,
          row.stoplossPrice,
          row.takeprofitPrice,
          row.stoplossOrderId,
          row.takeprofitOrderId,
          row.triggerType,
          this.toDate(row.positionCreatedAt),
          this.toDate(row.positionUpdatedAt),
          this.toDate(row.positionClosedAt),
          row.firstSeenAt,
          row.lastSeenAt,
          row.payloadJson,
          row.payloadHash
        );
      }

      await executor.query(
        `INSERT INTO position_read_models (
           user_id,
           account_id,
           broker_key,
           external_id,
           symbol,
           side,
           side_key,
           side_raw,
           status,
           status_key,
           status_raw,
           status_rank,
           quantity,
           entry_price,
           current_price,
           closed_price,
           unrealized_pnl,
           realized_pnl,
           leverage,
           liquidation_price,
           exposure,
           order_price,
           stoploss_price,
           takeprofit_price,
           stoploss_order_id,
           takeprofit_order_id,
           trigger_type,
           position_created_at,
           position_updated_at,
           position_closed_at,
           first_seen_at,
           last_seen_at,
           payload_json,
           payload_hash,
           created_at,
           updated_at
         ) VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           broker_key = VALUES(broker_key),
           symbol = VALUES(symbol),
           side = VALUES(side),
           side_key = VALUES(side_key),
           side_raw = VALUES(side_raw),
           status = VALUES(status),
           status_key = VALUES(status_key),
           status_raw = VALUES(status_raw),
           status_rank = VALUES(status_rank),
           quantity = VALUES(quantity),
           entry_price = VALUES(entry_price),
           current_price = VALUES(current_price),
           closed_price = VALUES(closed_price),
           unrealized_pnl = VALUES(unrealized_pnl),
           realized_pnl = VALUES(realized_pnl),
           leverage = VALUES(leverage),
           liquidation_price = VALUES(liquidation_price),
           exposure = VALUES(exposure),
           order_price = VALUES(order_price),
           stoploss_price = VALUES(stoploss_price),
           takeprofit_price = VALUES(takeprofit_price),
           stoploss_order_id = VALUES(stoploss_order_id),
           takeprofit_order_id = VALUES(takeprofit_order_id),
           trigger_type = VALUES(trigger_type),
           position_created_at = VALUES(position_created_at),
           position_updated_at = VALUES(position_updated_at),
           position_closed_at = VALUES(position_closed_at),
           first_seen_at = IF(
             first_seen_at IS NULL
             OR (VALUES(first_seen_at) IS NOT NULL AND VALUES(first_seen_at) < first_seen_at),
             VALUES(first_seen_at),
             first_seen_at
           ),
           last_seen_at = IF(
             last_seen_at IS NULL
             OR (VALUES(last_seen_at) IS NOT NULL AND VALUES(last_seen_at) > last_seen_at),
             VALUES(last_seen_at),
             last_seen_at
           ),
           payload_json = VALUES(payload_json),
           payload_hash = VALUES(payload_hash),
           updated_at = NOW()`,
        params
      );
    }
  }

  async listLivePositionsForAccount(
    userId: string,
    accountId: string,
    brokerKey?: string,
    limit?: number
  ): Promise<PositionRecord[]> {
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) {
      return [];
    }

    const where = ['user_id = ?', 'account_id = ?', 'status_rank > 0', 'status_rank <= 2'];
    const params: Array<unknown> = [userId, normalizedAccountId];
    if (brokerKey) {
      where.push('LOWER(broker_key) = ?');
      params.push(String(brokerKey).trim().toLowerCase());
    }

    const safeLimit = limit ? Math.max(1, Math.floor(limit)) : undefined;
    const rows = (await coreDataSource.query(
      `${this.baseSelectSql()}
         FROM position_read_models
        WHERE ${where.join(' AND ')}
        ORDER BY last_seen_at DESC
        ${safeLimit ? 'LIMIT ?' : ''}`,
      safeLimit ? [...params, safeLimit] : params
    )) as PositionReadModelRow[];

    return rows.map((row) =>
      buildPositionRecordFromReadModelRow(row, {
        accountId: normalizedAccountId,
        brokerKey: String(row.brokerKey || brokerKey || '').trim() || undefined,
      })
    );
  }

  async getPositionByExternalId(
    userId: string,
    accountId: string,
    externalId: string,
    brokerKey?: string
  ): Promise<PositionRecord | null> {
    const normalizedAccountId = String(accountId || '').trim();
    const normalizedExternalId = String(externalId || '').trim();
    if (!normalizedAccountId || !normalizedExternalId) {
      return null;
    }

    const where = ['user_id = ?', 'account_id = ?', 'external_id = ?'];
    const params: Array<unknown> = [userId, normalizedAccountId, normalizedExternalId];
    if (brokerKey) {
      where.push('LOWER(broker_key) = ?');
      params.push(String(brokerKey).trim().toLowerCase());
    }

    const rows = (await coreDataSource.query(
      `${this.baseSelectSql()}
         FROM position_read_models
        WHERE ${where.join(' AND ')}
        LIMIT 1`,
      params
    )) as PositionReadModelRow[];

    const row = rows[0];
    if (!row) {
      return null;
    }

    return buildPositionRecordFromReadModelRow(row, {
      accountId: normalizedAccountId,
      brokerKey: String(row.brokerKey || brokerKey || '').trim() || undefined,
    });
  }

  async listLivePositionsForAccounts(
    userId: string,
    accountIds: string[]
  ): Promise<Map<string, PositionRecord[]>> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    const rows = (await coreDataSource.query(
      `${this.baseSelectSql()}
         FROM position_read_models
        WHERE user_id = ?
          AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
          AND status_rank > 0
          AND status_rank <= 2
        ORDER BY last_seen_at DESC`,
      [userId, ...normalizedAccountIds]
    )) as PositionReadModelRow[];

    return this.groupRowsByAccount(rows);
  }

  async listHistoryForAccount(
    userId: string,
    accountId: string,
    brokerKey?: string,
    options: {
      limit?: number;
      startUtc?: Date | null;
      endUtc?: Date | null;
    } = {}
  ): Promise<PositionRecord[]> {
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) {
      return [];
    }

    const where = ['user_id = ?', 'account_id = ?', 'status_rank >= 3'];
    const params: Array<unknown> = [userId, normalizedAccountId];
    if (brokerKey) {
      where.push('LOWER(broker_key) = ?');
      params.push(String(brokerKey).trim().toLowerCase());
    }
    if (options.startUtc && Number.isFinite(options.startUtc.getTime())) {
      where.push('COALESCE(position_updated_at, position_created_at, last_seen_at) >= ?');
      params.push(options.startUtc);
    }
    if (options.endUtc && Number.isFinite(options.endUtc.getTime())) {
      where.push('COALESCE(position_updated_at, position_created_at, last_seen_at) <= ?');
      params.push(options.endUtc);
    }

    const safeLimit = options.limit ? Math.max(1, Math.floor(options.limit)) : 100;
    const rows = (await coreDataSource.query(
      `${this.baseSelectSql()}
         FROM position_read_models
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(position_updated_at, position_created_at, last_seen_at) DESC
        LIMIT ?`,
      [...params, safeLimit]
    )) as PositionReadModelRow[];

    return rows.map((row) =>
      buildPositionRecordFromReadModelRow(row, {
        accountId: normalizedAccountId,
        brokerKey: String(row.brokerKey || brokerKey || '').trim() || undefined,
      })
    );
  }

  async listHistoryForAccounts(
    userId: string,
    accountIds: string[],
    options: {
      startUtc?: Date | null;
      endUtc?: Date | null;
      limit?: number;
    } = {}
  ): Promise<Map<string, PositionRecord[]>> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    const where = [
      'user_id = ?',
      `account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})`,
      'status_rank >= 3',
    ];
    const params: Array<unknown> = [userId, ...normalizedAccountIds];
    if (options.startUtc && Number.isFinite(options.startUtc.getTime())) {
      where.push('COALESCE(position_updated_at, position_created_at, last_seen_at) >= ?');
      params.push(options.startUtc);
    }
    if (options.endUtc && Number.isFinite(options.endUtc.getTime())) {
      where.push('COALESCE(position_updated_at, position_created_at, last_seen_at) <= ?');
      params.push(options.endUtc);
    }

    const safeLimit = options.limit ? Math.max(1, Math.floor(options.limit)) : 50000;
    const rows = (await coreDataSource.query(
      `${this.baseSelectSql()}
         FROM position_read_models
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(position_updated_at, position_created_at, last_seen_at) DESC
        LIMIT ?`,
      [...params, safeLimit]
    )) as PositionReadModelRow[];

    return this.groupRowsByAccount(rows);
  }

  async getAccountOpenPositionSummary(
    userId: string,
    accountIds: string[]
  ): Promise<
    Map<
      string,
      {
        accountId: string;
        openPositions: number;
        observedAt: Date | null;
        hasSnapshotHistory: boolean;
      }
    >
  > {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    const rows = (await coreDataSource.query(
      `SELECT account_id AS accountId,
              SUM(CASE WHEN status_rank > 0 AND status_rank <= 2 THEN 1 ELSE 0 END) AS openPositions,
              MAX(last_seen_at) AS observedAt,
              COUNT(*) AS totalRows
         FROM position_read_models
        WHERE user_id = ?
          AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
        GROUP BY account_id`,
      [userId, ...normalizedAccountIds]
    )) as Array<{
      accountId?: string;
      openPositions?: number | string;
      observedAt?: Date | string | null;
      totalRows?: number | string;
    }>;

    const byAccountId = new Map<
      string,
      {
        accountId: string;
        openPositions: number;
        observedAt: Date | null;
        hasSnapshotHistory: boolean;
      }
    >();

    rows.forEach((row) => {
      const accountId = String(row.accountId || '').trim();
      if (!accountId) {
        return;
      }
      const observedAt =
        row.observedAt instanceof Date
          ? row.observedAt
          : row.observedAt
            ? new Date(String(row.observedAt))
            : null;
      byAccountId.set(accountId, {
        accountId,
        openPositions: Number(row.openPositions || 0),
        observedAt:
          observedAt && !Number.isNaN(observedAt.getTime()) ? observedAt : null,
        hasSnapshotHistory: Number(row.totalRows || 0) > 0,
      });
    });

    return byAccountId;
  }

  async getAccountFreshness(
    userId: string,
    accountIds: string[]
  ): Promise<Map<string, PositionAccountFreshnessRow>> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    const freshnessByAccountId = new Map<string, PositionAccountFreshnessRow>();

    try {
      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId,
                MAX(last_seen_at) AS observedAt,
                SUM(CASE WHEN status_rank > 0 AND status_rank <= 2 THEN 1 ELSE 0 END) AS openPositions,
                COUNT(*) AS totalRows
           FROM position_read_models
          WHERE user_id = ?
            AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
          GROUP BY account_id`,
        [userId, ...normalizedAccountIds]
      )) as Array<{
        accountId?: string;
        observedAt?: Date | string | null;
        openPositions?: number | string;
        totalRows?: number | string;
      }>;

      rows.forEach((row) => {
        const accountId = String(row.accountId || '').trim();
        if (!accountId) {
          return;
        }
        freshnessByAccountId.set(accountId, {
          accountId,
          observedAt: this.toDate(row.observedAt),
          checkpointAt: null,
          openPositions: Number(row.openPositions || 0),
          totalRows: Number(row.totalRows || 0),
        });
      });
    } catch (error) {
      if (!this.isMissingTableError(error, 'position_read_models')) {
        throw error;
      }
    }

    try {
      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId,
                MAX(checkpoint_at) AS checkpointAt
           FROM scheduler_sync_checkpoints
          WHERE scheduler_key = ?
            AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
          GROUP BY account_id`,
        [POSITIONS_CHECKPOINT_SCHEDULER_KEY, ...normalizedAccountIds]
      )) as Array<{
        accountId?: string;
        checkpointAt?: Date | string | null;
      }>;

      rows.forEach((row) => {
        const accountId = String(row.accountId || '').trim();
        if (!accountId) {
          return;
        }
        const existing = freshnessByAccountId.get(accountId);
        freshnessByAccountId.set(accountId, {
          accountId,
          observedAt: existing?.observedAt || null,
          checkpointAt: this.toDate(row.checkpointAt),
          openPositions: existing?.openPositions || 0,
          totalRows: existing?.totalRows || 0,
        });
      });
    } catch (error) {
      if (!this.isMissingTableError(error, 'scheduler_sync_checkpoints')) {
        throw error;
      }
    }

    return freshnessByAccountId;
  }

  async markPositionsClosed(
    userId: string,
    accountId: string,
    brokerKey: string,
    externalIds: string[],
    closedAt?: Date | null
  ): Promise<void> {
    const normalizedExternalIds = Array.from(
      new Set(externalIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (!normalizedExternalIds.length) {
      return;
    }

    const safeClosedAt = closedAt && Number.isFinite(closedAt.getTime()) ? closedAt : new Date();
    await coreDataSource.query(
      `UPDATE position_read_models
          SET status = 'Closed',
              status_key = 'closed',
              status_rank = 3,
              position_updated_at = COALESCE(position_updated_at, ?),
              position_closed_at = COALESCE(position_closed_at, ?),
              last_seen_at = IF(
                last_seen_at IS NULL OR ? > last_seen_at,
                ?,
                last_seen_at
              ),
              updated_at = NOW()
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND external_id IN (${normalizedExternalIds.map(() => '?').join(', ')})`,
      [
        safeClosedAt,
        safeClosedAt,
        safeClosedAt,
        safeClosedAt,
        userId,
        accountId,
        String(brokerKey || '').trim().toLowerCase(),
        ...normalizedExternalIds,
      ]
    );
  }

  private async getSnapshotCounts(userId: string, accountIds: string[]): Promise<Map<string, number>> {
    const rows = (await coreDataSource.query(
      `SELECT account_id AS accountId, COUNT(*) AS totalRows
         FROM scheduler_positions_snapshots
        WHERE user_id = ?
          AND account_id IN (${accountIds.map(() => '?').join(', ')})
        GROUP BY account_id`,
      [userId, ...accountIds]
    )) as Array<{ accountId?: string; totalRows?: number | string }>;

    return new Map(
      rows
        .map((row) => [String(row.accountId || '').trim(), Number(row.totalRows || 0)] as const)
        .filter(([accountId]) => Boolean(accountId))
    );
  }

  private async getReadModelCounts(userId: string, accountIds: string[]): Promise<Map<string, number>> {
    try {
      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId, COUNT(*) AS totalRows
           FROM position_read_models
          WHERE user_id = ?
            AND account_id IN (${accountIds.map(() => '?').join(', ')})
          GROUP BY account_id`,
        [userId, ...accountIds]
      )) as Array<{ accountId?: string; totalRows?: number | string }>;

      return new Map(
        rows
          .map((row) => [String(row.accountId || '').trim(), Number(row.totalRows || 0)] as const)
          .filter(([accountId]) => Boolean(accountId))
      );
    } catch (error) {
      if (this.isMissingTableError(error, 'position_read_models')) {
        return new Map();
      }
      throw error;
    }
  }

  private groupRowsByAccount(rows: PositionReadModelRow[]): Map<string, PositionRecord[]> {
    const grouped = new Map<string, PositionRecord[]>();
    rows.forEach((row) => {
      const accountId = String(row.accountId || '').trim();
      if (!accountId) {
        return;
      }
      const record = buildPositionRecordFromReadModelRow(row, {
        accountId,
        brokerKey: String(row.brokerKey || '').trim() || undefined,
      });
      if (!grouped.has(accountId)) {
        grouped.set(accountId, []);
      }
      grouped.get(accountId)?.push(record);
    });
    return grouped;
  }

  private normalizeAccountIds(accountIds: string[]): string[] {
    return Array.from(
      new Set(accountIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private baseSelectSql(): string {
    return `SELECT user_id AS userId,
                   account_id AS accountId,
                   broker_key AS brokerKey,
                   external_id AS externalId,
                   symbol,
                   side,
                   side_key AS sideKey,
                   side_raw AS sideRaw,
                   status,
                   status_key AS statusKey,
                   status_raw AS statusRaw,
                   status_rank AS statusRank,
                   quantity,
                   entry_price AS entryPrice,
                   current_price AS currentPrice,
                   closed_price AS closedPrice,
                   unrealized_pnl AS unrealizedPnl,
                   realized_pnl AS realizedPnl,
                   leverage,
                   liquidation_price AS liquidationPrice,
                   exposure,
                   order_price AS orderPrice,
                   stoploss_price AS stoplossPrice,
                   takeprofit_price AS takeprofitPrice,
                   stoploss_order_id AS stoplossOrderId,
                   takeprofit_order_id AS takeprofitOrderId,
                   trigger_type AS triggerType,
                   position_created_at AS positionCreatedAt,
                   position_updated_at AS positionUpdatedAt,
                   position_closed_at AS positionClosedAt,
                   first_seen_at AS firstSeenAt,
                   last_seen_at AS lastSeenAt,
                   payload_json AS payloadJson,
                   payload_hash AS payloadHash`;
  }

  private isMissingTableError(error: unknown, tableName: string): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = String((error as { code?: string }).code || '').trim();
    const message = String((error as { message?: string }).message || '').toLowerCase();

    return (
      code === 'ER_NO_SUCH_TABLE' ||
      code === '42P01' ||
      (message.includes(tableName) && message.includes("doesn't exist"))
    );
  }

  private buildReadModelUpsertsFromSnapshotRows(
    snapshotRows: PositionSnapshotSourceRow[],
    fallbackUserId: string
  ): PositionReadModelUpsert[] {
    return snapshotRows
      .map((row) =>
        buildPositionReadModelUpsert({
          userId: String(row.userId || fallbackUserId),
          accountId: String(row.accountId || '').trim(),
          brokerKey: String(row.brokerKey || '').trim().toLowerCase(),
          externalId: String(row.externalId || '').trim(),
          payload: row.payloadJson,
          payloadJson:
            typeof row.payloadJson === 'string' ? row.payloadJson : JSON.stringify(row.payloadJson),
          payloadHash: row.payloadHash || null,
          statusRank:
            row.statusRank === null || row.statusRank === undefined ? null : Number(row.statusRank),
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
        })
      )
      .filter((row): row is PositionReadModelUpsert => Boolean(row?.accountId && row?.externalId));
  }

  private async populateReadModelOnlyCoverage(
    coverageByAccountId: Map<string, PositionReadModelCoverageRow>,
    accountIds: string[]
  ): Promise<Map<string, PositionReadModelCoverageRow>> {
    try {
      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId,
                COUNT(*) AS readModelRows,
                MAX(last_seen_at) AS latestReadModelSeenAt
           FROM position_read_models
          WHERE account_id IN (${accountIds.map(() => '?').join(', ')})
          GROUP BY account_id`,
        accountIds
      )) as Array<{
        accountId?: string;
        readModelRows?: number | string;
        latestReadModelSeenAt?: Date | string | null;
      }>;

      rows.forEach((row) => {
        const accountId = String(row.accountId || '').trim();
        if (!accountId) {
          return;
        }
        const existing = coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
        const readModelRows = Number(row.readModelRows || 0);
        coverageByAccountId.set(accountId, {
          ...existing,
          readModelRows,
          orphanReadModelRows: readModelRows,
          latestReadModelSeenAt: this.toDate(row.latestReadModelSeenAt),
        });
      });
      return coverageByAccountId;
    } catch (error) {
      if (this.isMissingTableError(error, 'position_read_models')) {
        return coverageByAccountId;
      }
      throw error;
    }
  }

  private createEmptyCoverageRow(accountId: string): PositionReadModelCoverageRow {
    return {
      accountId,
      snapshotRows: 0,
      readModelRows: 0,
      rowsMissingFromReadModel: 0,
      rowsBehindSnapshot: 0,
      orphanReadModelRows: 0,
      latestSnapshotSeenAt: null,
      latestReadModelSeenAt: null,
    };
  }

  private needsReadModelRebuild(row: PositionReadModelCoverageRow): boolean {
    return (
      row.rowsMissingFromReadModel > 0 ||
      row.rowsBehindSnapshot > 0 ||
      row.orphanReadModelRows > 0 ||
      (row.snapshotRows > 0 && row.readModelRows === 0)
    );
  }

  private maxDate(current: Date | null, candidate: Date | null): Date | null {
    if (!candidate) {
      return current;
    }
    if (!current) {
      return candidate;
    }
    return candidate.getTime() > current.getTime() ? candidate : current;
  }
}
