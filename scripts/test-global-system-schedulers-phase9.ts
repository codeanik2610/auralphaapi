import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function main(): Promise<void> {
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const phase8Doc = await readFile(
    path.join(process.cwd(), 'GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md'),
    'utf8'
  );
  const phase9Doc = await readFile(
    path.join(process.cwd(), 'GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md'),
    'utf8'
  );
  const captureSource = await readFile(
    path.join(process.cwd(), 'scripts', 'capture-global-system-schedulers-evidence.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gate-global-system-schedulers.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoff-global-system-schedulers.ts'),
    'utf8'
  );
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proof-global-system-schedulers-live.ts'),
    'utf8'
  );

  assert.equal(
    packageSource.includes('"capture:global-system-schedulers-evidence"'),
    true,
    'package.json must expose the global system scheduler evidence capture command in Phase 9'
  );
  assert.equal(
    packageSource.includes('"test:global-system-schedulers-phase9"'),
    true,
    'package.json must expose the global system scheduler Phase 9 guard in Phase 9'
  );
  assert.equal(
    packageSource.includes('npm run test:global-system-schedulers-phase9'),
    true,
    'test:all must include the Phase 9 global system scheduler guard'
  );
  assert.equal(
    readmeSource.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md'),
    true,
    'README.md must point to the Phase 9 global system scheduler workflow note'
  );
  assert.equal(
    readmeSource.includes('capture:global-system-schedulers-evidence'),
    true,
    'README.md must reference the global system scheduler evidence capture command'
  );
  assert.equal(
    phase8Doc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE8.md must keep the Phase 9 handoff checklist'
  );
  assert.equal(
    phase9Doc.includes('npm run capture:global-system-schedulers-evidence'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md must document the evidence capture command'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:global-system-schedulers-live'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md must document the live proof command'
  );
  assert.equal(
    phase9Doc.includes('real deployment-proof'),
    true,
    'GLOBAL_SYSTEM_SCHEDULERS_PHASE9.md must record the real deployment-proof posture'
  );
  assert.equal(
    captureSource.includes('artifacts/global-system-schedulers-workflow-evidence.json'),
    true,
    'capture-global-system-schedulers-evidence.ts must write the workflow evidence artifact'
  );
  assert.equal(
    captureSource.includes('artifacts/global-system-schedulers-dashboard-evidence.json'),
    true,
    'capture-global-system-schedulers-evidence.ts must write the dashboard evidence artifact'
  );
  assert.equal(
    captureSource.includes('/scheduler/overview'),
    true,
    'capture-global-system-schedulers-evidence.ts must capture shared scheduler overview evidence'
  );
  assert.equal(
    captureSource.includes('/health/worker'),
    true,
    'capture-global-system-schedulers-evidence.ts must capture worker health evidence'
  );
  assert.equal(
    releaseGateSource.includes('backend-global-system-schedulers-phase9'),
    true,
    'release gate must include the Phase 9 global system scheduler suite'
  );
  assert.equal(
    releaseGateSource.includes('scripts/capture-global-system-schedulers-evidence.ts'),
    true,
    'release gate lint coverage must include the evidence capture script'
  );
  assert.equal(
    signoffSource.includes('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE'),
    true,
    'signoff-global-system-schedulers.ts must support deployment-evidence requirements in Phase 9'
  );
  assert.equal(
    signoffSource.includes('deploymentEvidenceReady'),
    true,
    'signoff-global-system-schedulers.ts must compute deployment evidence readiness in Phase 9'
  );
  assert.equal(
    proofSource.includes('GLOBAL_SYSTEM_SCHEDULERS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE'),
    true,
    'proof-global-system-schedulers-live.ts must forward the deployment-evidence requirement in Phase 9'
  );
  assert.equal(
    proofSource.includes('productionPromotionReady'),
    true,
    'proof-global-system-schedulers-live.ts must require promotion-ready signoff in Phase 9'
  );

  console.log('Global system schedulers Phase 9 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
