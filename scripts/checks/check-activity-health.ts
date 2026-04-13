import { login } from '../_support/http-ops';
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

  console.log('activity-health-check:', JSON.stringify(snapshot));

  assertActivityThresholds(snapshot, {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxSummaryLatencyMs: MAX_SUMMARY_LATENCY_MS,
    maxViewsLatencyMs: MAX_VIEWS_LATENCY_MS,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
