import assert from 'node:assert/strict';
import { env } from '../../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const AURALPHA_BASE_URL =
  process.env.SMOKE_BASE_URL || `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const DISCOVERY_BASE_URL = String(
  process.env.DISCOVERY_SMOKE_BASE_URL || env.discovery.apiBaseUrl || 'http://localhost:8000/api/v1/discovery'
)
  .trim()
  .replace(/\/+$/, '');
const LOGIN_EMAIL =
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || 'admin@auralpha.com';
const LOGIN_PASSWORD =
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || 'Admin@123';
const REPLAY_IMPORTED_SUGGESTION =
  String(process.env.DISCOVERY_CONTRACT_SMOKE_REPLAY_IMPORTED_SUGGESTION || 'true')
    .trim()
    .toLowerCase() !== 'false';
const RUN_BOT_LIFECYCLE =
  String(process.env.DISCOVERY_CONTRACT_SMOKE_RUN_BOT_LIFECYCLE || '')
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
    throw new Error(`Expected finite number, received ${String(value)}`);
  }
  return numeric;
}

async function requestJson(
  baseUrl: string,
  pathName: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<{ payload: JsonRecord; status: number }> {
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${baseUrl}${pathName}`, {
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
      `${init.method || 'GET'} ${baseUrl}${pathName} -> HTTP ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return {
    payload,
    status: response.status,
  };
}

async function login(): Promise<string> {
  const response = await requestJson(
    AURALPHA_BASE_URL,
    '/auth/login',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
      }),
    }
  );
  const data = asRecord(response.payload.data);
  const accessToken = readString(data.accessToken);
  assert.ok(accessToken, 'login should return an access token');
  return accessToken;
}

function createTemporaryBotBody(): JsonRecord {
  const suffix = Date.now();
  return {
    name: `Discovery Contract Smoke ${suffix}`,
    description: 'Temporary bot created by smoke-discovery-contract.ts',
    mode: 'on_demand',
    ai_approach: 'algorithmic',
    data_source: 'ccxt',
    assets: ['BTC/USDT'],
    timeframes: ['1h'],
    strategy_types: ['technical'],
    exchange: 'binance',
    min_score_threshold: 0.65,
  };
}

async function run(): Promise<void> {
  const accessToken = await login();

  const dependencyHealth = await requestJson(
    AURALPHA_BASE_URL,
    '/health/discovery',
    {},
    accessToken
  );
  const dependencyData = asRecord(dependencyHealth.payload.data);
  assert.equal(readString(dependencyData.status), 'ok');

  const summaryResponse = await requestJson(
    AURALPHA_BASE_URL,
    '/discovery/summary',
    {},
    accessToken
  );
  const summary = asRecord(summaryResponse.payload.data);
  assert.ok(readString(summary.checkedAt), 'discovery summary should expose checkedAt');
  assert.ok(
    readNumber(asRecord(summary.bots).total) >= 0,
    'discovery summary should expose bot totals'
  );
  assert.ok(
    readNumber(asRecord(summary.strategies).total) >= 0,
    'discovery summary should expose strategy totals'
  );
  assert.ok(
    readNumber(asRecord(summary.suggestions).total) >= 0,
    'discovery summary should expose suggestion totals'
  );
  assert.ok(
    readNumber(asRecord(summary.runs).total) >= 0,
    'discovery summary should expose run totals'
  );

  const feedResponse = await requestJson(
    AURALPHA_BASE_URL,
    '/discovery/feed?limit=5',
    {},
    accessToken
  );
  const feed = asRecord(feedResponse.payload.data);
  assert.ok(readString(feed.checkedAt), 'discovery feed should expose checkedAt');
  assert.ok(Array.isArray(feed.items), 'discovery feed should expose items');

  const preferencesResponse = await requestJson(DISCOVERY_BASE_URL, '/preferences', {}, accessToken);
  assert.ok(
    Array.isArray(asRecord(preferencesResponse.payload).preferred_timeframes),
    'discovery preferences should expose preferred_timeframes'
  );
  assert.ok(
    typeof asRecord(preferencesResponse.payload).auto_backtest_approved === 'boolean',
    'discovery preferences should expose auto_backtest_approved'
  );

  const botsResponse = await requestJson(
    DISCOVERY_BASE_URL,
    '/bots?limit=5&offset=0',
    {},
    accessToken
  );
  const botsPayload = asRecord(botsResponse.payload);
  const bots = asArray(botsPayload.items);
  assert.ok(readNumber(botsPayload.total) >= bots.length, 'discovery bots total should be finite');

  const createdBotResponse = await requestJson(
    DISCOVERY_BASE_URL,
    '/bots',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(createTemporaryBotBody()),
    },
    accessToken
  );
  const createdBot = asRecord(createdBotResponse.payload);
  const createdBotId = readString(createdBot.id);
  assert.ok(createdBotId, 'created discovery bot should return an id');

  let startedTemporaryBot = false;

  try {
    const createdBotDetailResponse = await requestJson(
      DISCOVERY_BASE_URL,
      `/bots/${encodeURIComponent(createdBotId)}`,
      {},
      accessToken
    );
    const createdBotDetail = asRecord(createdBotDetailResponse.payload);
    assert.equal(readString(createdBotDetail.id), createdBotId);
    assert.ok(readString(createdBotDetail.name), 'discovery bot detail should expose a name');
    assert.ok(readString(createdBotDetail.status), 'discovery bot detail should expose a status');

    const updatedBotResponse = await requestJson(
      DISCOVERY_BASE_URL,
      `/bots/${encodeURIComponent(createdBotId)}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          description: 'Updated by smoke-discovery-contract.ts',
          min_score_threshold: 0.7,
        }),
      },
      accessToken
    );
    const updatedBot = asRecord(updatedBotResponse.payload);
    assert.equal(readString(updatedBot.id), createdBotId);
    assert.equal(readString(updatedBot.description), 'Updated by smoke-discovery-contract.ts');

    if (RUN_BOT_LIFECYCLE) {
      const startedBotResponse = await requestJson(
        DISCOVERY_BASE_URL,
        `/bots/${encodeURIComponent(createdBotId)}/start`,
        {
          method: 'POST',
        },
        accessToken
      );
      const startedBot = asRecord(startedBotResponse.payload);
      assert.equal(readString(startedBot.status), 'running');
      startedTemporaryBot = true;

      const stoppedBotResponse = await requestJson(
        DISCOVERY_BASE_URL,
        `/bots/${encodeURIComponent(createdBotId)}/stop`,
        {
          method: 'POST',
        },
        accessToken
      );
      const stoppedBot = asRecord(stoppedBotResponse.payload);
      assert.equal(readString(stoppedBot.status), 'stopped');
      startedTemporaryBot = false;
    }
  } finally {
    if (createdBotId) {
      if (startedTemporaryBot) {
        try {
          await requestJson(
            DISCOVERY_BASE_URL,
            `/bots/${encodeURIComponent(createdBotId)}/stop`,
            {
              method: 'POST',
            },
            accessToken
          );
        } catch {
          // Best-effort cleanup before delete.
        }
      }

      await requestJson(
        DISCOVERY_BASE_URL,
        `/bots/${encodeURIComponent(createdBotId)}`,
        {
          method: 'DELETE',
        },
        accessToken
      );
    }
  }

  const strategiesResponse = await requestJson(
    DISCOVERY_BASE_URL,
    '/strategies?limit=5&offset=0',
    {},
    accessToken
  );
  const strategiesPayload = asRecord(strategiesResponse.payload);
  const strategies = asArray(strategiesPayload.items);
  assert.ok(
    readNumber(strategiesPayload.total) >= strategies.length,
    'discovery strategies total should be finite'
  );

  if (strategies.length > 0) {
    const sampledStrategyId = readString(strategies[0].id);
    const strategyDetailResponse = await requestJson(
      DISCOVERY_BASE_URL,
      `/strategies/${encodeURIComponent(sampledStrategyId)}`,
      {},
      accessToken
    );
    const strategyDetail = asRecord(strategyDetailResponse.payload);
    assert.equal(readString(strategyDetail.id), sampledStrategyId);
    assert.ok(readString(strategyDetail.name), 'discovery strategy detail should expose a name');
    assert.ok(
      readString(strategyDetail.status),
      'discovery strategy detail should expose a status'
    );
  }

  const runsResponse = await requestJson(DISCOVERY_BASE_URL, '/runs?limit=5&offset=0', {}, accessToken);
  const runsPayload = asRecord(runsResponse.payload);
  const runs = asArray(runsPayload.items);
  assert.ok(readNumber(runsPayload.total) >= runs.length, 'discovery runs total should be finite');

  if (runs.length > 0) {
    const sampledRunId = readString(runs[0].id);
    const runDetailResponse = await requestJson(
      DISCOVERY_BASE_URL,
      `/runs/${encodeURIComponent(sampledRunId)}`,
      {},
      accessToken
    );
    const runDetail = asRecord(runDetailResponse.payload);
    assert.equal(readString(runDetail.id), sampledRunId);
    assert.ok(readString(runDetail.status), 'discovery run detail should expose a status');
  }

  const suggestionsResponse = await requestJson(
    DISCOVERY_BASE_URL,
    '/template-suggestions?limit=5&offset=0',
    {},
    accessToken
  );
  const suggestionsPayload = asRecord(suggestionsResponse.payload);
  const suggestions = asArray(suggestionsPayload.items);
  assert.ok(
    readNumber(suggestionsPayload.total) >= suggestions.length,
    'discovery suggestions total should be finite'
  );

  let replayedImportedSuggestionId = '';
  if (REPLAY_IMPORTED_SUGGESTION) {
    const importedSuggestion = suggestions.find(
      (item) => readString(item.status).toLowerCase() === 'imported'
    );
    if (importedSuggestion) {
      replayedImportedSuggestionId = readString(importedSuggestion.id);
      const importReplayResponse = await requestJson(
        DISCOVERY_BASE_URL,
        `/template-suggestions/${encodeURIComponent(replayedImportedSuggestionId)}/import`,
        {
          method: 'POST',
        },
        accessToken
      );
      const replayedSuggestion = asRecord(importReplayResponse.payload);
      assert.equal(readString(replayedSuggestion.id), replayedImportedSuggestionId);
      assert.equal(readString(replayedSuggestion.status).toLowerCase(), 'imported');
      assert.ok(
        readString(replayedSuggestion.imported_template_id),
        'replayed imported suggestion should retain imported_template_id'
      );
    }
  }

  console.log(
    'discovery-contract-smoke:',
    JSON.stringify({
      aurAlphaBaseUrl: AURALPHA_BASE_URL,
      discoveryBaseUrl: DISCOVERY_BASE_URL,
      checkedAt: readString(summary.checkedAt),
      totals: {
        bots: readNumber(asRecord(summary.bots).total),
        strategies: readNumber(asRecord(summary.strategies).total),
        suggestions: readNumber(asRecord(summary.suggestions).total),
        runs: readNumber(asRecord(summary.runs).total),
      },
      createdTemporaryBotId: createdBotId,
      runBotLifecycle: RUN_BOT_LIFECYCLE,
      replayedImportedSuggestionId: replayedImportedSuggestionId || undefined,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
