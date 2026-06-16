import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function runPositionsHistoryBackfillScriptAssertions(): void {
  const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.['rebuild:positions-history'],
    'node --import tsx scripts/rebuild/backfill-positions-history-and-rebuild.ts'
  );

  const manifestSource = read('scripts/_support/system-coverage-manifest.ts');
  assert.match(manifestSource, /rebuild:positions-history/);
  assert.match(manifestSource, /scripts\/rebuild\/backfill-positions-history-and-rebuild\.ts/);

  const scriptSource = read('scripts/rebuild/backfill-positions-history-and-rebuild.ts');
  assert.match(scriptSource, /POSITIONS_BACKFILL_APPLY/);
  assert.match(scriptSource, /POSITIONS_BACKFILL_DRY_RUN/);
  assert.match(scriptSource, /state: 'dry_run'/);
  assert.match(scriptSource, /POSITIONS_BACKFILL_START_DATE/);
  assert.match(scriptSource, /POSITIONS_BACKFILL_END_DATE/);
  assert.match(scriptSource, /backfill: true/);
  assert.match(scriptSource, /syncService\.runBatch\(syncRequest\)/);
  assert.match(scriptSource, /repository\.rebuildReadModelsFromSnapshots\(targetAccountIds\)/);
  assert.ok(
    scriptSource.indexOf('syncService.runBatch(syncRequest)') <
      scriptSource.indexOf('repository.rebuildReadModelsFromSnapshots(targetAccountIds)'),
    'Phase 5 script must refresh snapshots before rebuilding read models'
  );
}

runPositionsHistoryBackfillScriptAssertions();
console.log('Positions history backfill script assertions passed.');
