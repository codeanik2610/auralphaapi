import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractBlock(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing signature: ${signature}`);
  const braceStart = source.indexOf('{', start);
  assert.notEqual(braceStart, -1, `Missing opening brace for: ${signature}`);

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, index + 1);
      }
    }
  }

  assert.fail(`Unclosed block for: ${signature}`);
}

function run(): void {
  const brokerAccountRepositorySource = read(
    'src/database/repositories/BrokerAccountRepository.ts'
  );
  const fundsSchedulerSource = read('src/api/services/FundsSchedulerService.ts');
  const internalOrdersSource = read('src/api/services/InternalOrdersSyncService.ts');
  const internalPositionsSource = read('src/api/services/InternalPositionsSyncService.ts');
  const ordersSchedulerSource = read('src/api/services/OrdersSchedulerService.ts');
  const packageSource = read('package.json');
  const readmeSource = read('README.md');
  const phaseDoc = read('SCHEDULER_ACCOUNT_SCOPE_PHASE3.md');

  const genericAllActiveBlock = extractBlock(
    brokerAccountRepositorySource,
    'async getAllActiveBrokerAccounts(brokerKey?: string): Promise<BrokerAccount[]>'
  );
  assert.equal(
    genericAllActiveBlock.includes("status: In(['Connected', 'Idle'])"),
    true,
    'BrokerAccountRepository.getAllActiveBrokerAccounts must stay a generic active-account read'
  );
  assert.equal(
    genericAllActiveBlock.includes('userId'),
    false,
    'BrokerAccountRepository.getAllActiveBrokerAccounts must not silently become a user-owned-only helper'
  );
  assert.equal(
    genericAllActiveBlock.includes('IsNull'),
    false,
    'BrokerAccountRepository.getAllActiveBrokerAccounts must not embed system-account ownership filtering'
  );

  const systemAccountsBlock = extractBlock(
    brokerAccountRepositorySource,
    'async getActiveSystemBrokerAccounts(brokerKey?: string): Promise<BrokerAccount[]>'
  );
  assert.equal(
    systemAccountsBlock.includes('userId: IsNull()'),
    true,
    'BrokerAccountRepository must keep the explicit system-account helper for true system workflows'
  );

  for (const [label, source] of [
    ['FundsSchedulerService.ts', fundsSchedulerSource],
    ['InternalOrdersSyncService.ts', internalOrdersSource],
    ['InternalPositionsSyncService.ts', internalPositionsSource],
  ] as const) {
    assert.equal(
      source.includes('private groupInfraAccountsByOwner(') &&
        source.includes('if (!ownerUserId) {') &&
        source.includes('continue;'),
      true,
      `${label} must skip ownerless system accounts at the service layer`
    );
  }

  assert.equal(
    ordersSchedulerSource.includes(
      'const activeAccounts = await this.brokerAccountRepository.getAllActiveBrokerAccounts('
    ),
    true,
    'OrdersSchedulerService scoped replay must start from the generic all-active repository read'
  );
  assert.equal(
    ordersSchedulerSource.includes("if (!String(account.userId || '').trim()) {"),
    true,
    'OrdersSchedulerService scoped replay must reject ownerless system accounts after the generic lookup'
  );

  assert.equal(
    packageSource.includes('"test:scheduler-account-scope-phase3"'),
    true,
    'package.json must expose the Phase 3 scheduler account-scope guard'
  );
  assert.equal(
    packageSource.includes('npm run test:scheduler-account-scope-phase3'),
    true,
    'test:all must keep the Phase 3 scheduler account-scope guard wired'
  );

  for (const marker of [
    'BrokerAccountRepository stays generic',
    'Ownerless exclusion stays in the scheduler services',
    '## 4) Phase 4 Entry Checklist',
  ]) {
    assert.equal(
      phaseDoc.includes(marker),
      true,
      `SCHEDULER_ACCOUNT_SCOPE_PHASE3.md must include marker: ${marker}`
    );
  }

  assert.equal(
    readmeSource.includes('SCHEDULER_ACCOUNT_SCOPE_PHASE3.md'),
    true,
    'README.md must reference the scheduler account-scope Phase 3 document'
  );
  assert.equal(
    readmeSource.includes('test:scheduler-account-scope-phase3'),
    true,
    'README.md must include the scheduler account-scope Phase 3 verification command'
  );

  console.log('Scheduler account-scope Phase 3 guard passed.');
}

run();
