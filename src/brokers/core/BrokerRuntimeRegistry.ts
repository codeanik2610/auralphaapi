import { Inject, Service } from 'typedi';
import { BadRequestAppError } from '../../api';
import { BinanceMarketAdapter } from '../capabilities/market';
import { DeltaExchangeMarketAdapter } from '../capabilities/market';
import { MudrexMarketAdapter } from '../capabilities/market';
import { BrokerMarketAdapter } from '../capabilities/market';
import { DeltaExchangeOrdersAdapter } from '../capabilities/orders';
import { MudrexOrdersAdapter } from '../capabilities/orders';
import { BrokerOrdersAdapter } from '../capabilities/orders';
import { DeltaExchangePositionsAdapter } from '../capabilities/positions';
import { MudrexPositionsAdapter } from '../capabilities/positions';
import { BrokerPositionsAdapter } from '../capabilities/positions';
import { DeltaExchangeWalletAdapter } from '../capabilities/wallet';
import { MudrexWalletAdapter } from '../capabilities/wallet';
import { BrokerWalletAdapter } from '../capabilities/wallet';

@Service()
export class BrokerRuntimeRegistry {
  @Inject(() => BinanceMarketAdapter)
  private binanceMarketAdapter!: BinanceMarketAdapter;

  @Inject(() => DeltaExchangeMarketAdapter)
  private deltaExchangeMarketAdapter!: DeltaExchangeMarketAdapter;

  @Inject(() => MudrexMarketAdapter)
  private mudrexMarketAdapter!: MudrexMarketAdapter;

  @Inject(() => DeltaExchangeOrdersAdapter)
  private deltaExchangeOrdersAdapter!: DeltaExchangeOrdersAdapter;

  @Inject(() => MudrexOrdersAdapter)
  private mudrexOrdersAdapter!: MudrexOrdersAdapter;

  @Inject(() => DeltaExchangePositionsAdapter)
  private deltaExchangePositionsAdapter!: DeltaExchangePositionsAdapter;

  @Inject(() => MudrexPositionsAdapter)
  private mudrexPositionsAdapter!: MudrexPositionsAdapter;

  @Inject(() => DeltaExchangeWalletAdapter)
  private deltaExchangeWalletAdapter!: DeltaExchangeWalletAdapter;

  @Inject(() => MudrexWalletAdapter)
  private mudrexWalletAdapter!: MudrexWalletAdapter;

  private normalizeBrokerKey(brokerKey?: string | null): string {
    return String(brokerKey || '').trim().toLowerCase();
  }

  supportsMarketAdapter(brokerKey?: string | null): boolean {
    return ['binance', 'delta_exchange', 'mudrex'].includes(
      this.normalizeBrokerKey(brokerKey)
    );
  }

  supportsOrdersAdapter(brokerKey?: string | null): boolean {
    return ['delta_exchange', 'mudrex'].includes(this.normalizeBrokerKey(brokerKey));
  }

  supportsPositionsAdapter(brokerKey?: string | null): boolean {
    return ['delta_exchange', 'mudrex'].includes(this.normalizeBrokerKey(brokerKey));
  }

  supportsWalletAdapter(brokerKey?: string | null): boolean {
    return ['delta_exchange', 'mudrex'].includes(this.normalizeBrokerKey(brokerKey));
  }

  getMarketAdapter(brokerKey?: string | null): BrokerMarketAdapter {
    switch (this.normalizeBrokerKey(brokerKey) || 'binance') {
      case 'binance':
        return this.binanceMarketAdapter;
      case 'delta_exchange':
        return this.deltaExchangeMarketAdapter;
      case 'mudrex':
        return this.mudrexMarketAdapter;
      default:
        throw new BadRequestAppError('Unsupported brokerKey for market data');
    }
  }

  getOrdersAdapter(brokerKey?: string | null): BrokerOrdersAdapter {
    switch (brokerKey || 'mudrex') {
      case 'mudrex':
        return this.mudrexOrdersAdapter;
      case 'delta_exchange':
        return this.deltaExchangeOrdersAdapter;
      default:
        throw new BadRequestAppError('Unsupported brokerKey for orders');
    }
  }

  getPositionsAdapter(brokerKey?: string | null): BrokerPositionsAdapter {
    switch (brokerKey || 'mudrex') {
      case 'mudrex':
        return this.mudrexPositionsAdapter;
      case 'delta_exchange':
        return this.deltaExchangePositionsAdapter;
      default:
        throw new BadRequestAppError('Unsupported brokerKey for positions');
    }
  }

  getWalletAdapter(brokerKey?: string | null): BrokerWalletAdapter {
    switch (brokerKey || 'mudrex') {
      case 'mudrex':
        return this.mudrexWalletAdapter;
      case 'delta_exchange':
        return this.deltaExchangeWalletAdapter;
      default:
        throw new BadRequestAppError('Unsupported brokerKey for wallet');
    }
  }
}
