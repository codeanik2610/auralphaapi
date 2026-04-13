import assert from 'node:assert/strict';
import { asArray, asRecord, login, readString, requestJson } from '../_support/http-ops';
import { assertActivityThresholds, probeActivity } from '../_support/module-probes';

const MAX_LIST_LATENCY_MS = Math.max(
  0,
  Number(process.env.ACTIVITY_MAX_LIST_LATENCY_MS || 1500)
);
const MAX_SUMMARY_LATENCY_MS = Math.max(
  0,
  Number(process.env.ACTIVITY_MAX_SUMMARY_LATENCY_MS || 1000)
);
const MAX_VIEWS_LATENCY_MS = Math.max(
  0,
  Number(process.env.ACTIVITY_MAX_VIEWS_LATENCY_MS || 1200)
);

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeActivity(accessToken);
  const runtimeResponse = await requestJson('/health/runtime', {}, accessToken);
  const runtimeOverview = asRecord(runtimeResponse.data);
  const runtimeLoops = asArray(runtimeOverview.apiLoops)
    .map((item) => readString(item.key))
    .filter(Boolean);

  console.log(
    'activity-health-check:',
    JSON.stringify({
      ...snapshot,
      runtimeLoops,
    })
  );

  assertActivityThresholds(snapshot, {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxSummaryLatencyMs: MAX_SUMMARY_LATENCY_MS,
    maxViewsLatencyMs: MAX_VIEWS_LATENCY_MS,
  });
  assert.ok(
    runtimeLoops.includes('activity-export-processor'),
    'runtime health must expose activity-export-processor'
  );
  assert.ok(
    runtimeLoops.includes('activity-maintenance'),
    'runtime health must expose activity-maintenance'
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
