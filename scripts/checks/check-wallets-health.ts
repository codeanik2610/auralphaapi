import { login } from '../_support/http-ops';
import { assertWalletsThresholds, probeWallets } from '../_support/module-probes';

const MAX_WALLET_LATENCY_MS = Math.max(
  0,
  Number(process.env.WALLETS_MAX_WALLET_LATENCY_MS || 2000)
);
const MAX_FUTURES_LATENCY_MS = Math.max(
  0,
  Number(process.env.WALLETS_MAX_FUTURES_LATENCY_MS || 2000)
);

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeWallets(accessToken);

  console.log('wallets-health-check:', JSON.stringify(snapshot));

  assertWalletsThresholds(snapshot, {
    maxWalletLatencyMs: MAX_WALLET_LATENCY_MS,
    maxFuturesLatencyMs: MAX_FUTURES_LATENCY_MS,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
