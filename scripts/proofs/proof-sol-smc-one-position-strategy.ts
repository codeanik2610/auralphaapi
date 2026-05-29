import assert from 'node:assert/strict';
import path from 'node:path';

import {
  SOL_SMC_ONE_POSITION_STRATEGY_ID,
  SolSmcOnePositionStrategy,
} from '../../src/api/strategies/implementations/SolSmcOnePositionStrategy';

const OUTPUT_DIR = path.resolve('artifacts/smc-dry-run-solusdt/app-smc-3m-one-position-strategy');

const EXPECTED = {
  trades: 29,
  winRate: 0.3448,
  totalR: 83.18,
  validationR: 21.8,
  maxDrawdownR: 3,
  maxOpenTrades: 1,
};

async function main(): Promise<void> {
  const strategy = new SolSmcOnePositionStrategy();
  const result = await strategy.execute({
    strategyId: SOL_SMC_ONE_POSITION_STRATEGY_ID,
    symbols: ['SOLUSDT'],
    interval: '3m',
    limit: 1000,
    params: {
      windowEnd: '2026-05-29T08:24:00.000Z',
      outputDir: OUTPUT_DIR,
      writeArtifacts: true,
    },
  });

  const actual = {
    trades: result.full.trades,
    winRate: result.full.winRate,
    totalR: result.full.totalR,
    validationR: result.validation.totalR,
    maxDrawdownR: result.stats.maxDrawdownR,
    maxOpenTrades: result.stats.maxOpenTrades,
  };

  assert.deepEqual(actual, EXPECTED);
  assert.equal(result.comparison.matches, true);

  console.log(
    JSON.stringify(
      {
        status: 'matched',
        strategyId: result.strategyId,
        strategy: result.strategy,
        symbol: result.symbol,
        interval: result.interval,
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        actual,
        expected: EXPECTED,
        comparisonMatches: result.comparison.matches,
        artifacts: result.artifacts,
        charts: result.charts,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
