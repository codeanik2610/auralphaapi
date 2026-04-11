import { Inject, Service } from 'typedi';
import { BrokerWalletAdapter, BrokerWalletContext } from './types';
import { DeltaExchangeHttpClient } from '../../providers/delta_exchange/DeltaExchangeHttpClient';

interface DeltaWalletBalance {
  asset_symbol?: string;
  balance?: string | number | null;
  available_balance?: string | number | null;
}

@Service()
export class DeltaExchangeWalletAdapter implements BrokerWalletAdapter {
  @Inject(() => DeltaExchangeHttpClient)
  private deltaHttpClient!: DeltaExchangeHttpClient;

  async getWalletFunds(context?: BrokerWalletContext): Promise<unknown> {
    const balances = await this.fetchBalances(context?.accountId, context?.userId);
    const total = balances.reduce((sum, item) => sum + this.toNumber(item.balance), 0);
    const withdrawable = balances.reduce(
      (sum, item) => sum + this.toNumber(item.available_balance ?? item.balance),
      0
    );

    return {
      total,
      rewards: 0,
      invested: Math.max(total - withdrawable, 0),
      withdrawable,
      coin_investable: withdrawable,
      coinset_investable: 0,
      vault_investable: 0,
    };
  }

  async getFuturesFunds(context?: BrokerWalletContext): Promise<unknown> {
    const balances = await this.fetchBalances(context?.accountId, context?.userId);
    const total = balances.reduce((sum, item) => sum + this.toNumber(item.balance), 0);
    const withdrawable = balances.reduce(
      (sum, item) => sum + this.toNumber(item.available_balance ?? item.balance),
      0
    );

    return {
      balance: total.toFixed(2),
      locked_amount: Math.max(total - withdrawable, 0).toFixed(2),
      first_time_user: false,
    };
  }

  private async fetchBalances(
    accountId?: string,
    userId?: string
  ): Promise<DeltaWalletBalance[]> {
    const payload = await this.deltaHttpClient.signedGet<DeltaWalletBalance[] | { balance_details?: DeltaWalletBalance[] }>(
      accountId,
      '/v2/wallet/balances',
      undefined,
      userId
    );

    if (Array.isArray(payload)) {
      return payload;
    }

    return Array.isArray(payload?.balance_details) ? payload.balance_details : [];
  }

  private toNumber(value: string | number | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
