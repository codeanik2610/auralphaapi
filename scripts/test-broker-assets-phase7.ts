import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertBrokerAssetsHealthSnapshot,
  buildBrokerAssetsHealthSnapshot,
} from './check-broker-assets-health';

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

async function runHealthThresholdChecks(): Promise<void> {
  const snapshot = buildBrokerAssetsHealthSnapshot({
    baseUrl: 'http://127.0.0.1:3000/api/v1',
    queuePayload: {
      data: {
        status: 'ok',
        queue: 'scheduler.exchange-assets.execute',
        latencyMs: 42,
      },
    },
    workerPayload: {
      data: {
        status: 'ok',
        workerHttpStatus: 'ok',
        heartbeatAgeMs: 2500,
      },
    },
    configPayload: {
      data: {
        key: 'broker-assets-sync',
        schedulerType: 'global',
        enabled: false,
        timezone: 'UTC',
        sources: ['mudrex', 'delta_exchange'],
      },
    },
    adminCatalogPayload: {
      data: {
        total: 480,
        items: [
          {
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
        ],
      },
    },
    adminCatalogLatencyMs: 320,
    visiblePayload: {
      data: {
        total: 12,
        assets: [
          {
            source: 'mudrex',
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
            isDeltaMapped: true,
            deltaExternalId: 'delta-btc',
            deltaSymbol: 'BTCUSDT',
          },
        ],
      },
    },
    visibleLatencyMs: 180,
    visibleQuerySource: null,
    visibleSearchTerm: 'BTC',
    visibleSearchPayload: {
      data: {
        assets: [
          {
            source: 'mudrex',
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
        ],
      },
    },
    adminSearchTerm: 'BTC',
    adminSearchPayload: {
      data: {
        items: [
          {
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
        ],
      },
    },
    sourceVisibleSummaries: {
      mudrex: {
        source: 'mudrex',
        total: 9,
        count: 5,
        latencyMs: 140,
        firstSymbol: 'BTCUSDT',
      },
      delta_exchange: {
        source: 'delta_exchange',
        total: 3,
        count: 3,
        latencyMs: 160,
        firstSymbol: 'BTCUSDT',
      },
    },
    thresholds: {
      maxAdminCatalogLatencyMs: 1000,
      maxVisibleLatencyMs: 1000,
      minAdminCatalogResults: 100,
      minVisibleResults: 5,
      requiredVisibleSources: ['mudrex', 'delta_exchange'],
      minVisibleResultsBySource: {
        mudrex: 5,
        delta_exchange: 1,
      },
    },
  });

  assert.equal(snapshot.thresholdProfile.mode, 'bounded');
  assert.equal(snapshot.sourceVisibleSummaries.mudrex.total, 9);
  assert.equal(snapshot.sourceVisibleSummaries.delta_exchange.total, 3);
  assertBrokerAssetsHealthSnapshot(snapshot, {
    requireAdminResults: true,
    requireVisibleResults: true,
  });
}

async function runSignoffChecks(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'broker-assets-phase7-'));
  const gateFile = path.join(tempDir, 'broker-assets-release-gate.json');
  const proofFile = path.join(tempDir, 'broker-assets-live-proof.json');
  const outputFile = path.join(tempDir, 'broker-assets-signoff.json');

  const healthSnapshot = {
    schedulerType: 'global',
    queueStatus: 'ok',
    workerStatus: 'ok',
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 6,
      requiredThresholdCount: 6,
      configuredKeys: [
        'maxAdminCatalogLatencyMs',
        'maxVisibleLatencyMs',
        'minAdminCatalogResults',
        'minVisibleResults',
        'minVisibleResultsBySource.mudrex',
        'minVisibleResultsBySource.delta_exchange',
      ],
      missingKeys: [],
    },
  };

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: path.join(tempDir, 'broker-assets-health.json'),
    healthSnapshot,
    totals: {
      total: 7,
      passed: 7,
      failed: 0,
      skipped: 0,
    },
    results: [
      'backend-broker-assets-contract',
      'backend-broker-assets-flow',
      'backend-broker-assets-phase6',
      'backend-broker-assets-phase7',
      'backend-broker-assets-phase8',
      'backend-broker-assets-eslint',
      'backend-broker-assets-live-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };
  const proofSummary = {
    decision: 'ready',
    gateDecision: 'ready',
    healthSnapshot,
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');
  await writeFile(proofFile, `${JSON.stringify(proofSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoff-broker-assets.ts'],
    {
      ...process.env,
      BROKER_ASSETS_SIGNOFF_GATE_FILE: gateFile,
      BROKER_ASSETS_SIGNOFF_PROOF_FILE: proofFile,
      BROKER_ASSETS_SIGNOFF_OUTPUT_FILE: outputFile,
      BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_HEALTH: 'true',
      BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF: 'true',
      BROKER_ASSETS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE: 'true',
      BROKER_ASSETS_SIGNOFF_GLOBAL_CATALOG_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_CONNECTED_VISIBILITY_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_DELTA_LOOKUP_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED: 'true',
      BROKER_ASSETS_SIGNOFF_APPROVER: 'codex-phase7',
      BROKER_ASSETS_SIGNOFF_STAGING_WORKFLOW_URL: 'https://example.com/workflows/broker-assets',
      BROKER_ASSETS_SIGNOFF_DASHBOARD_URL: 'https://example.com/dashboards/broker-assets',
      BROKER_ASSETS_SIGNOFF_RUNBOOK_URL: 'https://example.com/runbooks/broker-assets',
      BROKER_ASSETS_SIGNOFF_RELEASE_NOTE_URL: 'https://example.com/releases/broker-assets',
    }
  );

  assert.equal(exitCode, 0, 'broker-assets signoff script should succeed against a ready gate');

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
    readiness: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase7');
  assert.equal(summary.checks.requiredSuitesPassed, true);
  assert.equal(summary.checks.liveHealthReviewed, true);
  assert.equal(summary.checks.liveProofReviewed, true);
  assert.equal(summary.readiness.productionPromotionReady, true);
}

async function runSourceMarkerAssertions(): Promise<void> {
  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'check-broker-assets-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-broker-assets.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-broker-assets.ts'),
    'utf8'
  );
  const auditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(path.join(process.cwd(), 'BROKER_ASSETS_PHASE7.md'), 'utf8');
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'BROKER_ASSETS_PHASE6.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    healthSource.includes('export function resolveBrokerAssetsHealthThresholds'),
    true,
    'broker-assets health script must export threshold resolution helpers for Phase 7 checks'
  );
  assert.equal(
    healthSource.includes('export function buildBrokerAssetsHealthThresholdProfile'),
    true,
    'broker-assets health script must export threshold profile helpers for Phase 7 checks'
  );
  assert.equal(
    healthSource.includes('const isDirectRun = (() => {'),
    true,
    'broker-assets health script must only auto-run when invoked directly'
  );
  assert.equal(
    releaseGateSource.includes('backend-broker-assets-phase7'),
    true,
    'broker-assets release gate must include the Phase 7 suite'
  );
  assert.equal(
    releaseGateSource.includes('BROKER_ASSETS_RUN_LIVE_CHECKS'),
    true,
    'broker-assets release gate must support optional live checks'
  );
  assert.equal(
    releaseGateSource.includes('backend-broker-assets-live-health'),
    true,
    'broker-assets release gate must expose a live health check key'
  );
  assert.equal(
    signoffSource.includes('BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF'),
    true,
    'broker-assets signoff must support optional live proof enforcement'
  );
  assert.equal(
    signoffSource.includes('BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED'),
    true,
    'broker-assets signoff must require threshold verification'
  );
  assert.equal(
    signoffSource.includes('BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED'),
    true,
    'broker-assets signoff must require provider identity review'
  );
  assert.equal(
    auditSource.includes('"signoff:broker-assets"'),
    true,
    'operational audit must treat broker-assets signoff as a required workflow surface'
  );
  assert.equal(
    packageSource.includes('"test:broker-assets-phase7"'),
    true,
    'package.json must include the Phase 7 broker-assets suite'
  );
  assert.equal(
    packageSource.includes('"signoff:broker-assets"'),
    true,
    'package.json must include broker-assets signoff'
  );
  assert.equal(
    packageSource.includes('npm run test:broker-assets-phase6 && npm run test:broker-assets-phase7'),
    true,
    'test:broker-assets must run the Phase 6 and Phase 7 broker-assets guards together'
  );
  assert.equal(
    phaseDoc.includes('Phase 7 turns broker-assets into a release-ready workflow'),
    true,
    'BROKER_ASSETS_PHASE7.md must document the Phase 7 release workflow'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 8'),
    true,
    'BROKER_ASSETS_PHASE7.md must include the Phase 8 handoff checklist'
  );
  assert.equal(
    previousPhaseDoc.includes('BROKER_ASSETS_PHASE7.md'),
    true,
    'BROKER_ASSETS_PHASE6.md must point forward to the Phase 7 handoff'
  );
  assert.equal(
    readmeSource.includes('BROKER_ASSETS_PHASE7.md') ||
      readmeSource.includes('BROKER_ASSETS_PHASE8.md') ||
      readmeSource.includes('BROKER_ASSETS_PHASE9.md'),
    true,
    'README.md must reference a broker-assets release workflow note'
  );
}

async function run(): Promise<void> {
  await runHealthThresholdChecks();
  await runSignoffChecks();
  await runSourceMarkerAssertions();
  console.log('Broker assets Phase 7 assertions passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
