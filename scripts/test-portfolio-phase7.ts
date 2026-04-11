import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertPortfolioHealthSnapshot,
  buildPortfolioHealthSnapshot,
} from './check-portfolio-health';

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
  const snapshot = buildPortfolioHealthSnapshot({
    baseUrl: 'http://127.0.0.1:3000/api/v1',
    overviewDurationMs: 1200,
    performanceDurationMs: 800,
    overviewPayload: {
      data: {
        meta: {
          contractVersion: 'portfolio-overview-phase6-2026-04-10',
          purpose: 'operator_portfolio_workspace',
          pageHydration: 'single-request',
          capabilities: {
            indexedSnapshotReads: true,
            activityReadModelAcceleration: true,
            portfolioHealthChecks: true,
            shareableWorkspaceState: true,
            rebalanceReviewWorkflow: true,
            workspaceReportGeneration: true,
            liveSnapshotReconciliationPolicy: true,
            exportReport: true,
          },
          reconciliationPolicy: {
            mode: 'manual_workspace_review',
          },
          warnings: [],
        },
        summary: {
          source: 'portfolio_snapshots',
        },
        performance: {
          source: 'scheduler_positions_snapshots',
        },
        holdings: {
          total: 2,
        },
        snapshots: {
          total: 4,
        },
      },
    },
    performancePayload: {
      data: {
        source: 'scheduler_positions_snapshots',
        points: [{ date: '2026-04-10', pnl: 12 }],
        summary: {
          totalTrades: 3,
        },
      },
    },
  });

  assert.equal(snapshot.shareableWorkspaceState, true);
  assert.equal(snapshot.rebalanceReviewWorkflow, true);
  assert.equal(snapshot.workspaceReportGeneration, true);
  assert.equal(snapshot.liveSnapshotReconciliationPolicy, true);
  assert.equal(snapshot.exportReport, true);
  assert.equal(snapshot.reconciliationMode, 'manual_workspace_review');

  assertPortfolioHealthSnapshot(snapshot, {
    maxOverviewMs: 1500,
    maxPerformanceMs: 1000,
  });
}

async function runSignoffChecks(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'portfolio-phase7-'));
  const gateFile = path.join(tempDir, 'portfolio-release-gate.json');
  const outputFile = path.join(tempDir, 'portfolio-signoff.json');

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: false,
    totals: {
      total: 12,
      passed: 12,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-portfolio-phase1',
      'backend-portfolio-phase2',
      'backend-portfolio-phase3',
      'backend-portfolio-phase4',
      'backend-portfolio-phase5',
      'backend-portfolio-phase6',
      'backend-portfolio-phase7',
      'backend-portfolio-phase8',
      'backend-portfolio-eslint',
      'frontend-portfolio-eslint',
      'frontend-portfolio-ui',
      'frontend-portfolio-build',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(process.execPath, ['--import', 'tsx', 'scripts/signoff-portfolio.ts'], {
    ...process.env,
    PORTFOLIO_SIGNOFF_GATE_FILE: gateFile,
    PORTFOLIO_SIGNOFF_OUTPUT_FILE: outputFile,
    PORTFOLIO_SIGNOFF_MANUAL_REVIEW_WORKFLOW_VERIFIED: 'true',
    PORTFOLIO_SIGNOFF_REPORT_EXPORT_VERIFIED: 'true',
    PORTFOLIO_SIGNOFF_SHAREABLE_WORKSPACE_VERIFIED: 'true',
    PORTFOLIO_SIGNOFF_RECONCILIATION_RUNBOOK_VERIFIED: 'true',
    PORTFOLIO_SIGNOFF_APPROVER: 'codex-test',
  });

  assert.equal(exitCode, 0, 'portfolio signoff script should succeed against a ready gate');

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-test');
  assert.equal(summary.checks.manualReviewWorkflowVerified, true);
  assert.equal(summary.checks.reportExportVerified, true);
  assert.equal(summary.checks.shareableWorkspaceVerified, true);
  assert.equal(summary.checks.reconciliationRunbookVerified, true);
}

async function main(): Promise<void> {
  await runHealthAssertionChecks();
  await runSignoffChecks();
  console.log('Portfolio Phase 7 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
