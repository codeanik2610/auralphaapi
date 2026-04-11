import { Connection } from '../../../database';

export interface BrokerDiagnosticsRoute {
  userId: string;
  connection: Connection;
  accountId?: string;
}

export interface BrokerDiagnosticsResult {
  detail: string;
}

export interface BrokerDiagnosticsExecutor {
  readonly key: string;
  execute(route: BrokerDiagnosticsRoute): Promise<BrokerDiagnosticsResult>;
}
