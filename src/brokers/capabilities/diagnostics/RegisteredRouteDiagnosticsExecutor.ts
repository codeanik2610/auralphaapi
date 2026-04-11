import { Inject, Service } from 'typedi';
import { BadRequestAppError } from '../../../api';
import { BrokerRegistry } from '../../core/BrokerRegistry';
import { BrokerDiagnosticsExecutor, BrokerDiagnosticsResult, BrokerDiagnosticsRoute } from './types';

@Service()
export class RegisteredRouteDiagnosticsExecutor implements BrokerDiagnosticsExecutor {
  readonly key = 'registered-route';

  @Inject(() => BrokerRegistry)
  private brokerRegistry!: BrokerRegistry;

  async execute(route: BrokerDiagnosticsRoute): Promise<BrokerDiagnosticsResult> {
    const module = this.brokerRegistry.getOptional(route.connection.brokerKey);

    if (!module) {
      throw new BadRequestAppError(
        `No runtime module is registered for broker key: ${route.connection.brokerKey}`
      );
    }

    return {
      detail: `${module.displayName} routing key is registered`,
    };
  }
}
