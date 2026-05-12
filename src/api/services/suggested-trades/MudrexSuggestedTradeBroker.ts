import { env } from '../../../env';
import { SuggestedTradeExecutionLink } from '../../contracts/SuggestedTrade';
import { BadRequestAppError } from '../../errors/AppError';

const MUDREX_BROKER_KEY = 'mudrex';
const MUDREX_LIVE_AUTO_ENV = 'SUGGESTED_TRADES_LIVE_AUTO_MUDREX_ENABLED';
const MUDREX_PROTECTION_REPAIR_ENV = 'SUGGESTED_TRADES_PROTECTION_REPAIR_MUDREX_ENABLED';

type BooleanEnvReader = (name: string) => boolean | null;

type SuggestedTradeSideLike = {
  side?: unknown;
};

type LivePositionSnapshotLike = {
  externalId?: unknown;
  payload?: Record<string, unknown> | null;
};

type SuggestedTradeProtectionTradeLike = {
  symbol?: unknown;
  side?: unknown;
  timeframe?: unknown;
};

export interface MudrexProtectionPrices {
  requestedEntryPrice: number | null;
  stopLossPrice: number;
  takeProfitPrice: number;
}

export interface MudrexProtectionPositionsAdapter {
  getPositions?: (
    query: { limit?: number },
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
  createRiskOrder?: (
    positionId: string,
    body: Record<string, unknown>,
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
  closePosition?: (
    positionId: string,
    context?: { userId?: string; brokerKey?: string; accountId?: string }
  ) => Promise<unknown>;
}

type MudrexProtectionAttachabilityIssueReason =
  | 'stop_loss_breached'
  | 'take_profit_crossed'
  | 'protection_rejected_breached'
  | 'liquidation_unsafe';

interface MudrexProtectionAttachabilityIssue {
  reason: MudrexProtectionAttachabilityIssueReason;
  message: string;
}

export interface MudrexLiveProtectionRepairInput {
  userId: string;
  trade: SuggestedTradeProtectionTradeLike;
  execution: SuggestedTradeExecutionLink;
  position: LivePositionSnapshotLike;
  prices: MudrexProtectionPrices;
  nowIso: string;
  brokerKey: string;
  accountId: string;
  positionsAdapter: MudrexProtectionPositionsAdapter | null | undefined;
  protectionRepairEnabled: boolean;
  resolvePositionEntryPrice: (
    payload: Record<string, unknown>,
    execution: SuggestedTradeExecutionLink
  ) => number | null;
  deriveScaledProtectionPrice: (
    actualEntryPrice: number,
    requestedEntryPrice: number,
    requestedTargetPrice: number
  ) => string;
  formatNumericString: (value: number | null | undefined) => string | null;
  markProtectionAttached: (
    trade: SuggestedTradeProtectionTradeLike,
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    note: string,
    planUpdate: Record<string, unknown>,
    attempted?: boolean
  ) => SuggestedTradeExecutionLink;
  markProtectionManualUnlinked: (
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    message: string
  ) => SuggestedTradeExecutionLink;
  markProtectionFailed: (
    execution: SuggestedTradeExecutionLink,
    nowIso: string,
    message: string
  ) => SuggestedTradeExecutionLink;
}

export interface MudrexLiveAutoOrderSizingResult {
  quantity: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  auditNote: string | null;
}

export interface MudrexLiveAutoOrderSizingInput {
  brokerSymbol: string;
  quantity: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  side: 'long' | 'short';
  orderType: string;
  leverage?: number | null;
  assetDetail: Record<string, unknown> | null;
}

export interface MudrexLiveAutoProtectionAttachmentResult {
  attached: boolean;
  closedPosition?: boolean;
  note: string | null;
}

export interface MudrexLiveAutoProtectionAttachmentInput {
  userId: string;
  brokerKey: string;
  accountId: string;
  brokerSymbol: string;
  side: 'buy' | 'sell' | 'long' | 'short';
  orderId: string;
  requestedEntryPrice: number;
  requestedStopLossPrice: number | null;
  requestedTakeProfitPrice: number | null;
  positionsAdapter: MudrexProtectionPositionsAdapter | null | undefined;
  waitForPoll?: (ms: number) => Promise<void>;
}

const readRecordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readStringValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
};

const readNumberValue = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatNumericString = (value: number | null | undefined): string | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? String(value) : null;

const countNumericDecimals = (value: unknown): number => {
  const raw = String(value ?? '').trim();
  if (!raw || !raw.includes('.')) {
    return 0;
  }

  const fractional = raw.split('.')[1]?.replace(/0+$/, '') ?? '';
  return fractional.length;
};

export function isMudrexSuggestedTradeBroker(brokerKey: string | null | undefined): boolean {
  return (
    String(brokerKey || '')
      .trim()
      .toLowerCase() === MUDREX_BROKER_KEY
  );
}

export function resolveMudrexSuggestedTradeLiveAutoEnabled(
  liveAutoEnabled: boolean,
  readBooleanEnvOverride: BooleanEnvReader
): boolean {
  return (
    readBooleanEnvOverride(MUDREX_LIVE_AUTO_ENV) ??
    (process.env[MUDREX_LIVE_AUTO_ENV] !== undefined
      ? env.suggestedTrades.liveAuto.mudrexEnabled
      : liveAutoEnabled) ??
    liveAutoEnabled
  );
}

export function resolveMudrexSuggestedTradeProtectionRepairEnabled(
  readBooleanEnvOverride: BooleanEnvReader
): boolean {
  return (
    readBooleanEnvOverride(MUDREX_PROTECTION_REPAIR_ENV) ??
    env.suggestedTrades.protectionRepair?.mudrexEnabled ??
    true
  );
}

export function mudrexPositionHasProtection(position: Record<string, unknown>): boolean {
  const stopLossPrice = readNumberValue(
    position.stoploss_price ??
      position.stopLossPrice ??
      readRecordValue(position.stoploss)?.price ??
      readRecordValue(position.stopLoss)?.price
  );
  const takeProfitPrice = readNumberValue(
    position.takeprofit_price ??
      position.takeProfitPrice ??
      readRecordValue(position.takeprofit)?.price ??
      readRecordValue(position.takeProfit)?.price
  );
  const stopLossOrderId =
    readStringValue(position.stoploss_order_id) ??
    readStringValue(readRecordValue(position.stoploss)?.id);
  const takeProfitOrderId =
    readStringValue(position.takeprofit_order_id) ??
    readStringValue(readRecordValue(position.takeprofit)?.id);

  return Boolean(
    (stopLossPrice && stopLossPrice > 0) ||
    (takeProfitPrice && takeProfitPrice > 0) ||
    stopLossOrderId ||
    takeProfitOrderId
  );
}

export function resolveMudrexRiskOrderPositionId(
  position: LivePositionSnapshotLike,
  positionPayload: Record<string, unknown>
): string | null {
  return (
    readStringValue(positionPayload.id) ??
    readStringValue(positionPayload.position_id) ??
    readStringValue(positionPayload.positionId) ??
    readStringValue(position.externalId)
  );
}

export function validateMudrexProtectionAttachability(
  trade: SuggestedTradeSideLike,
  positionPayload: Record<string, unknown>,
  stopLossPrice: string,
  takeProfitPrice: string
): string | null {
  return (
    inspectMudrexProtectionAttachability(trade, positionPayload, stopLossPrice, takeProfitPrice)
      ?.message ?? null
  );
}

function inspectMudrexProtectionAttachability(
  trade: SuggestedTradeSideLike,
  positionPayload: Record<string, unknown>,
  stopLossPrice: string,
  takeProfitPrice: string
): MudrexProtectionAttachabilityIssue | null {
  const side = resolveMudrexPositionEntrySide(trade, positionPayload);
  const stopLoss = readNumberValue(stopLossPrice);
  const takeProfit = readNumberValue(takeProfitPrice);
  const currentPrice =
    readNumberValue(positionPayload.current_price) ??
    readNumberValue(positionPayload.currentPrice) ??
    readNumberValue(positionPayload.mark_price) ??
    readNumberValue(positionPayload.markPrice);
  const liquidationPrice =
    readNumberValue(positionPayload.liquidation_price) ??
    readNumberValue(positionPayload.liquidationPrice);

  if (!side || !(stopLoss && stopLoss > 0) || !(takeProfit && takeProfit > 0)) {
    return null;
  }

  if (side === 'buy') {
    if (currentPrice && stopLoss >= currentPrice) {
      return {
        reason: 'stop_loss_breached',
        message: `Mudrex protection needs immediate close: planned stop-loss ${stopLossPrice} is already breached for current price ${formatNumericString(currentPrice) || currentPrice}.`,
      };
    }
    if (currentPrice && takeProfit <= currentPrice) {
      return {
        reason: 'take_profit_crossed',
        message: `Mudrex protection needs immediate close: planned take-profit ${takeProfitPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}.`,
      };
    }
    if (liquidationPrice && stopLoss <= liquidationPrice) {
      return {
        reason: 'liquidation_unsafe',
        message: `Mudrex protection needs manual action: planned stop-loss ${stopLossPrice} is at or beyond liquidation price ${formatNumericString(liquidationPrice) || liquidationPrice}.`,
      };
    }
    return null;
  }

  if (currentPrice && stopLoss <= currentPrice) {
    return {
      reason: 'stop_loss_breached',
      message: `Mudrex protection needs immediate close: planned stop-loss ${stopLossPrice} is already breached for current price ${formatNumericString(currentPrice) || currentPrice}.`,
    };
  }
  if (currentPrice && takeProfit >= currentPrice) {
    return {
      reason: 'take_profit_crossed',
      message: `Mudrex protection needs immediate close: planned take-profit ${takeProfitPrice} is already crossed for current price ${formatNumericString(currentPrice) || currentPrice}.`,
    };
  }
  if (liquidationPrice && stopLoss >= liquidationPrice) {
    return {
      reason: 'liquidation_unsafe',
      message: `Mudrex protection needs manual action: planned stop-loss ${stopLossPrice} is at or beyond liquidation price ${formatNumericString(liquidationPrice) || liquidationPrice}.`,
    };
  }
  return null;
}

function shouldCloseMudrexPositionForAttachabilityIssue(
  issue: MudrexProtectionAttachabilityIssue | null
): boolean {
  return Boolean(
    issue &&
    (issue.reason === 'stop_loss_breached' ||
      issue.reason === 'take_profit_crossed' ||
      issue.reason === 'protection_rejected_breached')
  );
}

function buildMudrexProtectionBrokerRejectIssue(
  error: unknown
): MudrexProtectionAttachabilityIssue | null {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  if (
    !normalized.includes('already crossed') &&
    !normalized.includes('already breached') &&
    !normalized.includes('protection levels')
  ) {
    return null;
  }
  return {
    reason: 'protection_rejected_breached',
    message: `Mudrex protection needs immediate close: broker rejected SL/TP because ${message}.`,
  };
}

async function closeMudrexPositionForBreachedProtection(input: {
  positionsAdapter: MudrexProtectionPositionsAdapter | null | undefined;
  positionId: string;
  userId: string;
  brokerKey: string;
  accountId: string;
  issue: MudrexProtectionAttachabilityIssue;
}): Promise<{ closed: boolean; note: string }> {
  if (!input.positionsAdapter?.closePosition) {
    return {
      closed: false,
      note: `${input.issue.message} Mudrex close-position adapter is unavailable; position still needs urgent manual close.`,
    };
  }

  try {
    await input.positionsAdapter.closePosition(input.positionId, {
      userId: input.userId,
      brokerKey: input.brokerKey,
      accountId: input.accountId,
    });
    return {
      closed: true,
      note: `${input.issue.message} Mudrex position was closed immediately because protection was already breached before SL/TP could attach.`,
    };
  } catch (error) {
    return {
      closed: false,
      note: `${input.issue.message} Mudrex immediate close failed: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    };
  }
}

function appendProtectionNote(existing: unknown, next: string): string {
  const current = readStringValue(existing);
  return current ? `${current} ${next}` : next;
}

export function normalizeMudrexLiveAutoOrderSizing(
  input: MudrexLiveAutoOrderSizingInput
): MudrexLiveAutoOrderSizingResult {
  const assetDetail = input.assetDetail;
  const step = readNumberValue(assetDetail?.quantity_step);
  const minContract = readNumberValue(assetDetail?.min_contract);
  const maxContract = readNumberValue(assetDetail?.max_contract);
  const maxMarketContract = readNumberValue(assetDetail?.max_market_contract);
  const minNotionalValue = readNumberValue(assetDetail?.min_notional_value);
  const priceStep = readNumberValue(assetDetail?.price_step);
  const minPrice = readNumberValue(assetDetail?.min_price);
  const maxPrice = readNumberValue(assetDetail?.max_price);

  assertMudrexLiveAutoLeverageWithinAssetLimits(input.brokerSymbol, assetDetail, input.leverage);

  if (!(step && step > 0)) {
    return {
      quantity: input.quantity,
      entryPrice: input.entryPrice,
      stopLossPrice: input.stopLossPrice,
      takeProfitPrice: input.takeProfitPrice,
      auditNote: null,
    };
  }

  const precision = countNumericDecimals(assetDetail?.quantity_step);
  const steppedQuantity = Math.floor(input.quantity / step) * step;
  const normalizedQuantity = Number(steppedQuantity.toFixed(precision));

  if (!(normalizedQuantity > 0)) {
    throw new BadRequestAppError(
      `Mudrex quantity ${formatNumericString(input.quantity) || input.quantity} rounds below the broker minimum step ${formatNumericString(step) || step} for ${input.brokerSymbol}.`
    );
  }

  if (minContract && normalizedQuantity < minContract) {
    throw new BadRequestAppError(
      `Mudrex quantity ${formatNumericString(normalizedQuantity) || normalizedQuantity} is below the broker minimum contract ${formatNumericString(minContract) || minContract} for ${input.brokerSymbol}.`
    );
  }

  const normalizedOrderType = String(input.orderType || '')
    .trim()
    .toLowerCase();
  const maxAllowed =
    normalizedOrderType === 'market' && maxMarketContract && maxMarketContract > 0
      ? maxMarketContract
      : maxContract;
  if (maxAllowed && normalizedQuantity > maxAllowed) {
    throw new BadRequestAppError(
      `Mudrex quantity ${formatNumericString(normalizedQuantity) || normalizedQuantity} exceeds the broker maximum ${formatNumericString(maxAllowed) || maxAllowed} for ${input.brokerSymbol}.`
    );
  }

  const normalizedEntryPrice =
    priceStep && priceStep > 0
      ? normalizeMudrexOrderPriceForStep(
          input.entryPrice,
          priceStep,
          assetDetail?.price_step,
          input.side === 'long' ? 'floor' : 'ceil'
        )
      : input.entryPrice;
  const normalizedStopLossPrice =
    priceStep && priceStep > 0
      ? normalizeMudrexOrderPriceForStep(
          input.stopLossPrice,
          priceStep,
          assetDetail?.price_step,
          input.side === 'long' ? 'floor' : 'ceil'
        )
      : input.stopLossPrice;
  const normalizedTakeProfitPrice =
    priceStep && priceStep > 0
      ? normalizeMudrexOrderPriceForStep(
          input.takeProfitPrice,
          priceStep,
          assetDetail?.price_step,
          input.side === 'long' ? 'ceil' : 'floor'
        )
      : input.takeProfitPrice;

  for (const [label, value] of [
    ['entry price', normalizedEntryPrice],
    ['stop-loss price', normalizedStopLossPrice],
    ['take-profit price', normalizedTakeProfitPrice],
  ] as const) {
    if (minPrice && value < minPrice) {
      throw new BadRequestAppError(
        `Mudrex ${label} ${formatNumericString(value) || value} is below the broker minimum price ${formatNumericString(minPrice) || minPrice} for ${input.brokerSymbol}.`
      );
    }
    if (maxPrice && value > maxPrice) {
      throw new BadRequestAppError(
        `Mudrex ${label} ${formatNumericString(value) || value} exceeds the broker maximum price ${formatNumericString(maxPrice) || maxPrice} for ${input.brokerSymbol}.`
      );
    }
  }

  const normalizedNotional = normalizedQuantity * normalizedEntryPrice;
  if (minNotionalValue && normalizedNotional < minNotionalValue) {
    throw new BadRequestAppError(
      `Mudrex order notional ${formatNumericString(normalizedNotional) || normalizedNotional} is below the broker minimum ${formatNumericString(minNotionalValue) || minNotionalValue} for ${input.brokerSymbol}.`
    );
  }

  const notes: string[] = [];
  const changed = Math.abs(normalizedQuantity - input.quantity) > 1e-12;
  if (changed) {
    notes.push(
      `Normalized Mudrex quantity from ${formatNumericString(input.quantity) || input.quantity} to ${formatNumericString(normalizedQuantity) || normalizedQuantity} to satisfy broker quantity step ${formatNumericString(step) || step}.`
    );
  }
  if (priceStep && priceStep > 0) {
    const priceChanges = [
      ['entry', input.entryPrice, normalizedEntryPrice],
      ['stop-loss', input.stopLossPrice, normalizedStopLossPrice],
      ['take-profit', input.takeProfitPrice, normalizedTakeProfitPrice],
    ]
      .filter(([, original, normalized]) => Math.abs(Number(normalized) - Number(original)) > 1e-12)
      .map(
        ([label, original, normalized]) =>
          `${label} ${formatNumericString(Number(original)) || original} -> ${formatNumericString(Number(normalized)) || normalized}`
      );
    if (priceChanges.length) {
      notes.push(
        `Normalized Mudrex prices to broker price step ${formatNumericString(priceStep) || priceStep}: ${priceChanges.join(', ')}.`
      );
    }
  }

  return {
    quantity: normalizedQuantity,
    entryPrice: normalizedEntryPrice,
    stopLossPrice: normalizedStopLossPrice,
    takeProfitPrice: normalizedTakeProfitPrice,
    auditNote: notes.length ? notes.join(' ') : null,
  };
}

export function assertMudrexLiveAutoLeverageWithinAssetLimits(
  brokerSymbol: string,
  assetDetail: Record<string, unknown> | null,
  leverage?: number | null
): void {
  const requestedLeverage = readNumberValue(leverage);
  if (!(requestedLeverage && requestedLeverage > 0)) {
    return;
  }

  const minLeverage = readNumberValue(assetDetail?.min_leverage);
  const maxLeverage = readNumberValue(assetDetail?.max_leverage);
  const formattedRequested = formatNumericString(requestedLeverage) ?? requestedLeverage;

  if (minLeverage && requestedLeverage < minLeverage) {
    throw new BadRequestAppError(
      `Mudrex requested leverage ${formattedRequested}x is below the broker minimum leverage ${formatNumericString(minLeverage) ?? minLeverage}x for ${brokerSymbol}.`
    );
  }

  if (maxLeverage && requestedLeverage > maxLeverage) {
    throw new BadRequestAppError(
      `Mudrex requested leverage ${formattedRequested}x exceeds the broker maximum leverage ${formatNumericString(maxLeverage) ?? maxLeverage}x for ${brokerSymbol}.`
    );
  }
}

export function normalizeMudrexOrderPriceForStep(
  price: number,
  step: number,
  rawStep: unknown,
  mode: 'floor' | 'ceil'
): number {
  if (!(price > 0 && step > 0)) {
    return price;
  }

  const precision = countNumericDecimals(rawStep);
  const units = price / step;
  const roundedUnits =
    mode === 'ceil'
      ? Math.ceil(units - Number.EPSILON * 10)
      : Math.floor(units + Number.EPSILON * 10);
  return Number((roundedUnits * step).toFixed(precision));
}

export async function attachMudrexLiveAutoProtectionIfNeeded(
  input: MudrexLiveAutoProtectionAttachmentInput
): Promise<MudrexLiveAutoProtectionAttachmentResult> {
  if (
    !(input.requestedEntryPrice > 0) ||
    !(input.requestedStopLossPrice && input.requestedStopLossPrice > 0) ||
    !(input.requestedTakeProfitPrice && input.requestedTakeProfitPrice > 0)
  ) {
    return {
      attached: false,
      note: null,
    };
  }

  const positionsAdapter = input.positionsAdapter;
  if (!positionsAdapter?.getPositions) {
    return {
      attached: false,
      note: 'Mudrex order created, but the positions adapter is unavailable for automatic SL/TP attachment.',
    };
  }

  const getPositions = positionsAdapter.getPositions.bind(positionsAdapter);

  try {
    const position = await pollMudrexLiveAutoPosition({
      adapter: {
        getPositions,
      },
      userId: input.userId,
      accountId: input.accountId,
      brokerSymbol: input.brokerSymbol,
      side: input.side,
      waitForPoll: input.waitForPoll,
    });
    if (!position) {
      return {
        attached: false,
        note: `Mudrex order ${input.orderId} was created, but no matching open position was found in time for automatic SL/TP attachment.`,
      };
    }

    if (mudrexPositionHasProtection(position)) {
      return {
        attached: true,
        note: 'Mudrex position already reports active SL/TP protection.',
      };
    }

    const positionId =
      readStringValue(position.id) ??
      readStringValue(position.position_id) ??
      readStringValue(position.positionId);
    const actualEntryPrice = readNumberValue(
      position.entry_price ?? position.entryPrice ?? position.avg_price ?? position.average_price
    );
    if (!positionId || !(actualEntryPrice && actualEntryPrice > 0)) {
      return {
        attached: false,
        note: `Mudrex order ${input.orderId} opened a position, but the broker position payload did not include a usable id/entry price for automatic SL/TP attachment.`,
      };
    }

    const stopLossPrice = deriveScaledProtectionPrice(
      actualEntryPrice,
      input.requestedEntryPrice,
      input.requestedStopLossPrice
    );
    const takeProfitPrice = deriveScaledProtectionPrice(
      actualEntryPrice,
      input.requestedEntryPrice,
      input.requestedTakeProfitPrice
    );
    const attachabilityIssue = inspectMudrexProtectionAttachability(
      input,
      position,
      stopLossPrice,
      takeProfitPrice
    );
    if (attachabilityIssue && shouldCloseMudrexPositionForAttachabilityIssue(attachabilityIssue)) {
      const closeResult = await closeMudrexPositionForBreachedProtection({
        positionsAdapter,
        positionId,
        userId: input.userId,
        brokerKey: input.brokerKey,
        accountId: input.accountId,
        issue: attachabilityIssue,
      });
      return {
        attached: false,
        closedPosition: closeResult.closed,
        note: closeResult.note,
      };
    }
    if (attachabilityIssue) {
      return {
        attached: false,
        note: attachabilityIssue.message,
      };
    }

    if (!positionsAdapter.createRiskOrder) {
      return {
        attached: false,
        note: 'Mudrex order created, but the positions adapter cannot create automatic SL/TP protection.',
      };
    }

    try {
      await positionsAdapter.createRiskOrder(
        positionId,
        {
          stoploss_price: stopLossPrice,
          takeprofit_price: takeProfitPrice,
          order_source: 'positions_desk',
          is_stoploss: true,
          is_takeprofit: true,
        },
        {
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
        }
      );
    } catch (error) {
      const brokerRejectIssue = buildMudrexProtectionBrokerRejectIssue(error);
      if (brokerRejectIssue && shouldCloseMudrexPositionForAttachabilityIssue(brokerRejectIssue)) {
        const closeResult = await closeMudrexPositionForBreachedProtection({
          positionsAdapter,
          positionId,
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
          issue: brokerRejectIssue,
        });
        return {
          attached: false,
          closedPosition: closeResult.closed,
          note: closeResult.note,
        };
      }
      throw error;
    }

    return {
      attached: true,
      note: `Derived Mudrex SL/TP attached from actual fill price ${formatNumericString(actualEntryPrice) || actualEntryPrice} (SL ${stopLossPrice}, TP ${takeProfitPrice}).`,
    };
  } catch (error) {
    return {
      attached: false,
      note: `Mudrex order ${input.orderId} was created, but automatic SL/TP attachment failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }
}

export async function pollMudrexLiveAutoPosition(input: {
  adapter: {
    getPositions: (
      query: { limit?: number },
      context?: { userId?: string; brokerKey?: string; accountId?: string }
    ) => Promise<unknown>;
  };
  userId: string;
  accountId: string;
  brokerSymbol: string;
  side: 'buy' | 'sell' | 'long' | 'short';
  waitForPoll?: (ms: number) => Promise<void>;
}): Promise<Record<string, unknown> | null> {
  const normalizedSymbol = String(input.brokerSymbol || '')
    .trim()
    .toUpperCase();
  const expectedDirection = input.side === 'sell' || input.side === 'short' ? 'short' : 'long';

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await input.adapter.getPositions(
      { limit: 100 },
      {
        userId: input.userId,
        brokerKey: 'mudrex',
        accountId: input.accountId,
      }
    );
    const positions = extractPositionRecords(response)
      .filter((position) => {
        const symbol = String(position.symbol ?? position.asset_symbol ?? '')
          .trim()
          .toUpperCase();
        if (symbol !== normalizedSymbol) {
          return false;
        }
        const status = normalizeMudrexPositionStatus(
          readStringValue(position.status) ?? readStringValue(position.position_status)
        );
        if (status && ['CLOSED', 'LIQUIDATED'].includes(status)) {
          return false;
        }
        return resolveMudrexPositionDirection(position) === expectedDirection;
      })
      .sort((left, right) => extractPositionTimestamp(right) - extractPositionTimestamp(left));

    if (positions[0]) {
      return positions[0];
    }

    if (attempt < 7) {
      await (input.waitForPoll ?? waitForPoll)(750);
    }
  }

  return null;
}

export async function remediateMudrexLiveProtection(
  input: MudrexLiveProtectionRepairInput
): Promise<SuggestedTradeExecutionLink> {
  const positionPayload = input.position.payload ?? {};
  if (mudrexPositionHasProtection(positionPayload)) {
    return input.markProtectionAttached(
      input.trade,
      input.execution,
      input.nowIso,
      'Mudrex position already reports active SL/TP protection.',
      {
        positionId: input.position.externalId,
      }
    );
  }

  const positionId = resolveMudrexRiskOrderPositionId(input.position, positionPayload);
  const actualEntryPrice = input.resolvePositionEntryPrice(positionPayload, input.execution);
  if (!positionId || !(actualEntryPrice && actualEntryPrice > 0)) {
    return {
      ...input.execution,
      protectionState: 'waiting_for_position',
      protectionCheckedAt: input.nowIso,
      protectionLastError:
        'Mudrex position snapshot did not include a usable id and entry price yet.',
    };
  }

  const requestedEntryPrice = input.prices.requestedEntryPrice ?? actualEntryPrice;
  const stopLossPrice = input.deriveScaledProtectionPrice(
    actualEntryPrice,
    requestedEntryPrice,
    input.prices.stopLossPrice
  );
  const takeProfitPrice = input.deriveScaledProtectionPrice(
    actualEntryPrice,
    requestedEntryPrice,
    input.prices.takeProfitPrice
  );
  const attachabilityError = validateMudrexProtectionAttachability(
    input.trade,
    positionPayload,
    stopLossPrice,
    takeProfitPrice
  );
  const attachabilityIssue = inspectMudrexProtectionAttachability(
    input.trade,
    positionPayload,
    stopLossPrice,
    takeProfitPrice
  );
  if (attachabilityIssue && shouldCloseMudrexPositionForAttachabilityIssue(attachabilityIssue)) {
    const closeResult = await closeMudrexPositionForBreachedProtection({
      positionsAdapter: input.positionsAdapter,
      positionId,
      userId: input.userId,
      brokerKey: input.brokerKey,
      accountId: input.accountId,
      issue: attachabilityIssue,
    });
    if (closeResult.closed) {
      return {
        ...input.execution,
        executionState: 'closed',
        positionStatus: 'CLOSED',
        positionClosedAt: input.nowIso,
        protectionState: 'not_required',
        protectionCheckedAt: input.nowIso,
        protectionAttachedAt: null,
        protectionLastError: null,
        protectionPlan: {
          ...(input.execution.protectionPlan ?? {}),
          positionId,
          autoClosedAt: input.nowIso,
          autoCloseReason: attachabilityIssue.reason,
          stopLossPrice,
          takeProfitPrice,
        },
        note: appendProtectionNote(input.execution.note, closeResult.note),
      };
    }
    return input.markProtectionFailed(input.execution, input.nowIso, closeResult.note);
  }
  if (attachabilityError) {
    return input.markProtectionManualUnlinked(input.execution, input.nowIso, attachabilityError);
  }

  if (!input.protectionRepairEnabled) {
    return input.markProtectionManualUnlinked(
      input.execution,
      input.nowIso,
      'Mudrex automatic SL/TP protection repair is disabled by broker-specific control.'
    );
  }

  if (!input.positionsAdapter?.createRiskOrder) {
    return input.markProtectionFailed(
      input.execution,
      input.nowIso,
      'Mudrex positions adapter is unavailable for protection remediation.'
    );
  }

  try {
    try {
      await input.positionsAdapter.createRiskOrder(
        positionId,
        {
          stoploss_price: stopLossPrice,
          takeprofit_price: takeProfitPrice,
          order_source: 'positions_desk',
          is_stoploss: true,
          is_takeprofit: true,
        },
        {
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
        }
      );
    } catch (error) {
      const brokerRejectIssue = buildMudrexProtectionBrokerRejectIssue(error);
      if (brokerRejectIssue && shouldCloseMudrexPositionForAttachabilityIssue(brokerRejectIssue)) {
        const closeResult = await closeMudrexPositionForBreachedProtection({
          positionsAdapter: input.positionsAdapter,
          positionId,
          userId: input.userId,
          brokerKey: input.brokerKey,
          accountId: input.accountId,
          issue: brokerRejectIssue,
        });
        if (closeResult.closed) {
          return {
            ...input.execution,
            executionState: 'closed',
            positionStatus: 'CLOSED',
            positionClosedAt: input.nowIso,
            protectionState: 'not_required',
            protectionCheckedAt: input.nowIso,
            protectionAttachedAt: null,
            protectionLastError: null,
            protectionPlan: {
              ...(input.execution.protectionPlan ?? {}),
              positionId,
              autoClosedAt: input.nowIso,
              autoCloseReason: brokerRejectIssue.reason,
              stopLossPrice,
              takeProfitPrice,
            },
            note: appendProtectionNote(input.execution.note, closeResult.note),
          };
        }
        return input.markProtectionFailed(input.execution, input.nowIso, closeResult.note);
      }
      throw error;
    }
    return input.markProtectionAttached(
      input.trade,
      input.execution,
      input.nowIso,
      `Derived Mudrex SL/TP attached from actual fill price ${
        input.formatNumericString(actualEntryPrice) || actualEntryPrice
      } (SL ${stopLossPrice}, TP ${takeProfitPrice}).`,
      {
        positionId,
        snapshotPositionId: input.position.externalId,
        attachedStopLossPrice: stopLossPrice,
        attachedTakeProfitPrice: takeProfitPrice,
      },
      true
    );
  } catch (error) {
    return input.markProtectionFailed(
      input.execution,
      input.nowIso,
      `Mudrex protection remediation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function extractPositionRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(readRecordValue(item)));
  }

  const record = readRecordValue(value);
  if (!record) {
    return [];
  }

  const directList = [record.items, record.positions, record.results, record.data].find(
    (candidate) => Array.isArray(candidate)
  );
  if (Array.isArray(directList)) {
    return directList.filter((item): item is Record<string, unknown> =>
      Boolean(readRecordValue(item))
    );
  }

  const dataRecord = readRecordValue(record.data);
  if (!dataRecord) {
    return [];
  }

  const nestedList = [dataRecord.items, dataRecord.positions, dataRecord.results].find(
    (candidate) => Array.isArray(candidate)
  );
  return Array.isArray(nestedList)
    ? nestedList.filter((item): item is Record<string, unknown> => Boolean(readRecordValue(item)))
    : [];
}

function extractPositionTimestamp(position: Record<string, unknown>): number {
  const candidates = [
    position.updated_at,
    position.updatedAt,
    position.created_at,
    position.createdAt,
    position.open_time,
    position.openTime,
  ];
  for (const candidate of candidates) {
    const raw = readStringValue(candidate);
    if (!raw) {
      continue;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function deriveScaledProtectionPrice(
  actualEntryPrice: number,
  requestedEntryPrice: number,
  requestedTargetPrice: number
): string {
  const precision = Math.max(
    6,
    countNumericDecimals(requestedEntryPrice),
    countNumericDecimals(requestedTargetPrice)
  );
  return Number(
    ((actualEntryPrice * requestedTargetPrice) / requestedEntryPrice).toFixed(precision)
  ).toFixed(precision);
}

function normalizeMudrexPositionStatus(status: string | null | undefined): string | null {
  const raw = String(status || '').trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.toUpperCase();
  if (['OPEN'].includes(normalized)) return 'OPEN';
  if (['CLOSED', 'CLOSE'].includes(normalized)) return 'CLOSED';
  if (['LIQUIDATED', 'LIQUIDATION'].includes(normalized)) return 'LIQUIDATED';
  if (['PARTIAL', 'PARTIALLY_CLOSED', 'PARTIALLY_CLOSED_POSITION'].includes(normalized)) {
    return 'PARTIAL';
  }
  return normalized;
}

function resolveMudrexPositionDirection(payload: Record<string, unknown>): 'long' | 'short' {
  const side = String(payload.side ?? '')
    .trim()
    .toLowerCase();
  const positionType = String(payload.position_type ?? '')
    .trim()
    .toLowerCase();
  const orderType = String(payload.order_type ?? '')
    .trim()
    .toLowerCase();

  if (
    side === 'short' ||
    side === 'sell' ||
    positionType === 'short' ||
    orderType === 'sell' ||
    orderType === 'short'
  ) {
    return 'short';
  }
  return 'long';
}

function waitForPoll(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveMudrexPositionEntrySide(
  trade: SuggestedTradeSideLike,
  positionPayload: Record<string, unknown>
): 'buy' | 'sell' | null {
  const payloadSide = String(
    readStringValue(positionPayload.order_type) ??
      readStringValue(positionPayload.position_type) ??
      readStringValue(positionPayload.side) ??
      ''
  )
    .trim()
    .toLowerCase();
  if (['long', 'buy'].includes(payloadSide)) {
    return 'buy';
  }
  if (['short', 'sell'].includes(payloadSide)) {
    return 'sell';
  }
  const tradeSide = String(trade.side || '')
    .trim()
    .toUpperCase();
  if (tradeSide === 'BUY') {
    return 'buy';
  }
  if (tradeSide === 'SELL') {
    return 'sell';
  }
  return null;
}
