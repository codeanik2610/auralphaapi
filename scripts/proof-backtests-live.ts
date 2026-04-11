import { spawn } from 'node:child_process';

type EnvMap = Record<string, string | undefined>;

function runStep(label: string, scriptPath: string, envOverrides: EnvMap = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[backtests-proof] ${label}`);

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
  await runStep('lifecycle smoke', 'scripts/smoke-backtests-lifecycle.ts', {
    SMOKE_REQUIRE_BACKTEST_CHART:
      process.env.SMOKE_REQUIRE_BACKTEST_CHART || 'true',
  });

  await runStep('health threshold check', 'scripts/check-backtests-health.ts');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
