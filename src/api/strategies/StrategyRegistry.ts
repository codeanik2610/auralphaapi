import { Inject, Service } from 'typedi';
import { NotFoundAppError } from '../errors/AppError';
import { StrategyCatalogItem, StrategyRunQuery, AlertConfirmStrategyResult } from '../contracts/Strategy';
import { AlertConfirmStrategy } from './implementations/AlertConfirmStrategy';

export interface StrategyHandler {
  readonly catalog: StrategyCatalogItem;
  execute(query: StrategyRunQuery): Promise<AlertConfirmStrategyResult>;
}

@Service()
export class StrategyRegistry {
  @Inject(() => AlertConfirmStrategy)
  private alertConfirmStrategy!: AlertConfirmStrategy;

  private get strategies(): StrategyHandler[] {
    return [this.alertConfirmStrategy];
  }

  getStrategies(): StrategyCatalogItem[] {
    return this.strategies.map((strategy) => strategy.catalog);
  }

  getStrategyOrThrow(strategyId: string): StrategyHandler {
    const strategy = this.strategies.find((item) => item.catalog.strategyId === strategyId);

    if (!strategy) {
      throw new NotFoundAppError(`Strategy not registered for id: ${strategyId}`);
    }

    return strategy;
  }
}
