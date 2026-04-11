import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { coreDataSource } from '../src/database/data-source';
import { initializeCoreDataSource } from '../src/database/initializeCoreDataSource';
import { SuggestedTrade } from '../src/database/entities/SuggestedTrade';
import { SuggestedTradeExecution } from '../src/database/entities/SuggestedTradeExecution';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.SMOKE_BASE_URL || `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const LOGIN_EMAIL =
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || 'admin@auralpha.com';
const LOGIN_PASSWORD =
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || 'Admin@123';

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function asArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  );
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected a finite number, received ${String(value)}`);
  }
  return numeric;
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let payload: JsonRecord = {};
  try {
    payload = text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `${init.method || 'GET'} ${path} -> HTTP ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return payload;
}

async function login(): Promise<string> {
  const response = await requestJson('/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
    }),
  });
  const accessToken = readString(asRecord(response.data).accessToken);
  assert.ok(accessToken, 'login should return an access token');
  return accessToken;
}

async function run(): Promise<void> {
  const accessToken = await login();
  const meResponse = await requestJson('/auth/me', {}, accessToken);
  const me = asRecord(meResponse.data);
  const userId = readString(me.id);
  assert.equal(readString(me.email).toLowerCase(), LOGIN_EMAIL.toLowerCase());
  assert.ok(userId, 'auth me should return a user id');

  const tradeId = randomUUID();
  const automationId = randomUUID();
  const automationRunId = randomUUID();
  const symbol = `PHASE6SMK${Date.now()}`.slice(0, 16);
  let initializedHere = false;

  try {
    if (!coreDataSource.isInitialized) {
      await initializeCoreDataSource();
      initializedHere = true;
    }

    await coreDataSource.getRepository(SuggestedTrade).save({
      id: tradeId,
      automationId,
      automationRunId,
      userId,
      symbol,
      timeframe: '1h',
      side: 'BUY',
      signalTime: new Date(),
      status: 'Open',
      confidence: 0.82,
      score: 0.91,
      entryPrice: '64000',
      stopLossPrice: '63000',
      takeProfitTargets: ['65000', '66000'],
      entryRule: 'Phase 6 smoke entry',
      exitRule: 'Phase 6 smoke exit',
      rationale: 'Suggested trades lifecycle smoke fixture',
      dedupeKey: `phase6-smoke:${tradeId}`,
      meta: {
        source: 'smoke-suggested-trades-lifecycle',
      },
    });

    const overviewResponse = await requestJson(
      `/suggested-trades/overview?symbol=${encodeURIComponent(symbol)}&limit=10&offset=0`,
      {},
      accessToken
    );
    const overview = asRecord(overviewResponse.data);
    const overviewTrades = asRecord(overview.suggestedTrades);
    assert.ok(readNumber(overviewTrades.total) >= 1, 'overview should include the inserted trade');
    assert.equal(asArray(overview.quickActions).length >= 2, true);

    const reviewResponse = await requestJson(
      `/suggested-trades/${encodeURIComponent(tradeId)}/review`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          note: 'Phase 6 review smoke check',
        }),
      },
      accessToken
    );
    assert.match(readString(asRecord(reviewResponse.data).message), /reviewed/i);

    const acceptResponse = await requestJson(
      `/suggested-trades/${encodeURIComponent(tradeId)}/accept`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          note: 'Phase 6 accept smoke check',
        }),
      },
      accessToken
    );
    assert.match(readString(asRecord(acceptResponse.data).message), /accepted/i);

    const orderId = `smoke-order-${Date.now()}`;
    const linkResponse = await requestJson(
      `/suggested-trades/${encodeURIComponent(tradeId)}/link-order`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          executionMode: 'live',
          orderId,
          brokerKey: 'smoke-broker',
          accountId: `smoke-account-${Date.now()}`,
          orderStatus: 'OPEN',
          orderType: 'market',
          quantity: 1,
          entryPrice: 64000,
        }),
      },
      accessToken
    );
    const linkedTrade = asRecord(asRecord(linkResponse.data).suggestedTrade);
    assert.equal(readString(asRecord(linkedTrade.execution).orderId), orderId);

    const reconcileResponse = await requestJson(
      '/suggested-trades/reconcile-execution',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          suggestedTradeIds: [tradeId],
          staleOnly: false,
        }),
      },
      accessToken
    );
    const reconcileData = asRecord(reconcileResponse.data);
    assert.equal(readNumber(reconcileData.processed), 1);

    const detailResponse = await requestJson(
      `/suggested-trades/${encodeURIComponent(tradeId)}`,
      {},
      accessToken
    );
    const detail = asRecord(detailResponse.data);
    assert.equal(readString(detail.status), 'Accepted');
    assert.equal(readString(asRecord(detail.execution).orderId), orderId);
    assert.equal(readString(asRecord(detail.syncStatus).state).length > 0, true);

    const healthResponse = await requestJson('/health/suggested-trades', {}, accessToken);
    const health = asRecord(healthResponse.data);
    assert.equal(Boolean(health.rolloutEnabled), true);
    assert.notEqual(health.queueToOrderSuccess24h, undefined);
    assert.notEqual(health.overviewLatencyMs, null);
    assert.notEqual(health.listLatencyMs, null);
    assert.notEqual(health.summaryLatencyMs, null);
    assert.notEqual(health.syncStatusLatencyMs, null);

    console.log(
      'suggested-trades-lifecycle-smoke:',
      JSON.stringify({
        userId,
        tradeId,
        symbol,
        syncState: readString(health.syncState),
        queueToOrderSuccess24h: readNumber(health.queueToOrderSuccess24h),
      })
    );
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.getRepository(SuggestedTradeExecution).delete({
        suggestedTradeId: tradeId,
      });
      await coreDataSource.getRepository(SuggestedTrade).delete({
        id: tradeId,
      });
      if (initializedHere) {
        await coreDataSource.destroy();
      }
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
