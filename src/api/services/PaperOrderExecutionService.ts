import { Inject, Service } from 'typedi';
import { env } from '../../env';
import { AssetPrice, AssetPriceRepository, PaperOrderRepository } from '../../database';
import { PaperOrder } from '../../database';
import { strategyDataSource } from '../../database/pg-data-source';
import { OperationalEventService } from './OperationalEventService';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';

interface PaperOrderSimulationOptions {
  brokerKey?: string;
  accountId?: string;
  paperOrderIds?: string[];
  limit?: number;
}

interface PaperOrderSimulationUpdate {
  userId: string;
  paperOrderId: string;
}

interface PaperOrderSimulationResult {
  updatedOrderIds: string[];
  updatedOrders: PaperOrderSimulationUpdate[];
  processedOrders: number;
  distinctUsers: number;
}

type PaperSimulationState = {
  executionState?: string | null;
  lastPrice?: string | null;
  lastPriceSeenAt?: string | null;
  lastObservationSource?: 'candle' | 'snapshot' | null;
  lastCandleOpenTime?: string | null;
  lastCandleCloseTime?: string | null;
  lastCandleOpen?: string | null;
  lastCandleHigh?: string | null;
  lastCandleLow?: string | null;
  lastCandleClose?: string | null;
  filledAt?: string | null;
  filledPrice?: string | null;
  filledQuantity?: number | null;
  remainingQuantity?: number | null;
  positionId?: string | null;
  positionStatus?: string | null;
  positionOpenedAt?: string | null;
  positionClosedAt?: string | null;
  closedAt?: string | null;
  exitPrice?: string | null;
  realizedPnl?: string | null;
  outcome?: 'open' | 'profit' | 'loss' | 'breakeven' | 'unknown' | null;
  closeReason?: string | null;
};

interface LatestMarketObservation {
  symbol: string;
  observedAt: Date;
  referencePrice: number;
  source: 'candle' | 'snapshot';
  candleOpenTime: Date | null;
  candleCloseTime: Date | null;
  candleOpen: number | null;
  candleHigh: number | null;
  candleLow: number | null;
  candleClose: number | null;
}

@Service()
export class PaperOrderExecutionService {
  @Inject(() => PaperOrderRepository)
  private paperOrderRepository!: PaperOrderRepository;

  @Inject(() => AssetPriceRepository)
  private assetPriceRepository!: AssetPriceRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  private simulationChain: Promise<void> = Promise.resolve();

  async simulateUserPaperOrders(
    userId: string,
    options: PaperOrderSimulationOptions = {}
  ): Promise<PaperOrderSimulationResult> {
    try {
      return await this.withSimulationLock(async () => {
        const orders = options.paperOrderIds?.length
          ? await this.paperOrderRepository.listPaperOrdersByIds(userId, options.paperOrderIds)
          : await this.paperOrderRepository.listExecutablePaperOrders(userId, {
              brokerKey: options.brokerKey,
              accountId: options.accountId,
              limit: options.limit,
            });

        return this.simulateOrders(orders);
      });
    } catch (error) {
      await this.emitPaperExecutionFailureAlert(userId, 'simulate-user-paper-orders', error);
      throw error;
    }
  }

  async simulateActivePaperOrders(
    options: Pick<PaperOrderSimulationOptions, 'limit'> = {}
  ): Promise<PaperOrderSimulationResult> {
    try {
      return await this.withSimulationLock(async () => {
        const orders = await this.paperOrderRepository.listExecutablePaperOrdersGlobal(
          options.limit
        );
        return this.simulateOrders(orders);
      });
    } catch (error) {
      await this.emitPaperExecutionFailureAlert(
        env.scheduler.systemUserId,
        'simulate-active-paper-orders',
        error
      );
      throw error;
    }
  }

  async closePaperOrderAtMarket(userId: string, paperOrderId: string): Promise<PaperOrder> {
    try {
      return await this.withSimulationLock(async () => {
        const order = await this.paperOrderRepository.getPaperOrderById(userId, paperOrderId);
        if (!order) {
          throw new NotFoundAppError('Paper order not found');
        }

        const currentStatus = String(order.status || '')
          .trim()
          .toUpperCase();
        if (currentStatus !== 'FILLED') {
          throw new BadRequestAppError('Only open paper positions can be closed');
        }

        const symbol = String(order.symbol || '')
          .trim()
          .toUpperCase();
        if (!symbol) {
          throw new BadRequestAppError('Paper order symbol is required for a manual close');
        }

        const [priceBySymbol, priceByScopedSymbol, candleObservations] = await Promise.all([
          this.loadFallbackMarketPrices([symbol]),
          this.loadScopedMarketPrices([order]),
          this.loadLatestCandleObservations([symbol]),
        ]);

        const preferredSource = this.resolvePriceSourceForBroker(order.brokerKey);
        const snapshotPrice =
          (preferredSource
            ? (priceByScopedSymbol.get(this.buildScopedSymbolKey(preferredSource, symbol)) ?? null)
            : null) ??
          priceBySymbol.get(symbol) ??
          null;
        const observation = this.resolveMarketObservation(
          symbol,
          candleObservations.get(symbol) ?? null,
          snapshotPrice
        );

        if (!observation) {
          throw new BadRequestAppError(
            'No market observation is available to close this paper position'
          );
        }

        const payload = this.readPayload(order.payload);
        const simulation = this.readSimulation(payload);
        const observedAtIso = observation.observedAt.toISOString();
        const quantity = this.toNumber(order.quantity) ?? 0;
        const exitPrice = observation.referencePrice;
        const nextSimulation: PaperSimulationState = {
          ...simulation,
          lastPrice: this.formatDecimal(observation.referencePrice),
          lastPriceSeenAt: observedAtIso,
          lastObservationSource: observation.source,
          lastCandleOpenTime: observation.candleOpenTime
            ? observation.candleOpenTime.toISOString()
            : null,
          lastCandleCloseTime: observation.candleCloseTime
            ? observation.candleCloseTime.toISOString()
            : null,
          lastCandleOpen:
            observation.candleOpen === null ? null : this.formatDecimal(observation.candleOpen),
          lastCandleHigh:
            observation.candleHigh === null ? null : this.formatDecimal(observation.candleHigh),
          lastCandleLow:
            observation.candleLow === null ? null : this.formatDecimal(observation.candleLow),
          lastCandleClose:
            observation.candleClose === null ? null : this.formatDecimal(observation.candleClose),
          positionId: simulation.positionId ?? `paper:${order.id}`,
          executionState: 'closed',
          positionStatus: 'CLOSED',
          filledAt: simulation.filledAt ?? observedAtIso,
          filledPrice:
            simulation.filledPrice ??
            this.formatDecimal(this.toNumber(order.orderPrice) ?? observation.referencePrice),
          filledQuantity: simulation.filledQuantity ?? quantity,
          remainingQuantity: 0,
          positionOpenedAt: simulation.positionOpenedAt ?? simulation.filledAt ?? observedAtIso,
          closedAt: observedAtIso,
          positionClosedAt: observedAtIso,
          exitPrice: this.formatDecimal(exitPrice),
          realizedPnl: this.formatDecimal(
            this.computeRealizedPnl(order, simulation, exitPrice, quantity)
          ),
          outcome: this.deriveOutcome(
            this.formatDecimal(this.computeRealizedPnl(order, simulation, exitPrice, quantity))
          ),
          closeReason: 'manual-close',
        };

        order.status = 'CLOSED';
        order.payload = {
          ...payload,
          simulation: nextSimulation,
        };
        await this.paperOrderRepository.savePaperOrder(order);

        await this.operationalEventService.logActivity(userId, {
          type: 'Paper position',
          title: `Paper position closed: ${symbol}`,
          status: 'Success',
          route: 'Positions',
          stream: 'Paper execution',
          related: `${order.brokerKey} · ${order.accountId}`,
          referenceId: order.id,
          correlationId: order.id,
          symbol,
          description: `Paper position closed at market @ ${this.formatDecimal(exitPrice)}`,
        });

        return order;
      });
    } catch (error) {
      await this.emitPaperExecutionFailureAlert(
        userId,
        'close-paper-order-at-market',
        error,
        paperOrderId
      );
      throw error;
    }
  }

  private async simulateSingleOrder(
    userId: string,
    order: PaperOrder,
    observation: LatestMarketObservation
  ): Promise<boolean> {
    const currentPrice = observation.referencePrice;
    const observedAt = observation.observedAt;
    const currentStatus = String(order.status || 'OPEN')
      .trim()
      .toUpperCase();
    const payload = this.readPayload(order.payload);
    const simulation = this.readSimulation(payload);
    const nextSimulation: PaperSimulationState = {
      ...simulation,
      lastPrice: this.formatDecimal(currentPrice),
      lastPriceSeenAt: observedAt.toISOString(),
      lastObservationSource: observation.source,
      lastCandleOpenTime: observation.candleOpenTime
        ? observation.candleOpenTime.toISOString()
        : null,
      lastCandleCloseTime: observation.candleCloseTime
        ? observation.candleCloseTime.toISOString()
        : null,
      lastCandleOpen:
        observation.candleOpen === null ? null : this.formatDecimal(observation.candleOpen),
      lastCandleHigh:
        observation.candleHigh === null ? null : this.formatDecimal(observation.candleHigh),
      lastCandleLow:
        observation.candleLow === null ? null : this.formatDecimal(observation.candleLow),
      lastCandleClose:
        observation.candleClose === null ? null : this.formatDecimal(observation.candleClose),
      positionId: simulation.positionId ?? `paper:${order.id}`,
    };

    let nextStatus = currentStatus;
    let transitionDescription: string | null = null;

    if (currentStatus === 'OPEN') {
      nextSimulation.executionState = 'working';
    }

    if (currentStatus === 'OPEN' && this.shouldFillOrder(order, observation)) {
      const fillPrice = this.resolveFillPrice(order, observation);
      const quantity = this.toNumber(order.quantity);
      nextStatus = 'FILLED';
      nextSimulation.executionState = 'filled';
      nextSimulation.filledAt = nextSimulation.filledAt ?? observedAt.toISOString();
      nextSimulation.filledPrice = this.formatDecimal(fillPrice);
      nextSimulation.filledQuantity = quantity;
      nextSimulation.remainingQuantity = 0;
      nextSimulation.positionStatus = 'OPEN';
      nextSimulation.positionOpenedAt = nextSimulation.positionOpenedAt ?? observedAt.toISOString();
      nextSimulation.outcome = 'open';
      nextSimulation.closeReason = null;
      transitionDescription = `Paper order filled for ${order.symbol || order.assetId} @ ${this.formatDecimal(fillPrice)}`;
    }

    if (nextStatus === 'FILLED') {
      const closeDecision = this.resolveCloseDecision(order, observation, nextSimulation);
      if (closeDecision) {
        const quantity = this.toNumber(order.quantity) ?? 0;
        nextStatus = 'CLOSED';
        nextSimulation.executionState = 'closed';
        nextSimulation.positionStatus = 'CLOSED';
        nextSimulation.closedAt = observedAt.toISOString();
        nextSimulation.positionClosedAt = observedAt.toISOString();
        nextSimulation.exitPrice = this.formatDecimal(closeDecision.exitPrice);
        nextSimulation.realizedPnl = this.formatDecimal(
          this.computeRealizedPnl(order, nextSimulation, closeDecision.exitPrice, quantity)
        );
        nextSimulation.outcome = this.deriveOutcome(nextSimulation.realizedPnl);
        nextSimulation.closeReason = closeDecision.reason;
        transitionDescription = `Paper position closed for ${order.symbol || order.assetId} via ${closeDecision.reason}`;
      }
    }

    const nextPayload = {
      ...payload,
      simulation: {
        ...nextSimulation,
      },
    };

    const payloadChanged =
      JSON.stringify(payload.simulation ?? null) !== JSON.stringify(nextPayload.simulation);
    const statusChanged = nextStatus !== currentStatus;

    if (!statusChanged && !payloadChanged) {
      return false;
    }

    order.status = nextStatus;
    order.payload = nextPayload;
    await this.paperOrderRepository.savePaperOrder(order);

    if (transitionDescription && statusChanged) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Paper order',
        title:
          nextStatus === 'FILLED'
            ? `Paper order filled: ${order.symbol || order.assetId}`
            : `Paper position closed: ${order.symbol || order.assetId}`,
        status: 'Success',
        route: 'Orders',
        stream: 'Paper execution',
        related: `${order.brokerKey} · ${order.accountId}`,
        referenceId: order.id,
        correlationId: order.id,
        symbol: order.symbol || undefined,
        description: transitionDescription,
      });
    }

    return true;
  }

  private async simulateOrders(orders: PaperOrder[]): Promise<PaperOrderSimulationResult> {
    if (!orders.length) {
      return {
        updatedOrderIds: [],
        updatedOrders: [],
        processedOrders: 0,
        distinctUsers: 0,
      };
    }

    const symbols = orders
      .map((item) =>
        String(item.symbol || '')
          .trim()
          .toUpperCase()
      )
      .filter(Boolean);

    const [priceBySymbol, priceByScopedSymbol, candleObservations] = await Promise.all([
      this.loadFallbackMarketPrices(symbols),
      this.loadScopedMarketPrices(orders),
      this.loadLatestCandleObservations(symbols),
    ]);

    const updatedOrderIds: string[] = [];
    const updatedOrders: PaperOrderSimulationUpdate[] = [];

    for (const order of orders) {
      const symbol = String(order.symbol || '')
        .trim()
        .toUpperCase();
      if (!symbol) {
        continue;
      }

      const preferredSource = this.resolvePriceSourceForBroker(order.brokerKey);
      const snapshotPrice =
        (preferredSource
          ? (priceByScopedSymbol.get(this.buildScopedSymbolKey(preferredSource, symbol)) ?? null)
          : null) ??
        priceBySymbol.get(symbol) ??
        null;

      const observation = this.resolveMarketObservation(
        symbol,
        candleObservations.get(symbol) ?? null,
        snapshotPrice
      );
      if (!observation) {
        continue;
      }

      const didUpdate = await this.simulateSingleOrder(order.userId, order, observation);
      if (didUpdate) {
        updatedOrderIds.push(order.id);
        updatedOrders.push({
          userId: order.userId,
          paperOrderId: order.id,
        });
      }
    }

    return {
      updatedOrderIds,
      updatedOrders,
      processedOrders: orders.length,
      distinctUsers: new Set(orders.map((item) => item.userId)).size,
    };
  }

  private async withSimulationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.simulationChain;
    let release: () => void = () => undefined;
    this.simulationChain = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async emitPaperExecutionFailureAlert(
    userId: string,
    action: string,
    error: unknown,
    referenceId?: string
  ): Promise<void> {
    if (!this.operationalEventService) {
      return;
    }
    await this.operationalEventService.emitFailureAlert(userId, {
      channel: 'paper-execution',
      source: `paper-execution.${action}${referenceId ? `.${referenceId}` : ''}`,
      message: `Paper execution failed: ${this.readErrorMessage(error)}`,
      route: 'Orders',
      severity: 'High',
      urgency: 'Review paper execution state and rerun simulation after the issue is resolved.',
    });
  }

  private readErrorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : 'Unknown error';
  }

  private shouldFillOrder(order: PaperOrder, observation: LatestMarketObservation): boolean {
    const orderType = String(order.orderType || '')
      .trim()
      .toLowerCase();
    const triggerType = String(order.triggerType || '')
      .trim()
      .toLowerCase();
    const limitPrice = this.toNumber(order.orderPrice);
    const isShort = this.isShortOrder(order.side);

    if (orderType !== 'limit' || triggerType === 'immediate' || limitPrice === null) {
      return true;
    }

    if (observation.candleHigh !== null && observation.candleLow !== null) {
      return isShort ? observation.candleHigh >= limitPrice : observation.candleLow <= limitPrice;
    }

    return isShort
      ? observation.referencePrice >= limitPrice
      : observation.referencePrice <= limitPrice;
  }

  private resolveFillPrice(order: PaperOrder, observation: LatestMarketObservation): number {
    const orderType = String(order.orderType || '')
      .trim()
      .toLowerCase();
    const triggerType = String(order.triggerType || '')
      .trim()
      .toLowerCase();
    const limitPrice = this.toNumber(order.orderPrice);

    if (orderType === 'limit' && triggerType !== 'immediate' && limitPrice !== null) {
      return limitPrice;
    }

    return observation.referencePrice;
  }

  private resolveCloseDecision(
    order: PaperOrder,
    observation: LatestMarketObservation,
    _simulation: PaperSimulationState
  ): { reason: 'take-profit' | 'stop-loss'; exitPrice: number } | null {
    const stopLoss = this.toNumber(order.stoplossPrice);
    const takeProfit = this.toNumber(order.takeprofitPrice);
    const isShort = this.isShortOrder(order.side);

    if (observation.candleHigh !== null && observation.candleLow !== null) {
      const candleHigh = observation.candleHigh;
      const candleLow = observation.candleLow;

      // When both stop and target are touched inside the same candle, we pick the
      // stop-loss first as the conservative execution assumption.
      if (isShort) {
        const hitStop = stopLoss !== null && candleHigh >= stopLoss;
        const hitTarget = takeProfit !== null && candleLow <= takeProfit;
        if (hitStop) {
          return { reason: 'stop-loss', exitPrice: stopLoss };
        }
        if (hitTarget) {
          return { reason: 'take-profit', exitPrice: takeProfit };
        }
        return null;
      }

      const hitStop = stopLoss !== null && candleLow <= stopLoss;
      const hitTarget = takeProfit !== null && candleHigh >= takeProfit;
      if (hitStop) {
        return { reason: 'stop-loss', exitPrice: stopLoss };
      }
      if (hitTarget) {
        return { reason: 'take-profit', exitPrice: takeProfit };
      }
      return null;
    }

    const currentPrice = observation.referencePrice;
    if (isShort) {
      if (stopLoss !== null && currentPrice >= stopLoss) {
        return { reason: 'stop-loss', exitPrice: stopLoss };
      }
      if (takeProfit !== null && currentPrice <= takeProfit) {
        return { reason: 'take-profit', exitPrice: takeProfit };
      }
      return null;
    }

    if (stopLoss !== null && currentPrice <= stopLoss) {
      return { reason: 'stop-loss', exitPrice: stopLoss };
    }
    if (takeProfit !== null && currentPrice >= takeProfit) {
      return { reason: 'take-profit', exitPrice: takeProfit };
    }

    return null;
  }

  private async loadLatestCandleObservations(
    symbols: string[]
  ): Promise<Map<string, LatestMarketObservation>> {
    const normalizedSymbols = Array.from(
      new Set(
        (symbols || [])
          .map((value) =>
            String(value || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      )
    );
    if (!normalizedSymbols.length || !env.pg.enabled) {
      return new Map();
    }

    if (!strategyDataSource.isInitialized) {
      await strategyDataSource.initialize();
    }

    const placeholders = normalizedSymbols.map((_, index) => `$${index + 1}`).join(', ');
    const rows = (await strategyDataSource.query(
      `SELECT DISTINCT ON (symbol)
          symbol,
          open_time AS "openTime",
          close_time AS "closeTime",
          open,
          high,
          low,
          close
       FROM market_candles_1m
       WHERE symbol IN (${placeholders})
       ORDER BY symbol, open_time DESC`,
      normalizedSymbols
    )) as Array<Record<string, unknown>>;

    const observationBySymbol = new Map<string, LatestMarketObservation>();
    for (const row of rows || []) {
      const symbol = String(row.symbol || '')
        .trim()
        .toUpperCase();
      if (!symbol) {
        continue;
      }

      const candleClose = this.toNumber(row.close);
      const candleOpen = this.toNumber(row.open);
      const candleHigh = this.toNumber(row.high);
      const candleLow = this.toNumber(row.low);
      const candleOpenTime = this.toDate(row.openTime);
      const candleCloseTime = this.toDate(row.closeTime);
      const observedAt = candleCloseTime ?? candleOpenTime;
      const referencePrice = candleClose ?? candleOpen ?? candleHigh ?? candleLow;
      if (!observedAt || referencePrice === null) {
        continue;
      }

      observationBySymbol.set(symbol, {
        symbol,
        observedAt,
        referencePrice,
        source: 'candle',
        candleOpenTime,
        candleCloseTime,
        candleOpen,
        candleHigh,
        candleLow,
        candleClose,
      });
    }

    return observationBySymbol;
  }

  private async loadFallbackMarketPrices(symbols: string[]): Promise<Map<string, AssetPrice>> {
    const rows = await this.assetPriceRepository.getBySymbols(symbols, {
      sources: ['mudrex', 'delta_exchange'],
    });
    return new Map(
      rows.map((item) => [
        String(item.symbol || '')
          .trim()
          .toUpperCase(),
        item,
      ])
    );
  }

  private async loadScopedMarketPrices(orders: PaperOrder[]): Promise<Map<string, AssetPrice>> {
    const symbolsBySource = new Map<string, Set<string>>();
    for (const order of orders) {
      const source = this.resolvePriceSourceForBroker(order.brokerKey);
      const symbol = String(order.symbol || '')
        .trim()
        .toUpperCase();
      if (!source || !symbol) {
        continue;
      }
      if (!symbolsBySource.has(source)) {
        symbolsBySource.set(source, new Set());
      }
      symbolsBySource.get(source)?.add(symbol);
    }

    const scopedRows = await Promise.all(
      Array.from(symbolsBySource.entries()).map(async ([source, symbolSet]) => ({
        source,
        rows: await this.assetPriceRepository.getBySymbols(Array.from(symbolSet), {
          sources: [source],
        }),
      }))
    );

    const priceByScopedSymbol = new Map<string, AssetPrice>();
    for (const entry of scopedRows) {
      entry.rows.forEach((row) => {
        const symbol = String(row.symbol || '')
          .trim()
          .toUpperCase();
        if (!symbol) {
          return;
        }
        priceByScopedSymbol.set(this.buildScopedSymbolKey(entry.source, symbol), row);
      });
    }

    return priceByScopedSymbol;
  }

  private resolveMarketObservation(
    symbol: string,
    candleObservation: LatestMarketObservation | null,
    marketPrice: AssetPrice | null
  ): LatestMarketObservation | null {
    if (candleObservation) {
      return candleObservation;
    }

    const price = this.toNumber(marketPrice?.price);
    if (price === null) {
      return null;
    }

    return {
      symbol,
      observedAt: marketPrice?.updatedAt ?? marketPrice?.retrievedAt ?? new Date(),
      referencePrice: price,
      source: 'snapshot',
      candleOpenTime: null,
      candleCloseTime: null,
      candleOpen: null,
      candleHigh: null,
      candleLow: null,
      candleClose: null,
    };
  }

  private resolvePriceSourceForBroker(brokerKey: string | null | undefined): string | null {
    const normalized = String(brokerKey || '')
      .trim()
      .toLowerCase();
    if (normalized === 'mudrex' || normalized === 'delta_exchange') {
      return normalized;
    }
    return null;
  }

  private buildScopedSymbolKey(source: string, symbol: string): string {
    return `${String(source || '')
      .trim()
      .toLowerCase()}:${String(symbol || '')
      .trim()
      .toUpperCase()}`;
  }

  private computeRealizedPnl(
    order: PaperOrder,
    simulation: PaperSimulationState,
    exitPrice: number,
    quantity: number
  ): number {
    const filledPrice =
      this.toNumber(simulation.filledPrice) ?? this.toNumber(order.orderPrice) ?? exitPrice;
    if (quantity <= 0) {
      return 0;
    }
    if (this.isShortOrder(order.side)) {
      return (filledPrice - exitPrice) * quantity;
    }
    return (exitPrice - filledPrice) * quantity;
  }

  private deriveOutcome(realizedPnl: string | null | undefined): PaperSimulationState['outcome'] {
    const numeric = this.toNumber(realizedPnl);
    if (numeric === null) {
      return 'unknown';
    }
    if (numeric > 0) {
      return 'profit';
    }
    if (numeric < 0) {
      return 'loss';
    }
    return 'breakeven';
  }

  private isShortOrder(side: string | null | undefined): boolean {
    const normalized = String(side || '')
      .trim()
      .toUpperCase();
    return normalized === 'SELL' || normalized === 'SHORT';
  }

  private readPayload(payload: Record<string, unknown> | null): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    return { ...payload };
  }

  private readSimulation(payload: Record<string, unknown>): PaperSimulationState {
    const simulation = payload.simulation;
    if (!simulation || typeof simulation !== 'object' || Array.isArray(simulation)) {
      return {};
    }
    return { ...(simulation as Record<string, unknown>) } as PaperSimulationState;
  }

  private toNumber(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    const parsed = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private formatDecimal(value: number): string {
    return String(Number(value));
  }
}
