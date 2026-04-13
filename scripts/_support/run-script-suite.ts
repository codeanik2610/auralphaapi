import { spawn } from 'node:child_process';

async function runScript(scriptPath: string, extraArgs: string[] = []): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/_support/run-doc-aware-test.ts', scriptPath, ...extraArgs],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      }
    );

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${scriptPath} terminated by signal ${signal}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`${scriptPath} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

export async function runScriptSuite(
  suiteLabel: string,
  scriptPaths: string[]
): Promise<void> {
  for (const scriptPath of scriptPaths) {
    await runScript(scriptPath);
  }
  console.log(`${suiteLabel} assertions passed.`);
}

export async function runSuiteSteps(
  suiteLabel: string,
  suitePath: string,
  stepKeys: string[]
): Promise<void> {
  for (const stepKey of stepKeys) {
    await runScript(suitePath, [stepKey]);
  }
  console.log(`${suiteLabel} assertions passed.`);
}
