import assert from 'node:assert/strict';
import { env } from '../src/env';

type JsonRecord = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.SMOKE_BASE_URL || `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const LOGIN_EMAIL =
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || 'admin@auralpha.com';
const LOGIN_PASSWORD =
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || 'Admin@123';

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function asArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  );
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

async function requestJson(
  pathName: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${BASE_URL}${pathName}`, {
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
    throw new Error(
      `${init.method || 'GET'} ${pathName} -> HTTP ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return payload;
}

async function login(): Promise<string> {
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
  const data = asRecord(response.data);
  const accessToken = readString(data.accessToken);
  assert.ok(accessToken, 'login should return an access token');
  return accessToken;
}

async function run(): Promise<void> {
  const accessToken = await login();
  const response = await requestJson('/health/discovery', {}, accessToken);
  const data = asRecord(response.data);

  assert.equal(readString(data.status), 'ok');
  assert.ok(readString(data.baseUrl), 'discovery dependency health should expose the base URL');

  const service = asRecord(data.service);
  const readiness = asRecord(data.readiness);
  const auth = asRecord(data.auth);
  const contract = asRecord(data.contract);
  const endpoints = asArray(data.endpoints);

  assert.equal(readString(service.status), 'ok');
  assert.equal(readString(readiness.status), 'ok');
  assert.equal(readString(auth.status), 'ok');
  assert.equal(readString(contract.status), 'ok');
  assert.ok(Array.isArray(contract.checkedEndpoints), 'contract should expose checked endpoint keys');
  assert.equal(endpoints.length >= 8, true);
  const endpointKeys = endpoints.map((item) => readString(item.key));
  const requiredEndpointKeys = [
    'bots',
    'runs',
    'strategies',
    'template-suggestions',
    'preferences',
    'bot-detail',
    'run-detail',
    'strategy-detail',
  ];
  assert.equal(
    requiredEndpointKeys.every((key) => endpointKeys.includes(key)),
    true,
    'every direct and sampled discovery dependency endpoint probe should be present'
  );
  assert.equal(
    endpoints.every((item) => readString(item.status) === 'ok'),
    true,
    'every discovery dependency endpoint probe should be healthy'
  );

  const readinessDependencies = asRecord(readiness.dependencies);
  assert.equal(readString(asRecord(readinessDependencies.postgres).status), 'ok');
  assert.equal(readString(asRecord(readinessDependencies.mysql).status), 'ok');
  assert.equal(readString(asRecord(readinessDependencies.redis).status), 'ok');

  console.log(
    'discovery-dependency-smoke:',
    JSON.stringify({
      baseUrl: readString(data.baseUrl),
      checkedAt: readString(data.checkedAt),
      checkedEndpoints: contract.checkedEndpoints,
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
