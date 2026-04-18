import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskAssetSnapshot } from '../entities/RiskAssetSnapshot';

export interface ComputedRiskAssetSnapshotPayload {
  symbol: string;
  accountCount: number;
  brokerCount: number;
  positionCount: number;
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  unrealizedPnl: number;
  realizedPnl: number;
  weightedAvgLeverage: number | null;
  maxLeverage: number | null;
  worstLiquidationDistancePct: number | null;
  riskScore: number;
  riskState: string;
  primaryConcern: string | null;
}

@Service()
export class RiskAssetSnapshotRepository {
  private get assetSnapshotRepository(): Repository<RiskAssetSnapshot> {
    return coreDataSource.getRepository(RiskAssetSnapshot);
  }

  async createComputedAssetSnapshots(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskAssetSnapshotPayload[]
  ): Promise<number> {
    if (!payloads.length) {
      return 0;
    }

    const created = this.assetSnapshotRepository.create(
      payloads.map((payload) => ({
        snapshotId,
        userId,
        symbol: payload.symbol,
        accountCount: payload.accountCount,
        brokerCount: payload.brokerCount,
        positionCount: payload.positionCount,
        openOrders: payload.openOrders,
        openOrderExposure: payload.openOrderExposure,
        reservedOrderMargin: payload.reservedOrderMargin,
        grossExposure: payload.grossExposure,
        netExposure: payload.netExposure,
        longExposure: payload.longExposure,
        shortExposure: payload.shortExposure,
        unrealizedPnl: payload.unrealizedPnl,
        realizedPnl: payload.realizedPnl,
        weightedAvgLeverage: payload.weightedAvgLeverage,
        maxLeverage: payload.maxLeverage,
        worstLiquidationDistancePct: payload.worstLiquidationDistancePct,
        riskScore: payload.riskScore,
        riskState: payload.riskState,
        primaryConcern: payload.primaryConcern,
      }))
    );

    await this.assetSnapshotRepository.save(created);
    return created.length;
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskAssetSnapshot[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    return this.assetSnapshotRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        riskScore: 'DESC',
        createdAt: 'DESC',
        symbol: 'ASC',
      },
    });
  }
}
