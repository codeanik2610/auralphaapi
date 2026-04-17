import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskSnapshot } from '../entities/RiskSnapshot';

export interface ComputedRiskSnapshotPayload {
  portfolioRisk: string;
  breachedRules: number;
  liquidationWatch: number;
  capitalAtRisk: number;
  denominatorBasis: string;
  portfolioEquity: number;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
  marginUsage: string;
  drawdownBudgetUsed: string;
  weeklyDrawdownBudgetUsed: string;
  monthlyDrawdownBudgetUsed: string;
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
  fundsObservedAt: Date | null;
  positionsObservedAt: Date | null;
  ordersObservedAt: Date | null;
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
    const snapshot = await this.snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.userId = :userId', { userId })
      .orderBy('snapshot.createdAt', 'DESC')
      .getOne();

    if (!snapshot) {
      return null;
    }

    return this.hydrateOrderSummaryFields(snapshot);
  }

  async getSnapshotById(userId: string, snapshotId: string): Promise<RiskSnapshot | null> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return null;
    }

    const snapshot = await this.snapshotRepository.findOne({
      where: {
        id: normalizedSnapshotId,
        userId,
      },
    });

    if (!snapshot) {
      return null;
    }

    return this.hydrateOrderSummaryFields(snapshot);
  }

  async getPreviousSnapshot(
    userId: string,
    snapshot: Pick<RiskSnapshot, 'id' | 'createdAt'>
  ): Promise<RiskSnapshot | null> {
    const snapshotId = String(snapshot?.id || '').trim();
    if (!snapshotId || !(snapshot?.createdAt instanceof Date)) {
      return null;
    }

    const previousSnapshot = await this.snapshotRepository
      .createQueryBuilder('snapshot')
      .where('snapshot.userId = :userId', { userId })
      .andWhere('snapshot.id != :snapshotId', { snapshotId })
      .andWhere('snapshot.createdAt <= :createdAt', { createdAt: snapshot.createdAt })
      .orderBy('snapshot.createdAt', 'DESC')
      .addOrderBy('snapshot.id', 'DESC')
      .getOne();

    if (!previousSnapshot) {
      return null;
    }

    return this.hydrateOrderSummaryFields(previousSnapshot);
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
      denominatorBasis: payload.denominatorBasis,
      portfolioEquity: payload.portfolioEquity,
      grossExposure: payload.grossExposure,
      netExposure: payload.netExposure,
      longExposure: payload.longExposure,
      shortExposure: payload.shortExposure,
      openOrders: payload.openOrders,
      openOrderExposure: payload.openOrderExposure,
      reservedOrderMargin: payload.reservedOrderMargin,
      marginUsage: payload.marginUsage,
      drawdownBudgetUsed: payload.drawdownBudgetUsed,
      weeklyDrawdownBudgetUsed: payload.weeklyDrawdownBudgetUsed,
      monthlyDrawdownBudgetUsed: payload.monthlyDrawdownBudgetUsed,
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
      actionThree: payload.actionThree,
      fundsObservedAt: payload.fundsObservedAt,
      positionsObservedAt: payload.positionsObservedAt,
      ordersObservedAt: payload.ordersObservedAt,
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

  private async hydrateOrderSummaryFields(snapshot: RiskSnapshot): Promise<RiskSnapshot> {
    if (
      snapshot.openOrders !== undefined &&
      snapshot.openOrderExposure !== undefined &&
      snapshot.reservedOrderMargin !== undefined
    ) {
      return snapshot;
    }

    const rows = (await coreDataSource.query(
      `SELECT open_orders AS openOrders,
              open_order_exposure AS openOrderExposure,
              reserved_order_margin AS reservedOrderMargin
         FROM risk_snapshots
        WHERE id = ?
        LIMIT 1`,
      [snapshot.id]
    )) as Array<{
      openOrders?: number | string | null;
      openOrderExposure?: number | string | null;
      reservedOrderMargin?: number | string | null;
    }>;

    const row = rows[0];
    if (!row) {
      return snapshot;
    }

    snapshot.openOrders = Number(row.openOrders || 0);
    snapshot.openOrderExposure = Number(row.openOrderExposure || 0);
    snapshot.reservedOrderMargin = Number(row.reservedOrderMargin || 0);
    return snapshot;
  }
}
