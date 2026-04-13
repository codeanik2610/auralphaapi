import { BASE_URL, login, persistJson, runNpmScript, sleep, writeStepSummary } from '../_support/http-ops';
import { assertSettingsThresholds, probeSettings } from '../_support/module-probes';

const SOAK_DURATION_MINUTES = Math.max(0, Number(process.env.SETTINGS_SOAK_DURATION_MINUTES || 0));
const SOAK_POLL_SECONDS = Math.max(10, Number(process.env.SETTINGS_SOAK_POLL_SECONDS || 60));
const MAX_GET_LATENCY_MS = Math.max(0, Number(process.env.SETTINGS_MAX_GET_LATENCY_MS || 1000));
const MAX_AUDIT_LATENCY_MS = Math.max(
  0,
  Number(process.env.SETTINGS_MAX_AUDIT_LATENCY_MS || 1000)
);
const REQUIRE_PROMOTION_RULES =
  String(process.env.SETTINGS_REQUIRE_PROMOTION_RULES || 'true')
    .trim()
    .toLowerCase() !== 'false';
const RUN_TEST_SUITE =
  String(process.env.SETTINGS_RELEASE_GATE_RUN_TEST || 'true')
    .trim()
    .toLowerCase() !== 'false';
const OUTPUT_FILE = String(
  process.env.SETTINGS_RELEASE_GATE_OUTPUT_FILE || 'artifacts/settings-release-gate.json'
).trim();

async function run(): Promise<void> {
  const startedAt = new Date().toISOString();
  if (RUN_TEST_SUITE) {
    await runNpmScript('test:settings');
  }

  const accessToken = await login();
  const thresholds = {
    maxGetLatencyMs: MAX_GET_LATENCY_MS,
    maxAuditLatencyMs: MAX_AUDIT_LATENCY_MS,
    requirePromotionRules: REQUIRE_PROMOTION_RULES,
  };

  const startedMs = Date.now();
  const samples = [];

  while (true) {
    const snapshot = await probeSettings(accessToken);
    assertSettingsThresholds(snapshot, thresholds, `settings sample ${samples.length + 1}`);
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
    module: 'settings',
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
    '## Settings release gate',
    '',
    `- Base URL: \`${BASE_URL}\``,
    `- Test suite ran: ${RUN_TEST_SUITE ? 'yes' : 'no'}`,
    `- Soak duration: ${SOAK_DURATION_MINUTES} minute(s)`,
    `- Samples: ${samples.length}`,
    `- Final timezone: ${finalSnapshot?.timezone || 'unknown'}`,
    `- Final hasSavedSettings: ${finalSnapshot?.hasSavedSettings ? 'yes' : 'no'}`,
    `- Final promotion rules present: ${finalSnapshot?.hasPromotionRules ? 'yes' : 'no'}`,
    `- Final settings latency: ${finalSnapshot?.getLatencyMs ?? 'n/a'}ms`,
    `- Final settings audit latency: ${finalSnapshot?.auditLatencyMs ?? 'n/a'}ms`,
    '',
  ]);

  console.log('settings-release-gate:', JSON.stringify(summary));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
