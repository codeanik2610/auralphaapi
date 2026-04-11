import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;
type ThresholdProfileMode = 'bounded' | 'partial' | 'unbounded';

export type AssetPriceSyncHealthThresholds = {
  maxConfigLatencyMs: number | null;
  maxAssetListLatencyMs: number | null;
  maxRunListLatencyMs: number | null;
  minAssetResults: number | null;
  minRunResults: number | null;
};

export type AssetPriceSyncHealthThresholdProfile = {
  mode: ThresholdProfileMode;
  configuredThresholdCount: number;
  requiredThresholdCount: number;
  configuredKeys: string[];
  missingKeys: string[];
};

export type AssetPriceSyncHealthSnapshot = {
  baseUrl: string;
  queueStatus: string | null;
  queueName: string | null;
  queueLatencyMs: number | null;
  workerStatus: string | null;
  workerHttpStatus: string | null;
  workerHeartbeatAgeMs: number | null;
  schedulerKey: string | null;
  schedulerType: string | null;
  schedulerEnabled: boolean;
  schedulerTimezone: string | null;
  schedulerSources: string[];
  selectionMode: string | null;
  selectedAssetIdsCount: number;
  configLatencyMs: number;
  assetsLatencyMs: number;
  runsLatencyMs: number;
  assetTotal: number;
  assetCount: number;
  assetFirstId: string | null;
  assetFirstSymbol: string | null;
  assetSourceSamples: string[];
  runTotal: number;
  runCount: number;
  latestRunId: string | null;
  latestRunStatus: string | null;
  latestRunExecutionContext: string | null;
  latestRunInitiatedByType: string | null;
  latestRunScopeAssetsCount: number | null;
  latestRunProgressPercent: number | null;
  latestUpdateCount: number | null;
  overviewCount: number;
  overviewDisplayTimeZone: string | null;
  overviewLocalized: boolean;
  overviewStatus: string | null;
  overviewExecutionContext: string | null;
  overviewInitiatedByType: string | null;
  overviewHasQueuedWork: boolean | null;
  configDisplayTimeZone: string | null;
  configLocalized: boolean;
  runsDisplayTimeZone: string | null;
  runsLocalized: boolean;
  progressDisplayTimeZone: string | null;
  progressLocalized: boolean | null;
  updatesDisplayTimeZone: string | null;
  updatesLocalized: boolean | null;
  thresholds: AssetPriceSyncHealthThresholds;
  thresholdProfile: AssetPriceSyncHealthThresholdProfile;
};

export type AssetPriceSyncHealthAssertionOptions = {
  requireAssetResults?: boolean;
  requireRunResults?: boolean;
  thresholds?: AssetPriceSyncHealthThresholds;
};

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || env.app.apiKey || '').trim();
const ACCESS_TOKEN = String(
  process.env.ASSET_PRICE_SYNC_HEALTH_ACCESS_TOKEN || process.env.SMOKE_ACCESS_TOKEN || ''
).trim();
const LOGIN_EMAIL = String(
  process.env.ASSET_PRICE_SYNC_HEALTH_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.ASSET_PRICE_SYNC_HEALTH_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const OUTPUT_FILE = String(
  process.env.ASSET_PRICE_SYNC_HEALTH_OUTPUT_FILE || 'artifacts/asset-price-sync-health.json'
).trim();
const ASSET_LIMIT = Math.max(1, Number(process.env.ASSET_PRICE_SYNC_HEALTH_ASSET_LIMIT || 25));
const RUN_LIMIT = Math.max(1, Number(process.env.ASSET_PRICE_SYNC_HEALTH_RUN_LIMIT || 10));
const UPDATE_LIMIT = Math.max(1, Number(process.env.ASSET_PRICE_SYNC_HEALTH_UPDATE_LIMIT || 20));
const REQUIRE_ASSET_RESULTS =
  String(process.env.ASSET_PRICE_SYNC_HEALTH_REQUIRE_ASSET_RESULTS || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_RUN_RESULTS =
  String(process.env.ASSET_PRICE_SYNC_HEALTH_REQUIRE_RUN_RESULTS || 'false')
    .trim()
    .toLowerCase() === 'true';

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

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
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

function readNullableThresholdNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
}

export function resolveAssetPriceSyncHealthThresholds(
  envMap: Record<string, string | undefined> = process.env
): AssetPriceSyncHealthThresholds {
  return {
    maxConfigLatencyMs: readNullableThresholdNumber(
      envMap.ASSET_PRICE_SYNC_HEALTH_MAX_CONFIG_LATENCY_MS
    ),
    maxAssetListLatencyMs: readNullableThresholdNumber(
      envMap.ASSET_PRICE_SYNC_HEALTH_MAX_ASSET_LIST_LATENCY_MS
    ),
    maxRunListLatencyMs: readNullableThresholdNumber(
      envMap.ASSET_PRICE_SYNC_HEALTH_MAX_RUN_LIST_LATENCY_MS
    ),
    minAssetResults: readNullableThresholdNumber(envMap.ASSET_PRICE_SYNC_HEALTH_MIN_ASSET_RESULTS),
    minRunResults: readNullableThresholdNumber(envMap.ASSET_PRICE_SYNC_HEALTH_MIN_RUN_RESULTS),
  };
}

export function buildAssetPriceSyncHealthThresholdProfile(
  thresholds: AssetPriceSyncHealthThresholds
): AssetPriceSyncHealthThresholdProfile {
  const thresholdEntries: Array<[string, number | null]> = [
    ['maxConfigLatencyMs', thresholds.maxConfigLatencyMs],
    ['maxAssetListLatencyMs', thresholds.maxAssetListLatencyMs],
    ['maxRunListLatencyMs', thresholds.maxRunListLatencyMs],
    ['minAssetResults', thresholds.minAssetResults],
    ['minRunResults', thresholds.minRunResults],
  ];
  const configuredKeys = thresholdEntries
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key]) => key);
  const missingKeys = thresholdEntries
    .filter(([, value]) => value === null || value === undefined)
    .map(([key]) => key);

  return {
    mode:
      configuredKeys.length === 0 ? 'unbounded' : missingKeys.length === 0 ? 'bounded' : 'partial',
    configuredThresholdCount: configuredKeys.length,
    requiredThresholdCount: thresholdEntries.length,
    configuredKeys,
    missingKeys,
  };
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

async function resolveAccessToken(): Promise<string> {
  if (ACCESS_TOKEN) {
    return ACCESS_TOKEN;
  }

  const loggedInToken = await loginIfPossible();
  assert.ok(
    loggedInToken,
    'ASSET_PRICE_SYNC_HEALTH_ACCESS_TOKEN/SMOKE_ACCESS_TOKEN or login credentials are required for asset-price-sync health'
  );
  return loggedInToken;
}

async function timedRequest(
  targetPath: string,
  accessToken = ''
): Promise<{ payload: JsonRecord; durationMs: number }> {
  const startedAt = Date.now();
  const payload = await requestJson(targetPath, {}, accessToken);
  return {
    payload,
    durationMs: Date.now() - startedAt,
  };
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
  return contract;
}

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

export function buildAssetPriceSyncHealthSnapshot(input: {
  baseUrl: string;
  queuePayload: JsonRecord;
  workerPayload: JsonRecord;
  overviewPayload: JsonRecord;
  configPayload: JsonRecord;
  configLatencyMs: number;
  assetsPayload: JsonRecord;
  assetsLatencyMs: number;
  runsPayload: JsonRecord;
  runsLatencyMs: number;
  progressPayload?: JsonRecord | null;
  updatesPayload?: JsonRecord | null;
  thresholds?: AssetPriceSyncHealthThresholds;
}): AssetPriceSyncHealthSnapshot {
  const queueData = asRecord(input.queuePayload.data);
  const workerData = asRecord(input.workerPayload.data);
  const overviewData = asRecord(input.overviewPayload.data);
  const configData = asRecord(input.configPayload.data);
  const assetsData = asRecord(input.assetsPayload.data);
  const runsData = asRecord(input.runsPayload.data);
  const progressData = asRecord(input.progressPayload?.data);
  const updatesData = asRecord(input.updatesPayload?.data);

  const overviewItems = readArray(overviewData.items).map((item) => asRecord(item));
  const overviewItem =
    overviewItems.find((item) => readString(item.key) === 'asset-price-sync') || {};
  const recentRun = asRecord(overviewItem.recentRun);
  const assets = readArray(assetsData.items).map((item) => asRecord(item));
  const runs = readArray(runsData.items).map((item) => asRecord(item));
  const latestRun = asRecord(runs[0]);
  const latestRunProgress = asRecord(asRecord(progressData.run).progress);
  const thresholds = input.thresholds || resolveAssetPriceSyncHealthThresholds();

  const overviewTime = assertTimeContract('asset-price overview', overviewData.time);
  const configTime = assertTimeContract('asset-price config', configData.time);
  const runsTime = assertTimeContract('asset-price runs', runsData.time);
  const progressTime =
    input.progressPayload && Object.keys(progressData).length > 0
      ? assertTimeContract('asset-price run progress', progressData.time)
      : null;
  const updatesTime =
    input.updatesPayload && Object.keys(updatesData).length > 0
      ? assertTimeContract('asset-price updates', updatesData.time)
      : null;

  return {
    baseUrl: input.baseUrl,
    queueStatus: readNullableString(queueData.status),
    queueName: readNullableString(queueData.queue),
    queueLatencyMs: readNullableNumber(queueData.latencyMs),
    workerStatus: readNullableString(workerData.status),
    workerHttpStatus: readNullableString(workerData.workerHttpStatus),
    workerHeartbeatAgeMs: readNullableNumber(workerData.heartbeatAgeMs),
    schedulerKey: readNullableString(configData.key),
    schedulerType: readNullableString(configData.schedulerType),
    schedulerEnabled: readBoolean(configData.enabled),
    schedulerTimezone: readNullableString(configData.timezone),
    schedulerSources: readStringArray(configData.sources),
    selectionMode: readNullableString(configData.selectionMode),
    selectedAssetIdsCount: readArray(configData.selectedAssetIds).length,
    configLatencyMs: input.configLatencyMs,
    assetsLatencyMs: input.assetsLatencyMs,
    runsLatencyMs: input.runsLatencyMs,
    assetTotal: readNumber(assetsData.total),
    assetCount: assets.length,
    assetFirstId: readNullableString(assets[0]?.id),
    assetFirstSymbol: readNullableString(assets[0]?.symbol),
    assetSourceSamples: Array.from(new Set(assets.map((item) => readString(item.source)).filter(Boolean))),
    runTotal: readNumber(runsData.total),
    runCount: runs.length,
    latestRunId: readNullableString(latestRun.id),
    latestRunStatus: readNullableString(latestRun.status),
    latestRunExecutionContext: readNullableString(latestRun.executionContext),
    latestRunInitiatedByType: readNullableString(asRecord(latestRun.initiatedBy).type),
    latestRunScopeAssetsCount: readNullableNumber(latestRun.scopeAssetsCount),
    latestRunProgressPercent: readNullableNumber(latestRunProgress.percent),
    latestUpdateCount: input.updatesPayload ? readNullableNumber(updatesData.total) : null,
    overviewCount: overviewItems.length,
    overviewDisplayTimeZone: readNullableString(overviewTime.displayTimeZone),
    overviewLocalized: readBoolean(overviewTime.displayTimesLocalized),
    overviewStatus: readNullableString(overviewItem.status),
    overviewExecutionContext: readNullableString(
      recentRun.executionContext || overviewItem.executionContext
    ),
    overviewInitiatedByType: readNullableString(
      asRecord(recentRun.initiatedBy).type || asRecord(overviewItem.initiatedBy).type
    ),
    overviewHasQueuedWork:
      overviewItem.hasQueuedWork === undefined ? null : overviewItem.hasQueuedWork === true,
    configDisplayTimeZone: readNullableString(configTime.displayTimeZone),
    configLocalized: readBoolean(configTime.displayTimesLocalized),
    runsDisplayTimeZone: readNullableString(runsTime.displayTimeZone),
    runsLocalized: readBoolean(runsTime.displayTimesLocalized),
    progressDisplayTimeZone: progressTime ? readNullableString(progressTime.displayTimeZone) : null,
    progressLocalized: progressTime ? readBoolean(progressTime.displayTimesLocalized) : null,
    updatesDisplayTimeZone: updatesTime ? readNullableString(updatesTime.displayTimeZone) : null,
    updatesLocalized: updatesTime ? readBoolean(updatesTime.displayTimesLocalized) : null,
    thresholds,
    thresholdProfile: buildAssetPriceSyncHealthThresholdProfile(thresholds),
  };
}

export function assertAssetPriceSyncHealthSnapshot(
  snapshot: AssetPriceSyncHealthSnapshot,
  options: AssetPriceSyncHealthAssertionOptions = {}
): void {
  const requireAssetResults =
    options.requireAssetResults !== undefined
      ? options.requireAssetResults
      : REQUIRE_ASSET_RESULTS;
  const requireRunResults =
    options.requireRunResults !== undefined ? options.requireRunResults : REQUIRE_RUN_RESULTS;
  const thresholds = options.thresholds || snapshot.thresholds || resolveAssetPriceSyncHealthThresholds();

  assert.equal(snapshot.queueStatus, 'ok', 'asset-price queue health must remain healthy');
  assert.equal(
    snapshot.queueName,
    'scheduler.exchange-assets.execute',
    'asset-price queue name must remain scheduler.exchange-assets.execute'
  );
  assert.equal(snapshot.workerStatus, 'ok', 'asset-price worker health must remain healthy');
  assert.equal(
    snapshot.workerHttpStatus,
    'ok',
    'asset-price worker HTTP reachability must remain healthy'
  );
  assert.equal(
    snapshot.schedulerKey,
    'asset-price-sync',
    'asset-price config key must remain asset-price-sync'
  );
  assert.equal(snapshot.schedulerType, 'global', 'asset-price scheduler must remain global');
  assert.equal(snapshot.configLocalized, true, 'asset-price config timestamps must remain localized');
  assert.equal(snapshot.runsLocalized, true, 'asset-price runs timestamps must remain localized');
  assert.equal(
    snapshot.overviewLocalized,
    true,
    'asset-price overview timestamps must remain localized'
  );
  assert.equal(
    snapshot.schedulerSources.includes('mudrex'),
    true,
    'asset-price config must include Mudrex as a system source'
  );
  assert.equal(
    snapshot.schedulerSources.includes('delta_exchange'),
    true,
    'asset-price config must include Delta Exchange as a system source'
  );
  assert.equal(
    snapshot.selectionMode === 'all' || snapshot.selectionMode === 'custom',
    true,
    'asset-price selection mode must remain all or custom'
  );
  assert.equal(
    snapshot.assetTotal >= snapshot.assetCount,
    true,
    'asset-price asset totals must not undercount returned rows'
  );
  if (requireAssetResults) {
    assert.equal(
      snapshot.assetCount > 0,
      true,
      'asset-price scope assets route should return at least one broker asset'
    );
  }
  assert.equal(
    snapshot.runTotal >= snapshot.runCount,
    true,
    'asset-price run totals must not undercount returned rows'
  );
  if (requireRunResults) {
    assert.equal(
      snapshot.runCount > 0,
      true,
      'asset-price runs route should expose at least one scheduler run'
    );
  }
  if (snapshot.latestRunId) {
    assert.equal(
      snapshot.latestRunExecutionContext === null ||
        snapshot.latestRunExecutionContext === 'system',
      true,
      'asset-price latest run must stay in system execution context'
    );
  }
  if (snapshot.overviewInitiatedByType) {
    assert.equal(
      ['manual', 'cron', 'system'].includes(snapshot.overviewInitiatedByType),
      true,
      'asset-price overview initiator type must remain explicit'
    );
  }

  if (thresholds.maxConfigLatencyMs !== null) {
    assert.equal(
      snapshot.configLatencyMs <= thresholds.maxConfigLatencyMs,
      true,
      `asset-price config latency must stay under ${thresholds.maxConfigLatencyMs}ms`
    );
  }
  if (thresholds.maxAssetListLatencyMs !== null) {
    assert.equal(
      snapshot.assetsLatencyMs <= thresholds.maxAssetListLatencyMs,
      true,
      `asset-price asset-list latency must stay under ${thresholds.maxAssetListLatencyMs}ms`
    );
  }
  if (thresholds.maxRunListLatencyMs !== null) {
    assert.equal(
      snapshot.runsLatencyMs <= thresholds.maxRunListLatencyMs,
      true,
      `asset-price run-list latency must stay under ${thresholds.maxRunListLatencyMs}ms`
    );
  }
  if (thresholds.minAssetResults !== null) {
    assert.equal(
      snapshot.assetTotal >= thresholds.minAssetResults,
      true,
      `asset-price asset totals must stay at or above ${thresholds.minAssetResults}`
    );
  }
  if (thresholds.minRunResults !== null) {
    assert.equal(
      snapshot.runTotal >= thresholds.minRunResults,
      true,
      `asset-price run totals must stay at or above ${thresholds.minRunResults}`
    );
  }
}

async function run(): Promise<void> {
  const accessToken = await resolveAccessToken();
  const [queuePayload, workerPayload] = await Promise.all([
    requestJson('/health/queue'),
    requestJson('/health/worker'),
  ]);
  const [overviewResult, configResult, assetsResult, runsResult] = await Promise.all([
    timedRequest('/scheduler/overview', accessToken),
    timedRequest('/scheduler/asset-price/config', accessToken),
    timedRequest(`/scheduler/asset-price/assets?limit=${ASSET_LIMIT}`, accessToken),
    timedRequest(`/scheduler/asset-price/runs?limit=${RUN_LIMIT}`, accessToken),
  ]);

  const runsData = asRecord(runsResult.payload.data);
  const latestRun = asRecord(readArray(runsData.items)[0]);
  const latestRunId = readString(latestRun.id);
  const [progressResult, updatesResult] = latestRunId
    ? await Promise.all([
        timedRequest(
          `/scheduler/asset-price/runs/${encodeURIComponent(latestRunId)}/progress`,
          accessToken
        ),
        timedRequest(
          `/scheduler/asset-price/runs/${encodeURIComponent(latestRunId)}/updates?limit=${UPDATE_LIMIT}`,
          accessToken
        ),
      ])
    : [null, null];

  const snapshot = buildAssetPriceSyncHealthSnapshot({
    baseUrl: BASE_URL,
    queuePayload,
    workerPayload,
    overviewPayload: overviewResult.payload,
    configPayload: configResult.payload,
    configLatencyMs: configResult.durationMs,
    assetsPayload: assetsResult.payload,
    assetsLatencyMs: assetsResult.durationMs,
    runsPayload: runsResult.payload,
    runsLatencyMs: runsResult.durationMs,
    progressPayload: progressResult?.payload || null,
    updatesPayload: updatesResult?.payload || null,
  });

  assertAssetPriceSyncHealthSnapshot(snapshot);
  await persistSummary(snapshot);
  console.log('asset-price-sync-health:', JSON.stringify(snapshot));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
