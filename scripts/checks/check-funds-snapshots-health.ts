import { login } from '../_support/http-ops';
import {
  assertFundsSnapshotsThresholds,
  probeFundsSnapshots,
} from '../_support/module-probes';

const MAX_LIST_LATENCY_MS = Math.max(
  0,
  Number(process.env.FUNDS_SNAPSHOTS_MAX_LIST_LATENCY_MS || 2000)
);
const MAX_LATEST_LATENCY_MS = Math.max(
  0,
  Number(process.env.FUNDS_SNAPSHOTS_MAX_LATEST_LATENCY_MS || 1500)
);

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeFundsSnapshots(accessToken);

  console.log('funds-snapshots-health-check:', JSON.stringify(snapshot));

  assertFundsSnapshotsThresholds(snapshot, {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxLatestLatencyMs: MAX_LATEST_LATENCY_MS,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
