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

@Service()
export class OrdersSnapshotSourceRepository {
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
