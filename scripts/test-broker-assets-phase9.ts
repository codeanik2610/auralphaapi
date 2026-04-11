import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const phase8Doc = await readFile(path.join(process.cwd(), 'BROKER_ASSETS_PHASE8.md'), 'utf8');
  const phase9Doc = await readFile(path.join(process.cwd(), 'BROKER_ASSETS_PHASE9.md'), 'utf8');
  const captureSource = await readFile(
    path.join(process.cwd(), 'scripts', 'capture-broker-assets-evidence.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-broker-assets.ts'),
    'utf8'
  );

  assert.equal(
    packageSource.includes('"capture:broker-assets-evidence"'),
    true,
    'package.json must expose the broker-assets evidence capture command in Phase 9'
  );
  assert.equal(
    packageSource.includes('"test:broker-assets-phase9"'),
    true,
    'package.json must expose the broker-assets Phase 9 guard in Phase 9'
  );
  assert.equal(
    packageSource.includes('npm run test:broker-assets-phase9'),
    true,
    'test:broker-assets must include the Phase 9 broker-assets guard'
  );
  assert.equal(
    readmeSource.includes('BROKER_ASSETS_PHASE9.md'),
    true,
    'README.md must point to the Phase 9 broker-assets workflow note'
  );
  assert.equal(
    readmeSource.includes('capture:broker-assets-evidence'),
    true,
    'README.md must reference the broker-assets evidence capture command'
  );
  assert.equal(
    phase8Doc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'BROKER_ASSETS_PHASE8.md must keep the Phase 9 handoff checklist'
  );
  assert.equal(
    phase9Doc.includes('npm run capture:broker-assets-evidence'),
    true,
    'BROKER_ASSETS_PHASE9.md must document the evidence capture command'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:broker-assets-live'),
    true,
    'BROKER_ASSETS_PHASE9.md must document the live proof command'
  );
  assert.equal(
    phase9Doc.includes('bounded thresholds'),
    true,
    'BROKER_ASSETS_PHASE9.md must record the bounded-threshold posture'
  );
  assert.equal(
    captureSource.includes('artifacts/broker-assets-workflow-evidence.json'),
    true,
    'capture-broker-assets-evidence.ts must write the workflow evidence artifact'
  );
  assert.equal(
    captureSource.includes('artifacts/broker-assets-dashboard-evidence.json'),
    true,
    'capture-broker-assets-evidence.ts must write the dashboard evidence artifact'
  );
  assert.equal(
    captureSource.includes('/scheduler/exchange-assets/assets'),
    true,
    'capture-broker-assets-evidence.ts must capture the admin catalog evidence path'
  );
  assert.equal(
    captureSource.includes('/exchange-assets?limit='),
    true,
    'capture-broker-assets-evidence.ts must capture the visible broker-assets evidence path'
  );
  assert.equal(
    signoffSource.includes('const proof = REQUIRE_LIVE_PROOF ? await readOptionalProofSummary() : null;'),
    true,
    'signoff-broker-assets.ts must ignore stale proof files unless live-proof review is required in Phase 9'
  );

  console.log('Broker assets phase 9 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
