export interface BrokerWalletContext {
  userId?: string;
  brokerKey?: string;
  accountId?: string;
}

export interface BrokerWalletAdapter {
  getWalletFunds(context?: BrokerWalletContext): Promise<unknown>;
  getFuturesFunds(context?: BrokerWalletContext): Promise<unknown>;
}
