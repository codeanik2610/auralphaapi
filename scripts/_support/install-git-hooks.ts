import { execFileSync } from 'node:child_process';

function main(): void {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  console.log('Installed local git hooks path: .githooks');
}

main();
