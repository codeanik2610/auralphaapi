import { Inject, Service } from 'typedi';
import { BadRequestAppError } from '../../api';
import { Connection } from '../../database';
import { BinanceMarketDiagnosticsExecutor } from '../capabilities/diagnostics';
import { DeltaExchangeDiagnosticsExecutor } from '../capabilities/diagnostics';
import { MudrexDiagnosticsExecutor } from '../capabilities/diagnostics';
import { RegisteredRouteDiagnosticsExecutor } from '../capabilities/diagnostics';
import { BrokerDiagnosticsExecutor, BrokerDiagnosticsResult } from '../capabilities/diagnostics';
import { BrokerDefinitionService } from './BrokerDefinitionService';

@Service()
export class BrokerDiagnosticsService {
  @Inject(() => BrokerDefinitionService)
  private brokerDefinitionService!: BrokerDefinitionService;

  @Inject(() => MudrexDiagnosticsExecutor)
  private mudrexDiagnosticsExecutor!: MudrexDiagnosticsExecutor;

  @Inject(() => DeltaExchangeDiagnosticsExecutor)
  private deltaExchangeDiagnosticsExecutor!: DeltaExchangeDiagnosticsExecutor;

  @Inject(() => BinanceMarketDiagnosticsExecutor)
  private binanceMarketDiagnosticsExecutor!: BinanceMarketDiagnosticsExecutor;

  @Inject(() => RegisteredRouteDiagnosticsExecutor)
  private registeredRouteDiagnosticsExecutor!: RegisteredRouteDiagnosticsExecutor;

  private get executors(): BrokerDiagnosticsExecutor[] {
    return [
      this.mudrexDiagnosticsExecutor,
      this.deltaExchangeDiagnosticsExecutor,
      this.binanceMarketDiagnosticsExecutor,
      this.registeredRouteDiagnosticsExecutor,
    ];
  }

  listExecutorKeys(): string[] {
    return this.executors.map((executor) => executor.key);
  }

  hasExecutorKey(executorKey?: string | null): boolean {
    const normalizedExecutorKey = String(executorKey || '').trim();
    return Boolean(
      normalizedExecutorKey &&
        this.executors.some((executor) => executor.key === normalizedExecutorKey)
    );
  }

  async testConnection(
    userId: string,
    connection: Connection,
    accountId?: string
  ): Promise<BrokerDiagnosticsResult> {
    const executorKey = await this.resolveExecutorKey(connection.brokerKey);
    const executor = this.executors.find((item) => item.key === executorKey);

    if (!executor) {
      throw new BadRequestAppError(`Diagnostics executor not registered for key: ${executorKey}`);
    }

    return executor.execute({
      userId,
      connection,
      accountId,
    });
  }

  async getStatusConfig(brokerKey: string): Promise<{
    successStatus: string;
    failureStatus: string;
    resetStatus: string;
  }> {
    try {
      const definition = await this.brokerDefinitionService.getRequiredDefinition(brokerKey);
      return {
        successStatus: definition.diagnostics?.successStatus || 'Connected',
        failureStatus: definition.diagnostics?.failureStatus || 'Disconnected',
        resetStatus: definition.diagnostics?.resetStatus || 'Idle',
      };
    } catch {
      return {
        successStatus: 'Connected',
        failureStatus: 'Disconnected',
        resetStatus: 'Idle',
      };
    }
  }

  private async resolveExecutorKey(brokerKey: string): Promise<string> {
    try {
      const definition = await this.brokerDefinitionService.getRequiredDefinition(brokerKey);
      const configuredExecutorKey = String(
        (definition.diagnostics as Record<string, unknown> | undefined)?.executorKey ?? ''
      ).trim();

      return configuredExecutorKey || 'registered-route';
    } catch {
      if (brokerKey === 'binance') {
        return 'binance-market';
      }

      return 'registered-route';
    }
  }
}
