import { spawn } from 'node:child_process';

type EnvMap = Record<string, string | undefined>;

function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[suggested-trades-proof] ${label}`);

    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${String(code)}`));
    });
  });
}

async function run(): Promise<void> {
  await runStep('lifecycle smoke', 'scripts/smokes/smoke-suggested-trades-lifecycle.ts');
  await runStep('health threshold check', 'scripts/checks/check-suggested-trades-health.ts');
  await runStep(
    'protection dry-run audit',
    'scripts/checks/check-suggested-trades-protection-dry-run.ts'
  );
  await runStep(
    'protection recovery freshness',
    'scripts/checks/check-suggested-trades-protection-recovery.ts'
  );
  await runStep(
    'protection action report',
    'scripts/checks/check-suggested-trades-protection-actions.ts'
  );
  await runStep(
    'protection guardrail gate',
    'scripts/checks/check-suggested-trades-protection-guardrails.ts'
  );
  await runStep(
    'Mudrex position resolution gate',
    'scripts/checks/check-suggested-trades-mudrex-position-resolution.ts'
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
