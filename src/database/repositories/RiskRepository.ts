import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskSnapshot } from '../entities/RiskSnapshot';

export interface ComputedRiskSnapshotPayload {
  portfolioRisk: string;
  breachedRules: number;
  liquidationWatch: number;
  capitalAtRisk: number;
  marginUsage: string;
  drawdownBudgetUsed: string;
  atRiskPositions: number;
  ruleViolations: number;
  portfolioRiskScore: string;
  primaryConcern: string;
  riskByPosition: string;
  riskByStrategy: string;
  riskByGuardrail: string;
  guardrailOne: string;
  guardrailTwo: string;
  guardrailThree: string;
  actionOne: string;
  actionTwo: string;
  actionThree: string;
}

export interface LatestRiskSnapshotRow {
  userId: string;
  snapshotId: string;
  createdAt: Date;
}

@Service()
export class RiskRepository {
  private get snapshotRepository(): Repository<RiskSnapshot> {
    return coreDataSource.getRepository(RiskSnapshot);
  }

  async getLatestSnapshot(userId: string): Promise<RiskSnapshot | null> {
    return this.snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.userId = :userId', { userId })
      .orderBy('snapshot.createdAt', 'DESC')
      .getOne();
  }

  async createComputedSnapshot(
    userId: string,
    payload: ComputedRiskSnapshotPayload
  ): Promise<RiskSnapshot> {
    const created = this.snapshotRepository.create({
      userId,
      portfolioRisk: payload.portfolioRisk,
      breachedRules: payload.breachedRules,
      liquidationWatch: payload.liquidationWatch,
      capitalAtRisk: payload.capitalAtRisk,
      marginUsage: payload.marginUsage,
      drawdownBudgetUsed: payload.drawdownBudgetUsed,
      atRiskPositions: payload.atRiskPositions,
      ruleViolations: payload.ruleViolations,
      portfolioRiskScore: payload.portfolioRiskScore,
      primaryConcern: payload.primaryConcern,
      riskByPosition: payload.riskByPosition,
      riskByStrategy: payload.riskByStrategy,
      riskByGuardrail: payload.riskByGuardrail,
      guardrailOne: payload.guardrailOne,
      guardrailTwo: payload.guardrailTwo,
      guardrailThree: payload.guardrailThree,
      actionOne: payload.actionOne,
      actionTwo: payload.actionTwo,
      actionThree: payload.actionThree
    });
    await this.snapshotRepository.save(created);

    return this.getLatestSnapshot(userId) as Promise<RiskSnapshot>;
  }

  async listLatestSnapshotsForUsers(userIds: string[]): Promise<Map<string, LatestRiskSnapshotRow>> {
    const normalizedUserIds = Array.from(
      new Set(userIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (!normalizedUserIds.length) {
      return new Map();
    }

    const placeholders = normalizedUserIds.map(() => '?').join(', ');
    const rows = (await coreDataSource.query(
      `SELECT snapshot.user_id AS userId,
              snapshot.id AS snapshotId,
              snapshot.createdAt AS createdAt
         FROM risk_snapshots snapshot
         INNER JOIN (
           SELECT user_id AS userId, MAX(createdAt) AS latestCreatedAt
             FROM risk_snapshots
            WHERE user_id IN (${placeholders})
            GROUP BY user_id
         ) latest
           ON latest.userId = snapshot.user_id
          AND latest.latestCreatedAt = snapshot.createdAt
        WHERE snapshot.user_id IN (${placeholders})
        ORDER BY snapshot.createdAt DESC`,
      [...normalizedUserIds, ...normalizedUserIds]
    )) as Array<{
      userId?: string;
      snapshotId?: string;
      createdAt?: Date | string | null;
    }>;

    const byUserId = new Map<string, LatestRiskSnapshotRow>();
    rows.forEach((row) => {
      const userId = String(row.userId || '').trim();
      if (!userId || byUserId.has(userId)) {
        return;
      }
      const createdAt =
        row.createdAt instanceof Date ? row.createdAt : row.createdAt ? new Date(String(row.createdAt)) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) {
        return;
      }
      byUserId.set(userId, {
        userId,
        snapshotId: String(row.snapshotId || '').trim(),
        createdAt,
      });
    });

    return byUserId;
  }
}
