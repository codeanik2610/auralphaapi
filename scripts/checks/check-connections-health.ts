import { login } from '../_support/http-ops';
import { assertConnectionsThresholds, probeConnections } from '../_support/module-probes';

const MAX_LIST_LATENCY_MS = Math.max(
  0,
  Number(process.env.CONNECTIONS_MAX_LIST_LATENCY_MS || 1500)
);
const MAX_SUMMARY_LATENCY_MS = Math.max(
  0,
  Number(process.env.CONNECTIONS_MAX_SUMMARY_LATENCY_MS || 1000)
);
const MAX_CATALOG_LATENCY_MS = Math.max(
  0,
  Number(process.env.CONNECTIONS_MAX_CATALOG_LATENCY_MS || 1500)
);
const MIN_CATALOG_ITEMS = Math.max(0, Number(process.env.CONNECTIONS_MIN_CATALOG_ITEMS || 0));

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeConnections(accessToken);

  console.log('connections-health-check:', JSON.stringify(snapshot));

  assertConnectionsThresholds(snapshot, {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxSummaryLatencyMs: MAX_SUMMARY_LATENCY_MS,
    maxCatalogLatencyMs: MAX_CATALOG_LATENCY_MS,
    minCatalogItems: MIN_CATALOG_ITEMS,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
