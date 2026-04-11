import { Inject, Service } from 'typedi';
import { WalletService } from '../../providers/mudrex';
import { BrokerWalletAdapter, BrokerWalletContext } from './types';

@Service()
export class MudrexWalletAdapter implements BrokerWalletAdapter {
  @Inject(() => WalletService)
  private walletService!: WalletService;

  async getWalletFunds(context?: BrokerWalletContext): Promise<unknown> {
    return this.walletService.getWalletFunds(context?.userId, context?.accountId);
  }

  async getFuturesFunds(context?: BrokerWalletContext): Promise<unknown> {
    return this.walletService.getFuturesFunds(context?.userId, context?.accountId);
  }
}
