import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertOrdersHealthSnapshot,
  buildOrdersHealthSnapshot,
} from './check-orders-health';

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

async function runHealthAssertionChecks(): Promise<void> {
  const snapshot = buildOrdersHealthSnapshot({
    baseUrl: 'http://127.0.0.1:3000/api/v1',
    overviewDurationMs: 900,
    paperDurationMs: 650,
    productSyncDurationMs: 420,
    productRefreshDurationMs: 510,
    nowMs: new Date('2026-04-10T12:05:00.000Z').getTime(),
    overviewPayload: {
      data: {
        meta: {
          contractVersion: 'orders-overview-phase9-2026-04-10',
          purpose: 'global_execution_console',
          capabilities: {
            embeddedSyncStatus: true,
            canonicalDetailFetchUsedByPage: true,
            localPaperWriteReconciliationUsedByPage: true,
            targetedLiveSyncPollingUsedByPage: true,
          },
          pageTruth: {
            detailDrawerSource: 'canonical_detail_fetch_with_row_fallback',
            liveWriteFlow: 'broker_write_with_snapshot_ack_polling',
            paperWriteFlow: 'db_write_with_local_reconciliation',
          },
        },
        syncStatus: {
          state: 'healthy',
          summary: 'Desk sync is healthy',
          scope: 'desk',
          items: [{ routeKey: 'mudrex:acct-1' }],
        },
        openOrders: {
          rowModel: 'normalized_live_snapshot',
          latestSnapshotAt: '2026-04-10T12:00:00.000Z',
          items: [
            {
              id: 'live-1',
              brokerKey: 'mudrex',
              accountId: 'acct-1',
            },
          ],
        },
        history: {
          rowModel: 'normalized_live_snapshot',
          items: [
            {
              id: 'hist-1',
            },
          ],
        },
      },
    },
    paperPayload: {
      data: [
        {
          id: 'paper-1',
        },
      ],
    },
    productSyncPayload: {
      data: {
        state: 'healthy',
        label: 'Healthy',
        summary: 'Orders desk sync healthy',
        scope: 'desk',
        totalAccounts: 1,
        pendingRecords: 0,
        failedRecords: 0,
        latestSnapshotAt: '2026-04-10T12:01:00.000Z',
        items: [{ routeKey: 'mudrex:acct-1' }],
      },
    },
    productRefreshPayload: {
      data: {
        requested: true,
        scope: 'desk',
        state: 'requested',
      },
    },
    liveDetailPayload: {
      data: {
        id: 'live-1',
        source: 'scheduler_orders_snapshots',
        brokerKey: 'mudrex',
        accountId: 'acct-1',
        snapshot: {
          lastSeenAt: '2026-04-10T12:02:00.000Z',
        },
        detailMeta: {
          sourceKind: 'snapshot_backed_live',
        },
      },
    },
    paperDetailPayload: {
      data: {
        id: 'paper-1',
        source: 'paper_orders',
        lifecycle: {
          stage: 'filled',
          terminal: true,
          lastTransition: {
            type: 'fill',
          },
        },
        detailMeta: {
          sourceKind: 'paper_simulation',
        },
        execution_history: [
          {
            id: 'exec-1',
          },
        ],
      },
    },
  });

  assert.equal(snapshot.embeddedSyncStatus, true);
  assert.equal(snapshot.productSyncSnapshot?.scope, 'desk');
  assert.equal(snapshot.productSyncSnapshot?.items, 1);
  assert.equal(snapshot.firstOpenOrderId, 'live-1');
  assert.equal(snapshot.firstPaperOrderId, 'paper-1');
  assert.equal(snapshot.openSnapshotAgeMs, 300000);

  assertOrdersHealthSnapshot(snapshot, {
    maxOverviewMs: 1200,
    maxPaperMs: 900,
    maxSyncStatusMs: 600,
    maxRefreshMs: 700,
    maxOpenSnapshotAgeMs: 400000,
    requireNormalizedOverview: true,
    requirePhase5WriteFlows: true,
    requireDetailConsistencyIfOpen: true,
    requirePaperLifecycleIfPresent: true,
    requireProductSyncChecks: true,
  });
}

async function runSignoffChecks(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'orders-phase7-'));
  const gateFile = path.join(tempDir, 'orders-release-gate.json');
  const outputFile = path.join(tempDir, 'orders-signoff.json');

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: false,
    totals: {
      total: 8,
      passed: 8,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-orders-contract',
      'backend-orders-phase7',
      'backend-orders-phase8',
      'backend-orders-controllers',
      'backend-orders-eslint',
      'frontend-orders-eslint',
      'frontend-orders-ui',
      'frontend-orders-e2e',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(process.execPath, ['--import', 'tsx', 'scripts/signoff-orders.ts'], {
    ...process.env,
    ORDERS_SIGNOFF_GATE_FILE: gateFile,
    ORDERS_SIGNOFF_OUTPUT_FILE: outputFile,
    ORDERS_SIGNOFF_EXTERNAL_DASHBOARDS_VERIFIED: 'true',
    ORDERS_SIGNOFF_WRITE_READ_CONSISTENCY_VERIFIED: 'true',
    ORDERS_SIGNOFF_SNAPSHOT_LAG_RUNBOOK_VERIFIED: 'true',
    ORDERS_SIGNOFF_OPERATOR_FLOWS_VERIFIED: 'true',
    ORDERS_SIGNOFF_SYNC_STATUS_VERIFIED: 'true',
    ORDERS_SIGNOFF_MANUAL_REFRESH_VERIFIED: 'true',
    ORDERS_SIGNOFF_APPROVER: 'codex-phase7',
  });

  assert.equal(exitCode, 0, 'orders signoff script should succeed against a ready gate');

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase7');
  assert.equal(summary.checks.requiredSuitesPassed, true);
  assert.equal(summary.checks.syncStatusVerified, true);
  assert.equal(summary.checks.manualRefreshVerified, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'check-orders-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-orders.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-orders.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');

  assert.equal(
    healthSource.includes('export function buildOrdersHealthSnapshot'),
    true,
    'orders health script must export buildOrdersHealthSnapshot for Phase 7 checks'
  );
  assert.equal(
    healthSource.includes('export function assertOrdersHealthSnapshot'),
    true,
    'orders health script must export assertOrdersHealthSnapshot for Phase 7 checks'
  );
  assert.equal(
    healthSource.includes("const isDirectRun = (() => {"),
    true,
    'orders health script must only auto-run when invoked directly'
  );
  assert.equal(
    releaseGateSource.includes('backend-orders-phase7'),
    true,
    'release gate must include the Phase 7 orders suite'
  );
  assert.equal(
    releaseGateSource.includes('backend-orders-phase8'),
    true,
    'release gate must include the Phase 8 orders suite'
  );
  assert.equal(
    releaseGateSource.includes('backend-orders-controllers'),
    true,
    'release gate must include the orders controller suite'
  );
  assert.equal(
    signoffSource.includes('backend-orders-phase7'),
    true,
    'orders signoff must require the Phase 7 gate result'
  );
  assert.equal(
    signoffSource.includes('backend-orders-phase8'),
    true,
    'orders signoff must require the Phase 8 gate result'
  );
  assert.equal(
    signoffSource.includes('backend-orders-controllers'),
    true,
    'orders signoff must require the controller gate result'
  );
  assert.equal(
    signoffSource.includes('ORDERS_SIGNOFF_SYNC_STATUS_VERIFIED'),
    true,
    'orders signoff must require sync-status verification'
  );
  assert.equal(
    signoffSource.includes('ORDERS_SIGNOFF_MANUAL_REFRESH_VERIFIED'),
    true,
    'orders signoff must require manual refresh verification'
  );
  assert.equal(
    packageSource.includes('"test:orders-phase7"'),
    true,
    'package.json must include "test:orders-phase7" for the Orders Phase 7 workflow'
  );
  assert.equal(
    packageSource.includes('npm run test:orders-phase7 && npm run test:orders-phase8'),
    true,
    'test:all must run the Phase 7 and Phase 8 orders suites together'
  );
}

async function main(): Promise<void> {
  await runHealthAssertionChecks();
  await runSignoffChecks();
  await runSourceMarkerAssertions();
  console.log('Orders Phase 7 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
