import { login } from '../_support/http-ops';
import {
  assertBrokerAccountsThresholds,
  probeBrokerAccounts,
} from '../_support/module-probes';

const MAX_LIST_LATENCY_MS = Math.max(
  0,
  Number(process.env.BROKER_ACCOUNTS_MAX_LIST_LATENCY_MS || 1500)
);
const MAX_DEFINITIONS_LATENCY_MS = Math.max(
  0,
  Number(process.env.BROKER_ACCOUNTS_MAX_DEFINITIONS_LATENCY_MS || 1500)
);
const MAX_HEALTH_CHECK_LATENCY_MS = Math.max(
  0,
  Number(process.env.BROKER_ACCOUNTS_MAX_HEALTH_CHECK_LATENCY_MS || 2500)
);
const MIN_BROKER_DEFINITIONS = Math.max(
  0,
  Number(process.env.BROKER_ACCOUNTS_MIN_BROKER_DEFINITIONS || 1)
);

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeBrokerAccounts(accessToken);

  console.log('broker-accounts-health-check:', JSON.stringify(snapshot));

  assertBrokerAccountsThresholds(snapshot, {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxDefinitionsLatencyMs: MAX_DEFINITIONS_LATENCY_MS,
    maxHealthCheckLatencyMs: MAX_HEALTH_CHECK_LATENCY_MS,
    minBrokerDefinitions: MIN_BROKER_DEFINITIONS,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
