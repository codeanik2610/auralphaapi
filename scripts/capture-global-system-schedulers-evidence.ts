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
  process.env.GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_BASE_URL ||
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || env.app.apiKey || '').trim();
const ACCESS_TOKEN = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_ACCESS_TOKEN ||
    process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_ACCESS_TOKEN ||
    process.env.SMOKE_ACCESS_TOKEN ||
    ''
).trim();
const LOGIN_EMAIL = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_EMAIL ||
    process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_PASSWORD ||
    process.env.GLOBAL_SYSTEM_SCHEDULERS_HEALTH_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const WORKFLOW_OUTPUT_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_WORKFLOW_EVIDENCE_FILE ||
    'artifacts/global-system-schedulers-workflow-evidence.json'
).trim();
const DASHBOARD_OUTPUT_FILE = String(
  process.env.GLOBAL_SYSTEM_SCHEDULERS_DASHBOARD_EVIDENCE_FILE ||
    'artifacts/global-system-schedulers-dashboard-evidence.json'
).trim();
const RUN_LIMIT = Math.max(
  1,
  Number(process.env.GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_RUN_LIMIT || 5)
);
const UPDATE_LIMIT = Math.max(
  1,
  Number(process.env.GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_UPDATE_LIMIT || 5)
);
const SYNC_STATE_LIMIT = Math.max(
  1,
  Number(process.env.GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_SYNC_STATE_LIMIT || 5)
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

async function captureSchedulerEvidence(
  target: GlobalSchedulerTarget,
  accessToken: string
): Promise<JsonRecord> {
  const configPayload = await requestJson(`${target.routeBase}/config`, {}, accessToken);
  const runsPayload = await requestJson(
    `${target.routeBase}/runs?limit=${RUN_LIMIT}&offset=0`,
    {},
    accessToken
  );
  const configData = asRecord(configPayload.data);
  const runsData = asRecord(runsPayload.data);
  const runItems = readArray(runsData.items).map((item) => asRecord(item));
  const latestRun = asRecord(runItems[0]);
  const latestRunId = readString(latestRun.id);

  let progress: JsonRecord | null = null;
  let updates: JsonRecord | null = null;
  if (latestRunId) {
    progress = asRecord(
      (
        await requestJson(
          `${target.routeBase}/runs/${encodeURIComponent(latestRunId)}/progress`,
          {},
          accessToken
        )
      ).data
    );
    updates = asRecord(
      (
        await requestJson(
          `${target.routeBase}/runs/${encodeURIComponent(latestRunId)}/updates?limit=${UPDATE_LIMIT}&offset=0`,
          {},
          accessToken
        )
      ).data
    );
  }

  let syncState: JsonRecord | null = null;
  if (target.supportsSyncState) {
    syncState = asRecord(
      (
        await requestJson(
          `${target.routeBase}/sync-state?limit=${SYNC_STATE_LIMIT}&offset=0`,
          {},
          accessToken
        )
      ).data
    );
  }

  return {
    key: target.key,
    routeBase: target.routeBase,
    config: configData,
    runs: runsData,
    latestRun: latestRunId ? latestRun : null,
    progress,
    updates,
    syncState,
  };
}

async function run(): Promise<void> {
  const accessToken = ACCESS_TOKEN || (await loginIfPossible());
  assert.ok(
    accessToken,
    'GLOBAL_SYSTEM_SCHEDULERS_EVIDENCE_ACCESS_TOKEN/SMOKE_ACCESS_TOKEN or login credentials are required for global system scheduler evidence capture'
  );

  const overviewPayload = await requestJson('/scheduler/overview', {}, accessToken);
  const queuePayload = await requestJson('/health/queue');
  const workerPayload = await requestJson('/health/worker');

  const schedulerEvidence: JsonRecord[] = [];
  for (const target of GLOBAL_SCHEDULERS) {
    schedulerEvidence.push(await captureSchedulerEvidence(target, accessToken));
  }

  const workflowSummary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    evidenceType: 'global-system-schedulers-workflow',
    endpoints: {
      queue: '/health/queue',
      worker: '/health/worker',
      overview: '/scheduler/overview',
      schedulers: Object.fromEntries(
        GLOBAL_SCHEDULERS.map((target) => [
          target.key,
          {
            config: `${target.routeBase}/config`,
            runs: `${target.routeBase}/runs?limit=${RUN_LIMIT}&offset=0`,
            progress: `${target.routeBase}/runs/:runId/progress`,
            updates: `${target.routeBase}/runs/:runId/updates?limit=${UPDATE_LIMIT}&offset=0`,
            ...(target.supportsSyncState
              ? {
                  syncState: `${target.routeBase}/sync-state?limit=${SYNC_STATE_LIMIT}&offset=0`,
                }
              : {}),
          },
        ])
      ),
    },
    queueHealth: asRecord(queuePayload.data),
    workerHealth: asRecord(workerPayload.data),
    overview: asRecord(overviewPayload.data),
    schedulers: Object.fromEntries(
      schedulerEvidence.map((item) => [
        readString(item.key),
        {
          key: readString(item.key),
          routeBase: readString(item.routeBase),
          config: asRecord(item.config),
          latestRun: item.latestRun,
          progress: item.progress,
          syncState: item.syncState,
        },
      ])
    ),
  };

  const dashboardSummary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    evidenceType: 'global-system-schedulers-dashboard',
    overview: asRecord(overviewPayload.data),
    schedulers: Object.fromEntries(
      schedulerEvidence.map((item) => [
        readString(item.key),
        {
          key: readString(item.key),
          routeBase: readString(item.routeBase),
          config: asRecord(item.config),
          runs: asRecord(item.runs),
          latestRun: item.latestRun,
          progress: item.progress,
          updates: item.updates,
          syncState: item.syncState,
        },
      ])
    ),
  };

  await persistSummary(WORKFLOW_OUTPUT_FILE, workflowSummary);
  await persistSummary(DASHBOARD_OUTPUT_FILE, dashboardSummary);

  console.log(
    'global-system-schedulers-evidence-captured:',
    JSON.stringify({
      workflowFile: path.resolve(process.cwd(), WORKFLOW_OUTPUT_FILE),
      dashboardFile: path.resolve(process.cwd(), DASHBOARD_OUTPUT_FILE),
      schedulerKeys: GLOBAL_SCHEDULERS.map((target) => target.key),
      overviewCount: readArray(asRecord(overviewPayload.data).items).length,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
