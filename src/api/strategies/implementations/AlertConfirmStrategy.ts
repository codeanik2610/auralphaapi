import { Service } from 'typedi';
import { AlertConfirmStrategyResult, StrategyCatalogItem, StrategyRunQuery } from '../../contracts/Strategy';
import { StrategyHandler } from '../StrategyRegistry';

@Service()
export class AlertConfirmStrategy implements StrategyHandler {
  readonly catalog: StrategyCatalogItem = {
    strategyId: 'alert-confirm',
    name: 'Alert confirm',
    description: 'Returns alert confirmation results for the requested symbols and interval.',
    paramsSchema: [],
  };

  async execute(query: StrategyRunQuery): Promise<AlertConfirmStrategyResult> {
    return {
      strategyId: query.strategyId,
      strategy: 'alert-confirm-no-same-direction-skip',
      interval: query.interval,
      limit: query.limit,
      maxWaitBars: query.maxWaitBars ?? 0,
      results: [],
    };
  }
}
