import { PositionRecord, PositionSummary } from '../contracts/Positions';

export interface PositionReadModelUpsert {
  userId: string;
  accountId: string;
  brokerKey: string;
  externalId: string;
  symbol: string | null;
  side: string;
  sideKey: string;
  sideRaw: string | null;
  status: string;
  statusKey: string;
  statusRaw: string | null;
  statusRank: number;
  quantity: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  closedPrice: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  leverage: number | null;
  liquidationPrice: number | null;
  exposure: number | null;
  orderPrice: number | null;
  stoplossPrice: number | null;
  takeprofitPrice: number | null;
  stoplossOrderId: string | null;
  takeprofitOrderId: string | null;
  triggerType: string | null;
  positionCreatedAt: string | null;
  positionUpdatedAt: string | null;
  positionClosedAt: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  payloadJson: string | null;
  payloadHash: string | null;
}

export interface PositionReadModelRow {
  userId?: string;
  accountId?: string;
  brokerKey?: string;
  externalId?: string;
  symbol?: unknown;
  side?: unknown;
  sideKey?: unknown;
  sideRaw?: unknown;
  status?: unknown;
  statusKey?: unknown;
  statusRaw?: unknown;
  statusRank?: unknown;
  quantity?: unknown;
  entryPrice?: unknown;
  currentPrice?: unknown;
  closedPrice?: unknown;
  unrealizedPnl?: unknown;
  realizedPnl?: unknown;
  leverage?: unknown;
  liquidationPrice?: unknown;
  exposure?: unknown;
  orderPrice?: unknown;
  stoplossPrice?: unknown;
  takeprofitPrice?: unknown;
  stoplossOrderId?: unknown;
  takeprofitOrderId?: unknown;
  triggerType?: unknown;
  positionCreatedAt?: unknown;
  positionUpdatedAt?: unknown;
  positionClosedAt?: unknown;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
  payloadJson?: unknown;
  payloadHash?: unknown;
}

type PositionRecordLike = Record<string, unknown>;

function toRecord(value: unknown): PositionRecordLike | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as PositionRecordLike;
}

function pickFirst(record: PositionRecordLike, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
      return record[key];
    }
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  const raw = String(value).trim();
  if (!raw || raw === '--') {
    return null;
  }
  const cleaned = raw.replace(/[^0-9.+-]/g, '');
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toDate(value: unknown): Date | null {
  const iso = toIsoString(value);
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolvePositionSide(position: PositionRecordLike): {
  label: string;
  raw: string | null;
  key: string;
} {
  const raw = String(
    pickFirst(position, [
      'side',
      'position_type',
      'order_type',
      'orderType',
      'positionSide',
      'position_side',
    ]) || ''
  )
    .trim()
    .toLowerCase();

  if (raw === 'buy' || raw === 'long') {
    return { label: 'Long', raw: raw || null, key: 'long' };
  }
  if (raw === 'sell' || raw === 'short') {
    return { label: 'Short', raw: raw || null, key: 'short' };
  }

  const quantity = toNumber(
    pickFirst(position, ['quantity', 'size', 'qty', 'position_size', 'net_quantity'])
  );
  if (quantity !== null && quantity < 0) {
    return { label: 'Short', raw: raw || null, key: 'short' };
  }
  if (quantity !== null && quantity >= 0) {
    return { label: 'Long', raw: raw || null, key: 'long' };
  }
  return { label: '--', raw: raw || null, key: 'unknown' };
}

function normalizeStatus(value: unknown): { label: string; raw: string | null; key: string } {
  const rawText = String(value || '').trim();
  const key = rawText
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');

  if (['open', 'active', 'live', 'running'].includes(key)) {
    return { label: 'Open', raw: rawText || null, key: 'open' };
  }
  if (['closed', 'filled', 'done', 'completed'].includes(key)) {
    return { label: 'Closed', raw: rawText || null, key: 'closed' };
  }
  if (['liquidated', 'liquidation', 'forced'].includes(key)) {
    return { label: 'Liquidated', raw: rawText || null, key: 'liquidated' };
  }
  if (['partial', 'partially_closed', 'partially_closed_position'].includes(key)) {
    return { label: 'Partial', raw: rawText || null, key: 'partial' };
  }
  return {
    label: rawText || '--',
    raw: rawText || null,
    key: key || 'unknown',
  };
}

function computeStatusRank(statusKey: string): number {
  if (statusKey === 'open') return 1;
  if (statusKey === 'partial') return 2;
  if (statusKey === 'closed') return 3;
  if (statusKey === 'liquidated') return 4;
  return 0;
}

export function parsePositionPayloadJson(value: unknown): PositionRecordLike | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return toRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return toRecord(value);
}

export function buildPositionSummaryFromPayload(payload: PositionRecordLike): PositionSummary {
  const id = String(
    pickFirst(payload, ['id', 'external_id', 'externalId', 'position_id', 'positionId']) || ''
  ).trim();
  const externalId = String(
    pickFirst(payload, ['external_id', 'externalId', 'position_id', 'positionId', 'id']) || ''
  ).trim();
  const symbolValue = pickFirst(payload, [
    'symbol',
    'product_symbol',
    'productSymbol',
    'instrument',
    'market',
  ]);
  const symbol =
    symbolValue === undefined || symbolValue === null || String(symbolValue).trim() === ''
      ? null
      : String(symbolValue).trim();
  const side = resolvePositionSide(payload);
  const status = normalizeStatus(pickFirst(payload, ['status', 'state', 'position_status']));
  const signedQuantity = toNumber(
    pickFirst(payload, ['quantity', 'size', 'qty', 'position_size', 'net_quantity'])
  );
  const quantity = signedQuantity === null ? null : Math.abs(signedQuantity);
  const entryPrice = toNumber(
    pickFirst(payload, [
      'entry_price',
      'entry',
      'avg_entry',
      'avg_entry_price',
      'average_entry_price',
      'entryPrice',
    ])
  );
  const currentPrice = toNumber(
    pickFirst(payload, ['current_price', 'mark_price', 'price', 'currentPrice', 'markPrice'])
  );
  const closedPrice = toNumber(
    pickFirst(payload, ['closed_price', 'close_price', 'exit_price', 'exitPrice', 'closedPrice'])
  );
  const leverage = toNumber(
    pickFirst(payload, ['leverage', 'position_leverage', 'leverageValue'])
  );
  const liquidationPrice = toNumber(
    pickFirst(payload, ['liquidation_price', 'liq_price', 'liquidationPrice'])
  );
  const createdAt = toIsoString(pickFirst(payload, ['created_at', 'createdAt']));
  const closedAt = toIsoString(pickFirst(payload, ['closed_at', 'closedAt']));
  const updatedAt = toIsoString(
    pickFirst(payload, ['updated_at', 'updatedAt', 'closed_at', 'closedAt', 'created_at', 'createdAt'])
  );
  const unrealizedPnlExplicit = toNumber(
    pickFirst(payload, ['unrealized_pnl', 'unrealized', 'unrealizedPnl', 'pnl_unrealized'])
  );
  const realizedPnlExplicit = toNumber(
    pickFirst(payload, ['realized_pnl', 'realized', 'realizedPnl', 'pnl_realized'])
  );
  const fallbackRealized =
    status.key === 'closed' || status.key === 'liquidated'
      ? toNumber(pickFirst(payload, ['pnl']))
      : null;
  const exposure =
    entryPrice !== null && quantity !== null ? Math.abs(entryPrice * quantity) : null;
  const unrealizedPnl = (() => {
    if (unrealizedPnlExplicit !== null) {
      return unrealizedPnlExplicit;
    }
    if (entryPrice === null || currentPrice === null || quantity === null) {
      return null;
    }
    const direction = side.key === 'short' ? -1 : 1;
    return direction * (currentPrice - entryPrice) * quantity;
  })();

  return {
    id: id || externalId,
    externalId: externalId || undefined,
    symbol,
    side: side.label,
    sideKey: side.key,
    status: status.label,
    statusKey: status.key,
    quantity,
    entryPrice,
    currentPrice,
    closedPrice,
    unrealizedPnl,
    realizedPnl: realizedPnlExplicit ?? fallbackRealized,
    leverage,
    liquidationPrice,
    exposure,
    createdAt: createdAt || undefined,
    updatedAt: updatedAt || undefined,
    closedAt: closedAt || undefined,
  };
}

export function buildPositionReadModelUpsert(input: {
  userId: string;
  accountId: string;
  brokerKey: string;
  externalId: string;
  payload: unknown;
  payloadJson?: string | null;
  payloadHash?: string | null;
  statusRank?: number | null;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
}): PositionReadModelUpsert | null {
  const payload = parsePositionPayloadJson(input.payload);
  if (!payload) {
    return null;
  }

  const summary = buildPositionSummaryFromPayload(payload);
  const side = resolvePositionSide(payload);
  const status = normalizeStatus(pickFirst(payload, ['status', 'state', 'position_status']));
  const payloadJson = input.payloadJson ?? JSON.stringify(payload);
  const positionUpdatedAt =
    summary.updatedAt || summary.closedAt || summary.createdAt || null;
  const resolvedStatusRank =
    typeof input.statusRank === 'number' && Number.isFinite(input.statusRank)
      ? input.statusRank
      : computeStatusRank(summary.statusKey);

  return {
    userId: input.userId,
    accountId: input.accountId,
    brokerKey: input.brokerKey,
    externalId: input.externalId,
    symbol: summary.symbol,
    side: summary.side,
    sideKey: summary.sideKey,
    sideRaw: side.raw,
    status: summary.status,
    statusKey: summary.statusKey,
    statusRaw: status.raw,
    statusRank: resolvedStatusRank,
    quantity: summary.quantity,
    entryPrice: summary.entryPrice,
    currentPrice: summary.currentPrice,
    closedPrice: summary.closedPrice,
    unrealizedPnl: summary.unrealizedPnl,
    realizedPnl: summary.realizedPnl,
    leverage: summary.leverage,
    liquidationPrice: summary.liquidationPrice,
    exposure: summary.exposure,
    orderPrice: toNumber(
      pickFirst(payload, ['order_price', 'orderPrice', 'current_price', 'entry_price'])
    ),
    stoplossPrice: toNumber(
      pickFirst(payload, ['stoploss_price', 'stopLossPrice'])
    ),
    takeprofitPrice: toNumber(
      pickFirst(payload, ['takeprofit_price', 'takeProfitPrice'])
    ),
    stoplossOrderId: String(
      pickFirst(payload, ['stoploss_order_id', 'stopLossOrderId']) || ''
    ).trim() || null,
    takeprofitOrderId: String(
      pickFirst(payload, ['takeprofit_order_id', 'takeProfitOrderId']) || ''
    ).trim() || null,
    triggerType: String(
      pickFirst(payload, ['trigger_type', 'triggerType']) || ''
    ).trim() || null,
    positionCreatedAt: summary.createdAt || null,
    positionUpdatedAt,
    positionClosedAt:
      summary.closedAt || (resolvedStatusRank >= 3 ? positionUpdatedAt : null),
    firstSeenAt: toDate(input.firstSeenAt),
    lastSeenAt: toDate(input.lastSeenAt),
    payloadJson,
    payloadHash: input.payloadHash ?? null,
  };
}

export function buildPositionRecordFromReadModelRow(
  row: PositionReadModelRow,
  metadata?: Partial<Pick<PositionRecord, 'accountId' | 'accountName' | 'accountKey' | 'brokerKey'>>
): PositionRecord {
  const rawPayload = parsePositionPayloadJson(row.payloadJson);
  const summary: PositionSummary = {
    id: String(row.externalId || ''),
    externalId: String(row.externalId || '') || undefined,
    symbol: row.symbol === undefined || row.symbol === null ? null : String(row.symbol),
    side: String(row.side || '--'),
    sideKey: String(row.sideKey || 'unknown'),
    status: String(row.status || '--'),
    statusKey: String(row.statusKey || 'unknown'),
    quantity: toNumber(row.quantity),
    entryPrice: toNumber(row.entryPrice),
    currentPrice: toNumber(row.currentPrice),
    closedPrice: toNumber(row.closedPrice),
    unrealizedPnl: toNumber(row.unrealizedPnl),
    realizedPnl: toNumber(row.realizedPnl),
    leverage: toNumber(row.leverage),
    liquidationPrice: toNumber(row.liquidationPrice),
    exposure: toNumber(row.exposure),
    createdAt: toIsoString(row.positionCreatedAt) || undefined,
    updatedAt: toIsoString(row.positionUpdatedAt) || undefined,
    closedAt: toIsoString(row.positionClosedAt) || undefined,
  };

  return {
    ...(metadata || {}),
    id: summary.id,
    external_id: summary.externalId,
    externalId: summary.externalId,
    symbol: summary.symbol,
    side: summary.side,
    side_raw: String(row.sideRaw || '').trim() || null,
    sideKey: summary.sideKey,
    status: summary.status,
    status_raw: String(row.statusRaw || '').trim() || null,
    statusKey: summary.statusKey,
    quantity: summary.quantity,
    quantity_raw:
      rawPayload?.quantity ?? rawPayload?.size ?? rawPayload?.qty ?? summary.quantity,
    entry_price: summary.entryPrice,
    current_price: summary.currentPrice,
    closed_price: summary.closedPrice,
    unrealized_pnl: summary.unrealizedPnl,
    realized_pnl: summary.realizedPnl,
    realized: summary.realizedPnl,
    leverage: summary.leverage,
    liquidation_price: summary.liquidationPrice,
    exposure: summary.exposure,
    order_price: toNumber(row.orderPrice),
    stoploss_price: toNumber(row.stoplossPrice),
    takeprofit_price: toNumber(row.takeprofitPrice),
    stoploss_order_id: String(row.stoplossOrderId || '').trim() || undefined,
    takeprofit_order_id: String(row.takeprofitOrderId || '').trim() || undefined,
    trigger_type: String(row.triggerType || '').trim() || undefined,
    created_at: summary.createdAt,
    updated_at: summary.updatedAt,
    closed_at: summary.closedAt,
    first_seen_at: toIsoString(row.firstSeenAt) || undefined,
    last_seen_at: toIsoString(row.lastSeenAt) || undefined,
    rawPayload: rawPayload || undefined,
    positionSummary: summary,
  };
}
