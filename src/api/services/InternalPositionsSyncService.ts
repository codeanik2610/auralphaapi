import { Service, Inject } from 'typedi';
import { createHash } from 'node:crypto';
import {
  AssetPriceRepository,
  BrokerAccount,
  BrokerAccountRepository,
  ExchangeAssetUpdateLogRepository,
  PositionReadModelRepository,
} from '../../database';
import { coreDataSource } from '../../database/data-source';
import { ExchangeAssetUpdateLog } from '../../database/entities/ExchangeAssetUpdateLog';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { BrokerAccountRoutingService } from '../../brokers/core/BrokerAccountRoutingService';
import { BrokerRuntimeRegistry } from '../../brokers/core/BrokerRuntimeRegistry';
import { env } from '../../env';
import { PositionsSyncRequest } from '../contracts/InternalSync';
import { OperationalEventService } from './OperationalEventService';
import { SuggestedTradesService } from './SuggestedTradesService';
import {
  POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE,
  POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE,
} from '../utils/positionsOrdersSyncScopeContract';
import {
  buildPositionReadModelUpsert,
  PositionReadModelUpsert,
} from '../utils/positionsReadModel';

const MAX_LOOKBACK_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 7;
const SYNC_LIMIT = 50000;
const CHUNK_SIZE = 250;
const CHECKPOINT_SCHEDULER_KEY = 'positions-sync';

@Service()
export class InternalPositionsSyncService {
  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => BrokerAccountRoutingService)
  private brokerAccountRoutingService!: BrokerAccountRoutingService;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => ExchangeAssetUpdateLogRepository)
  private exchangeAssetUpdateLogRepository!: ExchangeAssetUpdateLogRepository;

  @Inject(() => PositionReadModelRepository)
  private positionReadModelRepository!: PositionReadModelRepository;

  @Inject(() => AssetPriceRepository)
  private assetPriceRepository!: AssetPriceRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  // ── Helpers ──────────────────────────────────────────────────

  private toFiniteNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private parsePayloadJson(value: unknown): Record<string, unknown> | null {
    let obj: unknown;
    if (typeof value === 'string') {
      try { obj = JSON.parse(value); } catch { return null; }
    } else {
      obj = value;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return null;
  }

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

  private normalizeMarketSymbol(value: unknown): string | null {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return null;
    if (raw.endsWith('USDT')) return raw;
    if (raw.endsWith('USD')) return `${raw.slice(0, -3)}USDT`;
    if (/^[A-Z0-9]{2,20}$/.test(raw)) return `${raw}USDT`;
    return raw;
  }

  private resolvePositionDirection(position: Record<string, unknown>): number {
    const side = String(position.side ?? '').trim().toLowerCase();
    const positionType = String(position.position_type ?? '').trim().toLowerCase();
    const orderType = String(position.order_type ?? '').trim().toLowerCase();

    if (side === 'short' || positionType === 'short' || orderType === 'sell') return -1;
    if (side === 'long' || positionType === 'long' || orderType === 'buy') return 1;

    const size = Number(position.size ?? 0);
    if (Number.isFinite(size) && size < 0) return -1;
    return 1;
  }

  private computeUnrealizedPnl(position: Record<string, unknown>, markPrice: number): number | null {
    const entry = Number(
      position.entry_price ?? position.avg_entry_price ?? position.average_entry_price ?? 0
    );
    const qty = Math.abs(Number(position.quantity ?? position.size ?? 0));
    if (!Number.isFinite(entry) || !Number.isFinite(qty) || qty <= 0) {
      return null;
    }
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      return null;
    }
    const direction = this.resolvePositionDirection(position);
    return direction * (markPrice - entry) * qty;
  }

  private async enrichOpenPositionsWithMarketPnl(items: unknown[]): Promise<void> {
    const records = items
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as Record<string, unknown>);

    if (!records.length) return;

    const symbols = new Set<string>();
    for (const record of records) {
      const symbol = this.normalizeMarketSymbol(record.symbol ?? record.product_symbol);
      if (symbol) symbols.add(symbol);
    }

    if (!symbols.size) return;

    let rows: Array<{ symbol?: string; price?: unknown; retrievedAt?: Date | string; source?: string }> = [];
    try {
      rows = (await this.assetPriceRepository.getBySymbols(Array.from(symbols), {
        sources: ['mudrex'],
      })) as Array<{ symbol?: string; price?: unknown; retrievedAt?: Date | string; source?: string }>;
    } catch {
      return;
    }

    const priceMap = new Map<string, { price: number; retrievedAt?: string; source?: string }>();
    for (const row of rows) {
      const symbol = String(row.symbol || '').trim().toUpperCase();
      const price = Number(row.price);
      if (!symbol || !Number.isFinite(price)) continue;
      const retrievedAt =
        row.retrievedAt instanceof Date
          ? row.retrievedAt
          : row.retrievedAt
            ? new Date(String(row.retrievedAt))
            : null;
      priceMap.set(symbol, {
        price,
        retrievedAt: retrievedAt && !Number.isNaN(retrievedAt.getTime()) ? retrievedAt.toISOString() : undefined,
        source: row.source || 'binance',
      });
    }

    for (const record of records) {
      const symbol = this.normalizeMarketSymbol(record.symbol ?? record.product_symbol);
      if (!symbol) continue;
      const market = priceMap.get(symbol);
      if (!market) continue;

      record.mark_price ??= String(market.price);
      record.current_price ??= String(market.price);
      record.market_price_source ??= market.source;
      if (market.retrievedAt) {
        record.market_price_retrieved_at ??= market.retrievedAt;
      }
      const pnl = this.computeUnrealizedPnl(record, market.price);
      if (pnl !== null) {
        record.unrealized_pnl = pnl;
      }
    }
  }

  // ── Status helpers ───────────────────────────────────────────

  private computePositionStatusRank(status: string): number {
    const normalized = String(status || '').trim().toUpperCase();
    if (['OPEN'].includes(normalized)) return 1;
    if (['PARTIAL', 'PARTIALLY_CLOSED'].includes(normalized)) return 2;
    if (['CLOSED'].includes(normalized)) return 3;
    if (['LIQUIDATED'].includes(normalized)) return 4;
    return 0;
  }

  private normalizePositionStatus(status: string | null): string | null {
    const raw = String(status || '').trim();
    if (!raw) return null;
    const normalized = raw.toUpperCase();

    if (['OPEN'].includes(normalized)) return 'OPEN';
    if (['CLOSED', 'CLOSE'].includes(normalized)) return 'CLOSED';
    if (['LIQUIDATED', 'LIQUIDATION'].includes(normalized)) return 'LIQUIDATED';
    if (['PARTIAL', 'PARTIALLY_CLOSED', 'PARTIALLY_CLOSED_POSITION'].includes(normalized)) return 'PARTIAL';

    return normalized;
  }

  private buildPositionSyntheticId(position: Record<string, unknown>): string {
    const symbol = String(position.symbol || '').trim().toUpperCase();
    const status = String(position.status || '').trim().toUpperCase();
    const createdAt = String(position.created_at || '').trim();
    return [symbol || 'NA', status || 'NA', createdAt || 'NA'].join(':');
  }

  // ── Checkpoint management ────────────────────────────────────

  private async ensureCheckpointTable(): Promise<void> {
    await coreDataSource.query(`
      CREATE TABLE IF NOT EXISTS scheduler_sync_checkpoints (
        id char(36) NOT NULL,
        scheduler_key varchar(100) NOT NULL,
        account_id char(36) NOT NULL,
        checkpoint_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_sync_checkpoint (scheduler_key, account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);
  }

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

  // ── Deduplication ────────────────────────────────────────────

  private deduplicateByExternalId(items: unknown[], brokerKey: string): unknown[] {
    const map = new Map<string, { item: unknown; rank: number }>();
    const brokerKeyLower = String(brokerKey || '').trim().toLowerCase();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const mudrexExternalId =
        brokerKeyLower === 'mudrex' ? this.buildMudrexPositionExternalId(brokerKeyLower, rec) : null;
      const id =
        mudrexExternalId ||
        String(rec.id || '').trim() ||
        this.buildPositionSyntheticId(rec);
      if (!id) continue;
      const status = this.normalizePositionStatus(String(rec.status || '').trim() || null);
      const rank = this.computePositionStatusRank(status || '');
      const existing = map.get(id);
      if (!existing || rank >= existing.rank) {
        map.set(id, { item, rank });
      }
    }
    return Array.from(map.values()).map((e) => e.item);
  }

  // ── Row building ─────────────────────────────────────────────

  private buildPositionRow(
    userId: string,
    accountId: string,
    brokerKey: string,
    item: Record<string, unknown>
  ): {
    userId: string;
    accountId: string;
    brokerKey: string;
    externalId: string;
    legacyExternalId?: string | null;
    symbol: string | null;
    status: string | null;
    statusRank: number;
    payloadJson: string;
    payloadHash: string;
  } | null {
    const rawExternalId = String(item.id || '').trim();
    const mudrexExternalId = this.buildMudrexPositionExternalId(brokerKey, item);
    const externalId = mudrexExternalId || rawExternalId || this.buildPositionSyntheticId(item);
    if (!externalId) return null;
    const symbol = String(item.symbol || '').trim() || null;
    const status = this.normalizePositionStatus(String(item.status || '').trim() || null);
    const statusRank = this.computePositionStatusRank(status || '');
    this.normalizePositionPayloadTimestamps(item, status);
    const payloadJson = JSON.stringify(item);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    return {
      userId,
      accountId,
      brokerKey,
      externalId,
      legacyExternalId: mudrexExternalId && rawExternalId && mudrexExternalId !== rawExternalId
        ? rawExternalId
        : null,
      symbol,
      status,
      statusRank,
      payloadJson,
      payloadHash,
    };
  }

  private normalizePositionPayloadTimestamps(
    item: Record<string, unknown>,
    status: string | null
  ): void {
    if (!item) return;
    const closedAtRaw = item.closed_at ?? item.closedAt;
    const updatedAtRaw = item.updated_at ?? item.updatedAt;
    const closedAt = closedAtRaw ? new Date(String(closedAtRaw)) : null;
    if (closedAt && Number.isFinite(closedAt.getTime())) {
      const updatedAt = updatedAtRaw ? new Date(String(updatedAtRaw)) : null;
      if (!updatedAt || !Number.isFinite(updatedAt.getTime()) || closedAt > updatedAt) {
        item.updated_at = closedAt.toISOString();
      }
    }
    const normalized = String(status || '').trim().toUpperCase();
    if ((normalized === 'CLOSED' || normalized === 'LIQUIDATED') && item.closed_at && !item.updated_at) {
      item.updated_at = String(item.closed_at);
    }
  }

  private buildMudrexPositionExternalId(
    brokerKey: string,
    item: Record<string, unknown>
  ): string | null {
    if (String(brokerKey || '').trim().toLowerCase() !== 'mudrex') {
      return null;
    }
    const assetUuid = String(item.asset_uuid || '').trim();
    const createdAt = String(item.created_at || '').trim();
    const side = String(item.position_type || item.order_type || item.side || '').trim().toUpperCase();
    if (!assetUuid || !createdAt) {
      return null;
    }
    return `mudrex:${assetUuid}:${createdAt}:${side || 'NA'}`;
  }

  // ── Single forward-only upsert ───────────────────────────────

  private async upsertPositionSnapshotBatch(
    rows: Array<{
      userId: string;
      accountId: string;
      brokerKey: string;
      externalId: string;
      legacyExternalId?: string | null;
      symbol: string | null;
      status: string | null;
      statusRank: number;
      payloadJson: string;
      payloadHash: string;
    }>,
    runLogId?: string
  ): Promise<{ inserted: number; updated: number; skipped: number; symbols: string[] }> {
    if (rows.length === 0) return { inserted: 0, updated: 0, skipped: 0, symbols: [] };

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);

      for (const row of chunk) {
        if (row.legacyExternalId && row.legacyExternalId !== row.externalId) {
          await coreDataSource.query(
            `UPDATE scheduler_positions_snapshots
             SET external_id = ?
             WHERE user_id = ? AND account_id = ? AND external_id = ?`,
            [row.externalId, row.userId, row.accountId, row.legacyExternalId]
          );
        }
      }

      // Query existing external_ids and their current statuses before upsert
      const chunkExternalIds = chunk.map((r) => r.externalId);
      const existingRows = (await coreDataSource.query(
        `SELECT external_id, status, payload_hash, status_rank
         FROM scheduler_positions_snapshots
         WHERE user_id = ? AND account_id = ? AND external_id IN (${chunkExternalIds.map(() => '?').join(',')})`,
        [chunk[0].userId, chunk[0].accountId, ...chunkExternalIds]
      )) as Array<{ external_id: string; status: string | null; payload_hash: string | null; status_rank: number }>;

      const existingMap = new Map<string, { status: string | null; payloadHash: string | null; statusRank: number }>();
      for (const row of existingRows) {
        existingMap.set(row.external_id, {
          status: row.status,
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
          row.status,
          row.statusRank,
          row.payloadJson,
          row.payloadHash
        );
      }

      await coreDataSource.query(
        `INSERT INTO scheduler_positions_snapshots
           (id, user_id, account_id, broker_key, external_id, symbol,
            status, status_rank, payload_json, payload_hash,
            first_seen_at, last_seen_at, created_at, updated_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           last_seen_at = NOW(),
           broker_key = VALUES(broker_key),
           symbol = COALESCE(VALUES(symbol), symbol),
           status = IF(VALUES(status_rank) >= status_rank OR VALUES(status) = 'OPEN', VALUES(status), status),
           status_rank = IF(VALUES(status_rank) >= status_rank OR VALUES(status) = 'OPEN', VALUES(status_rank), status_rank),
           payload_json = IF(VALUES(status_rank) >= status_rank OR VALUES(status) = 'OPEN', VALUES(payload_json), payload_json),
           payload_hash = IF(VALUES(status_rank) >= status_rank OR VALUES(status) = 'OPEN', VALUES(payload_hash), payload_hash),
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
        } else if (row.statusRank < existing.statusRank && row.status !== 'OPEN') {
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
            message = row.status || 'UNKNOWN';
          } else if (row.payloadHash === existing.payloadHash) {
            actionType = 'skipped';
            message = 'payload unchanged';
          } else if (row.statusRank < existing.statusRank && row.status !== 'OPEN') {
            actionType = 'skipped';
            const existingStatusLabel = existing.status || 'UNKNOWN';
            const incomingStatusLabel = row.status || 'UNKNOWN';
            message = `status rank lower: ${existingStatusLabel}(${existing.statusRank}) > ${incomingStatusLabel}(${row.statusRank})`;
          } else {
            actionType = 'updated';
            message = existing.status !== row.status
              ? `status: ${existing.status || 'UNKNOWN'} → ${row.status || 'UNKNOWN'}`
              : `status: ${row.status || 'UNKNOWN'} (unchanged)`;
          }

          logEntries.push({
            runLogId,
            source: 'positions',
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
      symbols: Array.from(
        new Set(rows.map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean))
      ),
    };
  }

  private async upsertPositionSnapshotsFromItems(
    userId: string,
    accountId: string,
    brokerKey: string,
    items: unknown[],
    runLogId?: string
  ): Promise<{ inserted: number; updated: number; skipped: number; symbols: string[] }> {
    if (items.length === 0) return { inserted: 0, updated: 0, skipped: 0, symbols: [] };

    const prepared: Array<{
      userId: string;
      accountId: string;
      brokerKey: string;
      externalId: string;
      symbol: string | null;
      status: string | null;
      statusRank: number;
      payloadJson: string;
      payloadHash: string;
    }> = [];
    const readModelRows: PositionReadModelUpsert[] = [];

    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = this.buildPositionRow(userId, accountId, brokerKey, item as Record<string, unknown>);
      if (!row) continue;
      prepared.push(row);
      const readModelRow = buildPositionReadModelUpsert({
        userId,
        accountId,
        brokerKey,
        externalId: row.externalId,
        payload: item,
        payloadJson: row.payloadJson,
        payloadHash: row.payloadHash,
        statusRank: row.statusRank,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      });
      if (readModelRow) {
        readModelRows.push(readModelRow);
      }
    }

    const delta = await this.upsertPositionSnapshotBatch(prepared, runLogId);
    if (readModelRows.length) {
      await this.positionReadModelRepository.upsertReadModels(readModelRows);
    }
    return delta;
  }

  // ── Table DDL ────────────────────────────────────────────────

  private async ensureSyncPositionsSnapshotTable(): Promise<void> {
    await coreDataSource.query(`
      CREATE TABLE IF NOT EXISTS scheduler_positions_snapshots (
        id char(36) NOT NULL,
        user_id char(36) NOT NULL,
        account_id char(36) NOT NULL,
        broker_key varchar(100) NOT NULL,
        external_id varchar(191) NOT NULL,
        symbol varchar(100) NULL,
        status varchar(64) NULL,
        status_rank int NOT NULL DEFAULT 0,
        payload_json json NULL,
        payload_hash char(64) NULL,
        first_seen_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uidx_scheduler_positions_snapshot (user_id, account_id, external_id),
        KEY idx_scheduler_positions_last_seen (last_seen_at),
        KEY idx_scheduler_positions_user_account (user_id, account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
    `);

    // Backwards-compatible upgrade for older tables created before payload_hash existed.
    const hashRows = (await coreDataSource.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'scheduler_positions_snapshots'
         AND column_name = 'payload_hash'`
    )) as Array<{ count: number | string }>;
    const hasPayloadHash = Number(hashRows?.[0]?.count || 0) > 0;
    if (!hasPayloadHash) {
      await coreDataSource.query(
        `ALTER TABLE scheduler_positions_snapshots
         ADD COLUMN payload_hash char(64) NULL AFTER payload_json`
      );
    }

    // Backwards-compatible upgrade for older tables created before status_rank existed.
    const rankRows = (await coreDataSource.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'scheduler_positions_snapshots'
         AND column_name = 'status_rank'`
    )) as Array<{ count: number | string }>;
    const hasStatusRank = Number(rankRows?.[0]?.count || 0) > 0;
    if (!hasStatusRank) {
      await coreDataSource.query(
        `ALTER TABLE scheduler_positions_snapshots
         ADD COLUMN status_rank int NOT NULL DEFAULT 0 AFTER status`
      );
    }
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
      if (brokerKeyFilter.size > 0 && !brokerKeyFilter.has(String(account.brokerKey || '').toLowerCase())) {
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

  private async resolveExecutionUserIds(request: PositionsSyncRequest): Promise<string[]> {
    const executionScope = String(request.executionScope || '').trim().toLowerCase();
    if (executionScope === POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE) {
      const requestUserId = String(request.requestUserId || '').trim();
      if (!requestUserId) {
        throw new Error('Product-owned positions sync requests require requestUserId.');
      }
      return [requestUserId];
    }

    if (executionScope === POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE) {
      const systemUserId = String(env.scheduler.systemUserId || '').trim();
      if (!systemUserId) {
        throw new Error(
          'System scheduler positions sync requests require env.scheduler.systemUserId.'
        );
      }
      return [systemUserId];
    }

    return this.resolveTargetUserIds(request.targetUserIds);
  }

  // ── Main entry point ─────────────────────────────────────────

  async runBatch(request: PositionsSyncRequest): Promise<{
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
    await this.ensureSyncPositionsSnapshotTable();
    await this.ensureCheckpointTable();

    const now = new Date();
    const lookbackDays = Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.floor(Number(request.lookbackDays || MAX_LOOKBACK_DAYS))));
    const historyWindowDays =
      typeof request.historyWindowDays === 'number'
        ? Math.floor(request.historyWindowDays)
        : DEFAULT_WINDOW_DAYS;
    const forceBackfill = Boolean(request.backfill);

    const requestedUserIds = await this.resolveExecutionUserIds(request);
    const brokerKeys = this.normalizeBrokerKeys(request.brokerKeys);
    const brokerKeyFilter = new Set(brokerKeys);
    const accountIdFilter = new Set(
      (request.accountIds || []).map((item) => String(item || '').trim()).filter(Boolean)
    );
    const isInfraAllAccountsRequest =
      requestedUserIds.length === 1 && requestedUserIds[0] === env.scheduler.systemUserId;
    const accountGroups = isInfraAllAccountsRequest
      ? this.groupInfraAccountsByOwner(
          await this.brokerAccountRepository.getAllActiveBrokerAccounts(),
          brokerKeyFilter,
          accountIdFilter
        )
      : await Promise.all(
          requestedUserIds.map(async (userId) => {
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

            // Use MySQL's clock for stale-close comparison so both last_seen_at (set via NOW())
            // and this timestamp are from the same source — avoids JS/MySQL timezone mismatch.
            const [{ now: dbNow }] = (await coreDataSource.query('SELECT NOW() AS now')) as [{ now: Date }];
            const accountSyncStartedAt = dbNow;
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

            let openPositions: unknown[] = [];
            let openError: string | null = null;
            let historyPositions: unknown[] = [];
            let historyError: string | null = null;

            // Step 1: Always fetch open positions (lightweight, catches status changes fast)
            try {
              const openRaw = await this.brokerRuntimeRegistry
                .getPositionsAdapter(resolvedBrokerKey)
                .getPositions({ limit: SYNC_LIMIT }, route);
              openPositions = this.extractList(openRaw);
              await this.enrichOpenPositionsWithMarketPnl(openPositions);
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
            const startDateStr = request.startDate || this.formatIsoDate(historyStart);
            const endDateStr = request.endDate || this.formatIsoDate(historyEnd);

            try {
              const windows = this.buildDateWindows(startDateStr, endDateStr, historyWindowDays);
              const combinedHistory: unknown[] = [];
              for (const window of windows) {
                const historyRaw = await this.brokerRuntimeRegistry
                  .getPositionsAdapter(resolvedBrokerKey)
                  .getPositionHistory(
                    {
                      startDate: window.startDate || undefined,
                      endDate: window.endDate || undefined,
                      limit: String(SYNC_LIMIT),
                    },
                    route
                  );
                combinedHistory.push(...this.extractList(historyRaw));
              }
              historyPositions = combinedHistory;
            } catch (error) {
              historyError = error instanceof Error ? error.message : String(error);
            }

            if (openError && historyError) {
              throw new Error(
                `Open positions failed: ${openError}; Position history failed: ${historyError}`
              );
            }

            // Step 4: Deduplicate open + history in memory, keeping highest status rank
            const combined = [...openPositions, ...historyPositions];
            const deduped = this.deduplicateByExternalId(combined, resolvedBrokerKey);
            const affectedSymbols = new Set<string>();

            // Step 5: Single forward-only upsert
            const delta = await this.upsertPositionSnapshotsFromItems(
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
            for (const symbol of delta.symbols) {
              affectedSymbols.add(symbol);
            }

            // Step 6: Close stale open positions not seen in this run
            if (!openError) {
              const closeRank = this.computePositionStatusRank('CLOSED');

              // Query stale positions before closing (for logging and PnL computation)
              const stalePositions = (await coreDataSource.query(
                `SELECT id, external_id, symbol, status, payload_json
                 FROM scheduler_positions_snapshots
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
              )) as Array<{ id: string; external_id: string; symbol: string | null; status: string | null; payload_json: unknown }>;

              // Fetch closing fills from broker if adapter supports it
              let closingFills: Map<string, { closePrice: number; closedAt: string; fillType: string | null }> | undefined;
              if (stalePositions.length > 0) {
                const adapter = this.brokerRuntimeRegistry.getPositionsAdapter(resolvedBrokerKey);
                if (typeof adapter.getClosingFills === 'function') {
                  try {
                    const productIds = stalePositions.map((s) => s.external_id);
                    closingFills = await adapter.getClosingFills(productIds, route);
                  } catch {
                    // Fall back to mark_price if fills fetch fails
                  }
                }
              }

              // Close stale positions and compute PnL
              const staleReadModelRows: PositionReadModelUpsert[] = [];
              const staleReadModelIdsWithoutPayload: string[] = [];
              for (const stale of stalePositions) {
                const payload = this.parsePayloadJson(stale.payload_json);
                if (payload) {
                  payload.status = 'closed';
                  const entryPrice = this.toFiniteNumber(payload.entry_price);
                  const quantity = Math.abs(this.toFiniteNumber(payload.quantity) || this.toFiniteNumber(payload.size));
                  const side = String(payload.side || payload.position_type || '').toLowerCase();
                  const direction = (side === 'long' || side === 'buy') ? 1 : -1;

                  // Prefer close price from fills, fall back to mark_price
                  const fill = closingFills?.get(stale.external_id);
                  let closePrice: number;
                  if (fill) {
                    closePrice = fill.closePrice;
                    payload.closed_at = fill.closedAt;
                    if (fill.fillType) payload.fill_type = fill.fillType;
                  } else {
                    closePrice = this.toFiniteNumber(payload.mark_price) || this.toFiniteNumber(payload.closed_price);
                  }

                  if (entryPrice > 0 && closePrice > 0 && quantity > 0) {
                    const pnl = direction * (closePrice - entryPrice) * quantity;
                    payload.pnl = pnl;
                    payload.realized = pnl;
                    payload.closed_price = String(closePrice);
                  }

                  const updatedJson = JSON.stringify(payload);
                  const updatedHash = createHash('sha256').update(updatedJson).digest('hex');
                  await coreDataSource.query(
                    `UPDATE scheduler_positions_snapshots
                     SET status = 'CLOSED', status_rank = ?, payload_json = ?, payload_hash = ?, updated_at = NOW()
                     WHERE id = ?`,
                    [closeRank, updatedJson, updatedHash, stale.id]
                  );

                  const readModelRow = buildPositionReadModelUpsert({
                    userId,
                    accountId: resolvedAccountId,
                    brokerKey: resolvedBrokerKey.toLowerCase(),
                    externalId: stale.external_id,
                    payload,
                    payloadJson: updatedJson,
                    payloadHash: updatedHash,
                    statusRank: closeRank,
                    firstSeenAt: null,
                    lastSeenAt: accountSyncStartedAt,
                  });
                  if (readModelRow) {
                    staleReadModelRows.push(readModelRow);
                  }
                } else {
                  await coreDataSource.query(
                    `UPDATE scheduler_positions_snapshots
                     SET status = 'CLOSED', status_rank = ?, updated_at = NOW()
                     WHERE id = ?`,
                    [closeRank, stale.id]
                  );
                  staleReadModelIdsWithoutPayload.push(stale.external_id);
                }
              }
              if (staleReadModelRows.length) {
                await this.positionReadModelRepository.upsertReadModels(staleReadModelRows);
              }
              if (staleReadModelIdsWithoutPayload.length) {
                await this.positionReadModelRepository.markPositionsClosed(
                  userId,
                  resolvedAccountId,
                  resolvedBrokerKey.toLowerCase(),
                  staleReadModelIdsWithoutPayload,
                  accountSyncStartedAt
                );
              }
              const closedCount = stalePositions.length;
              updatedRecords += closedCount;

              // Log stale-closed positions
              if (request.runLogId && stalePositions.length > 0) {
                const closeLogEntries: QueryDeepPartialEntity<ExchangeAssetUpdateLog>[] = stalePositions.map((row) => ({
                  runLogId: request.runLogId,
                  source: 'positions',
                  accountId: resolvedAccountId,
                  actionType: 'updated',
                  symbol: row.symbol,
                  externalId: row.external_id,
                  message: `stale-closed: ${row.status || 'UNKNOWN'} → CLOSED`,
                }));
                await this.exchangeAssetUpdateLogRepository.createMany(closeLogEntries);
              }

              for (const row of stalePositions) {
                const symbol = String(row.symbol || '').trim().toUpperCase();
                if (symbol) {
                  affectedSymbols.add(symbol);
                }
              }
            }

            if (affectedSymbols.size > 0) {
              try {
                await this.suggestedTradesService.syncExecutionForPositionUpdates(
                  userId,
                  resolvedBrokerKey.toLowerCase(),
                  resolvedAccountId,
                  Array.from(affectedSymbols)
                );
              } catch (error) {
                failures.push({
                  userId,
                  error: `suggested trade position sync failed for account ${resolvedAccountId} (${resolvedBrokerKey}): ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                });
              }
            }

            // Step 7: Save checkpoint on success
            if (!historyError) {
              await this.saveCheckpoint(resolvedAccountId, historyEnd);
            }

            // Surface partial failures without failing the whole account sync.
            if (openError || historyError) {
              failures.push({
                userId,
                error: `positions sync partial failure for account ${resolvedAccountId} (${resolvedBrokerKey}): ${
                  openError ? `open error: ${openError}` : ''
                }${openError && historyError ? '; ' : ''}${historyError ? `history error: ${historyError}` : ''}`,
              });
            }
            hadCompletedAccount = true;
          } catch (error) {
            failedAccounts += 1;
            failures.push({
              userId,
              error: `positions sync failed for account ${String(account.id || '').trim()} (${String(
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
              ? 'All scoped broker accounts failed during positions sync'
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
      processedUsers: accountGroups.length || requestedUserIds.length,
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

    const actorUserId = env.scheduler.systemUserId || requestedUserIds[0] || '';
    const failed = failures.length;
    await this.operationalEventService.logActivity(actorUserId, {
      type: 'Scheduler run',
      title: 'Positions sync completed',
      status: failed > 0 ? 'Warning' : 'Success',
      route: 'Schedulers',
      stream: 'Runs',
      related: CHECKPOINT_SCHEDULER_KEY,
      description: `Processed ${accountGroups.length || requestedUserIds.length} user(s) in ${Date.now() - startedAt.getTime()}ms. ` +
        `Accounts processed=${processedAccounts}, inserted=${insertedRecords}, updated=${updatedRecords}, ` +
        `skipped=${skippedRecords}, failures=${failed}.`,
    });

    if (failed > 0) {
      await this.operationalEventService.emitFailureAlert(actorUserId, {
        channel: 'Scheduler',
        source: CHECKPOINT_SCHEDULER_KEY,
        message: `Positions sync completed with ${failed} failure(s) across ${failedAccounts} account(s).`,
        route: 'Schedulers',
        symbol: 'POSITIONS',
      });
    }

    return result;
  }
}
