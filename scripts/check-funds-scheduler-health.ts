import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;
type ThresholdProfileMode = 'bounded' | 'partial' | 'unbounded';
const FUNDS_HEALTH_THRESHOLD_KEYS = [
  'maxStaleAccounts',
  'maxMissingAccounts',
  'maxFailedLatestAttempts',
  'maxLatestSnapshotAgeMinutes',
  'maxLatestAttemptAgeMinutes',
] as const;
type FundsHealthThresholdKey = (typeof FUNDS_HEALTH_THRESHOLD_KEYS)[number];
type FundsSchedulerHealthThresholds = Record<FundsHealthThresholdKey, number | null>;
export type FundsSchedulerThresholdProfile = {
  mode: ThresholdProfileMode;
  configuredThresholdCount: number;
  requiredThresholdCount: number;
  configuredKeys: string[];
  missingKeys: string[];
};
export type FundsSchedulerHealthSnapshot = {
  baseUrl: string;
  configDurationMs: number;
  summaryDurationMs: number;
  coverageDurationMs: number;
  runsDurationMs: number;
  queueDurationMs: number;
  workerDurationMs: number;
  scheduler: JsonRecord;
  firstCoverageItem: JsonRecord | null;
  worker: JsonRecord;
  thresholds: JsonRecord;
  thresholdProfile: FundsSchedulerThresholdProfile;
  scopedRecovery: JsonRecord | null;
  productSnapshot: JsonRecord | null;
};
const FUNDS_RUNTIME_SCHEMA_MIGRATION = '1770707000000-HardenFundsSnapshotsRuntime';

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const ADMIN_EMAIL = String(
  process.env.FUNDS_SCHEDULER_ADMIN_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const ADMIN_PASSWORD = String(
  process.env.FUNDS_SCHEDULER_ADMIN_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const USER_EMAIL = String(process.env.FUNDS_SCHEDULER_USER_EMAIL || ADMIN_EMAIL).trim();
const USER_PASSWORD = String(process.env.FUNDS_SCHEDULER_USER_PASSWORD || ADMIN_PASSWORD).trim();
const RUN_PRODUCT_DESK_CHECKS =
  String(process.env.FUNDS_SCHEDULER_RUN_PRODUCT_DESK_CHECKS || 'true')
    .trim()
    .toLowerCase() !== 'false';
const TRIGGER_SCOPED_RECOVERY =
  String(process.env.FUNDS_SCHEDULER_TRIGGER_SCOPED_RECOVERY || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_CONNECTED_ACCOUNTS =
  String(process.env.FUNDS_SCHEDULER_REQUIRE_CONNECTED_ACCOUNTS || 'false')
    .trim()
    .toLowerCase() === 'true';
const MAX_CONFIG_MS = Math.max(0, Number(process.env.FUNDS_SCHEDULER_MAX_CONFIG_MS || 1500));
const MAX_SUMMARY_MS = Math.max(0, Number(process.env.FUNDS_SCHEDULER_MAX_SUMMARY_MS || 1500));
const MAX_COVERAGE_MS = Math.max(0, Number(process.env.FUNDS_SCHEDULER_MAX_COVERAGE_MS || 1500));
const MAX_RUNS_MS = Math.max(0, Number(process.env.FUNDS_SCHEDULER_MAX_RUNS_MS || 1500));
const MAX_QUEUE_MS = Math.max(0, Number(process.env.FUNDS_SCHEDULER_MAX_QUEUE_MS || 1500));
const MAX_WORKER_MS = Math.max(0, Number(process.env.FUNDS_SCHEDULER_MAX_WORKER_MS || 1500));
const MAX_SNAPSHOTS_MS = Math.max(0, Number(process.env.FUNDS_SCHEDULER_MAX_SNAPSHOTS_MS || 1500));
const MAX_WALLET_ACTIVE_MS = Math.max(
  0,
  Number(process.env.FUNDS_SCHEDULER_MAX_WALLET_ACTIVE_MS || 1800)
);
const MAX_FUTURES_ACTIVE_MS = Math.max(
  0,
  Number(process.env.FUNDS_SCHEDULER_MAX_FUTURES_ACTIVE_MS || 1800)
);

function readOptionalNumberEnv(name: string): number | null {
  const raw = String(process.env[name] || '').trim();
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number when provided`);
  }
  return parsed;
}

const ENV_MAX_STALE_ACCOUNTS = readOptionalNumberEnv('FUNDS_SCHEDULER_MAX_STALE_ACCOUNTS');
const ENV_MAX_MISSING_ACCOUNTS = readOptionalNumberEnv('FUNDS_SCHEDULER_MAX_MISSING_ACCOUNTS');
const ENV_MAX_FAILED_LATEST_ATTEMPTS = readOptionalNumberEnv(
  'FUNDS_SCHEDULER_MAX_FAILED_LATEST_ATTEMPTS'
);
const ENV_MAX_LATEST_SNAPSHOT_AGE_MINUTES = readOptionalNumberEnv(
  'FUNDS_SCHEDULER_MAX_LATEST_SNAPSHOT_AGE_MINUTES'
);
const ENV_MAX_LATEST_ATTEMPT_AGE_MINUTES = readOptionalNumberEnv(
  'FUNDS_SCHEDULER_MAX_LATEST_ATTEMPT_AGE_MINUTES'
);
const OUTPUT_FILE = String(process.env.FUNDS_SCHEDULER_HEALTH_OUTPUT_FILE || '').trim();

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

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toIsoString(value: unknown): string | null {
  const normalized = readString(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
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
    throw new Error(`${path} -> HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function login(email: string, password: string): Promise<string> {
  assert.ok(email && password, 'funds scheduler health checks require login credentials');
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

function assertMaxDuration(label: string, durationMs: number, maxMs: number): void {
  if (maxMs > 0 && durationMs > maxMs) {
    throw new Error(`${label} latency ${durationMs}ms exceeds ${maxMs}ms`);
  }
}

function assertOptionalCeiling(label: string, actual: number, expectedMax: number | null): void {
  if (expectedMax !== null && actual > expectedMax) {
    throw new Error(`${label} ${actual} exceeds ${expectedMax}`);
  }
}

function normalizeThresholds(value: unknown): FundsSchedulerHealthThresholds {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const thresholds = {} as FundsSchedulerHealthThresholds;

  for (const key of FUNDS_HEALTH_THRESHOLD_KEYS) {
    const raw = input[key];
    if (raw === null || raw === undefined || raw === '') {
      thresholds[key] = null;
      continue;
    }
    const parsed = Number(raw);
    thresholds[key] = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  return thresholds;
}

function buildConfiguredThresholds(
  configData: JsonRecord,
  summaryData: JsonRecord
): FundsSchedulerHealthThresholds {
  const configThresholds = normalizeThresholds(configData.fundsHealthThresholds);
  const summaryThresholds = normalizeThresholds(summaryData.fundsHealthThresholds);
  const envThresholds = normalizeThresholds({
    maxStaleAccounts: ENV_MAX_STALE_ACCOUNTS,
    maxMissingAccounts: ENV_MAX_MISSING_ACCOUNTS,
    maxFailedLatestAttempts: ENV_MAX_FAILED_LATEST_ATTEMPTS,
    maxLatestSnapshotAgeMinutes: ENV_MAX_LATEST_SNAPSHOT_AGE_MINUTES,
    maxLatestAttemptAgeMinutes: ENV_MAX_LATEST_ATTEMPT_AGE_MINUTES,
  });

  const resolved = {} as FundsSchedulerHealthThresholds;
  for (const key of FUNDS_HEALTH_THRESHOLD_KEYS) {
    resolved[key] =
      envThresholds[key] ??
      summaryThresholds[key] ??
      configThresholds[key] ??
      null;
  }

  return resolved;
}

function buildThresholdProfile(
  thresholds: FundsSchedulerHealthThresholds
): FundsSchedulerThresholdProfile {
  const thresholdEntries: Array<[FundsHealthThresholdKey, number | null]> =
    FUNDS_HEALTH_THRESHOLD_KEYS.map((key) => [key, thresholds[key]]);

  const configuredKeys = thresholdEntries
    .filter(([, value]) => value !== null)
    .map(([key]) => key);
  const missingKeys = thresholdEntries
    .filter(([, value]) => value === null)
    .map(([key]) => key);

  return {
    mode:
      configuredKeys.length === 0
        ? 'unbounded'
        : configuredKeys.length === thresholdEntries.length
          ? 'bounded'
          : 'partial',
    configuredThresholdCount: configuredKeys.length,
    requiredThresholdCount: thresholdEntries.length,
    configuredKeys,
    missingKeys,
  };
}

async function persistSummary(summary: FundsSchedulerHealthSnapshot): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }

  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function run(): Promise<void> {
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminMe = await requestJson('/auth/me', {}, adminToken);
  assert.equal(
    readString(asRecord(adminMe.data).role).toLowerCase(),
    'admin',
    'funds scheduler health checks require an admin login'
  );

  const configStartedAt = Date.now();
  const configResponse = await requestJson('/scheduler/funds/config', {}, adminToken);
  const configDurationMs = Date.now() - configStartedAt;
  const configData = asRecord(configResponse.data);
  const configSources = readArray(configData.sources).map(readString).filter(Boolean);
  assert.equal(readString(configData.key), 'funds-sync');
  assert.equal(readString(configData.schedulerType), 'user');
  assert.deepEqual(configSources, ['funds']);

  const summaryStartedAt = Date.now();
  const summaryResponse = await requestJson('/scheduler/funds/summary', {}, adminToken);
  const summaryDurationMs = Date.now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);
  const thresholds = buildConfiguredThresholds(configData, summaryData);
  const lastSuccessfulRun = asRecord(summaryData.lastSuccessfulRun);
  const runtimeFoundation = asRecord(summaryData.runtimeFoundation);
  assert.equal(readString(summaryData.schedulerKey), 'funds-sync');
  assert.equal(readString(runtimeFoundation.status), 'ready');
  assert.equal(readString(runtimeFoundation.migrationName), FUNDS_RUNTIME_SCHEMA_MIGRATION);
  assert.ok(
    readArray(runtimeFoundation.requiredTables).map(readString).includes('funds_snapshots'),
    'funds scheduler summary must expose the funds_snapshots runtime foundation'
  );
  assert.equal(summaryData.recoveryRunSupported, true);
  assert.equal(readString(summaryData.recoveryRunScope), 'account');
  assert.equal(summaryData.runUpdatesSupported, false);
  assert.equal(readString(summaryData.runUpdatesSupportState), 'not_emitted');
  assert.ok(
    readString(summaryData.runUpdatesReason).includes('/scheduler/funds/coverage'),
    'funds summary should explain the dedicated diagnostics surfaces'
  );
  assert.equal(
    typeof asRecord(summaryData.fundsHealthThresholds).maxMissingAccounts !== 'undefined',
    true,
    'funds summary must expose normalized health thresholds'
  );
  assert.ok(
    ['bounded', 'partial', 'unbounded'].includes(
      readString(asRecord(summaryData.fundsHealthThresholdProfile).mode)
    ),
    'funds summary must expose a threshold profile'
  );

  const totalConnectedAccounts = readNumber(summaryData.totalConnectedAccounts);
  const accountsWithFreshSnapshot = readNumber(summaryData.accountsWithFreshSnapshot);
  const accountsWithStaleSnapshot = readNumber(summaryData.accountsWithStaleSnapshot);
  const accountsMissingSnapshot = readNumber(summaryData.accountsMissingSnapshot);
  const accountsWithFailedLatestAttempt = readNumber(summaryData.accountsWithFailedLatestAttempt);
  const accountsWithSuccessfulLatestAttempt = readNumber(
    summaryData.accountsWithSuccessfulLatestAttempt
  );

  assert.equal(
    totalConnectedAccounts,
    accountsWithFreshSnapshot + accountsWithStaleSnapshot + accountsMissingSnapshot,
    'funds summary freshness counts should partition totalConnectedAccounts'
  );
  assert.ok(
    Number.isFinite(accountsWithFailedLatestAttempt),
    'funds summary must expose accountsWithFailedLatestAttempt'
  );
  assert.ok(
    Number.isFinite(accountsWithSuccessfulLatestAttempt),
    'funds summary must expose accountsWithSuccessfulLatestAttempt'
  );
  if (readString(lastSuccessfulRun.id)) {
    assert.ok(
      Number.isFinite(readNumber(lastSuccessfulRun.targetedAccounts)),
      'funds summary latest run must expose targetedAccounts'
    );
    assert.ok(
      Number.isFinite(readNumber(lastSuccessfulRun.refreshedAccounts)),
      'funds summary latest run must expose refreshedAccounts'
    );
    assert.ok(
      Number.isFinite(readNumber(lastSuccessfulRun.failedAccounts)),
      'funds summary latest run must expose failedAccounts'
    );
  }

  const coverageStartedAt = Date.now();
  const coverageResponse = await requestJson('/scheduler/funds/coverage?limit=200&offset=0', {}, adminToken);
  const coverageDurationMs = Date.now() - coverageStartedAt;
  const coverageData = asRecord(coverageResponse.data);
  const coverageItems = readArray(coverageData.items).map(asRecord);
  const coverageTotal = readNumber(coverageData.total);
  assert.equal(coverageTotal, totalConnectedAccounts);
  if (REQUIRE_CONNECTED_ACCOUNTS) {
    assert.ok(coverageTotal > 0, 'funds scheduler health checks require at least one connected account');
  }

  const firstCoverageItem = asRecord(coverageItems[0]);
  if (coverageItems.length > 0) {
    assert.ok(
      ['fresh', 'stale', 'missing'].includes(readString(firstCoverageItem.freshnessState)),
      'funds coverage item freshnessState must be fresh, stale, or missing'
    );
    const latestFetchStatus = readNullableString(firstCoverageItem.latestFetchStatus);
    assert.ok(
      latestFetchStatus === null || latestFetchStatus === 'success' || latestFetchStatus === 'failed',
      'funds coverage latestFetchStatus must be success, failed, or absent'
    );
    assert.ok('needsAttention' in firstCoverageItem, 'funds coverage must expose needsAttention');
    assert.ok(
      'walletSnapshotAvailable' in firstCoverageItem,
      'funds coverage must expose walletSnapshotAvailable'
    );
    assert.ok(
      'futuresSnapshotAvailable' in firstCoverageItem,
      'funds coverage must expose futuresSnapshotAvailable'
    );
  }

  if (coverageTotal <= coverageItems.length) {
    assert.equal(
      coverageItems.filter((item) => readString(item.freshnessState) === 'fresh').length,
      accountsWithFreshSnapshot
    );
    assert.equal(
      coverageItems.filter((item) => readString(item.freshnessState) === 'stale').length,
      accountsWithStaleSnapshot
    );
    assert.equal(
      coverageItems.filter((item) => readString(item.freshnessState) === 'missing').length,
      accountsMissingSnapshot
    );
    assert.equal(
      coverageItems.filter((item) => readString(item.latestFetchStatus) === 'failed').length,
      accountsWithFailedLatestAttempt
    );
  }

  const runsStartedAt = Date.now();
  const runsResponse = await requestJson('/scheduler/funds/runs?limit=5&offset=0', {}, adminToken);
  const runsDurationMs = Date.now() - runsStartedAt;
  const runItems = readArray(asRecord(runsResponse.data).items).map(asRecord);
  assert.ok(Array.isArray(runItems), 'funds scheduler runs must return an items array');

  let scopedRecoverySnapshot: JsonRecord | null = null;
  if (
    TRIGGER_SCOPED_RECOVERY &&
    summaryData.recoveryRunSupported === true &&
    coverageItems.length > 0
  ) {
    const recoveryTarget =
      coverageItems.find((item) => item.needsAttention === true) || coverageItems[0];
    const recoveryResponse = await requestJson(
      '/scheduler/funds/run',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          accountId: readString(recoveryTarget.accountId),
          brokerKey: readString(recoveryTarget.brokerKey),
        }),
      },
      adminToken
    );
    const recoveryData = asRecord(recoveryResponse.data);
    assert.equal(recoveryData.queued, true);
    assert.match(
      readString(recoveryData.message),
      /Scoped funds sync queued/,
      'scoped recovery run should confirm that only the selected account scope was queued'
    );
    scopedRecoverySnapshot = {
      accountId: readNullableString(recoveryTarget.accountId),
      brokerKey: readNullableString(recoveryTarget.brokerKey),
      runId: readNullableString(recoveryData.runId),
      jobId: readNullableString(recoveryData.jobId),
      message: readNullableString(recoveryData.message),
    };
  }

  const queueStartedAt = Date.now();
  const queueResponse = await requestJson('/health/queue', {}, adminToken);
  const queueDurationMs = Date.now() - queueStartedAt;
  const queueData = asRecord(queueResponse.data);

  const workerStartedAt = Date.now();
  const workerResponse = await requestJson('/health/worker', {}, adminToken);
  const workerDurationMs = Date.now() - workerStartedAt;
  const workerData = asRecord(workerResponse.data);

  let productSnapshot: JsonRecord | null = null;
  if (RUN_PRODUCT_DESK_CHECKS) {
    const userToken =
      USER_EMAIL === ADMIN_EMAIL && USER_PASSWORD === ADMIN_PASSWORD
        ? adminToken
        : await login(USER_EMAIL, USER_PASSWORD);

    const snapshotsStartedAt = Date.now();
    const snapshotsResponse = await requestJson('/funds-snapshots?limit=20&offset=0', {}, userToken);
    const snapshotsDurationMs = Date.now() - snapshotsStartedAt;
    const snapshotsData = asRecord(snapshotsResponse.data);
    const snapshotItems = readArray(snapshotsData.items).map(asRecord);

    const latestSnapshotResponse = await requestJson('/funds-snapshots/latest', {}, userToken);
    const latestSnapshotData = asRecord(latestSnapshotResponse.data);

    const walletActiveStartedAt = Date.now();
    const walletActiveResponse = await requestJson('/wallet/funds/active', {}, userToken);
    const walletActiveDurationMs = Date.now() - walletActiveStartedAt;
    const walletActiveData = asRecord(walletActiveResponse.data);
    const walletActiveItems = readArray(walletActiveData.items).map(asRecord);

    const futuresActiveStartedAt = Date.now();
    const futuresActiveResponse = await requestJson('/wallet/futures/funds/active', {}, userToken);
    const futuresActiveDurationMs = Date.now() - futuresActiveStartedAt;
    const futuresActiveData = asRecord(futuresActiveResponse.data);
    const futuresActiveItems = readArray(futuresActiveData.items).map(asRecord);

    assert.equal(
      readNumber(walletActiveData.successCount) + readNumber(walletActiveData.failureCount),
      readNumber(walletActiveData.totalActiveAccounts),
      'wallet active funds summary must balance successCount and failureCount'
    );
    assert.equal(
      readNumber(futuresActiveData.successCount) + readNumber(futuresActiveData.failureCount),
      readNumber(futuresActiveData.totalActiveAccounts),
      'futures active funds summary must balance successCount and failureCount'
    );
    assert.ok(
      readNumber(walletActiveData.totalActiveAccounts) <= totalConnectedAccounts,
      'wallet active account count should not exceed scheduler coverage total'
    );
    assert.ok(
      readNumber(futuresActiveData.totalActiveAccounts) <= totalConnectedAccounts,
      'futures active account count should not exceed scheduler coverage total'
    );
    if (snapshotItems.length > 0) {
      assert.ok(
        readNullableString(snapshotItems[0].snapshot_date),
        'funds snapshots list items should expose snapshot_date'
      );
      assert.ok(
        readNullableString(snapshotItems[0].fetch_status),
        'funds snapshots list items should expose fetch_status'
      );
    }

    productSnapshot = {
      latestSnapshotId: readNullableString(latestSnapshotData.id),
      latestSnapshotDate: readNullableString(latestSnapshotData.snapshot_date),
      latestObservedAt: readNullableString(latestSnapshotData.observed_at),
      snapshotsCount: readNumber(snapshotsData.total),
      walletActiveAccounts: readNumber(walletActiveData.totalActiveAccounts),
      walletActiveSuccessCount: readNumber(walletActiveData.successCount),
      futuresActiveAccounts: readNumber(futuresActiveData.totalActiveAccounts),
      futuresActiveSuccessCount: readNumber(futuresActiveData.successCount),
      firstWalletAccountObservedAt:
        walletActiveItems.length > 0 ? readNullableString(walletActiveItems[0].observedAt) : null,
      firstFuturesAccountObservedAt:
        futuresActiveItems.length > 0
          ? readNullableString(futuresActiveItems[0].observedAt)
          : null,
      snapshotsDurationMs,
      walletActiveDurationMs,
      futuresActiveDurationMs,
    };

    assertMaxDuration('funds snapshots list', snapshotsDurationMs, MAX_SNAPSHOTS_MS);
    assertMaxDuration('wallet active funds', walletActiveDurationMs, MAX_WALLET_ACTIVE_MS);
    assertMaxDuration('futures active funds', futuresActiveDurationMs, MAX_FUTURES_ACTIVE_MS);
  }

  assertMaxDuration('funds scheduler config', configDurationMs, MAX_CONFIG_MS);
  assertMaxDuration('funds scheduler summary', summaryDurationMs, MAX_SUMMARY_MS);
  assertMaxDuration('funds scheduler coverage', coverageDurationMs, MAX_COVERAGE_MS);
  assertMaxDuration('funds scheduler runs', runsDurationMs, MAX_RUNS_MS);
  assertMaxDuration('scheduler queue health', queueDurationMs, MAX_QUEUE_MS);
  assertMaxDuration('scheduler worker health', workerDurationMs, MAX_WORKER_MS);

  assertOptionalCeiling(
    'accountsWithStaleSnapshot',
    accountsWithStaleSnapshot,
    thresholds.maxStaleAccounts
  );
  assertOptionalCeiling(
    'accountsMissingSnapshot',
    accountsMissingSnapshot,
    thresholds.maxMissingAccounts
  );
  assertOptionalCeiling(
    'accountsWithFailedLatestAttempt',
    accountsWithFailedLatestAttempt,
    thresholds.maxFailedLatestAttempts
  );
  if (totalConnectedAccounts > 0) {
    assertOptionalCeiling(
      'latestObservedSnapshotAgeMinutes',
      readNumber(summaryData.latestObservedSnapshotAgeMinutes),
      thresholds.maxLatestSnapshotAgeMinutes
    );
    assertOptionalCeiling(
      'latestAttemptAgeMinutes',
      readNumber(summaryData.latestAttemptAgeMinutes),
      thresholds.maxLatestAttemptAgeMinutes
    );
  }

  const summary: FundsSchedulerHealthSnapshot = {
    baseUrl: BASE_URL,
    configDurationMs,
    summaryDurationMs,
    coverageDurationMs,
    runsDurationMs,
    queueDurationMs,
    workerDurationMs,
    scheduler: {
      key: readNullableString(configData.key),
      schedulerType: readNullableString(configData.schedulerType),
      enabled: configData.enabled === true,
      timezone: readNullableString(summaryData.timezone),
      localDate: readNullableString(summaryData.localDate),
      totalConnectedAccounts,
      accountsWithFreshSnapshot,
      accountsWithStaleSnapshot,
      accountsMissingSnapshot,
      accountsWithFailedLatestAttempt,
      accountsWithSuccessfulLatestAttempt,
      latestObservedSnapshotAt: toIsoString(summaryData.latestObservedSnapshotAt),
      latestObservedSnapshotAgeMinutes: readNumber(summaryData.latestObservedSnapshotAgeMinutes),
      latestAttemptAt: toIsoString(summaryData.latestAttemptAt),
      latestAttemptAgeMinutes: readNumber(summaryData.latestAttemptAgeMinutes),
      runtimeFoundation: {
        status: readNullableString(runtimeFoundation.status),
        migrationName: readNullableString(runtimeFoundation.migrationName),
      },
      recoveryRunSupported: summaryData.recoveryRunSupported === true,
      recoveryRunScope: readNullableString(summaryData.recoveryRunScope),
      lastSuccessfulRun: {
        id: readNullableString(lastSuccessfulRun.id),
        status: readNullableString(lastSuccessfulRun.status),
        targetedAccounts: readNumber(lastSuccessfulRun.targetedAccounts),
        refreshedAccounts: readNumber(lastSuccessfulRun.refreshedAccounts),
        failedAccounts: readNumber(lastSuccessfulRun.failedAccounts),
      },
    },
    firstCoverageItem:
      coverageItems.length > 0
        ? {
            accountId: readNullableString(firstCoverageItem.accountId),
            brokerKey: readNullableString(firstCoverageItem.brokerKey),
            freshnessState: readNullableString(firstCoverageItem.freshnessState),
            latestFetchStatus: readNullableString(firstCoverageItem.latestFetchStatus),
            latestObservedAt: toIsoString(firstCoverageItem.latestObservedAt),
            latestAttemptAt: toIsoString(firstCoverageItem.latestAttemptAt),
            needsAttention: firstCoverageItem.needsAttention === true,
          }
        : null,
    worker: {
      queueStatus: readNullableString(queueData.status),
      workerStatus: readNullableString(workerData.status),
    },
    thresholds: {
      ...thresholds,
    },
    thresholdProfile: buildThresholdProfile(thresholds),
    scopedRecovery: scopedRecoverySnapshot,
    productSnapshot,
  };

  await persistSummary(summary);
  console.log('funds-scheduler-health:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
