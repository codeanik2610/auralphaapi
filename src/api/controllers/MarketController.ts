import { Body, JsonController, Post, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { BinanceMarketCandle } from '../contracts/Binance';
import { MarketCandlesQuery } from '../validators/market.validator';
import { BrokerMarketFacadeService } from '../services/BrokerMarketFacadeService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/market')
@Service()
export class MarketController {
  @Inject(() => BrokerMarketFacadeService)
  private marketService!: BrokerMarketFacadeService;

  @Post('/candles')
  async getCandles(@Req() request: Request, @Body() body: MarketCandlesQuery): Promise<ApiSuccessResponse<BinanceMarketCandle[]>> {
    return this.marketService.getCandles(requireAuthUserId(request), body) as Promise<ApiSuccessResponse<BinanceMarketCandle[]>>;
  }
}
