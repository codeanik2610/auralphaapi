import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  StrategyExecutionResult,
  StrategyCatalogItem,
  StrategyRunQuery,
} from '../contracts/Strategy';
import { successResponse } from '../utils/response';
import { StrategyRegistry } from '../strategies/StrategyRegistry';
import { StrategyRunRequest, validateStrategyRunRequest } from '../validators/strategy.validator';

@Service()
export class StrategyService {
  @Inject(() => StrategyRegistry)
  private strategyRegistry!: StrategyRegistry;

  getStrategies(): ApiSuccessResponse<StrategyCatalogItem[]> {
    return successResponse(this.strategyRegistry.getStrategies());
  }

  async runStrategy(
    request: StrategyRunRequest
  ): Promise<ApiSuccessResponse<StrategyExecutionResult>> {
    const query = validateStrategyRunRequest(request);
    const strategy = this.strategyRegistry.getStrategyOrThrow(query.strategyId);

    return successResponse(
      await strategy.execute({
        strategyId: query.strategyId,
        symbols: query.symbols,
        interval: query.interval,
        limit: query.limit,
        params: query.params,
        maxWaitBars: query.maxWaitBars,
      } satisfies StrategyRunQuery)
    );
  }
}
