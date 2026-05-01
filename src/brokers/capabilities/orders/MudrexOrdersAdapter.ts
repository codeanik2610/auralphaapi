import { Inject, Service } from 'typedi';
import { BadRequestAppError } from '../../../api';
import { OrdersService } from '../../providers/mudrex';
import {
  BrokerOrderContext,
  BrokerOrdersAdapter,
  ValidatedCreateOrderRouteBody,
  ValidatedOrdersRouteQuery,
} from './types';

@Service()
export class MudrexOrdersAdapter implements BrokerOrdersAdapter {
  @Inject(() => OrdersService)
  private ordersService!: OrdersService;

  async listOpenOrders(
    query: ValidatedOrdersRouteQuery,
    context?: BrokerOrderContext
  ): Promise<unknown> {
    return this.ordersService.getFuturesOrders(
      {
        limit: String(query.limit),
        ...(query.startDate ? { startDate: query.startDate } : {}),
        ...(query.endDate ? { endDate: query.endDate } : {}),
      },
      context?.userId,
      context?.accountId
    );
  }

  async createOrder(
    assetId: string,
    body: ValidatedCreateOrderRouteBody,
    context?: BrokerOrderContext
  ): Promise<unknown> {
    const mudrexBody = this.mapCreateOrderBody(body);
    const response = await this.ordersService.createFuturesOrder(
      assetId,
      mudrexBody,
      context?.userId,
      context?.accountId
    );
    this.assertConfirmedLeverage(mudrexBody, response);
    return response;
  }

  async getOrder(orderId: string, context?: BrokerOrderContext): Promise<unknown> {
    return this.ordersService.getFuturesOrder(orderId, context?.userId, context?.accountId);
  }

  async getOrderHistory(
    query: ValidatedOrdersRouteQuery,
    context?: BrokerOrderContext
  ): Promise<unknown> {
    return this.ordersService.getFuturesOrderHistory(
      {
        limit: String(query.limit),
        ...(query.startDate ? { startDate: query.startDate } : {}),
        ...(query.endDate ? { endDate: query.endDate } : {}),
      },
      context?.userId,
      context?.accountId
    );
  }

  async cancelOrder(orderId: string, context?: BrokerOrderContext): Promise<unknown> {
    return this.ordersService.cancelFuturesOrder(orderId, context?.userId, context?.accountId);
  }

  private mapCreateOrderBody(body: ValidatedCreateOrderRouteBody): ValidatedCreateOrderRouteBody {
    return {
      ...body,
      order_type: this.resolveMudrexOrderType(body.side),
      trigger_type: this.resolveMudrexTriggerType(body.order_type),
    };
  }

  private resolveMudrexOrderType(side: 'long' | 'short' | undefined): string {
    const normalized = String(side || '')
      .trim()
      .toLowerCase();
    if (normalized === 'short') {
      return 'SHORT';
    }
    return 'LONG';
  }

  private resolveMudrexTriggerType(orderType: string | undefined): string {
    const normalized = String(orderType || '')
      .trim()
      .toLowerCase();
    if (normalized === 'limit') {
      return 'LIMIT';
    }
    return 'MARKET';
  }

  private assertConfirmedLeverage(
    body: ValidatedCreateOrderRouteBody,
    response: unknown
  ): void {
    if (body.reduce_only === true) {
      return;
    }

    const requestedLeverage = this.toNumber(body.leverage);
    if (requestedLeverage === null || requestedLeverage <= 0) {
      return;
    }
    const normalizedRequestedLeverage: number = requestedLeverage;

    const record = this.toRecord(response);
    const payload = this.toRecord(record?.data) ?? record;
    const confirmedLeverage = this.toNumber(payload?.leverage);
    if (confirmedLeverage === null || confirmedLeverage <= 0) {
      return;
    }
    const normalizedConfirmedLeverage: number = confirmedLeverage;

    if (Math.abs(normalizedConfirmedLeverage - normalizedRequestedLeverage) > 1e-12) {
      throw new BadRequestAppError(
        `Mudrex confirmed leverage ${normalizedConfirmedLeverage} instead of requested leverage ${normalizedRequestedLeverage}`
      );
    }
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    const raw = String(value).trim();
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
