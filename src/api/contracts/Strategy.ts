export interface StrategyTrade {
  side: 'BUY' | 'SELL';
  alertOpenTime: number;
  confirmOpenTime: number;
  alertHigh: string;
  alertLow: string;
  confirmClose: string;
  barsWaited: number;
}

export interface StrategyPendingAlert {
  state: 'idle' | 'waiting_buy_confirm' | 'waiting_sell_confirm';
  alertOpenTime?: number;
  alertHigh?: string;
  alertLow?: string;
  barsWaiting?: number;
}

export interface StrategyPersistenceSummary {
  detectedTrades: number;
  insertedTrades: number;
  duplicateTrades: number;
}

export interface StrategyParamDefinition {
  key: string;
  type: 'number' | 'string' | 'boolean';
  required: boolean;
  description: string;
  defaultValue?: string | number | boolean;
}

export interface StrategyCatalogItem {
  strategyId: string;
  name: string;
  description: string;
  paramsSchema: StrategyParamDefinition[];
}

export interface StrategyRunQuery {
  strategyId: string;
  symbols: string[];
  interval: string;
  limit: number;
  params: Record<string, string | number | boolean | undefined>;
  maxWaitBars?: number;
}

export interface AlertConfirmStrategySymbolResult {
  strategy: 'alert-confirm-no-same-direction-skip';
  symbol: string;
  interval: string;
  maxWaitBars: number;
  candlesAnalyzed: number;
  trades: StrategyTrade[];
  summary: {
    totalTrades: number;
    buyTrades: number;
    sellTrades: number;
  };
  persistence: StrategyPersistenceSummary;
  pendingAlert: StrategyPendingAlert;
}

export interface AlertConfirmStrategyResult {
  strategyId: string;
  strategy: 'alert-confirm-no-same-direction-skip';
  interval: string;
  limit: number;
  maxWaitBars: number;
  results: AlertConfirmStrategySymbolResult[];
}
