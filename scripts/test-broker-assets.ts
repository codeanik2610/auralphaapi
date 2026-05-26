import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ConnectionsService } from '../src/api/services/ConnectionsService';
import { ExchangeAssetsService } from '../src/api/services/ExchangeAssetsService';
import { DeltaExchangeOrdersAdapter } from '../src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter';
import { MudrexOrdersAdapter } from '../src/brokers/capabilities/orders/MudrexOrdersAdapter';
import { DeltaExchangeHttpClient } from '../src/brokers/providers/delta_exchange/DeltaExchangeHttpClient';
import { DropBrokerAssetLegacyUserOwnership1770709000000 } from './_fixtures/migrations/1770709000000-DropBrokerAssetLegacyUserOwnership';
import {
  assertBrokerAssetsHealthSnapshot,
  buildBrokerAssetsHealthSnapshot,
} from './checks/check-broker-assets-health';

type JsonRecord = Record<string, unknown>;

const moduleTestCommand = 'test:broker-assets';
const moduleTestScriptPath = 'scripts/test-broker-assets.ts';
const releaseGateSuiteKey = 'backend-broker-assets-suite';
const legacyBrokerAssetsTestFiles = [
  'scripts/test-broker-assets-contract.ts',
  'scripts/test-broker-assets-flow.ts',
  'scripts/test-broker-assets-phase1.ts',
  'scripts/test-broker-assets-phase2.ts',
  'scripts/test-broker-assets-phase3.ts',
  'scripts/test-broker-assets-phase4.ts',
  'scripts/test-broker-assets-phase6.ts',
  'scripts/test-broker-assets-phase7.ts',
  'scripts/test-broker-assets-phase8.ts',
  'scripts/test-broker-assets-phase9.ts',
];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function parsePackageJson(): {
  scripts: Record<string, string>;
} {
  return JSON.parse(read('package.json')) as {
    scripts: Record<string, string>;
  };
}

function ensureMarkers(source: string, markers: string[], findings: string[], label: string): void {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      findings.push(`${label}: missing marker ${marker}`);
    }
  }
}

function ensureBrokerAssetsPackageWiring(
  packageSource: string,
  findings: string[],
  label: string
): void {
  if (!packageSource.includes(`"${moduleTestCommand}"`)) {
    findings.push(`${label}: missing consolidated broker-assets test script`);
  }
  if (!packageSource.includes(moduleTestScriptPath)) {
    findings.push(
      `${label}: consolidated broker-assets test must point at ${moduleTestScriptPath}`
    );
  }
  for (const legacyScript of [
    '"test:broker-assets-contract"',
    '"test:broker-assets-flow"',
    '"test:broker-assets-history"',
    '"test:broker-assets-phase1"',
    '"test:broker-assets-phase2"',
    '"test:broker-assets-phase3"',
    '"test:broker-assets-phase4"',
    '"test:broker-assets-phase6"',
    '"test:broker-assets-phase7"',
    '"test:broker-assets-phase8"',
    '"test:broker-assets-phase9"',
  ]) {
    if (packageSource.includes(legacyScript)) {
      findings.push(
        `${label}: legacy broker-assets package script should stay removed ${legacyScript}`
      );
    }
  }
}

function ensureLegacyBrokerAssetsTestsRemoved(findings: string[], label: string): void {
  for (const relativePath of legacyBrokerAssetsTestFiles) {
    if (fs.existsSync(path.join(process.cwd(), relativePath))) {
      findings.push(`${label}: legacy broker-assets test file should be removed ${relativePath}`);
    }
  }
}

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}

function runPhase1Assertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE1.md');
  ensureMarkers(
    phaseDoc,
    [
      '`broker_assets` is the global broker or exchange asset catalog.',
      '`broker_accounts` is the user-owned connection layer',
      '`broker_assets.user_id` is a legacy transitional column.',
      'Phase 1 does not change runtime behavior.',
      'no new feature should depend on `broker_assets.user_id` for ownership',
    ],
    findings,
    'BROKER_ASSETS_PHASE1.md'
  );

  const checklist = read('BROKER_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md');
  ensureMarkers(
    checklist,
    [
      'Scheduler key: `broker-assets-sync`',
      'Admin route base: `/scheduler/exchange-assets`',
      'Storage target table: `broker_assets`',
      "Default source list is `['mudrex', 'delta_exchange']`.",
      '## 14. Time And Timezone Checks',
    ],
    findings,
    'BROKER_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md'
  );

  const readme = read('README.md');
  if (!readme.includes('`broker_assets` is the global provider asset catalog;')) {
    findings.push('README.md: missing broker_assets ownership note');
  }
  if (!readme.includes('BROKER_ASSETS_SYNC_FUNCTIONAL_CHECKLIST.md')) {
    findings.push('README.md: missing broker-assets functional checklist reference');
  }

  const entitySource = read('src/database/entities/ExchangeAsset.ts');
  ensureMarkers(
    entitySource,
    [
      'broker_assets is now a pure global broker or exchange asset catalog.',
      "@Unique('uq_broker_assets_source_symbol'",
    ],
    findings,
    'ExchangeAsset.ts'
  );

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  ensureMarkers(
    repositorySource,
    [
      'broker_assets no longer carries legacy per-user ownership',
      'replaceSystemAssets(',
      'listVisibleAssetsForUser(',
    ],
    findings,
    'ExchangeAssetRepository.ts'
  );

  const serviceSource = read('src/api/services/ExchangeAssetsService.ts');
  ensureMarkers(
    serviceSource,
    [
      'broker_assets writes target the global catalog',
      'derived from user-owned routes',
      'syncExchangeAssets(',
      'getStoredExchangeAssets(',
    ],
    findings,
    'ExchangeAssetsService.ts'
  );

  ensureBrokerAssetsPackageWiring(read('package.json'), findings, 'package.json');
  ensureLegacyBrokerAssetsTestsRemoved(findings, 'broker-assets');

  assert.equal(findings.length, 0, `Broker assets Phase 1 guard failed:\n${findings.join('\n')}`);
}

function runPhase2Assertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE2_AUDIT.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 2 does not change runtime behavior.',
      '`ExchangeAssetsService` is the only runtime writer still creating',
      '`ExchangeAssetRepository.replaceSystemAssets()` already exists',
      '`src/api/services/ConnectionsService.ts`',
      '`src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts`',
      'visibility derived from `Connected` accounts only',
      'Phase 3 should update or replace that guard',
    ],
    findings,
    'BROKER_ASSETS_PHASE2_AUDIT.md'
  );

  const readme = read('README.md');
  if (!readme.includes('BROKER_ASSETS_PHASE4.md')) {
    findings.push('README.md: missing broker assets Phase 4 cleanup reference');
  }
  if (!read('BROKER_ASSETS_PHASE3.md').includes('Phase 3 aligns the runtime')) {
    findings.push('BROKER_ASSETS_PHASE3.md: missing Phase 3 handoff after the Phase 2 audit');
  }
  if (
    !read('BROKER_ASSETS_PHASE4.md').includes(
      'Phase 4 removes the last legacy user-ownership schema'
    )
  ) {
    findings.push('BROKER_ASSETS_PHASE4.md: missing Phase 4 handoff after the Phase 2 audit');
  }

  ensureBrokerAssetsPackageWiring(read('package.json'), findings, 'package.json');
  ensureLegacyBrokerAssetsTestsRemoved(findings, 'broker-assets');

  assert.equal(
    findings.length,
    0,
    `Broker assets Phase 2 audit guard failed:\n${findings.join('\n')}`
  );
}

function runPhase3Assertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE3.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 3 aligns the runtime with the global-catalog ownership model',
      '`ExchangeAssetsService` now writes `broker_assets` through',
      'User-visible visibility is derived from user-owned routes:',
      'active `broker_accounts` with status `Connected` or `Idle`',
      '`DeltaExchangeOrdersAdapter` now resolves product mappings from the global',
      '## Phase 4 Entry Checklist',
    ],
    findings,
    'BROKER_ASSETS_PHASE3.md'
  );

  const readme = read('README.md');
  if (!readme.includes('BROKER_ASSETS_PHASE4.md')) {
    findings.push('README.md: missing broker assets Phase 4 cleanup reference');
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  ensureMarkers(
    repositorySource,
    [
      'async replaceSystemAssets(',
      'async listVisibleAssetsForUser(',
      'async countVisibleAssetsForUser(',
      'async listVisibleAssetsBySourceAndSymbolsForUser(',
      'async getSystemAssetBySourceAndSymbol(',
      "from(Connection, 'connection')",
      "from(BrokerAccount, 'account')",
    ],
    findings,
    'ExchangeAssetRepository.ts'
  );

  const exchangeAssetsService = read('src/api/services/ExchangeAssetsService.ts');
  ensureMarkers(
    exchangeAssetsService,
    [
      'replaceSystemAssets(',
      'listVisibleAssetsForUser(userId, {',
      'listVisibleAssetsBySourceAndSymbolsForUser(',
    ],
    findings,
    'ExchangeAssetsService.ts'
  );

  const connectionsService = read('src/api/services/ConnectionsService.ts');
  if (!connectionsService.includes('countVisibleAssetsForUser(userId, source)')) {
    findings.push('ConnectionsService.ts: missing Phase 3 product-map visibility count');
  }

  const deltaAdapter = read('src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts');
  ensureMarkers(
    deltaAdapter,
    [
      'getSystemAssetBySourceAndExternalId(',
      'getSystemAssetBySourceAndAssetId(',
      'getSystemAssetBySourceAndSymbol(',
    ],
    findings,
    'DeltaExchangeOrdersAdapter.ts'
  );

  const servicesTestSource = read('scripts/test-services.ts');
  ensureMarkers(
    servicesTestSource,
    [
      'async countVisibleAssetsForUser(',
      'const replaceCaptures:',
      'async listVisibleAssetsForUser(',
      'async getSystemAssetBySourceAndSymbol(',
      'runExchangeAssetsVisibilityAssertions()',
      'runDeltaExchangeOrdersAdapterCatalogAssertions()',
    ],
    findings,
    'scripts/test-services.ts'
  );

  ensureBrokerAssetsPackageWiring(read('package.json'), findings, 'package.json');
  ensureLegacyBrokerAssetsTestsRemoved(findings, 'broker-assets');

  assert.equal(findings.length, 0, `Broker assets Phase 3 guard failed:\n${findings.join('\n')}`);
}

async function runPhase4MigrationAssertions(): Promise<void> {
  const migration = new DropBrokerAssetLegacyUserOwnership1770709000000();
  const executedQueries: string[] = [];
  const indexes = new Set([
    'uq_exchange_assets_user_source_symbol',
    'idx_exchange_assets_user_symbol_name',
    'idx_exchange_assets_user_broker_id',
    'idx_exchange_assets_user_exchange_id',
  ]);
  let hasUserId = true;

  await migration.up({
    async hasTable(tableName: string) {
      return tableName === 'broker_assets';
    },
    async hasColumn(tableName: string, columnName: string) {
      return tableName === 'broker_assets' && columnName === 'user_id' ? hasUserId : false;
    },
    async query(sql: string, params?: unknown[]) {
      executedQueries.push(sql);

      if (sql.includes('SHOW INDEX FROM broker_assets WHERE Key_name = ?')) {
        const indexName = String(params?.[0] || '');
        return indexes.has(indexName) ? [{ Key_name: indexName }] : [];
      }

      if (sql.includes('ALTER TABLE broker_assets DROP INDEX')) {
        const match = sql.match(/DROP INDEX ([A-Za-z0-9_]+)/);
        if (match?.[1]) {
          indexes.delete(match[1]);
        }
        return [];
      }

      if (sql.includes('CREATE UNIQUE INDEX') || sql.includes('CREATE INDEX')) {
        const match = sql.match(/INDEX ([A-Za-z0-9_]+) ON/);
        if (match?.[1]) {
          indexes.add(match[1]);
        }
        return [];
      }

      if (sql.includes('ALTER TABLE broker_assets DROP COLUMN user_id')) {
        hasUserId = false;
        return [];
      }

      if (sql.includes('ALTER TABLE broker_assets ADD COLUMN user_id')) {
        hasUserId = true;
        return [];
      }

      return [];
    },
  } as any);

  assert.equal(
    executedQueries.some(
      (sql) =>
        sql.includes('INSERT INTO broker_assets') && sql.includes('WHERE user_id IS NOT NULL')
    ),
    true
  );
  assert.equal(
    executedQueries.some((sql) =>
      sql.includes('DELETE FROM broker_assets WHERE user_id IS NOT NULL')
    ),
    true
  );
  assert.equal(
    executedQueries.some((sql) => sql.includes('ALTER TABLE broker_assets DROP COLUMN user_id')),
    true
  );
  assert.equal(indexes.has('uq_broker_assets_source_symbol'), true);
  assert.equal(indexes.has('idx_broker_assets_source_symbol_name'), true);
  assert.equal(indexes.has('idx_broker_assets_broker_id'), true);
  assert.equal(indexes.has('idx_broker_assets_source_external_id'), true);
  assert.equal(indexes.has('idx_broker_assets_source_asset_id'), true);
  assert.equal(indexes.has('uq_exchange_assets_user_source_symbol'), false);

  const downIndexes = new Set([
    'uq_broker_assets_source_symbol',
    'idx_broker_assets_source_symbol_name',
    'idx_broker_assets_broker_id',
    'idx_broker_assets_source_external_id',
    'idx_broker_assets_source_asset_id',
  ]);
  let downHasUserId = false;

  await migration.down({
    async hasTable(tableName: string) {
      return tableName === 'broker_assets';
    },
    async hasColumn(tableName: string, columnName: string) {
      return tableName === 'broker_assets' && columnName === 'user_id' ? downHasUserId : false;
    },
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('SHOW INDEX FROM broker_assets WHERE Key_name = ?')) {
        const indexName = String(params?.[0] || '');
        return downIndexes.has(indexName) ? [{ Key_name: indexName }] : [];
      }

      if (sql.includes('ALTER TABLE broker_assets DROP INDEX')) {
        const match = sql.match(/DROP INDEX ([A-Za-z0-9_]+)/);
        if (match?.[1]) {
          downIndexes.delete(match[1]);
        }
        return [];
      }

      if (sql.includes('CREATE UNIQUE INDEX') || sql.includes('CREATE INDEX')) {
        const match = sql.match(/INDEX ([A-Za-z0-9_]+) ON/);
        if (match?.[1]) {
          downIndexes.add(match[1]);
        }
        return [];
      }

      if (sql.includes('ALTER TABLE broker_assets ADD COLUMN user_id')) {
        downHasUserId = true;
      }

      return [];
    },
  } as any);

  assert.equal(downHasUserId, true);
  assert.equal(downIndexes.has('uq_broker_assets_user_source_symbol'), true);
  assert.equal(downIndexes.has('idx_broker_assets_user_symbol_name'), true);
}

async function runPhase4Assertions(): Promise<void> {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE4.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 4 removes the last legacy user-ownership schema from `broker_assets`.',
      '`broker_assets.user_id` is dropped.',
      'Global broker-assets constraints now describe the table correctly:',
      '`ExchangeAssetRepository` no longer exposes the legacy user-scoped read or',
      '## Phase 5 Entry Checklist',
    ],
    findings,
    'BROKER_ASSETS_PHASE4.md'
  );

  const readme = read('README.md');
  if (!readme.includes('BROKER_ASSETS_PHASE4.md')) {
    findings.push('README.md: missing broker assets Phase 4 reference');
  }

  const entitySource = read('src/database/entities/ExchangeAsset.ts');
  ensureMarkers(
    entitySource,
    [
      'Phase 4 schema cleanup',
      "@Unique('uq_broker_assets_source_symbol'",
      "@Index('idx_broker_assets_source_external_id'",
      "@Index('idx_broker_assets_source_asset_id'",
    ],
    findings,
    'ExchangeAsset.ts'
  );
  if (entitySource.includes("name: 'user_id'")) {
    findings.push('ExchangeAsset.ts: legacy user_id column should be removed in Phase 4');
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  ensureMarkers(
    repositorySource,
    [
      'Phase 4 schema cleanup',
      'async replaceSystemAssets(',
      'async listVisibleAssetsForUser(',
      'async countVisibleAssetsForUser(',
    ],
    findings,
    'ExchangeAssetRepository.ts'
  );
  for (const removedMarker of [
    'async upsertAssets(',
    'async getAssetBySourceAndExternalId(',
    'async getAssetBySourceAndAssetId(',
    'async getAssetBySourceAndSymbol(',
    'async listAssets(',
    'async listAssetsBySourceAndSymbols(',
    'userId: string | null;',
  ]) {
    if (repositorySource.includes(removedMarker)) {
      findings.push(
        `ExchangeAssetRepository.ts: legacy marker should be removed in Phase 4: ${removedMarker}`
      );
    }
  }

  const migrationSource = read(
    'scripts/_fixtures/migrations/1770709000000-DropBrokerAssetLegacyUserOwnership.ts'
  );
  ensureMarkers(
    migrationSource,
    [
      'DropBrokerAssetLegacyUserOwnership1770709000000',
      'legacyIndexNames',
      'globalIndexes',
      'ROW_NUMBER() OVER',
    ],
    findings,
    'DropBrokerAssetLegacyUserOwnership migration'
  );

  ensureBrokerAssetsPackageWiring(read('package.json'), findings, 'package.json');
  ensureLegacyBrokerAssetsTestsRemoved(findings, 'broker-assets');

  await runPhase4MigrationAssertions();

  assert.equal(findings.length, 0, `Broker assets Phase 4 guard failed:\n${findings.join('\n')}`);
}

function runPhase5ContractAssertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE5.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 5 promotes `broker_assets` from a schema-transition rollout to a',
      '- `broker_assets` is the global provider or exchange catalog.',
      '- User visibility is derived from owned `connections` and active',
      '- Delta order product lookup resolves against the global `delta_exchange`',
      '- `(source, externalId)` and `(source, assetId)` remain lookup indexes, not',
      '## Stable Guardrails',
      '## Naming Policy',
      '## Phase 6 Entry Checklist',
    ],
    findings,
    'BROKER_ASSETS_PHASE5.md'
  );

  const phase4Doc = read('BROKER_ASSETS_PHASE4.md');
  if (!phase4Doc.includes('BROKER_ASSETS_PHASE5.md')) {
    findings.push('BROKER_ASSETS_PHASE4.md: missing Phase 5 handoff');
  }

  const readme = read('README.md');
  if (!readme.includes('BROKER_ASSETS_PHASE5.md')) {
    findings.push('README.md: missing broker-assets Phase 5 steady-state reference');
  }
  if (!readme.includes('keyed by provider `source`, with optional broker-master linkage')) {
    findings.push(
      'README.md: broker_assets ownership wording should describe the steady-state model'
    );
  }

  const entitySource = read('src/database/entities/ExchangeAsset.ts');
  ensureMarkers(
    entitySource,
    [
      'Phase 4 schema cleanup, now carried forward as the Phase 5 steady-state contract:',
      "@Unique('uq_broker_assets_source_symbol'",
      "@Index('idx_broker_assets_source_external_id'",
      "@Index('idx_broker_assets_source_asset_id'",
    ],
    findings,
    'ExchangeAsset.ts'
  );
  if (entitySource.includes("name: 'user_id'")) {
    findings.push(
      'ExchangeAsset.ts: legacy user_id column should not exist in the steady-state entity'
    );
  }

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  ensureMarkers(
    repositorySource,
    [
      'Phase 4 schema cleanup, now carried forward as the Phase 5 steady-state contract:',
      'async replaceSystemAssets(',
      'async getSystemAssetBySourceAndExternalId(',
      'async getSystemAssetBySourceAndAssetId(',
      'async getSystemAssetBySourceAndSymbol(',
      'async listVisibleAssetsForUser(',
      'async countVisibleAssetsForUser(',
      'async listVisibleAssetsBySourceAndSymbolsForUser(',
    ],
    findings,
    'ExchangeAssetRepository.ts'
  );
  for (const removedMarker of [
    'async upsertAssets(',
    'async getAssetBySourceAndExternalId(',
    'async getAssetBySourceAndAssetId(',
    'async getAssetBySourceAndSymbol(',
    'async listAssets(',
    'async listAssetsBySourceAndSymbols(',
    'userId: string | null;',
  ]) {
    if (repositorySource.includes(removedMarker)) {
      findings.push(
        `ExchangeAssetRepository.ts: legacy user-scoped marker should stay removed: ${removedMarker}`
      );
    }
  }

  const serviceSource = read('src/api/services/ExchangeAssetsService.ts');
  ensureMarkers(
    serviceSource,
    [
      'Phase 4 stable model, now locked as the Phase 5 steady-state contract:',
      'replaceSystemAssets(',
      'listVisibleAssetsForUser(userId, {',
      'listVisibleAssetsBySourceAndSymbolsForUser(',
    ],
    findings,
    'ExchangeAssetsService.ts'
  );

  const connectionsSource = read('src/api/services/ConnectionsService.ts');
  if (!connectionsSource.includes('countVisibleAssetsForUser(userId, source)')) {
    findings.push(
      'ConnectionsService.ts: product-map totals should use broker_assets user-visible counts'
    );
  }

  const deltaAdapterSource = read('src/brokers/capabilities/orders/DeltaExchangeOrdersAdapter.ts');
  ensureMarkers(
    deltaAdapterSource,
    [
      'getSystemAssetBySourceAndExternalId(',
      'getSystemAssetBySourceAndAssetId(',
      'getSystemAssetBySourceAndSymbol(',
    ],
    findings,
    'DeltaExchangeOrdersAdapter.ts'
  );

  const migrationSource = read(
    'scripts/_fixtures/migrations/1770709000000-DropBrokerAssetLegacyUserOwnership.ts'
  );
  ensureMarkers(
    migrationSource,
    [
      'DropBrokerAssetLegacyUserOwnership1770709000000',
      'legacyIndexNames',
      'globalIndexes',
      'UUID()',
      'ROW_NUMBER() OVER',
      'DROP COLUMN user_id',
      'CREATE UNIQUE INDEX uq_broker_assets_source_symbol',
    ],
    findings,
    'DropBrokerAssetLegacyUserOwnership migration'
  );

  const packageJson = parsePackageJson();
  const scripts = packageJson.scripts || {};
  const expectedMainScript = `node --import tsx scripts/_support/run-doc-aware-test.ts ${moduleTestScriptPath}`;
  if (scripts[moduleTestCommand] !== expectedMainScript) {
    findings.push(`package.json: ${moduleTestCommand} should equal "${expectedMainScript}"`);
  }
  if (
    scripts['release-gate:broker-assets'] !==
    'node --import tsx scripts/release-gates/release-gate-broker-assets.ts'
  ) {
    findings.push(
      'package.json: release-gate:broker-assets should equal "node --import tsx scripts/release-gates/release-gate-broker-assets.ts"'
    );
  }
  for (const removedScript of [
    'test:broker-assets-contract',
    'test:broker-assets-flow',
    'test:broker-assets-history',
  ]) {
    if (Object.prototype.hasOwnProperty.call(scripts, removedScript)) {
      findings.push(`package.json: ${removedScript} should stay removed after consolidation`);
    }
  }

  const testAllScript = String(scripts['test:all'] || '');
  if (
    !testAllScript.includes('npm run test:broker-assets') &&
    !testAllScript.includes('npm run test:module-only')
  ) {
    findings.push(
      'package.json: test:all should include the stable broker-assets umbrella suite or module-only bundle'
    );
  }
  const moduleOnlyScript = String(scripts['test:module-only'] || '');
  if (moduleOnlyScript && !moduleOnlyScript.includes('run-package-suite.ts module-only')) {
    findings.push(
      'package.json: test:module-only should resolve through run-package-suite.ts module-only'
    );
  }
  for (const legacyScript of [
    'npm run test:broker-assets-contract',
    'npm run test:broker-assets-flow',
    'npm run test:broker-assets-history',
    'npm run test:broker-assets-phase1',
    'npm run test:broker-assets-phase2',
    'npm run test:broker-assets-phase3',
    'npm run test:broker-assets-phase4',
    'npm run test:broker-assets-phase6',
    'npm run test:broker-assets-phase7',
    'npm run test:broker-assets-phase8',
    'npm run test:broker-assets-phase9',
  ]) {
    if (testAllScript.includes(legacyScript)) {
      findings.push(`package.json: test:all should not depend on legacy guard ${legacyScript}`);
    }
  }

  ensureLegacyBrokerAssetsTestsRemoved(findings, 'broker-assets');

  assert.equal(findings.length, 0, `Broker assets contract failed:\n${findings.join('\n')}`);
}

async function runSyncFlowAssertions(): Promise<void> {
  const service = new ExchangeAssetsService() as any;
  const replaceCaptures: Array<{
    source: string;
    assets: Array<Record<string, unknown>>;
    attempted: number;
  }> = [];
  const upsertCaptures: Array<{
    source: string;
    assets: Array<Record<string, unknown>>;
    attempted: number;
  }> = [];
  const syncRequests: Array<{
    source: string;
    assets: Array<{ id: string; symbol: string }>;
  }> = [];

  Object.defineProperty(service, 'brokerDefinitionService', {
    get: () => ({
      async getRequiredDefinition(source: string) {
        const normalizedSource = String(source || '')
          .trim()
          .toLowerCase();

        if (normalizedSource === 'mudrex') {
          return {
            id: 'broker-mudrex',
            brokerId: 'broker-mudrex',
            brokerKey: 'mudrex',
            providerType: 'broker',
          };
        }

        if (normalizedSource === 'binance') {
          return {
            id: 'exchange-binance',
            brokerKey: 'binance',
            providerType: 'feed',
            linkedExchangeKey: 'binance',
          };
        }

        if (normalizedSource === 'delta_exchange') {
          return {
            id: 'broker-delta',
            brokerId: 'broker-delta',
            brokerKey: 'delta_exchange',
            providerType: 'broker',
          };
        }

        throw new Error(`Unexpected source: ${source}`);
      },
    }),
  });

  Object.defineProperty(service, 'exchangeRepository', {
    get: () => ({
      async getExchangeByKey(exchangeKey: string) {
        if (
          String(exchangeKey || '')
            .trim()
            .toLowerCase() === 'binance'
        ) {
          return { id: 'exchange-binance', exchangeKey: 'binance' };
        }

        return null;
      },
    }),
  });

  Object.defineProperty(service, 'assetRepository', {
    get: () => ({
      async listAllSymbols() {
        return [
          { id: 'asset-btc', symbol: 'BTCUSDT' },
          { id: 'asset-eth', symbol: 'ETHUSDT' },
        ];
      },
    }),
  });

  Object.defineProperty(service, 'mudrexService', {
    get: () => ({
      async fetchAllRemoteFuturesForUserOrThrow() {
        return [
          {
            id: 'mudrex-btc',
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
          {
            id: 'mudrex-eth',
            symbol: 'ETHUSDT',
            name: 'Ethereum',
          },
        ];
      },
    }),
  });

  Object.defineProperty(service, 'brokerExchangeAssetSyncService', {
    get: () => ({
      async sync(source: string, assets: Array<{ id: string; symbol: string }>) {
        syncRequests.push({ source, assets });
        return assets.map((item) => ({
          externalId: `${source}:${item.symbol}`,
          assetId: item.id,
          name: item.symbol,
          symbol: item.symbol,
        }));
      },
    }),
  });

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async replaceSystemAssets(
        source: string,
        assets: Array<Record<string, unknown>>,
        attempted: number
      ) {
        replaceCaptures.push({ source, assets, attempted });
        return {
          attempted,
          matched: assets.length,
          inserted: assets.length,
          updated: 0,
          skipped: Math.max(attempted - assets.length, 0),
          totalStored: assets.length,
        };
      },
      async upsertSystemAssets(
        source: string,
        assets: Array<Record<string, unknown>>,
        attempted: number
      ) {
        upsertCaptures.push({ source, assets, attempted });
        return {
          attempted,
          matched: assets.length,
          inserted: assets.length,
          updated: 0,
          skipped: Math.max(attempted - assets.length, 0),
          totalStored: assets.length,
        };
      },
    }),
  });

  Object.defineProperty(service, 'operationalEventService', {
    get: () => ({
      async logActivity() {
        return;
      },
      async emitFailureAlert() {
        return;
      },
    }),
  });

  const binanceSync = await service.syncExchangeAssets('user-1', 'binance');
  assert.equal(binanceSync.data.source, 'binance');
  assert.equal(replaceCaptures[0].source, 'binance');
  assert.equal(replaceCaptures[0].attempted, 2);
  assert.equal(replaceCaptures[0].assets.length, 2);
  assert.equal(replaceCaptures[0].assets[0].brokerId, null);
  assert.equal(Object.prototype.hasOwnProperty.call(replaceCaptures[0].assets[0], 'userId'), false);

  const mudrexSync = await service.syncExchangeAssets('user-1', 'mudrex');
  assert.equal(mudrexSync.data.source, 'mudrex');
  assert.equal(mudrexSync.data.deltaMappedSymbols, 2);
  assert.equal(replaceCaptures[1].source, 'mudrex');
  assert.equal(replaceCaptures[1].attempted, 2);
  assert.equal(replaceCaptures[1].assets[0].brokerId, 'broker-mudrex');
  assert.equal(upsertCaptures.length, 1);
  assert.equal(upsertCaptures[0].source, 'delta_exchange');
  assert.equal(upsertCaptures[0].attempted, 2);
  assert.equal(upsertCaptures[0].assets[0].brokerId, 'broker-delta');
  assert.equal(mudrexSync.data.deltaInsertedAssets, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(replaceCaptures[1].assets[0], 'userId'), false);
  assert.deepEqual(
    syncRequests.map((request) => request.source),
    ['binance', 'delta_exchange']
  );
}

async function runVisibilityFlowAssertions(): Promise<void> {
  const service = new ExchangeAssetsService() as any;
  const listVisibleRequests: Array<{
    userId: string;
    query: Record<string, unknown>;
  }> = [];
  const deltaVisibilityRequests: Array<{
    userId: string;
    source: string;
    symbols: string[];
  }> = [];

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async listVisibleAssetsForUser(userId: string, query: Record<string, unknown>) {
        listVisibleRequests.push({ userId, query });
        return {
          data: [
            {
              id: 'asset-row-1',
              source: 'mudrex',
              brokerId: 'broker-mudrex',
              externalId: 'mudrex:BTCUSDT',
              assetId: 'asset-btc',
              name: 'Bitcoin',
              symbol: 'BTCUSDT',
              createdAt: new Date('2026-04-04T09:00:00.000Z'),
              updatedAt: new Date('2026-04-04T09:00:00.000Z'),
            },
          ],
          total: 1,
        };
      },
      async listVisibleAssetsBySourceAndSymbolsForUser(
        userId: string,
        source: string,
        symbols: string[]
      ) {
        deltaVisibilityRequests.push({ userId, source, symbols });
        return [
          {
            id: 'asset-row-delta-1',
            source: 'delta_exchange',
            brokerId: 'broker-delta',
            externalId: 'delta:BTCUSD',
            assetId: 'asset-btc',
            name: 'Bitcoin',
            symbol: 'BTCUSD',
            createdAt: new Date('2026-04-04T09:00:00.000Z'),
            updatedAt: new Date('2026-04-04T09:00:00.000Z'),
          },
        ];
      },
    }),
  });

  const response = await service.getStoredExchangeAssets('user-1', {
    limit: '25',
    offset: '5',
    search: 'btc',
    source: 'mudrex',
  });

  assert.deepEqual(listVisibleRequests, [
    {
      userId: 'user-1',
      query: {
        limit: 25,
        offset: 5,
        search: 'btc',
        source: 'mudrex',
      },
    },
  ]);
  assert.deepEqual(deltaVisibilityRequests, [
    {
      userId: 'user-1',
      source: 'delta_exchange',
      symbols: ['BTCUSDT', 'BTCUSD', 'BTCUSDC'],
    },
  ]);
  assert.equal(response.data.assets[0].isDeltaMapped, true);
  assert.equal(response.data.assets[0].deltaExternalId, 'delta:BTCUSD');
}

async function runProductMapVisibilityAssertions(): Promise<void> {
  const service = new ConnectionsService() as any;
  const countRequests: Array<{ userId: string; source?: string }> = [];

  Object.defineProperty(service, 'exchangeAssetRepository', {
    get: () => ({
      async countVisibleAssetsForUser(userId: string, source?: string) {
        countRequests.push({ userId, source });
        return 7;
      },
    }),
  });

  const summary = await service.resolveConnectionProductMapSummary(
    'user-1',
    { brokerKey: 'delta_exchange' },
    {
      providerType: 'broker',
      category: 'broker',
      capabilities: ['assets', 'orders'],
    }
  );

  assert.deepEqual(countRequests, [{ userId: 'user-1', source: 'delta_exchange' }]);
  assert.deepEqual(summary, {
    supported: true,
    source: 'delta_exchange',
    total: 7,
  });
}

async function runDeltaLookupAssertions(): Promise<void> {
  const adapter = new DeltaExchangeOrdersAdapter() as any;
  const lookupCalls: string[] = [];
  const submittedPayloads: Record<string, unknown>[] = [];
  const leveragePayloads: Record<string, unknown>[] = [];
  const detailRequests: { accountId: string; routePath: string; userId?: string }[] = [];
  const publicProductRequests: string[] = [];
  const expectedClientOrderId = (key: string) =>
    `aur_${createHash('sha256').update(key).digest('hex').slice(0, 28)}`;

  Object.defineProperty(adapter, 'exchangeAssetRepository', {
    get: () => ({
      async getSystemAssetBySourceAndExternalId(source: string, externalId: string) {
        lookupCalls.push(`external:${source}:${externalId}`);
        return null;
      },
      async getSystemAssetBySourceAndAssetId(source: string, assetId: string) {
        lookupCalls.push(`asset:${source}:${assetId}`);
        return null;
      },
      async getSystemAssetBySourceAndSymbol(source: string, symbol: string) {
        lookupCalls.push(`symbol:${source}:${symbol}`);
        return {
          externalId: '45678',
          symbol,
        };
      },
    }),
  });

  Object.defineProperty(adapter, 'deltaHttpClient', {
    get: () => ({
      async publicGet(routePath: string) {
        publicProductRequests.push(routePath);
        return [
          {
            id: 45678,
            symbol: 'BTCUSD',
            contract_value: '0.001',
            contract_unit_currency: 'BTC',
            contract_type: 'perpetual_futures',
            notional_type: 'vanilla',
            state: 'live',
            trading_status: 'operational',
          },
        ];
      },
      async signedPost(
        accountId: string,
        routePath: string,
        payload: Record<string, unknown>,
        userId?: string
      ) {
        if (routePath === '/v2/products/45678/orders/leverage') {
          leveragePayloads.push({
            accountId,
            routePath,
            payload,
            userId,
          });
          return {
            leverage: payload.leverage,
            order_margin: '1.23',
            product_id: 45678,
          };
        }
        submittedPayloads.push({
          accountId,
          routePath,
          payload,
          userId,
        });
        if (
          (payload.client_order_id as string | undefined) ===
          expectedClientOrderId('live-auto:delta-market-short')
        ) {
          return {
            id: `delta-order-${submittedPayloads.length}`,
            state: 'closed',
          };
        }
        return {
          id: `delta-order-${submittedPayloads.length}`,
          state: 'open',
        };
      },
      async signedGet(
        accountId: string,
        routePath: string,
        _query?: Record<string, string | number | boolean | undefined>,
        userId?: string
      ) {
        detailRequests.push({ accountId, routePath, userId });
        if (routePath === '/v2/positions/margined') {
          return [];
        }
        if (routePath === '/v2/orders/delta-order-4') {
          return {
            id: 'delta-order-4',
            state: 'closed',
            average_fill_price: '97',
          };
        }
        if (routePath === '/v2/orders/delta-stop-child') {
          return {
            id: 'delta-stop-child',
            product_id: 45678,
            product_symbol: 'BTCUSD',
            side: 'sell',
            state: 'pending',
            order_type: 'market_order',
            time_in_force: 'gtc',
            limit_price: '107.25',
            stop_price: '105.50',
            average_fill_price: '105.75',
            stop_order_type: 'stop_loss_order',
            size: '2000',
            unfilled_size: '500',
            reduce_only: true,
          };
        }
        throw new Error(`Unexpected Delta signedGet ${routePath}`);
      },
    }),
  });

  const response = await adapter.createOrder(
    'BTCUSDT',
    {
      idempotency_key: 'live-auto:delta-limit-long',
      side: 'long',
      quantity: 2,
      reduce_only: false,
      order_type: 'limit',
      order_price: 101.5,
      leverage: 3,
      trigger_type: 'gtc',
      execution_mode: 'live',
      is_stoploss: false,
      is_takeprofit: false,
      stoploss_price: 95,
      takeprofit_price: 110,
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );

  assert.deepEqual(lookupCalls, [
    'external:delta_exchange:BTCUSDT',
    'asset:delta_exchange:BTCUSDT',
    'symbol:delta_exchange:BTCUSDT',
  ]);
  assert.deepEqual(leveragePayloads[0], {
    accountId: 'acct-1',
    routePath: '/v2/products/45678/orders/leverage',
    payload: {
      leverage: '3',
    },
    userId: 'user-1',
  });
  assert.deepEqual(submittedPayloads[0], {
    accountId: 'acct-1',
    routePath: '/v2/orders',
    payload: {
      product_id: 45678,
      size: 2000,
      side: 'buy',
      order_type: 'limit_order',
      time_in_force: 'gtc',
      client_order_id: expectedClientOrderId('live-auto:delta-limit-long'),
      limit_price: '101.5',
      bracket_stop_loss_price: '95',
      bracket_take_profit_price: '110',
      bracket_stop_trigger_method: 'mark_price',
    },
    userId: 'user-1',
  });
  assert.equal(response.order_id, 'delta-order-1');
  assert.equal(response.status, 'open');
  assert.equal(response.protection_status, 'pending_confirmation');
  assert.equal(response.protection_mode, 'native_bracket');
  assert.equal(response.bracket_status, 'submitted');
  assert.equal(response.bracket_stop_loss_price, '95');
  assert.equal(response.bracket_take_profit_price, '110');
  assert.equal(response.bracket_stop_trigger_method, 'mark_price');
  assert.equal(response.leverage, '3');
  assert.deepEqual(publicProductRequests, ['/v2/products']);

  const marketResponse = await adapter.createOrder(
    'BTCUSDT',
    {
      idempotency_key: 'live-auto:delta-market-short',
      side: 'short',
      quantity: 3,
      reduce_only: false,
      order_type: 'market',
      order_price: 100,
      leverage: 15,
      trigger_type: 'immediate',
      execution_mode: 'live',
      is_stoploss: false,
      is_takeprofit: false,
      stoploss_price: 105,
      takeprofit_price: 90,
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );
  assert.deepEqual(submittedPayloads[1], {
    accountId: 'acct-1',
    routePath: '/v2/orders',
    payload: {
      product_id: 45678,
      size: 3000,
      side: 'sell',
      order_type: 'limit_order',
      time_in_force: 'gtc',
      client_order_id: expectedClientOrderId('live-auto:delta-market-short'),
      limit_price: '100',
      bracket_stop_loss_price: '105',
      bracket_take_profit_price: '90',
      bracket_stop_trigger_method: 'mark_price',
    },
    userId: 'user-1',
  });
  assert.equal(marketResponse.order_id, 'delta-order-2');
  assert.equal(marketResponse.protection_status, 'pending_confirmation');
  assert.equal(marketResponse.protection_mode, 'native_bracket');
  assert.equal(marketResponse.bracket_status, 'submitted');
  assert.equal(marketResponse.bracket_stop_loss_price, '105');
  assert.equal(marketResponse.bracket_take_profit_price, '90');
  assert.equal(marketResponse.bracket_stop_trigger_method, 'mark_price');
  assert.equal(marketResponse.leverage, '15');
  assert.equal(marketResponse.protection_reference_price, '100');
  assert.equal(marketResponse.protection_rebased, false);
  assert.equal(
    detailRequests.filter((request) => request.routePath === '/v2/positions/margined').length,
    2
  );
  assert.deepEqual(
    detailRequests.filter((request) => request.routePath !== '/v2/positions/margined'),
    []
  );
  const stopChild = await adapter.getOrder('delta-stop-child', {
    userId: 'user-1',
    accountId: 'acct-1',
  });
  assert.equal(stopChild.price, 107.25);
  assert.equal(stopChild.limit_price, 107.25);
  assert.equal(stopChild.order_price, 107.25);
  assert.equal(stopChild.stop_price, 105.5);
  assert.equal(stopChild.trigger_price, 105.5);
  assert.equal(stopChild.filled_price, 105.75);
  assert.equal(stopChild.filled_quantity, 1500);
  assert.equal(stopChild.unfilled_size, 500);
  assert.equal(stopChild.stop_order_type, 'stop_loss_order');
  assert.equal(stopChild.reduce_only, true);

  await adapter.createOrder(
    'BTCUSDT',
    {
      idempotency_key: 'live-auto:delta-reduce-only-close-short',
      side: 'long',
      quantity: 1,
      reduce_only: true,
      order_type: 'limit',
      order_price: 99,
      leverage: 15,
      trigger_type: 'gtc',
      execution_mode: 'live',
      is_stoploss: false,
      is_takeprofit: false,
      stoploss_price: 95,
      takeprofit_price: 105,
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );
  assert.deepEqual(submittedPayloads[2], {
    accountId: 'acct-1',
    routePath: '/v2/orders',
    payload: {
      product_id: 45678,
      size: 1000,
      side: 'buy',
      order_type: 'limit_order',
      time_in_force: 'gtc',
      reduce_only: true,
      client_order_id: expectedClientOrderId('live-auto:delta-reduce-only-close-short'),
      limit_price: '99',
    },
    userId: 'user-1',
  });

  const convertedResponse = await adapter.createOrder(
    'BTCUSDT',
    {
      idempotency_key: 'live-auto:delta-notional-contract-conversion',
      side: 'long',
      quantity: 100 / 74739.2,
      reduce_only: false,
      order_type: 'market',
      order_price: 74739.2,
      leverage: 15,
      trigger_type: 'immediate',
      execution_mode: 'live',
      is_stoploss: false,
      is_takeprofit: false,
      stoploss_price: 73991.808,
      takeprofit_price: 76233.984,
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );
  assert.deepEqual(publicProductRequests, ['/v2/products']);
  assert.deepEqual(submittedPayloads[3], {
    accountId: 'acct-1',
    routePath: '/v2/orders',
    payload: {
      product_id: 45678,
      size: 1,
      side: 'buy',
      order_type: 'limit_order',
      time_in_force: 'gtc',
      client_order_id: expectedClientOrderId('live-auto:delta-notional-contract-conversion'),
      limit_price: '74739.2',
      bracket_stop_loss_price: '73991.808',
      bracket_take_profit_price: '76233.984',
      bracket_stop_trigger_method: 'mark_price',
    },
    userId: 'user-1',
  });
  assert.equal(convertedResponse.order_id, 'delta-order-4');
  assert.equal(convertedResponse.protection_status, 'pending_confirmation');
  assert.equal(convertedResponse.protection_mode, 'native_bracket');
  assert.equal(convertedResponse.bracket_status, 'submitted');
  assert.equal(convertedResponse.bracket_stop_loss_price, '73991.808');
  assert.equal(convertedResponse.bracket_take_profit_price, '76233.984');
  assert.equal(convertedResponse.bracket_stop_trigger_method, 'mark_price');
  assert.equal(convertedResponse.leverage, '15');
  assert.equal(convertedResponse.quantity, '1');
  assert.equal(convertedResponse.base_quantity, '0.001');
  assert.equal(convertedResponse.contract_value, '0.001');
  assert.equal(convertedResponse.amount, '74.7392');

  const conflictSignedGetCalls: Array<{
    accountId: string;
    routePath: string;
    userId?: string;
  }> = [];
  const conflictSubmittedPayloads: Record<string, unknown>[] = [];
  const conflictAdapter = new DeltaExchangeOrdersAdapter() as any;
  Object.defineProperty(conflictAdapter, 'exchangeAssetRepository', {
    get: () => ({
      async getSystemAssetBySourceAndExternalId() {
        return null;
      },
      async getSystemAssetBySourceAndAssetId() {
        return null;
      },
      async getSystemAssetBySourceAndSymbol(_source: string, symbol: string) {
        return {
          externalId: '45678',
          symbol,
        };
      },
    }),
  });
  Object.defineProperty(conflictAdapter, 'deltaHttpClient', {
    get: () => ({
      async publicGet(routePath: string) {
        assert.equal(routePath, '/v2/products');
        return [
          {
            id: 45678,
            symbol: 'BTCUSD',
            contract_value: '0.001',
            contract_unit_currency: 'BTC',
            contract_type: 'perpetual_futures',
            notional_type: 'vanilla',
            state: 'live',
            trading_status: 'operational',
          },
        ];
      },
      async signedGet(
        accountId: string,
        routePath: string,
        _query?: Record<string, string | number | boolean | undefined>,
        userId?: string
      ) {
        conflictSignedGetCalls.push({ accountId, routePath, userId });
        if (routePath === '/v2/positions/margined') {
          return [
            {
              product_id: 45678,
              product_symbol: 'BTCUSD',
              size: '-2',
            },
          ];
        }
        throw new Error(`Unexpected Delta signedGet ${routePath}`);
      },
      async signedPost(
        accountId: string,
        routePath: string,
        payload: Record<string, unknown>,
        userId?: string
      ) {
        conflictSubmittedPayloads.push({
          accountId,
          routePath,
          payload,
          userId,
        });
        return {
          id: 'delta-conflict-order',
          state: 'open',
        };
      },
    }),
  });

  await assert.rejects(
    () =>
      conflictAdapter.createOrder(
        'BTCUSDT',
        {
          idempotency_key: 'live-auto:delta-existing-net-position',
          side: 'long',
          quantity: 1,
          reduce_only: false,
          order_type: 'market',
          order_price: 100,
          leverage: 15,
          trigger_type: 'immediate',
          execution_mode: 'live',
          is_stoploss: false,
          is_takeprofit: false,
          stoploss_price: 95,
          takeprofit_price: 110,
        },
        {
          userId: 'user-1',
          accountId: 'acct-1',
        }
      ),
    /already has an open net position on this symbol/
  );
  assert.deepEqual(conflictSignedGetCalls, [
    {
      accountId: 'acct-1',
      routePath: '/v2/positions/margined',
      userId: 'user-1',
    },
  ]);
  assert.deepEqual(conflictSubmittedPayloads, []);

  assert.deepEqual(leveragePayloads, [
    {
      accountId: 'acct-1',
      routePath: '/v2/products/45678/orders/leverage',
      payload: {
        leverage: '3',
      },
      userId: 'user-1',
    },
    {
      accountId: 'acct-1',
      routePath: '/v2/products/45678/orders/leverage',
      payload: {
        leverage: '15',
      },
      userId: 'user-1',
    },
    {
      accountId: 'acct-1',
      routePath: '/v2/products/45678/orders/leverage',
      payload: {
        leverage: '15',
      },
      userId: 'user-1',
    },
  ]);
  for (const submittedPayload of submittedPayloads) {
    const clientOrderId = (submittedPayload.payload as Record<string, unknown>).client_order_id;
    if (clientOrderId) {
      assert.equal(
        String(clientOrderId).length <= 32,
        true,
        `Delta client_order_id must be <= 32 chars: ${clientOrderId}`
      );
    }
  }

  const indiaAdapter = new DeltaExchangeOrdersAdapter() as any;
  const indiaSubmittedPayloads: Record<string, unknown>[] = [];
  const indiaLeveragePayloads: Record<string, unknown>[] = [];
  Object.defineProperty(indiaAdapter, 'deltaHttpClient', {
    get: () => ({
      async publicGet(routePath: string) {
        assert.equal(routePath, '/v2/products');
        return [
          {
            id: 27,
            symbol: 'BTCUSD',
            contract_value: '0.001',
            contract_unit_currency: 'BTC',
            contract_type: 'perpetual_futures',
            notional_type: 'vanilla',
            state: 'live',
            trading_status: 'operational',
          },
        ];
      },
      async signedPost(
        accountId: string,
        routePath: string,
        payload: Record<string, unknown>,
        userId?: string
      ) {
        if (routePath === '/v2/products/27/orders/leverage') {
          indiaLeveragePayloads.push({
            accountId,
            routePath,
            payload,
            userId,
          });
          return {
            leverage: payload.leverage,
            order_margin: '4.56',
            product_id: 27,
          };
        }
        indiaSubmittedPayloads.push({
          accountId,
          routePath,
          payload,
          userId,
        });
        return {
          id: `delta-india-order-${indiaSubmittedPayloads.length}`,
          state: 'open',
        };
      },
      async signedGet() {
        return [];
      },
    }),
  });
  const indiaResponse = await indiaAdapter.createOrder(
    '139',
    {
      idempotency_key: 'live-auto:delta-india-btcusdt-alias',
      symbol: 'BTCUSDT',
      side: 'long',
      quantity: 100 / 74739.2,
      reduce_only: false,
      order_type: 'market',
      order_price: 74739.2,
      leverage: 15,
      trigger_type: 'immediate',
      execution_mode: 'live',
      is_stoploss: false,
      is_takeprofit: false,
      stoploss_price: 73991.808,
      takeprofit_price: 76233.984,
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );
  assert.deepEqual(indiaLeveragePayloads, [
    {
      accountId: 'acct-1',
      routePath: '/v2/products/27/orders/leverage',
      payload: {
        leverage: '15',
      },
      userId: 'user-1',
    },
  ]);
  assert.equal(indiaSubmittedPayloads[0].routePath, '/v2/orders');
  assert.deepEqual(
    indiaSubmittedPayloads.map((payload) => (payload.payload as any).product_id),
    [27]
  );
  assert.equal(
    (indiaSubmittedPayloads[0].payload as Record<string, unknown>).bracket_stop_loss_price,
    '73991.808'
  );
  assert.equal(
    (indiaSubmittedPayloads[0].payload as Record<string, unknown>).bracket_take_profit_price,
    '76233.984'
  );
  assert.equal(
    (indiaSubmittedPayloads[0].payload as Record<string, unknown>).bracket_stop_trigger_method,
    'mark_price'
  );
  assert.equal(indiaResponse.order_id, 'delta-india-order-1');
  assert.equal(indiaResponse.protection_status, 'pending_confirmation');
  assert.equal(indiaResponse.protection_mode, 'native_bracket');
  assert.equal(indiaResponse.bracket_status, 'submitted');

  await assert.rejects(
    () =>
      adapter.createOrder(
        'BTCUSDT',
        {
          side: 'long',
          quantity: 0.25,
          reduce_only: false,
          order_type: 'market',
          order_price: 100,
          leverage: 15,
          trigger_type: 'immediate',
        },
        {
          userId: 'user-1',
          accountId: 'acct-1',
        }
      ),
    /whole-number contract quantity/
  );
  await assert.rejects(
    () =>
      adapter.createOrder(
        'BTCUSDT',
        {
          idempotency_key: 'live-auto:delta-too-small',
          side: 'long',
          quantity: 0.0005,
          reduce_only: false,
          order_type: 'market',
          order_price: 74739.2,
          leverage: 15,
          trigger_type: 'immediate',
        },
        {
          userId: 'user-1',
          accountId: 'acct-1',
        }
      ),
    /smaller than one whole BTCUSD contract/
  );

  const staleAdapter = new DeltaExchangeOrdersAdapter() as any;
  Object.defineProperty(staleAdapter, 'exchangeAssetRepository', {
    get: () => ({
      async getSystemAssetBySourceAndExternalId() {
        return null;
      },
      async getSystemAssetBySourceAndAssetId() {
        return null;
      },
      async getSystemAssetBySourceAndSymbol() {
        return {
          externalId: '27',
          symbol: 'BTCUSDT',
        };
      },
    }),
  });
  Object.defineProperty(staleAdapter, 'deltaHttpClient', {
    get: () => ({
      async publicGet() {
        return [
          {
            id: 27,
            symbol: 'BTCUSD',
            contract_value: '1',
            contract_unit_currency: 'USD',
            contract_type: 'perpetual_futures',
            notional_type: 'inverse',
            state: 'expired',
            trading_status: 'operational',
          },
        ];
      },
      async signedPost() {
        throw new Error('stale Delta products must be blocked before broker placement');
      },
    }),
  });
  await assert.rejects(
    () =>
      staleAdapter.createOrder(
        'BTCUSDT',
        {
          idempotency_key: 'live-auto:delta-stale-product',
          side: 'long',
          quantity: 1,
          reduce_only: false,
          order_type: 'market',
          order_price: 74739.2,
          leverage: 15,
          trigger_type: 'immediate',
        },
        {
          userId: 'user-1',
          accountId: 'acct-1',
        }
      ),
    /not live and operational/
  );
  await assert.rejects(
    () =>
      adapter.createOrder(
        'BTCUSDT',
        {
          side: 'long',
          quantity: 1,
          reduce_only: false,
          order_type: 'stop',
          order_price: 100,
          leverage: 15,
          trigger_type: 'immediate',
        },
        {
          userId: 'user-1',
          accountId: 'acct-1',
        }
      ),
    /order_type must be market or limit/
  );
}

async function runMudrexLeverageVerificationAssertions(): Promise<void> {
  const adapter = new MudrexOrdersAdapter() as any;
  const createCalls: Array<{
    assetId: string;
    userId?: string;
    accountId?: string;
    leverage: unknown;
    orderType: unknown;
    triggerType: unknown;
    reduceOnly: unknown;
  }> = [];

  Object.defineProperty(adapter, 'ordersService', {
    get: () => ({
      async createFuturesOrder(
        assetId: string,
        body: Record<string, unknown>,
        userId?: string,
        accountId?: string
      ) {
        createCalls.push({
          assetId,
          userId,
          accountId,
          leverage: body.leverage,
          orderType: body.order_type,
          triggerType: body.trigger_type,
          reduceOnly: body.reduce_only,
        });
        return {
          success: true,
          data: {
            leverage: '12',
            amount: '100',
            quantity: '1',
            price: '2500',
            order_id: 'mudrex-order-1',
            status: 'OPEN',
            message: 'Order submitted',
          },
        };
      },
    }),
  });

  const response = await adapter.createOrder(
    'ETHUSDT',
    {
      side: 'long',
      quantity: 1,
      reduce_only: false,
      order_type: 'market',
      order_price: 2500,
      leverage: 12,
      trigger_type: 'immediate',
      execution_mode: 'live',
      is_stoploss: false,
      is_takeprofit: false,
      stoploss_price: 2450,
      takeprofit_price: 2600,
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );

  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    assetId: 'ETHUSDT',
    userId: 'user-1',
    accountId: 'acct-1',
    leverage: 12,
    orderType: 'LONG',
    triggerType: 'LIMIT',
    reduceOnly: false,
  });
  assert.equal((response as any).data.leverage, '12');

  await assert.rejects(
    () =>
      adapter.createOrder(
        'ETHUSDT',
        {
          side: 'long',
          quantity: 1,
          reduce_only: false,
          order_type: 'market',
          order_price: 2500,
          leverage: 15,
          trigger_type: 'immediate',
          execution_mode: 'live',
          is_stoploss: false,
          is_takeprofit: false,
          stoploss_price: 2450,
          takeprofit_price: 2600,
        },
        {
          userId: 'user-1',
          accountId: 'acct-1',
        }
      ),
    /Mudrex confirmed leverage 12 instead of requested leverage 15/
  );

  const reduceOnlyResponse = await adapter.createOrder(
    'ETHUSDT',
    {
      side: 'short',
      quantity: 1,
      reduce_only: true,
      order_type: 'market',
      order_price: 2500,
      leverage: 50,
      trigger_type: 'immediate',
      execution_mode: 'live',
      is_stoploss: false,
      is_takeprofit: false,
      stoploss_price: 2550,
      takeprofit_price: 2400,
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );
  assert.equal((reduceOnlyResponse as any).data.order_id, 'mudrex-order-1');
  assert.deepEqual(createCalls[2], {
    assetId: 'ETHUSDT',
    userId: 'user-1',
    accountId: 'acct-1',
    leverage: 50,
    orderType: 'SHORT',
    triggerType: 'MARKET',
    reduceOnly: true,
  });

  await adapter.createOrder(
    'ETHUSDT',
    {
      side: 'long',
      quantity: 1,
      reduce_only: false,
      order_type: 'limit',
      order_price: 2500,
      leverage: 12,
      trigger_type: 'gtc',
      execution_mode: 'live',
      is_stoploss: false,
      is_takeprofit: false,
      stoploss_price: 2450,
      takeprofit_price: 2600,
    },
    {
      userId: 'user-1',
      accountId: 'acct-1',
    }
  );
  assert.deepEqual(createCalls[3], {
    assetId: 'ETHUSDT',
    userId: 'user-1',
    accountId: 'acct-1',
    leverage: 12,
    orderType: 'LONG',
    triggerType: 'LIMIT',
    reduceOnly: false,
  });
}

async function runDeltaHttpClientErrorTransparencyAssertions(): Promise<void> {
  const client = new DeltaExchangeHttpClient() as any;

  assert.throws(
    () =>
      client.throwMappedError(
        403,
        {
          success: false,
          error: 'UnauthorizedApiAccess',
          message: 'Api Key not authorised to access this endpoint',
        },
        '/v2/orders'
      ),
    (error: unknown) => {
      const mapped = error as {
        httpCode?: number;
        message?: string;
        broker?: string;
        brokerStatusCode?: number;
        brokerRoutePath?: string;
        brokerErrorCode?: string;
        brokerErrorMessage?: string;
        brokerErrorPayload?: unknown;
      };
      assert.equal(mapped.httpCode, 403);
      assert.equal(mapped.broker, 'delta_exchange');
      assert.equal(mapped.brokerStatusCode, 403);
      assert.equal(mapped.brokerRoutePath, '/v2/orders');
      assert.equal(mapped.brokerErrorCode, 'UnauthorizedApiAccess');
      assert.equal(
        mapped.brokerErrorMessage,
        'UnauthorizedApiAccess: Api Key not authorised to access this endpoint'
      );
      assert.equal(
        String(mapped.message || '').includes('Api Key not authorised to access this endpoint'),
        true
      );
      assert.deepEqual(mapped.brokerErrorPayload, {
        success: false,
        error: 'UnauthorizedApiAccess',
        message: 'Api Key not authorised to access this endpoint',
      });
      return true;
    }
  );

  assert.throws(
    () =>
      client.throwMappedError(
        200,
        {
          success: false,
          error: {
            code: 'ip_not_whitelisted_for_api_key',
          },
        },
        '/v2/orders'
      ),
    (error: unknown) => {
      const mapped = error as {
        httpCode?: number;
        brokerErrorCode?: string;
        brokerErrorPayload?: unknown;
      };
      assert.equal(mapped.httpCode, 403);
      assert.equal(mapped.brokerErrorCode, 'ip_not_whitelisted_for_api_key');
      assert.deepEqual(mapped.brokerErrorPayload, {
        success: false,
        error: {
          code: 'ip_not_whitelisted_for_api_key',
        },
      });
      return true;
    }
  );
}

async function runFlowAssertions(): Promise<void> {
  await runSyncFlowAssertions();
  await runVisibilityFlowAssertions();
  await runProductMapVisibilityAssertions();
  await runDeltaLookupAssertions();
  await runMudrexLeverageVerificationAssertions();
  await runDeltaHttpClientErrorTransparencyAssertions();
}

function runPhase6Assertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('BROKER_ASSETS_PHASE6.md');
  ensureMarkers(
    phaseDoc,
    [
      'Phase 6 archives the rollout history and adds a live operational proof path for',
      '`npm run test:broker-assets`',
      '`npm run check:broker-assets-health`',
      '`npm run proof:broker-assets-live`',
      'The compatibility symbols `ExchangeAsset`, `ExchangeAssetRepository`, and',
      '## Phase 7 Entry Checklist',
    ],
    findings,
    'BROKER_ASSETS_PHASE6.md'
  );

  if (!read('BROKER_ASSETS_PHASE5.md').includes('BROKER_ASSETS_PHASE6.md')) {
    findings.push('BROKER_ASSETS_PHASE5.md: missing Phase 6 handoff');
  }

  const packageSource = read('package.json');
  ensureBrokerAssetsPackageWiring(packageSource, findings, 'package.json');
  for (const marker of ['"check:broker-assets-health"', '"proof:broker-assets-live"']) {
    if (!packageSource.includes(marker)) {
      findings.push(`package.json: missing Phase 6 script ${marker}`);
    }
  }
  if (
    !packageSource.includes('npm run test:broker-assets && npm run type-check') &&
    !packageSource.includes('npm run test:module-only && npm run type-check') &&
    !packageSource.includes('npm run test:broker-assets') &&
    !packageSource.includes('npm run test:module-only')
  ) {
    findings.push(
      'package.json: test:all should stay on the steady-state broker-assets umbrella or module-only bundle'
    );
  }
  if (packageSource.includes('npm run test:broker-assets-history && npm run type-check')) {
    findings.push(
      'package.json: test:all should not depend on an archived broker-assets history chain'
    );
  }

  const healthScript = read('scripts/checks/check-broker-assets-health.ts');
  ensureMarkers(
    healthScript,
    [
      '/health/queue',
      '/health/worker',
      '/scheduler/exchange-assets/config',
      '/scheduler/exchange-assets/assets',
      '/exchange-assets',
      'broker-assets-sync',
      'scheduler.exchange-assets.execute',
      'broker-assets-health-check:',
    ],
    findings,
    'check-broker-assets-health.ts'
  );

  const repositorySource = read('src/database/repositories/ExchangeAssetRepository.ts');
  ensureMarkers(
    repositorySource,
    [
      'connection.user_id = :visibleUserId',
      'connection.broker_id IS NOT NULL AND connection.broker_id = asset.broker_id',
      'account.user_id = :visibleUserId',
      'account.broker_id IS NOT NULL AND account.broker_id = asset.broker_id',
      'asset.symbol IN (:...symbols)',
    ],
    findings,
    'ExchangeAssetRepository.ts'
  );

  const proofScript = read('scripts/proofs/proof-broker-assets-live.ts');
  ensureMarkers(
    proofScript,
    [
      'scripts/release-gates/release-gate-broker-assets.ts',
      'scripts/checks/check-broker-assets-health.ts',
      'artifacts/broker-assets-release-gate.json',
      'artifacts/broker-assets-health.json',
      'artifacts/broker-assets-live-proof.json',
      'broker-assets-live-proof:',
    ],
    findings,
    'proof-broker-assets-live.ts'
  );

  ensureLegacyBrokerAssetsTestsRemoved(findings, 'broker-assets');

  assert.equal(findings.length, 0, `Broker assets Phase 6 guard failed:\n${findings.join('\n')}`);
}

async function runPhase7HealthThresholdChecks(): Promise<void> {
  const snapshot = buildBrokerAssetsHealthSnapshot({
    baseUrl: 'http://127.0.0.1:3000/api/v1',
    queuePayload: {
      data: {
        status: 'ok',
        queue: 'scheduler.exchange-assets.execute',
        latencyMs: 42,
      },
    },
    workerPayload: {
      data: {
        status: 'ok',
        workerHttpStatus: 'ok',
        heartbeatAgeMs: 2500,
      },
    },
    configPayload: {
      data: {
        key: 'broker-assets-sync',
        schedulerType: 'global',
        enabled: false,
        timezone: 'UTC',
        sources: ['mudrex', 'delta_exchange'],
      },
    },
    adminCatalogPayload: {
      data: {
        total: 480,
        items: [
          {
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
        ],
      },
    },
    adminCatalogLatencyMs: 320,
    visiblePayload: {
      data: {
        total: 12,
        assets: [
          {
            source: 'mudrex',
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
            isDeltaMapped: true,
            deltaExternalId: 'delta-btc',
            deltaSymbol: 'BTCUSDT',
          },
        ],
      },
    },
    visibleLatencyMs: 180,
    visibleQuerySource: null,
    visibleSearchTerm: 'BTC',
    visibleSearchPayload: {
      data: {
        assets: [
          {
            source: 'mudrex',
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
        ],
      },
    },
    adminSearchTerm: 'BTC',
    adminSearchPayload: {
      data: {
        items: [
          {
            symbol: 'BTCUSDT',
            name: 'Bitcoin',
          },
        ],
      },
    },
    sourceVisibleSummaries: {
      mudrex: {
        source: 'mudrex',
        total: 9,
        count: 5,
        latencyMs: 140,
        firstSymbol: 'BTCUSDT',
      },
      delta_exchange: {
        source: 'delta_exchange',
        total: 3,
        count: 3,
        latencyMs: 160,
        firstSymbol: 'BTCUSDT',
      },
    },
    thresholds: {
      maxAdminCatalogLatencyMs: 1000,
      maxVisibleLatencyMs: 1000,
      minAdminCatalogResults: 100,
      minVisibleResults: 5,
      requiredVisibleSources: ['mudrex', 'delta_exchange'],
      minVisibleResultsBySource: {
        mudrex: 5,
        delta_exchange: 1,
      },
    },
  });

  assert.equal(snapshot.thresholdProfile.mode, 'bounded');
  assert.equal(snapshot.sourceVisibleSummaries.mudrex.total, 9);
  assert.equal(snapshot.sourceVisibleSummaries.delta_exchange.total, 3);
  assertBrokerAssetsHealthSnapshot(snapshot, {
    requireAdminResults: true,
    requireVisibleResults: true,
  });
}

async function runPhase7SignoffChecks(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'broker-assets-phase7-'));
  const gateFile = path.join(tempDir, 'broker-assets-release-gate.json');
  const proofFile = path.join(tempDir, 'broker-assets-live-proof.json');
  const outputFile = path.join(tempDir, 'broker-assets-signoff.json');

  const healthSnapshot = {
    schedulerType: 'global',
    queueStatus: 'ok',
    workerStatus: 'ok',
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 6,
      requiredThresholdCount: 6,
      configuredKeys: [
        'maxAdminCatalogLatencyMs',
        'maxVisibleLatencyMs',
        'minAdminCatalogResults',
        'minVisibleResults',
        'minVisibleResultsBySource.mudrex',
        'minVisibleResultsBySource.delta_exchange',
      ],
      missingKeys: [],
    },
  };

  const gateSummary = {
    decision: 'ready',
    startedAt: '2026-04-10T12:00:00.000Z',
    finishedAt: '2026-04-10T12:05:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: path.join(tempDir, 'broker-assets-health.json'),
    healthSnapshot,
    totals: {
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
    },
    results: [
      releaseGateSuiteKey,
      'backend-broker-assets-eslint',
      'backend-broker-assets-live-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };
  const proofSummary = {
    decision: 'ready',
    gateDecision: 'ready',
    healthSnapshot,
  };

  await writeFile(gateFile, `${JSON.stringify(gateSummary, null, 2)}\n`, 'utf8');
  await writeFile(proofFile, `${JSON.stringify(proofSummary, null, 2)}\n`, 'utf8');

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/signoffs/signoff-broker-assets.ts'],
    {
      ...process.env,
      BROKER_ASSETS_SIGNOFF_GATE_FILE: gateFile,
      BROKER_ASSETS_SIGNOFF_PROOF_FILE: proofFile,
      BROKER_ASSETS_SIGNOFF_OUTPUT_FILE: outputFile,
      BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_HEALTH: 'true',
      BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF: 'true',
      BROKER_ASSETS_SIGNOFF_REQUIRE_DEPLOYMENT_EVIDENCE: 'true',
      BROKER_ASSETS_SIGNOFF_GLOBAL_CATALOG_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_CONNECTED_VISIBILITY_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_DELTA_LOOKUP_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED: 'true',
      BROKER_ASSETS_SIGNOFF_APPROVER: 'codex-phase7',
      BROKER_ASSETS_SIGNOFF_STAGING_WORKFLOW_URL: 'https://example.com/workflows/broker-assets',
      BROKER_ASSETS_SIGNOFF_DASHBOARD_URL: 'https://example.com/dashboards/broker-assets',
      BROKER_ASSETS_SIGNOFF_RUNBOOK_URL: 'https://example.com/runbooks/broker-assets',
      BROKER_ASSETS_SIGNOFF_RELEASE_NOTE_URL: 'https://example.com/releases/broker-assets',
    }
  );

  assert.equal(exitCode, 0, 'broker-assets signoff script should succeed against a ready gate');

  const rawOutput = await readFile(outputFile, 'utf8');
  const summary = JSON.parse(rawOutput) as {
    decision: string;
    approver: string;
    checks: Record<string, boolean>;
    readiness: Record<string, boolean>;
  };

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase7');
  assert.equal(summary.checks.requiredSuitesPassed, true);
  assert.equal(summary.checks.liveHealthReviewed, true);
  assert.equal(summary.checks.liveProofReviewed, true);
  assert.equal(summary.readiness.productionPromotionReady, true);
}

async function runPhase7SourceMarkerAssertions(): Promise<void> {
  const healthSource = await readFile(
    path.join(process.cwd(), 'scripts', 'checks', 'check-broker-assets-health.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-broker-assets.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-broker-assets.ts'),
    'utf8'
  );
  const auditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(path.join(process.cwd(), 'BROKER_ASSETS_PHASE7.md'), 'utf8');
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'BROKER_ASSETS_PHASE6.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    healthSource.includes('export function resolveBrokerAssetsHealthThresholds'),
    true,
    'broker-assets health script must export threshold resolution helpers for Phase 7 checks'
  );
  assert.equal(
    healthSource.includes('export function buildBrokerAssetsHealthThresholdProfile'),
    true,
    'broker-assets health script must export threshold profile helpers for Phase 7 checks'
  );
  assert.equal(
    healthSource.includes('const isDirectRun = (() => {'),
    true,
    'broker-assets health script must only auto-run when invoked directly'
  );
  assert.equal(
    releaseGateSource.includes(releaseGateSuiteKey),
    true,
    'broker-assets release gate must include the consolidated broker-assets suite'
  );
  assert.equal(
    releaseGateSource.includes('BROKER_ASSETS_RUN_LIVE_CHECKS'),
    true,
    'broker-assets release gate must support optional live checks'
  );
  assert.equal(
    releaseGateSource.includes('backend-broker-assets-live-health'),
    true,
    'broker-assets release gate must expose a live health check key'
  );
  assert.equal(
    signoffSource.includes('BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF'),
    true,
    'broker-assets signoff must support optional live proof enforcement'
  );
  assert.equal(
    signoffSource.includes('BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED'),
    true,
    'broker-assets signoff must require threshold verification'
  );
  assert.equal(
    signoffSource.includes('BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED'),
    true,
    'broker-assets signoff must require provider identity review'
  );
  assert.equal(
    signoffSource.includes(releaseGateSuiteKey),
    true,
    'broker-assets signoff must require the consolidated broker-assets suite'
  );
  assert.equal(
    auditSource.includes('"signoff:broker-assets"'),
    true,
    'operational audit must treat broker-assets signoff as a required workflow surface'
  );
  assert.equal(
    packageSource.includes(`"${moduleTestCommand}"`) &&
      packageSource.includes(moduleTestScriptPath),
    true,
    'package.json must include the consolidated broker-assets suite'
  );
  assert.equal(
    packageSource.includes('"signoff:broker-assets"'),
    true,
    'package.json must include broker-assets signoff'
  );
  assert.equal(
    phaseDoc.includes('Phase 7 turns broker-assets into a release-ready workflow'),
    true,
    'BROKER_ASSETS_PHASE7.md must document the Phase 7 release workflow'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 8'),
    true,
    'BROKER_ASSETS_PHASE7.md must include the Phase 8 handoff checklist'
  );
  assert.equal(
    previousPhaseDoc.includes('BROKER_ASSETS_PHASE7.md'),
    true,
    'BROKER_ASSETS_PHASE6.md must point forward to the Phase 7 handoff'
  );
  assert.equal(
    readmeSource.includes('BROKER_ASSETS_PHASE7.md') ||
      readmeSource.includes('BROKER_ASSETS_PHASE8.md') ||
      readmeSource.includes('BROKER_ASSETS_PHASE9.md'),
    true,
    'README.md must reference a broker-assets release workflow note'
  );
}

async function runPhase7Assertions(): Promise<void> {
  await runPhase7HealthThresholdChecks();
  await runPhase7SignoffChecks();
  await runPhase7SourceMarkerAssertions();
}

async function runPhase8LiveProofAssertions(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'broker-assets-phase8-'));
  const gateFile = path.join(tempDir, 'broker-assets-release-gate.json');
  const signoffFile = path.join(tempDir, 'broker-assets-signoff.json');
  const healthFile = path.join(tempDir, 'broker-assets-health.json');
  const proofFile = path.join(tempDir, 'broker-assets-live-proof.json');
  const evidenceFile = path.join(tempDir, 'broker-assets-deployment-evidence.json');
  const gateScript = path.join(tempDir, 'release-gate.stub.ts');
  const signoffScript = path.join(tempDir, 'signoff.stub.ts');

  const readyHealthSnapshot = {
    baseUrl: 'http://127.0.0.1:3102/api/v1',
    queueStatus: 'ok',
    queueName: 'scheduler.exchange-assets.execute',
    workerStatus: 'ok',
    workerHttpStatus: 'ok',
    schedulerKey: 'broker-assets-sync',
    schedulerType: 'global',
    schedulerSources: ['mudrex', 'delta_exchange'],
    visibleTotal: 12,
    adminCatalogTotal: 480,
    thresholdProfile: {
      mode: 'bounded',
      configuredThresholdCount: 6,
      requiredThresholdCount: 6,
      configuredKeys: [
        'maxAdminCatalogLatencyMs',
        'maxVisibleLatencyMs',
        'minAdminCatalogResults',
        'minVisibleResults',
        'minVisibleResultsBySource.mudrex',
        'minVisibleResultsBySource.delta_exchange',
      ],
      missingKeys: [],
    },
  };

  const readyGateSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:00:00.000Z',
    liveChecksEnabled: true,
    healthSnapshotFile: path.resolve(process.cwd(), healthFile),
    healthSnapshot: readyHealthSnapshot,
    totals: {
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
    },
    results: [
      releaseGateSuiteKey,
      'backend-broker-assets-eslint',
      'backend-broker-assets-live-health',
    ].map((key) => ({
      key,
      label: key,
      status: 'passed',
    })),
  };

  const readySignoffSummary = {
    decision: 'ready',
    generatedAt: '2026-04-10T12:05:00.000Z',
    approver: 'codex-phase8',
    checks: {
      gateReady: true,
      requiredSuitesPassed: true,
      liveHealthReviewed: true,
      liveProofReviewed: true,
      thresholdPostureCaptured: true,
      globalCatalogVerified: true,
      connectedVisibilityVerified: true,
      deltaLookupVerified: true,
      sourceThresholdsVerified: true,
      identityConstraintsReviewed: true,
      placeholderEvidenceAcknowledged: true,
      unboundedThresholdsAcknowledged: true,
    },
    evidence: {
      stagingWorkflowUrl: 'https://example.com/workflows/broker-assets',
      dashboardUrl: 'https://example.com/dashboards/broker-assets',
      runbookUrl: 'https://example.com/runbooks/broker-assets',
      releaseNoteUrl: 'https://example.com/releases/broker-assets',
    },
    evidenceClassification: {
      stagingWorkflowUrlKind: 'remote_url',
      dashboardUrlKind: 'remote_url',
      runbookUrlKind: 'remote_url',
      releaseNoteUrlKind: 'remote_url',
    },
    environment: {
      requireLiveHealth: true,
      requireLiveProof: false,
      requireDeploymentEvidence: false,
    },
    acknowledgements: {
      placeholderEvidenceUsed: false,
      unboundedThresholdsUsed: false,
    },
    readiness: {
      deploymentEvidenceReady: true,
      thresholdProfileMode: 'bounded',
      liveGateReady: true,
      liveProofReady: false,
      productionPromotionReady: true,
    },
    thresholdProfile: readyHealthSnapshot.thresholdProfile,
  };

  await writeFile(
    gateScript,
    `import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputFile = path.resolve(process.cwd(), String(process.env.BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE || '').trim());
const healthFile = path.resolve(process.cwd(), String(process.env.BROKER_ASSETS_HEALTH_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.BROKER_ASSETS_RUN_LIVE_CHECKS, 'true');
  assert.ok(outputFile, 'BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE must be provided');
  assert.ok(healthFile, 'BROKER_ASSETS_HEALTH_OUTPUT_FILE must be provided');
  await mkdir(path.dirname(outputFile), { recursive: true });
  await mkdir(path.dirname(healthFile), { recursive: true });
  const health = ${JSON.stringify(readyHealthSnapshot, null, 2)};
  const summary = ${JSON.stringify(readyGateSummary, null, 2)};
  await writeFile(healthFile, \`\${JSON.stringify(health, null, 2)}\\n\`, 'utf8');
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
    'utf8'
  );

  await writeFile(
    signoffScript,
    `import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const gateFile = path.resolve(process.cwd(), String(process.env.BROKER_ASSETS_SIGNOFF_GATE_FILE || '').trim());
const outputFile = path.resolve(process.cwd(), String(process.env.BROKER_ASSETS_SIGNOFF_OUTPUT_FILE || '').trim());

async function run(): Promise<void> {
  assert.equal(process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_HEALTH, 'true');
  assert.equal(process.env.BROKER_ASSETS_SIGNOFF_REQUIRE_LIVE_PROOF, 'false');
  const rawGate = await readFile(gateFile, 'utf8');
  const gate = JSON.parse(rawGate) as { decision?: string; liveChecksEnabled?: boolean };
  assert.equal(gate.decision, 'ready');
  assert.equal(gate.liveChecksEnabled, true);
  await mkdir(path.dirname(outputFile), { recursive: true });
  const summary = ${JSON.stringify(readySignoffSummary, null, 2)};
  await writeFile(outputFile, \`\${JSON.stringify(summary, null, 2)}\\n\`, 'utf8');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`,
    'utf8'
  );

  const exitCode = await runCommand(
    process.execPath,
    ['--import', 'tsx', 'scripts/proofs/proof-broker-assets-live.ts'],
    {
      ...process.env,
      BROKER_ASSETS_PROOF_RELEASE_GATE_SCRIPT: gateScript,
      BROKER_ASSETS_PROOF_SIGNOFF_SCRIPT: signoffScript,
      BROKER_ASSETS_RELEASE_GATE_OUTPUT_FILE: gateFile,
      BROKER_ASSETS_SIGNOFF_OUTPUT_FILE: signoffFile,
      BROKER_ASSETS_HEALTH_OUTPUT_FILE: healthFile,
      BROKER_ASSETS_PROOF_OUTPUT_FILE: proofFile,
      BROKER_ASSETS_EVIDENCE_OUTPUT_FILE: evidenceFile,
      BROKER_ASSETS_SIGNOFF_APPROVER: 'codex-phase8',
      BROKER_ASSETS_SIGNOFF_GLOBAL_CATALOG_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_CONNECTED_VISIBILITY_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_DELTA_LOOKUP_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_SOURCE_THRESHOLDS_VERIFIED: 'true',
      BROKER_ASSETS_SIGNOFF_IDENTITY_CONSTRAINTS_REVIEWED: 'true',
    }
  );

  assert.equal(exitCode, 0, 'broker-assets live proof should succeed against ready stub scripts');

  const rawProof = await readFile(proofFile, 'utf8');
  const summary = JSON.parse(rawProof) as JsonRecord;

  assert.equal(summary.decision, 'ready');
  assert.equal(summary.approver, 'codex-phase8');
  assert.equal(summary.gateDecision, 'ready');
  assert.equal(summary.signoffDecision, 'ready');
  assert.equal(summary.liveChecksEnabled, true);
  assert.equal(summary.releaseGateFile, path.resolve(process.cwd(), gateFile));
  assert.equal(summary.signoffFile, path.resolve(process.cwd(), signoffFile));
  assert.equal(summary.healthFile, path.resolve(process.cwd(), healthFile));
  assert.equal(summary.proofOutputFile, path.resolve(process.cwd(), proofFile));
  assert.equal(summary.deploymentEvidenceOutputFile, path.resolve(process.cwd(), evidenceFile));
  assert.deepEqual(summary.gateTotals, readyGateSummary.totals);

  const checks = (summary.checks || {}) as JsonRecord;
  assert.equal(checks.liveHealthReviewed, true);
  assert.equal(checks.deltaLookupVerified, true);

  const healthSnapshot = (summary.healthSnapshot || {}) as JsonRecord;
  assert.equal(healthSnapshot.schedulerType, 'global');

  const rawEvidence = await readFile(evidenceFile, 'utf8');
  const evidenceSummary = JSON.parse(rawEvidence) as JsonRecord;
  assert.equal(evidenceSummary.decision, 'ready');
  assert.equal(evidenceSummary.proofFile, path.resolve(process.cwd(), proofFile));
  assert.equal(evidenceSummary.deploymentPromotionReady, true);
}

async function runPhase8SourceMarkerAssertions(): Promise<void> {
  const proofSource = await readFile(
    path.join(process.cwd(), 'scripts', 'proofs', 'proof-broker-assets-live.ts'),
    'utf8'
  );
  const releaseGateSource = await readFile(
    path.join(process.cwd(), 'scripts', 'release-gates', 'release-gate-broker-assets.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-broker-assets.ts'),
    'utf8'
  );
  const operationalAuditSource = await readFile(
    path.join(process.cwd(), 'scripts', 'test-operational-audit.ts'),
    'utf8'
  );
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const phaseDoc = await readFile(path.join(process.cwd(), 'BROKER_ASSETS_PHASE8.md'), 'utf8');
  const previousPhaseDoc = await readFile(
    path.join(process.cwd(), 'BROKER_ASSETS_PHASE7.md'),
    'utf8'
  );
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(
    proofSource.includes('scripts/signoffs/signoff-broker-assets.ts'),
    true,
    'broker-assets proof script must drive broker-assets signoff in Phase 8'
  );
  assert.equal(
    proofSource.includes('artifacts/broker-assets-signoff.json'),
    true,
    'broker-assets proof script must reference the signoff artifact in Phase 8'
  );
  assert.equal(
    proofSource.includes('artifacts/broker-assets-deployment-evidence.json'),
    true,
    'broker-assets proof script must reference the deployment evidence artifact in Phase 8'
  );
  assert.equal(
    proofSource.includes('broker-assets-deployment-evidence:'),
    true,
    'broker-assets proof script must emit the deployment evidence marker in Phase 8'
  );
  assert.equal(
    releaseGateSource.includes(releaseGateSuiteKey),
    true,
    'broker-assets release gate must include the consolidated broker-assets suite'
  );
  assert.equal(
    signoffSource.includes(releaseGateSuiteKey),
    true,
    'broker-assets signoff must require the consolidated broker-assets gate result'
  );
  assert.equal(
    operationalAuditSource.includes('"proof:broker-assets-live"'),
    true,
    'operational audit must treat the broker-assets proof workflow as required'
  );
  assert.equal(
    packageSource.includes(`"${moduleTestCommand}"`) &&
      packageSource.includes(moduleTestScriptPath),
    true,
    'package.json must include the consolidated broker-assets suite'
  );
  assert.equal(
    phaseDoc.includes(
      'Phase 8 closes the remaining operational gap after the Phase 7 release gate.'
    ),
    true,
    'BROKER_ASSETS_PHASE8.md must document the Phase 8 proof workflow'
  );
  assert.equal(
    phaseDoc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'BROKER_ASSETS_PHASE8.md must include the Phase 9 handoff checklist'
  );
  assert.equal(
    previousPhaseDoc.includes('BROKER_ASSETS_PHASE8.md'),
    true,
    'BROKER_ASSETS_PHASE7.md must point forward to the Phase 8 handoff'
  );
  assert.equal(
    readmeSource.includes('proof:broker-assets-live'),
    true,
    'README.md must reference the broker-assets live proof workflow'
  );
}

async function runPhase8Assertions(): Promise<void> {
  await runPhase8LiveProofAssertions();
  await runPhase8SourceMarkerAssertions();
}

async function runPhase9Assertions(): Promise<void> {
  const packageSource = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const readmeSource = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');
  const phase8Doc = await readFile(path.join(process.cwd(), 'BROKER_ASSETS_PHASE8.md'), 'utf8');
  const phase9Doc = await readFile(path.join(process.cwd(), 'BROKER_ASSETS_PHASE9.md'), 'utf8');
  const captureSource = await readFile(
    path.join(process.cwd(), 'scripts', 'capture', 'capture-broker-assets-evidence.ts'),
    'utf8'
  );
  const signoffSource = await readFile(
    path.join(process.cwd(), 'scripts', 'signoffs', 'signoff-broker-assets.ts'),
    'utf8'
  );

  assert.equal(
    packageSource.includes('"capture:broker-assets-evidence"'),
    true,
    'package.json must expose the broker-assets evidence capture command in Phase 9'
  );
  assert.equal(
    packageSource.includes(`"${moduleTestCommand}"`) &&
      packageSource.includes(moduleTestScriptPath),
    true,
    'package.json must expose the consolidated broker-assets suite in Phase 9'
  );
  assert.equal(
    readmeSource.includes('BROKER_ASSETS_PHASE9.md'),
    true,
    'README.md must point to the Phase 9 broker-assets workflow note'
  );
  assert.equal(
    readmeSource.includes('capture:broker-assets-evidence'),
    true,
    'README.md must reference the broker-assets evidence capture command'
  );
  assert.equal(
    phase8Doc.includes('## 4) Carry-Forward For Phase 9'),
    true,
    'BROKER_ASSETS_PHASE8.md must keep the Phase 9 handoff checklist'
  );
  assert.equal(
    phase9Doc.includes('npm run capture:broker-assets-evidence'),
    true,
    'BROKER_ASSETS_PHASE9.md must document the evidence capture command'
  );
  assert.equal(
    phase9Doc.includes('npm run proof:broker-assets-live'),
    true,
    'BROKER_ASSETS_PHASE9.md must document the live proof command'
  );
  assert.equal(
    phase9Doc.includes('bounded thresholds'),
    true,
    'BROKER_ASSETS_PHASE9.md must record the bounded-threshold posture'
  );
  assert.equal(
    captureSource.includes('artifacts/broker-assets-workflow-evidence.json'),
    true,
    'capture-broker-assets-evidence.ts must write the workflow evidence artifact'
  );
  assert.equal(
    captureSource.includes('artifacts/broker-assets-dashboard-evidence.json'),
    true,
    'capture-broker-assets-evidence.ts must write the dashboard evidence artifact'
  );
  assert.equal(
    captureSource.includes('/scheduler/exchange-assets/assets'),
    true,
    'capture-broker-assets-evidence.ts must capture the admin catalog evidence path'
  );
  assert.equal(
    captureSource.includes('/exchange-assets?limit='),
    true,
    'capture-broker-assets-evidence.ts must capture the visible broker-assets evidence path'
  );
  assert.equal(
    signoffSource.includes(
      'const proof = REQUIRE_LIVE_PROOF ? await readOptionalProofSummary() : null;'
    ),
    true,
    'signoff-broker-assets.ts must ignore stale proof files unless live-proof review is required in Phase 9'
  );
}

async function run(): Promise<void> {
  runPhase1Assertions();
  runPhase2Assertions();
  runPhase3Assertions();
  await runPhase4Assertions();
  runPhase5ContractAssertions();
  await runFlowAssertions();
  runPhase6Assertions();
  await runPhase7Assertions();
  await runPhase8Assertions();
  await runPhase9Assertions();
  console.log('Broker assets consolidated assertions passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
