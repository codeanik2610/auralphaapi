import { Body, Delete, Get, JsonController, Param, Post, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { MudrexCancelOrderResult, MudrexCreateOrderResult, MudrexOrder } from '../contracts/Mudrex';
import {
  OrderSubmissionAttemptDetail,
  OrderSubmissionAttemptsResponse,
  OrdersRefreshRequestResponse,
  OrdersSyncStatusResponse,
} from '../contracts/Orders';
import { CreateOrderBody, OrdersRefreshBody } from '../validators/orders.validator';
import { BrokerOrdersFacadeService } from '../services/BrokerOrdersFacadeService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/orders')
@Service()
export class OrdersController {
  @Inject(() => BrokerOrdersFacadeService)
  private ordersService!: BrokerOrdersFacadeService;

  @Get('/submissions')
  async getOrderSubmissionAttempts(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('suggestedTradeId') suggestedTradeId?: string,
    @QueryParam('status') status?: string,
    @QueryParam('placementState') placementState?: string,
    @QueryParam('reconciliationState') reconciliationState?: string,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string
  ): Promise<ApiSuccessResponse<OrderSubmissionAttemptsResponse>> {
    return {
      success: true,
      data: await this.ordersService.getOrderSubmissionAttempts(
        requireAuthUserId(request),
        {
          limit,
          offset,
          suggestedTradeId,
          status,
          placementState,
          reconciliationState,
          brokerKey,
          accountId,
        }
      ),
    };
  }

  @Get('/submissions/:submissionId')
  async getOrderSubmissionAttempt(
    @Req() request: Request,
    @Param('submissionId') submissionId: string
  ): Promise<ApiSuccessResponse<OrderSubmissionAttemptDetail>> {
    return {
      success: true,
      data: await this.ordersService.getOrderSubmissionAttempt(
        requireAuthUserId(request),
        submissionId
      ),
    };
  }

  @Get('/futures')
  async getFuturesOrders(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string, @QueryParam('startDate') startDate?: string, @QueryParam('endDate') endDate?: string): Promise<ApiSuccessResponse<MudrexOrder[]>> {
    return this.ordersService.getFuturesOrders(requireAuthUserId(request), { limit, brokerKey, accountId, startDate, endDate }) as Promise<ApiSuccessResponse<MudrexOrder[]>>;
  }

  @Get('/futures/active')
  async getActiveFuturesOrders(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('startDate') startDate?: string, @QueryParam('endDate') endDate?: string): Promise<ApiSuccessResponse<unknown>> {
    return this.ordersService.getFuturesOrdersForActiveAccounts(requireAuthUserId(request), { limit, brokerKey, startDate, endDate }) as Promise<ApiSuccessResponse<unknown>>;
  }

  @Post('/futures/refresh')
  async requestFuturesOrdersRefresh(
    @Req() request: Request,
    @Body() body: OrdersRefreshBody = {}
  ): Promise<ApiSuccessResponse<OrdersRefreshRequestResponse>> {
    return this.ordersService.requestOrdersRefresh(
      requireAuthUserId(request),
      body
    ) as unknown as Promise<ApiSuccessResponse<OrdersRefreshRequestResponse>>;
  }

  @Get('/futures/sync-status')
  async getFuturesOrdersSyncStatus(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string
  ): Promise<ApiSuccessResponse<OrdersSyncStatusResponse>> {
    return this.ordersService.getOrdersSyncStatus(
      requireAuthUserId(request),
      { brokerKey, accountId }
    ) as unknown as Promise<ApiSuccessResponse<OrdersSyncStatusResponse>>;
  }

  @Post('/futures/:assetId')
  async createFuturesOrder(@Req() request: Request, @Param('assetId') assetId: string, @Body() body: CreateOrderBody): Promise<ApiSuccessResponse<MudrexCreateOrderResult>> {
    return this.ordersService.createFuturesOrder(requireAuthUserId(request), assetId, body) as Promise<ApiSuccessResponse<MudrexCreateOrderResult>>;
  }

  @Get('/paper')
  async getPaperOrders(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string,
    @QueryParam('startDate') startDate?: string,
    @QueryParam('endDate') endDate?: string
  ): Promise<ApiSuccessResponse<unknown>> {
    return this.ordersService.getPaperOrders(requireAuthUserId(request), {
      limit,
      brokerKey,
      accountId,
      startDate,
      endDate,
    }) as Promise<ApiSuccessResponse<unknown>>;
  }

  @Post('/paper/:assetId')
  async createPaperOrder(
    @Req() request: Request,
    @Param('assetId') assetId: string,
    @Body() body: CreateOrderBody
  ): Promise<ApiSuccessResponse<unknown>> {
    return this.ordersService.createFuturesOrder(requireAuthUserId(request), assetId, {
      ...body,
      execution_mode: 'paper',
    }) as Promise<ApiSuccessResponse<unknown>>;
  }

  @Get('/paper/:paperOrderId')
  async getPaperOrder(
    @Req() request: Request,
    @Param('paperOrderId') paperOrderId: string
  ): Promise<ApiSuccessResponse<unknown>> {
    return this.ordersService.getPaperOrder(requireAuthUserId(request), paperOrderId) as Promise<ApiSuccessResponse<unknown>>;
  }

  @Get('/futures/detail/:orderId')
  async getFuturesOrder(@Req() request: Request, @Param('orderId') orderId: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string): Promise<ApiSuccessResponse<MudrexOrder>> {
    return this.ordersService.getFuturesOrder(requireAuthUserId(request), orderId, { brokerKey, accountId }) as Promise<ApiSuccessResponse<MudrexOrder>>;
  }

  @Get('/futures/history')
  async getFuturesOrderHistory(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string, @QueryParam('startDate') startDate?: string, @QueryParam('endDate') endDate?: string): Promise<ApiSuccessResponse<MudrexOrder[]>> {
    return this.ordersService.getFuturesOrderHistory(requireAuthUserId(request), { limit, brokerKey, accountId, startDate, endDate }) as Promise<ApiSuccessResponse<MudrexOrder[]>>;
  }

  @Get('/futures/history/active')
  async getActiveFuturesOrderHistory(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('startDate') startDate?: string, @QueryParam('endDate') endDate?: string): Promise<ApiSuccessResponse<unknown>> {
    return this.ordersService.getFuturesOrderHistoryForActiveAccounts(requireAuthUserId(request), { limit, brokerKey, startDate, endDate }) as Promise<ApiSuccessResponse<unknown>>;
  }

  @Delete('/futures/:orderId')
  async cancelFuturesOrder(@Req() request: Request, @Param('orderId') orderId: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string): Promise<ApiSuccessResponse<MudrexCancelOrderResult>> {
    return this.ordersService.cancelFuturesOrder(requireAuthUserId(request), orderId, { brokerKey, accountId }) as Promise<ApiSuccessResponse<MudrexCancelOrderResult>>;
  }

  @Delete('/paper/:paperOrderId')
  async cancelPaperOrder(
    @Req() request: Request,
    @Param('paperOrderId') paperOrderId: string
  ): Promise<ApiSuccessResponse<unknown>> {
    return this.ordersService.cancelPaperOrder(requireAuthUserId(request), paperOrderId) as Promise<ApiSuccessResponse<unknown>>;
  }
}
