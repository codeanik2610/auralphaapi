import { spawn } from 'node:child_process';

type EnvMap = Record<string, string | undefined>;

function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[automations-proof] ${label}`);

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
  await runStep('lifecycle smoke', 'scripts/smokes/smoke-automations-lifecycle.ts');
  await runStep('health threshold check', 'scripts/checks/check-automations-health.ts');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
