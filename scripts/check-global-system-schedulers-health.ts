import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

type GlobalSchedulerTarget = {
  key: string;
  routeBase: string;
  supportsSyncState?: boolean;
};

type GlobalSchedulerHealthSummary = {
  key: string;
  routeBase: string;
  schedulerType: string | null;
  enabled: boolean;
  timezone: string | null;
  sources: string[];
  timeZoneDisplay: string | null;
  overviewStatus: string | null;
  overviewHasQueuedWork: boolean | null;
  overviewExecutionContext: string | null;
  overviewInitiatedByType: string | null;
  recentRunId: string | null;
  recentRunStatus: string | null;
  recentRunExecutionContext: string | null;
  recentRunInitiatedByType: string | null;
  latestRunId: string | null;
  latestRunStatus: string | null;
  latestRunExecutionContext: string | null;
  latestRunInitiatedByType: string | null;
  latestRunProgressPercent: number | null;
  updateCount: number | null;
  syncStateCount: number | null;
};

type GlobalSystemSchedulersHealthSnapshot = {
  baseUrl: string;
  queueStatus: string | null;
  queueName: string | null;
  queueLatencyMs: number | null;
  workerStatus: string | null;
  workerHttpStatus: string | null;
  workerHeartbeatAgeMs: number | null;
  overviewCount: number;
  overviewDisplayTimeZone: string | null;
  overviewLocalized: boolean;
  schedulerKeys: string[];
  schedulers: Record<string, GlobalSchedulerHealthSummary>;
};

const GLOBAL_SCHEDULERS: GlobalSchedulerTarget[] = [
  {
    key: 'broker-assets-sync',
    routeBase: '/scheduler/exchange-assets',
  },
  {
    key: 'exchange-assets-sync',
    routeBase: '/scheduler/binance-assets',
  },
  {
    key: 'binance-candles-3m-1m-sync',
    routeBase: '/scheduler/candles',
    supportsSyncState: true,
  },
  {
    key: 'system-health-sync',
    routeBase: '/scheduler/health',
  },
];

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || env.app.apiKey || '').trim();
const ACCESS_TOKEN = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_ACCESS_TOKEN ||
    process.env.SMOKE_ACCESS_TOKEN ||
    ''
).trim();
const LOGIN_EMAIL = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const OUTPUT_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_OUTPUT_FILE ||
    'artifacts/global-system-schedulers-health.json'
).trim();

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNullableString(value: unknown): string | null {
  const normalized = readString(value);
  return normalized || null;
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return readArray(value).map((item) => readString(item)).filter(Boolean);
}

async function requestJson(
  targetPath: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});
  if (API_KEY) {
    headers.set('x-api-key', API_KEY);
  }
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }
  const method = String(init.method || 'GET').toUpperCase();
  const body =
    typeof init.body === 'string'
      ? init.body
      : init.body === undefined || init.body === null
        ? ''
        : String(init.body);
  if (body && !headers.has('content-length')) {
    headers.set('content-length', Buffer.byteLength(body, 'utf8').toString());
  }

  const url = new URL(`${BASE_URL}${targetPath}`);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<JsonRecord>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method,
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          let payload: JsonRecord = {};

          try {
            payload = text ? (JSON.parse(text) as JsonRecord) : {};
          } catch {
            payload = { raw: text };
          }

          const statusCode = response.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`${targetPath} -> HTTP ${statusCode}: ${JSON.stringify(payload)}`));
            return;
          }

          resolve(payload);
        });
      }
    );

    request.on('error', (error) => {
      reject(
        new Error(
          `${targetPath} -> fetch failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function login(email: string, password: string): Promise<string> {
  assert.ok(
    email && password,
    'global system scheduler health checks require admin credentials or an access token'
  );

  const response = await requestJson('/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });
  const accessToken = readString(asRecord(response.data).accessToken);
  assert.ok(accessToken, `login should return an access token for ${email}`);
  return accessToken;
}

async function resolveAccessToken(): Promise<string> {
  if (ACCESS_TOKEN) {
    return ACCESS_TOKEN;
  }

  return login(LOGIN_EMAIL, LOGIN_PASSWORD);
}

function assertTimeContract(label: string, value: unknown): JsonRecord {
  const contract = asRecord(value);
  assert.equal(
    readString(contract.storageTimeZone),
    'UTC',
    `${label} must advertise UTC storage time`
  );
  assert.equal(
    readString(contract.rawTimeFields),
    'iso-utc',
    `${label} must advertise raw UTC ISO companion fields`
  );
  assert.equal(
    readBoolean(contract.displayTimesLocalized),
    true,
    `${label} must advertise localized display timestamps`
  );
  assert.ok(
    readString(contract.displayTimeZone),
    `${label} must advertise the display time zone`
  );
  return contract;
}

function assertSystemExecutionContext(label: string, value: unknown): void {
  const normalized = readString(value);
  if (!normalized) {
    return;
  }

  assert.equal(
    normalized,
    'system',
    `${label} must stay in system execution context for global schedulers`
  );
}

function assertSchedulerInitiator(label: string, value: unknown): string | null {
  const initiator = asRecord(value);
  const type = readNullableString(initiator.type);
  if (!type) {
    return null;
  }

  assert.ok(
    ['manual', 'cron', 'system'].includes(type),
    `${label} must expose a supported initiator type`
  );
  return type;
}

async function persistSummary(summary: GlobalSystemSchedulersHealthSnapshot): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function run(): Promise<void> {
  const accessToken = await resolveAccessToken();
  const queueResponse = await requestJson('/health/queue');
  const workerResponse = await requestJson('/health/worker');
  const overviewResponse = await requestJson('/scheduler/overview', {}, accessToken);

  const queue = asRecord(queueResponse.data);
  const worker = asRecord(workerResponse.data);
  const overview = asRecord(overviewResponse.data);
  const overviewTime = assertTimeContract('scheduler overview', overview.time);
  const overviewItems = readArray(overview.items).map((item) => asRecord(item));
  const overviewEntries: Array<[string, JsonRecord]> = overviewItems
    .map((item) => [readString(item.key), item] as [string, JsonRecord])
    .filter(([key]) => Boolean(key));
  const overviewByKey = new Map<string, JsonRecord>(overviewEntries);

  assert.equal(
    readString(queue.status),
    'ok',
    'global system scheduler health requires queue health to be ok'
  );
  assert.equal(
    readString(worker.status),
    'ok',
    'global system scheduler health requires worker health to be ok'
  );

  const schedulerSummaries: Record<string, GlobalSchedulerHealthSummary> = {};

  for (const target of GLOBAL_SCHEDULERS) {
    const overviewItem = overviewByKey.get(target.key);
    assert.ok(overviewItem, `scheduler overview must include ${target.key}`);
    const overviewRow = overviewItem as JsonRecord;

    const configResponse = await requestJson(`${target.routeBase}/config`, {}, accessToken);
    const config = asRecord(configResponse.data);
    const configTime = assertTimeContract(`${target.key} config`, config.time);
    assert.equal(readString(config.key), target.key, `${target.key} config must keep its key`);
    assert.equal(
      readString(config.schedulerType),
      'global',
      `${target.key} config must stay global`
    );

    const runsResponse = await requestJson(
      `${target.routeBase}/runs?limit=1&offset=0`,
      {},
      accessToken
    );
    const runs = asRecord(runsResponse.data);
    assertTimeContract(`${target.key} runs`, runs.time);
    const latestRun = asRecord(readArray(runs.items)[0]);
    const latestRunId = readNullableString(latestRun.id);

    const recentRun = asRecord(overviewRow.recentRun);
    const recentRunId = readNullableString(recentRun.id);
    const recentRunInitiatedByType = assertSchedulerInitiator(
      `${target.key} overview recentRun initiator`,
      recentRun.initiatedBy
    );
    const overviewInitiatedByType = assertSchedulerInitiator(
      `${target.key} overview initiator`,
      overviewRow.initiatedBy
    );
    const latestRunInitiatedByType = assertSchedulerInitiator(
      `${target.key} run initiator`,
      latestRun.initiatedBy
    );

    assertSystemExecutionContext(
      `${target.key} overview execution context`,
      overviewRow.executionContext
    );
    assertSystemExecutionContext(
      `${target.key} overview recentRun execution context`,
      recentRun.executionContext
    );
    assertSystemExecutionContext(
      `${target.key} latest run execution context`,
      latestRun.executionContext
    );

    let latestRunProgressPercent: number | null = null;
    let updateCount: number | null = null;
    if (latestRunId) {
      const progressResponse = await requestJson(
        `${target.routeBase}/runs/${encodeURIComponent(latestRunId)}/progress`,
        {},
        accessToken
      );
      const progress = asRecord(progressResponse.data);
      assertTimeContract(`${target.key} progress`, progress.time);
      const progressRun = asRecord(progress.run);
      if (Object.keys(progressRun).length > 0) {
        assert.equal(
          readString(progressRun.schedulerKey),
          target.key,
          `${target.key} progress must return the matching run`
        );
        assertSystemExecutionContext(
          `${target.key} progress run execution context`,
          progressRun.executionContext
        );
        latestRunProgressPercent = readNullableNumber(asRecord(progressRun.progress).percent);
      } else {
        latestRunProgressPercent = readNullableNumber(asRecord(latestRun.progress).percent);
      }

      const updatesResponse = await requestJson(
        `${target.routeBase}/runs/${encodeURIComponent(latestRunId)}/updates?limit=5&offset=0`,
        {},
        accessToken
      );
      const updates = asRecord(updatesResponse.data);
      assertTimeContract(`${target.key} updates`, updates.time);
      updateCount = readNullableNumber(updates.total);
      for (const item of readArray(updates.items)) {
        const update = asRecord(item);
        assertSystemExecutionContext(
          `${target.key} update execution context`,
          update.executionContext
        );
        assertSchedulerInitiator(`${target.key} update initiator`, update.initiatedBy);
      }
    }

    let syncStateCount: number | null = null;
    if (target.supportsSyncState) {
      const syncStateResponse = await requestJson(
        `${target.routeBase}/sync-state?limit=1&offset=0`,
        {},
        accessToken
      );
      const syncState = asRecord(syncStateResponse.data);
      syncStateCount = readNullableNumber(syncState.total);
      assert.ok(
        Array.isArray(syncState.items),
        `${target.key} sync-state must return an items array`
      );
    }

    schedulerSummaries[target.key] = {
      key: target.key,
      routeBase: target.routeBase,
      schedulerType: readNullableString(config.schedulerType),
      enabled: readBoolean(config.enabled),
      timezone: readNullableString(config.timezone),
      sources: readStringArray(config.sources),
      timeZoneDisplay: readNullableString(configTime.displayTimeZone),
      overviewStatus: readNullableString(overviewRow.status),
      overviewHasQueuedWork:
        overviewRow.hasQueuedWork === undefined ? null : readBoolean(overviewRow.hasQueuedWork),
      overviewExecutionContext: readNullableString(overviewRow.executionContext),
      overviewInitiatedByType,
      recentRunId,
      recentRunStatus: readNullableString(recentRun.status),
      recentRunExecutionContext: readNullableString(recentRun.executionContext),
      recentRunInitiatedByType,
      latestRunId,
      latestRunStatus: readNullableString(latestRun.status),
      latestRunExecutionContext: readNullableString(latestRun.executionContext),
      latestRunInitiatedByType,
      latestRunProgressPercent,
      updateCount,
      syncStateCount,
    };
  }

  const summary: GlobalSystemSchedulersHealthSnapshot = {
    baseUrl: BASE_URL,
    queueStatus: readNullableString(queue.status),
    queueName: readNullableString(queue.queue),
    queueLatencyMs: readNullableNumber(queue.latencyMs),
    workerStatus: readNullableString(worker.status),
    workerHttpStatus: readNullableString(worker.workerHttpStatus),
    workerHeartbeatAgeMs: readNullableNumber(worker.heartbeatAgeMs),
    overviewCount: overviewItems.length,
    overviewDisplayTimeZone: readNullableString(overviewTime.displayTimeZone),
    overviewLocalized: readBoolean(overviewTime.displayTimesLocalized),
    schedulerKeys: GLOBAL_SCHEDULERS.map((target) => target.key),
    schedulers: schedulerSummaries,
  };

  await persistSummary(summary);
  console.log('global-system-schedulers-health:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
