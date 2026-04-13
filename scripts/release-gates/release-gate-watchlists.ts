import { BASE_URL, login, persistJson, runNpmScript, sleep, writeStepSummary } from '../_support/http-ops';
import { assertWatchlistsThresholds, probeWatchlists } from '../_support/module-probes';

const SOAK_DURATION_MINUTES = Math.max(
  0,
  Number(process.env.WATCHLISTS_SOAK_DURATION_MINUTES || 0)
);
const SOAK_POLL_SECONDS = Math.max(
  10,
  Number(process.env.WATCHLISTS_SOAK_POLL_SECONDS || 60)
);
const MAX_LIST_LATENCY_MS = Math.max(
  0,
  Number(process.env.WATCHLISTS_MAX_LIST_LATENCY_MS || 1200)
);
const MAX_SUMMARY_LATENCY_MS = Math.max(
  0,
  Number(process.env.WATCHLISTS_MAX_SUMMARY_LATENCY_MS || 1000)
);
const MAX_OVERVIEW_LATENCY_MS = Math.max(
  0,
  Number(process.env.WATCHLISTS_MAX_OVERVIEW_LATENCY_MS || 1500)
);
const RUN_TEST_SUITE =
  String(process.env.WATCHLISTS_RELEASE_GATE_RUN_TEST || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(
  process.env.WATCHLISTS_RELEASE_GATE_OUTPUT_FILE || 'artifacts/watchlists-release-gate.json'
).trim();

async function run(): Promise<void> {
  const startedAt = new Date().toISOString();
  if (RUN_TEST_SUITE) {
    await runNpmScript('test:watchlists');
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
    const snapshot = await probeWatchlists(accessToken);
    assertWatchlistsThresholds(snapshot, thresholds, `watchlists sample ${samples.length + 1}`);
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
    module: 'watchlists',
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
    '## Watchlists release gate',
    '',
    `- Base URL: \`${BASE_URL}\``,
    `- Test suite ran: ${RUN_TEST_SUITE ? 'yes' : 'no'}`,
    `- Soak duration: ${SOAK_DURATION_MINUTES} minute(s)`,
    `- Samples: ${samples.length}`,
    `- Final total watchlists: ${finalSnapshot?.totalWatchlists ?? 0}`,
    `- Final symbols tracked: ${finalSnapshot?.symbolsTracked ?? 0}`,
    `- Final active watchlist id: ${finalSnapshot?.activeWatchlistId || 'none'}`,
    `- Final list latency: ${finalSnapshot?.listLatencyMs ?? 'n/a'}ms`,
    `- Final summary latency: ${finalSnapshot?.summaryLatencyMs ?? 'n/a'}ms`,
    `- Final overview latency: ${finalSnapshot?.overviewLatencyMs ?? 'n/a'}ms`,
    '',
  ]);

  console.log('watchlists-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
