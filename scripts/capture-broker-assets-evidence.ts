import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.BROKER_ASSETS_EVIDENCE_BASE_URL ||
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const ACCESS_TOKEN = String(
  process.env.BROKER_ASSETS_EVIDENCE_ACCESS_TOKEN ||
    process.env.BROKER_ASSETS_HEALTH_ACCESS_TOKEN ||
    process.env.SMOKE_ACCESS_TOKEN ||
    ''
).trim();
const LOGIN_EMAIL = String(
  process.env.BROKER_ASSETS_EVIDENCE_EMAIL ||
    process.env.BROKER_ASSETS_HEALTH_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.BROKER_ASSETS_EVIDENCE_PASSWORD ||
    process.env.BROKER_ASSETS_HEALTH_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const WORKFLOW_OUTPUT_FILE = String(
  process.env.BROKER_ASSETS_WORKFLOW_EVIDENCE_FILE ||
    'artifacts/broker-assets-workflow-evidence.json'
).trim();
const DASHBOARD_OUTPUT_FILE = String(
  process.env.BROKER_ASSETS_DASHBOARD_EVIDENCE_FILE ||
    'artifacts/broker-assets-dashboard-evidence.json'
).trim();
const ADMIN_LIMIT = Math.max(
  1,
  Number(process.env.BROKER_ASSETS_EVIDENCE_ADMIN_LIMIT || 25)
);
const VISIBLE_LIMIT = Math.max(
  1,
  Number(process.env.BROKER_ASSETS_EVIDENCE_VISIBLE_LIMIT || 25)
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
    'BROKER_ASSETS_EVIDENCE_ACCESS_TOKEN/SMOKE_ACCESS_TOKEN or login credentials are required for broker-assets evidence capture'
  );

  const configPayload = await requestJson('/scheduler/exchange-assets/config', {}, accessToken);
  const configData = asRecord(configPayload.data);
  const schedulerSources = readStringArray(configData.sources);

  const workflowPayload = await requestJson(
    `/scheduler/exchange-assets/assets?limit=${ADMIN_LIMIT}&offset=0`,
    {},
    accessToken
  );
  const workflowItems = readArray(asRecord(workflowPayload.data).items).map((item) => asRecord(item));

  const dashboardPayload = await requestJson(
    `/exchange-assets?limit=${VISIBLE_LIMIT}&offset=0`,
    {},
    accessToken
  );
  const dashboardItems = readArray(asRecord(dashboardPayload.data).assets).map((item) => asRecord(item));

  const sourcePayloads = await Promise.all(
    schedulerSources.map(async (source) => {
      const payload = await requestJson(
        `/exchange-assets?source=${encodeURIComponent(source)}&limit=${VISIBLE_LIMIT}&offset=0`,
        {},
        accessToken
      );
      const data = asRecord(payload.data);
      const items = readArray(data.assets).map((item) => asRecord(item));
      return [
        source,
        {
          source,
          total: Number(data.total || 0),
          count: items.length,
          firstSymbol: readString(items[0]?.symbol) || null,
          firstName: readString(items[0]?.name) || null,
          items,
        },
      ] as const;
    })
  );

  const workflowSummary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    evidenceType: 'broker-assets-workflow',
    endpoints: {
      config: '/scheduler/exchange-assets/config',
      adminCatalog: `/scheduler/exchange-assets/assets?limit=${ADMIN_LIMIT}&offset=0`,
    },
    scheduler: {
      key: readString(configData.key) || null,
      schedulerType: readString(configData.schedulerType) || null,
      enabled: configData.enabled === true,
      timezone: readString(configData.timezone) || null,
      sources: schedulerSources,
    },
    adminCatalog: {
      total: Number(asRecord(workflowPayload.data).total || 0),
      count: workflowItems.length,
      firstSymbol: readString(workflowItems[0]?.symbol) || null,
      firstName: readString(workflowItems[0]?.name) || null,
      items: workflowItems,
    },
  };

  const dashboardSummary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    evidenceType: 'broker-assets-dashboard',
    endpoints: {
      visibleAssets: `/exchange-assets?limit=${VISIBLE_LIMIT}&offset=0`,
      visibleAssetsBySource: Object.fromEntries(
        schedulerSources.map((source) => [
          source,
          `/exchange-assets?source=${encodeURIComponent(source)}&limit=${VISIBLE_LIMIT}&offset=0`,
        ])
      ),
    },
    visibleCatalog: {
      total: Number(asRecord(dashboardPayload.data).total || 0),
      count: dashboardItems.length,
      firstSource: readString(dashboardItems[0]?.source) || null,
      firstSymbol: readString(dashboardItems[0]?.symbol) || null,
      items: dashboardItems,
    },
    visibleCatalogBySource: Object.fromEntries(sourcePayloads),
  };

  await persistSummary(WORKFLOW_OUTPUT_FILE, workflowSummary);
  await persistSummary(DASHBOARD_OUTPUT_FILE, dashboardSummary);

  console.log(
    'broker-assets-evidence-captured:',
    JSON.stringify({
      workflowFile: path.resolve(process.cwd(), WORKFLOW_OUTPUT_FILE),
      dashboardFile: path.resolve(process.cwd(), DASHBOARD_OUTPUT_FILE),
      schedulerSources,
      adminCatalogTotal: workflowSummary.adminCatalog.total,
      visibleTotal: dashboardSummary.visibleCatalog.total,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
