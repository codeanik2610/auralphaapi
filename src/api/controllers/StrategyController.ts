import { Body, Get, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import type { ApiSuccessResponse } from '../contracts/ApiResponse';
import type { AlertConfirmStrategyResult, StrategyCatalogItem } from '../contracts/Strategy';
import { StrategyService } from '../services/StrategyService';
import type { StrategyRunRequest } from '../validators/strategy.validator';

@JsonController('/strategy')
@Service()
export class StrategyController {
  @Inject(() => StrategyService)
  private strategyService!: StrategyService;

  @Get()
  getStrategies(): ApiSuccessResponse<StrategyCatalogItem[]> {
    return this.strategyService.getStrategies();
  }

  @Post('/get-trades')
  async runStrategy(
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<AlertConfirmStrategyResult>> {
    return this.strategyService.runStrategy(body as StrategyRunRequest);
  }
}
