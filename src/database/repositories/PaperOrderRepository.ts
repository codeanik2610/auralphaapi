import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { PaperOrder } from '../entities/PaperOrder';

export interface CreatePaperOrderPayload {
  userId: string;
  suggestedTradeId?: string | null;
  assetId: string;
  brokerKey: string;
  accountId: string;
  symbol?: string | null;
  side?: string | null;
  orderType?: string | null;
  triggerType?: string | null;
  status?: string | null;
  leverage?: number | null;
  quantity?: number | string | null;
  orderPrice?: number | string | null;
  stoplossPrice?: number | string | null;
  takeprofitPrice?: number | string | null;
  reduceOnly?: boolean;
  payload?: Record<string, unknown> | null;
}

const normalizeDecimal = (value: number | string | null | undefined): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return String(numeric);
};

@Service()
export class PaperOrderRepository {
  private get repository(): Repository<PaperOrder> {
    return coreDataSource.getRepository(PaperOrder);
  }

  async createPaperOrder(payload: CreatePaperOrderPayload): Promise<PaperOrder> {
    const entity = this.repository.create({
      id: randomUUID(),
      userId: payload.userId,
      suggestedTradeId: payload.suggestedTradeId ?? null,
      assetId: payload.assetId,
      brokerKey: payload.brokerKey,
      accountId: payload.accountId,
      symbol: payload.symbol?.trim().toUpperCase() || null,
      side: payload.side?.trim().toUpperCase() || null,
      orderType: payload.orderType?.trim() || null,
      triggerType: payload.triggerType?.trim() || null,
      status: payload.status?.trim().toUpperCase() || 'OPEN',
      leverage:
        payload.leverage === undefined || payload.leverage === null
          ? null
          : Number(payload.leverage),
      quantity: normalizeDecimal(payload.quantity),
      orderPrice: normalizeDecimal(payload.orderPrice),
      stoplossPrice: normalizeDecimal(payload.stoplossPrice),
      takeprofitPrice: normalizeDecimal(payload.takeprofitPrice),
      reduceOnly: payload.reduceOnly === true,
      payload: payload.payload ?? null,
      canceledAt: null,
    });

    return this.repository.save(entity);
  }

  async getPaperOrderById(userId: string, paperOrderId: string): Promise<PaperOrder | null> {
    return this.repository.findOne({
      where: {
        id: paperOrderId,
        userId,
      },
    });
  }

  async listPaperOrders(
    userId: string,
    options: {
      brokerKey?: string;
      accountId?: string;
      limit: number;
      startDate?: Date | null;
      endDate?: Date | null;
    }
  ): Promise<PaperOrder[]> {
    const builder = this.repository
      .createQueryBuilder('paper_order')
      .where('paper_order.userId = :userId', { userId })
      .orderBy('paper_order.createdAt', 'DESC')
      .take(options.limit);

    if (options.brokerKey) {
      builder.andWhere('LOWER(paper_order.brokerKey) = :brokerKey', {
        brokerKey: options.brokerKey.toLowerCase(),
      });
    }
    if (options.accountId) {
      builder.andWhere('paper_order.accountId = :accountId', {
        accountId: options.accountId,
      });
    }
    if (options.startDate) {
      builder.andWhere('paper_order.createdAt >= :startDate', {
        startDate: options.startDate,
      });
    }
    if (options.endDate) {
      builder.andWhere('paper_order.createdAt <= :endDate', {
        endDate: options.endDate,
      });
    }

    return builder.getMany();
  }

  async listAllPaperOrders(
    userId: string,
    options: {
      brokerKey?: string;
      accountId?: string;
    } = {}
  ): Promise<PaperOrder[]> {
    const builder = this.repository
      .createQueryBuilder('paper_order')
      .where('paper_order.userId = :userId', { userId })
      .orderBy('paper_order.createdAt', 'DESC');

    if (options.brokerKey) {
      builder.andWhere('LOWER(paper_order.brokerKey) = :brokerKey', {
        brokerKey: options.brokerKey.toLowerCase(),
      });
    }

    if (options.accountId) {
      builder.andWhere('paper_order.accountId = :accountId', {
        accountId: options.accountId,
      });
    }

    return builder.getMany();
  }

  async listExecutablePaperOrders(
    userId: string,
    options: {
      brokerKey?: string;
      accountId?: string;
      limit?: number;
    } = {}
  ): Promise<PaperOrder[]> {
    const builder = this.repository
      .createQueryBuilder('paper_order')
      .where('paper_order.userId = :userId', { userId })
      .andWhere('paper_order.status IN (:...statuses)', {
        statuses: ['OPEN', 'FILLED'],
      })
      .orderBy('paper_order.updatedAt', 'ASC')
      .take(options.limit && options.limit > 0 ? Math.floor(options.limit) : 200);

    if (options.brokerKey) {
      builder.andWhere('LOWER(paper_order.brokerKey) = :brokerKey', {
        brokerKey: options.brokerKey.toLowerCase(),
      });
    }

    if (options.accountId) {
      builder.andWhere('paper_order.accountId = :accountId', {
        accountId: options.accountId,
      });
    }

    return builder.getMany();
  }

  async listExecutablePaperOrdersGlobal(limit = 200): Promise<PaperOrder[]> {
    return this.repository
      .createQueryBuilder('paper_order')
      .where('paper_order.status IN (:...statuses)', {
        statuses: ['OPEN', 'FILLED'],
      })
      .orderBy('paper_order.updatedAt', 'ASC')
      .take(limit > 0 ? Math.floor(limit) : 200)
      .getMany();
  }

  async countExecutablePaperOrdersGlobal(): Promise<number> {
    return this.repository
      .createQueryBuilder('paper_order')
      .where('paper_order.status IN (:...statuses)', {
        statuses: ['OPEN', 'FILLED'],
      })
      .getCount();
  }

  async listPaperOrdersByIds(userId: string, paperOrderIds: string[]): Promise<PaperOrder[]> {
    const normalizedIds = Array.from(
      new Set((paperOrderIds || []).map((value) => String(value || '').trim()).filter(Boolean))
    );
    if (!normalizedIds.length) {
      return [];
    }

    return this.repository
      .createQueryBuilder('paper_order')
      .where('paper_order.userId = :userId', { userId })
      .andWhere('paper_order.id IN (:...paperOrderIds)', {
        paperOrderIds: normalizedIds,
      })
      .getMany();
  }

  async savePaperOrder(item: PaperOrder): Promise<PaperOrder> {
    return this.repository.save(item);
  }

  async attachSuggestedTrade(
    userId: string,
    paperOrderId: string,
    suggestedTradeId: string
  ): Promise<PaperOrder | null> {
    const item = await this.getPaperOrderById(userId, paperOrderId);
    if (!item) {
      return null;
    }

    item.suggestedTradeId = suggestedTradeId;
    return this.repository.save(item);
  }

  async cancelPaperOrder(userId: string, paperOrderId: string): Promise<PaperOrder | null> {
    const item = await this.getPaperOrderById(userId, paperOrderId);
    if (!item) {
      return null;
    }

    item.status = 'CANCELLED';
    item.canceledAt = new Date();
    return this.repository.save(item);
  }
}
