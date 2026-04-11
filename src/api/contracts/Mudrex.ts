export interface MudrexAsset {
  id: string;
  name: string;
  symbol: string;
  min_contract: string;
  max_contract: string;
  quantity_step: string;
  min_price: string;
  max_price: string;
  price_step: string;
  max_market_contract: string;
  min_notional_value: string;
  funding_fee_perc: string;
  max_funding_rate: string | null;
  min_funding_rate: string | null;
  trading_fee_perc?: string;
  leverage_step: string;
  min_leverage: string;
  max_leverage: string;
  funding_interval: number;
  price: string;
  last_day_price: string;
  change_perc: string;
  volume: string;
  popularity: string;
}

export interface MudrexAssetDetail extends MudrexAsset {
  '1d_high': number;
  '1d_low': number;
  '1d_volume': number;
}

export interface MudrexWalletFunds {
  total: number;
  rewards: number;
  invested: number;
  withdrawable: number;
  coin_investable: number;
  coinset_investable: number;
  vault_investable: number;
}

export interface MudrexFuturesFunds {
  balance: string;
  locked_amount: string;
  first_time_user: boolean;
}

export interface MudrexLeverage {
  Leverage: string;
  MarginType: string;
}

export interface MudrexLeveragePayload {
  leverage: string;
  margin_type: string;
  collateral_currency_id?: number;
}

export interface MudrexOrderReason {
  message: string;
}

export interface MudrexOrder {
  created_at: string;
  updated_at: string;
  reason: MudrexOrderReason | null;
  actual_amount: number;
  desired_amount?: number;
  quantity: number;
  filled_quantity: number;
  price: number;
  filled_price: number;
  leverage: number;
  liquidation_price?: number;
  hedge_rate?: number;
  trade_currency?: string;
  order_type: string;
  trigger_type: string;
  status: string;
  side?: string;
  id: string;
  asset_uuid: string;
  symbol: string;
}

export interface MudrexCreateOrderResult {
  leverage: string;
  amount: string;
  quantity: string;
  price: string;
  order_id: string;
  status: string;
  message: string;
}

export interface MudrexCancelOrderResult {
  message: string;
  order_id: string;
  status: string;
}

export interface MudrexPositionExitOrder {
  price: string;
  order_id: string;
  order_type: string;
}

export interface MudrexPosition {
  created_at: string;
  updated_at: string;
  stoploss: MudrexPositionExitOrder | null;
  takeprofit: MudrexPositionExitOrder | null;
  entry_price: string;
  quantity: string;
  leverage: string;
  liquidation_price: string;
  order_type: string;
  status: string;
  id: string;
  asset_uuid: string;
  symbol: string;
}

export interface MudrexPositionLiqPrice {
  value: string;
}

export interface MudrexPositionMarginUpdate {
  message: string;
  initial_margin: string;
  liquidation_price: string;
}

export interface MudrexPositionRiskOrder {
  position_id: string;
  status: string;
  message: string;
}

export interface MudrexPositionHistoryItem {
  id?: string;
  position_type: string;
  status: string;
  leverage: string;
  entry_price: string;
  closed_price: string;
  quantity: string;
  pnl: string;
  created_at: string;
  updated_at: string;
  asset_uuid: string;
  symbol: string;
  trade_currency?: string;
  entry_hedge_rate?: string;
  exit_hedge_rate?: string;
}
