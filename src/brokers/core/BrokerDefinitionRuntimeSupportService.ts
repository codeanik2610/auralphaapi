import { Inject, Service } from 'typedi';
import { BadRequestAppError } from '../../api';
import { ExchangeRepository } from '../../database';
import { BrokerExchangeAssetSyncService } from '../capabilities/sync';
import { BrokerDiagnosticsService } from './BrokerDiagnosticsService';
import { BrokerDefinition } from './BrokerDefinitionService';
import { BrokerRegistry } from './BrokerRegistry';
import { BrokerRuntimeRegistry } from './BrokerRuntimeRegistry';

type BrokerDefinitionRuntimeCandidate = Pick<
  BrokerDefinition,
  | 'brokerKey'
  | 'category'
  | 'providerType'
  | 'capabilities'
  | 'diagnostics'
  | 'linkedExchangeKey'
>;

const SUPPORTED_CAPABILITIES = new Set([
  'assets',
  'diagnostics',
  'leverage',
  'market',
  'orders',
  'positions',
  'wallet',
]);

@Service()
export class BrokerDefinitionRuntimeSupportService {
  @Inject(() => ExchangeRepository)
  private exchangeRepository!: ExchangeRepository;

  @Inject(() => BrokerRegistry)
  private brokerRegistry!: BrokerRegistry;

  @Inject(() => BrokerRuntimeRegistry)
  private brokerRuntimeRegistry!: BrokerRuntimeRegistry;

  @Inject(() => BrokerDiagnosticsService)
  private brokerDiagnosticsService!: BrokerDiagnosticsService;

  @Inject(() => BrokerExchangeAssetSyncService)
  private brokerExchangeAssetSyncService!: BrokerExchangeAssetSyncService;

  async validateDefinition(candidate: BrokerDefinitionRuntimeCandidate): Promise<void> {
    const brokerKey = this.normalizeKey(candidate.brokerKey);
    const category = this.normalizeKey(candidate.category);
    const providerType = this.normalizeKey(candidate.providerType);
    const linkedExchangeKey = this.normalizeKey(candidate.linkedExchangeKey || '');
    const capabilities = Array.from(
      new Set((candidate.capabilities ?? []).map((item) => this.normalizeKey(item)).filter(Boolean))
    );
    const module = this.brokerRegistry.getOptional(brokerKey);

    if (!module) {
      throw new BadRequestAppError(
        `Broker runtime module is not registered for key: ${brokerKey}`
      );
    }

    if (module.category !== category) {
      throw new BadRequestAppError(
        `category must match registered runtime category "${module.category}" for brokerKey: ${brokerKey}`
      );
    }

    if (module.providerType !== providerType) {
      throw new BadRequestAppError(
        `providerType must match registered runtime providerType "${module.providerType}" for brokerKey: ${brokerKey}`
      );
    }

    if (linkedExchangeKey) {
      const exchange = await this.exchangeRepository.getExchangeByKey(linkedExchangeKey);
      if (!exchange) {
        throw new BadRequestAppError(
          `Exchange master record not found for linkedExchangeKey: ${linkedExchangeKey}`
        );
      }
    }

    const unsupportedCapabilities = capabilities.filter(
      (capability) => !SUPPORTED_CAPABILITIES.has(capability)
    );
    if (unsupportedCapabilities.length) {
      throw new BadRequestAppError(
        `Unsupported broker capabilities: ${unsupportedCapabilities.join(', ')}`
      );
    }

    const diagnosticsExecutorKey = String(candidate.diagnostics?.executorKey || '').trim();
    if (diagnosticsExecutorKey && !this.brokerDiagnosticsService.hasExecutorKey(diagnosticsExecutorKey)) {
      throw new BadRequestAppError(
        `Diagnostics executor not registered for key: ${diagnosticsExecutorKey}`
      );
    }

    const capabilityErrors = capabilities.filter((capability) => {
      switch (capability) {
        case 'market':
          return !this.brokerRuntimeRegistry.supportsMarketAdapter(brokerKey);
        case 'orders':
          return !this.brokerRuntimeRegistry.supportsOrdersAdapter(brokerKey);
        case 'positions':
          return !this.brokerRuntimeRegistry.supportsPositionsAdapter(brokerKey);
        case 'wallet':
          return !this.brokerRuntimeRegistry.supportsWalletAdapter(brokerKey);
        case 'assets':
          return !this.brokerExchangeAssetSyncService.supportsSource(brokerKey);
        case 'leverage':
          return !this.supportsLeverageCapability(brokerKey);
        case 'diagnostics':
          return !this.resolveDiagnosticsExecutorKey(brokerKey, diagnosticsExecutorKey);
        default:
          return false;
      }
    });

    if (capabilityErrors.length) {
      throw new BadRequestAppError(
        `Capabilities not supported by runtime for ${brokerKey}: ${capabilityErrors.join(', ')}`
      );
    }
  }

  private resolveDiagnosticsExecutorKey(
    brokerKey: string,
    configuredExecutorKey?: string
  ): string | null {
    if (configuredExecutorKey) {
      return this.brokerDiagnosticsService.hasExecutorKey(configuredExecutorKey)
        ? configuredExecutorKey
        : null;
    }

    if (brokerKey === 'binance' && this.brokerDiagnosticsService.hasExecutorKey('binance-market')) {
      return 'binance-market';
    }

    if (
      this.brokerRegistry.getOptional(brokerKey) &&
      this.brokerDiagnosticsService.hasExecutorKey('registered-route')
    ) {
      return 'registered-route';
    }

    return null;
  }

  private supportsLeverageCapability(brokerKey: string): boolean {
    return brokerKey === 'mudrex' || brokerKey === 'delta_exchange';
  }

  private normalizeKey(value: string): string {
    return String(value || '').trim().toLowerCase();
  }
}
