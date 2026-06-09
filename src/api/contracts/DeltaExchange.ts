export interface DeltaExchangeEnvelope<T> {
  success: boolean;
  result: T;
  meta?: {
    after?: string | null;
    before?: string | null;
  };
}

export interface DeltaExchangeProduct {
  id?: number | string;
  symbol?: string;
  contract_value?: string | number | null;
  contract_unit_currency?: string | null;
}

export interface DeltaExchangeFill {
  id?: number | string;
  size?: string | number | null;
  fill_type?: string | null;
  side?: string | null;
  price?: string | number | null;
  role?: string | null;
  commission?: string | number | null;
  created_at?: string;
  product_id?: number | string | null;
  product_symbol?: string | null;
  order_id?: number | string | null;
  settling_asset_id?: number | string | null;
  settling_asset_symbol?: string | null;
  meta_data?: Record<string, unknown> | null;
}

export interface DeltaExchangeWalletBalance {
  asset_id?: number | string;
  asset_symbol?: string;
  available_balance?: string | number | null;
  balance?: string | number | null;
  blocked_margin?: string | number | null;
  cross_locked_collateral?: string | number | null;
  cross_order_margin?: string | number | null;
  cross_position_margin?: string | number | null;
  order_margin?: string | number | null;
  position_margin?: string | number | null;
  portfolio_margin?: string | number | null;
}

export interface DeltaExchangeWalletTransaction {
  id?: number | string;
  amount?: string | number | null;
  balance?: string | number | null;
  transaction_type?: string | null;
  meta_data?: Record<string, unknown> | null;
  product_id?: number | string | null;
  asset_id?: number | string | null;
  asset_symbol?: string | null;
  created_at?: string;
}
