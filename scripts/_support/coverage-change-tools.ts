import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';

import {
  COVERAGE_MODULES,
  SYSTEM_SCRIPT_SURFACE,
  type CoverageModule,
  type ScriptSurface,
} from './system-coverage-manifest';
import { resolveTestCommand } from './resolve-test-command';

export type ChangedCoverageOptions = {
  base?: string;
  head?: string;
  staged?: boolean;
  strict?: boolean;
};

export type ModuleChangeReport = {
  module: CoverageModule;
  changedSourceFiles: string[];
  changedSurfaceFiles: string[];
  ownedSurfaceFiles: string[];
};

export type CoverageChangeReport = {
  changedFiles: string[];
  orphanSourceFiles: string[];
  systemImpactFiles: string[];
  fullSuiteImpactFiles: string[];
  impactedModules: ModuleChangeReport[];
  modulesMissingCoverageUpdates: ModuleChangeReport[];
};

const FULL_SUITE_IMPACT_FILES = new Set([
  'package.json',
  'scripts/_support/resolve-test-command.ts',
  'scripts/_support/run-doc-aware-test.ts',
  'scripts/_support/run-package-suite.ts',
]);

const SYSTEM_IMPACT_FILES = new Set([
  'package.json',
  ...SYSTEM_SCRIPT_SURFACE.supportFiles,
  ...SYSTEM_SCRIPT_SURFACE.runtimeFiles,
]);

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function normalizeFile(relativePath: string): string {
  return relativePath.replaceAll(path.sep, '/');
}

function parseGitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeFile(line));
}

function runGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readChangedFiles(options: ChangedCoverageOptions): string[] {
  if (options.base) {
    const head = options.head || 'HEAD';
    return uniqueSorted(
      parseGitLines(runGit(['diff', '--name-only', '--diff-filter=ACMR', `${options.base}...${head}`]))
    );
  }

  if (options.staged) {
    return uniqueSorted(parseGitLines(runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])));
  }

  const tracked = parseGitLines(runGit(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']));
  const untracked = parseGitLines(runGit(['ls-files', '--others', '--exclude-standard']));
  return uniqueSorted([...tracked, ...untracked]);
}

function collectModuleSurfaceFiles(module: CoverageModule): string[] {
  const surfaces: ScriptSurface[] = [
    ...(module.tests || []),
    ...(module.checks || []),
    ...(module.proofs || []),
    ...(module.releaseGates || []),
    ...(module.signoffs || []),
    ...(module.smokes || []),
    ...(module.captures || []),
  ];

  return uniqueSorted(
    surfaces
      .map((surface) => surface.file)
      .filter((file): file is string => typeof file === 'string')
      .map((file) => normalizeFile(file))
  );
}

function collectModuleTestKeys(module: CoverageModule): string[] {
  return uniqueSorted(
    (module.tests || [])
      .map((surface) => surface.key)
      .filter((key): key is string => typeof key === 'string' && key.startsWith('test:'))
  );
}

export function parseChangedCoverageArgs(argv: string[]): ChangedCoverageOptions {
  const options: ChangedCoverageOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--staged') {
      options.staged = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--base') {
      options.base = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--head') {
      options.head = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return options;
}

export function analyzeCoverageChanges(options: ChangedCoverageOptions = {}): CoverageChangeReport {
  const changedFiles = readChangedFiles(options);
  const moduleReports = new Map<string, ModuleChangeReport>(
    COVERAGE_MODULES.map((module) => [
      module.key,
      {
        module,
        changedSourceFiles: [],
        changedSurfaceFiles: [],
        ownedSurfaceFiles: collectModuleSurfaceFiles(module),
      },
    ])
  );

  const controllerOwners = new Map<string, CoverageModule[]>();
  const serviceOwners = new Map<string, CoverageModule[]>();
  const surfaceOwners = new Map<string, CoverageModule[]>();

  for (const module of COVERAGE_MODULES) {
    for (const entry of module.controllers) {
      const owners = controllerOwners.get(entry) || [];
      owners.push(module);
      controllerOwners.set(entry, owners);
    }
    for (const entry of module.services) {
      const owners = serviceOwners.get(entry) || [];
      owners.push(module);
      serviceOwners.set(entry, owners);
    }
    for (const file of collectModuleSurfaceFiles(module)) {
      const owners = surfaceOwners.get(file) || [];
      owners.push(module);
      surfaceOwners.set(file, owners);
    }
  }

  const orphanSourceFiles: string[] = [];
  const systemImpactFiles: string[] = [];
  const fullSuiteImpactFiles: string[] = [];

  for (const file of changedFiles) {
    const normalizedFile = normalizeFile(file);

    if (SYSTEM_IMPACT_FILES.has(normalizedFile)) {
      systemImpactFiles.push(normalizedFile);
    }
    if (FULL_SUITE_IMPACT_FILES.has(normalizedFile)) {
      fullSuiteImpactFiles.push(normalizedFile);
    }

    if (normalizedFile.startsWith('src/api/controllers/')) {
      const owners = controllerOwners.get(path.posix.basename(normalizedFile)) || [];
      if (!owners.length) {
        orphanSourceFiles.push(normalizedFile);
        continue;
      }
      for (const owner of owners) {
        moduleReports.get(owner.key)?.changedSourceFiles.push(normalizedFile);
      }
      continue;
    }

    if (normalizedFile.startsWith('src/api/services/')) {
      const owners = serviceOwners.get(path.posix.basename(normalizedFile)) || [];
      if (!owners.length) {
        orphanSourceFiles.push(normalizedFile);
        continue;
      }
      for (const owner of owners) {
        moduleReports.get(owner.key)?.changedSourceFiles.push(normalizedFile);
      }
      continue;
    }

    const surfaceModules = surfaceOwners.get(normalizedFile) || [];
    for (const owner of surfaceModules) {
      moduleReports.get(owner.key)?.changedSurfaceFiles.push(normalizedFile);
    }
  }

  const impactedModules = [...moduleReports.values()]
    .map((report) => ({
      ...report,
      changedSourceFiles: uniqueSorted(report.changedSourceFiles),
      changedSurfaceFiles: uniqueSorted(report.changedSurfaceFiles),
    }))
    .filter((report) => report.changedSourceFiles.length || report.changedSurfaceFiles.length)
    .sort((left, right) => left.module.key.localeCompare(right.module.key));

  const modulesMissingCoverageUpdates = options.strict
    ? impactedModules.filter(
        (report) =>
          report.changedSourceFiles.length > 0 &&
          report.changedSurfaceFiles.length === 0
      )
    : [];

  return {
    changedFiles,
    orphanSourceFiles: uniqueSorted(orphanSourceFiles),
    systemImpactFiles: uniqueSorted(systemImpactFiles),
    fullSuiteImpactFiles: uniqueSorted(fullSuiteImpactFiles),
    impactedModules,
    modulesMissingCoverageUpdates,
  };
}

export function formatCoverageChangeReport(report: CoverageChangeReport): string {
  const lines: string[] = [];

  lines.push(`Changed files: ${report.changedFiles.length}`);
  if (!report.changedFiles.length) {
    lines.push('No changed files detected.');
    return lines.join('\n');
  }

  if (report.impactedModules.length) {
    lines.push('Impacted modules:');
    for (const entry of report.impactedModules) {
      lines.push(
        `- ${entry.module.key}: ${entry.changedSourceFiles.length} source change(s), ${entry.changedSurfaceFiles.length} coverage surface change(s)`
      );
      if (entry.changedSourceFiles.length) {
        lines.push(`  source: ${entry.changedSourceFiles.join(', ')}`);
      }
      if (entry.changedSurfaceFiles.length) {
        lines.push(`  coverage: ${entry.changedSurfaceFiles.join(', ')}`);
      }
    }
  } else {
    lines.push('Impacted modules: none');
  }

  if (report.systemImpactFiles.length) {
    lines.push(`System impact files: ${report.systemImpactFiles.join(', ')}`);
  }
  if (report.orphanSourceFiles.length) {
    lines.push(`Orphan source files: ${report.orphanSourceFiles.join(', ')}`);
  }
  if (report.modulesMissingCoverageUpdates.length) {
    lines.push('Modules missing coverage updates:');
    for (const entry of report.modulesMissingCoverageUpdates) {
      lines.push(`- ${entry.module.key}: expected one of ${entry.ownedSurfaceFiles.join(', ')}`);
    }
  }

  return lines.join('\n');
}

export function collectChangedTestCommands(report: CoverageChangeReport): string[] {
  if (!report.changedFiles.length) {
    return [];
  }

  if (report.fullSuiteImpactFiles.length) {
    return ['test:all'];
  }

  const commands = new Set<string>();

  for (const reportEntry of report.impactedModules) {
    for (const key of collectModuleTestKeys(reportEntry.module)) {
      commands.add(key);
    }
  }

  if (report.systemImpactFiles.length) {
    commands.add('test:coverage-audit');
    commands.add('test:aggregate-catchall');
  } else if (report.impactedModules.length) {
    commands.add('test:coverage-audit');
  }

  return [...commands];
}

export async function runScriptCommands(commands: string[]): Promise<void> {
  for (const scriptName of commands) {
    const command = resolveTestCommand(scriptName);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command[0], command.slice(1), {
        stdio: 'inherit',
        env: process.env,
      });

      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (signal) {
          reject(new Error(`${command.join(' ')} terminated by signal ${signal}`));
          return;
        }
        if (code && code !== 0) {
          reject(new Error(`${command.join(' ')} exited with code ${code}`));
          return;
        }
        resolve();
      });
    });
  }
}
