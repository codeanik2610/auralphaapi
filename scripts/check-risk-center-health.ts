import assert from 'node:assert/strict';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || '').trim();
const LOGIN_EMAIL = String(
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || env.auth.seedPassword
).trim();
const MAX_OVERVIEW_MS = Math.max(
  0,
  Number(process.env.RISK_CENTER_MAX_OVERVIEW_MS || 1800)
);
const MAX_ALERTS_MS = Math.max(
  0,
  Number(process.env.RISK_CENTER_MAX_ALERTS_MS || 1200)
);
const MAX_TOTAL_MS = Math.max(
  0,
  Number(process.env.RISK_CENTER_MAX_TOTAL_MS || 2500)
);
const MIN_POLICY_COUNT = Math.max(
  0,
  Number(process.env.RISK_CENTER_MIN_POLICY_COUNT || 0)
);
const MIN_BROKER_COUNT = Math.max(
  0,
  Number(process.env.RISK_CENTER_MIN_BROKER_COUNT || 0)
);
const REQUIRE_POLICY_ROLLBACK =
  String(process.env.RISK_CENTER_REQUIRE_POLICY_ROLLBACK || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_DAILY_WINDOW_AVAILABLE =
  String(process.env.RISK_CENTER_REQUIRE_DAILY_WINDOW_AVAILABLE || 'false')
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

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  } else if (API_KEY) {
    headers.set('x-api-key', API_KEY);
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
  path: string,
  accessToken: string
): Promise<{ payload: JsonRecord; durationMs: number }> {
  const startedAt = Date.now();
  const payload = await requestJson(path, {}, accessToken);
  return {
    payload,
    durationMs: Date.now() - startedAt,
  };
}

async function run(): Promise<void> {
  const accessToken = await loginIfPossible();
  assert.ok(
    accessToken || API_KEY,
    'Either admin login credentials or APP_API_KEY/API_KEY is required to poll /risk/overview'
  );

  const [overviewResponse, alertsResponse] = await Promise.all([
    timedRequest('/risk/overview?controlsLimit=10&alertsLimit=10&scenariosLimit=10', accessToken),
    timedRequest('/risk/alerts/overview?limit=10&offset=0&status=Open&scope=Risk', accessToken),
  ]);

  const totalMs = overviewResponse.durationMs + alertsResponse.durationMs;
  const overviewData = asRecord(overviewResponse.payload.data);
  const alertsData = asRecord(alertsResponse.payload.data);
  const overviewMeta = asRecord(overviewData.meta);
  const overviewCapabilities = asRecord(overviewMeta.capabilities);
  const brokers = asRecord(overviewData.brokers);
  const alertsMeta = asRecord(alertsData.meta);
  const alertsSummary = asRecord(alertsData.summary);
  const policies = asRecord(overviewData.policies);
  const brokerItems = readArray(brokers.items);
  const riskWindows = readArray(overviewData.riskWindows);
  const dailyWindow = asRecord(
    riskWindows.find((item) => readString(asRecord(item).key) === 'daily')
  );
  const weeklyWindow = asRecord(
    riskWindows.find((item) => readString(asRecord(item).key) === 'weekly')
  );
  const monthlyWindow = asRecord(
    riskWindows.find((item) => readString(asRecord(item).key) === 'monthly')
  );

  const snapshot = {
    baseUrl: BASE_URL,
    overviewContractVersion: readString(overviewMeta.contractVersion) || null,
    alertsContractVersion: readString(alertsMeta.contractVersion) || null,
    overviewPurpose: readString(overviewMeta.purpose) || null,
    alertsPurpose: readString(alertsMeta.purpose) || null,
    generatedAt: readString(overviewMeta.generatedAt) || null,
    overviewLatencyMs: overviewResponse.durationMs,
    alertsLatencyMs: alertsResponse.durationMs,
    totalMs,
    policyWritesEnabled: overviewCapabilities.policyWrites === true,
    policyRollbackEnabled: overviewCapabilities.policyRollback === true,
    snapshotBrokerKpisEnabled: overviewCapabilities.snapshotBrokerKpis === true,
    liveBrokerKpisEnabled: overviewCapabilities.liveBrokerKpis === true,
    weeklyMonthlyRiskWindowUsageEnabled:
      overviewCapabilities.weeklyMonthlyRiskWindowUsage === true,
    policyCount: readNumber(policies.total),
    brokerCount: brokerItems.length,
    coveredBrokerCount: brokerItems.filter(
      (item) => readString(asRecord(item).snapshotAvailability) === 'snapshot'
    ).length,
    partialBrokerCount: brokerItems.filter(
      (item) => readString(asRecord(item).snapshotAvailability) === 'partial'
    ).length,
    unavailableBrokerCount: brokerItems.filter(
      (item) => readString(asRecord(item).snapshotAvailability) === 'unavailable'
    ).length,
    dailyWindowAvailability: readString(dailyWindow.availability) || 'missing',
    weeklyWindowAvailability: readString(weeklyWindow.availability) || 'missing',
    monthlyWindowAvailability: readString(monthlyWindow.availability) || 'missing',
    dailyWindowUsedPct: readNullableNumber(dailyWindow.usedPct),
    alertTotal: readNumber(asRecord(alertsData.alerts).total),
    openAlertCount: readNumber(asRecord(alertsSummary.byStatus).Open),
  };

  console.log('risk-center-health-check:', JSON.stringify(snapshot));

  assert.equal(
    snapshot.overviewPurpose,
    'operator_risk_workspace',
    'risk overview purpose must remain operator_risk_workspace'
  );
  assert.equal(
    snapshot.alertsPurpose,
    'risk_alerts_digest_for_risk_center',
    'risk alerts overview purpose must remain risk_alerts_digest_for_risk_center'
  );
  assert.equal(snapshot.policyWritesEnabled, true, 'risk-center policy writes must stay enabled');
  assert.equal(
    snapshot.snapshotBrokerKpisEnabled,
    true,
    'risk-center must continue to advertise snapshot-backed broker KPIs'
  );
  assert.equal(
    snapshot.liveBrokerKpisEnabled,
    false,
    'risk-center must not claim live broker KPIs in the current contract'
  );
  assert.equal(
    snapshot.weeklyMonthlyRiskWindowUsageEnabled,
    false,
    'risk-center must continue to mark weekly/monthly usage as unavailable until persisted'
  );

  if (REQUIRE_POLICY_ROLLBACK) {
    assert.equal(
      snapshot.policyRollbackEnabled,
      true,
      'risk-center policy rollback must remain enabled'
    );
  }

  assert.notEqual(snapshot.dailyWindowAvailability, 'missing', 'daily risk window is required');
  assert.notEqual(snapshot.weeklyWindowAvailability, 'missing', 'weekly risk window is required');
  assert.notEqual(snapshot.monthlyWindowAvailability, 'missing', 'monthly risk window is required');

  if (REQUIRE_DAILY_WINDOW_AVAILABLE) {
    assert.equal(
      snapshot.dailyWindowAvailability,
      'snapshot',
      'daily risk window must be snapshot-backed when RISK_CENTER_REQUIRE_DAILY_WINDOW_AVAILABLE is true'
    );
  }

  if (snapshot.policyCount < MIN_POLICY_COUNT) {
    throw new Error(
      `risk-center policy count ${snapshot.policyCount} is below ${MIN_POLICY_COUNT}`
    );
  }
  if (snapshot.brokerCount < MIN_BROKER_COUNT) {
    throw new Error(
      `risk-center broker count ${snapshot.brokerCount} is below ${MIN_BROKER_COUNT}`
    );
  }
  if (snapshot.overviewLatencyMs > MAX_OVERVIEW_MS) {
    throw new Error(
      `risk-center overview latency ${snapshot.overviewLatencyMs}ms exceeds ${MAX_OVERVIEW_MS}ms`
    );
  }
  if (snapshot.alertsLatencyMs > MAX_ALERTS_MS) {
    throw new Error(
      `risk-center alerts latency ${snapshot.alertsLatencyMs}ms exceeds ${MAX_ALERTS_MS}ms`
    );
  }
  if (snapshot.totalMs > MAX_TOTAL_MS) {
    throw new Error(
      `risk-center combined latency ${snapshot.totalMs}ms exceeds ${MAX_TOTAL_MS}ms`
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
