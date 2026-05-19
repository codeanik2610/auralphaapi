import { createHash } from 'node:crypto';
import { Service } from 'typedi';
import { coreDataSource } from '../data-source';

const ORDER_SNAPSHOT_UPSERT_CHUNK_SIZE = 100;

export interface OpenOrderSnapshotSourceRow {
  accountId: string;
  externalId: string;
  statusRank: number;
  payloadJson: unknown;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface OrderSnapshotSourceRow {
  accountId: string;
  brokerKey: string;
  externalId: string;
  orderStatus: string | null;
  statusRank: number | null;
  payloadJson: Record<string, unknown> | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface OrderSnapshotUpsertResult {
  inserted: number;
  updated: number;
  skipped: number;
  orderIds: string[];
}

@Service()
export class OrdersSnapshotSourceRepository {
  async upsertOrderSnapshots(
    userId: string,
    accountId: string,
    brokerKey: string,
    items: unknown[]
  ): Promise<OrderSnapshotUpsertResult> {
    const normalizedUserId = String(userId || '').trim();
    const normalizedAccountId = String(accountId || '').trim();
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    if (!normalizedUserId || !normalizedAccountId || !normalizedBrokerKey || !items.length) {
      return { inserted: 0, updated: 0, skipped: 0, orderIds: [] };
    }

    const rows = items
      .map((item) =>
        this.buildOrderSnapshotUpsertRow(
          normalizedUserId,
          normalizedAccountId,
          normalizedBrokerKey,
          item
        )
      )
      .filter(
        (
          row
        ): row is {
          userId: string;
          accountId: string;
          brokerKey: string;
          externalId: string;
          symbol: string | null;
          orderStatus: string | null;
          statusRank: number;
          payloadJson: string;
          payloadHash: string;
        } => Boolean(row)
      );
    if (!rows.length) {
      return { inserted: 0, updated: 0, skipped: 0, orderIds: [] };
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += ORDER_SNAPSHOT_UPSERT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + ORDER_SNAPSHOT_UPSERT_CHUNK_SIZE);
      const externalIds = chunk.map((row) => row.externalId);
      const existingRows = (await coreDataSource.query(
        `SELECT external_id AS externalId, order_status AS orderStatus, payload_hash AS payloadHash, status_rank AS statusRank
           FROM scheduler_orders_snapshots
          WHERE user_id = ?
            AND account_id = ?
            AND external_id IN (${externalIds.map(() => '?').join(', ')})`,
        [normalizedUserId, normalizedAccountId, ...externalIds]
      )) as Array<{
        externalId?: string | null;
        orderStatus?: string | null;
        payloadHash?: string | null;
        statusRank?: number | string | null;
      }>;
      const existingEntries = existingRows
        .map(
          (
            row
          ):
            | [
                string,
                { orderStatus: string | null; payloadHash: string | null; statusRank: number },
              ]
            | null => {
            const externalId = String(row.externalId || '').trim();
            if (!externalId) {
              return null;
            }
            return [
              externalId,
              {
                orderStatus: row.orderStatus ?? null,
                payloadHash: row.payloadHash ?? null,
                statusRank:
                  row.statusRank === undefined || row.statusRank === null
                    ? 0
                    : Number(row.statusRank),
              },
            ];
          }
        )
        .filter(
          (
            entry
          ): entry is [
            string,
            { orderStatus: string | null; payloadHash: string | null; statusRank: number },
          ] => Boolean(entry)
        );
      const existingById = new Map(existingEntries);

      const placeholders = chunk
        .map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), NOW())')
        .join(', ');
      const params: unknown[] = [];
      chunk.forEach((row) => {
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
      });

      await coreDataSource.query(
        `INSERT INTO scheduler_orders_snapshots
           (id, user_id, account_id, broker_key, external_id, symbol,
            order_status, status_rank, payload_json, payload_hash,
            first_seen_at, last_seen_at, created_at, updated_at)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           last_seen_at = NOW(),
           updated_at = IF(
             VALUES(status_rank) >= status_rank
             AND NOT (VALUES(payload_hash) <=> payload_hash),
             NOW(),
             updated_at
           ),
           broker_key = VALUES(broker_key),
           symbol = COALESCE(VALUES(symbol), symbol),
           order_status = IF(VALUES(status_rank) >= status_rank, VALUES(order_status), order_status),
           status_rank = GREATEST(status_rank, VALUES(status_rank)),
           payload_json = IF(VALUES(status_rank) >= status_rank, VALUES(payload_json), payload_json),
           payload_hash = IF(VALUES(status_rank) >= status_rank, VALUES(payload_hash), payload_hash)`,
        params
      );

      chunk.forEach((row) => {
        const existing = existingById.get(row.externalId);
        if (!existing) {
          inserted += 1;
        } else if (row.payloadHash === existing.payloadHash) {
          skipped += 1;
        } else if (row.statusRank < existing.statusRank) {
          skipped += 1;
        } else {
          updated += 1;
        }
      });
    }

    return {
      inserted,
      updated,
      skipped,
      orderIds: Array.from(new Set(rows.map((row) => row.externalId))),
    };
  }

  async findOrderByExternalId(
    userId: string,
    brokerKey: string,
    accountId: string,
    externalId: string
  ): Promise<OrderSnapshotSourceRow | null> {
    const normalizedBrokerKey = String(brokerKey || '')
      .trim()
      .toLowerCase();
    const normalizedAccountId = String(accountId || '').trim();
    const normalizedExternalId = String(externalId || '').trim();

    if (!normalizedBrokerKey || !normalizedAccountId || !normalizedExternalId) {
      return null;
    }

    const rows = (await coreDataSource.query(
      `SELECT account_id AS accountId,
              broker_key AS brokerKey,
              external_id AS externalId,
              order_status AS orderStatus,
              status_rank AS statusRank,
              payload_json AS payloadJson,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
         FROM scheduler_orders_snapshots
        WHERE user_id = ?
          AND account_id = ?
          AND LOWER(broker_key) = ?
          AND external_id = ?
        LIMIT 1`,
      [userId, normalizedAccountId, normalizedBrokerKey, normalizedExternalId]
    )) as Array<{
      accountId?: string;
      brokerKey?: string;
      externalId?: string;
      orderStatus?: string | null;
      statusRank?: number | string | null;
      payloadJson?: unknown;
      firstSeenAt?: Date | string | null;
      lastSeenAt?: Date | string | null;
    }>;

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      accountId: String(row.accountId || '').trim(),
      brokerKey: String(row.brokerKey || '').trim(),
      externalId: String(row.externalId || '').trim(),
      orderStatus: row.orderStatus ?? null,
      statusRank:
        row.statusRank === undefined || row.statusRank === null ? null : Number(row.statusRank),
      payloadJson: this.parsePayloadRecord(row.payloadJson),
      firstSeenAt: this.toDate(row.firstSeenAt),
      lastSeenAt: this.toDate(row.lastSeenAt),
    };
  }

  async listOpenOrdersForAccounts(
    userId: string,
    accountIds: string[]
  ): Promise<Map<string, OpenOrderSnapshotSourceRow[]>> {
    const normalizedAccountIds = Array.from(
      new Set(accountIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (!normalizedAccountIds.length) {
      return new Map();
    }

    const rows = (await coreDataSource.query(
      `SELECT account_id AS accountId,
              external_id AS externalId,
              status_rank AS statusRank,
              payload_json AS payloadJson,
              first_seen_at AS firstSeenAt,
              last_seen_at AS lastSeenAt
         FROM scheduler_orders_snapshots
        WHERE user_id = ?
          AND account_id IN (${normalizedAccountIds.map(() => '?').join(', ')})
          AND status_rank > 0
          AND status_rank <= 2
          AND ${this.clearedPartialFillRemainderExclusionSql('scheduler_orders_snapshots')}
        ORDER BY last_seen_at DESC, external_id ASC`,
      [userId, ...normalizedAccountIds]
    )) as Array<{
      accountId?: string;
      externalId?: string;
      statusRank?: number | string | null;
      payloadJson?: unknown;
      firstSeenAt?: Date | string | null;
      lastSeenAt?: Date | string | null;
    }>;

    const grouped = new Map<string, OpenOrderSnapshotSourceRow[]>();
    rows.forEach((row) => {
      const accountId = String(row.accountId || '').trim();
      if (!accountId) {
        return;
      }
      if (!grouped.has(accountId)) {
        grouped.set(accountId, []);
      }
      grouped.get(accountId)?.push({
        accountId,
        externalId: String(row.externalId || '').trim(),
        statusRank: Number(row.statusRank || 0),
        payloadJson: row.payloadJson,
        firstSeenAt: this.toDate(row.firstSeenAt),
        lastSeenAt: this.toDate(row.lastSeenAt),
      });
    });

    return grouped;
  }

  private clearedPartialFillRemainderExclusionSql(ordersAlias: string): string {
    return `NOT EXISTS (
            SELECT 1
              FROM suggested_trade_executions cleared_execution
             WHERE cleared_execution.user_id = ${ordersAlias}.user_id
               AND COALESCE(cleared_execution.account_id, '') = COALESCE(${ordersAlias}.account_id, '')
               AND LOWER(COALESCE(cleared_execution.broker_key, '')) = LOWER(COALESCE(${ordersAlias}.broker_key, ''))
               AND COALESCE(cleared_execution.order_id, '') = COALESCE(${ordersAlias}.external_id, '')
               AND UPPER(COALESCE(cleared_execution.order_status, '')) IN ('PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL')
               AND cleared_execution.remaining_quantity IS NOT NULL
               AND cleared_execution.remaining_quantity <= 0
               AND cleared_execution.canceled_at IS NOT NULL
          )`;
  }

  private parsePayloadRecord(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }
    if (typeof value === 'string') {
      try {
        return this.parsePayloadRecord(JSON.parse(value) as unknown);
      } catch {
        return null;
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private buildOrderSnapshotUpsertRow(
    userId: string,
    accountId: string,
    brokerKey: string,
    item: unknown
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
    const record = this.parsePayloadRecord(item);
    if (!record) {
      return null;
    }
    const externalId = this.readString(
      record.id ?? record.external_id ?? record.externalId ?? record.order_id ?? record.orderId
    );
    if (!externalId) {
      return null;
    }
    const symbol =
      this.readString(record.symbol ?? record.product_symbol ?? record.productSymbol) || null;
    const orderStatus = this.normalizeOrderStatus(
      this.readString(record.status ?? record.state ?? record.order_status ?? record.orderStatus) ||
        null
    );
    const statusRank = this.computeOrderStatusRank(orderStatus || '');
    const payloadJson = JSON.stringify(record);
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

  private readString(value: unknown): string {
    return String(value ?? '').trim();
  }

  private normalizeOrderStatus(status: string | null): string | null {
    const raw = String(status || '').trim();
    if (!raw) {
      return null;
    }
    const normalized = raw.toUpperCase();
    if (['OPEN', 'NEW', 'CREATED'].includes(normalized)) return 'OPEN';
    if (['PENDING', 'TRIGGER_PENDING'].includes(normalized)) return 'PENDING';
    if (['PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL'].includes(normalized)) {
      return 'PARTIALLY_FILLED';
    }
    if (['FILLED', 'COMPLETED', 'EXECUTED'].includes(normalized)) return 'FILLED';
    if (['CANCELLED', 'CANCELED'].includes(normalized)) return 'CANCELLED';
    if (['CLOSED'].includes(normalized)) return 'CLOSED';
    if (['REJECTED'].includes(normalized)) return 'REJECTED';
    if (['EXPIRED'].includes(normalized)) return 'EXPIRED';
    if (['FAILED'].includes(normalized)) return 'FAILED';
    return normalized;
  }

  private computeOrderStatusRank(status: string): number {
    const normalized = String(status || '')
      .trim()
      .toUpperCase();
    if (['OPEN', 'PENDING'].includes(normalized)) return 1;
    if (['PARTIALLY_FILLED', 'PARTIAL_FILLED', 'PARTIAL', 'TRIGGER_PENDING'].includes(normalized)) {
      return 2;
    }
    if (['FILLED', 'COMPLETED', 'EXECUTED'].includes(normalized)) return 3;
    if (['CLOSED', 'CANCELLED', 'CANCELED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(normalized)) {
      return 4;
    }
    return 0;
  }

  private toDate(value: Date | string | null | undefined): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
