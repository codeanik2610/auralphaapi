import { BASE_URL, login, persistJson, runNpmScript, sleep, writeStepSummary } from '../_support/http-ops';
import { assertSignalsThresholds, probeSignals } from '../_support/module-probes';

const SOAK_DURATION_MINUTES = Math.max(0, Number(process.env.SIGNALS_SOAK_DURATION_MINUTES || 0));
const SOAK_POLL_SECONDS = Math.max(10, Number(process.env.SIGNALS_SOAK_POLL_SECONDS || 60));
const MAX_LIST_LATENCY_MS = Math.max(0, Number(process.env.SIGNALS_MAX_LIST_LATENCY_MS || 1500));
const MAX_SUMMARY_LATENCY_MS = Math.max(
  0,
  Number(process.env.SIGNALS_MAX_SUMMARY_LATENCY_MS || 1000)
);
const MAX_OVERVIEW_LATENCY_MS = Math.max(
  0,
  Number(process.env.SIGNALS_MAX_OVERVIEW_LATENCY_MS || 2000)
);
const RUN_TEST_SUITE =
  String(process.env.SIGNALS_RELEASE_GATE_RUN_TEST || 'true').trim().toLowerCase() !== 'false';
const OUTPUT_FILE = String(
  process.env.SIGNALS_RELEASE_GATE_OUTPUT_FILE || 'artifacts/signals-release-gate.json'
).trim();

async function run(): Promise<void> {
  const startedAt = new Date().toISOString();
  if (RUN_TEST_SUITE) {
    await runNpmScript('test:signals');
  }

  const accessToken = await login();
  const thresholds = {
    maxListLatencyMs: MAX_LIST_LATENCY_MS,
    maxSummaryLatencyMs: MAX_SUMMARY_LATENCY_MS,
    maxOverviewLatencyMs: MAX_OVERVIEW_LATENCY_MS,
  };

  const startedMs = Date.now();
  const samples = [];

  while (true) {
    const snapshot = await probeSignals(accessToken);
    assertSignalsThresholds(snapshot, thresholds, `signals sample ${samples.length + 1}`);
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
    module: 'signals',
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
    '## Signals release gate',
    '',
    `- Base URL: \`${BASE_URL}\``,
    `- Test suite ran: ${RUN_TEST_SUITE ? 'yes' : 'no'}`,
    `- Soak duration: ${SOAK_DURATION_MINUTES} minute(s)`,
    `- Samples: ${samples.length}`,
    `- Final total signals: ${finalSnapshot?.totalSignals ?? 0}`,
    `- Final scan state: ${finalSnapshot?.scanState || 'unknown'}`,
    `- Final list latency: ${finalSnapshot?.listLatencyMs ?? 'n/a'}ms`,
    `- Final summary latency: ${finalSnapshot?.summaryLatencyMs ?? 'n/a'}ms`,
    `- Final overview latency: ${finalSnapshot?.overviewLatencyMs ?? 'n/a'}ms`,
    '',
  ]);

  console.log('signals-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
