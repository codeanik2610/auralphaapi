import { Inject, Service } from 'typedi';
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
    return this.ordersService.createFuturesOrder(assetId, body, context?.userId, context?.accountId);
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
}
