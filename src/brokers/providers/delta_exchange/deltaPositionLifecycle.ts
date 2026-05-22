import { createHash } from 'node:crypto';

export interface DeltaClosedPositionLifecycleInput {
  productId?: unknown;
  side?: unknown;
  status?: unknown;
  quantity?: unknown;
  entryPrice?: unknown;
  closePrice?: unknown;
  closedAt?: unknown;
}

export function buildDeltaClosedPositionLifecycleId(
  input: DeltaClosedPositionLifecycleInput
): string | null {
  const productId = normalizeText(input.productId);
  const side = normalizeSide(input.side);
  const status = normalizeStatus(input.status);
  const quantity = normalizeNumber(input.quantity);
  const entryPrice = normalizeNumber(input.entryPrice);
  const closePrice = normalizeNumber(input.closePrice);
  const closedAt = normalizeTimestamp(input.closedAt);

  if (!productId || !side || !status || !quantity || !entryPrice || !closePrice || !closedAt) {
    return null;
  }

  const identityParts = {
    productId,
    side,
    status,
    quantity,
    entryPrice,
    closePrice,
    closedAt,
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(identityParts))
    .digest('hex')
    .slice(0, 16);

  return `delta:${productId}:${side}:${status}:${closedAt}:${digest}`;
}

function normalizeText(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function normalizeSide(value: unknown): 'long' | 'short' | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'long' || raw === 'buy') {
    return 'long';
  }
  if (raw === 'short' || raw === 'sell') {
    return 'short';
  }
  return null;
}

function normalizeStatus(value: unknown): 'closed' | 'liquidated' | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'closed' || raw === 'close') {
    return 'closed';
  }
  if (raw === 'liquidated' || raw === 'liquidation') {
    return 'liquidated';
  }
  return null;
}

function normalizeNumber(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric.toFixed(8);
}

function normalizeTimestamp(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toISOString();
}
