import assert from 'node:assert/strict';
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
  const data = asRecord(response.data);
  const accessToken = readString(data.accessToken);
  assert.ok(accessToken, 'login should return an access token');
  return accessToken;
}

async function waitFor<T>(
  loader: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 10);
  const delayMs = Math.max(100, options.delayMs ?? 500);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('waitFor exhausted without a result');
}

function buildPerformanceSurface(generatedAt: string) {
  return {
    generatedAt,
    executionAssumptions: {
      feesPct: 0.1,
      slippagePct: 0.05,
      startingCapital: 10000,
      leverage: 1,
    },
    results: [
      {
        symbol: 'ETHUSDT',
        timeframe: '4h',
        score: 0.89,
        total_trades: 5,
        win_rate: 60,
        profit_factor: 1.72,
        total_return_pct: 9.4,
        max_drawdown_pct: 3.8,
        robustness: {
          evaluationMethod: 'walk-forward-multi-split',
          robustnessScore: 0.84,
          walkForwardPassRate: 0.7,
          averageOutOfSampleReturnPct: 5.2,
          worstOutOfSampleReturnPct: 1.3,
          promotionReady: true,
          reasons: [],
        },
        portfolioPressure: {
          pressureScore: 0.9,
          executedTradeRatio: 1,
          pressureState: 'healthy',
          capitalDepletionRisk: false,
        },
      },
    ],
  };
}

function buildTradeEvents(referenceTimeMs: number) {
  const baseEntryTime = referenceTimeMs - 14 * 24 * 60 * 60 * 1000;

  return Array.from({ length: 5 }, (_, index) => {
    const entryTime = baseEntryTime + index * 24 * 60 * 60 * 1000;
    const exitTime = entryTime + 4 * 60 * 60 * 1000;
    const entryPrice = 2000 + index * 25;
    const exitPrice = entryPrice + (index % 2 === 0 ? 18 : -12);

    return {
      symbol: 'ETHUSDT',
      interval: '4h',
      side: index % 2 === 0 ? 'BUY' : 'SELL',
      entryTime,
      entryPrice,
      exitTime,
      exitPrice,
    };
  });
}

async function safeDelete(
  path: string,
  accessToken: string,
  label: string
): Promise<void> {
  try {
    await requestJson(
      path,
      {
        method: 'DELETE',
      },
      accessToken
    );
  } catch (error) {
    console.warn(
      `${label}-cleanup-warning:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function run(): Promise<void> {
  const accessToken = await login();
  const meResponse = await requestJson('/auth/me', {}, accessToken);
  const me = asRecord(meResponse.data);
  assert.equal(readString(me.email).toLowerCase(), LOGIN_EMAIL.toLowerCase());

  const now = Date.now();
  const templateName = `Phase 6 Lineage Template ${now}`;
  const libraryName = `Phase 6 Lineage Runner ${now}`;
  const runStart = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const runEnd = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const performanceSurface = buildPerformanceSurface(new Date(now).toISOString());
  const tradeEvents = buildTradeEvents(now);

  let templateId = '';
  let libraryId = '';

  try {
    const createTemplateResponse = await requestJson(
      '/strategy-templates',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: templateName,
          description: 'Phase 6 strategy-library lineage smoke template',
          status: 'Active',
          config: {
            market: 'crypto-futures',
            entryLogic: 'ema(10) > ema(20)',
            exitLogic: 'ema(10) < ema(20)',
            risk: {
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
            },
          },
        }),
      },
      accessToken
    );
    const createdTemplate = asRecord(createTemplateResponse.data);
    templateId = readString(createdTemplate.id);
    assert.ok(templateId, 'create template should return an id');
    assert.equal(readString(createdTemplate.name), templateName);
    assert.equal(readString(createdTemplate.status), 'Active');

    const importResponse = await requestJson(
      '/strategy-library/import',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          templateId,
          name: libraryName,
          status: 'Active',
          assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
          timeframes: ['1h'],
          overrides: {
            maxPositions: 2,
            market: 'crypto-futures',
          },
        }),
      },
      accessToken
    );
    const importedLibrary = asRecord(importResponse.data);
    libraryId = readString(importedLibrary.id);
    assert.ok(libraryId, 'import strategy library should return an id');
    assert.equal(readString(importedLibrary.name), libraryName);
    assert.equal(readString(importedLibrary.templateId), templateId);
    assert.equal(readString(importedLibrary.status), 'Active');

    const libraryDetailResponse = await requestJson(
      `/strategy-library/${encodeURIComponent(libraryId)}`,
      {},
      accessToken
    );
    const libraryDetail = asRecord(libraryDetailResponse.data);
    assert.equal(readString(libraryDetail.templateId), templateId);
    assert.equal(readString(libraryDetail.templateName), templateName);
    assert.equal(readString(libraryDetail.status), 'Active');
    assert.equal(
      Object.prototype.hasOwnProperty.call(libraryDetail, 'recentRuns'),
      false,
      'library detail should stay lean and exclude durable run history'
    );

    const runResponse = await requestJson(
      `/strategy-library/${encodeURIComponent(libraryId)}/run`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          assets: [
            { symbol: 'ETHUSDT', brokerKey: 'paper' },
            { symbol: 'SOLUSDT', brokerKey: 'paper' },
          ],
          timeframes: ['4h'],
          overrides: {
            maxPositions: 3,
            market: 'crypto-spot',
          },
          start: runStart,
          end: runEnd,
        }),
      },
      accessToken
    );
    const queuedRun = asRecord(runResponse.data);
    const backtestId = readString(queuedRun.backtestId);
    assert.ok(backtestId, 'library run should return a child backtest id');
    assert.equal(readString(queuedRun.status), 'queued');

    const queuedBacktestResponse = await requestJson(
      `/backtests/${encodeURIComponent(backtestId)}`,
      {},
      accessToken
    );
    const queuedBacktest = asRecord(queuedBacktestResponse.data);
    const queuedLineage = asRecord(queuedBacktest.lineage);
    assert.equal(readString(queuedBacktest.sourceType), 'strategy_library');
    assert.equal(readString(queuedBacktest.libraryId), libraryId);
    assert.equal(readString(queuedBacktest.templateId), templateId);
    assert.equal(readString(queuedLineage.sourceType), 'strategy_library');
    assert.equal(readString(queuedLineage.libraryId), libraryId);
    assert.equal(readString(queuedLineage.libraryName), libraryName);
    assert.equal(readString(queuedLineage.templateId), templateId);
    assert.equal(readString(queuedLineage.templateName), templateName);
    assert.equal(readString(queuedBacktest.dateRangeStart), runStart);
    assert.equal(readString(queuedBacktest.dateRangeEnd), runEnd);

    const queuedRunsResponse = await requestJson(
      `/strategy-library/${encodeURIComponent(libraryId)}/runs?limit=5`,
      {},
      accessToken
    );
    const queuedRuns = asArray(asRecord(queuedRunsResponse.data).items);
    assert.ok(queuedRuns.length >= 1, 'strategy-library runs endpoint should return queued run history');
    assert.equal(readString(queuedRuns[0]?.backtestId), backtestId);
    assert.equal(readString(queuedRuns[0]?.status), 'Queued');
    assert.equal(readString(queuedRuns[0]?.parameter).includes(libraryName), true);

    const backtestsListItem = await waitFor(async () => {
      const response = await requestJson(
        `/backtests?limit=10&offset=0&search=${encodeURIComponent(libraryName)}`,
        {},
        accessToken
      );
      const items = asArray(asRecord(response.data).items);
      const item = items.find((entry) => readString(entry.id) === backtestId);
      assert.ok(item, 'queued backtest should appear in backtests list');
      return item;
    });
    const listLineage = asRecord(backtestsListItem.lineage);
    assert.equal(readString(listLineage.libraryId), libraryId);
    assert.equal(readString(listLineage.templateId), templateId);

    const inputSnapshotResponse = await requestJson(
      `/backtests/${encodeURIComponent(backtestId)}/input-snapshot`,
      {},
      accessToken
    );
    const snapshot = asRecord(asRecord(inputSnapshotResponse.data).snapshot);
    const snapshotLineage = asRecord(snapshot.lineage);
    const snapshotDateRange = asRecord(snapshot.dateRange);
    const snapshotInputs = asRecord(snapshot.inputs);
    assert.equal(readString(snapshotLineage.sourceType), 'strategy_library');
    assert.equal(readString(snapshotLineage.libraryId), libraryId);
    assert.equal(readString(snapshotLineage.templateId), templateId);
    assert.equal(readString(snapshotDateRange.start), runStart);
    assert.equal(readString(snapshotDateRange.end), runEnd);
    assert.equal(
      readString(asRecord(snapshotInputs.inputSnapshot).libraryId),
      libraryId
    );

    const runActivity = await waitFor(async () => {
      const response = await requestJson(
        `/activity?limit=20&offset=0&route=${encodeURIComponent('Strategy Library')}&referenceId=${encodeURIComponent(libraryId)}`,
        {},
        accessToken
      );
      const items = asArray(asRecord(response.data).items);
      const item = items.find((entry) =>
        readString(entry.title).toLowerCase().includes('strategy run requested')
      );
      assert.ok(item, 'strategy-library run activity should exist');
      return item;
    });
    const activityId = readString(runActivity.id);
    assert.ok(activityId, 'strategy-library run activity should expose an id');

    const activityDetailResponse = await requestJson(
      `/activity/${encodeURIComponent(activityId)}`,
      {},
      accessToken
    );
    const activityDetail = asRecord(activityDetailResponse.data);
    const linkedEntity = asRecord(activityDetail.linkedEntity);
    assert.equal(readString(linkedEntity.kind), 'strategy_library');
    assert.equal(
      readString(linkedEntity.path),
      `/strategy-library?selected=${encodeURIComponent(libraryId)}`
    );
    assert.match(readString(activityDetail.description), new RegExp(backtestId));

    const completedResponse = await requestJson(
      `/backtests/${encodeURIComponent(backtestId)}/results`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'Completed',
          stability: 'Stable',
          trades: 5,
          cagr: 9.4,
          sharpe: 1.36,
          drawdown: 3.8,
          winRate: 60,
          profitFactor: 1.72,
          performanceSurface,
          tradeEvents,
        }),
      },
      accessToken
    );
    const completedBacktest = asRecord(completedResponse.data);
    assert.equal(readString(completedBacktest.runStatus), 'Completed');
    assert.equal(readString(asRecord(completedBacktest.lineage).libraryId), libraryId);

    const completedRuns = await waitFor(async () => {
      const response = await requestJson(
        `/strategy-library/${encodeURIComponent(libraryId)}/runs?limit=5`,
        {},
        accessToken
      );
      const items = asArray(asRecord(response.data).items);
      const runItem = items.find((entry) => readString(entry.backtestId) === backtestId);
      assert.ok(runItem, 'completed strategy-library run should persist in durable run history');
      assert.equal(readString(runItem.status), 'Completed');
      assert.ok(readString(runItem.completedAt), 'completed run history should expose completedAt');
      return runItem;
    });
    assert.equal(readString(completedRuns.backtestId), backtestId);

    const topSetup = await waitFor(async () => {
      const response = await requestJson(
        `/backtests/top-setups?limit=10&offset=0&search=${encodeURIComponent(libraryName)}`,
        {},
        accessToken
      );
      const items = asArray(asRecord(response.data).items);
      const item = items.find((entry) => readString(entry.backtestId) === backtestId);
      assert.ok(item, 'completed strategy-library run should surface in top setups');
      return item;
    });
    const topSetupLineage = asRecord(topSetup.lineage);
    assert.equal(readString(topSetupLineage.sourceType), 'strategy_library');
    assert.equal(readString(topSetupLineage.libraryId), libraryId);
    assert.equal(readString(topSetupLineage.templateId), templateId);

    console.log(
      'strategy-library-lineage-smoke:',
      JSON.stringify({
        templateId,
        libraryId,
        backtestId,
        activityId,
        topSetupId: readString(topSetup.id),
      })
    );
  } finally {
    if (libraryId) {
      await safeDelete(`/strategy-library/${encodeURIComponent(libraryId)}`, accessToken, 'library');
    }
    if (templateId) {
      await safeDelete(`/strategy-templates/${encodeURIComponent(templateId)}`, accessToken, 'template');
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
