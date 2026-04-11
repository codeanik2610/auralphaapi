import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.ASSET_PRICE_SYNC_EVIDENCE_BASE_URL ||
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || env.app.apiKey || '').trim();
const ACCESS_TOKEN = String(
  process.env.ASSET_PRICE_SYNC_EVIDENCE_ACCESS_TOKEN ||
    process.env.ASSET_PRICE_SYNC_HEALTH_ACCESS_TOKEN ||
    process.env.SMOKE_ACCESS_TOKEN ||
    ''
).trim();
const LOGIN_EMAIL = String(
  process.env.ASSET_PRICE_SYNC_EVIDENCE_EMAIL ||
    process.env.ASSET_PRICE_SYNC_HEALTH_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.ASSET_PRICE_SYNC_EVIDENCE_PASSWORD ||
    process.env.ASSET_PRICE_SYNC_HEALTH_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const WORKFLOW_OUTPUT_FILE = String(
  process.env.ASSET_PRICE_SYNC_WORKFLOW_EVIDENCE_FILE ||
    'artifacts/asset-price-sync-workflow-evidence.json'
).trim();
const DASHBOARD_OUTPUT_FILE = String(
  process.env.ASSET_PRICE_SYNC_DASHBOARD_EVIDENCE_FILE ||
    'artifacts/asset-price-sync-dashboard-evidence.json'
).trim();
const ASSET_LIMIT = Math.max(
  1,
  Number(process.env.ASSET_PRICE_SYNC_EVIDENCE_ASSET_LIMIT || 25)
);
const RUN_LIMIT = Math.max(
  1,
  Number(process.env.ASSET_PRICE_SYNC_EVIDENCE_RUN_LIMIT || 10)
);
const UPDATE_LIMIT = Math.max(
  1,
  Number(process.env.ASSET_PRICE_SYNC_EVIDENCE_UPDATE_LIMIT || 20)
);

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(value: unknown): string {
  return String(value || '').trim();
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

  const response = await fetch(`${BASE_URL}${targetPath}`, {
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
    throw new Error(`${targetPath} -> HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function loginIfPossible(): Promise<string> {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    return '';
  }

  try {
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
    return readString(asRecord(response.data).accessToken);
  } catch {
    return '';
  }
}

async function persistSummary(filePath: string, summary: Record<string, unknown>): Promise<void> {
  if (!filePath) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function run(): Promise<void> {
  const accessToken = ACCESS_TOKEN || (await loginIfPossible());
  assert.ok(
    accessToken,
    'ASSET_PRICE_SYNC_EVIDENCE_ACCESS_TOKEN/SMOKE_ACCESS_TOKEN or login credentials are required for asset-price-sync evidence capture'
  );

  const [queuePayload, workerPayload, overviewPayload, configPayload] = await Promise.all([
    requestJson('/health/queue'),
    requestJson('/health/worker'),
    requestJson('/scheduler/overview', {}, accessToken),
    requestJson('/scheduler/asset-price/config', {}, accessToken),
  ]);

  const assetsPayload = await requestJson(
    `/scheduler/asset-price/assets?limit=${ASSET_LIMIT}&offset=0`,
    {},
    accessToken
  );
  const runsPayload = await requestJson(
    `/scheduler/asset-price/runs?limit=${RUN_LIMIT}&offset=0`,
    {},
    accessToken
  );

  const configData = asRecord(configPayload.data);
  const overviewData = asRecord(overviewPayload.data);
  const assetsData = asRecord(assetsPayload.data);
  const runsData = asRecord(runsPayload.data);
  const assetItems = readArray(assetsData.items).map((item) => asRecord(item));
  const runItems = readArray(runsData.items).map((item) => asRecord(item));
  const latestRun = asRecord(runItems[0]);
  const latestRunId = readString(latestRun.id);

  let progress: JsonRecord | null = null;
  let updates: JsonRecord | null = null;
  if (latestRunId) {
    progress = asRecord(
      (
        await requestJson(
          `/scheduler/asset-price/runs/${encodeURIComponent(latestRunId)}/progress`,
          {},
          accessToken
        )
      ).data
    );
    updates = asRecord(
      (
        await requestJson(
          `/scheduler/asset-price/runs/${encodeURIComponent(latestRunId)}/updates?limit=${UPDATE_LIMIT}&offset=0`,
          {},
          accessToken
        )
      ).data
    );
  }

  const workflowSummary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    evidenceType: 'asset-price-sync-workflow',
    endpoints: {
      config: '/scheduler/asset-price/config',
      assets: `/scheduler/asset-price/assets?limit=${ASSET_LIMIT}&offset=0`,
      runs: `/scheduler/asset-price/runs?limit=${RUN_LIMIT}&offset=0`,
      progress: latestRunId
        ? `/scheduler/asset-price/runs/${encodeURIComponent(latestRunId)}/progress`
        : null,
      updates: latestRunId
        ? `/scheduler/asset-price/runs/${encodeURIComponent(latestRunId)}/updates?limit=${UPDATE_LIMIT}&offset=0`
        : null,
    },
    scheduler: {
      key: readString(configData.key) || null,
      schedulerType: readString(configData.schedulerType) || null,
      enabled: configData.enabled === true,
      timezone: readString(configData.timezone) || null,
      sources: readStringArray(configData.sources),
      selectionMode: readString(configData.selectionMode) || null,
      selectedAssetIdsCount: readArray(configData.selectedAssetIds).length,
    },
    scopeAssets: {
      total: Number(assetsData.total || 0),
      count: assetItems.length,
      firstId: readString(assetItems[0]?.id) || null,
      firstSymbol: readString(assetItems[0]?.symbol) || null,
      firstSource: readString(assetItems[0]?.source) || null,
      items: assetItems,
    },
    runs: {
      total: Number(runsData.total || 0),
      count: runItems.length,
      latestRun: latestRunId ? latestRun : null,
      progress,
      updates,
    },
  };

  const dashboardSummary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    evidenceType: 'asset-price-sync-dashboard',
    endpoints: {
      queue: '/health/queue',
      worker: '/health/worker',
      overview: '/scheduler/overview',
      config: '/scheduler/asset-price/config',
      runs: `/scheduler/asset-price/runs?limit=${RUN_LIMIT}&offset=0`,
    },
    queueHealth: asRecord(queuePayload.data),
    workerHealth: asRecord(workerPayload.data),
    overview: overviewData,
    scheduler: {
      config: configData,
      latestRun: latestRunId ? latestRun : null,
      progress,
      updates,
    },
  };

  await persistSummary(WORKFLOW_OUTPUT_FILE, workflowSummary);
  await persistSummary(DASHBOARD_OUTPUT_FILE, dashboardSummary);

  console.log(
    'asset-price-sync-evidence-captured:',
    JSON.stringify({
      workflowFile: path.resolve(process.cwd(), WORKFLOW_OUTPUT_FILE),
      dashboardFile: path.resolve(process.cwd(), DASHBOARD_OUTPUT_FILE),
      schedulerSources: workflowSummary.scheduler.sources,
      assetTotal: workflowSummary.scopeAssets.total,
      runTotal: workflowSummary.runs.total,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
