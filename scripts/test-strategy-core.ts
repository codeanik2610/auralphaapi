import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { StrategyController } from '../src/api/controllers/StrategyController';
import { StrategyService } from '../src/api/services/StrategyService';
import { StrategyRegistry } from '../src/api/strategies/StrategyRegistry';
import { AlertConfirmStrategy } from '../src/api/strategies/implementations/AlertConfirmStrategy';
import { validateStrategyRunRequest } from '../src/api/validators/strategy.validator';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function runStrategyControllerAssertions(): Promise<void> {
  const controller: any = new StrategyController();

  controller.strategyService = {
    getStrategies: () => createSuccess({ items: ['alert-confirm'] }),
    runStrategy: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(controller.getStrategies().data, { items: ['alert-confirm'] });
  assert.deepEqual(
    (
      await controller.runStrategy({
        strategyId: 'alert-confirm',
        symbols: 'BTCUSDT',
        interval: '1h',
        limit: '200',
      })
    ).data.args,
    [
      {
        strategyId: 'alert-confirm',
        symbols: 'BTCUSDT',
        interval: '1h',
        limit: '200',
      },
    ]
  );
}

function runStrategyValidationAssertions(): void {
  assert.deepEqual(
    validateStrategyRunRequest({
      strategyId: ' alert-confirm ',
      symbols: ' btcusdt , ethusdt , BTCUSDT ',
      interval: '1h',
      limit: '200',
      maxWaitBars: '3',
      params: {
        threshold: 2,
        enabled: true,
      },
    }),
    {
      strategyId: 'alert-confirm',
      symbols: ['BTCUSDT', 'ETHUSDT'],
      interval: '1h',
      limit: 200,
      params: {
        threshold: 2,
        enabled: true,
      },
      maxWaitBars: 3,
    }
  );

  assert.throws(() => validateStrategyRunRequest({ symbols: 'BTCUSDT', interval: '1h' }), /strategyId is required/);
  assert.throws(() => validateStrategyRunRequest({ strategyId: 'alert-confirm', interval: '1h' }), /symbols is required/);
  assert.throws(
    () =>
      validateStrategyRunRequest({
        strategyId: 'alert-confirm',
        symbols: 'a,b,c,d,e,f,g,h,i,j,k',
        interval: '1h',
      }),
    /symbols must contain between 1 and 10 items/
  );
}

async function runStrategyRegistryAssertions(): Promise<void> {
  const strategy = new AlertConfirmStrategy();
  const registry = new StrategyRegistry() as any;
  registry.alertConfirmStrategy = strategy;

  const catalog = registry.getStrategies();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].strategyId, 'alert-confirm');
  assert.equal(catalog[0].name, 'Alert confirm');

  const handler = registry.getStrategyOrThrow('alert-confirm');
  assert.equal(handler, strategy);

  assert.throws(
    () => registry.getStrategyOrThrow('missing-strategy'),
    /Strategy not registered for id: missing-strategy/
  );

  const result = await strategy.execute({
    strategyId: 'alert-confirm',
    symbols: ['BTCUSDT'],
    interval: '1h',
    limit: 200,
    params: {},
    maxWaitBars: 4,
  });
  assert.equal(result.strategyId, 'alert-confirm');
  assert.equal(result.strategy, 'alert-confirm-no-same-direction-skip');
  assert.equal(result.interval, '1h');
  assert.equal(result.limit, 200);
  assert.equal(result.maxWaitBars, 4);
  assert.deepEqual(result.results, []);
}

async function runStrategyServiceAssertions(): Promise<void> {
  const service = new StrategyService() as any;
  const executeCalls: Array<Record<string, unknown>> = [];

  service.strategyRegistry = {
    getStrategies() {
      return [
        {
          strategyId: 'alert-confirm',
          name: 'Alert confirm',
          description: 'Confirmation strategy',
          paramsSchema: [],
        },
      ];
    },
    getStrategyOrThrow(strategyId: string) {
      assert.equal(strategyId, 'alert-confirm');
      return {
        async execute(query: Record<string, unknown>) {
          executeCalls.push(query);
          return {
            strategyId: 'alert-confirm',
            strategy: 'alert-confirm-no-same-direction-skip',
            interval: query.interval,
            limit: query.limit,
            maxWaitBars: query.maxWaitBars,
            results: [],
          };
        },
      };
    },
  };

  const catalogResponse = service.getStrategies();
  assert.equal(catalogResponse.data.length, 1);
  assert.equal(catalogResponse.data[0].strategyId, 'alert-confirm');

  const runResponse = await service.runStrategy({
    strategyId: 'alert-confirm',
    symbols: 'BTCUSDT,ETHUSDT',
    interval: '15m',
    limit: '150',
    maxWaitBars: '5',
    params: {
      threshold: 3,
    },
  });
  assert.equal(runResponse.data.strategyId, 'alert-confirm');
  assert.equal(runResponse.data.interval, '15m');
  assert.equal(runResponse.data.limit, 150);
  assert.equal(runResponse.data.maxWaitBars, 5);
  assert.deepEqual(executeCalls, [
    {
      strategyId: 'alert-confirm',
      symbols: ['BTCUSDT', 'ETHUSDT'],
      interval: '15m',
      limit: 150,
      params: {
        threshold: 3,
      },
      maxWaitBars: 5,
    },
  ]);
}

function runStrategyCoreScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');

  assert.equal(
    packageScripts['test:strategy-core'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-strategy-core.ts'
  );
  assert.match(runPackageSuiteSource, /'test:strategy-core'/);
  assert.match(runPackageSuiteSource, /'strategy-core':\s*\['test:strategy-core'\]/);
}

async function main(): Promise<void> {
  await runStrategyControllerAssertions();
  runStrategyValidationAssertions();
  await runStrategyRegistryAssertions();
  await runStrategyServiceAssertions();
  runStrategyCoreScriptWiringAssertions();
  console.log('Strategy core module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
