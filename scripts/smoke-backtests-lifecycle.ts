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
const REQUIRE_CHART =
  String(process.env.SMOKE_REQUIRE_BACKTEST_CHART || '')
    .trim()
    .toLowerCase() === 'true';

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
  const data = asRecord(response.data);
  const accessToken = readString(data.accessToken);
  assert.ok(accessToken, 'login should return an access token');
  return accessToken;
}

function buildTradeEvents(anchorTimeMs: number) {
  return Array.from({ length: 5 }, (_, index) => {
    const entryTime = anchorTimeMs + index * 60 * 60 * 1000;
    const exitTime = entryTime + 30 * 60 * 1000;
    const isLong = index % 2 === 0;
    const entryPrice = 100 + index * 3;
    const exitPrice = isLong ? entryPrice + 4 : entryPrice - 3;
    return {
      symbol: 'BTCUSDT',
      interval: '1h',
      side: isLong ? 'BUY' : 'SELL',
      entryTime,
      entryPrice,
      exitTime,
      exitPrice,
    };
  });
}

function buildSharedLifecycleConfig(runKey: string, startIso: string, endIso: string) {
  return {
    source: 'strategy_lab',
    sourceType: 'strategy_lab',
    sourceId: runKey,
    projectId: runKey,
    projectVersion: 1,
    sourceTemplateId: `tpl-${runKey}`,
    sourceTemplateName: 'Phase 11 Smoke Template',
    sourceTemplateVersion: 1,
    market: 'crypto-futures',
    inputSnapshot: {
      sourceType: 'strategy_lab',
      sourceId: runKey,
      projectId: runKey,
      projectVersion: 1,
      sourceTemplateId: `tpl-${runKey}`,
      sourceTemplateName: 'Phase 11 Smoke Template',
      sourceTemplateVersion: 1,
      market: 'crypto-futures',
      assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
      timeframes: ['1h'],
      start: startIso,
      end: endIso,
      template: {
        id: `tpl-${runKey}`,
        name: 'Phase 11 Smoke Template',
        templateVersion: 1,
        config: {
          market: 'crypto-futures',
          entryLogic: 'ema(10) > ema(20)',
          exitLogic: 'ema(10) < ema(20)',
          risk: {
            stopLossPct: 2,
            takeProfitTargetsPct: [4],
          },
          parameters: {
            signalThreshold: 0.8,
          },
        },
      },
      templateDiffSummary: {
        changedCount: 1,
        inheritedCount: 5,
        changedFields: ['Signal threshold'],
      },
    },
    tradeEventCount: 5,
  };
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
        symbol: 'BTCUSDT',
        timeframe: '1h',
        score: 0.93,
        total_trades: 5,
        win_rate: 60,
        profit_factor: 1.6,
        total_return_pct: 8.4,
        max_drawdown_pct: 3.1,
        robustness: {
          evaluationMethod: 'walk-forward-multi-split',
          robustnessScore: 0.88,
          walkForwardPassRate: 0.75,
          averageOutOfSampleReturnPct: 5.1,
          worstOutOfSampleReturnPct: 1.4,
          promotionReady: true,
          reasons: [],
        },
        portfolioPressure: {
          pressureScore: 0.94,
          executedTradeRatio: 1,
          pressureState: 'healthy',
          capitalDepletionRisk: false,
        },
      },
    ],
  };
}

async function run(): Promise<void> {
  const accessToken = await login();
  const meResponse = await requestJson('/auth/me', {}, accessToken);
  const me = asRecord(meResponse.data);
  assert.equal(readString(me.email).toLowerCase(), LOGIN_EMAIL.toLowerCase());

  const healthResponse = await requestJson('/health/backtests', {}, accessToken);
  const health = asRecord(healthResponse.data);
  console.log('backtests-health:', JSON.stringify(healthResponse));
  assert.notEqual(readString(health.status), 'down');

  const now = Date.now();
  const runKey = `phase11-smoke-${now}`;
  const windowStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now - 24 * 60 * 60 * 1000);
  const generatedAt = new Date(now).toISOString();
  const startIso = windowStart.toISOString();
  const endIso = windowEnd.toISOString();
  const anchorTradeTimeMs = windowStart.getTime() + 2 * 60 * 60 * 1000;
  const tradeEvents = buildTradeEvents(anchorTradeTimeMs);
  const sharedConfig = buildSharedLifecycleConfig(runKey, startIso, endIso);
  const performanceSurface = buildPerformanceSurface(generatedAt);

  const createResponse = await requestJson(
    '/backtests',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        universe: runKey,
        interval: '1h',
        capital: '10000',
        fees: '0.1',
        slippage: '0.05',
        spread: '0.02',
        latencyBars: 1,
        fillPolicy: 'conservative-stop-first',
        participationPct: 95,
        capitalUtilizationPct: 100,
        leverage: 1,
        startingCapital: 10000,
        haltOnCapitalDepletion: true,
        dateRange: `${startIso}/${endIso}`,
        benchmark: 'BTCUSDT',
        includeExtended: false,
        usePaperGate: false,
      }),
    },
    accessToken
  );
  const createdBacktest = asRecord(asRecord(createResponse.data).backtest);
  const backtestId = readString(createdBacktest.id);
  assert.ok(backtestId, 'create backtest should return an id');
  console.log('backtest-created:', backtestId);

  await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}/results`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        status: 'Failed',
        stability: 'Needs review',
        trades: 0,
        cagr: -1.2,
        sharpe: 0.42,
        drawdown: 5.1,
        winRate: 40,
        profitFactor: 0.91,
        config: {
          ...sharedConfig,
          progress: {
            state: 'failed',
            processed: 3,
            total: 5,
            percent: 60,
            updatedAt: generatedAt,
            failedCount: 1,
            tradeEventCount: 0,
            error: 'runner exited before completion',
          },
          resumeCheckpoint: {
            state: 'failed',
            startedAt: startIso,
            lastUpdatedAt: generatedAt,
            completedCombinations: 3,
            totalCombinations: 5,
            tradeEventCount: 0,
            resultsSummary: {
              processed: 3,
              failedCount: 1,
            },
            error: 'runner exited before completion',
          },
        },
        performanceSurface,
      }),
    },
    accessToken
  );

  const failedDetailResponse = await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}`,
    {},
    accessToken
  );
  const failedDetail = asRecord(failedDetailResponse.data);
  assert.equal(readString(failedDetail.runStatus), 'Failed');
  assert.equal(readString(asRecord(failedDetail.resumeCheckpoint).state), 'failed');
  assert.equal(readNumber(failedDetail.expectedTradeEvents), 5);
  assert.equal(readNumber(failedDetail.storedTradeEvents), 0);

  const recoverResponse = await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}/recover`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
    },
    accessToken
  );
  const recovered = asRecord(recoverResponse.data);
  assert.match(readString(recovered.message), /re-queued/i);
  assert.equal(readString(asRecord(recovered.backtest).runStatus), 'Queued');

  const recoveredDetailResponse = await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}`,
    {},
    accessToken
  );
  const recoveredDetail = asRecord(recoveredDetailResponse.data);
  assert.equal(readString(recoveredDetail.runStatus), 'Queued');
  assert.equal(readString(asRecord(recoveredDetail.resumeCheckpoint).state), 'queued');

  await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}/results`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        status: 'Completed',
        stability: 'Stable',
        trades: tradeEvents.length,
        cagr: 8.4,
        sharpe: 1.52,
        drawdown: 3.1,
        winRate: 60,
        profitFactor: 1.6,
        config: {
          ...sharedConfig,
          progress: {
            state: 'completed',
            processed: 5,
            total: 5,
            percent: 100,
            updatedAt: generatedAt,
            finishedAt: generatedAt,
            okCount: 5,
            failedCount: 0,
            tradeEventCount: tradeEvents.length,
            resumeCount: 1,
            resumedFromCheckpoint: true,
            error: null,
          },
          resumeCheckpoint: {
            state: 'completed',
            startedAt: startIso,
            lastUpdatedAt: generatedAt,
            finishedAt: generatedAt,
            completedCombinations: 5,
            totalCombinations: 5,
            tradeEventCount: tradeEvents.length,
            resumeCount: 1,
            resumedFromCheckpoint: true,
            resultsSummary: {
              processed: 5,
              okCount: 5,
              failedCount: 0,
            },
            error: null,
          },
        },
        performanceSurface,
        tradeEvents,
      }),
    },
    accessToken
  );

  const completedDetailResponse = await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}`,
    {},
    accessToken
  );
  const completedDetail = asRecord(completedDetailResponse.data);
  assert.equal(readString(completedDetail.runStatus), 'Completed');
  assert.equal(readNumber(completedDetail.expectedTradeEvents), tradeEvents.length);
  assert.equal(readNumber(completedDetail.storedTradeEvents), tradeEvents.length);
  assert.equal(Boolean(completedDetail.hasIncompleteTradeHistory), false);

  const topSetupsResponse = await requestJson(
    `/backtests/top-setups?search=${encodeURIComponent(runKey)}&timeframe=1h&eligibleOnly=true`,
    {},
    accessToken
  );
  const topSetups = asArray(asRecord(topSetupsResponse.data).items);
  assert.ok(topSetups.length >= 1, 'top setups should include the completed smoke run');
  const selectedTopSetup =
    topSetups.find((item) => readString(item.backtestId) === backtestId) || topSetups[0];
  assert.equal(readString(selectedTopSetup.backtestId), backtestId);
  assert.equal(readString(selectedTopSetup.symbol), 'BTCUSDT');
  assert.equal(readString(selectedTopSetup.timeframe), '1h');
  assert.equal(Boolean(selectedTopSetup.eligibleForAutomation), true);

  const snapshotResponse = await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}/input-snapshot`,
    {},
    accessToken
  );
  const snapshot = asRecord(asRecord(snapshotResponse.data).snapshot);
  const lineage = asRecord(snapshot.lineage);
  assert.equal(readString(lineage.sourceType), 'strategy_lab');
  assert.equal(readString(lineage.projectId), runKey);
  assert.equal(readString(lineage.sourceTemplateId), `tpl-${runKey}`);

  try {
    const chartResponse = await requestJson(
      `/backtests/${encodeURIComponent(backtestId)}/chart?symbol=BTCUSDT&interval=1h&limit=250&endTime=${encodeURIComponent(
        endIso
      )}`,
      {},
      accessToken
    );
    const chart = asRecord(chartResponse.data);
    const candles = asArray(chart.candles);
    const coverage = asRecord(chart.tradeCoverage);
    assert.equal(readString(chart.symbol), 'BTCUSDT');
    assert.equal(readString(chart.interval), '1h');
    assert.ok(candles.length > 0, 'chart should return candles for the completed smoke run');
    assert.equal(readNumber(coverage.storedTradeEvents), tradeEvents.length);
    console.log('backtest-chart:', JSON.stringify(chartResponse));
  } catch (error) {
    if (REQUIRE_CHART) {
      throw error;
    }
    console.log(
      `backtest-chart: skipped non-fatal check (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const firstPromotionResponse = await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}/automation`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        status: 'Draft',
      }),
    },
    accessToken
  );
  const firstPromotion = asRecord(firstPromotionResponse.data);
  const firstAutomation = asRecord(firstPromotion.automation);
  const firstAutomationId = readString(firstAutomation.id);
  assert.ok(firstAutomationId, 'promotion should return an automation id');
  assert.match(readString(firstPromotion.message), /created/i);

  const secondPromotionResponse = await requestJson(
    `/backtests/${encodeURIComponent(backtestId)}/automation`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        status: 'Draft',
      }),
    },
    accessToken
  );
  const secondPromotion = asRecord(secondPromotionResponse.data);
  const secondAutomation = asRecord(secondPromotion.automation);
  assert.equal(readString(secondAutomation.id), firstAutomationId);
  assert.match(readString(secondPromotion.message), /already exists/i);

  console.log(
    'backtests-lifecycle-smoke:',
    JSON.stringify({
      backtestId,
      topSetupId: readString(selectedTopSetup.id),
      automationId: firstAutomationId,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
