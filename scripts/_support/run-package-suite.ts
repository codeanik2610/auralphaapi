import { spawn } from 'node:child_process';
import { resolveTestCommand } from './resolve-test-command';

type SuiteEntry = string | string[];
type SuiteRole = 'baseline' | 'module-only' | 'aggregate-catchall' | 'cross-cutting';

// Suite role guide:
// - baseline: deterministic local default coverage used by test:release-baseline
// - module-only: dedicated local suites intentionally kept out of the baseline for focus
// - aggregate-catchall: broad safety-net suites that are useful, but too noisy for the default baseline
// - cross-cutting: shared local coverage that does not fit a single product module
// - smoke-only and live-proof coverage stay outside this runner behind the smoke:*, proof:*,
//   release-gate:*, and signoff:* package prefixes

const SUITE_ROLES: Record<string, SuiteRole> = {
  'core-contracts': 'baseline',
  'coverage-audit': 'baseline',
  'aggregate-catchall': 'aggregate-catchall',
  'release-baseline': 'baseline',
  'module-only': 'module-only',
  activity: 'baseline',
  alerts: 'baseline',
  markets: 'baseline',
  assets: 'baseline',
  wallets: 'baseline',
  'funds-snapshots': 'baseline',
  'broker-reconciliation-storage': 'baseline',
  'mudrex-reconciliation-sync': 'baseline',
  'delta-reconciliation-sync': 'baseline',
  'broker-reconciliation-match': 'baseline',
  'broker-reconciliation-read': 'baseline',
  'broker-reconciliation-batch': 'baseline',
  'broker-reconciliation-scheduler': 'baseline',
  orders: 'baseline',
  automations: 'baseline',
  backtests: 'baseline',
  'broker-accounts': 'baseline',
  connections: 'baseline',
  discovery: 'baseline',
  'email-deliveries': 'baseline',
  settings: 'baseline',
  'strategy-core': 'baseline',
  'strategy-library': 'baseline',
  'suggested-trades': 'baseline',
  watchlists: 'baseline',
  signals: 'module-only',
  'broker-assets': 'module-only',
  'scheduler-account-scope': 'baseline',
  'positions-orders-sync': 'baseline',
  'positions-scheduler': 'cross-cutting',
  'funds-scheduler': 'cross-cutting',
  'risk-scheduler': 'baseline',
  schedulers: 'cross-cutting',
  'orders-scheduler': 'cross-cutting',
  timezones: 'cross-cutting',
  positions: 'cross-cutting',
  portfolio: 'cross-cutting',
  'risk-center': 'cross-cutting',
  overview: 'baseline',
  operational: 'cross-cutting',
  'runtime-recovery': 'cross-cutting',
};

const SUITES: Record<string, SuiteEntry[]> = {
  'core-contracts': [
    'test:auth-contract',
    'test:overview-contract',
    'test:orders-contract',
    'test:risk-center-contract',
  ],
  'coverage-audit': ['test:coverage-audit'],
  'aggregate-catchall': ['test:services', 'test:controllers'],
  'release-baseline': [
    'test:core-contracts',
    'test:coverage-audit',
    'test:activity',
    'test:alerts',
    'test:markets',
    'test:assets',
    'test:wallets',
    'test:funds-snapshots',
    'test:broker-reconciliation-storage',
    'test:mudrex-reconciliation-sync',
    'test:delta-reconciliation-sync',
    'test:broker-reconciliation-match',
    'test:broker-reconciliation-read',
    'test:broker-reconciliation-batch',
    'test:broker-reconciliation-scheduler',
    'test:automations',
    'test:backtests',
    'test:broker-accounts',
    'test:connections',
    'test:discovery',
    'test:email-deliveries',
    'test:settings',
    'test:strategy-core',
    'test:strategy-library',
    'test:suggested-trades',
    'test:watchlists',
    'test:orders',
    'test:overview',
    'test:positions-orders-sync',
    'test:scheduler-account-scope',
    'test:asset-price-sync',
    'test:risk-scheduler',
    'test:global-system-schedulers',
    'test:runtime-recovery',
  ],
  'module-only': ['test:signals', 'test:broker-assets'],
  activity: ['test:activity'],
  alerts: ['test:alerts'],
  markets: ['test:markets'],
  assets: ['test:assets'],
  wallets: ['test:wallets'],
  'funds-snapshots': ['test:funds-snapshots'],
  'broker-reconciliation-storage': ['test:broker-reconciliation-storage'],
  'mudrex-reconciliation-sync': ['test:mudrex-reconciliation-sync'],
  'delta-reconciliation-sync': ['test:delta-reconciliation-sync'],
  'broker-reconciliation-match': ['test:broker-reconciliation-match'],
  'broker-reconciliation-read': ['test:broker-reconciliation-read'],
  'broker-reconciliation-batch': ['test:broker-reconciliation-batch'],
  'broker-reconciliation-scheduler': ['test:broker-reconciliation-scheduler'],
  orders: ['test:orders'],
  automations: ['test:automations'],
  backtests: ['test:backtests'],
  'broker-accounts': ['test:broker-accounts'],
  connections: ['test:connections'],
  discovery: ['test:discovery'],
  'email-deliveries': ['test:email-deliveries'],
  settings: ['test:settings'],
  'strategy-core': ['test:strategy-core'],
  'strategy-library': ['test:strategy-library'],
  'suggested-trades': ['test:suggested-trades'],
  watchlists: ['test:watchlists'],
  signals: ['test:signals'],
  'broker-assets': ['test:broker-assets'],
  'scheduler-account-scope': ['test:scheduler-account-scope'],
  'positions-orders-sync': ['test:positions-orders-sync'],
  'positions-scheduler': ['test:positions-scheduler'],
  'funds-scheduler': ['test:funds-scheduler'],
  'risk-scheduler': ['test:risk-scheduler'],
  schedulers: ['test:schedulers'],
  'orders-scheduler': ['test:orders-scheduler'],
  timezones: [
    'test:legacy-scheduler-timezones',
    'test:mysql-session-timezone',
    'test:api-display-timezones',
    'test:timezone-boundaries',
  ],
  positions: ['test:positions'],
  portfolio: ['test:portfolio'],
  'risk-center': ['test:risk-center'],
  overview: ['test:overview'],
  operational: [
    'test:auth-security',
    'test:operational-events',
    'test:operational-audit',
    'test:runtime-recovery',
  ],
  'runtime-recovery': ['test:runtime-recovery'],
};

function runEntry(entry: SuiteEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = typeof entry === 'string' ? resolveTestCommand(entry) : entry;
    const child = spawn(command[0], command.slice(1), {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command.join(' ')} terminated by signal ${signal}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`${command.join(' ')} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const suiteName = process.argv[2];
  if (!suiteName) {
    throw new Error(`Missing suite name. Expected one of: ${Object.keys(SUITES).join(', ')}`);
  }

  if (suiteName === '--list') {
    console.log(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(SUITE_ROLES).map(([name, role]) => [
            name,
            { role, entries: SUITES[name] || [] },
          ])
        ),
        null,
        2
      )
    );
    return;
  }

  const entries = SUITES[suiteName];
  if (!entries) {
    throw new Error(
      `Unknown suite "${suiteName}". Expected one of: ${Object.keys(SUITES).join(', ')}`
    );
  }

  for (const entry of entries) {
    await runEntry(entry);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
