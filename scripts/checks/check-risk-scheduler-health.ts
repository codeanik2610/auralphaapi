import assert from 'node:assert/strict';

import { env } from '../../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const ADMIN_EMAIL = String(
  process.env.RISK_SCHEDULER_ADMIN_EMAIL ||
    process.env.SMOKE_LOGIN_EMAIL ||
    process.env.AUTH_SEED_EMAIL ||
    env.auth.seedEmail
).trim();
const ADMIN_PASSWORD = String(
  process.env.RISK_SCHEDULER_ADMIN_PASSWORD ||
    process.env.SMOKE_LOGIN_PASSWORD ||
    process.env.AUTH_SEED_PASSWORD ||
    env.auth.seedPassword
).trim();
const USER_EMAIL = String(process.env.RISK_SCHEDULER_USER_EMAIL || ADMIN_EMAIL).trim();
const USER_PASSWORD = String(process.env.RISK_SCHEDULER_USER_PASSWORD || ADMIN_PASSWORD).trim();
const RUN_PRODUCT_DESK_CHECKS =
  String(process.env.RISK_SCHEDULER_RUN_PRODUCT_DESK_CHECKS || 'true')
    .trim()
    .toLowerCase() !== 'false';
const TRIGGER_PRODUCT_RECOMPUTE =
  String(process.env.RISK_SCHEDULER_TRIGGER_PRODUCT_RECOMPUTE || 'false')
    .trim()
    .toLowerCase() === 'true';
const MAX_CONFIG_MS = Math.max(0, Number(process.env.RISK_SCHEDULER_MAX_CONFIG_MS || 1500));
const MAX_SUMMARY_MS = Math.max(0, Number(process.env.RISK_SCHEDULER_MAX_SUMMARY_MS || 1500));
const MAX_RUNS_MS = Math.max(0, Number(process.env.RISK_SCHEDULER_MAX_RUNS_MS || 1500));
const MAX_QUEUE_MS = Math.max(0, Number(process.env.RISK_SCHEDULER_MAX_QUEUE_MS || 1500));
const MAX_WORKER_MS = Math.max(0, Number(process.env.RISK_SCHEDULER_MAX_WORKER_MS || 1500));
const MAX_PRODUCT_OVERVIEW_MS = Math.max(
  0,
  Number(process.env.RISK_SCHEDULER_MAX_PRODUCT_OVERVIEW_MS || 1800)
);
const MAX_PRODUCT_RECOMPUTE_MS = Math.max(
  0,
  Number(process.env.RISK_SCHEDULER_MAX_PRODUCT_RECOMPUTE_MS || 4000)
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

function readNullableString(value: unknown): string | null {
  const normalized = readString(value);
  return normalized || null;
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return readString(value).toLowerCase() === 'true';
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
  assert.ok(email && password, 'risk scheduler health checks require login credentials');
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

async function run(): Promise<void> {
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const adminMe = await requestJson('/auth/me', {}, adminToken);
  assert.equal(
    readString(asRecord(adminMe.data).role).toLowerCase(),
    'admin',
    'risk scheduler health checks require an admin login'
  );

  const configStartedAt = Date.now();
  const configResponse = await requestJson('/scheduler/risk/config', {}, adminToken);
  const configDurationMs = Date.now() - configStartedAt;
  const configData = asRecord(configResponse.data);
  const configSources = readArray(configData.sources).map(readString).filter(Boolean);
  const configTime = assertTimeContract('risk scheduler config', configData.time);
  assert.equal(readString(configData.key), 'risk-recompute-sync');
  assert.equal(readString(configData.schedulerType), 'user');
  assert.deepEqual(configSources, ['risk']);

  const summaryStartedAt = Date.now();
  const summaryResponse = await requestJson('/scheduler/risk/summary', {}, adminToken);
  const summaryDurationMs = Date.now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);
  const blockers = readArray(summaryData.blockers).map(asRecord);
  const latestRun = asRecord(summaryData.latestRun);
  const latestRunInitiatedBy = asRecord(latestRun.initiatedBy);
  const summaryTime = assertTimeContract('risk scheduler summary', summaryData.time);
  assert.equal(readString(summaryData.schedulerKey), 'risk-recompute-sync');
  assert.ok('usersTargeted' in summaryData, 'risk scheduler summary must expose usersTargeted');
  assert.ok(
    'usersWithFreshSnapshot' in summaryData,
    'risk scheduler summary must expose usersWithFreshSnapshot'
  );
  assert.ok(
    'usersMissingSnapshot' in summaryData,
    'risk scheduler summary must expose usersMissingSnapshot'
  );
  assert.ok(
    'usersWithSourceBlockers' in summaryData,
    'risk scheduler summary must expose usersWithSourceBlockers'
  );
  blockers.forEach((item) => {
    assert.ok(readString(item.blocker), 'risk scheduler blockers must expose blocker code');
    assert.ok(readString(item.label), 'risk scheduler blockers must expose blocker label');
    assert.ok(
      Number.isFinite(readNumber(item.count)),
      'risk scheduler blockers must expose numeric counts'
    );
  });
  if (readString(latestRun.id)) {
    assert.ok(
      Number.isFinite(readNumber(latestRun.targetedUsers)),
      'latest risk scheduler run must expose targetedUsers'
    );
    assert.ok(
      Number.isFinite(readNumber(latestRun.refreshedUsers)),
      'latest risk scheduler run must expose refreshedUsers'
    );
    assert.ok(
      Number.isFinite(readNumber(latestRun.failedUsers)),
      'latest risk scheduler run must expose failedUsers'
    );
    if (Object.keys(latestRunInitiatedBy).length > 0) {
      assert.ok(
        readString(latestRunInitiatedBy.type),
        'latest risk scheduler run initiatedBy must expose type when present'
      );
    }
    if (readNullableString(latestRun.startedAt)) {
      assert.ok(
        readNullableString(latestRun.startedAtIso),
        'latest risk scheduler run startedAtIso must stay available when startedAt is present'
      );
    }
    if (readNullableString(latestRun.finishedAt)) {
      assert.ok(
        readNullableString(latestRun.finishedAtIso),
        'latest risk scheduler run finishedAtIso must stay available when finishedAt is present'
      );
    }
  }
  if (readNullableString(summaryData.latestSnapshotAt)) {
    assert.ok(
      readNullableString(summaryData.latestSnapshotAtIso),
      'risk scheduler summary latestSnapshotAtIso must stay available when latestSnapshotAt is present'
    );
  }
  if (readNullableString(summaryData.latestControlAt)) {
    assert.ok(
      readNullableString(summaryData.latestControlAtIso),
      'risk scheduler summary latestControlAtIso must stay available when latestControlAt is present'
    );
  }
  if (readNullableString(summaryData.latestAlertAt)) {
    assert.ok(
      readNullableString(summaryData.latestAlertAtIso),
      'risk scheduler summary latestAlertAtIso must stay available when latestAlertAt is present'
    );
  }
  if (readNullableString(summaryData.latestScenarioAt)) {
    assert.ok(
      readNullableString(summaryData.latestScenarioAtIso),
      'risk scheduler summary latestScenarioAtIso must stay available when latestScenarioAt is present'
    );
  }

  const runsStartedAt = Date.now();
  const runsResponse = await requestJson('/scheduler/risk/runs?limit=5&offset=0', {}, adminToken);
  const runsDurationMs = Date.now() - runsStartedAt;
  const runsData = asRecord(runsResponse.data);
  const runsTime = assertTimeContract('risk scheduler runs', runsData.time);
  const runItems = readArray(runsData.items).map(asRecord);
  assert.ok(Array.isArray(runItems), 'risk scheduler runs must return an items array');

  const queueStartedAt = Date.now();
  const queueResponse = await requestJson('/health/queue', {}, adminToken);
  const queueDurationMs = Date.now() - queueStartedAt;
  const queueData = asRecord(queueResponse.data);

  const workerStartedAt = Date.now();
  const workerResponse = await requestJson('/health/worker', {}, adminToken);
  const workerDurationMs = Date.now() - workerStartedAt;
  const workerData = asRecord(workerResponse.data);

  let productOverviewDurationMs: number | null = null;
  let productFreshnessState: string | null = null;
  let productRecomputeDurationMs: number | null = null;
  let productRecomputeSnapshotId: string | null = null;

  if (RUN_PRODUCT_DESK_CHECKS) {
    const userToken =
      USER_EMAIL === ADMIN_EMAIL && USER_PASSWORD === ADMIN_PASSWORD
        ? adminToken
        : await login(USER_EMAIL, USER_PASSWORD);

    const productOverviewStartedAt = Date.now();
    const productOverviewResponse = await requestJson(
      '/risk/overview?controlsLimit=10&alertsLimit=10&scenariosLimit=10',
      {},
      userToken
    );
    productOverviewDurationMs = Date.now() - productOverviewStartedAt;
    const overviewData = asRecord(productOverviewResponse.data);
    const overviewMeta = asRecord(overviewData.meta);
    const overviewCapabilities = asRecord(overviewMeta.capabilities);
    const overviewFreshness = asRecord(overviewMeta.freshness);
    const overviewLineage = asRecord(overviewMeta.lineage);
    const recomputeWrites = readArray(overviewLineage.recomputeWrites).map(readString);
    productFreshnessState = readNullableString(overviewFreshness.state);

    assert.equal(
      overviewCapabilities.recomputeExecutesRealCalculation,
      true,
      'risk overview must advertise real recompute execution'
    );
    assert.ok(productFreshnessState, 'risk overview must expose freshness.state');
    assert.ok(
      recomputeWrites.includes('risk_snapshots'),
      'risk overview lineage must expose risk_snapshots writes'
    );
    assert.ok(
      recomputeWrites.includes('risk_controls'),
      'risk overview lineage must expose risk_controls writes'
    );
    assert.ok(
      recomputeWrites.includes('risk_alerts'),
      'risk overview lineage must expose risk_alerts writes'
    );
    assert.ok(
      recomputeWrites.includes('risk_scenarios'),
      'risk overview lineage must expose risk_scenarios writes'
    );

    if (TRIGGER_PRODUCT_RECOMPUTE) {
      const productRecomputeStartedAt = Date.now();
      const productRecomputeResponse = await requestJson(
        '/risk/recompute',
        {
          method: 'POST',
        },
        userToken
      );
      productRecomputeDurationMs = Date.now() - productRecomputeStartedAt;
      const recomputeData = asRecord(productRecomputeResponse.data);
      productRecomputeSnapshotId = readNullableString(recomputeData.snapshotId);

      assert.equal(
        readString(recomputeData.message),
        'Risk snapshot recomputed',
        'risk recompute should return the recomputed message'
      );
      assert.ok(productRecomputeSnapshotId, 'risk recompute should return a snapshotId');
      assert.ok(
        readNullableString(recomputeData.computedAt),
        'risk recompute should return computedAt'
      );
      assert.ok(
        Number.isFinite(readNumber(recomputeData.controlsCreated)),
        'risk recompute should report controlsCreated'
      );
      assert.ok(
        Number.isFinite(readNumber(recomputeData.alertsCreated)),
        'risk recompute should report alertsCreated'
      );
      assert.ok(
        Number.isFinite(readNumber(recomputeData.scenariosCreated)),
        'risk recompute should report scenariosCreated'
      );
    }
  }

  assertMaxDuration('risk scheduler config', configDurationMs, MAX_CONFIG_MS);
  assertMaxDuration('risk scheduler summary', summaryDurationMs, MAX_SUMMARY_MS);
  assertMaxDuration('risk scheduler runs', runsDurationMs, MAX_RUNS_MS);
  assertMaxDuration('scheduler queue health', queueDurationMs, MAX_QUEUE_MS);
  assertMaxDuration('scheduler worker health', workerDurationMs, MAX_WORKER_MS);
  if (productOverviewDurationMs !== null) {
    assertMaxDuration(
      'risk center overview',
      productOverviewDurationMs,
      MAX_PRODUCT_OVERVIEW_MS
    );
  }
  if (productRecomputeDurationMs !== null) {
    assertMaxDuration(
      'risk center recompute',
      productRecomputeDurationMs,
      MAX_PRODUCT_RECOMPUTE_MS
    );
  }

  console.log(
    'risk-scheduler-health:',
    JSON.stringify({
      baseUrl: BASE_URL,
      configDurationMs,
      summaryDurationMs,
      runsDurationMs,
      queueDurationMs,
      workerDurationMs,
      scheduler: {
        key: readNullableString(configData.key),
        schedulerType: readNullableString(configData.schedulerType),
        enabled: configData.enabled === true,
        configDisplayTimeZone: readNullableString(configTime.displayTimeZone),
        summaryDisplayTimeZone: readNullableString(summaryTime.displayTimeZone),
        runsDisplayTimeZone: readNullableString(runsTime.displayTimeZone),
        usersTargeted: readNumber(summaryData.usersTargeted),
        usersWithFreshSnapshot: readNumber(summaryData.usersWithFreshSnapshot),
        usersMissingSnapshot: readNumber(summaryData.usersMissingSnapshot),
        usersWithSourceBlockers: readNumber(summaryData.usersWithSourceBlockers),
        latestSnapshotAt: readNullableString(summaryData.latestSnapshotAt),
        latestSnapshotAtIso: readNullableString(summaryData.latestSnapshotAtIso),
        latestControlAt: readNullableString(summaryData.latestControlAt),
        latestControlAtIso: readNullableString(summaryData.latestControlAtIso),
        latestAlertAt: readNullableString(summaryData.latestAlertAt),
        latestAlertAtIso: readNullableString(summaryData.latestAlertAtIso),
        latestScenarioAt: readNullableString(summaryData.latestScenarioAt),
        latestScenarioAtIso: readNullableString(summaryData.latestScenarioAtIso),
        latestRun: {
          id: readNullableString(latestRun.id),
          status: readNullableString(latestRun.status),
          initiatedBy: {
            type: readNullableString(latestRunInitiatedBy.type),
            userId: readNullableString(latestRunInitiatedBy.userId),
            label: readNullableString(latestRunInitiatedBy.label),
          },
          executionContext: readNullableString(latestRun.executionContext),
          startedAt: readNullableString(latestRun.startedAt),
          startedAtIso: readNullableString(latestRun.startedAtIso),
          finishedAt: readNullableString(latestRun.finishedAt),
          finishedAtIso: readNullableString(latestRun.finishedAtIso),
          targetedUsers: readNumber(latestRun.targetedUsers),
          refreshedUsers: readNumber(latestRun.refreshedUsers),
          failedUsers: readNumber(latestRun.failedUsers),
        },
        blockers: blockers.map((item) => ({
          blocker: readNullableString(item.blocker),
          label: readNullableString(item.label),
          count: readNumber(item.count),
        })),
      },
      worker: {
        queueStatus: readNullableString(queueData.status),
        workerStatus: readNullableString(workerData.status),
      },
      productDesk: RUN_PRODUCT_DESK_CHECKS
        ? {
            freshnessState: productFreshnessState,
            overviewDurationMs: productOverviewDurationMs,
            recomputeDurationMs: productRecomputeDurationMs,
            recomputeSnapshotId: productRecomputeSnapshotId,
          }
        : null,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
