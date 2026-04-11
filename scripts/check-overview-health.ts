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
const SELECTED_SYMBOL = String(process.env.OVERVIEW_HEALTH_SELECTED_SYMBOL || 'BTCUSDT')
  .trim()
  .toUpperCase();
const MAX_TOTAL_MS = Math.max(0, Number(process.env.OVERVIEW_MAX_TOTAL_MS || 1500));
const MAX_DEGRADED_SECTION_COUNT = Math.max(
  0,
  Number(process.env.OVERVIEW_MAX_DEGRADED_SECTION_COUNT || 0)
);
const MAX_TIMEOUT_SECTION_COUNT = Math.max(
  0,
  Number(process.env.OVERVIEW_MAX_TIMEOUT_SECTION_COUNT || 0)
);
const MAX_STALE_SECTION_COUNT = Math.max(
  0,
  Number(process.env.OVERVIEW_MAX_STALE_SECTION_COUNT || 0)
);
const MAX_CRITICAL_SECTION_COUNT = Math.max(
  0,
  Number(process.env.OVERVIEW_MAX_CRITICAL_SECTION_COUNT || 0)
);
const MAX_WARNING_COUNT = Math.max(0, Number(process.env.OVERVIEW_MAX_WARNING_COUNT || 0));
const REQUIRE_SELECTED_SYMBOL_RESOLVED =
  String(process.env.OVERVIEW_REQUIRE_SELECTED_SYMBOL_RESOLVED || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_MARKETS_AVAILABLE =
  String(process.env.OVERVIEW_REQUIRE_MARKETS_AVAILABLE || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_SELECTED_ASSET_AVAILABLE =
  String(process.env.OVERVIEW_REQUIRE_SELECTED_ASSET_AVAILABLE || 'true')
    .trim()
    .toLowerCase() !== 'false';
const REQUIRE_CAPITAL_AVAILABLE =
  String(process.env.OVERVIEW_REQUIRE_CAPITAL_AVAILABLE || 'false')
    .trim()
    .toLowerCase() === 'true';
const REQUIRE_PORTFOLIO_AVAILABLE =
  String(process.env.OVERVIEW_REQUIRE_PORTFOLIO_AVAILABLE || 'false')
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

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readString(item)).filter(Boolean)
    : [];
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

async function run(): Promise<void> {
  const accessToken = await loginIfPossible();
  assert.ok(
    accessToken || API_KEY,
    'Either admin login credentials or APP_API_KEY/API_KEY is required to poll /overview'
  );

  const response = await requestJson(
    `/overview?selectedSymbol=${encodeURIComponent(SELECTED_SYMBOL)}`,
    {},
    accessToken
  );
  const data = asRecord(response.data);
  const meta = asRecord(data.meta);
  const resilience = asRecord(meta.resilience);
  const selection = asRecord(meta.selection);
  const routing = asRecord(meta.routing);
  const observability = asRecord(meta.observability);
  const sections = asRecord(meta.sections);
  const health = asRecord(data.health);
  const assetsSection = asRecord(sections.assets);
  const selectedAssetSection = asRecord(sections.selectedAsset);
  const walletFundsSection = asRecord(sections.walletFunds);
  const futuresFundsSection = asRecord(sections.futuresFunds);
  const portfolioHoldingsSection = asRecord(sections.portfolioHoldings);
  const warningSummaries = Array.isArray(meta.warnings)
    ? meta.warnings
        .map((warning) => readString(asRecord(warning).summary))
        .filter(Boolean)
    : [];
  const missingSections = Object.entries(sections)
    .filter(([, section]) => readString(asRecord(section).availability) === 'missing')
    .map(([key]) => key);

  const snapshot = {
    baseUrl: BASE_URL,
    requestedSymbol: SELECTED_SYMBOL,
    resolvedSymbol: readString(selection.resolvedSymbol) || null,
    selectionMode: readString(selection.mode) || null,
    healthStatus: readString(health.status || 'unknown'),
    resilienceStatus: readString(resilience.status || 'unknown'),
    routingResolution: readString(routing.resolution || 'unknown'),
    totalMs: readNumber(observability.totalMs),
    degradedSectionCount: readNumber(observability.degradedSectionCount),
    timeoutSectionCount: readNumber(observability.timeoutSectionCount),
    staleSectionCount: readNumber(observability.staleSectionCount),
    criticalSectionCount: readNumber(observability.criticalSectionCount),
    warningCount: readNumber(observability.warningCount),
    degradedSections: readStringArray(resilience.degradedSections),
    timeoutSections: readStringArray(resilience.timeoutSections),
    assetsAvailability: readString(assetsSection.availability || 'unknown'),
    selectedAssetAvailability: readString(
      selectedAssetSection.availability || 'unknown'
    ),
    walletFundsAvailability: readString(walletFundsSection.availability || 'unknown'),
    futuresFundsAvailability: readString(futuresFundsSection.availability || 'unknown'),
    portfolioAvailability: readString(
      portfolioHoldingsSection.availability || 'unknown'
    ),
    assetsCacheState: readString(asRecord(assetsSection.cache).state || 'unknown'),
    selectedAssetCacheState: readString(
      asRecord(selectedAssetSection.cache).state || 'unknown'
    ),
    warningSummaries,
    missingSections,
    summary: readString(observability.summary) || null,
  };

  console.log('overview-health-check:', JSON.stringify(snapshot));

  if (REQUIRE_SELECTED_SYMBOL_RESOLVED && snapshot.resolvedSymbol !== SELECTED_SYMBOL) {
    throw new Error(
      `overview resolved symbol ${snapshot.resolvedSymbol || 'none'} does not match ${SELECTED_SYMBOL}`
    );
  }
  if (REQUIRE_MARKETS_AVAILABLE && snapshot.assetsAvailability !== 'available') {
    throw new Error('overview market opportunities are unavailable');
  }
  if (
    REQUIRE_SELECTED_ASSET_AVAILABLE &&
    snapshot.selectedAssetAvailability !== 'available'
  ) {
    throw new Error('overview selected market detail is unavailable');
  }
  if (
    REQUIRE_CAPITAL_AVAILABLE &&
    (snapshot.walletFundsAvailability !== 'available' ||
      snapshot.futuresFundsAvailability !== 'available')
  ) {
    throw new Error('overview capital snapshots are unavailable');
  }
  if (REQUIRE_PORTFOLIO_AVAILABLE && snapshot.portfolioAvailability !== 'available') {
    throw new Error('overview portfolio snapshot is unavailable');
  }
  if (snapshot.totalMs > MAX_TOTAL_MS) {
    throw new Error(`overview latency ${snapshot.totalMs}ms exceeds ${MAX_TOTAL_MS}ms`);
  }
  if (snapshot.degradedSectionCount > MAX_DEGRADED_SECTION_COUNT) {
    throw new Error(
      `overview degraded sections ${snapshot.degradedSectionCount} exceeds ${MAX_DEGRADED_SECTION_COUNT}`
    );
  }
  if (snapshot.timeoutSectionCount > MAX_TIMEOUT_SECTION_COUNT) {
    throw new Error(
      `overview timeout sections ${snapshot.timeoutSectionCount} exceeds ${MAX_TIMEOUT_SECTION_COUNT}`
    );
  }
  if (snapshot.staleSectionCount > MAX_STALE_SECTION_COUNT) {
    throw new Error(
      `overview stale sections ${snapshot.staleSectionCount} exceeds ${MAX_STALE_SECTION_COUNT}`
    );
  }
  if (snapshot.criticalSectionCount > MAX_CRITICAL_SECTION_COUNT) {
    throw new Error(
      `overview critical sections ${snapshot.criticalSectionCount} exceeds ${MAX_CRITICAL_SECTION_COUNT}`
    );
  }
  if (snapshot.warningCount > MAX_WARNING_COUNT) {
    throw new Error(
      `overview warnings ${snapshot.warningCount} exceeds ${MAX_WARNING_COUNT}`
    );
  }

  assert.notEqual(
    readNullableNumber(observability.totalMs),
    null,
    'overview observability totalMs is required'
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
