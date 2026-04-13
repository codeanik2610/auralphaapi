import { BASE_URL, login, persistJson, runNpmScript, sleep, writeStepSummary } from '../_support/http-ops';
import { assertConnectionsThresholds, probeConnections } from '../_support/module-probes';

const SOAK_DURATION_MINUTES = Math.max(
  0,
  Number(process.env.CONNECTIONS_SOAK_DURATION_MINUTES || 0)
);
const SOAK_POLL_SECONDS = Math.max(
  10,
  Number(process.env.CONNECTIONS_SOAK_POLL_SECONDS || 60)
);
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
const RUN_TEST_SUITE =
  String(process.env.CONNECTIONS_RELEASE_GATE_RUN_TEST || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(
  process.env.CONNECTIONS_RELEASE_GATE_OUTPUT_FILE || 'artifacts/connections-release-gate.json'
).trim();

async function run(): Promise<void> {
  const startedAt = new Date().toISOString();
  if (RUN_TEST_SUITE) {
    await runNpmScript('test:connections');
  }

  const accessToken = await login();
  const thresholds = {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxSummaryLatencyMs: MAX_SUMMARY_LATENCY_MS,
    maxCatalogLatencyMs: MAX_CATALOG_LATENCY_MS,
    minCatalogItems: MIN_CATALOG_ITEMS,
  };

  const startedMs = Date.now();
  const samples = [];

  while (true) {
    const snapshot = await probeConnections(accessToken);
    assertConnectionsThresholds(snapshot, thresholds, `connections sample ${samples.length + 1}`);
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
    module: 'connections',
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
    '## Connections release gate',
    '',
    `- Base URL: \`${BASE_URL}\``,
    `- Test suite ran: ${RUN_TEST_SUITE ? 'yes' : 'no'}`,
    `- Soak duration: ${SOAK_DURATION_MINUTES} minute(s)`,
    `- Samples: ${samples.length}`,
    `- Final total connections: ${finalSnapshot?.totalConnections ?? 0}`,
    `- Final healthy connections: ${finalSnapshot?.healthyConnections ?? 0}`,
    `- Final catalog items: ${(finalSnapshot?.providerItems ?? 0) + (finalSnapshot?.exchangeItems ?? 0)}`,
    `- Final list latency: ${finalSnapshot?.listLatencyMs ?? 'n/a'}ms`,
    `- Final summary latency: ${finalSnapshot?.summaryLatencyMs ?? 'n/a'}ms`,
    `- Final catalog latency: ${finalSnapshot?.catalogLatencyMs ?? 'n/a'}ms`,
    '',
  ]);

  console.log('connections-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
