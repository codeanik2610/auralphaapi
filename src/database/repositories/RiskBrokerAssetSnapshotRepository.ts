import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskBrokerAssetSnapshot } from '../entities/RiskBrokerAssetSnapshot';

export interface ComputedRiskBrokerAssetSnapshotPayload {
  brokerKey: string;
  symbol: string;
  policyContextId: string | null;
  accountCount: number;
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
export class RiskBrokerAssetSnapshotRepository {
  private get brokerAssetSnapshotRepository(): Repository<RiskBrokerAssetSnapshot> {
    return coreDataSource.getRepository(RiskBrokerAssetSnapshot);
  }

  async createComputedBrokerAssetSnapshots(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskBrokerAssetSnapshotPayload[]
  ): Promise<number> {
    if (!payloads.length) {
      return 0;
    }

    const created = this.brokerAssetSnapshotRepository.create(
      payloads.map((payload) => ({
        snapshotId,
        userId,
        brokerKey: payload.brokerKey,
        symbol: payload.symbol,
        policyContextId: payload.policyContextId,
        accountCount: payload.accountCount,
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

    await this.brokerAssetSnapshotRepository.save(created);
    return created.length;
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskBrokerAssetSnapshot[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    return this.brokerAssetSnapshotRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        riskScore: 'DESC',
        createdAt: 'DESC',
        brokerKey: 'ASC',
        symbol: 'ASC',
      },
    });
  }
}
