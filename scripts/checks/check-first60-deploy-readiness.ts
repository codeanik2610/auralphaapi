import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildStrategyTemplateAutomationProfile } from '../../src/api/utils/strategyTemplateAutomation';
import { evaluateFirst60ObserveOnlyTrade } from '../../src/api/utils/first60ObserveOnlyMonitor';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface ReadinessCheck {
  key: string;
  status: CheckStatus;
  detail: string;
}

interface ReadinessReport {
  generatedAt: string;
  status: CheckStatus;
  checks: ReadinessCheck[];
  live?: {
    enabled: boolean;
    lookbackHours: number;
    snapshotCount: number;
    gateSnapshotCount: number;
    observeResultCount: number;
  };
}

const FILE_CHECKS: Array<{
  key: string;
  candidates: string[];
  required: boolean;
}> = [
  {
    key: 'strategyTemplateAutomation',
    candidates: [
    'src/api/utils/strategyTemplateAutomation.ts',
    'dist/src/api/utils/strategyTemplateAutomation.js',
    ],
    required: true,
  },
  {
    key: 'automationExecutionService',
    candidates: [
    'src/api/services/AutomationExecutionService.ts',
    'dist/src/api/services/AutomationExecutionService.js',
    ],
    required: true,
  },
  {
    key: 'observeMonitorUtility',
    candidates: [
    'src/api/utils/first60ObserveOnlyMonitor.ts',
    'dist/src/api/utils/first60ObserveOnlyMonitor.js',
    ],
    required: true,
  },
  {
    key: 'observeMonitorScript',
    candidates: [
    'scripts/checks/check-first60-observe-only-monitor.ts',
    'dist/scripts/checks/check-first60-observe-only-monitor.js',
    ],
    required: true,
  },
  {
    key: 'realDataSimulatorScript',
    candidates: [
    'scripts/diagnostics/run-first60-template-simulator.ts',
    'dist/scripts/diagnostics/run-first60-template-simulator.js',
    ],
    required: true,
  },
  {
    key: 'deployRunbook',
    candidates: ['docs/first60-deploy-readiness-runbook.md'],
    required: false,
  },
];

const SOURCE_CANDIDATES = Object.fromEntries(
  FILE_CHECKS.map((item) => [item.key, item.candidates])
) as Record<string, string[]>;

const readBoolean = (key: string, fallback = false): boolean => {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
};

const readNumber = (key: string, fallback: number, minimum: number): number => {
  const raw = process.env[key];
  const parsed = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number`);
  }
  return Math.max(minimum, Math.trunc(parsed));
};

const pass = (key: string, detail: string): ReadinessCheck => ({ key, status: 'pass', detail });
const warn = (key: string, detail: string): ReadinessCheck => ({ key, status: 'warn', detail });
const fail = (key: string, detail: string): ReadinessCheck => ({ key, status: 'fail', detail });

const resolveExistingPath = async (candidates: string[]): Promise<string | null> => {
  for (const candidate of candidates) {
    const fullPath = path.resolve(process.cwd(), candidate);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      // Try the next deployment/source layout candidate.
    }
  }
  return null;
};

const readCandidateFile = async (candidates: string[]): Promise<{ path: string; text: string }> => {
  const resolved = await resolveExistingPath(candidates);
  if (!resolved) {
    throw new Error(`None of these files exist: ${candidates.join(', ')}`);
  }
  return {
    path: resolved,
    text: await readFile(resolved, 'utf8'),
  };
};

const checkFiles = async (): Promise<ReadinessCheck[]> => {
  const checks: ReadinessCheck[] = [];
  for (const { key, candidates, required } of FILE_CHECKS) {
    const resolved = await resolveExistingPath(candidates);
    checks.push(
      resolved
        ? pass(`file:${key}`, `Found ${path.relative(process.cwd(), resolved)}`)
        : required
          ? fail(`file:${key}`, `Missing all candidates: ${candidates.join(', ')}`)
          : warn(
              `file:${key}`,
              `Optional source-tree artifact missing in this runtime: ${candidates.join(', ')}`
            )
    );
  }
  return checks;
};

const checkStaticMarkers = async (): Promise<ReadinessCheck[]> => {
  const checks: ReadinessCheck[] = [];
  const automationProfile = await readCandidateFile(SOURCE_CANDIDATES.strategyTemplateAutomation);
  const executionService = await readCandidateFile(SOURCE_CANDIDATES.automationExecutionService);
  const observeMonitor = await readCandidateFile(SOURCE_CANDIDATES.observeMonitorUtility);
  const packageJson = await readCandidateFile(['package.json']);

  const markerChecks: Array<[string, string, string]> = [
    ['profile:decision-gate-builder', automationProfile.text, 'buildFirst60DecisionGate'],
    ['profile:observe-only-flag', automationProfile.text, 'observeOnlyEnabled'],
    ['profile:diagnostics-flag', automationProfile.text, 'diagnosticsEnabled'],
    ['snapshot:first60', executionService.text, 'tradeManagementSnapshot'],
    ['snapshot:decision-gate', executionService.text, 'decisionGate'],
    ['monitor:evaluator', observeMonitor.text, 'evaluateFirst60ObserveOnlyTrade'],
    ['monitor:no-order-action', observeMonitor.text, 'resolveAction'],
    ['package:readiness-script', packageJson.text, 'check:first60-deploy-readiness'],
    ['package:observe-script', packageJson.text, 'check:first60-observe-only'],
  ];

  for (const [key, text, marker] of markerChecks) {
    checks.push(
      text.includes(marker)
        ? pass(key, `Found marker ${marker}`)
        : fail(key, `Missing marker ${marker}`)
    );
  }

  return checks;
};

const checkPureContracts = (): ReadinessCheck[] => {
  const checks: ReadinessCheck[] = [];
  const profile = buildStrategyTemplateAutomationProfile({
    codeTarget: 'python',
    codeDefinition: `class First60ReadinessStrategy:
    def entry(self, ctx):
        return True
    def exit(self, ctx):
        return False
    def entry_short(self, ctx):
        return True
    def exit_short(self, ctx):
        return False
    risk = {"stop_loss_pct": 2, "take_profit_pct": 4}`,
    tradeManagement: {
      first60: {
        enabled: true,
        mode: 'post_entry_hold_or_exit',
        dataSource: 'market_candles_1m',
        buy: {
          enabled: true,
          observeOnlyEnabled: true,
          managementEnabled: false,
          diagnosticsEnabled: true,
          decisionGate: {
            status: 'observe_only',
            evidenceRef: 'storage/first60-evidence/phase3c-summary-2026-05-07.md',
          },
          requiredFavorableR: 1,
          maxAdverseR: 0.75,
          targetR: 5,
        },
        sell: {
          enabled: true,
          observeOnlyEnabled: false,
          managementEnabled: false,
          diagnosticsEnabled: true,
          decisionGate: {
            status: 'blocked',
            evidenceRef: 'storage/first60-evidence/phase3c-summary-2026-05-07.md',
          },
          requiredFavorableR: 1,
          maxAdverseR: 0.75,
          targetR: 4.5,
        },
      },
    },
  });

  try {
    assert.equal(profile.tradeManagement?.first60?.long?.decisionGate.status, 'observe_only');
    assert.equal(
      profile.tradeManagement?.first60?.long?.decisionGate.observeOnlyEnabled,
      true
    );
    assert.equal(profile.tradeManagement?.first60?.long?.decisionGate.managementEnabled, false);
    checks.push(pass('contract:buy-gate', 'BUY normalizes as observe-only, not management.'));
  } catch (error) {
    checks.push(fail('contract:buy-gate', error instanceof Error ? error.message : String(error)));
  }

  try {
    assert.equal(profile.tradeManagement?.first60?.short?.decisionGate.status, 'blocked');
    assert.equal(
      profile.tradeManagement?.first60?.short?.decisionGate.observeOnlyEnabled,
      false
    );
    assert.equal(profile.tradeManagement?.first60?.short?.decisionGate.diagnosticsEnabled, true);
    checks.push(pass('contract:sell-gate', 'SELL normalizes as diagnostics-only blocked.'));
  } catch (error) {
    checks.push(fail('contract:sell-gate', error instanceof Error ? error.message : String(error)));
  }

  const buyObserve = evaluateFirst60ObserveOnlyTrade(
    {
      id: 'readiness-buy',
      symbol: 'BTCUSDT',
      side: 'BUY',
      signalTime: '2026-04-04T10:00:00.000Z',
      entryPrice: 100,
      stopLossPrice: 98,
      meta: {
        tradeManagementSnapshot: {
          first60: {
            enabled: true,
            windowMinutes: 60,
            requiredFavorableR: 1,
            maxAdverseR: 0.75,
            targetR: 5,
            decisionGate: profile.tradeManagement?.first60?.long?.decisionGate,
          },
        },
      },
    },
    buildSyntheticCandles('long'),
    { now: '2026-04-04T11:01:00.000Z' }
  );
  checks.push(
    buyObserve.action === 'observe_only' && buyObserve.first60Passed === true
      ? pass('monitor:buy-observe', 'BUY monitor evaluates observe-only and passes First60.')
      : fail('monitor:buy-observe', `Unexpected BUY monitor result ${JSON.stringify(buyObserve)}`)
  );

  const sellDiagnostics = evaluateFirst60ObserveOnlyTrade(
    {
      id: 'readiness-sell',
      symbol: 'ETHUSDT',
      side: 'SELL',
      signalTime: '2026-04-04T10:00:00.000Z',
      entryPrice: 100,
      stopLossPrice: 102,
      meta: {
        tradeManagementSnapshot: {
          first60: {
            enabled: true,
            windowMinutes: 60,
            requiredFavorableR: 1,
            maxAdverseR: 0.75,
            targetR: 4.5,
            decisionGate: profile.tradeManagement?.first60?.short?.decisionGate,
          },
        },
      },
    },
    buildSyntheticCandles('short'),
    { now: '2026-04-04T11:01:00.000Z' }
  );
  checks.push(
    sellDiagnostics.action === 'diagnostics_only' &&
      sellDiagnostics.eligibleForObserveOnly === false
      ? pass('monitor:sell-diagnostics', 'SELL monitor evaluates diagnostics-only, not observe action.')
      : fail(
          'monitor:sell-diagnostics',
          `Unexpected SELL monitor result ${JSON.stringify(sellDiagnostics)}`
        )
  );

  return checks;
};

const buildSyntheticCandles = (side: 'long' | 'short') => {
  const start = new Date('2026-04-04T10:00:00.000Z').getTime();
  return Array.from({ length: 61 }, (_, index) => ({
    openTime: new Date(start + index * 60_000).toISOString(),
    open: 100,
    high: side === 'long' ? 102 : 101,
    low: side === 'long' ? 99 : 98,
    close: side === 'long' ? 101 : 99,
  }));
};

const runLiveCheck = async (
  checks: ReadinessCheck[]
): Promise<ReadinessReport['live'] | undefined> => {
  if (!readBoolean('FIRST60_DEPLOY_READINESS_LIVE', false)) {
    checks.push(warn('live:skipped', 'Set FIRST60_DEPLOY_READINESS_LIVE=true for DB checks.'));
    return undefined;
  }

  const lookbackHours = readNumber('FIRST60_DEPLOY_READINESS_LOOKBACK_HOURS', 72, 1);
  const requireSnapshots = readBoolean('FIRST60_DEPLOY_READINESS_REQUIRE_SNAPSHOTS', false);
  const { initializeCoreDataSource } = await import('../../src/database/initializeCoreDataSource');
  const { coreDataSource } = await import('../../src/database/data-source');

  await initializeCoreDataSource();
  try {
    const rows = (await coreDataSource.query(
      `
        SELECT
          SUM(CASE WHEN JSON_EXTRACT(meta_json, '$.tradeManagementSnapshot.first60') IS NOT NULL THEN 1 ELSE 0 END) AS snapshotCount,
          SUM(CASE WHEN JSON_EXTRACT(meta_json, '$.tradeManagementSnapshot.first60.decisionGate') IS NOT NULL THEN 1 ELSE 0 END) AS gateSnapshotCount,
          SUM(CASE WHEN JSON_EXTRACT(meta_json, '$.first60ObserveOnly') IS NOT NULL THEN 1 ELSE 0 END) AS observeResultCount
        FROM suggested_trades
        WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
      `,
      [lookbackHours]
    )) as Array<Record<string, unknown>>;
    const snapshotCount = Number(rows[0]?.snapshotCount || 0);
    const gateSnapshotCount = Number(rows[0]?.gateSnapshotCount || 0);
    const observeResultCount = Number(rows[0]?.observeResultCount || 0);

    if (snapshotCount > 0 && gateSnapshotCount === snapshotCount) {
      checks.push(
        pass(
          'live:snapshots',
          `${snapshotCount} recent First60 snapshot(s), all with decision gates.`
        )
      );
    } else if (snapshotCount > 0) {
      checks.push(
        fail(
          'live:snapshots',
          `${snapshotCount} recent snapshot(s), but only ${gateSnapshotCount} include decision gates.`
        )
      );
    } else if (requireSnapshots) {
      checks.push(
        fail(
          'live:snapshots',
          `No recent First60 snapshots found in the last ${lookbackHours} hour(s).`
        )
      );
    } else {
      checks.push(
        warn(
          'live:snapshots',
          `No recent First60 snapshots found in the last ${lookbackHours} hour(s).`
        )
      );
    }

    checks.push(
      pass(
        'live:observe-results',
        `${observeResultCount} recent suggested trade(s) already have first60ObserveOnly results.`
      )
    );

    return {
      enabled: true,
      lookbackHours,
      snapshotCount,
      gateSnapshotCount,
      observeResultCount,
    };
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
};

const buildStatus = (checks: ReadinessCheck[]): CheckStatus => {
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }
  if (checks.some((check) => check.status === 'warn')) {
    return 'warn';
  }
  return 'pass';
};

async function run(): Promise<void> {
  const checks: ReadinessCheck[] = [];
  checks.push(...(await checkFiles()));
  checks.push(...(await checkStaticMarkers()));
  checks.push(...checkPureContracts());
  const live = await runLiveCheck(checks);
  const status = buildStatus(checks);
  const report: ReadinessReport = {
    generatedAt: new Date().toISOString(),
    status,
    checks,
    ...(live ? { live } : {}),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (status === 'fail') {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
