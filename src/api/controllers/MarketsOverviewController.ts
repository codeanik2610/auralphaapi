import { Request } from 'express';
import { Get, JsonController, Param, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  MarketChartResponse,
  MarketsOverviewResponse,
  MarketSymbolOverviewResponse,
} from '../contracts/MarketOverview';
import { MarketsOverviewService } from '../services/MarketsOverviewService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/markets')
@Service()
export class MarketsOverviewController {
  @Inject(() => MarketsOverviewService)
  private marketsOverviewService!: MarketsOverviewService;

  @Get('/overview')
  async getOverview(
    @Req() request: Request,
    @QueryParam('selectedSymbol') selectedSymbol?: string,
    @QueryParam('search') search?: string,
    @QueryParam('sort') sort?: string,
    @QueryParam('order') order?: string,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('signalFilter') signalFilter?: string,
    @QueryParam('watchlistFilter') watchlistFilter?: string,
    @QueryParam('liquidityTier') liquidityTier?: string
  ): Promise<ApiSuccessResponse<MarketsOverviewResponse>> {
    return this.marketsOverviewService.getOverview(requireAuthUserId(request), {
      selectedSymbol,
      search,
      sort,
      order,
      limit,
      offset,
      signalFilter,
      watchlistFilter,
      liquidityTier,
    });
  }

  @Get('/:symbol/overview')
  async getSymbolOverview(
    @Req() request: Request,
    @Param('symbol') symbol: string,
    @QueryParam('signalsLimit') signalsLimit?: string
  ): Promise<ApiSuccessResponse<MarketSymbolOverviewResponse>> {
    return this.marketsOverviewService.getSymbolOverview(
      requireAuthUserId(request),
      symbol,
      { signalsLimit }
    );
  }

  @Get('/:symbol/chart')
  async getSymbolChart(
    @Req() request: Request,
    @Param('symbol') symbol: string,
    @QueryParam('interval') interval?: string,
    @QueryParam('limit') limit?: string,
    @QueryParam('endTime') endTime?: string
  ): Promise<ApiSuccessResponse<MarketChartResponse>> {
    void requireAuthUserId(request);
    return this.marketsOverviewService.getSymbolChart(symbol, {
      interval,
      limit,
      ...(endTime ? { endTime } : {}),
    });
  }
}
