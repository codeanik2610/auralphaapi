import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const frontendRoot = '/Users/apple/Documents/Project/Frontend/aurAlphaApp';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function readFrontend(relativePath: string): string {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
}

function run(): void {
  const findings: string[] = [];

  const phaseDoc = read('GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md');
  for (const marker of [
    '`broker-assets-sync`',
    '`exchange-assets-sync`',
    '`binance-candles-3m-1m-sync`',
    '`system-health-sync`',
    'The Active Scheduler Status drawer no longer issues per-scheduler latest-run',
    'The selected scheduler card now shows the latest trigger and recent outcome',
    'Recent runs and run updates now show initiator attribution in the frontend.',
    'Phase 8 can focus on proof and subsystem validation',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md: missing contract marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('GLOBAL_SYSTEM_SCHEDULERS_PHASE7.md')) {
    findings.push('README.md: missing global system schedulers Phase 7 baseline link');
  }
  if (!readme.includes('frontend/operator consumption')) {
    findings.push('README.md: missing global system scheduler Phase 7 summary');
  }

  const schedulersPage = readFrontend('src/pages/Schedulers/index.jsx');
  for (const marker of [
    'const schedulerOverviewByKey = useMemo(() => {',
    'const selectedSchedulerAuditLabel = useMemo(',
    'const selectedSchedulerOutcomeLabel = useMemo(() => {',
    "headerName: 'Triggered by'",
    "headerName: 'Initiated by'",
    "headerName: 'By'",
    'buildSchedulerAuditSummary(',
  ]) {
    if (!schedulersPage.includes(marker)) {
      findings.push(`frontend Schedulers index.jsx: missing Phase 7 marker ${marker}`);
    }
  }
  for (const removedMarker of [
    'overviewLatestRunsByType',
    'getLatestSchedulerRunFromResponse(',
    'tradingApi.getSchedulerRuns(config, schedulerType',
  ]) {
    if (schedulersPage.includes(removedMarker)) {
      findings.push(`frontend Schedulers index.jsx: stale Phase 6 fallback still present ${removedMarker}`);
    }
  }

  const overviewWorkspace = readFrontend(
    'src/pages/Schedulers/components/SchedulerOverviewWorkspace.jsx'
  );
  for (const marker of ['Latest trigger:', 'Recent outcome:']) {
    if (!overviewWorkspace.includes(marker)) {
      findings.push(
        `frontend SchedulerOverviewWorkspace.jsx: missing Phase 7 marker ${marker}`
      );
    }
  }

  const schedulersPageTest = readFrontend('src/pages/Schedulers/index.test.jsx');
  for (const marker of [
    'renders active status rows from overview recent-run snapshots without extra latest-run API hydration',
    'expect(tradingApi.getSchedulerRuns).not.toHaveBeenCalled();',
    'shows selected scheduler trigger, outcome, and last execution from the overview contract',
  ]) {
    if (!schedulersPageTest.includes(marker)) {
      findings.push(`frontend Schedulers index.test.jsx: missing Phase 7 test marker ${marker}`);
    }
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:global-system-schedulers-phase7"')) {
    findings.push('package.json: missing global system schedulers Phase 7 test script');
  }
  if (!packageSource.includes('npm run test:global-system-schedulers-phase7')) {
    findings.push('package.json: global system schedulers Phase 7 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Global system schedulers Phase 7 guard failed:\n${findings.join('\n')}`
  );
  console.log('Global system schedulers Phase 7 guard passed.');
}

run();
