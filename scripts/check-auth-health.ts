import assert from 'node:assert/strict';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || '').trim();
const LOGIN_EMAIL =
  String(process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || env.auth.seedEmail).trim();
const LOGIN_PASSWORD = String(
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || env.auth.seedPassword
).trim();
const REQUIRE_FAILURE_ALERTS_ENABLED =
  String(process.env.AUTH_REQUIRE_FAILURE_ALERTS_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_SEED_DISABLED =
  String(
    process.env.AUTH_REQUIRE_SEED_DISABLED ||
      (env.app.environment.toLowerCase() === 'localhost' ? 'false' : 'true')
  )
    .trim()
    .toLowerCase() === 'true';
const MAX_ACTIVE_PAIR_LOCKOUTS = Math.max(
  0,
  Number(process.env.AUTH_MAX_ACTIVE_PAIR_LOCKOUTS || 0)
);
const MAX_ACTIVE_IP_LOCKOUTS = Math.max(
  0,
  Number(process.env.AUTH_MAX_ACTIVE_IP_LOCKOUTS || 0)
);
const MAX_PAIR_FAILURES = Math.max(0, Number(process.env.AUTH_MAX_PAIR_FAILURES || 0));
const MAX_IP_FAILURES = Math.max(0, Number(process.env.AUTH_MAX_IP_FAILURES || 0));

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

function readBoolean(value: unknown): boolean {
  return value === true;
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  headers: Headers = new Headers()
): Promise<JsonRecord> {
  const requestHeaders = new Headers(headers);
  for (const [key, value] of new Headers(init.headers || {})) {
    requestHeaders.set(key, value);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: requestHeaders,
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

async function resolveAdminHeaders(): Promise<Headers> {
  const headers = new Headers();

  if (API_KEY) {
    headers.set('x-api-key', API_KEY);
    return headers;
  }

  assert.ok(
    LOGIN_EMAIL && LOGIN_PASSWORD,
    'Provide APP_API_KEY/API_KEY or SMOKE_LOGIN_EMAIL + SMOKE_LOGIN_PASSWORD to poll /health/auth'
  );

  const loginResponse = await requestJson('/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
    }),
  });
  const loginData = asRecord(loginResponse.data);
  const accessToken = readString(loginData.accessToken);
  assert.ok(accessToken, 'auth login should return an access token for /health/auth');
  headers.set('authorization', `Bearer ${accessToken}`);
  return headers;
}

async function run(): Promise<void> {
  const adminHeaders = await resolveAdminHeaders();
  const authHealthResponse = await requestJson('/health/auth', {}, adminHeaders);
  const opsHealthResponse = await requestJson('/health/ops');

  const health = asRecord(authHealthResponse.data);
  const protections = asRecord(health.protections);
  const tokenPolicy = asRecord(health.tokenPolicy);
  const throttling = asRecord(health.throttling);
  const ops = asRecord(opsHealthResponse.data);
  const opsConfig = asRecord(ops.config);

  const snapshot = {
    baseUrl: BASE_URL,
    status: readString(health.status || 'unknown'),
    detail: readString(health.detail) || null,
    loginProtectionEnabled: readBoolean(protections.loginProtectionEnabled),
    secureConfigValidated: readBoolean(protections.secureConfigValidated),
    seedEnabled: readBoolean(protections.seedEnabled),
    apiKeyRequired: readBoolean(protections.apiKeyRequired),
    accessTokenTtl: readString(tokenPolicy.accessTokenTtl),
    refreshTokenDays: readNumber(tokenPolicy.refreshTokenDays),
    activePairLockouts: readNumber(throttling.activePairLockouts),
    activeIpLockouts: readNumber(throttling.activeIpLockouts),
    pairFailuresInWindow: readNumber(throttling.pairFailuresInWindow),
    ipFailuresInWindow: readNumber(throttling.ipFailuresInWindow),
    trackedBuckets: readNumber(throttling.trackedBuckets),
    nextLockoutExpiresAt: readString(throttling.nextLockoutExpiresAt) || null,
    emitFailureAlerts: readBoolean(opsConfig.emitFailureAlerts),
  };

  console.log('auth-health-check:', JSON.stringify(snapshot));

  if (snapshot.status.toLowerCase() === 'down') {
    throw new Error(snapshot.detail || 'auth health is down');
  }
  if (!snapshot.loginProtectionEnabled) {
    throw new Error('login throttling must remain enabled');
  }
  if (!snapshot.secureConfigValidated) {
    throw new Error('auth secure config validation is failing');
  }
  if (REQUIRE_SEED_DISABLED && snapshot.seedEnabled) {
    throw new Error('auth seed user must be disabled for this environment');
  }
  if (REQUIRE_FAILURE_ALERTS_ENABLED && snapshot.emitFailureAlerts !== true) {
    throw new Error('observability failure alerts are disabled');
  }
  if (snapshot.activePairLockouts > MAX_ACTIVE_PAIR_LOCKOUTS) {
    throw new Error(
      `active pair lockouts ${snapshot.activePairLockouts} exceeds ${MAX_ACTIVE_PAIR_LOCKOUTS}`
    );
  }
  if (snapshot.activeIpLockouts > MAX_ACTIVE_IP_LOCKOUTS) {
    throw new Error(
      `active IP lockouts ${snapshot.activeIpLockouts} exceeds ${MAX_ACTIVE_IP_LOCKOUTS}`
    );
  }
  if (snapshot.pairFailuresInWindow > MAX_PAIR_FAILURES) {
    throw new Error(
      `pair failures in window ${snapshot.pairFailuresInWindow} exceeds ${MAX_PAIR_FAILURES}`
    );
  }
  if (snapshot.ipFailuresInWindow > MAX_IP_FAILURES) {
    throw new Error(
      `IP failures in window ${snapshot.ipFailuresInWindow} exceeds ${MAX_IP_FAILURES}`
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
