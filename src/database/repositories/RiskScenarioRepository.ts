import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { coreDataSource } from '../data-source';

export interface RiskScenariosQuery {
  limit: number;
  offset: number;
  status?: string;
  scope?: string;
}

export interface RiskScenarioRow {
  id: string;
  snapshotId: string;
  scenario: string;
  impact: string;
  commentary: string;
  createdAt: Date;
}

export interface ComputedRiskScenarioPayload {
  scenario: string;
  impact: string;
  commentary: string;
}

@Service()
export class RiskScenarioRepository {
  async createComputedScenarios(
    userId: string,
    snapshotId: string,
    items: ComputedRiskScenarioPayload[]
  ): Promise<number> {
    const normalizedItems = items.filter(
      (item) =>
        String(item.scenario || '').trim() &&
        String(item.impact || '').trim() &&
        String(item.commentary || '').trim()
    );

    if (!normalizedItems.length) {
      return 0;
    }

    const placeholders = normalizedItems.map(() => '(?, ?, ?, ?, ?, NOW(), NOW())').join(', ');
    const params: string[] = [];

    normalizedItems.forEach((item) => {
      params.push(
        randomUUID(),
        snapshotId,
        userId,
        String(item.scenario).trim(),
        String(item.impact).trim(),
        String(item.commentary).trim()
      );
    });

    await coreDataSource.query(
      `INSERT INTO risk_scenarios (
         id,
         snapshotId,
         user_id,
         scenario,
         impact,
         commentary,
         createdAt,
         updatedAt
       ) VALUES ${placeholders}`,
      params
    );

    return normalizedItems.length;
  }

  async listRiskScenarios(userId: string, query: RiskScenariosQuery): Promise<{
    items: RiskScenarioRow[];
    total: number;
  }> {
    const clauses = ['user_id = ?'];
    const params: Array<string | number> = [userId];

    if (query.status) {
      clauses.push('LOWER(impact) = ?');
      params.push(query.status.trim().toLowerCase());
    }
    if (query.scope) {
      clauses.push('LOWER(scenario) = ?');
      params.push(query.scope.trim().toLowerCase());
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = await coreDataSource.query(
      `SELECT id, snapshotId, scenario, impact, commentary, createdAt
       FROM risk_scenarios
       ${whereClause}
       ORDER BY createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, query.limit, query.offset]
    );

    const totalRows = await coreDataSource.query(
      `SELECT COUNT(*) as total FROM risk_scenarios ${whereClause}`,
      params
    );

    const total = Number(totalRows?.[0]?.total || 0);

    return {
      items: (rows || []) as RiskScenarioRow[],
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
         FROM risk_scenarios
        WHERE user_id IN (${normalizedUserIds.map(() => '?').join(', ')})`,
      normalizedUserIds
    );

    const value = rows?.[0]?.latestCreatedAt;
    const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }
}
