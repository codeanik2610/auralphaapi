import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskBrokerSnapshot } from '../entities/RiskBrokerSnapshot';

export interface ComputedRiskBrokerSnapshotPayload {
  brokerKey: string;
  policyContextId: string | null;
  accountCount: number;
  trackedBalance: number;
  walletBalance: number;
  futuresBalance: number;
  grossExposure: number;
  netExposure: number;
  longExposure: number;
  shortExposure: number;
  openPositions: number;
  openOrders: number;
  openOrderExposure: number;
  reservedOrderMargin: number;
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
export class RiskBrokerSnapshotRepository {
  private get brokerSnapshotRepository(): Repository<RiskBrokerSnapshot> {
    return coreDataSource.getRepository(RiskBrokerSnapshot);
  }

  async createComputedBrokerSnapshots(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskBrokerSnapshotPayload[]
  ): Promise<number> {
    if (!payloads.length) {
      return 0;
    }

    const created = this.brokerSnapshotRepository.create(
      payloads.map((payload) => ({
        snapshotId,
        userId,
        brokerKey: payload.brokerKey,
        policyContextId: payload.policyContextId,
        accountCount: payload.accountCount,
        trackedBalance: payload.trackedBalance,
        walletBalance: payload.walletBalance,
        futuresBalance: payload.futuresBalance,
        grossExposure: payload.grossExposure,
        netExposure: payload.netExposure,
        longExposure: payload.longExposure,
        shortExposure: payload.shortExposure,
        openPositions: payload.openPositions,
        openOrders: payload.openOrders,
        openOrderExposure: payload.openOrderExposure,
        reservedOrderMargin: payload.reservedOrderMargin,
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

    await this.brokerSnapshotRepository.save(created);
    return created.length;
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskBrokerSnapshot[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    return this.brokerSnapshotRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        riskScore: 'DESC',
        createdAt: 'DESC',
        brokerKey: 'ASC',
      },
    });
  }
}
