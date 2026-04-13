import { login } from '../_support/http-ops';
import { assertWatchlistsThresholds, probeWatchlists } from '../_support/module-probes';

const MAX_LIST_LATENCY_MS = Math.max(
  0,
  Number(process.env.WATCHLISTS_MAX_LIST_LATENCY_MS || 1200)
);
const MAX_SUMMARY_LATENCY_MS = Math.max(
  0,
  Number(process.env.WATCHLISTS_MAX_SUMMARY_LATENCY_MS || 1000)
);
const MAX_OVERVIEW_LATENCY_MS = Math.max(
  0,
  Number(process.env.WATCHLISTS_MAX_OVERVIEW_LATENCY_MS || 1500)
);

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeWatchlists(accessToken);

  console.log('watchlists-health-check:', JSON.stringify(snapshot));

  assertWatchlistsThresholds(snapshot, {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxSummaryLatencyMs: MAX_SUMMARY_LATENCY_MS,
    maxOverviewLatencyMs: MAX_OVERVIEW_LATENCY_MS,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
