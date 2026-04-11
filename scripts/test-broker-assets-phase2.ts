import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE2_AUDIT.md');
  for (const marker of [
    'Phase 2 does not change runtime behavior.',
    '`ExchangeAssetsService` is the only runtime writer still creating',
    '`ExchangeAssetRepository.replaceSystemAssets()` already exists',
    '`src/api/services/ConnectionsService.ts`',
    '`src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts`',
    'visibility derived from `Connected` accounts only',
    'Phase 3 should update or replace that guard',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`BROKER_ASSETS_PHASE2_AUDIT.md: missing audit marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('BROKER_ASSETS_PHASE4.md')) {
    findings.push('README.md: missing broker assets Phase 4 cleanup reference');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:broker-assets-phase2"')) {
    findings.push('package.json: missing broker assets Phase 2 test script');
  }
  if (!read('BROKER_ASSETS_PHASE3.md').includes('Phase 3 aligns the runtime')) {
    findings.push('BROKER_ASSETS_PHASE3.md: missing Phase 3 handoff after the Phase 2 audit');
  }
  if (!read('BROKER_ASSETS_PHASE4.md').includes('Phase 4 removes the last legacy user-ownership schema')) {
    findings.push('BROKER_ASSETS_PHASE4.md: missing Phase 4 handoff after the Phase 2 audit');
  }

  assert.equal(findings.length, 0, `Broker assets Phase 2 audit guard failed:\n${findings.join('\n')}`);
  console.log('Broker assets Phase 2 audit guard passed.');
}

run();
