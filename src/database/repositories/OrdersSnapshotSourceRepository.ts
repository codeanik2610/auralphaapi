import { Service } from 'typedi';
import { coreDataSource } from '../data-source';

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

@Service()
export class OrdersSnapshotSourceRepository {
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
