import { Inject, Service } from 'typedi';
import { BadRequestAppError } from '../../api';
import { BrokerDefinitionRuntimeSupportService } from './BrokerDefinitionRuntimeSupportService';
import { BrokerDefinitionService } from './BrokerDefinitionService';

@Service()
export class BrokerDefinitionStartupValidator {
  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => BrokerDefinitionRuntimeSupportService)
  private brokerDefinitionRuntimeSupportService!: BrokerDefinitionRuntimeSupportService;

  async validate(): Promise<void> {
    const definitions = await this.brokerDefinitionService.listDefinitions({ includeInactive: true });

    for (const definition of definitions) {
      try {
        await this.brokerDefinitionRuntimeSupportService.validateDefinition(definition);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new BadRequestAppError(
          `Broker definition startup validation failed for ${definition.brokerKey}: ${message}`
        );
      }
    }
  }
}
