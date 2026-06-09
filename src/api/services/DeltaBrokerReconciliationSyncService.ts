import { createHash } from 'node:crypto';
import { Inject, Service } from 'typedi';
import {
  DeltaExchangeEnvelope,
  DeltaExchangeFill,
  DeltaExchangeProduct,
  DeltaExchangeWalletTransaction,
} from '../contracts/DeltaExchange';
import {
  BrokerReconciliationRepository,
  BrokerReconciliationRunFinish,
} from '../../database/repositories/BrokerReconciliationRepository';
import { DeltaExchangeHttpClient } from '../../brokers/providers/delta_exchange/DeltaExchangeHttpClient';
import { DeltaExchangePositionsAdapter } from '../../brokers/capabilities/positions/DeltaExchangePositionsAdapter';
import { DeltaExchangeWalletAdapter } from '../../brokers/capabilities/wallet/DeltaExchangeWalletAdapter';

export interface DeltaBrokerReconciliationSyncInput {
  userId: string;
  accountId: string;
  startDate?: string | null;
  endDate?: string | null;
  fillPageSize?: number | null;
  maxFillPages?: number | null;
  walletTransactionPageSize?: number | null;
  maxWalletTransactionPages?: number | null;
  positionLimit?: number | null;
  runType?: string | null;
}

export interface DeltaBrokerReconciliationSyncResult {
  runId: string;
  brokerKey: 'delta_exchange';
  accountId: string;
  startedAt: string;
  finishedAt: string;
  fillRowsFetched: number;
  fillsUpserted: number;
  positionRowsFetched: number;
  walletTransactionRowsFetched: number;
  walletTransactionsUpserted: number;
  feeEntriesUpserted: number;
  fundingEntriesUpserted: number;
  balanceSnapshotsUpserted: number;
  grossPnl: number;
  feeTotal: number;
  fundingTotal: number;
  walletTransactionTotal: number;
}

interface DeltaProductMaps {
  byId: Map<string, DeltaExchangeProduct>;
  bySymbol: Map<string, DeltaExchangeProduct>;
}

@Service()
export class DeltaBrokerReconciliationSyncService {
  @Inject(() => DeltaExchangeHttpClient)
  private deltaHttpClient!: DeltaExchangeHttpClient;

  @Inject(() => DeltaExchangePositionsAdapter)
  private deltaPositionsAdapter!: DeltaExchangePositionsAdapter;

  @Inject(() => DeltaExchangeWalletAdapter)
  private deltaWalletAdapter!: DeltaExchangeWalletAdapter;

  @Inject(() => BrokerReconciliationRepository)
  private brokerReconciliationRepository!: BrokerReconciliationRepository;

  async syncAccount(
    input: DeltaBrokerReconciliationSyncInput
  ): Promise<DeltaBrokerReconciliationSyncResult> {
    const userId = this.requiredString(input.userId, 'userId');
    const accountId = this.requiredString(input.accountId, 'accountId');
    const startedAt = new Date();
    const windowStart = this.dateOrNull(input.startDate);
    const windowEnd = this.dateOrNull(input.endDate);
    const runId = await this.brokerReconciliationRepository.createReconciliationRun({
      userId,
      brokerKey: 'delta_exchange',
      accountId,
      runType: this.readString(input.runType) || 'delta_reconciliation_sync',
      windowStartAt: windowStart,
      windowEndAt: windowEnd,
      startedAt,
      summaryPayload: {
        phase: 4,
        brokerKey: 'delta_exchange',
        source: 'delta_fills_wallet_transactions_position_history_wallet_balances',
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

      const productMaps = await this.fetchProductMaps();
      const positionHistory = await this.fetchPositionHistory({
        userId,
        accountId,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: this.limit(input.positionLimit, 50_000, 50_000),
      });
      const grossPnl = positionHistory.reduce(
        (sum, item) => sum + this.toNumber(item.pnl ?? item.realized ?? item.realized_pnl),
        0
      );

      const fills = await this.fetchFills({
        userId,
        accountId,
        pageSize: this.limit(input.fillPageSize, 50, 50),
        maxPages: this.limit(input.maxFillPages, 20, 500),
        windowStart,
        windowEnd,
      });
      const fillsUpserted = await this.storeFills({
        userId,
        accountId,
        fills,
        productMaps,
      });

      const walletTransactions = await this.fetchWalletTransactions({
        userId,
        accountId,
        pageSize: this.limit(input.walletTransactionPageSize, 50, 50),
        maxPages: this.limit(input.maxWalletTransactionPages, 20, 500),
        windowStart,
        windowEnd,
      });
      const walletStorage = await this.storeWalletTransactions({
        userId,
        accountId,
        transactions: walletTransactions,
      });

      const finishedAt = new Date();
      const finishPayload: BrokerReconciliationRunFinish = {
        status: 'completed',
        finishedAt,
        fillsCount: fillsUpserted,
        feeEntriesCount: walletStorage.feeEntriesUpserted,
        fundingEntriesCount: walletStorage.fundingEntriesUpserted,
        walletTransactionsCount: walletStorage.walletTransactionsUpserted,
        balanceSnapshotsCount: balanceSnapshotsUpserted,
        grossPnl,
        feesTotal: walletStorage.feeTotal,
        fundingTotal: walletStorage.fundingTotal,
        netPnl: grossPnl + walletStorage.feeTotal + walletStorage.fundingTotal,
        summaryPayload: {
          phase: 4,
          brokerKey: 'delta_exchange',
          fillRowsFetched: fills.length,
          positionRowsFetched: positionHistory.length,
          walletTransactionRowsFetched: walletTransactions.length,
          balanceSnapshotsUpserted,
          walletTransactionTotal: walletStorage.walletTransactionTotal,
        },
      };
      await this.brokerReconciliationRepository.finishReconciliationRun(runId, finishPayload);

      return {
        runId,
        brokerKey: 'delta_exchange',
        accountId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        fillRowsFetched: fills.length,
        fillsUpserted,
        positionRowsFetched: positionHistory.length,
        walletTransactionRowsFetched: walletTransactions.length,
        walletTransactionsUpserted: walletStorage.walletTransactionsUpserted,
        feeEntriesUpserted: walletStorage.feeEntriesUpserted,
        fundingEntriesUpserted: walletStorage.fundingEntriesUpserted,
        balanceSnapshotsUpserted,
        grossPnl,
        feeTotal: walletStorage.feeTotal,
        fundingTotal: walletStorage.fundingTotal,
        walletTransactionTotal: walletStorage.walletTransactionTotal,
      };
    } catch (error) {
      await this.brokerReconciliationRepository.finishReconciliationRun(runId, {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
        summaryPayload: {
          phase: 4,
          brokerKey: 'delta_exchange',
          failure: true,
        },
      });
      throw error;
    }
  }

  private async fetchFunds(userId: string, accountId: string): Promise<[unknown, unknown]> {
    return Promise.all([
      this.deltaWalletAdapter.getWalletFunds({
        userId,
        accountId,
        brokerKey: 'delta_exchange',
      }),
      this.deltaWalletAdapter.getFuturesFunds({
        userId,
        accountId,
        brokerKey: 'delta_exchange',
      }),
    ]);
  }

  private async fetchProductMaps(): Promise<DeltaProductMaps> {
    const products = await this.deltaHttpClient.publicGet<DeltaExchangeProduct[]>('/v2/products');
    const byId = new Map<string, DeltaExchangeProduct>();
    const bySymbol = new Map<string, DeltaExchangeProduct>();

    for (const product of Array.isArray(products) ? products : []) {
      const id = this.readString(product.id);
      if (id) {
        byId.set(id, product);
      }

      const symbol = this.normalizeSymbol(product.symbol);
      if (symbol) {
        bySymbol.set(symbol, product);
      }
    }

    return { byId, bySymbol };
  }

  private async fetchPositionHistory(input: {
    userId: string;
    accountId: string;
    startDate?: string | null;
    endDate?: string | null;
    limit: number;
  }): Promise<Array<Record<string, unknown>>> {
    const payload = await this.deltaPositionsAdapter.getPositionHistory(
      {
        limit: String(input.limit),
        ...(input.startDate ? { startDate: this.toDateOnly(input.startDate) } : {}),
        ...(input.endDate ? { endDate: this.toDateOnly(input.endDate) } : {}),
      },
      {
        userId: input.userId,
        accountId: input.accountId,
        brokerKey: 'delta_exchange',
      }
    );
    return Array.isArray(payload) ? (payload as Array<Record<string, unknown>>) : [];
  }

  private async fetchFills(input: {
    userId: string;
    accountId: string;
    pageSize: number;
    maxPages: number;
    windowStart: Date | null;
    windowEnd: Date | null;
  }): Promise<DeltaExchangeFill[]> {
    return this.fetchCursorPages<DeltaExchangeFill>({
      path: '/v2/fills',
      baseQuery: {
        contract_types: 'perpetual_futures',
        page_size: input.pageSize,
        ...(input.windowStart ? { start_time: input.windowStart.getTime() * 1000 } : {}),
        ...(input.windowEnd ? { end_time: this.toInclusiveEndTime(input.windowEnd) * 1000 } : {}),
      },
      userId: input.userId,
      accountId: input.accountId,
      maxPages: input.maxPages,
      getOccurredAt: (item) => item.created_at,
    });
  }

  private async fetchWalletTransactions(input: {
    userId: string;
    accountId: string;
    pageSize: number;
    maxPages: number;
    windowStart: Date | null;
    windowEnd: Date | null;
  }): Promise<DeltaExchangeWalletTransaction[]> {
    return this.fetchCursorPages<DeltaExchangeWalletTransaction>({
      path: '/v2/wallet/transactions',
      baseQuery: {
        page_size: input.pageSize,
        ...(input.windowStart ? { start_time: input.windowStart.getTime() * 1000 } : {}),
        ...(input.windowEnd ? { end_time: this.toInclusiveEndTime(input.windowEnd) * 1000 } : {}),
      },
      userId: input.userId,
      accountId: input.accountId,
      maxPages: input.maxPages,
      getOccurredAt: (item) => item.created_at,
    });
  }

  private async fetchCursorPages<T>(input: {
    path: string;
    baseQuery: Record<string, string | number | boolean | undefined>;
    userId: string;
    accountId: string;
    maxPages: number;
    getOccurredAt: (item: T) => string | undefined;
  }): Promise<T[]> {
    const rows: T[] = [];
    let after: string | undefined;

    for (let page = 0; page < input.maxPages; page += 1) {
      const envelope = await this.deltaHttpClient.signedGetEnvelope<T[]>(
        input.accountId,
        input.path,
        {
          ...input.baseQuery,
          ...(after ? { after } : {}),
        },
        input.userId
      );
      const pageRows = this.readEnvelopeRows(envelope);
      rows.push(...pageRows.filter((item) => this.isValidTime(input.getOccurredAt(item))));

      const nextAfter = this.readString(envelope.meta?.after);
      if (!nextAfter || pageRows.length === 0) {
        break;
      }
      after = nextAfter;
    }

    return rows;
  }

  private async storeBalanceSnapshot(input: {
    userId: string;
    accountId: string;
    walletFunds: unknown;
    futuresFunds: unknown;
    observedAt: Date;
  }): Promise<number> {
    const walletRecord = this.toRecord(input.walletFunds);
    const futuresRecord = this.toRecord(input.futuresFunds);
    const walletBalance = this.toNumber(walletRecord.total ?? walletRecord.balance);
    const futuresBalance = this.toNumber(futuresRecord.balance);

    await this.brokerReconciliationRepository.upsertBalanceSnapshot({
      userId: input.userId,
      brokerKey: 'delta_exchange',
      accountId: input.accountId,
      externalId: `delta_exchange:balance:${input.accountId}:${input.observedAt.toISOString()}`,
      walletBalance,
      futuresBalance,
      totalBalance: walletBalance + futuresBalance,
      availableBalance: this.readOptionalNumber(
        futuresRecord.available_balance ?? futuresRecord.withdrawable
      ),
      lockedAmount: this.readOptionalNumber(futuresRecord.locked_amount),
      currency: this.readString(futuresRecord.asset_symbol) || 'USD',
      observedAt: input.observedAt,
      rawPayload: {
        walletFunds: input.walletFunds,
        futuresFunds: input.futuresFunds,
      },
      source: 'delta_wallet_balances',
    });
    return 1;
  }

  private async storeFills(input: {
    userId: string;
    accountId: string;
    fills: DeltaExchangeFill[];
    productMaps: DeltaProductMaps;
  }): Promise<number> {
    let upserted = 0;
    for (const fill of input.fills) {
      const fillId = this.readString(fill.id) || this.buildHashId('fill', fill);
      const product = this.resolveProduct(fill, input.productMaps);
      const quantityContracts = Math.abs(this.toNumber(fill.size));
      const contractValue = this.toNumber(product?.contract_value);
      const quantity = contractValue > 0 ? quantityContracts * contractValue : quantityContracts;
      const price = this.toNumber(fill.price);

      await this.brokerReconciliationRepository.upsertFill({
        userId: input.userId,
        brokerKey: 'delta_exchange',
        accountId: input.accountId,
        externalId: `delta_exchange:fill:${fillId}`,
        orderId: this.readString(fill.order_id),
        positionId: this.readString(fill.product_id),
        symbol: this.resolveFillSymbol(fill),
        side: this.normalizeDeltaFillSide(fill.side),
        orderType: this.readString(fill.fill_type) || null,
        tradeCurrency: this.readString(fill.settling_asset_symbol) || 'USD',
        quantity,
        price,
        notional: price * quantity,
        commissionAmount: this.readOptionalNumber(fill.commission),
        commissionCurrency: this.readString(fill.settling_asset_symbol) || 'USD',
        filledAt: this.readString(fill.created_at),
        rawPayload: fill as unknown as Record<string, unknown>,
        matchState: 'unmatched',
        matchConfidence: 'unknown',
        source: 'delta_fills',
      });
      upserted += 1;
    }
    return upserted;
  }

  private async storeWalletTransactions(input: {
    userId: string;
    accountId: string;
    transactions: DeltaExchangeWalletTransaction[];
  }): Promise<{
    walletTransactionsUpserted: number;
    feeEntriesUpserted: number;
    fundingEntriesUpserted: number;
    walletTransactionTotal: number;
    feeTotal: number;
    fundingTotal: number;
  }> {
    let walletTransactionsUpserted = 0;
    let feeEntriesUpserted = 0;
    let fundingEntriesUpserted = 0;
    let walletTransactionTotal = 0;
    let feeTotal = 0;
    let fundingTotal = 0;

    for (const transaction of input.transactions) {
      const transactionId =
        this.readString(transaction.id) || this.buildHashId('wallet', transaction);
      const transactionType = this.normalizeTransactionType(transaction.transaction_type);
      const amount = this.toNumber(transaction.amount);
      const currency = this.readString(transaction.asset_symbol) || 'USD';
      const occurredAt = this.readString(transaction.created_at);

      await this.brokerReconciliationRepository.upsertWalletTransaction({
        userId: input.userId,
        brokerKey: 'delta_exchange',
        accountId: input.accountId,
        externalId: `delta_exchange:wallet-transaction:${transactionId}`,
        transactionType: transactionType || 'unknown',
        referenceId: this.resolveWalletTransactionReference(transaction),
        amount,
        currency,
        balanceAfter: transaction.balance,
        occurredAt,
        rawPayload: transaction as unknown as Record<string, unknown>,
        matchState: 'unmatched',
        matchConfidence: 'unknown',
        source: 'delta_wallet_transactions',
      });
      walletTransactionsUpserted += 1;
      walletTransactionTotal += amount;

      if (this.isFeeTransaction(transactionType)) {
        const feeAmount = this.normalizeFeeAccountingAmount(amount, transactionType);
        await this.brokerReconciliationRepository.upsertFeeEntry({
          userId: input.userId,
          brokerKey: 'delta_exchange',
          accountId: input.accountId,
          externalId: `delta_exchange:fee:${transactionId}`,
          symbol: this.resolveWalletTransactionSymbol(transaction),
          orderId: this.resolveWalletTransactionOrderId(transaction),
          feeType: transactionType || 'commission',
          amount: feeAmount,
          currency,
          occurredAt,
          rawPayload: transaction as unknown as Record<string, unknown>,
          matchState: 'unmatched',
          matchConfidence: 'low',
          source: 'delta_wallet_transactions',
        });
        feeEntriesUpserted += 1;
        feeTotal += feeAmount;
      }

      if (this.isFundingTransaction(transactionType)) {
        await this.brokerReconciliationRepository.upsertFundingEntry({
          userId: input.userId,
          brokerKey: 'delta_exchange',
          accountId: input.accountId,
          externalId: `delta_exchange:funding:${transactionId}`,
          symbol: this.resolveWalletTransactionSymbol(transaction),
          positionId: this.readString(transaction.product_id),
          amount,
          currency,
          occurredAt,
          rawPayload: transaction as unknown as Record<string, unknown>,
          matchState: 'unmatched',
          matchConfidence: 'low',
          source: 'delta_wallet_transactions',
        });
        fundingEntriesUpserted += 1;
        fundingTotal += amount;
      }
    }

    return {
      walletTransactionsUpserted,
      feeEntriesUpserted,
      fundingEntriesUpserted,
      walletTransactionTotal,
      feeTotal,
      fundingTotal,
    };
  }

  private resolveProduct(
    fill: DeltaExchangeFill,
    productMaps: DeltaProductMaps
  ): DeltaExchangeProduct | undefined {
    const productId = this.readString(fill.product_id);
    const productSymbol = this.normalizeSymbol(fill.product_symbol);
    return (
      (productId && productMaps.byId.get(productId)) ||
      (productSymbol && productMaps.bySymbol.get(productSymbol)) ||
      undefined
    );
  }

  private resolveFillSymbol(fill: DeltaExchangeFill): string {
    return this.normalizeSymbol(fill.product_symbol) || this.readString(fill.product_id);
  }

  private resolveWalletTransactionSymbol(
    transaction: DeltaExchangeWalletTransaction
  ): string | null {
    const metadata = this.toRecord(transaction.meta_data);
    return (
      this.normalizeSymbol(metadata.product_symbol) ||
      this.normalizeSymbol(metadata.symbol) ||
      this.normalizeSymbol(transaction.asset_symbol) ||
      this.readString(transaction.product_id) ||
      null
    );
  }

  private resolveWalletTransactionOrderId(
    transaction: DeltaExchangeWalletTransaction
  ): string | null {
    const metadata = this.toRecord(transaction.meta_data);
    return this.readString(metadata.order_id ?? metadata.orderId) || null;
  }

  private resolveWalletTransactionReference(
    transaction: DeltaExchangeWalletTransaction
  ): string | null {
    const metadata = this.toRecord(transaction.meta_data);
    return (
      this.readString(metadata.fill_id ?? metadata.fillId) ||
      this.readString(metadata.order_id ?? metadata.orderId) ||
      this.readString(transaction.product_id) ||
      this.readString(transaction.id) ||
      null
    );
  }

  private buildHashId(prefix: string, payload: unknown): string {
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
    return `${prefix}:${hash}`;
  }

  private normalizeDeltaFillSide(value: unknown): string | null {
    const normalized = this.readString(value).toLowerCase();
    if (normalized === 'buy' || normalized === 'sell') {
      return normalized;
    }
    return normalized || null;
  }

  private normalizeTransactionType(value: unknown): string {
    return this.readString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private isFeeTransaction(transactionType: string): boolean {
    return (
      transactionType.includes('commission') ||
      transactionType.includes('trading_fee') ||
      transactionType.includes('liquidation_fee')
    );
  }

  private isFundingTransaction(transactionType: string): boolean {
    return transactionType.includes('funding');
  }

  private normalizeFeeAccountingAmount(amount: number, transactionType: string): number {
    if (transactionType.includes('rebate') || transactionType.includes('credit')) {
      return amount;
    }
    return amount < 0 ? amount : -Math.abs(amount);
  }

  private readEnvelopeRows<T>(envelope: DeltaExchangeEnvelope<T[]>): T[] {
    if (!envelope || typeof envelope !== 'object') {
      return [];
    }
    return Array.isArray(envelope.result) ? envelope.result : [];
  }

  private toInclusiveEndTime(value: Date): number {
    const isMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    return isMidnight ? value.getTime() + 24 * 60 * 60 * 1000 - 1 : value.getTime();
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

  private isValidTime(value: unknown): boolean {
    const text = this.readString(value);
    return Boolean(text && !Number.isNaN(new Date(text).getTime()));
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

  private requiredString(value: unknown, fieldName: string): string {
    const text = this.readString(value);
    if (!text) {
      throw new Error(`Delta reconciliation ${fieldName} is required`);
    }
    return text;
  }

  private normalizeSymbol(value: unknown): string {
    return this.readString(value).toUpperCase();
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
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
