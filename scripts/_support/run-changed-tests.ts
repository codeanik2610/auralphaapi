import {
  analyzeCoverageChanges,
  collectChangedTestCommands,
  formatCoverageChangeReport,
  parseChangedCoverageArgs,
  runScriptCommands,
} from './coverage-change-tools';

async function main(): Promise<void> {
  const options = parseChangedCoverageArgs(process.argv.slice(2));
  const report = analyzeCoverageChanges(options);
  const commands = collectChangedTestCommands(report);

  console.log(formatCoverageChangeReport(report));

  if (!commands.length) {
    console.log('No impacted test commands to run.');
    return;
  }

  console.log(`Running changed coverage commands: ${commands.join(', ')}`);
  await runScriptCommands(commands);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
