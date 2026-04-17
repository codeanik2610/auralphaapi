import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { RiskOrderSnapshot } from '../entities/RiskOrderSnapshot';

export interface ComputedRiskOrderSnapshotPayload {
  brokerKey: string;
  accountId: string;
  accountName: string;
  externalId: string;
  orderId: string | null;
  symbol: string | null;
  side: string | null;
  status: string | null;
  orderType: string | null;
  triggerType: string | null;
  quantity: number | null;
  filledQuantity: number | null;
  remainingQuantity: number | null;
  price: number | null;
  orderPrice: number | null;
  triggerPrice: number | null;
  filledPrice: number | null;
  lastPrice: number | null;
  stoplossPrice: number | null;
  takeprofitPrice: number | null;
  leverage: number | null;
  reduceOnly: boolean | null;
  snapshotStatusRank: number;
  notional: number | null;
  reservedMargin: number | null;
  orderCreatedAt: Date | null;
  orderUpdatedAt: Date | null;
  orderCanceledAt: Date | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

@Service()
export class RiskOrderSnapshotRepository {
  private get orderSnapshotRepository(): Repository<RiskOrderSnapshot> {
    return coreDataSource.getRepository(RiskOrderSnapshot);
  }

  async createComputedOrderSnapshots(
    userId: string,
    snapshotId: string,
    payloads: ComputedRiskOrderSnapshotPayload[]
  ): Promise<number> {
    if (!payloads.length) {
      return 0;
    }

    const created = this.orderSnapshotRepository.create(
      payloads.map((payload) => ({
        snapshotId,
        userId,
        brokerKey: payload.brokerKey,
        accountId: payload.accountId,
        accountName: payload.accountName,
        externalId: payload.externalId,
        orderId: payload.orderId,
        symbol: payload.symbol,
        side: payload.side,
        status: payload.status,
        orderType: payload.orderType,
        triggerType: payload.triggerType,
        quantity: payload.quantity,
        filledQuantity: payload.filledQuantity,
        remainingQuantity: payload.remainingQuantity,
        price: payload.price,
        orderPrice: payload.orderPrice,
        triggerPrice: payload.triggerPrice,
        filledPrice: payload.filledPrice,
        lastPrice: payload.lastPrice,
        stoplossPrice: payload.stoplossPrice,
        takeprofitPrice: payload.takeprofitPrice,
        leverage: payload.leverage,
        reduceOnly: payload.reduceOnly,
        snapshotStatusRank: payload.snapshotStatusRank,
        notional: payload.notional,
        reservedMargin: payload.reservedMargin,
        orderCreatedAt: payload.orderCreatedAt,
        orderUpdatedAt: payload.orderUpdatedAt,
        orderCanceledAt: payload.orderCanceledAt,
        firstSeenAt: payload.firstSeenAt,
        lastSeenAt: payload.lastSeenAt,
      }))
    );

    await this.orderSnapshotRepository.save(created);
    return created.length;
  }

  async listBySnapshotId(snapshotId: string): Promise<RiskOrderSnapshot[]> {
    const normalizedSnapshotId = String(snapshotId || '').trim();
    if (!normalizedSnapshotId) {
      return [];
    }

    const snapshots = await this.orderSnapshotRepository.find({
      where: {
        snapshotId: normalizedSnapshotId,
      },
      order: {
        createdAt: 'DESC',
        brokerKey: 'ASC',
        accountName: 'ASC',
        symbol: 'ASC',
        externalId: 'ASC',
      },
    });

    return this.hydrateReservedMargin(snapshots);
  }

  private async hydrateReservedMargin(
    snapshots: RiskOrderSnapshot[]
  ): Promise<RiskOrderSnapshot[]> {
    if (!snapshots.length || snapshots.every((item) => item.reservedMargin !== undefined)) {
      return snapshots;
    }

    const ids = snapshots.map((item) => item.id);
    const rows = (await coreDataSource.query(
      `SELECT id,
              reserved_margin AS reservedMargin
         FROM risk_order_snapshots
        WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids
    )) as Array<{
      id?: string;
      reservedMargin?: number | string | null;
    }>;

    const byId = new Map(
      rows.map((row) => [
        String(row.id || '').trim(),
        Number(row.reservedMargin || 0),
      ])
    );

    snapshots.forEach((snapshot) => {
      const fallback = byId.get(snapshot.id);
      if (fallback === undefined) {
        return;
      }
      snapshot.reservedMargin = fallback;
    });

    return snapshots;
  }
}
