import { Inject, Service } from 'typedi';
import { BadRequestAppError } from '../../../api';
import { BrokerDefinitionService } from '../../core/BrokerDefinitionService';
import { DeltaExchangeAssetSyncExecutor } from './DeltaExchangeAssetSyncExecutor';
import { MudrexExchangeAssetSyncExecutor } from './MudrexExchangeAssetSyncExecutor';

export interface ExchangeAssetSyncCandidate {
  id: string;
  symbol: string;
}

export interface ExchangeAssetSyncMatch {
  externalId: string;
  name: string;
  symbol: string;
  assetId: string;
}

export interface ExchangeAssetSyncExecutor {
  readonly key: string;
  execute(assets: ExchangeAssetSyncCandidate[]): Promise<ExchangeAssetSyncMatch[]>;
}

@Service()
export class BrokerExchangeAssetSyncService {
  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => MudrexExchangeAssetSyncExecutor)
  private mudrexExchangeAssetSyncExecutor!: MudrexExchangeAssetSyncExecutor;

  @Inject(() => DeltaExchangeAssetSyncExecutor)
  private deltaExchangeAssetSyncExecutor!: DeltaExchangeAssetSyncExecutor;

  private get executors(): ExchangeAssetSyncExecutor[] {
    return [this.mudrexExchangeAssetSyncExecutor, this.deltaExchangeAssetSyncExecutor];
  }

  listExecutorKeys(): string[] {
    return this.executors.map((executor) => executor.key);
  }

  supportsSource(source?: string | null): boolean {
    return ['delta_exchange', 'mudrex'].includes(String(source || '').trim().toLowerCase());
  }

  async sync(source: string, assets: ExchangeAssetSyncCandidate[]): Promise<ExchangeAssetSyncMatch[]> {
    const definition = await this.brokerDefinitionService.getRequiredDefinition(source);
    const executorKey = this.resolveExecutorKey(definition.brokerKey);
    const executor = this.executors.find((item) => item.key === executorKey);

    if (!executor) {
      throw new BadRequestAppError(`Exchange asset sync executor not registered for source: ${source}`);
    }

    return executor.execute(assets);
  }

  private resolveExecutorKey(brokerKey: string): string {
    switch (brokerKey) {
      case 'delta_exchange':
        return 'delta-exchange-assets';
      case 'mudrex':
        return 'mudrex-assets';
      default:
        throw new BadRequestAppError(`Exchange asset sync is not configured for source: ${brokerKey}`);
    }
  }
}
