import { BASE_URL, login, persistJson, runNpmScript, sleep, writeStepSummary } from '../_support/http-ops';
import { assertAlertsThresholds, probeAlerts } from '../_support/module-probes';

const SOAK_DURATION_MINUTES = Math.max(0, Number(process.env.ALERTS_SOAK_DURATION_MINUTES || 0));
const SOAK_POLL_SECONDS = Math.max(10, Number(process.env.ALERTS_SOAK_POLL_SECONDS || 60));
const MAX_LIST_LATENCY_MS = Math.max(0, Number(process.env.ALERTS_MAX_LIST_LATENCY_MS || 1200));
const MAX_SUMMARY_LATENCY_MS = Math.max(
  0,
  Number(process.env.ALERTS_MAX_SUMMARY_LATENCY_MS || 1000)
);
const MAX_OVERVIEW_LATENCY_MS = Math.max(
  0,
  Number(process.env.ALERTS_MAX_OVERVIEW_LATENCY_MS || 1500)
);
const RUN_TEST_SUITE =
  String(process.env.ALERTS_RELEASE_GATE_RUN_TEST || 'true').trim().toLowerCase() !== 'false';
const OUTPUT_FILE = String(
  process.env.ALERTS_RELEASE_GATE_OUTPUT_FILE || 'artifacts/alerts-release-gate.json'
).trim();

async function run(): Promise<void> {
  const startedAt = new Date().toISOString();
  if (RUN_TEST_SUITE) {
    await runNpmScript('test:alerts');
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
    const snapshot = await probeAlerts(accessToken);
    assertAlertsThresholds(snapshot, thresholds, `alerts sample ${samples.length + 1}`);
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
    module: 'alerts',
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
    '## Alerts release gate',
    '',
    `- Base URL: \`${BASE_URL}\``,
    `- Test suite ran: ${RUN_TEST_SUITE ? 'yes' : 'no'}`,
    `- Soak duration: ${SOAK_DURATION_MINUTES} minute(s)`,
    `- Samples: ${samples.length}`,
    `- Final total alerts: ${finalSnapshot?.totalAlerts ?? 0}`,
    `- Final open alerts: ${finalSnapshot?.openAlerts ?? 0}`,
    `- Final critical severity: ${finalSnapshot?.criticalSeverity ?? 0}`,
    `- Final list latency: ${finalSnapshot?.listLatencyMs ?? 'n/a'}ms`,
    `- Final summary latency: ${finalSnapshot?.summaryLatencyMs ?? 'n/a'}ms`,
    `- Final overview latency: ${finalSnapshot?.overviewLatencyMs ?? 'n/a'}ms`,
    '',
  ]);

  console.log('alerts-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
