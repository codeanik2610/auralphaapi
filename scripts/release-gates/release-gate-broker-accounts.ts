import { BASE_URL, login, persistJson, runNpmScript, sleep, writeStepSummary } from '../_support/http-ops';
import {
  assertBrokerAccountsThresholds,
  probeBrokerAccounts,
} from '../_support/module-probes';

const SOAK_DURATION_MINUTES = Math.max(
  0,
  Number(process.env.BROKER_ACCOUNTS_SOAK_DURATION_MINUTES || 0)
);
const SOAK_POLL_SECONDS = Math.max(
  10,
  Number(process.env.BROKER_ACCOUNTS_SOAK_POLL_SECONDS || 60)
);
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
const RUN_TEST_SUITE =
  String(process.env.BROKER_ACCOUNTS_RELEASE_GATE_RUN_TEST || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(
  process.env.BROKER_ACCOUNTS_RELEASE_GATE_OUTPUT_FILE ||
    'artifacts/broker-accounts-release-gate.json'
).trim();

async function run(): Promise<void> {
  const startedAt = new Date().toISOString();
  if (RUN_TEST_SUITE) {
    await runNpmScript('test:broker-accounts');
  }

  const accessToken = await login();
  const thresholds = {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxDefinitionsLatencyMs: MAX_DEFINITIONS_LATENCY_MS,
    maxHealthCheckLatencyMs: MAX_HEALTH_CHECK_LATENCY_MS,
    minBrokerDefinitions: MIN_BROKER_DEFINITIONS,
  };

  const startedMs = Date.now();
  const samples = [];

  while (true) {
    const snapshot = await probeBrokerAccounts(accessToken);
    assertBrokerAccountsThresholds(
      snapshot,
      thresholds,
      `broker accounts sample ${samples.length + 1}`
    );
    samples.push(snapshot);

    if (SOAK_DURATION_MINUTES <= 0) {
      break;
    }

    const elapsedMs = Date.now() - startedMs;
    if (elapsedMs >= SOAK_DURATION_MINUTES * 60_000) {
      break;
    }

    await sleep(SOAK_POLL_SECONDS * 1000);
  }

  const finalSnapshot = samples.at(-1);
  const summary = {
    module: 'broker-accounts',
    baseUrl: BASE_URL,
    testSuiteRan: RUN_TEST_SUITE,
    soakDurationMinutes: SOAK_DURATION_MINUTES,
    samples: samples.length,
    startedAt,
    finishedAt: new Date().toISOString(),
    thresholds,
    checks: {
      thresholdsSatisfied: true,
    },
    finalSnapshot,
  };

  await persistJson(OUTPUT_FILE, summary);
  await writeStepSummary([
    '## Broker accounts release gate',
    '',
    `- Base URL: \`${BASE_URL}\``,
    `- Test suite ran: ${RUN_TEST_SUITE ? 'yes' : 'no'}`,
    `- Soak duration: ${SOAK_DURATION_MINUTES} minute(s)`,
    `- Samples: ${samples.length}`,
    `- Final total accounts: ${finalSnapshot?.totalAccounts ?? 0}`,
    `- Final broker definitions: ${finalSnapshot?.brokerDefinitions ?? 0}`,
    `- Final connected accounts: ${finalSnapshot?.connectedAccounts ?? 0}`,
    `- Final tested accounts: ${finalSnapshot?.testedAccounts ?? 0}`,
    `- Final passed checks: ${finalSnapshot?.passed ?? 0}`,
    `- Final failed checks: ${finalSnapshot?.failed ?? 0}`,
    `- Final list latency: ${finalSnapshot?.listLatencyMs ?? 'n/a'}ms`,
    `- Final definitions latency: ${finalSnapshot?.definitionsLatencyMs ?? 'n/a'}ms`,
    `- Final health-check latency: ${finalSnapshot?.healthCheckLatencyMs ?? 'n/a'}ms`,
    '',
  ]);

  console.log('broker-accounts-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
