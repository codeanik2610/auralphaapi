import assert from 'node:assert/strict';
import { env } from '../../src/env';

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
  const data = asRecord(response.data);
  const accessToken = readString(data.accessToken);
  assert.ok(accessToken, 'login should return an access token');
  return accessToken;
}

async function run(): Promise<void> {
  const accessToken = await login();
  const meResponse = await requestJson('/auth/me', {}, accessToken);
  const me = asRecord(meResponse.data);
  assert.equal(readString(me.email).toLowerCase(), LOGIN_EMAIL.toLowerCase());

  const now = Date.now();
  const runKey = `phase6-automation-smoke-${now}`;
  const generatedAt = new Date(now).toISOString();
  const startIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const endIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const createResponse = await requestJson(
    '/automations',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: `Phase 6 Smoke Runner ${now}`,
        automationType: 'backtest-runner',
        status: 'Running',
        timeZone: 'UTC',
        schedule: {
          type: 'interval',
          intervalMinutes: 60,
        },
        config: {
          source: 'manual',
          strategy: 'Phase 6 Smoke Runner',
          market: 'crypto-futures',
          backtestRunner: {
            source: 'manual',
            runBody: {
              universe: runKey,
              benchmark: 'BTCUSDT',
              interval: '1h',
              capital: '10000',
              fees: '0.1',
              slippage: '0.05',
              spread: '0.02',
              leverage: 1,
              dateRange: `${startIso}/${endIso}`,
            },
          },
        },
      }),
    },
    accessToken
  );
  const createdAutomation = asRecord(createResponse.data);
  const automationId = readString(createdAutomation.id);
  assert.ok(automationId, 'create automation should return an id');
  assert.equal(readString(createdAutomation.status), 'Running');
  assert.notEqual(readString(createdAutomation.nextRun), 'Paused');

  const summaryResponse = await requestJson('/automations/summary', {}, accessToken);
  const summary = asRecord(summaryResponse.data);
  assert.ok(readNumber(summary.running) >= 1, 'summary should report at least one running automation');

  const pauseResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}/pause`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Phase 6 smoke pause check',
      }),
    },
    accessToken
  );
  const paused = asRecord(pauseResponse.data);
  assert.match(readString(paused.message), /paused/i);
  assert.equal(readString(asRecord(paused.automation).status), 'Paused');

  const pauseAgainResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}/pause`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Phase 6 smoke duplicate pause check',
      }),
    },
    accessToken
  );
  assert.match(readString(asRecord(pauseAgainResponse.data).message), /already paused/i);

  const resumeResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}/resume`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Phase 6 smoke resume check',
      }),
    },
    accessToken
  );
  const resumed = asRecord(resumeResponse.data);
  assert.match(readString(resumed.message), /resumed/i);
  assert.equal(readString(asRecord(resumed.automation).status), 'Running');

  const resumeAgainResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}/resume`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Phase 6 smoke duplicate resume check',
      }),
    },
    accessToken
  );
  assert.match(readString(asRecord(resumeAgainResponse.data).message), /already running/i);

  const runNowResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}/run`,
    {
      method: 'POST',
    },
    accessToken
  );
  const runNow = asRecord(runNowResponse.data);
  const automationRunId = readString(runNow.runId);
  const backtestId = readString(runNow.backtestId);
  assert.equal(readString(runNow.status), 'started');
  assert.ok(automationRunId, 'run now should return a run id');
  assert.ok(backtestId, 'backtest-runner automation should return a child backtest id');

  const initialRunsResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}/runs?limit=10&offset=0`,
    {},
    accessToken
  );
  const initialRuns = asArray(asRecord(initialRunsResponse.data).items);
  const activeRun =
    initialRuns.find((item) => readString(item.id) === automationRunId) || initialRuns[0];
  assert.equal(readString(activeRun.id), automationRunId);
  assert.equal(readString(activeRun.status), 'Running');
  assert.equal(readString(activeRun.backtestId), backtestId);

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
        trades: 3,
        cagr: 4.8,
        sharpe: 1.18,
        drawdown: 1.9,
        winRate: 66,
        profitFactor: 1.42,
        config: {
          progress: {
            state: 'completed',
            processed: 1,
            total: 1,
            percent: 100,
            updatedAt: generatedAt,
            finishedAt: generatedAt,
            okCount: 1,
            failedCount: 0,
            tradeEventCount: 0,
            error: null,
          },
        },
      }),
    },
    accessToken
  );

  const syncedRunsResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}/runs?limit=10&offset=0`,
    {},
    accessToken
  );
  const syncedRuns = asArray(asRecord(syncedRunsResponse.data).items);
  const syncedRun = syncedRuns.find((item) => readString(item.id) === automationRunId);
  assert.ok(syncedRun, 'synced run should still be present in run history');
  assert.equal(readString(syncedRun?.status), 'Success');
  assert.equal(readString(syncedRun?.backtestStatus), 'Completed');

  const detailResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}`,
    {},
    accessToken
  );
  const detail = asRecord(detailResponse.data);
  const events = asArray(detail.events);
  assert.equal(readString(detail.id), automationId);
  assert.equal(
    events.some((item) => readString(item.type) === 'Run completed'),
    true,
    'automation detail should include the completed run event'
  );

  const reconcileResponse = await requestJson(
    `/automations/${encodeURIComponent(automationId)}/reconcile`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'Phase 6 smoke reconcile confirmation',
      }),
    },
    accessToken
  );
  assert.match(
    readString(asRecord(reconcileResponse.data).message),
    /reconciled|no stuck runs/i
  );

  console.log(
    'automations-lifecycle-smoke:',
    JSON.stringify({
      automationId,
      automationRunId,
      backtestId,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
