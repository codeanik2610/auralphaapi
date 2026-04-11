import { Inject, Service } from 'typedi';
import { DeltaExchangeHttpClient } from '../../providers/delta_exchange/DeltaExchangeHttpClient';
import { BrokerDiagnosticsExecutor, BrokerDiagnosticsResult, BrokerDiagnosticsRoute } from './types';

@Service()
export class DeltaExchangeDiagnosticsExecutor implements BrokerDiagnosticsExecutor {
  readonly key = 'delta-exchange';

  @Inject(() => DeltaExchangeHttpClient)
  private deltaExchangeHttpClient!: DeltaExchangeHttpClient;

  async execute(route: BrokerDiagnosticsRoute): Promise<BrokerDiagnosticsResult> {
    await this.deltaExchangeHttpClient.publicGet('/v2/products', {
      contract_types: 'futures',
      states: 'live',
    });

    if (route.accountId) {
      await this.deltaExchangeHttpClient.signedGet(
        route.accountId,
        '/v2/wallet/balances',
        undefined,
        route.userId
      );
      return { detail: 'Delta public products and signed wallet check passed' };
    }

    return { detail: 'Delta public products reachable; no broker account configured for signed auth check' };
  }
}
