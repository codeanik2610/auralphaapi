import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../../../api';
import { MudrexCancelOrderResult, MudrexCreateOrderResult, MudrexOrder } from '../../../api';
import { BadGatewayAppError } from '../../../api';
import { validateAssetId } from '../../../api/validators/assets.validator';
import {
  CreateOrderBody,
  OrdersQuery,
  ValidatedCreateOrderBody,
  validateCreateOrderBody,
  validateOrderId,
  validateOrdersQuery,
} from '../../../api/validators/orders.validator';
import { successResponse } from '../../../api';
import { rethrowMudrexError } from './MudrexErrorMapper';
import { MudrexHttpClient } from './MudrexHttpClient';

@Service()
export class OrdersService {
  @Inject(() => MudrexHttpClient)
  private mudrexHttpClient!: MudrexHttpClient;

  async getFuturesOrders(
    query: OrdersQuery,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexOrder[]>> {
    const params = validateOrdersQuery(query);

    try {
      const data = await this.fetchFuturesOrders(params.limit, userId, accountId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex orders service');
    }
  }

  async createFuturesOrder(
    assetId: string,
    body: CreateOrderBody,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexCreateOrderResult>> {
    const validatedAssetId = validateAssetId(assetId);
    const validatedBody = validateCreateOrderBody(body);

    try {
      const data = await this.postFuturesOrder(validatedAssetId, validatedBody, userId, accountId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex create order service');
    }
  }

  async getFuturesOrder(
    orderId: string,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexOrder>> {
    const validatedOrderId = validateOrderId(orderId);

    try {
      const data = await this.fetchFuturesOrder(validatedOrderId, userId, accountId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex order detail service');
    }
  }

  async getFuturesOrderHistory(
    query: OrdersQuery,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexOrder[]>> {
    const params = validateOrdersQuery(query);

    try {
      const data = await this.fetchFuturesOrderHistory(
        params.limit,
        params.startDate,
        params.endDate,
        userId,
        accountId
      );
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex orders history service');
    }
  }

  async cancelFuturesOrder(
    orderId: string,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexCancelOrderResult>> {
    const validatedOrderId = validateOrderId(orderId);

    try {
      const data = await this.deleteFuturesOrder(validatedOrderId, userId, accountId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex cancel order service');
    }
  }

  private async fetchFuturesOrders(
    limit: number,
    userId?: string,
    accountId?: string
  ): Promise<MudrexOrder[]> {
    const payload = await this.mudrexHttpClient.authenticatedGet<MudrexOrder[]>(
      userId,
      accountId,
      '/fapi/v1/futures/orders',
      { limit }
    );

    if (!Array.isArray(payload)) {
      throw new BadGatewayAppError('Mudrex returned an invalid futures orders payload');
    }

    return payload;
  }

  private async postFuturesOrder(
    assetId: string,
    body: ValidatedCreateOrderBody,
    userId?: string,
    accountId?: string
  ): Promise<MudrexCreateOrderResult> {
    const requestBody = {
      leverage: body.leverage,
      quantity: body.quantity,
      order_price: body.order_price,
      order_type: body.order_type,
      trigger_type: body.trigger_type,
      is_takeprofit: body.is_takeprofit,
      is_stoploss: body.is_stoploss,
      stoploss_price: body.stoploss_price,
      takeprofit_price: body.takeprofit_price,
      reduce_only: body.reduce_only,
    };
    const payload = await this.mudrexHttpClient.authenticatedPost<MudrexCreateOrderResult>(
      userId,
      accountId,
      `/fapi/v1/futures/${encodeURIComponent(assetId)}/order`,
      requestBody
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid create order payload');
    }

    return payload;
  }

  private async fetchFuturesOrder(
    orderId: string,
    userId?: string,
    accountId?: string
  ): Promise<MudrexOrder> {
    const payload = await this.mudrexHttpClient.authenticatedGet<MudrexOrder>(
      userId,
      accountId,
      `/fapi/v1/futures/orders/${encodeURIComponent(orderId)}`
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid order detail payload');
    }

    return payload;
  }

  private async fetchFuturesOrderHistory(
    limit: number,
    startDate: string | undefined,
    endDate: string | undefined,
    userId?: string,
    accountId?: string
  ): Promise<MudrexOrder[]> {
    const payload = await this.mudrexHttpClient.authenticatedGet<MudrexOrder[]>(
      userId,
      accountId,
      '/fapi/v1/futures/orders/history',
      {
        limit,
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {}),
      }
    );

    if (!Array.isArray(payload)) {
      throw new BadGatewayAppError('Mudrex returned an invalid order history payload');
    }

    return payload;
  }

  private async deleteFuturesOrder(
    orderId: string,
    userId?: string,
    accountId?: string
  ): Promise<MudrexCancelOrderResult> {
    const payload = await this.mudrexHttpClient.authenticatedDelete<MudrexCancelOrderResult>(
      userId,
      accountId,
      `/fapi/v1/futures/orders/${encodeURIComponent(orderId)}`
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid cancel order payload');
    }

    return payload;
  }
}
