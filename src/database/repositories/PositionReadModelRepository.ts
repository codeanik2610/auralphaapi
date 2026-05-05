import { Service } from 'typedi';
import { PositionAutomationTradeContext, PositionRecord } from '../../api/contracts/Positions';
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

type PositionSuggestedTradeContextRow = {
  suggestedTradeId?: string | null;
  automationId?: string | null;
  automationRunId?: string | null;
  timeframe?: string | null;
  signalTime?: Date | string | null;
  side?: string | null;
  symbol?: string | null;
  brokerKey?: string | null;
  accountId?: string | null;
  positionId?: string | null;
  orderId?: string | null;
  orderType?: string | null;
  triggerType?: string | null;
  entryPrice?: number | string | null;
  filledPrice?: number | string | null;
  submittedAt?: Date | string | null;
  filledAt?: Date | string | null;
  executionState?: string | null;
  positionStatus?: string | null;
  protectionState?: string | null;
  protectionSource?: string | null;
  protectionAttempts?: number | string | null;
  protectionLastError?: string | null;
  protectionCheckedAt?: Date | string | null;
  protectionAttachedAt?: Date | string | null;
  protectionStopLossPrice?: number | string | null;
  protectionTakeProfitPrice?: number | string | null;
  protectionStopLossOrderId?: string | null;
  protectionTakeProfitOrderId?: string | null;
  sourceTemplateId?: string | null;
  sourceBacktestId?: string | null;
  traceMethod?: PositionAutomationTradeContext['traceMethod'];
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

export interface PositionOpenPositionSummaryRow {
  accountId: string;
  openPositions: number;
  grossExposure: number;
  longExposure: number;
  shortExposure: number;
  unrealizedPnl: number;
  latestObservedAt: Date | null;
  oldestObservedAt: Date | null;
}

export interface PositionLiveOverviewQuery {
  limit?: number;
  offset?: number;
  brokerKey?: string;
  accountId?: string;
  symbol?: string;
  sideKey?: 'long' | 'short';
}

export interface PositionLiveOverviewResult {
  items: PositionRecord[];
  total: number;
  latestObservedAt: Date | null;
  oldestObservedAt: Date | null;
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
        const existing =
          coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
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
          const existing =
            coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
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
        const existing =
          coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
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
      accountsWithoutSnapshotData: Math.max(
        0,
        normalizedAccountIds.length - accountsWithSnapshotData
      ),
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
      const brokerKey = String(scopedSnapshotRows[0]?.brokerKey || '')
        .trim()
        .toLowerCase();
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

    const skippedAccountIds = normalizedAccountIds.filter(
      (accountId) => !rowsByAccountId.has(accountId)
    );

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

    for (
      let index = 0;
      index < normalizedRows.length;
      index += PositionReadModelRepository.UPSERT_CHUNK_SIZE
    ) {
      const chunk = normalizedRows.slice(
        index,
        index + PositionReadModelRepository.UPSERT_CHUNK_SIZE
      );
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

    const records = rows.map((row) =>
      buildPositionRecordFromReadModelRow(row, {
        accountId: normalizedAccountId,
        brokerKey: String(row.brokerKey || brokerKey || '').trim() || undefined,
      })
    );
    await this.enrichLivePositionsWithSuggestedTradeContext(userId, records);
    return records;
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

    const record = buildPositionRecordFromReadModelRow(row, {
      accountId: normalizedAccountId,
      brokerKey: String(row.brokerKey || brokerKey || '').trim() || undefined,
    });
    await this.enrichLivePositionsWithSuggestedTradeContext(userId, [record]);
    return record;
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

    const grouped = this.groupRowsByAccount(rows);
    await this.enrichGroupedLivePositionsWithSuggestedTradeContext(userId, grouped);
    return grouped;
  }

  async getOpenPositionSummaryForAccounts(
    userId: string,
    accountIds: string[]
  ): Promise<Map<string, PositionOpenPositionSummaryRow>> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    try {
      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId,
                COUNT(*) AS openPositions,
                COALESCE(SUM(COALESCE(exposure, 0)), 0) AS grossExposure,
                COALESCE(SUM(
                  CASE
                    WHEN LOWER(COALESCE(side_key, '')) = 'long' THEN COALESCE(exposure, 0)
                    ELSE 0
                  END
                ), 0) AS longExposure,
                COALESCE(SUM(
                  CASE
                    WHEN LOWER(COALESCE(side_key, '')) = 'short' THEN COALESCE(exposure, 0)
                    ELSE 0
                  END
                ), 0) AS shortExposure,
                COALESCE(SUM(COALESCE(unrealized_pnl, 0)), 0) AS unrealizedPnl,
                MAX(${this.liveObservedAtExpr()}) AS latestObservedAt,
                MIN(${this.liveObservedAtExpr()}) AS oldestObservedAt
           FROM position_read_models
          WHERE user_id = ?
            AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
            AND status_rank > 0
            AND status_rank <= 2
          GROUP BY account_id`,
        [userId, ...normalizedAccountIds]
      )) as Array<{
        accountId?: string;
        openPositions?: number | string;
        grossExposure?: number | string | null;
        longExposure?: number | string | null;
        shortExposure?: number | string | null;
        unrealizedPnl?: number | string | null;
        latestObservedAt?: Date | string | null;
        oldestObservedAt?: Date | string | null;
      }>;

      return new Map(
        rows
          .map((row) => {
            const accountId = String(row.accountId || '').trim();
            if (!accountId) {
              return null;
            }
            return [
              accountId,
              {
                accountId,
                openPositions: Number(row.openPositions || 0),
                grossExposure: Number(row.grossExposure || 0),
                longExposure: Number(row.longExposure || 0),
                shortExposure: Number(row.shortExposure || 0),
                unrealizedPnl: Number(row.unrealizedPnl || 0),
                latestObservedAt: this.toDate(row.latestObservedAt),
                oldestObservedAt: this.toDate(row.oldestObservedAt),
              },
            ] as const;
          })
          .filter((entry): entry is readonly [string, PositionOpenPositionSummaryRow] =>
            Boolean(entry)
          )
      );
    } catch (error) {
      if (this.isMissingTableError(error, 'position_read_models')) {
        return new Map();
      }
      throw error;
    }
  }

  async listLivePositionsOverview(
    userId: string,
    accountIds: string[],
    options: PositionLiveOverviewQuery = {}
  ): Promise<PositionLiveOverviewResult> {
    const normalizedAccountIds = this.normalizeAccountIds(accountIds);
    if (!normalizedAccountIds.length) {
      return {
        items: [],
        total: 0,
        latestObservedAt: null,
        oldestObservedAt: null,
      };
    }

    const safeLimit = options.limit ? Math.max(1, Math.floor(options.limit)) : 100;
    const safeOffset = options.offset ? Math.max(0, Math.floor(options.offset)) : 0;
    const normalizedAccountId = String(options.accountId || '').trim();
    const normalizedBrokerKey = String(options.brokerKey || '')
      .trim()
      .toLowerCase();
    const normalizedSymbol = String(options.symbol || '')
      .trim()
      .toUpperCase();
    const normalizedSideKey = String(options.sideKey || '')
      .trim()
      .toLowerCase();
    const where = [
      'user_id = ?',
      `account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})`,
      'status_rank > 0',
      'status_rank <= 2',
    ];
    const params: Array<unknown> = [userId, ...normalizedAccountIds];

    if (normalizedAccountId) {
      where.push('account_id = ?');
      params.push(normalizedAccountId);
    }
    if (normalizedBrokerKey) {
      where.push('LOWER(broker_key) = ?');
      params.push(normalizedBrokerKey);
    }
    if (normalizedSymbol) {
      where.push("UPPER(COALESCE(symbol, '')) = ?");
      params.push(normalizedSymbol);
    }
    if (normalizedSideKey === 'long' || normalizedSideKey === 'short') {
      where.push("LOWER(COALESCE(side_key, '')) = ?");
      params.push(normalizedSideKey);
    }

    try {
      const overviewRows = (await coreDataSource.query(
        `SELECT COUNT(*) AS total,
                MAX(${this.liveObservedAtExpr()}) AS latestObservedAt,
                MIN(${this.liveObservedAtExpr()}) AS oldestObservedAt
           FROM position_read_models
          WHERE ${where.join(' AND ')}`,
        params
      )) as Array<{
        total?: number | string;
        latestObservedAt?: Date | string | null;
        oldestObservedAt?: Date | string | null;
      }>;

      const rows = (await coreDataSource.query(
        `${this.baseSelectSql()}
           FROM position_read_models
          WHERE ${where.join(' AND ')}
          ORDER BY ${this.liveObservedAtExpr()} DESC,
                   COALESCE(exposure, 0) DESC,
                   COALESCE(symbol, '') ASC,
                   external_id ASC
          LIMIT ?
          OFFSET ?`,
        [...params, safeLimit, safeOffset]
      )) as PositionReadModelRow[];

      const items = rows.map((row) =>
        buildPositionRecordFromReadModelRow(row, {
          accountId: String(row.accountId || '').trim() || undefined,
          brokerKey: String(row.brokerKey || '').trim() || undefined,
        })
      );
      await this.enrichLivePositionsWithSuggestedTradeContext(userId, items);
      const aggregate = overviewRows[0] || {};

      return {
        items,
        total: Number(aggregate.total || 0),
        latestObservedAt: this.toDate(aggregate.latestObservedAt),
        oldestObservedAt: this.toDate(aggregate.oldestObservedAt),
      };
    } catch (error) {
      if (this.isMissingTableError(error, 'position_read_models')) {
        return {
          items: [],
          total: 0,
          latestObservedAt: null,
          oldestObservedAt: null,
        };
      }
      throw error;
    }
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
        observedAt: observedAt && !Number.isNaN(observedAt.getTime()) ? observedAt : null,
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
        String(brokerKey || '')
          .trim()
          .toLowerCase(),
        ...normalizedExternalIds,
      ]
    );
  }

  private async getSnapshotCounts(
    userId: string,
    accountIds: string[]
  ): Promise<Map<string, number>> {
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

  private async getReadModelCounts(
    userId: string,
    accountIds: string[]
  ): Promise<Map<string, number>> {
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

  private async enrichGroupedLivePositionsWithSuggestedTradeContext(
    userId: string,
    grouped: Map<string, PositionRecord[]>
  ): Promise<void> {
    await this.enrichLivePositionsWithSuggestedTradeContext(
      userId,
      Array.from(grouped.values()).flat()
    );
  }

  private async enrichLivePositionsWithSuggestedTradeContext(
    userId: string,
    records: PositionRecord[]
  ): Promise<void> {
    if (!records.length) {
      return;
    }

    const exactRows = this.sortSuggestedTradeContextRows(
      await this.listExactSuggestedTradeContextRows(userId, records)
    );
    const fallbackRows = await this.listFallbackSuggestedTradeContextRows(userId, records);
    const exactByPosition = new Map<string, PositionSuggestedTradeContextRow>();
    for (const row of exactRows) {
      const key = this.buildPositionContextKey(row.brokerKey, row.accountId, row.positionId);
      if (key && !exactByPosition.has(key)) {
        exactByPosition.set(key, row);
      }
    }

    const fallbackBySymbol = new Map<string, PositionSuggestedTradeContextRow[]>();
    for (const row of fallbackRows) {
      const key = this.buildSymbolContextKey(row.brokerKey, row.accountId, row.symbol);
      if (!key) {
        continue;
      }
      const bucket = fallbackBySymbol.get(key) || [];
      bucket.push(row);
      fallbackBySymbol.set(key, bucket);
    }

    for (const record of records) {
      const exactKey = this.buildPositionContextKey(
        record.brokerKey,
        record.accountId,
        record.externalId || record.external_id || record.id
      );
      const exact = exactKey ? exactByPosition.get(exactKey) : undefined;
      const fallback = exact
        ? undefined
        : this.pickFallbackSuggestedTradeContext(record, fallbackBySymbol);
      this.applySuggestedTradeContext(record, exact || fallback || null);
    }
  }

  private async listExactSuggestedTradeContextRows(
    userId: string,
    records: PositionRecord[]
  ): Promise<PositionSuggestedTradeContextRow[]> {
    const positionIds = Array.from(
      new Set(
        records
          .map((record) =>
            String(record.externalId || record.external_id || record.id || '').trim()
          )
          .filter(Boolean)
      )
    );
    if (!positionIds.length) {
      return [];
    }

    try {
      return (await coreDataSource.query(
        `${this.suggestedTradeContextSelectSql('position_id')}
          WHERE execution_row.user_id = ?
            AND COALESCE(execution_row.position_id, '') IN (${positionIds.map(() => '?').join(', ')})
          ORDER BY CASE
              WHEN execution_row.filled_at IS NOT NULL THEN 0
              WHEN LOWER(COALESCE(execution_row.execution_state, '')) IN (
                'blocked',
                'canceled',
                'cancelled',
                'failed',
                'rejected',
                'closed'
              ) THEN 2
              ELSE 1
            END ASC,
            COALESCE(
              execution_row.filled_at,
              execution_row.position_opened_at,
              execution_row.linked_at,
              execution_row.last_seen_at,
              execution_row.updated_at,
              suggested_trade.created_at
            ) DESC`,
        [userId, ...positionIds]
      )) as PositionSuggestedTradeContextRow[];
    } catch (error) {
      if (
        this.isMissingTableError(error, 'suggested_trade_executions') ||
        this.isMissingTableError(error, 'suggested_trades')
      ) {
        return [];
      }
      throw error;
    }
  }

  private sortSuggestedTradeContextRows(
    rows: PositionSuggestedTradeContextRow[]
  ): PositionSuggestedTradeContextRow[] {
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const rankDelta =
          this.resolveSuggestedTradeContextPriority(left.row) -
          this.resolveSuggestedTradeContextPriority(right.row);
        if (rankDelta !== 0) {
          return rankDelta;
        }

        const leftTime = this.toTimestamp(left.row.filledAt ?? left.row.submittedAt) ?? 0;
        const rightTime = this.toTimestamp(right.row.filledAt ?? right.row.submittedAt) ?? 0;
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }

        return left.index - right.index;
      })
      .map((item) => item.row);
  }

  private resolveSuggestedTradeContextPriority(row: PositionSuggestedTradeContextRow): number {
    if (this.toTimestamp(row.filledAt) !== null) {
      return 0;
    }

    const executionState = String(row.executionState || '')
      .trim()
      .toLowerCase();
    if (
      [
        'blocked',
        'canceled',
        'cancelled',
        'failed',
        'rejected',
        'closed',
      ].includes(executionState)
    ) {
      return 2;
    }

    return 1;
  }

  private async listFallbackSuggestedTradeContextRows(
    userId: string,
    records: PositionRecord[]
  ): Promise<PositionSuggestedTradeContextRow[]> {
    const brokerKeys = Array.from(
      new Set(
        records
          .map((record) =>
            String(record.brokerKey || '')
              .trim()
              .toLowerCase()
          )
          .filter(Boolean)
      )
    );
    const accountIds = Array.from(
      new Set(records.map((record) => String(record.accountId || '').trim()).filter(Boolean))
    );
    const symbols = Array.from(
      new Set(
        records
          .map((record) =>
            String(record.symbol || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      )
    );
    if (!brokerKeys.length || !accountIds.length || !symbols.length) {
      return [];
    }

    const safeLimit = Math.max(50, records.length * 8);
    try {
      return (await coreDataSource.query(
        `${this.suggestedTradeContextSelectSql('symbol_entry')}
          WHERE execution_row.user_id = ?
            AND LOWER(COALESCE(execution_row.execution_mode, '')) = 'live'
            AND COALESCE(execution_row.order_id, '') <> ''
            AND execution_row.filled_at IS NOT NULL
            AND LOWER(COALESCE(execution_row.execution_state, '')) NOT IN (
              'blocked',
              'canceled',
              'cancelled',
              'failed',
              'rejected',
              'closed'
            )
            AND LOWER(COALESCE(execution_row.broker_key, '')) IN (${brokerKeys.map(() => '?').join(', ')})
            AND COALESCE(execution_row.account_id, '') IN (${accountIds.map(() => '?').join(', ')})
            AND UPPER(COALESCE(suggested_trade.symbol, '')) IN (${symbols.map(() => '?').join(', ')})
          ORDER BY COALESCE(
            execution_row.filled_at,
            execution_row.position_opened_at,
            execution_row.submitted_at,
            execution_row.linked_at,
            execution_row.last_seen_at,
            suggested_trade.created_at
          ) DESC
          LIMIT ?`,
        [userId, ...brokerKeys, ...accountIds, ...symbols, safeLimit]
      )) as PositionSuggestedTradeContextRow[];
    } catch (error) {
      if (
        this.isMissingTableError(error, 'suggested_trade_executions') ||
        this.isMissingTableError(error, 'suggested_trades')
      ) {
        return [];
      }
      throw error;
    }
  }

  private suggestedTradeContextSelectSql(
    traceMethod: PositionAutomationTradeContext['traceMethod']
  ): string {
    return `SELECT suggested_trade.id AS suggestedTradeId,
                   suggested_trade.automation_id AS automationId,
                   suggested_trade.automation_run_id AS automationRunId,
                   suggested_trade.timeframe AS timeframe,
                   suggested_trade.signal_time AS signalTime,
                   suggested_trade.side AS side,
                   suggested_trade.symbol AS symbol,
                   suggested_trade.source_template_id AS sourceTemplateId,
                   suggested_trade.source_backtest_id AS sourceBacktestId,
                   execution_row.broker_key AS brokerKey,
                   execution_row.account_id AS accountId,
                   execution_row.position_id AS positionId,
                   execution_row.order_id AS orderId,
                   execution_row.order_type AS orderType,
                   execution_row.trigger_type AS triggerType,
                   execution_row.entry_price AS entryPrice,
                   execution_row.filled_price AS filledPrice,
                   execution_row.submitted_at AS submittedAt,
                   execution_row.filled_at AS filledAt,
                   execution_row.execution_state AS executionState,
                   execution_row.position_status AS positionStatus,
                   execution_row.protection_state AS protectionState,
                   execution_row.protection_source AS protectionSource,
                   execution_row.protection_attempts AS protectionAttempts,
                   execution_row.protection_last_error AS protectionLastError,
                   execution_row.protection_checked_at AS protectionCheckedAt,
                   execution_row.protection_attached_at AS protectionAttachedAt,
                   execution_row.stop_loss_price AS protectionStopLossPrice,
                   execution_row.take_profit_price AS protectionTakeProfitPrice,
                   NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(execution_row.protection_plan_json, '$.stopLossOrderId')), 'null'), '') AS protectionStopLossOrderId,
                   NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(execution_row.protection_plan_json, '$.takeProfitOrderId')), 'null'), '') AS protectionTakeProfitOrderId,
                   '${traceMethod}' AS traceMethod
              FROM suggested_trade_executions execution_row
              INNER JOIN suggested_trades suggested_trade
                      ON suggested_trade.id = execution_row.suggested_trade_id`;
  }

  private pickFallbackSuggestedTradeContext(
    record: PositionRecord,
    fallbackBySymbol: Map<string, PositionSuggestedTradeContextRow[]>
  ): PositionSuggestedTradeContextRow | null {
    const key = this.buildSymbolContextKey(record.brokerKey, record.accountId, record.symbol);
    if (!key) {
      return null;
    }

    const candidates = fallbackBySymbol.get(key) || [];
    if (!candidates.length) {
      return null;
    }

    const positionSide = String(record.sideKey || record.side || '')
      .trim()
      .toLowerCase();
    const positionEntry = this.toNumberValue(
      record.entry_price ?? record.positionSummary?.entryPrice
    );
    const positionCreatedMs = this.toTimestamp(
      record.created_at || record.positionSummary?.createdAt || record.first_seen_at
    );
    let best: PositionSuggestedTradeContextRow | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (!this.tradeSideMatchesPosition(candidate.side, positionSide)) {
        continue;
      }

      const candidateEntry = this.toNumberValue(candidate.filledPrice ?? candidate.entryPrice);
      const priceDistance =
        positionEntry !== null && candidateEntry !== null && positionEntry > 0
          ? Math.abs(positionEntry - candidateEntry) / positionEntry
          : 0.02;
      if (priceDistance > 0.03) {
        continue;
      }

      const filledMs = this.toTimestamp(candidate.filledAt);
      const timeDistance =
        positionCreatedMs !== null && filledMs !== null
          ? Math.abs(positionCreatedMs - filledMs) / (60 * 60 * 1000)
          : 0;
      const score = priceDistance * 1000 + timeDistance;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  private applySuggestedTradeContext(
    record: PositionRecord,
    row: PositionSuggestedTradeContextRow | null
  ): void {
    const context = row ? this.mapSuggestedTradeContext(row) : null;
    const timeframe = context?.timeframe || 'unknown';
    const traceMethod = context?.traceMethod || 'unmatched';

    record.timeframe = timeframe;
    record.trade_timeframe = timeframe;
    record.tradeTimeframe = timeframe;
    record.signal_time = context?.signalTime ?? null;
    record.signalTime = context?.signalTime ?? null;
    record.entry_order_type = context?.entryOrderType ?? null;
    record.entryOrderType = context?.entryOrderType ?? null;
    record.entry_trigger_type = context?.entryTriggerType ?? null;
    record.entryTriggerType = context?.entryTriggerType ?? null;
    record.entry_submitted_at = context?.entrySubmittedAt ?? null;
    record.entrySubmittedAt = context?.entrySubmittedAt ?? null;
    record.entry_filled_at = context?.entryFilledAt ?? null;
    record.entryFilledAt = context?.entryFilledAt ?? null;
    record.entry_order_id = context?.entryOrderId ?? null;
    record.entryOrderId = context?.entryOrderId ?? null;
    record.executionProtection = context?.protection ?? null;
    record.suggested_trade_id = context?.suggestedTradeId ?? null;
    record.suggestedTradeId = context?.suggestedTradeId ?? null;
    record.automation_id = context?.automationId ?? null;
    record.automationId = context?.automationId ?? null;
    record.automation_run_id = context?.automationRunId ?? null;
    record.automationRunId = context?.automationRunId ?? null;
    record.trade_context_source = traceMethod;
    record.tradeContextSource = traceMethod;
    record.automationTrade = context;

    if (record.positionSummary) {
      record.positionSummary.timeframe = timeframe;
      record.positionSummary.tradeTimeframe = timeframe;
      record.positionSummary.signalTime = context?.signalTime ?? null;
      record.positionSummary.entryOrderType = context?.entryOrderType ?? null;
      record.positionSummary.entryTriggerType = context?.entryTriggerType ?? null;
      record.positionSummary.entrySubmittedAt = context?.entrySubmittedAt ?? null;
      record.positionSummary.entryFilledAt = context?.entryFilledAt ?? null;
      record.positionSummary.entryOrderId = context?.entryOrderId ?? null;
      record.positionSummary.executionProtection = context?.protection ?? null;
      record.positionSummary.suggestedTradeId = context?.suggestedTradeId ?? null;
      record.positionSummary.automationId = context?.automationId ?? null;
      record.positionSummary.automationRunId = context?.automationRunId ?? null;
    }
  }

  private mapSuggestedTradeContext(
    row: PositionSuggestedTradeContextRow
  ): PositionAutomationTradeContext | null {
    const suggestedTradeId = String(row.suggestedTradeId || '').trim();
    if (!suggestedTradeId) {
      return null;
    }

    return {
      suggestedTradeId,
      automationId: String(row.automationId || '').trim() || null,
      automationRunId: String(row.automationRunId || '').trim() || null,
      timeframe: String(row.timeframe || '').trim() || 'unknown',
      signalTime: this.toIsoString(row.signalTime),
      side: String(row.side || '').trim() || null,
      entryOrderId: String(row.orderId || '').trim() || null,
      entryOrderType: String(row.orderType || '').trim() || null,
      entryTriggerType: String(row.triggerType || '').trim() || null,
      entrySubmittedAt: this.toIsoString(row.submittedAt),
      entryFilledAt: this.toIsoString(row.filledAt),
      entryPrice: this.toNumberValue(row.entryPrice),
      filledPrice: this.toNumberValue(row.filledPrice),
      executionState: String(row.executionState || '').trim() || null,
      positionStatus: String(row.positionStatus || '').trim() || null,
      protection: this.mapPositionProtectionContext(row),
      sourceTemplateId: String(row.sourceTemplateId || '').trim() || null,
      sourceBacktestId: String(row.sourceBacktestId || '').trim() || null,
      traceMethod: row.traceMethod || 'symbol_entry',
    };
  }

  private mapPositionProtectionContext(
    row: PositionSuggestedTradeContextRow
  ): PositionAutomationTradeContext['protection'] {
    const state = String(row.protectionState || '').trim() || null;
    const source = String(row.protectionSource || '').trim() || null;
    const lastError = String(row.protectionLastError || '').trim() || null;
    const stopLossOrderId = String(row.protectionStopLossOrderId || '').trim() || null;
    const takeProfitOrderId = String(row.protectionTakeProfitOrderId || '').trim() || null;
    const attempts = this.toNumberValue(row.protectionAttempts);
    const stopLossPrice = this.toNumberValue(row.protectionStopLossPrice);
    const takeProfitPrice = this.toNumberValue(row.protectionTakeProfitPrice);
    const checkedAt = this.toIsoString(row.protectionCheckedAt);
    const attachedAt = this.toIsoString(row.protectionAttachedAt);

    if (
      !state &&
      !source &&
      !lastError &&
      !stopLossOrderId &&
      !takeProfitOrderId &&
      attempts === null &&
      stopLossPrice === null &&
      takeProfitPrice === null &&
      !checkedAt &&
      !attachedAt
    ) {
      return null;
    }

    return {
      state,
      source,
      attempts,
      lastError,
      checkedAt,
      attachedAt,
      stopLossPrice,
      takeProfitPrice,
      stopLossOrderId,
      takeProfitOrderId,
    };
  }

  private buildPositionContextKey(
    brokerKey: unknown,
    accountId: unknown,
    positionId: unknown
  ): string | null {
    const broker = String(brokerKey || '')
      .trim()
      .toLowerCase();
    const account = String(accountId || '').trim();
    const position = String(positionId || '').trim();
    if (!broker || !account || !position) {
      return null;
    }
    return `${broker}::${account}::${position}`;
  }

  private buildSymbolContextKey(
    brokerKey: unknown,
    accountId: unknown,
    symbol: unknown
  ): string | null {
    const broker = String(brokerKey || '')
      .trim()
      .toLowerCase();
    const account = String(accountId || '').trim();
    const normalizedSymbol = String(symbol || '')
      .trim()
      .toUpperCase();
    if (!broker || !account || !normalizedSymbol) {
      return null;
    }
    return `${broker}::${account}::${normalizedSymbol}`;
  }

  private tradeSideMatchesPosition(tradeSide: unknown, positionSide: string): boolean {
    const normalizedTradeSide = String(tradeSide || '')
      .trim()
      .toLowerCase();
    if (!normalizedTradeSide || !positionSide) {
      return true;
    }
    if (normalizedTradeSide === 'buy') {
      return positionSide.includes('long') || positionSide.includes('buy');
    }
    if (normalizedTradeSide === 'sell') {
      return positionSide.includes('short') || positionSide.includes('sell');
    }
    return true;
  }

  private toNumberValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private toTimestamp(value: unknown): number | null {
    const date = this.toDate(value);
    return date ? date.getTime() : null;
  }

  private toIsoString(value: unknown): string | null {
    const date = this.toDate(value);
    return date ? date.toISOString() : null;
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
    return Array.from(new Set(accountIds.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private liveObservedAtExpr(): string {
    return 'COALESCE(last_seen_at, position_updated_at, position_created_at)';
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
          brokerKey: String(row.brokerKey || '')
            .trim()
            .toLowerCase(),
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
        const existing =
          coverageByAccountId.get(accountId) || this.createEmptyCoverageRow(accountId);
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
