import { Inject, Service } from 'typedi';
import { MudrexHttpClient } from '../../providers/mudrex/MudrexHttpClient';
import { BrokerDiagnosticsExecutor, BrokerDiagnosticsResult, BrokerDiagnosticsRoute } from './types';

@Service()
export class MudrexDiagnosticsExecutor implements BrokerDiagnosticsExecutor {
  readonly key = 'mudrex-public';

  @Inject(() => MudrexHttpClient)
  private mudrexHttpClient!: MudrexHttpClient;

  async execute(route: BrokerDiagnosticsRoute): Promise<BrokerDiagnosticsResult> {
    if (!route.accountId) {
      return { detail: 'Mudrex diagnostics requires a broker account for signed auth check' };
    }

    await this.mudrexHttpClient.authenticatedGet(
      route.userId,
      route.accountId,
      '/fapi/v1/futures/orders',
      { limit: 1 }
    );

    return { detail: 'Mudrex signed orders check passed' };
  }
}
