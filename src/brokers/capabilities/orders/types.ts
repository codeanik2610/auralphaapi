import { ValidatedCreateOrderBody } from '../../../api/validators/orders.validator';

export interface BrokerOrderContext {
  userId?: string;
  brokerKey?: string;
  accountId?: string;
}

export interface ValidatedOrdersRouteQuery {
  limit: number;
  brokerKey?: string;
  accountId?: string;
  startDate?: string;
  endDate?: string;
}

export type ValidatedCreateOrderRouteBody = ValidatedCreateOrderBody;

export interface BrokerOrdersAdapter {
  listOpenOrders(query: ValidatedOrdersRouteQuery, context?: BrokerOrderContext): Promise<unknown>;
  createOrder(
    assetId: string,
    body: ValidatedCreateOrderRouteBody,
    context?: BrokerOrderContext
  ): Promise<unknown>;
  getOrder(orderId: string, context?: BrokerOrderContext): Promise<unknown>;
  getOrderHistory(query: ValidatedOrdersRouteQuery, context?: BrokerOrderContext): Promise<unknown>;
  cancelOrder(orderId: string, context?: BrokerOrderContext): Promise<unknown>;
}
