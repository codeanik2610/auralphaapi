import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { coreDataSource } from '../data-source';

export interface RiskControlsQuery {
  limit: number;
  offset: number;
  status?: string;
  scope?: string;
}

export interface RiskControlRow {
  id: string;
  snapshotId: string;
  bucket: string;
  exposure: string;
  threshold: string;
  status: string;
  action: string;
  createdAt: Date;
}

export interface ComputedRiskControlPayload {
  bucket: string;
  exposure: string;
  threshold: string;
  status: string;
  action: string;
}

@Service()
export class RiskControlRepository {
  async createComputedControls(
    userId: string,
    snapshotId: string,
    items: ComputedRiskControlPayload[]
  ): Promise<number> {
    const normalizedItems = items.filter(
      (item) =>
        String(item.bucket || '').trim() &&
        String(item.exposure || '').trim() &&
        String(item.threshold || '').trim() &&
        String(item.status || '').trim() &&
        String(item.action || '').trim()
    );

    if (!normalizedItems.length) {
      return 0;
    }

    const placeholders = normalizedItems.map(() => '(?, ?, ?, ?, ?, ?, ?, NOW(), NOW())').join(', ');
    const params: Array<string> = [];

    normalizedItems.forEach((item) => {
      params.push(
        randomUUID(),
        snapshotId,
        userId,
        String(item.bucket).trim(),
        String(item.exposure).trim(),
        String(item.threshold).trim(),
        String(item.status).trim(),
        String(item.action).trim()
      );
    });

    await coreDataSource.query(
      `INSERT INTO risk_controls (
         id,
         snapshotId,
         user_id,
         bucket,
         exposure,
         threshold,
         status,
         action,
         createdAt,
         updatedAt
       ) VALUES ${placeholders}`,
      params
    );

    return normalizedItems.length;
  }

  async listRiskControls(userId: string, query: RiskControlsQuery): Promise<{
    items: RiskControlRow[];
    total: number;
  }> {
    const clauses = ['user_id = ?'];
    const params: Array<string | number> = [userId];

    if (query.status) {
      clauses.push('LOWER(status) = ?');
      params.push(query.status.trim().toLowerCase());
    }
    if (query.scope) {
      clauses.push('LOWER(bucket) = ?');
      params.push(query.scope.trim().toLowerCase());
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await coreDataSource.query(
      `SELECT id, snapshotId, bucket, exposure, threshold, status, action, createdAt
       FROM risk_controls
       ${whereClause}
       ORDER BY createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, query.limit, query.offset]
    );

    const totalRows = await coreDataSource.query(
      `SELECT COUNT(*) as total FROM risk_controls ${whereClause}`,
      params
    );

    const total = Number(totalRows?.[0]?.total || 0);

    return {
      items: (rows || []) as RiskControlRow[],
      total
    };
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
         FROM risk_controls
        WHERE user_id IN (${normalizedUserIds.map(() => '?').join(', ')})`,
      normalizedUserIds
    );

    const value = rows?.[0]?.latestCreatedAt;
    const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }
}
