export function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function resolveTestCommand(scriptName: string): string[] {
  return [npmBin(), 'run', scriptName];
}
