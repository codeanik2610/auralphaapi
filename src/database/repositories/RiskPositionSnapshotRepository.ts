import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskPositionSnapshot } from '../entities/RiskPositionSnapshot';

export interface ComputedRiskPositionSnapshotPayload {
  brokerKey: string;
  accountId: string;
  accountName: string;
  positionId: string;
  symbol: string;
  side: string | null;
  sideKey: string | null;
  status: string | null;
  statusKey: string | null;
  quantity: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  exposure: number;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  leverage: number | null;
  requestedLeverage: number | null;
  confirmedOrderLeverage: number | null;
  observedPositionLeverage: number | null;
  leverageSource: string | null;
  liquidationPrice: number | null;
  liquidationDistancePct: number | null;
  concentrationPct: number | null;
  riskState: string;
  riskNotesJson: string[] | null;
  positionOpenedAt: Date | null;
  sourceUpdatedAt: Date | null;
}

@Service()
export class RiskPositionSnapshotRepository {
  private get positionSnapshotRepository(): Repository<RiskPositionSnapshot> {
    return coreDataSource.getRepository(RiskPositionSnapshot);
  }

  async createComputedPositionSnapshots(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskPositionSnapshotPayload[]
  ): Promise<number> {
    if (!payloads.length) {
      return 0;
    }

    const created = this.positionSnapshotRepository.create(
      payloads.map((payload) => ({
        snapshotId,
        userId,
        brokerKey: payload.brokerKey,
        accountId: payload.accountId,
        accountName: payload.accountName,
        positionId: payload.positionId,
        symbol: payload.symbol,
        side: payload.side,
        sideKey: payload.sideKey,
        status: payload.status,
        statusKey: payload.statusKey,
        quantity: payload.quantity,
        entryPrice: payload.entryPrice,
        currentPrice: payload.currentPrice,
        exposure: payload.exposure,
        unrealizedPnl: payload.unrealizedPnl,
        realizedPnl: payload.realizedPnl,
        leverage: payload.leverage,
        requestedLeverage: payload.requestedLeverage,
        confirmedOrderLeverage: payload.confirmedOrderLeverage,
        observedPositionLeverage: payload.observedPositionLeverage,
        leverageSource: payload.leverageSource,
        liquidationPrice: payload.liquidationPrice,
        liquidationDistancePct: payload.liquidationDistancePct,
        concentrationPct: payload.concentrationPct,
        riskState: payload.riskState,
        riskNotesJson: payload.riskNotesJson,
        positionOpenedAt: payload.positionOpenedAt,
        sourceUpdatedAt: payload.sourceUpdatedAt,
      }))
    );

    await this.positionSnapshotRepository.save(created);
    return created.length;
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskPositionSnapshot[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    return this.positionSnapshotRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        createdAt: 'DESC',
        brokerKey: 'ASC',
        accountName: 'ASC',
        symbol: 'ASC',
        positionId: 'ASC',
      },
    });
  }
}
