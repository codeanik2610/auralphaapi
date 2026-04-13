import { login } from '../_support/http-ops';
import { assertMarketsThresholds, probeMarkets } from '../_support/module-probes';

const MAX_OVERVIEW_LATENCY_MS = Math.max(
  0,
  Number(process.env.MARKETS_MAX_OVERVIEW_LATENCY_MS || 2000)
);
const MAX_SYMBOL_OVERVIEW_LATENCY_MS = Math.max(
  0,
  Number(process.env.MARKETS_MAX_SYMBOL_OVERVIEW_LATENCY_MS || 2000)
);
const MAX_CHART_LATENCY_MS = Math.max(
  0,
  Number(process.env.MARKETS_MAX_CHART_LATENCY_MS || 2000)
);
const MIN_ASSETS = Math.max(0, Number(process.env.MARKETS_MIN_ASSETS || 1));

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeMarkets(accessToken);

  console.log('markets-health-check:', JSON.stringify(snapshot));

  assertMarketsThresholds(snapshot, {
    maxOverviewLatencyMs: MAX_OVERVIEW_LATENCY_MS,
    maxSymbolOverviewLatencyMs: MAX_SYMBOL_OVERVIEW_LATENCY_MS,
    maxChartLatencyMs: MAX_CHART_LATENCY_MS,
    minAssets: MIN_ASSETS,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
