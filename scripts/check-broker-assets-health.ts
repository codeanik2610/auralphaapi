import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;
type ThresholdProfileMode = 'bounded' | 'partial' | 'unbounded';

export type BrokerAssetsSourceVisibleSummary = {
  source: string;
  total: number;
  count: number;
  latencyMs: number;
  firstSymbol: string | null;
};

export type BrokerAssetsHealthThresholds = {
  maxAdminCatalogLatencyMs: number | null;
  maxVisibleLatencyMs: number | null;
  minAdminCatalogResults: number | null;
  minVisibleResults: number | null;
  requiredVisibleSources: string[];
  minVisibleResultsBySource: Record<string, number>;
};

export type BrokerAssetsHealthThresholdProfile = {
  mode: ThresholdProfileMode;
  configuredThresholdCount: number;
  requiredThresholdCount: number;
  configuredKeys: string[];
  missingKeys: string[];
};

export type BrokerAssetsHealthSnapshot = {
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
  adminCatalogLatencyMs: number;
  adminCatalogTotal: number;
  adminCatalogCount: number;
  adminCatalogFirstSymbol: string | null;
  adminSearchTerm: string | null;
  adminSearchCount: number;
  visibleLatencyMs: number;
  visibleTotal: number;
  visibleCount: number;
  visibleFirstSource: string | null;
  visibleFirstSymbol: string | null;
  visibleQuerySource: string | null;
  visibleSearchTerm: string | null;
  visibleSearchCount: number;
  mudrexVisibleCount: number;
  mudrexMappedCount: number;
  mudrexMappedConsistency: boolean;
  sourceVisibleSummaries: Record<string, BrokerAssetsSourceVisibleSummary>;
  thresholds: BrokerAssetsHealthThresholds;
  thresholdProfile: BrokerAssetsHealthThresholdProfile;
};

export type BrokerAssetsHealthAssertionOptions = {
  requireAdminResults?: boolean;
  requireVisibleResults?: boolean;
  thresholds?: BrokerAssetsHealthThresholds;
};

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const ACCESS_TOKEN = String(
  process.env.BROKER_ASSETS_HEALTH_ACCESS_TOKEN || process.env.SMOKE_ACCESS_TOKEN || ''
).trim();
const LOGIN_EMAIL = String(
  process.env.BROKER_ASSETS_HEALTH_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.BROKER_ASSETS_HEALTH_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const OUTPUT_FILE = String(
  process.env.BROKER_ASSETS_HEALTH_OUTPUT_FILE || 'artifacts/broker-assets-health.json'
).trim();
const REQUIRE_ADMIN_RESULTS =
  String(process.env.BROKER_ASSETS_HEALTH_REQUIRE_ADMIN_RESULTS || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_VISIBLE_RESULTS =
  String(process.env.BROKER_ASSETS_HEALTH_REQUIRE_VISIBLE_RESULTS || 'false')
    .trim()
    .toLowerCase() === 'true';
const VISIBLE_SOURCE = String(process.env.BROKER_ASSETS_HEALTH_VISIBLE_SOURCE || '').trim();
const VISIBLE_LIMIT = Math.max(1, Number(process.env.BROKER_ASSETS_HEALTH_VISIBLE_LIMIT || 10));
const ADMIN_LIMIT = Math.max(1, Number(process.env.BROKER_ASSETS_HEALTH_ADMIN_LIMIT || 10));
const ADMIN_SEARCH = String(process.env.BROKER_ASSETS_HEALTH_ADMIN_SEARCH || 'BTC')
  .trim()
  .toUpperCase();

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
  if (Array.isArray(value)) {
    return value.map((item) => readString(item)).filter(Boolean);
  }

  return readString(value)
    .split(',')
    .map((item) => readString(item))
    .filter(Boolean);
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

function normalizeSourceKey(source: string): string {
  return readString(source).toLowerCase();
}

function toSourceThresholdEnvName(source: string): string {
  const normalized = normalizeSourceKey(source).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `BROKER_ASSETS_HEALTH_MIN_${normalized.toUpperCase()}_VISIBLE_RESULTS`;
}

function hasSearchMatch(item: JsonRecord, term: string): boolean {
  const normalizedTerm = readString(term).toUpperCase();
  if (!normalizedTerm) {
    return true;
  }

  const symbol = readString(item.symbol).toUpperCase();
  const name = readString(item.name).toUpperCase();
  return symbol.includes(normalizedTerm) || name.includes(normalizedTerm);
}

export function resolveBrokerAssetsHealthThresholds(
  envMap: Record<string, string | undefined> = process.env
): BrokerAssetsHealthThresholds {
  const requiredVisibleSources = Array.from(
    new Set(
      readStringArray(envMap.BROKER_ASSETS_HEALTH_REQUIRED_VISIBLE_SOURCES)
        .map((source) => normalizeSourceKey(source))
        .filter(Boolean)
    )
  );
  const minVisibleResultsBySource = Object.fromEntries(
    requiredVisibleSources.map((source) => {
      const envName = toSourceThresholdEnvName(source);
      const minimum = readNullableThresholdNumber(envMap[envName]);
      return [source, minimum ?? 1];
    })
  ) as Record<string, number>;

  return {
    maxAdminCatalogLatencyMs: readNullableThresholdNumber(
      envMap.BROKER_ASSETS_HEALTH_MAX_ADMIN_CATALOG_LATENCY_MS
    ),
    maxVisibleLatencyMs: readNullableThresholdNumber(
      envMap.BROKER_ASSETS_HEALTH_MAX_VISIBLE_LATENCY_MS
    ),
    minAdminCatalogResults: readNullableThresholdNumber(
      envMap.BROKER_ASSETS_HEALTH_MIN_ADMIN_CATALOG_RESULTS
    ),
    minVisibleResults: readNullableThresholdNumber(envMap.BROKER_ASSETS_HEALTH_MIN_VISIBLE_RESULTS),
    requiredVisibleSources,
    minVisibleResultsBySource,
  };
}

export function buildBrokerAssetsHealthThresholdProfile(
  thresholds: BrokerAssetsHealthThresholds
): BrokerAssetsHealthThresholdProfile {
  const thresholdEntries: Array<[string, number | null]> = [
    ['maxAdminCatalogLatencyMs', thresholds.maxAdminCatalogLatencyMs],
    ['maxVisibleLatencyMs', thresholds.maxVisibleLatencyMs],
    ['minAdminCatalogResults', thresholds.minAdminCatalogResults],
    ['minVisibleResults', thresholds.minVisibleResults],
    ...thresholds.requiredVisibleSources.map(
      (source) =>
        [`minVisibleResultsBySource.${source}`, thresholds.minVisibleResultsBySource[source] ?? null] as [
          string,
          number | null,
        ]
    ),
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

async function persistSummary(summary: Record<string, unknown>): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

export function buildBrokerAssetsHealthSnapshot(input: {
  baseUrl: string;
  queuePayload: JsonRecord;
  workerPayload: JsonRecord;
  configPayload: JsonRecord;
  adminCatalogPayload: JsonRecord;
  adminCatalogLatencyMs: number;
  visiblePayload: JsonRecord;
  visibleLatencyMs: number;
  visibleQuerySource: string | null;
  visibleSearchTerm: string | null;
  visibleSearchPayload: JsonRecord | null;
  adminSearchTerm: string | null;
  adminSearchPayload: JsonRecord | null;
  sourceVisibleSummaries?: Record<string, BrokerAssetsSourceVisibleSummary>;
  thresholds?: BrokerAssetsHealthThresholds;
}): BrokerAssetsHealthSnapshot {
  const queueData = asRecord(input.queuePayload.data);
  const workerData = asRecord(input.workerPayload.data);
  const configData = asRecord(input.configPayload.data);
  const adminCatalogData = asRecord(input.adminCatalogPayload.data);
  const visibleData = asRecord(input.visiblePayload.data);
  const adminItems = readArray(adminCatalogData.items).map((item) => asRecord(item));
  const visibleItems = readArray(visibleData.assets).map((item) => asRecord(item));
  const visibleSearchItems = readArray(asRecord(input.visibleSearchPayload?.data).assets).map((item) =>
    asRecord(item)
  );
  const adminSearchItems = readArray(asRecord(input.adminSearchPayload?.data).items).map((item) =>
    asRecord(item)
  );
  const mudrexItems = visibleItems.filter((item) => readString(item.source).toLowerCase() === 'mudrex');
  const mudrexMappedItems = mudrexItems.filter((item) => item.isDeltaMapped === true);
  const thresholds = input.thresholds || resolveBrokerAssetsHealthThresholds();
  const sourceVisibleSummaries = Object.fromEntries(
    Object.entries(input.sourceVisibleSummaries || {}).map(([source, summary]) => {
      const normalizedSource = normalizeSourceKey(source || summary.source);
      return [
        normalizedSource,
        {
          source: normalizedSource,
          total: readNumber(summary.total),
          count: readNumber(summary.count),
          latencyMs: readNumber(summary.latencyMs),
          firstSymbol: readNullableString(summary.firstSymbol),
        },
      ];
    })
  ) as Record<string, BrokerAssetsSourceVisibleSummary>;

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
    schedulerSources: readArray(configData.sources).map((item) => readString(item)).filter(Boolean),
    adminCatalogLatencyMs: input.adminCatalogLatencyMs,
    adminCatalogTotal: readNumber(adminCatalogData.total),
    adminCatalogCount: adminItems.length,
    adminCatalogFirstSymbol: readNullableString(adminItems[0]?.symbol),
    adminSearchTerm: input.adminSearchTerm,
    adminSearchCount: adminSearchItems.length,
    visibleLatencyMs: input.visibleLatencyMs,
    visibleTotal: readNumber(visibleData.total),
    visibleCount: visibleItems.length,
    visibleFirstSource: readNullableString(visibleItems[0]?.source),
    visibleFirstSymbol: readNullableString(visibleItems[0]?.symbol),
    visibleQuerySource: input.visibleQuerySource,
    visibleSearchTerm: input.visibleSearchTerm,
    visibleSearchCount: visibleSearchItems.length,
    mudrexVisibleCount: mudrexItems.length,
    mudrexMappedCount: mudrexMappedItems.length,
    mudrexMappedConsistency: mudrexMappedItems.every(
      (item) => Boolean(readString(item.deltaExternalId)) && Boolean(readString(item.deltaSymbol))
    ),
    sourceVisibleSummaries,
    thresholds,
    thresholdProfile: buildBrokerAssetsHealthThresholdProfile(thresholds),
  };
}

export function assertBrokerAssetsHealthSnapshot(
  snapshot: BrokerAssetsHealthSnapshot,
  options: BrokerAssetsHealthAssertionOptions = {}
): void {
  const requireAdminResults =
    options.requireAdminResults !== undefined ? options.requireAdminResults : REQUIRE_ADMIN_RESULTS;
  const requireVisibleResults =
    options.requireVisibleResults !== undefined
      ? options.requireVisibleResults
      : REQUIRE_VISIBLE_RESULTS;
  const thresholds = options.thresholds || snapshot.thresholds || resolveBrokerAssetsHealthThresholds();

  assert.equal(snapshot.queueStatus, 'ok', 'broker-assets queue health must remain healthy');
  assert.equal(
    snapshot.queueName,
    'scheduler.exchange-assets.execute',
    'broker-assets queue name must remain scheduler.exchange-assets.execute'
  );
  assert.equal(snapshot.workerStatus, 'ok', 'broker-assets worker health must remain healthy');
  assert.equal(
    snapshot.workerHttpStatus,
    'ok',
    'broker-assets worker HTTP reachability must remain healthy'
  );
  assert.equal(
    snapshot.schedulerKey,
    'broker-assets-sync',
    'broker-assets scheduler config key must remain broker-assets-sync'
  );
  assert.equal(
    snapshot.schedulerType,
    'global',
    'broker-assets scheduler config must remain global'
  );
  assert.equal(
    snapshot.schedulerSources.length > 0,
    true,
    'broker-assets scheduler config must expose at least one source'
  );
  assert.equal(
    snapshot.adminCatalogTotal >= snapshot.adminCatalogCount,
    true,
    'admin catalog totals must not undercount returned broker-assets rows'
  );
  if (requireAdminResults) {
    assert.equal(
      snapshot.adminCatalogCount > 0,
      true,
      'broker-assets admin catalog should expose at least one global asset row'
    );
  }
  assert.equal(
    snapshot.visibleTotal >= snapshot.visibleCount,
    true,
    'visible broker-assets totals must not undercount returned rows'
  );
  if (requireVisibleResults) {
    assert.equal(
      snapshot.visibleCount > 0,
      true,
      'broker-assets visible route should return at least one user-visible asset row'
    );
  }
  if (snapshot.mudrexMappedCount > 0) {
    assert.equal(
      snapshot.mudrexMappedConsistency,
      true,
      'mudrex assets marked as Delta-mapped must include Delta linkage fields'
    );
  }
  if (thresholds.maxAdminCatalogLatencyMs !== null) {
    assert.equal(
      snapshot.adminCatalogLatencyMs <= thresholds.maxAdminCatalogLatencyMs,
      true,
      `broker-assets admin catalog latency must stay under ${thresholds.maxAdminCatalogLatencyMs}ms`
    );
  }
  if (thresholds.maxVisibleLatencyMs !== null) {
    assert.equal(
      snapshot.visibleLatencyMs <= thresholds.maxVisibleLatencyMs,
      true,
      `broker-assets visible-route latency must stay under ${thresholds.maxVisibleLatencyMs}ms`
    );
  }
  if (thresholds.minAdminCatalogResults !== null) {
    assert.equal(
      snapshot.adminCatalogTotal >= thresholds.minAdminCatalogResults,
      true,
      `broker-assets admin catalog total must stay at or above ${thresholds.minAdminCatalogResults}`
    );
  }
  if (thresholds.minVisibleResults !== null) {
    assert.equal(
      snapshot.visibleTotal >= thresholds.minVisibleResults,
      true,
      `broker-assets visible total must stay at or above ${thresholds.minVisibleResults}`
    );
  }
  for (const source of thresholds.requiredVisibleSources) {
    const normalizedSource = normalizeSourceKey(source);
    const summary = snapshot.sourceVisibleSummaries[normalizedSource];
    const minimum = thresholds.minVisibleResultsBySource[normalizedSource] ?? 1;

    assert.equal(
      Boolean(summary),
      true,
      `broker-assets health must capture source visibility for ${normalizedSource}`
    );
    assert.equal(
      readNumber(summary?.total) >= minimum,
      true,
      `broker-assets source ${normalizedSource} must expose at least ${minimum} visible rows`
    );
  }
}

async function run(): Promise<void> {
  const accessToken = ACCESS_TOKEN || (await loginIfPossible());
  assert.ok(
    accessToken,
    'BROKER_ASSETS_HEALTH_ACCESS_TOKEN/SMOKE_ACCESS_TOKEN or login credentials are required for broker-assets health'
  );

  const thresholds = resolveBrokerAssetsHealthThresholds();
  const [queuePayload, workerPayload, configPayload] = await Promise.all([
    requestJson('/health/queue'),
    requestJson('/health/worker'),
    requestJson('/scheduler/exchange-assets/config', {}, accessToken),
  ]);

  const { payload: adminCatalogPayload, durationMs: adminCatalogLatencyMs } = await timedRequest(
    `/scheduler/exchange-assets/assets?limit=${ADMIN_LIMIT}&offset=0`,
    accessToken
  );
  const adminCatalogItems = readArray(asRecord(adminCatalogPayload.data).items).map((item) =>
    asRecord(item)
  );
  const adminSearchTerm =
    ADMIN_SEARCH || readString(adminCatalogItems[0]?.symbol).slice(0, 3).toUpperCase() || null;
  const adminSearchPayload = adminSearchTerm
    ? await requestJson(
        `/scheduler/exchange-assets/assets?limit=${ADMIN_LIMIT}&offset=0&search=${encodeURIComponent(
          adminSearchTerm
        )}`,
        {},
        accessToken
      )
    : null;
  const adminSearchItems = readArray(asRecord(adminSearchPayload?.data).items).map((item) =>
    asRecord(item)
  );

  const visiblePath = VISIBLE_SOURCE
    ? `/exchange-assets?source=${encodeURIComponent(VISIBLE_SOURCE)}&limit=${VISIBLE_LIMIT}&offset=0`
    : `/exchange-assets?limit=${VISIBLE_LIMIT}&offset=0`;
  const { payload: visiblePayload, durationMs: visibleLatencyMs } = await timedRequest(
    visiblePath,
    accessToken
  );
  const visibleItems = readArray(asRecord(visiblePayload.data).assets).map((item) => asRecord(item));
  const visibleSearchTerm = readString(visibleItems[0]?.symbol).slice(0, 3).toUpperCase() || null;
  const visibleSearchPayload =
    visibleSearchTerm && visibleItems.length > 0
      ? await requestJson(
          `${VISIBLE_SOURCE ? `/exchange-assets?source=${encodeURIComponent(VISIBLE_SOURCE)}&` : '/exchange-assets?'}limit=${VISIBLE_LIMIT}&offset=0&search=${encodeURIComponent(
            visibleSearchTerm
          )}`,
          {},
          accessToken
        )
      : null;
  const visibleSearchItems = readArray(asRecord(visibleSearchPayload?.data).assets).map((item) =>
    asRecord(item)
  );

  const sourceVisibleSummaries = Object.fromEntries(
    (
      await Promise.all(
        thresholds.requiredVisibleSources.map(async (source) => {
          const { payload, durationMs } = await timedRequest(
            `/exchange-assets?source=${encodeURIComponent(source)}&limit=${VISIBLE_LIMIT}&offset=0`,
            accessToken
          );
          const sourceData = asRecord(payload.data);
          const sourceItems = readArray(sourceData.assets).map((item) => asRecord(item));

          return [
            source,
            {
              source,
              total: readNumber(sourceData.total),
              count: sourceItems.length,
              latencyMs: durationMs,
              firstSymbol: readNullableString(sourceItems[0]?.symbol),
            },
          ] as const;
        })
      )
    ).map(([source, summary]) => [normalizeSourceKey(source), summary])
  ) as Record<string, BrokerAssetsSourceVisibleSummary>;

  const snapshot = buildBrokerAssetsHealthSnapshot({
    baseUrl: BASE_URL,
    queuePayload,
    workerPayload,
    configPayload,
    adminCatalogPayload,
    adminCatalogLatencyMs,
    visiblePayload,
    visibleLatencyMs,
    visibleQuerySource: VISIBLE_SOURCE || null,
    visibleSearchTerm,
    visibleSearchPayload,
    adminSearchTerm,
    adminSearchPayload,
    sourceVisibleSummaries,
    thresholds,
  });

  console.log('broker-assets-health-check:', JSON.stringify(snapshot));

  for (const item of adminSearchItems) {
    if (adminSearchTerm) {
      assert.equal(
        hasSearchMatch(item, adminSearchTerm),
        true,
        `admin broker-assets search must keep symbol matches for ${adminSearchTerm}`
      );
    }
  }

  for (const item of visibleItems) {
    if (VISIBLE_SOURCE) {
      assert.equal(
        readString(item.source).toLowerCase(),
        VISIBLE_SOURCE.toLowerCase(),
        `visible broker-assets rows must stay scoped to source ${VISIBLE_SOURCE}`
      );
    }
  }

  for (const item of visibleSearchItems) {
    if (visibleSearchTerm) {
      assert.equal(
        hasSearchMatch(item, visibleSearchTerm),
        true,
        `visible broker-assets search must keep symbol or name matches for ${visibleSearchTerm}`
      );
    }
  }

  assertBrokerAssetsHealthSnapshot(snapshot);
  await persistSummary(snapshot);
}

const isDirectRun = (() => {
  const executedFile = String(process.argv[1] || '');
  if (!executedFile) {
    return false;
  }

  return (
    executedFile.endsWith(path.join('scripts', 'check-broker-assets-health.ts')) ||
    executedFile.endsWith(path.join('scripts', 'check-broker-assets-health.js'))
  );
})();

if (isDirectRun) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
