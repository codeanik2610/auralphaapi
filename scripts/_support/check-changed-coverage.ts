import {
  analyzeCoverageChanges,
  formatCoverageChangeReport,
  parseChangedCoverageArgs,
} from './coverage-change-tools';

async function main(): Promise<void> {
  const options = parseChangedCoverageArgs(process.argv.slice(2));
  const report = analyzeCoverageChanges(options);

  console.log(formatCoverageChangeReport(report));

  if (report.orphanSourceFiles.length) {
    throw new Error(
      `Changed source files are not owned by the coverage manifest: ${report.orphanSourceFiles.join(', ')}`
    );
  }

  if (report.modulesMissingCoverageUpdates.length) {
    throw new Error(
      `Coverage updates are required for changed modules: ${report.modulesMissingCoverageUpdates
        .map((entry) => entry.module.key)
        .join(', ')}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
