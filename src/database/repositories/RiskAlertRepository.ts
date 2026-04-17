import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { coreDataSource } from '../data-source';

export interface RiskAlertsQuery {
  limit: number;
  offset: number;
  status?: string;
  scope?: string;
}

export interface RiskAlertRow {
  id: string;
  snapshotId: string;
  severity: string;
  message: string;
  symbol: string;
  channel?: string | null;
  status?: string | null;
  createdAt: Date;
}

export interface ComputedRiskAlertPayload {
  severity: string;
  message: string;
  symbol: string;
  channel?: string | null;
  status?: string | null;
}

@Service()
export class RiskAlertRepository {
  async createComputedAlerts(
    userId: string,
    snapshotId: string,
    items: ComputedRiskAlertPayload[]
  ): Promise<number> {
    const normalizedItems = items.filter(
      (item) =>
        String(item.severity || '').trim() &&
        String(item.message || '').trim() &&
        String(item.symbol || '').trim()
    );

    if (!normalizedItems.length) {
      return 0;
    }

    const placeholders = normalizedItems
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())')
      .join(', ');
    const params: Array<string | null> = [];

    normalizedItems.forEach((item) => {
      params.push(
        randomUUID(),
        snapshotId,
        userId,
        String(item.severity).trim(),
        String(item.message).trim(),
        String(item.symbol).trim(),
        item.channel ? String(item.channel).trim() : null,
        item.status ? String(item.status).trim() : null
      );
    });

    await coreDataSource.query(
      `INSERT INTO risk_alerts (
         id,
         snapshotId,
         user_id,
         severity,
         message,
         symbol,
         channel,
         status,
         createdAt,
         updatedAt
       ) VALUES ${placeholders}`,
      params
    );

    return normalizedItems.length;
  }

  async listRiskAlerts(userId: string, query: RiskAlertsQuery): Promise<{
    items: RiskAlertRow[];
    total: number;
  }> {
    const clauses = ['user_id = ?'];
    const params: Array<string | number> = [userId];

    if (query.status) {
      clauses.push('LOWER(status) = ?');
      params.push(query.status.trim().toLowerCase());
    }
    if (query.scope) {
      clauses.push('LOWER(channel) = ?');
      params.push(query.scope.trim().toLowerCase());
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await coreDataSource.query(
      `SELECT id, snapshotId, severity, message, symbol, channel, status, createdAt
       FROM risk_alerts
       ${whereClause}
       ORDER BY createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, query.limit, query.offset]
    );

    const totalRows = await coreDataSource.query(
      `SELECT COUNT(*) as total FROM risk_alerts ${whereClause}`,
      params
    );

    const total = Number(totalRows?.[0]?.total || 0);

    return {
      items: (rows || []) as RiskAlertRow[],
      total
    };
  }

  async listBySnapshotId(userId: string, snapshotId: string): Promise<RiskAlertRow[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    const rows = await coreDataSource.query(
      `SELECT id, snapshotId, severity, message, symbol, channel, status, createdAt
         FROM risk_alerts
        WHERE user_id = ?
          AND snapshotId = ?
        ORDER BY createdAt DESC, id DESC`,
      [userId, normalizedSnapshotId]
    );

    return (rows || []) as RiskAlertRow[];
  }

  async getRiskAlertsSummary(userId: string, query: RiskAlertsQuery): Promise<{
    total: number;
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
  }> {
    const clauses = ['user_id = ?'];
    const params: Array<string | number> = [userId];

    if (query.status) {
      clauses.push('LOWER(status) = ?');
      params.push(query.status.trim().toLowerCase());
    }
    if (query.scope) {
      clauses.push('LOWER(channel) = ?');
      params.push(query.scope.trim().toLowerCase());
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [totalRows, severityRows, statusRows] = await Promise.all([
      coreDataSource.query(
        `SELECT COUNT(*) as total FROM risk_alerts ${whereClause}`,
        params
      ),
      coreDataSource.query(
        `SELECT severity, COUNT(*) as total FROM risk_alerts ${whereClause} GROUP BY severity`,
        params
      ),
      coreDataSource.query(
        `SELECT status, COUNT(*) as total FROM risk_alerts ${whereClause} GROUP BY status`,
        params
      )
    ]);

    const total = Number(totalRows?.[0]?.total || 0);
    const bySeverity = (severityRows || []).reduce((acc: Record<string, number>, row: { severity?: unknown; total?: unknown }) => {
      const key = String(row?.severity || '').trim();
      if (!key) return acc;
      acc[key] = Number(row?.total || 0);
      return acc;
    }, {} as Record<string, number>);
    const byStatus = (statusRows || []).reduce((acc: Record<string, number>, row: { status?: unknown; total?: unknown }) => {
      const key = String(row?.status || '').trim();
      if (!key) return acc;
      acc[key] = Number(row?.total || 0);
      return acc;
    }, {} as Record<string, number>);

    return { total, bySeverity, byStatus };
  }

  async getLatestCreatedAtForUsers(userIds: string[]): Promise<Date | null> {
    const normalizedUserIds = Array.from(
      new Set(userIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (!normalizedUserIds.length) {
      return null;
    }

    const rows = await coreDataSource.query(
      `SELECT MAX(createdAt) AS latestCreatedAt
         FROM risk_alerts
        WHERE user_id IN (${normalizedUserIds.map(() => '?').join(', ')})`,
      normalizedUserIds
    );

    const value = rows?.[0]?.latestCreatedAt;
    const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }
}
