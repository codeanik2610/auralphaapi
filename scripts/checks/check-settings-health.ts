import { login } from '../_support/http-ops';
import { assertSettingsThresholds, probeSettings } from '../_support/module-probes';

const MAX_GET_LATENCY_MS = Math.max(0, Number(process.env.SETTINGS_MAX_GET_LATENCY_MS || 1000));
const MAX_AUDIT_LATENCY_MS = Math.max(
  0,
  Number(process.env.SETTINGS_MAX_AUDIT_LATENCY_MS || 1000)
);
const REQUIRE_PROMOTION_RULES =
  String(process.env.SETTINGS_REQUIRE_PROMOTION_RULES || 'true')
    .trim()
    .toLowerCase() !== 'false';

async function run(): Promise<void> {
  const accessToken = await login();
  const snapshot = await probeSettings(accessToken);

  console.log('settings-health-check:', JSON.stringify(snapshot));

  assertSettingsThresholds(snapshot, {
    maxGetLatencyMs: MAX_GET_LATENCY_MS,
    maxAuditLatencyMs: MAX_AUDIT_LATENCY_MS,
    requirePromotionRules: REQUIRE_PROMOTION_RULES,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
