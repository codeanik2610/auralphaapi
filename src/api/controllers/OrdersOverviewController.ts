import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { OrdersOverviewResponse } from '../contracts/OrdersOverview';
import { OrdersOverviewService } from '../services/OrdersOverviewService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/orders')
@Service()
export class OrdersOverviewController {
  @Inject(() => OrdersOverviewService)
  private ordersOverviewService!: OrdersOverviewService;

  @Get('/overview')
  async getOverview(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string,
    @QueryParam('startDate') startDate?: string,
    @QueryParam('endDate') endDate?: string
  ): Promise<ApiSuccessResponse<OrdersOverviewResponse>> {
    return this.ordersOverviewService.getOverview(requireAuthUserId(request), {
      brokerKey,
      accountId,
      startDate,
      endDate,
    });
  }
}
