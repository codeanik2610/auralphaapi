import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskAccountSnapshot } from '../entities/RiskAccountSnapshot';

export interface ComputedRiskAccountSnapshotPayload {
  brokerKey: string;
  accountId: string;
  accountName: string;
  denominatorBasis: string;
  walletBalance: number | null;
  futuresBalance: number | null;
  trackedBalance: number | null;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
  marginUsagePct: number;
  portfolioConcentrationPct: number;
  dailyLossUsagePct: number;
  unrealizedPnl: number;
  openPositions: number;
  maxPositionLeverage: number | null;
  closestLiquidationDistancePct: number | null;
  marginUsageWarnPct: number;
  marginUsageCriticalPct: number;
  concentrationWarnPct: number;
  concentrationCriticalPct: number;
  dailyLossLimitPct: number;
  weeklyLossLimitPct: number;
  monthlyLossLimitPct: number;
  maxLeverage: number;
  maxTotalAllocation: number;
  maxAvgLeverage: number;
  fundsObservedAt: Date | null;
  positionsObservedAt: Date | null;
  ordersObservedAt: Date | null;
}

@Service()
export class RiskAccountSnapshotRepository {
  private get accountSnapshotRepository(): Repository<RiskAccountSnapshot> {
    return coreDataSource.getRepository(RiskAccountSnapshot);
  }

  async createComputedAccountSnapshots(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskAccountSnapshotPayload[]
  ): Promise<number> {
    if (!payloads.length) {
      return 0;
    }

    const created = this.accountSnapshotRepository.create(
      payloads.map((payload) => ({
        snapshotId,
        userId,
        brokerKey: payload.brokerKey,
        accountId: payload.accountId,
        accountName: payload.accountName,
        denominatorBasis: payload.denominatorBasis,
        walletBalance: payload.walletBalance,
        futuresBalance: payload.futuresBalance,
        trackedBalance: payload.trackedBalance,
        grossExposure: payload.grossExposure,
        netExposure: payload.netExposure,
        longExposure: payload.longExposure,
        shortExposure: payload.shortExposure,
        openOrders: payload.openOrders,
        openOrderExposure: payload.openOrderExposure,
        reservedOrderMargin: payload.reservedOrderMargin,
        marginUsagePct: payload.marginUsagePct,
        portfolioConcentrationPct: payload.portfolioConcentrationPct,
        dailyLossUsagePct: payload.dailyLossUsagePct,
        unrealizedPnl: payload.unrealizedPnl,
        openPositions: payload.openPositions,
        maxPositionLeverage: payload.maxPositionLeverage,
        closestLiquidationDistancePct: payload.closestLiquidationDistancePct,
        marginUsageWarnPct: payload.marginUsageWarnPct,
        marginUsageCriticalPct: payload.marginUsageCriticalPct,
        concentrationWarnPct: payload.concentrationWarnPct,
        concentrationCriticalPct: payload.concentrationCriticalPct,
        dailyLossLimitPct: payload.dailyLossLimitPct,
        weeklyLossLimitPct: payload.weeklyLossLimitPct,
        monthlyLossLimitPct: payload.monthlyLossLimitPct,
        maxLeverage: payload.maxLeverage,
        maxTotalAllocation: payload.maxTotalAllocation,
        maxAvgLeverage: payload.maxAvgLeverage,
        fundsObservedAt: payload.fundsObservedAt,
        positionsObservedAt: payload.positionsObservedAt,
        ordersObservedAt: payload.ordersObservedAt,
      }))
    );

    await this.accountSnapshotRepository.save(created);
    return created.length;
  }

  async listLatestAccountSnapshots(userId: string): Promise<RiskAccountSnapshot[]> {
    const latestSnapshotId = await this.accountSnapshotRepository
      .createQueryBuilder('accountSnapshot')
      .select('accountSnapshot.snapshotId', 'snapshotId')
      .where('accountSnapshot.userId = :userId', { userId })
      .orderBy('accountSnapshot.createdAt', 'DESC')
      .limit(1)
      .getRawOne<{ snapshotId?: string }>();

    const snapshotId = String(latestSnapshotId?.snapshotId || '').trim();
    if (!snapshotId) {
      return [];
    }

    const snapshots = await this.accountSnapshotRepository.find({
      where: {
        userId,
        snapshotId,
      },
      order: {
        brokerKey: 'ASC',
        accountName: 'ASC',
        accountId: 'ASC',
      },
    });

    return this.hydrateOrderSummaryFields(snapshots);
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskAccountSnapshot[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    const snapshots = await this.accountSnapshotRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        brokerKey: 'ASC',
        accountName: 'ASC',
        accountId: 'ASC',
      },
    });

    return this.hydrateOrderSummaryFields(snapshots);
  }

  private async hydrateOrderSummaryFields(
    snapshots: RiskAccountSnapshot[]
  ): Promise<RiskAccountSnapshot[]> {
    if (!snapshots.length) {
      return snapshots;
    }

    const needsFallback = snapshots.some(
      (item) =>
        item.openOrders === undefined ||
        item.openOrderExposure === undefined ||
        item.reservedOrderMargin === undefined
    );
    if (!needsFallback) {
      return snapshots;
    }

    const ids = snapshots.map((item) => item.id);
    const rows = (await coreDataSource.query(
      `SELECT id,
              open_orders AS openOrders,
              open_order_exposure AS openOrderExposure,
              reserved_order_margin AS reservedOrderMargin
         FROM risk_account_snapshots
        WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids
    )) as Array<{
      id?: string;
      openOrders?: number | string | null;
      openOrderExposure?: number | string | null;
      reservedOrderMargin?: number | string | null;
    }>;

    const byId = new Map(
      rows.map((row) => [
        String(row.id || '').trim(),
        {
          openOrders: Number(row.openOrders || 0),
          openOrderExposure: Number(row.openOrderExposure || 0),
          reservedOrderMargin: Number(row.reservedOrderMargin || 0),
        },
      ])
    );

    snapshots.forEach((snapshot) => {
      const fallback = byId.get(snapshot.id);
      if (!fallback) {
        return;
      }
      snapshot.openOrders = fallback.openOrders;
      snapshot.openOrderExposure = fallback.openOrderExposure;
      snapshot.reservedOrderMargin = fallback.reservedOrderMargin;
    });

    return snapshots;
  }
}
