import assert from 'node:assert/strict';
import {
  API_KEY,
  asArray,
  asRecord,
  BASE_URL,
  login,
  persistJson,
  readNumber,
  readString,
  requestJson,
} from '../_support/http-ops';

const OUTPUT_FILE = String(
  process.env.RUNTIME_HEALTH_OUTPUT_FILE || 'artifacts/runtime-health.json'
).trim();
const REQUIRE_WORKER =
  String(process.env.RUNTIME_HEALTH_REQUIRE_WORKER || 'true').trim().toLowerCase() !== 'false';
const REQUIRE_DISCOVERY =
  String(process.env.RUNTIME_HEALTH_REQUIRE_DISCOVERY || 'true').trim().toLowerCase() !== 'false';
const REQUIRE_EMAIL_WORKER =
  String(process.env.RUNTIME_HEALTH_REQUIRE_EMAIL_WORKER || 'false').trim().toLowerCase() ===
  'true';
const MAX_STALE_TOTAL = Math.max(0, Number(process.env.RUNTIME_HEALTH_MAX_STALE_TOTAL || 0));
const MAX_STALE_SCHEDULER_RUNS = Math.max(
  0,
  Number(process.env.RUNTIME_HEALTH_MAX_STALE_SCHEDULER_RUNS || 0)
);
const MAX_STALE_AUTOMATION_RUNS = Math.max(
  0,
  Number(process.env.RUNTIME_HEALTH_MAX_STALE_AUTOMATION_RUNS || 0)
);
const MAX_STALE_DISCOVERY_ITEMS = Math.max(
  0,
  Number(process.env.RUNTIME_HEALTH_MAX_STALE_DISCOVERY_ITEMS || 0)
);
const EXPECTED_API_LOOP_KEYS = [
  'activity-export-processor',
  'activity-maintenance',
  'paper-orders-execution',
  'suggested-trades-execution-sync',
];

async function resolveAccessToken(): Promise<string> {
  if (API_KEY) {
    return '';
  }

  return login();
}

async function run(): Promise<void> {
  const accessToken = await resolveAccessToken();
  const runtimeResponse = await requestJson('/health/runtime', {}, accessToken);
  const staleResponse = await requestJson('/internal/runtime/stale-items?limit=200', {}, accessToken);

  const overview = asRecord(runtimeResponse.data);
  const staleItems = asRecord(staleResponse.data);
  const staleCounts = asRecord(overview.staleCounts);
  const worker = asRecord(overview.worker);
  const emailWorker = asRecord(overview.emailWorker);
  const discovery = asRecord(overview.discovery);
  const automations = asRecord(overview.automations);
  const apiLoops = asArray(overview.apiLoops);
  const apiLoopKeys = apiLoops.map((item) => readString(item.key)).filter(Boolean);
  const stalePreview = asArray(overview.stalePreview);

  const snapshot = {
    baseUrl: BASE_URL,
    status: readString(overview.status || 'unknown'),
    timestamp: readString(overview.timestamp) || null,
    staleCounts: {
      total: readNumber(staleCounts.total),
      schedulerRuns: readNumber(staleCounts.schedulerRuns),
      automationRuns: readNumber(staleCounts.automationRuns),
      discoveryItems: readNumber(staleCounts.discoveryItems),
    },
    staleItemsTotal: readNumber(staleItems.total),
    worker: {
      status: readString(worker.status || 'unknown'),
      workerId: readString(worker.workerId) || null,
      heartbeatStatus: readString(worker.heartbeatStatus) || null,
      httpStatus: readString(worker.httpStatus) || null,
      activeCommandCount: readNumber(worker.activeCommandCount),
      detail: readString(worker.detail) || null,
    },
    emailWorker: {
      status: readString(emailWorker.status || 'unknown'),
      enabled: emailWorker.enabled === true,
      smtpConfigured: emailWorker.smtpConfigured === true,
      detail: readString(emailWorker.detail) || null,
    },
    discovery: {
      status: readString(discovery.status || 'unknown'),
      lifecycleState: readString(discovery.lifecycleState) || null,
      staleRunCount: readNumber(discovery.staleRunCount),
      staleBotCount: readNumber(discovery.staleBotCount),
      staleTemplateImprovementCount: readNumber(discovery.staleTemplateImprovementCount),
      detail: readString(discovery.detail) || null,
    },
    automations: {
      status: readString(automations.status || 'unknown'),
      activeRuns: readNumber(automations.activeRuns),
      staleCursorCount: readNumber(automations.staleCursorCount),
      detail: readString(automations.detail) || null,
    },
    apiLoopKeys,
    stalePreviewCount: stalePreview.length,
  };

  console.log('runtime-health-check:', JSON.stringify(snapshot));
  await persistJson(OUTPUT_FILE, snapshot);

  assert.ok(
    EXPECTED_API_LOOP_KEYS.every((key) => apiLoopKeys.includes(key)),
    `runtime health must expose all API loops: missing ${EXPECTED_API_LOOP_KEYS.filter((key) => !apiLoopKeys.includes(key)).join(', ')}`
  );
  assert.ok(
    snapshot.staleItemsTotal >= snapshot.stalePreviewCount,
    'stale-items total should be greater than or equal to stale preview count'
  );

  if (readString(overview.status).toLowerCase() === 'down') {
    throw new Error('runtime overview is down');
  }
  if (REQUIRE_WORKER && readString(worker.status).toLowerCase() === 'down') {
    throw new Error(readString(worker.detail) || 'worker runtime is down');
  }
  if (REQUIRE_EMAIL_WORKER && readString(emailWorker.status).toLowerCase() === 'down') {
    throw new Error(readString(emailWorker.detail) || 'email worker runtime is down');
  }
  if (
    REQUIRE_DISCOVERY &&
    !['ok', 'degraded'].includes(readString(discovery.status).toLowerCase())
  ) {
    throw new Error(readString(discovery.detail) || 'discovery runtime is unavailable');
  }
  if (snapshot.staleCounts.total > MAX_STALE_TOTAL) {
    throw new Error(`stale runtime items ${snapshot.staleCounts.total} exceeds ${MAX_STALE_TOTAL}`);
  }
  if (snapshot.staleCounts.schedulerRuns > MAX_STALE_SCHEDULER_RUNS) {
    throw new Error(
      `stale scheduler runs ${snapshot.staleCounts.schedulerRuns} exceeds ${MAX_STALE_SCHEDULER_RUNS}`
    );
  }
  if (snapshot.staleCounts.automationRuns > MAX_STALE_AUTOMATION_RUNS) {
    throw new Error(
      `stale automation runs ${snapshot.staleCounts.automationRuns} exceeds ${MAX_STALE_AUTOMATION_RUNS}`
    );
  }
  if (snapshot.staleCounts.discoveryItems > MAX_STALE_DISCOVERY_ITEMS) {
    throw new Error(
      `stale discovery items ${snapshot.staleCounts.discoveryItems} exceeds ${MAX_STALE_DISCOVERY_ITEMS}`
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
