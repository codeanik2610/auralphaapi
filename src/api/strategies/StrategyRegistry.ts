import { Inject, Service } from 'typedi';
import { NotFoundAppError } from '../errors/AppError';
import {
  StrategyCatalogItem,
  StrategyExecutionResult,
  StrategyRunQuery,
} from '../contracts/Strategy';
import { AlertConfirmStrategy } from './implementations/AlertConfirmStrategy';
import { SolSmcOnePositionStrategy } from './implementations/SolSmcOnePositionStrategy';

export interface StrategyHandler {
  readonly catalog: StrategyCatalogItem;
  execute(query: StrategyRunQuery): Promise<StrategyExecutionResult>;
}

@Service()
export class StrategyRegistry {
  @Inject(() => AlertConfirmStrategy)
  private alertConfirmStrategy!: AlertConfirmStrategy;

  @Inject(() => SolSmcOnePositionStrategy)
  private solSmcOnePositionStrategy!: SolSmcOnePositionStrategy;

  private get strategies(): StrategyHandler[] {
    return [this.alertConfirmStrategy, this.solSmcOnePositionStrategy];
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
