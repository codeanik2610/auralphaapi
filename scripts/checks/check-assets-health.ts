import { login } from '../_support/http-ops';
import { assertAssetsThresholds, probeAssets } from '../_support/module-probes';

const MAX_CATALOG_LATENCY_MS = Math.max(
  0,
  Number(process.env.ASSETS_MAX_CATALOG_LATENCY_MS || 2000)
);
const MAX_FUTURES_LATENCY_MS = Math.max(
  0,
  Number(process.env.ASSETS_MAX_FUTURES_LATENCY_MS || 2500)
);
const MAX_EXCHANGE_ASSETS_LATENCY_MS = Math.max(
  0,
  Number(process.env.ASSETS_MAX_EXCHANGE_ASSETS_LATENCY_MS || 2000)
);
const MIN_CATALOG_ITEMS = Math.max(0, Number(process.env.ASSETS_MIN_CATALOG_ITEMS || 1));

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeAssets(accessToken);

  console.log('assets-health-check:', JSON.stringify(snapshot));

  assertAssetsThresholds(snapshot, {
    maxCatalogLatencyMs: MAX_CATALOG_LATENCY_MS,
    maxFuturesLatencyMs: MAX_FUTURES_LATENCY_MS,
    maxExchangeAssetsLatencyMs: MAX_EXCHANGE_ASSETS_LATENCY_MS,
    minCatalogItems: MIN_CATALOG_ITEMS,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
