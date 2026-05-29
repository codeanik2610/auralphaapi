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

export interface SmcStrategySummary {
  trades: number;
  targets: number;
  stops: number;
  breakeven: number;
  expired: number;
  winRate: number;
  totalR: number;
  avgR: number;
  maxLosingStreak: number;
}

export interface SmcStrategyStats {
  maxDrawdownR: number;
  profitFactor: number;
  maxOpenTrades: number;
}

export interface SmcStrategyTrade {
  side: 'long' | 'short';
  outcome: 'target' | 'stop' | 'breakeven' | 'expired';
  realizedR: number;
  sweepTime: string;
  mssTime: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  stopLoss: number;
  oneRStopMove: number;
  rewardR: number;
  targetR: number;
  exitPrice: number;
}

export interface SmcStrategyComparisonMetric {
  expected: number;
  actual: number;
  matches: boolean;
}

export interface SmcStrategyComparison {
  expectedFrom: string;
  metrics: Record<string, SmcStrategyComparisonMetric>;
  matches: boolean;
}

export interface SolSmcOnePositionStrategyResult {
  strategyId: string;
  strategy: 'solusdt-3m-smc-one-position-sidehour';
  symbol: 'SOLUSDT';
  interval: '3m';
  limit: number;
  windowStart: string;
  windowEnd: string;
  validationStart: string;
  candles: number;
  settings: Record<string, unknown>;
  full: SmcStrategySummary;
  train: SmcStrategySummary;
  validation: SmcStrategySummary;
  stats: SmcStrategyStats;
  comparison: SmcStrategyComparison;
  trades: SmcStrategyTrade[];
  charts: Record<string, string>;
  artifacts: {
    summaryPath: string | null;
    strategyPath: string | null;
  };
}

export type StrategyExecutionResult = AlertConfirmStrategyResult | SolSmcOnePositionStrategyResult;
