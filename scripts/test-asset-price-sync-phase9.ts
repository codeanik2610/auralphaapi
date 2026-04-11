import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const phase8Doc = await readFile(
    path.join(process.cwd(), 'ASSET_PRICE_SYNC_PHASE8.md'),
    'utf8'
  );
  const phase9Doc = await readFile(
    path.join(process.cwd(), 'ASSET_PRICE_SYNC_PHASE9.md'),
    'utf8'
  );
  const captureSource = await readFile(
    path.join(process.cwd(), 'scripts', 'capture-asset-price-sync-evidence.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-asset-price-sync.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-asset-price-sync.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-asset-price-sync-live.ts'),
    'utf8'
  );

  assert.equal(
    packageSource.includes('"capture:asset-price-sync-evidence"'),
    true,
    'package.json must expose the asset-price-sync evidence capture command in Phase 9'
  );
  assert.equal(
    packageSource.includes('"test:asset-price-sync-phase9"'),
    true,
    'package.json must expose the asset-price-sync Phase 9 guard in Phase 9'
  );
  assert.equal(
    packageSource.includes('npm run test:asset-price-sync-phase9'),
    true,
    'test:all must include the Phase 9 asset-price-sync guard'
  );
  assert.equal(
    readmeSource.includes('ASSET_PRICE_SYNC_PHASE9.md'),
    true,
    'README.md must point to the Phase 9 asset-price-sync workflow note'
  );
  assert.equal(
    readmeSource.includes('capture:asset-price-sync-evidence'),
    true,
    'README.md must reference the asset-price-sync evidence capture command'
  );
  assert.equal(
    phase8Doc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'ASSET_PRICE_SYNC_PHASE8.md must keep the Phase 9 handoff checklist'
  );
  assert.equal(
    phase9Doc.includes('npm run capture:asset-price-sync-evidence'),
    true,
    'ASSET_PRICE_SYNC_PHASE9.md must document the evidence capture command'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:asset-price-sync-live'),
    true,
    'ASSET_PRICE_SYNC_PHASE9.md must document the live proof command'
  );
  assert.equal(
    phase9Doc.includes('bounded thresholds'),
    true,
    'ASSET_PRICE_SYNC_PHASE9.md must record the bounded-threshold posture'
  );
  assert.equal(
    captureSource.includes('artifacts/asset-price-sync-workflow-evidence.json'),
    true,
    'capture-asset-price-sync-evidence.ts must write the workflow evidence artifact'
  );
  assert.equal(
    captureSource.includes('artifacts/asset-price-sync-dashboard-evidence.json'),
    true,
    'capture-asset-price-sync-evidence.ts must write the dashboard evidence artifact'
  );
  assert.equal(
    captureSource.includes('/scheduler/asset-price/assets'),
    true,
    'capture-asset-price-sync-evidence.ts must capture the scope assets evidence path'
  );
  assert.equal(
    captureSource.includes('/scheduler/overview'),
    true,
    'capture-asset-price-sync-evidence.ts must capture scheduler overview evidence'
  );
  assert.equal(
    releaseGateSource.includes('backend-asset-price-sync-phase9'),
    true,
    'release gate must include the Phase 9 asset-price-sync suite'
  );
  assert.equal(
    releaseGateSource.includes('scripts/capture-asset-price-sync-evidence.ts'),
    true,
    'release gate lint coverage must include the asset-price-sync evidence capture script'
  );
  assert.equal(
    signoffSource.includes('ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE'),
    true,
    'signoff-asset-price-sync.ts must support deployment-evidence requirements in Phase 9'
  );
  assert.equal(
    signoffSource.includes('deploymentEvidenceReady'),
    true,
    'signoff-asset-price-sync.ts must compute deployment evidence readiness in Phase 9'
  );
  assert.equal(
    signoffSource.includes(
      'const proof = REQUIRE_LIVE_PROOF ? await readOptionalProofSummary() : null;'
    ),
    true,
    'signoff-asset-price-sync.ts must ignore stale proof files unless live-proof review is required in Phase 9'
  );
  assert.equal(
    proofSource.includes('ASSET_PRICE_SYNC_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE'),
    true,
    'proof-asset-price-sync-live.ts must forward the deployment-evidence requirement in Phase 9'
  );
  assert.equal(
    proofSource.includes('deploymentPromotionReady'),
    true,
    'proof-asset-price-sync-live.ts must require promotion-ready signoff in Phase 9'
  );

  console.log('Asset price sync Phase 9 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
