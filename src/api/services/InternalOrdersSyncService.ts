import { Service, Inject } from 'typedi';
import { createHash } from 'node:crypto';
import {
  BrokerAccount,
  BrokerAccountRepository,
  ExchangeAssetUpdateLogRepository,
} from '../../database';
import { coreDataSource } from '../../database/data-source';
import { ExchangeAssetUpdateLog } from '../../database/entities/ExchangeAssetUpdateLog';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { BrokerAccountRoutingService } from '../../brokers/core/BrokerAccountRoutingService';
import { BrokerRuntimeRegistry } from '../../brokers/core/BrokerRuntimeRegistry';
import { env } from '../../env';
import { OrdersSyncRequest } from '../contracts/InternalSync';
import { OperationalEventService } from './OperationalEventService';
import { SchedulerRuntimeSchemaService } from './SchedulerRuntimeSchemaService';
import { SuggestedTradesService } from './SuggestedTradesService';
import {
  POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE,
  POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE,
} from '../utils/positionsOrdersSyncScopeContract';

const MAX_LOOKBACK_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 7;
const SYNC_LIMIT = 50000;
const CHUNK_SIZE = 250;
const CHECKPOINT_SCHEDULER_KEY = 'orders-sync';

@Service()
export class InternalOrdersSyncService {
  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => BrokerAccountRoutingService)
  private brokerAccountRoutingService!: BrokerAccountRoutingService;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => ExchangeAssetUpdateLogRepository)
  private exchangeAssetUpdateLogRepository!: ExchangeAssetUpdateLogRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  @Inject(() => SchedulerRuntimeSchemaService)
  private schedulerRuntimeSchemaService!: SchedulerRuntimeSchemaService;

  // ── Helpers ──────────────────────────────────────────────────

  private extractList(raw: unknown): unknown[] {
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const data = (raw as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return data;
      }
    }
    return [];
  }

  private parseIsoDate(value: string): Date | null {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateOnly.test(raw)) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private formatIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private buildDateWindows(startDate: string, endDate: string, windowDays: number): Array<{ startDate: string; endDate: string }> {
    const start = this.parseIsoDate(startDate);
    const end = this.parseIsoDate(endDate);
    if (!start || !end) return [{ startDate, endDate }];
    const safeWindowDays = Math.min(30, Math.max(1, Math.floor(Number(windowDays || DEFAULT_WINDOW_DAYS))));
    const windows: Array<{ startDate: string; endDate: string }> = [];
    let cursor = start;
    while (cursor.getTime() <= end.getTime()) {
      const windowEnd = this.addDays(cursor, safeWindowDays - 1);
      const cappedEnd = windowEnd.getTime() > end.getTime() ? end : windowEnd;
      windows.push({ startDate: this.formatIsoDate(cursor), endDate: this.formatIsoDate(cappedEnd) });
      cursor = this.addDays(cappedEnd, 1);
    }
    return windows.length ? windows : [{ startDate, endDate }];
  }

  private readAffectedRows(result: unknown): number {
    const header =
      Array.isArray(result) && result.length > 0 && typeof result[0] === 'object'
        ? (result[0] as { affectedRows?: number })
        : (result as { affectedRows?: number });
    const value = Number(header?.affectedRows || 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  // ── Status helpers ───────────────────────────────────────────

  private computeOrderStatusRank(status: string): number {
    const normalized = String(status || '').trim().toUpperCase();
    if (['OPEN', 'PENDING'].includes(normalized)) return 1;
    if (['PARTIALLY_FILLED', 'PARTIAL', 'TRIGGER_PENDING'].includes(normalized)) return 2;
    if (['FILLED', 'COMPLETED', 'EXECUTED'].includes(normalized)) return 3;
    if (['CLOSED', 'CANCELLED', 'CANCELED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(normalized)) return 4;
    return 0;
  }

  private normalizeOrderStatus(status: string | null): string | null {
    const raw = String(status || '').trim();
    if (!raw) return null;
    const normalized = raw.toUpperCase();

    if (['OPEN', 'NEW', 'CREATED'].includes(normalized)) return 'OPEN';
    if (['PENDING', 'TRIGGER_PENDING'].includes(normalized)) return 'PENDING';
    if (['PARTIALLY_FILLED', 'PARTIAL'].includes(normalized)) return 'PARTIALLY_FILLED';
    if (['FILLED', 'COMPLETED', 'EXECUTED'].includes(normalized)) return 'FILLED';
    if (['CANCELLED', 'CANCELED'].includes(normalized)) return 'CANCELLED';
    if (['CLOSED'].includes(normalized)) return 'CLOSED';
    if (['REJECTED'].includes(normalized)) return 'REJECTED';
    if (['EXPIRED'].includes(normalized)) return 'EXPIRED';
    if (['FAILED'].includes(normalized)) return 'FAILED';

    return normalized;
  }

  private readOrderExternalId(order: Record<string, unknown>): string {
    return (
      String(order.id || order.order_id || '').trim() || this.buildOrderSyntheticId(order)
    );
  }

  private buildOrderSyntheticId(order: Record<string, unknown>): string {
    const symbol = String(order.symbol || '').trim().toUpperCase();
    const createdAt = String(order.created_at || '').trim();
    const price = String(order.price || '').trim();
    return [symbol || 'NA', createdAt || 'NA', price || 'NA'].join(':');
  }

  private readonly orderObservedAtSql = `COALESCE(
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.updated_at')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.filled_at')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.closed_at')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.cancelled_at')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.canceled_at')), ''),
    NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.created_at')), ''),
    DATE_FORMAT(last_seen_at, '%Y-%m-%dT%H:%i:%s.000Z')
  )`;

  private async getCheckpoint(accountId: string): Promise<Date | null> {
    const rows = (await coreDataSource.query(
      `SELECT checkpoint_at FROM scheduler_sync_checkpoints
       WHERE scheduler_key = ? AND account_id = ?
       LIMIT 1`,
      [CHECKPOINT_SCHEDULER_KEY, accountId]
    )) as Array<{ checkpoint_at: Date | string }>;
    if (!rows || rows.length === 0) return null;
    const val = rows[0].checkpoint_at;
    const d = val instanceof Date ? val : new Date(String(val));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private async saveCheckpoint(accountId: string, checkpointAt: Date): Promise<void> {
    await coreDataSource.query(
      `INSERT INTO scheduler_sync_checkpoints (id, scheduler_key, account_id, checkpoint_at, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE checkpoint_at = VALUES(checkpoint_at), updated_at = NOW()`,
      [CHECKPOINT_SCHEDULER_KEY, accountId, checkpointAt]
    );
  }

  private extractOrderExternalIds(items: unknown[]): string[] {
    const ids = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const externalId = this.readOrderExternalId(item as Record<string, unknown>);
      if (externalId) {
        ids.add(externalId);
      }
    }
    return Array.from(ids);
  }

  private async listTerminalSnapshotRowsBeforeObservedAt(
    userId: string,
    accountId: string,
    brokerKey: string,
    cutoffIso: string
  ): Promise<Array<{ externalId: string; symbol: string | null; orderStatus: string | null }>> {
    return (await coreDataSource.query(
      `SELECT external_id AS externalId,
              symbol,
              order_status AS orderStatus
       FROM scheduler_orders_snapshots
       WHERE user_id = ?
         AND account_id = ?
         AND LOWER(broker_key) = ?
         AND status_rank >= 3
         AND ${this.orderObservedAtSql} < ?`,
      [userId, accountId, brokerKey.toLowerCase(), cutoffIso]
    )) as Array<{ externalId: string; symbol: string | null; orderStatus: string | null }>;
  }

  private async listTerminalSnapshotRowsWithinObservedRange(
    userId: string,
    accountId: string,
    brokerKey: string,
    startIso: string,
    endIso: string
  ): Promise<Array<{ externalId: string; symbol: string | null; orderStatus: string | null }>> {
    return (await coreDataSource.query(
      `SELECT external_id AS externalId,
              symbol,
              order_status AS orderStatus
       FROM scheduler_orders_snapshots
       WHERE user_id = ?
         AND account_id = ?
         AND LOWER(broker_key) = ?
         AND status_rank >= 3
         AND ${this.orderObservedAtSql} >= ?
         AND ${this.orderObservedAtSql} <= ?`,
      [userId, accountId, brokerKey.toLowerCase(), startIso, endIso]
    )) as Array<{ externalId: string; symbol: string | null; orderStatus: string | null }>;
  }

  private async deleteOrderSnapshotsByExternalIds(
    userId: string,
    accountId: string,
    brokerKey: string,
    externalIds: string[]
  ): Promise<number> {
    const normalizedIds = Array.from(
      new Set(externalIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (normalizedIds.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (let index = 0; index < normalizedIds.length; index += CHUNK_SIZE) {
      const chunk = normalizedIds.slice(index, index + CHUNK_SIZE);
      const result = await coreDataSource.query(
        `DELETE FROM scheduler_orders_snapshots
         WHERE user_id = ?
           AND account_id = ?
           AND LOWER(broker_key) = ?
           AND external_id IN (${chunk.map(() => '?').join(',')})`,
        [userId, accountId, brokerKey.toLowerCase(), ...chunk]
      );
      deleted += this.readAffectedRows(result);
    }

    return deleted;
  }

  private async logDeletedOrderSnapshots(
    rows: Array<{ externalId: string; symbol: string | null; orderStatus: string | null }>,
    runLogId: string | undefined,
    accountId: string,
    reason: string
  ): Promise<void> {
    if (!runLogId || rows.length === 0) {
      return;
    }

    await this.exchangeAssetUpdateLogRepository.createMany(
      rows.map((row) => ({
        runLogId,
        source: 'orders',
        accountId,
        actionType: 'deleted',
        symbol: row.symbol,
        externalId: row.externalId,
        message: reason
          ? `${reason}: ${row.orderStatus || 'UNKNOWN'}`
          : row.orderStatus || 'UNKNOWN',
      }))
    );
  }

  private async reconcileTerminalHistoryWindow(
    userId: string,
    accountId: string,
    brokerKey: string,
    historyStart: Date,
    historyEnd: Date,
    historyOrders: unknown[],
    runLogId?: string
  ): Promise<{ deletedOutsideLookback: number; deletedMissingHistory: number; orderIds: string[] }> {
    const historyStartIso = historyStart.toISOString();
    const historyEndIso = historyEnd.toISOString();

    const rowsOutsideLookback = await this.listTerminalSnapshotRowsBeforeObservedAt(
      userId,
      accountId,
      brokerKey,
      historyStartIso
    );
    const deletedOutsideLookback = await this.deleteOrderSnapshotsByExternalIds(
      userId,
      accountId,
      brokerKey,
      rowsOutsideLookback.map((row) => row.externalId)
    );
    await this.logDeletedOrderSnapshots(
      rowsOutsideLookback,
      runLogId,
      accountId,
      'removed outside lookback window'
    );

    const historyExternalIds = new Set(this.extractOrderExternalIds(historyOrders));
    const rowsWithinWindow = await this.listTerminalSnapshotRowsWithinObservedRange(
      userId,
      accountId,
      brokerKey,
      historyStartIso,
      historyEndIso
    );
    const rowsMissingFromHistory = rowsWithinWindow.filter(
      (row) => !historyExternalIds.has(String(row.externalId || '').trim())
    );
    const deletedMissingHistory = await this.deleteOrderSnapshotsByExternalIds(
      userId,
      accountId,
      brokerKey,
      rowsMissingFromHistory.map((row) => row.externalId)
    );
    await this.logDeletedOrderSnapshots(
      rowsMissingFromHistory,
      runLogId,
      accountId,
      'removed because broker history no longer reports the order'
    );

    return {
      deletedOutsideLookback,
      deletedMissingHistory,
      orderIds: Array.from(
        new Set(
          [...rowsOutsideLookback, ...rowsMissingFromHistory]
            .map((row) => String(row.externalId || '').trim())
            .filter(Boolean)
        )
      ),
    };
  }

  // ── Deduplication ────────────────────────────────────────────

  private deduplicateByExternalId(items: unknown[]): unknown[] {
    const map = new Map<string, { item: unknown; rank: number }>();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const id = String(rec.id || rec.order_id || '').trim() || this.buildOrderSyntheticId(rec);
      if (!id) continue;
      const status = this.normalizeOrderStatus(String(rec.status || '').trim() || null);
      const rank = this.computeOrderStatusRank(status || '');
      const existing = map.get(id);
      if (!existing || rank >= existing.rank) {
        map.set(id, { item, rank });
      }
    }
    return Array.from(map.values()).map(e => e.item);
  }

  // ── Row building ─────────────────────────────────────────────

  private buildOrderRow(
    userId: string,
    accountId: string,
    brokerKey: string,
    item: Record<string, unknown>
  ): {
    userId: string;
    accountId: string;
    brokerKey: string;
    externalId: string;
    symbol: string | null;
    orderStatus: string | null;
    statusRank: number;
    payloadJson: string;
    payloadHash: string;
  } | null {
    const externalId =
      String(item.id || item.order_id || '').trim() || this.buildOrderSyntheticId(item);
    if (!externalId) return null;
    const symbol = String(item.symbol || '').trim() || null;
    const orderStatus = this.normalizeOrderStatus(String(item.status || '').trim() || null);
    const statusRank = this.computeOrderStatusRank(orderStatus || '');
    const payloadJson = JSON.stringify(item);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    return {
      userId,
      accountId,
      brokerKey,
      externalId,
      symbol,
      orderStatus,
      statusRank,
      payloadJson,
      payloadHash,
    };
  }

  // ── Single forward-only upsert ───────────────────────────────

  private async upsertOrderSnapshotBatch(
    rows: Array<{
      userId: string;
      accountId: string;
      brokerKey: string;
      externalId: string;
      symbol: string | null;
      orderStatus: string | null;
      statusRank: number;
      payloadJson: string;
      payloadHash: string;
    }>,
    runLogId?: string
  ): Promise<{ inserted: number; updated: number; skipped: number; orderIds: string[] }> {
    if (rows.length === 0) return { inserted: 0, updated: 0, skipped: 0, orderIds: [] };

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);

      // Query existing external_ids and their current statuses before upsert
      const chunkExternalIds = chunk.map((r) => r.externalId);
      const existingRows = (await coreDataSource.query(
        `SELECT external_id, order_status, payload_hash, status_rank
         FROM scheduler_orders_snapshots
         WHERE user_id = ? AND account_id = ? AND external_id IN (${chunkExternalIds.map(() => '?').join(',')})`,
        [chunk[0].userId, chunk[0].accountId, ...chunkExternalIds]
      )) as Array<{ external_id: string; order_status: string | null; payload_hash: string | null; status_rank: number }>;

      const existingMap = new Map<string, { orderStatus: string | null; payloadHash: string | null; statusRank: number }>();
      for (const row of existingRows) {
        existingMap.set(row.external_id, {
          orderStatus: row.order_status,
          payloadHash: row.payload_hash,
          statusRank: row.status_rank,
        });
      }

      const placeholders = chunk
        .map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), NOW())')
        .join(',');
      const params: Array<unknown> = [];
      for (const row of chunk) {
        params.push(
          row.userId,
          row.accountId,
          row.brokerKey,
          row.externalId,
          row.symbol,
          row.orderStatus,
          row.statusRank,
          row.payloadJson,
          row.payloadHash
        );
      }

      await coreDataSource.query(
        `INSERT INTO scheduler_orders_snapshots
           (id, user_id, account_id, broker_key, external_id, symbol,
            order_status, status_rank, payload_json, payload_hash,
            first_seen_at, last_seen_at, created_at, updated_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           last_seen_at = NOW(),
           broker_key = VALUES(broker_key),
           symbol = COALESCE(VALUES(symbol), symbol),
           order_status = IF(VALUES(status_rank) >= status_rank, VALUES(order_status), order_status),
           status_rank = GREATEST(status_rank, VALUES(status_rank)),
           payload_json = IF(VALUES(status_rank) >= status_rank, VALUES(payload_json), payload_json),
           payload_hash = IF(VALUES(status_rank) >= status_rank, VALUES(payload_hash), payload_hash),
           updated_at = NOW()`,
        params
      );

      // Classify each row as inserted / updated / skipped
      for (const row of chunk) {
        const existing = existingMap.get(row.externalId);
        if (!existing) {
          inserted += 1;
        } else if (row.payloadHash === existing.payloadHash) {
          skipped += 1;
        } else if (row.statusRank < existing.statusRank) {
          skipped += 1;
        } else {
          updated += 1;
        }
      }

      // Write per-record update logs
      if (runLogId) {
        const logEntries: QueryDeepPartialEntity<ExchangeAssetUpdateLog>[] = [];
        for (const row of chunk) {
          const existing = existingMap.get(row.externalId);
          const isInsert = !existing;

          let actionType: string;
          let message: string;

          if (isInsert) {
            actionType = 'inserted';
            message = row.orderStatus || 'UNKNOWN';
          } else if (row.payloadHash === existing.payloadHash) {
            actionType = 'skipped';
            message = 'payload unchanged';
          } else if (row.statusRank < existing.statusRank) {
            actionType = 'skipped';
            const existingStatusLabel = existing.orderStatus || 'UNKNOWN';
            const incomingStatusLabel = row.orderStatus || 'UNKNOWN';
            message = `status rank lower: ${existingStatusLabel}(${existing.statusRank}) > ${incomingStatusLabel}(${row.statusRank})`;
          } else {
            actionType = 'updated';
            message = existing.orderStatus !== row.orderStatus
              ? `status: ${existing.orderStatus || 'UNKNOWN'} → ${row.orderStatus || 'UNKNOWN'}`
              : `status: ${row.orderStatus || 'UNKNOWN'} (unchanged)`;
          }

          logEntries.push({
            runLogId,
            source: 'orders',
            accountId: row.accountId,
            actionType,
            symbol: row.symbol,
            externalId: row.externalId,
            message,
          });
        }
        await this.exchangeAssetUpdateLogRepository.createMany(logEntries);
      }
    }

    return {
      inserted,
      updated,
      skipped,
      orderIds: Array.from(new Set(rows.map((row) => String(row.externalId || '').trim()).filter(Boolean))),
    };
  }

  private async upsertOrderSnapshotsFromItems(
    userId: string,
    accountId: string,
    brokerKey: string,
    items: unknown[],
    runLogId?: string
  ): Promise<{ inserted: number; updated: number; skipped: number; orderIds: string[] }> {
    if (items.length === 0) return { inserted: 0, updated: 0, skipped: 0, orderIds: [] };

    const prepared: Array<{
      userId: string;
      accountId: string;
      brokerKey: string;
      externalId: string;
      symbol: string | null;
      orderStatus: string | null;
      statusRank: number;
      payloadJson: string;
      payloadHash: string;
    }> = [];

    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = this.buildOrderRow(userId, accountId, brokerKey, item as Record<string, unknown>);
      if (row) prepared.push(row);
    }

    return this.upsertOrderSnapshotBatch(prepared, runLogId);
  }

  // ── Target resolution ────────────────────────────────────────

  private async resolveTargetUserIds(inputUserIds?: string[]): Promise<string[]> {
    const provided = (inputUserIds || []).map((item) => String(item || '').trim()).filter(Boolean);
    if (provided.length === 0) {
      return [];
    }
    return Array.from(new Set(provided));
  }

  private normalizeBrokerKeys(input?: string[]): Array<string> {
    const raw = Array.isArray(input) ? input : [];
    const normalized = raw
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(normalized));
  }

  private filterScopedAccounts(
    accounts: BrokerAccount[],
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): BrokerAccount[] {
    return accounts.filter((account) => {
      if (
        brokerKeyFilter.size > 0 &&
        !brokerKeyFilter.has(String(account.brokerKey || '').toLowerCase())
      ) {
        return false;
      }
      if (accountIdFilter.size > 0 && !accountIdFilter.has(String(account.id || ''))) {
        return false;
      }
      return true;
    });
  }

  private groupInfraAccountsByOwner(
    accounts: BrokerAccount[],
    brokerKeyFilter: ReadonlySet<string>,
    accountIdFilter: ReadonlySet<string>
  ): Array<{ userId: string; accounts: BrokerAccount[] }> {
    const scopedAccounts = this.filterScopedAccounts(accounts, brokerKeyFilter, accountIdFilter);
    const grouped = new Map<string, BrokerAccount[]>();

    for (const account of scopedAccounts) {
      const ownerUserId = String(account.userId || '').trim();
      if (!ownerUserId) {
        continue;
      }
      const bucket = grouped.get(ownerUserId);
      if (bucket) {
        bucket.push(account);
      } else {
        grouped.set(ownerUserId, [account]);
      }
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([userId, ownerAccounts]) => ({
        userId,
        accounts: ownerAccounts.sort((left, right) =>
          String(left.id || '').localeCompare(String(right.id || ''))
        ),
      }));
  }

  private async resolveExecutionUserIds(request: OrdersSyncRequest): Promise<string[]> {
    const executionScope = String(request.executionScope || '').trim().toLowerCase();
    if (executionScope === POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE) {
      const requestUserId = String(request.requestUserId || '').trim();
      if (!requestUserId) {
        throw new Error('Product-owned orders sync requests require requestUserId.');
      }
      return [requestUserId];
    }

    if (executionScope === POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE) {
      const systemUserId = String(env.scheduler.systemUserId || '').trim();
      if (!systemUserId) {
        throw new Error('System scheduler orders sync requests require env.scheduler.systemUserId.');
      }
      return [systemUserId];
    }

    return this.resolveTargetUserIds(request.targetUserIds);
  }

  // ── Main entry point ─────────────────────────────────────────

  async runBatch(request: OrdersSyncRequest): Promise<{
    processedUsers: number;
    succeededUsers: number;
    failedUsers: number;
    processedAccounts: number;
    fetchedRecords: number;
    insertedRecords: number;
    updatedRecords: number;
    skippedRecords: number;
    failedAccounts: number;
    failures: Array<{ userId: string; error: string }>;
  }> {
    const startedAt = new Date();
    await this.schedulerRuntimeSchemaService.assertOrdersRuntimeSchemaReady();

    const now = new Date();
    const lookbackDays = Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.floor(Number(request.lookbackDays || MAX_LOOKBACK_DAYS))));
    const historyWindowDays =
      typeof request.historyWindowDays === 'number'
        ? Math.floor(request.historyWindowDays)
        : DEFAULT_WINDOW_DAYS;
    const forceBackfill = Boolean(request.backfill);

    const userIds = await this.resolveExecutionUserIds(request);
    const brokerKeys = this.normalizeBrokerKeys(request.brokerKeys);
    const brokerKeyFilter = new Set(brokerKeys);
    const accountIdFilter = new Set(
      (request.accountIds || []).map((item) => String(item || '').trim()).filter(Boolean)
    );
    const isInfraAllAccountsRequest =
      userIds.length === 1 && userIds[0] === env.scheduler.systemUserId;
    const accountGroups = isInfraAllAccountsRequest
      ? this.groupInfraAccountsByOwner(
          await this.brokerAccountRepository.getAllActiveBrokerAccounts(),
          brokerKeyFilter,
          accountIdFilter
        )
      : await Promise.all(
          userIds.map(async (userId) => {
            const isSystemUser = userId === env.scheduler.systemUserId;
            const accounts = isSystemUser
              ? await this.brokerAccountRepository.getActiveSystemBrokerAccounts()
              : await this.brokerAccountRepository.getActiveBrokerAccounts(userId);
            return {
              userId,
              accounts: this.filterScopedAccounts(accounts, brokerKeyFilter, accountIdFilter),
            };
          })
        );

    let succeededUsers = 0;
    let failedUsers = 0;
    let processedAccounts = 0;
    let fetchedRecords = 0;
    let insertedRecords = 0;
    let updatedRecords = 0;
    let skippedRecords = 0;
    let failedAccounts = 0;
    const failures: Array<{ userId: string; error: string }> = [];

    for (const { userId, accounts: scopedAccounts } of accountGroups) {
      try {
        let hadCompletedAccount = false;
        const isSystemUser = userId === env.scheduler.systemUserId;

        for (const account of scopedAccounts) {
          processedAccounts += 1;
          try {
            const brokerKey = String(account.brokerKey || '').trim();
            const accountId = String(account.id || '').trim();
            if (!brokerKey || !accountId) {
              continue;
            }

            const accountSyncStartedAt = new Date();
            const route = isSystemUser
              ? { userId, brokerKey, accountId }
              : await this.brokerAccountRoutingService.resolve(
                  userId,
                  brokerKey,
                  accountId,
                  brokerKey
                );
            const resolvedBrokerKey = String(route.brokerKey || brokerKey).trim() || brokerKey;
            const resolvedAccountId = String(route.accountId || accountId).trim() || accountId;

            let openOrders: unknown[] = [];
            let openError: string | null = null;
            let historyOrders: unknown[] = [];
            let historyError: string | null = null;

            // Step 1: Always fetch open orders (lightweight, catches status changes fast)
            try {
              const openRaw = await this.brokerRuntimeRegistry
                .getOrdersAdapter(resolvedBrokerKey)
                .listOpenOrders({ limit: SYNC_LIMIT }, route);
              openOrders = this.extractList(openRaw);
            } catch (error) {
              openError = error instanceof Error ? error.message : String(error);
            }

            // Step 2: Determine history date range from checkpoint
            const checkpoint = await this.getCheckpoint(resolvedAccountId);
            let historyStart: Date;
            let historyEnd: Date = now;

            if (forceBackfill || !checkpoint) {
              // No checkpoint or forced backfill: full lookback
              historyStart = this.addDays(now, -lookbackDays);
            } else {
              const gapDays = (now.getTime() - checkpoint.getTime()) / (24 * 60 * 60 * 1000);
              if (gapDays > MAX_LOOKBACK_DAYS) {
                // Gap exceeds max lookback — treat as fresh backfill
                historyStart = this.addDays(now, -MAX_LOOKBACK_DAYS);
                failures.push({
                  userId,
                  error: `Checkpoint gap exceeds ${MAX_LOOKBACK_DAYS} days for account ${resolvedAccountId} — backfilling last ${MAX_LOOKBACK_DAYS} days, older data may be missing`,
                });
              } else {
                // Incremental: checkpoint - 1 day overlap for safety
                historyStart = this.addDays(checkpoint, -1);
              }
            }

            // Step 3: Fetch history in date windows
            const startDateStr = this.formatIsoDate(historyStart);
            const endDateStr = this.formatIsoDate(historyEnd);

            try {
              const windows = this.buildDateWindows(startDateStr, endDateStr, historyWindowDays);
              const combinedHistory: unknown[] = [];
              for (const window of windows) {
                const historyRaw = await this.brokerRuntimeRegistry
                  .getOrdersAdapter(resolvedBrokerKey)
                  .getOrderHistory(
                    {
                      limit: SYNC_LIMIT,
                      startDate: window.startDate || undefined,
                      endDate: window.endDate || undefined,
                    },
                    route
                  );
                combinedHistory.push(...this.extractList(historyRaw));
              }
              historyOrders = combinedHistory;
            } catch (error) {
              historyError = error instanceof Error ? error.message : String(error);
            }

            if (openError && historyError) {
              throw new Error(
                `Open orders failed: ${openError}; Order history failed: ${historyError}`
              );
            }

            // Step 4: Deduplicate open + history in memory, keeping highest status rank
            const combined = [...openOrders, ...historyOrders];
            const deduped = this.deduplicateByExternalId(combined);
            const affectedOrderIds = new Set<string>();

            // Step 5: Single forward-only upsert
            const delta = await this.upsertOrderSnapshotsFromItems(
              userId,
              resolvedAccountId,
              resolvedBrokerKey.toLowerCase(),
              deduped,
              request.runLogId
            );

            insertedRecords += delta.inserted;
            updatedRecords += delta.updated;
            skippedRecords += delta.skipped;
            fetchedRecords += combined.length;
            for (const orderId of delta.orderIds) {
              affectedOrderIds.add(orderId);
            }

            // Step 6: Close stale open orders not seen in this run
            if (!openError) {
              const closeRank = this.computeOrderStatusRank('CLOSED');

              // Query stale orders before closing (for logging and suggestion sync)
              const staleOrders = (await coreDataSource.query(
                `SELECT external_id, symbol, order_status
                 FROM scheduler_orders_snapshots
                 WHERE user_id = ?
                   AND account_id = ?
                   AND LOWER(broker_key) = ?
                   AND status_rank < ?
                   AND last_seen_at < ?`,
                [
                  userId,
                  resolvedAccountId,
                  resolvedBrokerKey.toLowerCase(),
                  closeRank,
                  accountSyncStartedAt,
                ]
              )) as Array<{ external_id: string; symbol: string | null; order_status: string | null }>;

              const closeResult = await coreDataSource.query(
                `UPDATE scheduler_orders_snapshots
                 SET order_status = 'CLOSED',
                     status_rank = ?,
                     updated_at = NOW()
                 WHERE user_id = ?
                   AND account_id = ?
                   AND LOWER(broker_key) = ?
                   AND status_rank < ?
                   AND last_seen_at < ?`,
                [
                  closeRank,
                  userId,
                  resolvedAccountId,
                  resolvedBrokerKey.toLowerCase(),
                  closeRank,
                  accountSyncStartedAt,
                ]
              );
              const closedCount = this.readAffectedRows(closeResult);
              updatedRecords += closedCount;

              // Log stale-closed orders
              if (request.runLogId && staleOrders.length > 0) {
                const closeLogEntries: QueryDeepPartialEntity<ExchangeAssetUpdateLog>[] = staleOrders.map((row) => ({
                  runLogId: request.runLogId,
                  source: 'orders',
                  accountId: resolvedAccountId,
                  actionType: 'closed',
                  symbol: row.symbol,
                  externalId: row.external_id,
                  message: `stale-closed: ${row.order_status || 'UNKNOWN'} → CLOSED`,
                }));
                await this.exchangeAssetUpdateLogRepository.createMany(closeLogEntries);
              }

              for (const row of staleOrders) {
                const orderId = String(row.external_id || '').trim();
                if (orderId) {
                  affectedOrderIds.add(orderId);
                }
              }
            }

            if (!historyError) {
              const reconciliation = await this.reconcileTerminalHistoryWindow(
                userId,
                resolvedAccountId,
                resolvedBrokerKey.toLowerCase(),
                historyStart,
                historyEnd,
                historyOrders,
                request.runLogId
              );
              for (const orderId of reconciliation.orderIds) {
                affectedOrderIds.add(orderId);
              }
            }

            if (affectedOrderIds.size > 0) {
              try {
                await this.suggestedTradesService.syncExecutionForOrderUpdates(
                  userId,
                  resolvedBrokerKey.toLowerCase(),
                  resolvedAccountId,
                  Array.from(affectedOrderIds)
                );
              } catch (error) {
                failures.push({
                  userId,
                  error: `suggested trade order sync failed for account ${resolvedAccountId} (${resolvedBrokerKey}): ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                });
              }
            }

            // Step 7: Save checkpoint on success
            if (!historyError) {
              await this.saveCheckpoint(resolvedAccountId, historyEnd);
            }

            if (openError || historyError) {
              failures.push({
                userId,
                error: `orders sync partial failure for account ${resolvedAccountId} (${resolvedBrokerKey}): ${
                  openError ? `open error: ${openError}` : ''
                }${openError && historyError ? '; ' : ''}${historyError ? `history error: ${historyError}` : ''}`,
              });
            }
            hadCompletedAccount = true;
          } catch (error) {
            failedAccounts += 1;
            failures.push({
              userId,
              error: `orders sync failed for account ${String(account.id || '').trim()} (${String(
                account.brokerKey || ''
              ).trim()}): ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }

        if (hadCompletedAccount) {
          succeededUsers += 1;
        } else {
          failedUsers += 1;
          failures.push({
            userId,
            error: scopedAccounts.length
              ? 'All scoped broker accounts failed during orders sync'
              : 'No active broker accounts matched the sync scope',
          });
        }
      } catch (error) {
        failedUsers += 1;
        failures.push({
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result = {
      processedUsers: accountGroups.length || userIds.length,
      succeededUsers,
      failedUsers,
      processedAccounts,
      fetchedRecords,
      insertedRecords,
      updatedRecords,
      skippedRecords,
      failedAccounts,
      failures,
    };

    const actorUserId = env.scheduler.systemUserId || userIds[0] || '';
    const failed = failures.length;
    await this.operationalEventService.logActivity(actorUserId, {
      type: 'Scheduler run',
      title: 'Orders sync completed',
      status: failed > 0 ? 'Warning' : 'Success',
      route: 'Schedulers',
      stream: 'Runs',
      related: CHECKPOINT_SCHEDULER_KEY,
      description: `Processed ${accountGroups.length || userIds.length} user(s) in ${Date.now() - startedAt.getTime()}ms. ` +
        `Accounts processed=${processedAccounts}, inserted=${insertedRecords}, updated=${updatedRecords}, ` +
        `skipped=${skippedRecords}, failures=${failed}.`,
    });

    if (failed > 0) {
      await this.operationalEventService.emitFailureAlert(actorUserId, {
        channel: 'Scheduler',
        source: CHECKPOINT_SCHEDULER_KEY,
        message: `Orders sync completed with ${failed} failure(s) across ${failedAccounts} account(s).`,
        route: 'Schedulers',
        symbol: 'ORDERS',
      });
    }

    return result;
  }
}
