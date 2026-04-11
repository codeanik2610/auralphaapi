import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function run(): Promise<void> {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE6.md');
  for (const marker of [
    'Phase 6 archives the rollout history and adds a live operational proof path for',
    '`npm run test:broker-assets-history`',
    '`npm run check:broker-assets-health`',
    '`npm run proof:broker-assets-live`',
    'The compatibility symbols `ExchangeAsset`, `ExchangeAssetRepository`, and',
    '## Phase 7 Entry Checklist',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`BROKER_ASSETS_PHASE6.md: missing Phase 6 marker ${marker}`);
    }
  }

  if (!read('BROKER_ASSETS_PHASE5.md').includes('BROKER_ASSETS_PHASE6.md')) {
    findings.push('BROKER_ASSETS_PHASE5.md: missing Phase 6 handoff');
  }

  const packageSource = read('package.json');
  for (const marker of [
    '"test:broker-assets-history"',
    '"test:broker-assets-phase6"',
    '"check:broker-assets-health"',
    '"proof:broker-assets-live"',
  ]) {
    if (!packageSource.includes(marker)) {
      findings.push(`package.json: missing Phase 6 script ${marker}`);
    }
  }
  if (!packageSource.includes('npm run test:broker-assets-phase6')) {
    findings.push('package.json: test:broker-assets must include the Phase 6 guard');
  }
  if (!packageSource.includes('npm run test:broker-assets-phase1 && npm run test:broker-assets-phase2')) {
    findings.push('package.json: test:broker-assets-history should preserve the Phase 1-4 chain');
  }
  if (!packageSource.includes('npm run test:broker-assets && npm run type-check')) {
    findings.push('package.json: test:all should stay on the steady-state broker-assets umbrella');
  }
  if (packageSource.includes('npm run test:broker-assets-history && npm run type-check')) {
    findings.push('package.json: test:all should not depend on the archived broker-assets history chain');
  }

  const healthScript = read('scripts/check-broker-assets-health.ts');
  for (const marker of [
    '/health/queue',
    '/health/worker',
    '/scheduler/exchange-assets/config',
    '/scheduler/exchange-assets/assets',
    '/exchange-assets',
    'broker-assets-sync',
    'scheduler.exchange-assets.execute',
    'broker-assets-health-check:',
  ]) {
    if (!healthScript.includes(marker)) {
      findings.push(`check-broker-assets-health.ts: missing Phase 6 marker ${marker}`);
    }
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  for (const marker of [
    'connection.user_id = :visibleUserId',
    'connection.broker_id IS NOT NULL AND connection.broker_id = asset.broker_id',
    'account.user_id = :visibleUserId',
    'account.broker_id IS NOT NULL AND account.broker_id = asset.broker_id',
    "asset.symbol IN (:...symbols)",
  ]) {
    if (!repositorySource.includes(marker)) {
      findings.push(`ExchangeAssetRepository.ts: missing Phase 6 regression marker ${marker}`);
    }
  }

  const proofScript = read('scripts/proof-broker-assets-live.ts');
  for (const marker of [
    'scripts/release-gate-broker-assets.ts',
    'scripts/check-broker-assets-health.ts',
    'artifacts/broker-assets-release-gate.json',
    'artifacts/broker-assets-health.json',
    'artifacts/broker-assets-live-proof.json',
    'broker-assets-live-proof:',
  ]) {
    if (!proofScript.includes(marker)) {
      findings.push(`proof-broker-assets-live.ts: missing Phase 6 marker ${marker}`);
    }
  }

  assert.equal(findings.length, 0, `Broker assets Phase 6 guard failed:\n${findings.join('\n')}`);
  console.log('Broker assets Phase 6 guard passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
