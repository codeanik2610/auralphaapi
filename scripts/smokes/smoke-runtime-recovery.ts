import assert from 'node:assert/strict';
import {
  API_KEY,
  asArray,
  asRecord,
  BASE_URL,
  login,
  readNumber,
  readString,
  requestJson,
} from '../_support/http-ops';

const REQUIRE_DISCOVERY =
  String(process.env.SMOKE_RUNTIME_REQUIRE_DISCOVERY || 'false').trim().toLowerCase() === 'true';
const EXPECT_ZERO_STALE =
  String(process.env.SMOKE_RUNTIME_EXPECT_ZERO_STALE || 'false').trim().toLowerCase() === 'true';
const REQUIRE_REPAIR_ACTIONS =
  String(process.env.SMOKE_RUNTIME_REQUIRE_REPAIR_ACTIONS || 'true').trim().toLowerCase() !==
  'false';

async function resolveAccessToken(): Promise<string> {
  if (API_KEY) {
    return '';
  }

  return login();
}

async function run(): Promise<void> {
  const accessToken = await resolveAccessToken();
  const runtimeResponse = await requestJson('/health/runtime', {}, accessToken);
  const overviewResponse = await requestJson('/internal/runtime/overview', {}, accessToken);
  const staleResponse = await requestJson('/internal/runtime/stale-items?limit=50', {}, accessToken);

  const runtime = asRecord(runtimeResponse.data);
  const overview = asRecord(overviewResponse.data);
  const staleItemsPayload = asRecord(staleResponse.data);
  const discovery = asRecord(runtime.discovery);
  const staleItems = asArray(staleItemsPayload.items);

  const snapshot = {
    baseUrl: BASE_URL,
    runtimeStatus: readString(runtime.status || 'unknown'),
    overviewStatus: readString(overview.status || 'unknown'),
    workerStatus: readString(asRecord(runtime.worker).status || 'unknown'),
    discoveryStatus: readString(discovery.status || 'unknown'),
    staleItemsTotal: readNumber(staleItemsPayload.total),
    repairableItems: staleItems.filter((item) => item.repairable === true).length,
    repairActionCoverage: staleItems.every(
      (item) => item.repairable !== true || readString(item.repairAction).length > 0
    ),
    apiLoops: asArray(runtime.apiLoops).map((item) => readString(item.key)).filter(Boolean),
  };

  console.log('runtime-recovery-smoke:', JSON.stringify(snapshot));

  assert.equal(
    snapshot.runtimeStatus,
    snapshot.overviewStatus,
    'runtime health and internal runtime overview should agree on top-level status'
  );

  if (REQUIRE_DISCOVERY && !['ok', 'degraded'].includes(snapshot.discoveryStatus.toLowerCase())) {
    throw new Error(`discovery runtime status is ${snapshot.discoveryStatus}`);
  }

  if (EXPECT_ZERO_STALE && snapshot.staleItemsTotal !== 0) {
    throw new Error(`expected zero stale runtime items, found ${snapshot.staleItemsTotal}`);
  }

  if (REQUIRE_REPAIR_ACTIONS && !snapshot.repairActionCoverage) {
    throw new Error('repairable stale items must expose repairAction metadata');
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
