import { createHash } from 'node:crypto';
import { Inject, Service } from 'typedi';
import {
  MudrexFeeHistoryItem,
  MudrexAsset,
  MudrexFuturesFunds,
  MudrexOrder,
  MudrexPositionHistoryItem,
  MudrexWalletFunds,
} from '../contracts/Mudrex';
import {
  BrokerReconciliationRepository,
  BrokerReconciliationRunFinish,
} from '../../database/repositories/BrokerReconciliationRepository';
import { FeesService, MudrexService, OrdersService, PositionsService, WalletService } from '../../brokers';

export interface MudrexBrokerReconciliationSyncInput {
  userId: string;
  accountId: string;
  startDate?: string | null;
  endDate?: string | null;
  feeLimit?: number | null;
  maxFeePages?: number | null;
  orderLimit?: number | null;
  positionLimit?: number | null;
  runType?: string | null;
}

export interface MudrexBrokerReconciliationSyncResult {
  runId: string;
  brokerKey: 'mudrex';
  accountId: string;
  startedAt: string;
  finishedAt: string;
  feeRowsFetched: number;
  feeEntriesUpserted: number;
  estimatedFeeEntriesUpserted?: number;
  fundingEntriesUpserted: number;
  fillRowsFetched: number;
  fillsUpserted: number;
  positionRowsFetched: number;
  balanceSnapshotsUpserted: number;
  grossPnl: number;
  feeTotal: number;
  estimatedFeeTotal?: number;
  fundingTotal: number;
}

@Service()
export class MudrexBrokerReconciliationSyncService {
  @Inject(() => FeesService)
  private feesService!: FeesService;

  @Inject(() => OrdersService)
  private ordersService!: OrdersService;

  @Inject(() => PositionsService)
  private positionsService!: PositionsService;

  @Inject(() => WalletService)
  private walletService!: WalletService;

  @Inject(() => MudrexService)
  private mudrexService!: MudrexService;

  @Inject(() => BrokerReconciliationRepository)
  private brokerReconciliationRepository!: BrokerReconciliationRepository;

  async syncAccount(
    input: MudrexBrokerReconciliationSyncInput
  ): Promise<MudrexBrokerReconciliationSyncResult> {
    const userId = this.requiredString(input.userId, 'userId');
    const accountId = this.requiredString(input.accountId, 'accountId');
    const startedAt = new Date();
    const windowStart = this.dateOrNull(input.startDate);
    const windowEnd = this.dateOrNull(input.endDate);
    const runId = await this.brokerReconciliationRepository.createReconciliationRun({
      userId,
      brokerKey: 'mudrex',
      accountId,
      runType: this.readString(input.runType) || 'mudrex_reconciliation_sync',
      windowStartAt: windowStart,
      windowEndAt: windowEnd,
      startedAt,
      summaryPayload: {
        phase: 3,
        brokerKey: 'mudrex',
        source: 'mudrex_fee_history_order_history_position_history_funds',
      },
    });

    try {
      const [walletFunds, futuresFunds] = await this.fetchFunds(userId, accountId);
      const balanceSnapshotsUpserted = await this.storeBalanceSnapshot({
        userId,
        accountId,
        walletFunds,
        futuresFunds,
        observedAt: startedAt,
      });

      const orders = await this.fetchOrderHistory({
        userId,
        accountId,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: this.limit(input.orderLimit, 50_000, 50_000),
      });
      const fillsUpserted = await this.storeFilledOrderHistory({ userId, accountId, orders });

      const positionHistory = await this.fetchPositionHistory({
        userId,
        accountId,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: this.limit(input.positionLimit, 50_000, 50_000),
      });
      const grossPnl = positionHistory.reduce((sum, item) => sum + this.toNumber(item.pnl), 0);

      const feeHistory = await this.fetchFeeHistory({
        userId,
        accountId,
        limit: this.limit(input.feeLimit, 100, 50_000),
        maxPages: this.limit(input.maxFeePages, 20, 500),
        windowStart,
        windowEnd,
      });
      const feeStorage = await this.storeFeeHistory({ userId, accountId, feeHistory });
      const estimatedFeeStorage =
        feeHistory.length === 0
          ? await this.storeEstimatedOrderFees({
              userId,
              accountId,
              orders,
            })
          : { feeEntriesUpserted: 0, feeTotal: 0, symbolsWithoutRates: [] as string[] };
      const feeEntriesUpserted =
        feeStorage.feeEntriesUpserted + estimatedFeeStorage.feeEntriesUpserted;
      const feeTotal = feeStorage.feeTotal + estimatedFeeStorage.feeTotal;

      const finishedAt = new Date();
      const finishPayload: BrokerReconciliationRunFinish = {
        status: 'completed',
        finishedAt,
        fillsCount: fillsUpserted,
        feeEntriesCount: feeEntriesUpserted,
        fundingEntriesCount: feeStorage.fundingEntriesUpserted,
        balanceSnapshotsCount: balanceSnapshotsUpserted,
        grossPnl,
        feesTotal: feeTotal,
        fundingTotal: feeStorage.fundingTotal,
        netPnl: grossPnl + feeTotal + feeStorage.fundingTotal,
        summaryPayload: {
          phase: 3,
          brokerKey: 'mudrex',
          feeRowsFetched: feeHistory.length,
          feeRowsSource:
            feeHistory.length > 0
              ? 'mudrex_fee_history'
              : estimatedFeeStorage.feeEntriesUpserted > 0
                ? 'mudrex_order_fee_estimate'
                : 'none',
          estimatedFeeEntriesUpserted: estimatedFeeStorage.feeEntriesUpserted,
          estimatedFeeTotal: estimatedFeeStorage.feeTotal,
          estimatedFeeSymbolsWithoutRates: estimatedFeeStorage.symbolsWithoutRates,
          fillRowsFetched: orders.length,
          positionRowsFetched: positionHistory.length,
          balanceSnapshotsUpserted,
        },
      };
      await this.brokerReconciliationRepository.finishReconciliationRun(runId, finishPayload);

      return {
        runId,
        brokerKey: 'mudrex',
        accountId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        feeRowsFetched: feeHistory.length,
        feeEntriesUpserted,
        estimatedFeeEntriesUpserted: estimatedFeeStorage.feeEntriesUpserted,
        fundingEntriesUpserted: feeStorage.fundingEntriesUpserted,
        fillRowsFetched: orders.length,
        fillsUpserted,
        positionRowsFetched: positionHistory.length,
        balanceSnapshotsUpserted,
        grossPnl,
        feeTotal,
        estimatedFeeTotal: estimatedFeeStorage.feeTotal,
        fundingTotal: feeStorage.fundingTotal,
      };
    } catch (error) {
      await this.brokerReconciliationRepository.finishReconciliationRun(runId, {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
        summaryPayload: {
          phase: 3,
          brokerKey: 'mudrex',
          failure: true,
        },
      });
      throw error;
    }
  }

  private async fetchFunds(
    userId: string,
    accountId: string
  ): Promise<[MudrexWalletFunds, MudrexFuturesFunds]> {
    const [walletResponse, futuresResponse] = await Promise.all([
      this.walletService.getWalletFunds(userId, accountId),
      this.walletService.getFuturesFunds(userId, accountId),
    ]);

    return [walletResponse.data, futuresResponse.data];
  }

  private async fetchOrderHistory(input: {
    userId: string;
    accountId: string;
    startDate?: string | null;
    endDate?: string | null;
    limit: number;
  }): Promise<MudrexOrder[]> {
    const response = await this.ordersService.getFuturesOrderHistory(
      {
        limit: String(input.limit),
        ...(input.startDate ? { startDate: this.toDateOnly(input.startDate) } : {}),
        ...(input.endDate ? { endDate: this.toDateOnly(input.endDate) } : {}),
      },
      input.userId,
      input.accountId
    );
    return response.data;
  }

  private async fetchPositionHistory(input: {
    userId: string;
    accountId: string;
    startDate?: string | null;
    endDate?: string | null;
    limit: number;
  }): Promise<MudrexPositionHistoryItem[]> {
    const response = await this.positionsService.getPositionHistory(
      {
        limit: String(input.limit),
        ...(input.startDate ? { startDate: this.toDateOnly(input.startDate) } : {}),
        ...(input.endDate ? { endDate: this.toDateOnly(input.endDate) } : {}),
      },
      input.userId,
      input.accountId
    );
    return response.data;
  }

  private async fetchFeeHistory(input: {
    userId: string;
    accountId: string;
    limit: number;
    maxPages: number;
    windowStart: Date | null;
    windowEnd: Date | null;
  }): Promise<MudrexFeeHistoryItem[]> {
    const rows: MudrexFeeHistoryItem[] = [];
    for (let page = 0; page < input.maxPages; page += 1) {
      const offset = page * input.limit;
      const pageRows = await this.feesService.fetchFuturesFeeHistory(
        {
          limit: input.limit,
          offset,
        },
        input.userId,
        input.accountId
      );
      if (!pageRows.length) {
        break;
      }

      rows.push(
        ...pageRows.filter((item) =>
          this.isInsideWindow(item.created_at, input.windowStart, input.windowEnd)
        )
      );

      if (pageRows.length < input.limit) {
        break;
      }
    }
    return rows;
  }

  private async storeBalanceSnapshot(input: {
    userId: string;
    accountId: string;
    walletFunds: MudrexWalletFunds;
    futuresFunds: MudrexFuturesFunds;
    observedAt: Date;
  }): Promise<number> {
    await this.brokerReconciliationRepository.upsertBalanceSnapshot({
      userId: input.userId,
      brokerKey: 'mudrex',
      accountId: input.accountId,
      externalId: `mudrex:balance:${input.accountId}:${input.observedAt.toISOString()}`,
      walletBalance: input.walletFunds.total,
      futuresBalance: input.futuresFunds.balance,
      totalBalance:
        this.toNumber(input.walletFunds.total) + this.toNumber(input.futuresFunds.balance),
      availableBalance: this.readOptionalNumber(input.walletFunds.withdrawable),
      lockedAmount: input.futuresFunds.locked_amount,
      currency: 'USDT',
      observedAt: input.observedAt,
      rawPayload: {
        walletFunds: input.walletFunds,
        futuresFunds: input.futuresFunds,
      },
      source: 'mudrex_funds',
    });
    return 1;
  }

  private async storeFilledOrderHistory(input: {
    userId: string;
    accountId: string;
    orders: MudrexOrder[];
  }): Promise<number> {
    let upserted = 0;
    for (const order of input.orders) {
      if (this.toNumber(order.filled_quantity) <= 0) {
        continue;
      }

      await this.brokerReconciliationRepository.upsertFill({
        userId: input.userId,
        brokerKey: 'mudrex',
        accountId: input.accountId,
        externalId: `mudrex:order-fill:${order.id}`,
        orderId: order.id,
        positionId: this.readString(
          (order as unknown as Record<string, unknown>).future_position_uuid
        ),
        symbol: order.symbol,
        side: this.normalizeMudrexOrderSide(order.order_type),
        orderType: order.order_type,
        tradeCurrency: order.trade_currency || 'USDT',
        quantity: order.filled_quantity,
        price: order.filled_price,
        notional: order.actual_amount,
        filledAt: order.updated_at || order.created_at,
        rawPayload: order as unknown as Record<string, unknown>,
        matchState: 'unmatched',
        matchConfidence: 'unknown',
        source: 'mudrex_order_history',
      });
      upserted += 1;
    }
    return upserted;
  }

  private async storeFeeHistory(input: {
    userId: string;
    accountId: string;
    feeHistory: MudrexFeeHistoryItem[];
  }): Promise<{
    feeEntriesUpserted: number;
    fundingEntriesUpserted: number;
    feeTotal: number;
    fundingTotal: number;
  }> {
    let feeEntriesUpserted = 0;
    let fundingEntriesUpserted = 0;
    let feeTotal = 0;
    let fundingTotal = 0;

    for (const item of input.feeHistory) {
      const feeType = this.readString(item.fee_type).toUpperCase();
      const accountingAmount = this.toAccountingDebit(item.fee_amount);
      const base = {
        userId: input.userId,
        brokerKey: 'mudrex',
        accountId: input.accountId,
        externalId: this.buildFeeExternalId(item),
        symbol: item.symbol,
        amount: accountingAmount,
        currency: 'USDT',
        transactionAmount: item.transaction_amount,
        occurredAt: item.created_at,
        rawPayload: item as unknown as Record<string, unknown>,
        matchState: 'unmatched' as const,
        matchConfidence: 'low' as const,
        source: 'mudrex_fee_history',
      };

      if (feeType === 'FUNDING') {
        await this.brokerReconciliationRepository.upsertFundingEntry({
          ...base,
          fundingRatePct: item.fee_perc,
        });
        fundingEntriesUpserted += 1;
        fundingTotal += accountingAmount;
        continue;
      }

      await this.brokerReconciliationRepository.upsertFeeEntry({
        ...base,
        feeType: feeType || 'TRANSACTION',
        feeRatePct: item.fee_perc,
      });
      feeEntriesUpserted += 1;
      feeTotal += accountingAmount;
    }

    return { feeEntriesUpserted, fundingEntriesUpserted, feeTotal, fundingTotal };
  }

  private async storeEstimatedOrderFees(input: {
    userId: string;
    accountId: string;
    orders: MudrexOrder[];
  }): Promise<{
    feeEntriesUpserted: number;
    feeTotal: number;
    symbolsWithoutRates: string[];
  }> {
    const filledOrders = input.orders.filter((order) => this.toNumber(order.filled_quantity) > 0);
    if (!filledOrders.length) {
      return { feeEntriesUpserted: 0, feeTotal: 0, symbolsWithoutRates: [] };
    }

    const feeRatesBySymbol = await this.resolveTradingFeeRates(input.userId, filledOrders);
    const symbolsWithoutRates = new Set<string>();
    let feeEntriesUpserted = 0;
    let feeTotal = 0;

    for (const order of filledOrders) {
      const symbol = this.readString(order.symbol).toUpperCase();
      if (!symbol) {
        continue;
      }

      const feeRatePct = feeRatesBySymbol.get(symbol);
      if (feeRatePct === undefined || feeRatePct === null || !Number.isFinite(feeRatePct)) {
        symbolsWithoutRates.add(symbol);
        continue;
      }

      const transactionAmount = this.resolveOrderNotional(order);
      if (!Number.isFinite(transactionAmount) || transactionAmount <= 0) {
        continue;
      }

      const estimatedFee = -Math.abs((transactionAmount * feeRatePct) / 100);
      if (!Number.isFinite(estimatedFee) || estimatedFee === 0) {
        continue;
      }

      await this.brokerReconciliationRepository.upsertFeeEntry({
        userId: input.userId,
        brokerKey: 'mudrex',
        accountId: input.accountId,
        externalId: `mudrex:estimated-order-fee:${order.id}`,
        symbol,
        orderId: order.id,
        positionId: this.readString(
          (order as unknown as Record<string, unknown>).future_position_uuid
        ),
        feeType: 'TRANSACTION_ESTIMATE',
        amount: estimatedFee,
        currency: order.trade_currency || 'USDT',
        transactionAmount,
        feeRatePct,
        occurredAt: order.updated_at || order.created_at,
        rawPayload: {
          order,
          estimate: {
            source: 'mudrex_order_fee_estimate',
            reason: 'mudrex_fee_history_empty',
            transactionAmount,
            feeRatePct,
          },
        },
        matchState: 'unmatched',
        matchConfidence: 'low',
        source: 'mudrex_order_fee_estimate',
      });
      feeEntriesUpserted += 1;
      feeTotal += estimatedFee;
    }

    return {
      feeEntriesUpserted,
      feeTotal: Number(feeTotal.toFixed(12)),
      symbolsWithoutRates: Array.from(symbolsWithoutRates).sort(),
    };
  }

  private async resolveTradingFeeRates(
    userId: string,
    orders: MudrexOrder[]
  ): Promise<Map<string, number>> {
    const requestedSymbols = new Set(
      orders
        .map((order) => this.readString(order.symbol).toUpperCase())
        .filter(Boolean)
    );
    const ratesBySymbol = new Map<string, number>();
    if (!requestedSymbols.size || !this.mudrexService) {
      return ratesBySymbol;
    }

    try {
      const assets = await this.mudrexService.fetchAllRemoteFuturesForUserOrThrow(500, userId);
      for (const asset of assets) {
        this.addTradingFeeRate(ratesBySymbol, requestedSymbols, asset);
      }
    } catch {
      return ratesBySymbol;
    }

    return ratesBySymbol;
  }

  private addTradingFeeRate(
    ratesBySymbol: Map<string, number>,
    requestedSymbols: Set<string>,
    asset: MudrexAsset
  ): void {
    const symbol = this.readString(asset.symbol).toUpperCase();
    if (!symbol || !requestedSymbols.has(symbol) || ratesBySymbol.has(symbol)) {
      return;
    }
    const feeRatePct = this.toNumber(asset.trading_fee_perc);
    if (!Number.isFinite(feeRatePct) || feeRatePct <= 0) {
      return;
    }
    ratesBySymbol.set(symbol, feeRatePct);
  }

  private resolveOrderNotional(order: MudrexOrder): number {
    const actualAmount = this.toNumber(order.actual_amount);
    if (actualAmount > 0) {
      return actualAmount;
    }

    const filledQuantity = this.toNumber(order.filled_quantity);
    const filledPrice = this.toNumber(order.filled_price);
    if (filledQuantity > 0 && filledPrice > 0) {
      return filledQuantity * filledPrice;
    }

    const quantity = this.toNumber(order.quantity);
    const price = this.toNumber(order.price);
    return quantity > 0 && price > 0 ? quantity * price : 0;
  }

  private buildFeeExternalId(item: MudrexFeeHistoryItem): string {
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          symbol: item.symbol,
          fee_amount: item.fee_amount,
          fee_perc: item.fee_perc,
          fee_type: item.fee_type,
          created_at: item.created_at,
          transaction_amount: item.transaction_amount,
        })
      )
      .digest('hex')
      .slice(0, 24);
    return `mudrex:fee:${hash}`;
  }

  private normalizeMudrexOrderSide(orderType: string): string | null {
    const normalized = this.readString(orderType).toUpperCase();
    if (normalized === 'LONG') return 'long';
    if (normalized === 'SHORT') return 'short';
    if (normalized === 'STOPLOSS' || normalized === 'TAKEPROFIT') return 'exit';
    return normalized.toLowerCase() || null;
  }

  private toAccountingDebit(value: unknown): number {
    const amount = this.toNumber(value);
    if (amount < 0) {
      return amount;
    }
    return -Math.abs(amount);
  }

  private isInsideWindow(value: string, start: Date | null, end: Date | null): boolean {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      return false;
    }
    if (start && timestamp < start.getTime()) {
      return false;
    }
    if (end && timestamp > end.getTime()) {
      return false;
    }
    return true;
  }

  private limit(value: unknown, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  private dateOrNull(value: unknown): Date | null {
    const text = this.readString(value);
    if (!text) {
      return null;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toDateOnly(value: unknown): string {
    const text = this.readString(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return text;
    }
    return date.toISOString().slice(0, 10);
  }

  private requiredString(value: unknown, fieldName: string): string {
    const text = this.readString(value);
    if (!text) {
      throw new Error(`Mudrex reconciliation ${fieldName} is required`);
    }
    return text;
  }

  private readString(value: unknown): string {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  private readOptionalNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
