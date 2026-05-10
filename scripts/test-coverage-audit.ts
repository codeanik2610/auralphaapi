import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  COVERAGE_MODULES,
  SYSTEM_SCRIPT_SURFACE,
  type CoverageModule,
  type ScriptSurface,
} from './_support/system-coverage-manifest';

const ROOT = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8')) as T;
}

function listDirFiles(relativeDir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, relativeDir), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.posix.join(relativeDir, entry.name))
    .sort();
}

function listBasenames(relativeDir: string): string[] {
  const absoluteDir = path.join(ROOT, relativeDir);
  const items: string[] = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      items.push(entry.name);
      continue;
    }
    if (entry.isDirectory()) {
      items.push(...listBasenames(path.posix.join(relativeDir, entry.name)));
    }
  }
  return items.sort();
}

function flattenSurfaces(
  selector: (module: CoverageModule) => ScriptSurface[] | undefined
): Array<ScriptSurface & { owner: string }> {
  return COVERAGE_MODULES.flatMap((module) =>
    (selector(module) || []).map((surface) => ({
      ...surface,
      owner: module.key,
    }))
  );
}

function flattenAllModuleSurfaces(): Array<ScriptSurface & { owner: string }> {
  return COVERAGE_MODULES.flatMap((module) =>
    [
      ...(module.tests || []),
      ...(module.checks || []),
      ...(module.proofs || []),
      ...(module.releaseGates || []),
      ...(module.signoffs || []),
      ...(module.smokes || []),
      ...(module.captures || []),
    ].map((surface) => ({ ...surface, owner: module.key }))
  );
}

function ownerMap(label: 'controllers' | 'services'): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const module of COVERAGE_MODULES) {
    for (const entry of module[label]) {
      const owners = map.get(entry) || [];
      owners.push(module.key);
      map.set(entry, owners);
    }
  }
  return map;
}

function pushSetDiff(
  findings: string[],
  label: string,
  expected: Iterable<string>,
  actual: Iterable<string>
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter((value) => !actualSet.has(value)).sort();
  const extra = [...actualSet].filter((value) => !expectedSet.has(value)).sort();
  if (missing.length) {
    findings.push(`${label}: missing ${missing.join(', ')}`);
  }
  if (extra.length) {
    findings.push(`${label}: unexpected ${extra.join(', ')}`);
  }
}

function auditPrimaryOwnership(findings: string[]): void {
  for (const label of ['controllers', 'services'] as const) {
    const actual = listBasenames(`src/api/${label}`);
    const ownership = ownerMap(label);
    const missing = actual.filter((entry) => !ownership.has(entry));
    const stale = [...ownership.keys()].filter((entry) => !actual.includes(entry)).sort();
    const duplicates = [...ownership.entries()]
      .filter(([, owners]) => new Set(owners).size > 1)
      .map(([entry, owners]) => `${entry} -> ${[...new Set(owners)].sort().join(', ')}`);

    if (missing.length) {
      findings.push(`${label}: unowned source files ${missing.join(', ')}`);
    }
    if (stale.length) {
      findings.push(`${label}: manifest references missing files ${stale.join(', ')}`);
    }
    if (duplicates.length) {
      findings.push(`${label}: duplicate primary owners ${duplicates.join(' | ')}`);
    }
  }
}

function auditPackageScriptSurface(findings: string[]): void {
  const packageJson = readJson<{ scripts: Record<string, string> }>('package.json');
  const scripts = packageJson.scripts || {};
  const expectedKeys = new Set(
    [
      ...flattenAllModuleSurfaces(),
      ...SYSTEM_SCRIPT_SURFACE.tests.map((surface) => ({ ...surface, owner: 'system' })),
      ...SYSTEM_SCRIPT_SURFACE.releaseGates.map((surface) => ({ ...surface, owner: 'system' })),
      ...SYSTEM_SCRIPT_SURFACE.smokes.map((surface) => ({ ...surface, owner: 'system' })),
      ...SYSTEM_SCRIPT_SURFACE.dbScripts.map((surface) => ({ ...surface, owner: 'system' })),
      ...SYSTEM_SCRIPT_SURFACE.rebuildScripts.map((surface) => ({ ...surface, owner: 'system' })),
    ]
      .map((surface) => surface.key)
      .filter((key): key is string => Boolean(key))
  );

  const actualKeys = Object.keys(scripts).filter(
    (key) =>
      key === 'test' ||
      key.startsWith('test:') ||
      key.startsWith('check:') ||
      key.startsWith('proof:') ||
      key.startsWith('release-gate:') ||
      key.startsWith('signoff:') ||
      key.startsWith('smoke:') ||
      key.startsWith('capture:') ||
      key.startsWith('db:') ||
      key.startsWith('rebuild:')
  );

  pushSetDiff(findings, 'package scripts', expectedKeys, actualKeys);

  const keyOwners = new Map<string, Set<string>>();
  for (const surface of [
    ...flattenAllModuleSurfaces(),
    ...SYSTEM_SCRIPT_SURFACE.tests.map((entry) => ({ ...entry, owner: 'system' })),
    ...SYSTEM_SCRIPT_SURFACE.releaseGates.map((entry) => ({ ...entry, owner: 'system' })),
    ...SYSTEM_SCRIPT_SURFACE.smokes.map((entry) => ({ ...entry, owner: 'system' })),
    ...SYSTEM_SCRIPT_SURFACE.dbScripts.map((entry) => ({ ...entry, owner: 'system' })),
    ...SYSTEM_SCRIPT_SURFACE.rebuildScripts.map((entry) => ({ ...entry, owner: 'system' })),
  ]) {
    if (!surface.key) {
      continue;
    }
    const owners = keyOwners.get(surface.key) || new Set<string>();
    owners.add(surface.owner);
    keyOwners.set(surface.key, owners);
    if (!scripts[surface.key]) {
      findings.push(`package scripts: missing script key ${surface.key}`);
    }
  }

  for (const [key, owners] of keyOwners.entries()) {
    if (owners.size > 1) {
      findings.push(`package scripts: duplicate ownership for ${key} -> ${[...owners].sort().join(', ')}`);
    }
  }
}

function auditScriptFiles(findings: string[]): void {
  const expectedTopLevelTests = [
    ...flattenSurfaces((module) => module.tests),
    ...SYSTEM_SCRIPT_SURFACE.tests.map((surface) => ({ ...surface, owner: 'system' })),
  ]
    .map((surface) => surface.file)
    .filter((file): file is string => typeof file === 'string' && file.startsWith('scripts/test-'));

  const expectedChecks = flattenSurfaces((module) => module.checks)
    .map((surface) => surface.file)
    .filter((file): file is string => typeof file === 'string');

  const expectedProofs = flattenSurfaces((module) => module.proofs)
    .map((surface) => surface.file)
    .filter((file): file is string => typeof file === 'string');

  const expectedReleaseGates = [
    ...flattenSurfaces((module) => module.releaseGates),
    ...SYSTEM_SCRIPT_SURFACE.releaseGates.map((surface) => ({ ...surface, owner: 'system' })),
  ]
    .map((surface) => surface.file)
    .filter((file): file is string => Boolean(file));

  const expectedSignoffs = flattenSurfaces((module) => module.signoffs)
    .map((surface) => surface.file)
    .filter((file): file is string => Boolean(file));

  const expectedSmokes = [
    ...flattenSurfaces((module) => module.smokes),
    ...SYSTEM_SCRIPT_SURFACE.smokes.map((surface) => ({ ...surface, owner: 'system' })),
  ]
    .map((surface) => surface.file)
    .filter((file): file is string => Boolean(file));

  const expectedCaptures = flattenSurfaces((module) => module.captures)
    .map((surface) => surface.file)
    .filter((file): file is string => Boolean(file));

  pushSetDiff(findings, 'scripts/test-*', expectedTopLevelTests, listDirFiles('scripts').filter((file) => file.includes('/test-') || file.startsWith('scripts/test-')));
  pushSetDiff(findings, 'scripts/checks', expectedChecks, listDirFiles('scripts/checks'));
  pushSetDiff(findings, 'scripts/proofs', expectedProofs, listDirFiles('scripts/proofs'));
  pushSetDiff(findings, 'scripts/release-gates', expectedReleaseGates, listDirFiles('scripts/release-gates'));
  pushSetDiff(findings, 'scripts/signoffs', expectedSignoffs, listDirFiles('scripts/signoffs'));
  pushSetDiff(findings, 'scripts/smokes', expectedSmokes, listDirFiles('scripts/smokes'));
  pushSetDiff(findings, 'scripts/capture', expectedCaptures, listDirFiles('scripts/capture'));
  pushSetDiff(findings, 'scripts/_support', SYSTEM_SCRIPT_SURFACE.supportFiles, listDirFiles('scripts/_support'));
  pushSetDiff(findings, 'scripts/_runtime', SYSTEM_SCRIPT_SURFACE.runtimeFiles, listDirFiles('scripts/_runtime'));
  pushSetDiff(
    findings,
    'scripts/db',
    SYSTEM_SCRIPT_SURFACE.dbScripts
      .map((surface) => surface.file)
      .filter((file): file is string => Boolean(file)),
    listDirFiles('scripts/db')
  );
  pushSetDiff(
    findings,
    'scripts/rebuild',
    SYSTEM_SCRIPT_SURFACE.rebuildScripts
      .map((surface) => surface.file)
      .filter((file): file is string => Boolean(file)),
    listDirFiles('scripts/rebuild')
  );

  const fileOwners = new Map<string, Set<string>>();
  for (const surface of [
    ...flattenAllModuleSurfaces(),
    ...SYSTEM_SCRIPT_SURFACE.tests.map((entry) => ({ ...entry, owner: 'system' })),
    ...SYSTEM_SCRIPT_SURFACE.releaseGates.map((entry) => ({ ...entry, owner: 'system' })),
    ...SYSTEM_SCRIPT_SURFACE.smokes.map((entry) => ({ ...entry, owner: 'system' })),
    ...SYSTEM_SCRIPT_SURFACE.dbScripts.map((entry) => ({ ...entry, owner: 'system' })),
    ...SYSTEM_SCRIPT_SURFACE.rebuildScripts.map((entry) => ({ ...entry, owner: 'system' })),
  ]) {
    if (!surface.file) {
      continue;
    }
    const owners = fileOwners.get(surface.file) || new Set<string>();
    owners.add(surface.owner);
    fileOwners.set(surface.file, owners);
    if (!fs.existsSync(path.join(ROOT, surface.file))) {
      findings.push(`script files: missing ${surface.file}`);
    }
  }

  for (const [file, owners] of fileOwners.entries()) {
    if (owners.size > 1) {
      findings.push(`script files: duplicate ownership for ${file} -> ${[...owners].sort().join(', ')}`);
    }
  }
}

function auditManifestShape(findings: string[]): void {
  const moduleKeys = new Set<string>();
  for (const module of COVERAGE_MODULES) {
    if (moduleKeys.has(module.key)) {
      findings.push(`manifest: duplicate module key ${module.key}`);
    }
    moduleKeys.add(module.key);
    if (!module.tests.length) {
      findings.push(`manifest: module ${module.key} must declare at least one test surface`);
    }
  }
}

function main(): void {
  const findings: string[] = [];

  auditManifestShape(findings);
  auditPrimaryOwnership(findings);
  auditPackageScriptSurface(findings);
  auditScriptFiles(findings);

  assert.equal(findings.length, 0, `Coverage audit failed:\n${findings.join('\n')}`);

  const summary = {
    modules: COVERAGE_MODULES.length,
    dedicatedOrCrossCuttingModules: COVERAGE_MODULES.filter((module) => module.lane !== 'aggregate-only').length,
    aggregateOnlyModules: COVERAGE_MODULES.filter((module) => module.lane === 'aggregate-only').map(
      (module) => module.key
    ),
    controllers: listBasenames('src/api/controllers').length,
    services: listBasenames('src/api/services').length,
  };

  console.log(`Coverage audit assertions passed: ${JSON.stringify(summary)}`);
}

main();
