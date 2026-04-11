import assert from 'node:assert/strict';

import { PortfolioOverviewService } from '../src/api/services/PortfolioOverviewService';
import { PortfolioService } from '../src/api/services/PortfolioService';
import { buildPositionReadModelUpsert } from '../src/api/utils/positionsReadModel';
import { coreDataSource } from '../src/database/data-source';
import { PortfolioHolding } from '../src/database/entities/PortfolioHolding';
import { PortfolioSnapshot } from '../src/database/entities/PortfolioSnapshot';
import { PortfolioRepository } from '../src/database/repositories/PortfolioRepository';
import { PositionReadModelRepository } from '../src/database/repositories/PositionReadModelRepository';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

async function runReadModelUpsertAssertions(): Promise<void> {
  const row = buildPositionReadModelUpsert({
    userId: 'user-1',
    accountId: 'acc-1',
    brokerKey: 'mudrex',
    externalId: 'pos-1',
    statusRank: 3,
    payload: {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      status: 'closed',
      quantity: '0.25',
      entry_price: '50000',
      updated_at: '2026-04-09T10:20:00.000Z',
      realized_pnl: '42',
    },
  });

  assert.ok(row, 'expected a read-model upsert row');
  assert.equal(row?.positionClosedAt, '2026-04-09T10:20:00.000Z');
  assert.equal(row?.realizedPnl, 42);
}

async function runReadModelRepositoryDateNormalizationAssertions(): Promise<void> {
  const repository = new PositionReadModelRepository();
  const originalQuery = coreDataSource.query.bind(coreDataSource);
  let capturedParams: unknown[] | null = null;

  const row = buildPositionReadModelUpsert({
    userId: 'user-1',
    accountId: 'acc-1',
    brokerKey: 'mudrex',
    externalId: 'pos-1',
    statusRank: 3,
    firstSeenAt: '2026-04-09T10:00:00.000Z',
    lastSeenAt: '2026-04-09T10:30:00.000Z',
    payload: {
      id: 'pos-1',
      symbol: 'BTCUSDT',
      status: 'closed',
      quantity: '0.25',
      entry_price: '50000',
      created_at: '2026-04-09T10:05:00.000Z',
      updated_at: '2026-04-09T10:20:00.000Z',
      closed_at: '2026-04-09T10:25:00.000Z',
      realized_pnl: '42',
    },
  });

  assert.ok(row, 'expected a read-model upsert row for repository normalization');

  (coreDataSource as any).query = async (sql: string, params?: unknown[]) => {
    assert.match(sql, /INSERT INTO position_read_models/);
    capturedParams = Array.isArray(params) ? params : [];
    return [];
  };

  try {
    await repository.upsertReadModels([row]);
  } finally {
    (coreDataSource as any).query = originalQuery;
  }

  assert.ok(capturedParams, 'expected the repository upsert to capture SQL params');
  const normalizedCapturedParams = capturedParams as unknown[];
  const positionCreatedAt = normalizedCapturedParams[27];
  const positionUpdatedAt = normalizedCapturedParams[28];
  const positionClosedAt = normalizedCapturedParams[29];

  if (!isDate(positionCreatedAt)) {
    throw new Error('positionCreatedAt should be normalized to Date');
  }
  if (!isDate(positionUpdatedAt)) {
    throw new Error('positionUpdatedAt should be normalized to Date');
  }
  if (!isDate(positionClosedAt)) {
    throw new Error('positionClosedAt should be normalized to Date');
  }
  assert.equal(
    positionCreatedAt.toISOString(),
    '2026-04-09T10:05:00.000Z'
  );
  assert.equal(
    positionUpdatedAt.toISOString(),
    '2026-04-09T10:20:00.000Z'
  );
  assert.equal(
    positionClosedAt.toISOString(),
    '2026-04-09T10:25:00.000Z'
  );
}

async function runReadModelQueryAssertions(): Promise<void> {
  const service = new PortfolioService() as any;
  const originalQuery = coreDataSource.query.bind(coreDataSource);
  let hydratedArgs: { userId: string; accountIds: string[] } | null = null;

  service.positionReadModelRepository = {
    async ensureHydratedFromSnapshots(userId: string, accountIds: string[]) {
      hydratedArgs = { userId, accountIds };
    },
  };

  (coreDataSource as any).query = async (sql: string, params?: unknown[]) => {
    assert.match(sql, /FROM position_read_models/);
    assert.deepEqual(params, [
      'user-1',
      'acc-1',
      new Date('2026-04-09T00:00:00.000Z'),
      new Date('2026-04-10T00:00:00.000Z'),
    ]);
    return [
      {
        accountId: 'acc-1',
        brokerKey: 'mudrex',
        realizedPnl: '14.5',
        exposure: '1250',
        positionClosedAt: '2026-04-09T10:30:00.000Z',
        lastSeenAt: '2026-04-09T10:32:00.000Z',
      },
    ];
  };

  try {
    const rows = await service.queryClosedPositionSnapshotsByPayloadDateRange(
      'user-1',
      ['acc-1'],
      new Date('2026-04-09T00:00:00.000Z'),
      new Date('2026-04-10T00:00:00.000Z')
    );

    assert.deepEqual(hydratedArgs, {
      userId: 'user-1',
      accountIds: ['acc-1'],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].brokerKey, 'mudrex');
    assert.equal(rows[0].payload.realized_pnl, 14.5);
    assert.equal(rows[0].payload.notional, 1250);
    assert.equal(rows[0].payload.closedAt, '2026-04-09T10:30:00.000Z');
    assert.equal(rows[0].payload.updatedAt, '2026-04-09T10:32:00.000Z');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runSchedulerFallbackAssertions(): Promise<void> {
  const service = new PortfolioService() as any;
  const originalQuery = coreDataSource.query.bind(coreDataSource);

  service.positionReadModelRepository = {
    async ensureHydratedFromSnapshots() {
      const error = new Error("position_read_models doesn't exist") as Error & {
        code?: string;
      };
      error.code = 'ER_NO_SUCH_TABLE';
      throw error;
    },
  };

  (coreDataSource as any).query = async (sql: string) => {
    assert.match(sql, /FROM scheduler_positions_snapshots/);
    return [
      {
        accountId: 'acc-1',
        brokerKey: 'mudrex',
        payload: JSON.stringify({
          closedAt: '2026-04-09T11:00:00.000Z',
          realized_pnl: '7',
          notional: '80',
        }),
      },
    ];
  };

  try {
    const rows = await service.queryClosedPositionSnapshotsByPayloadDateRange(
      'user-1',
      ['acc-1'],
      new Date('2026-04-09T00:00:00.000Z'),
      new Date('2026-04-10T00:00:00.000Z')
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.realized_pnl, '7');
    assert.equal(rows[0].payload.closedAt, '2026-04-09T11:00:00.000Z');
  } finally {
    (coreDataSource as any).query = originalQuery;
  }
}

async function runSnapshotRepositoryAssertions(): Promise<void> {
  const repository = new PortfolioRepository();
  const originalGetRepository = coreDataSource.getRepository.bind(coreDataSource);
  let latestSnapshotJoinedHoldings = 0;
  let latestSnapshotSelectedColumns: string[] | null = null;

  function createSnapshotQueryBuilder() {
    return {
      select(columns: string[]) {
        latestSnapshotSelectedColumns = columns;
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      leftJoinAndSelect() {
        latestSnapshotJoinedHoldings += 1;
        return this;
      },
      addOrderBy() {
        return this;
      },
      async getOne() {
        return {
          id: 'snapshot-1',
          createdAt: new Date('2026-04-09T10:05:00.000Z'),
        };
      },
    };
  }

  function createHoldingQueryBuilder() {
    return {
      where() {
        return this;
      },
      andWhere() {
        return this;
      },
      orderBy() {
        return this;
      },
      skip() {
        return this;
      },
      take() {
        return this;
      },
      async getManyAndCount() {
        return [[], 0] as const;
      },
    };
  }

  (coreDataSource as any).getRepository = (entity: unknown) => {
    if (entity === PortfolioSnapshot) {
      return {
        createQueryBuilder: () => createSnapshotQueryBuilder(),
      };
    }
    if (entity === PortfolioHolding) {
      return {
        createQueryBuilder: () => createHoldingQueryBuilder(),
      };
    }
    throw new Error(`Unexpected repository request: ${String(entity)}`);
  };

  try {
    const result = await repository.listHoldings('user-1', {
      limit: 25,
      offset: 0,
    });

    assert.equal(latestSnapshotJoinedHoldings, 0);
    assert.deepEqual(latestSnapshotSelectedColumns, ['snapshot.id', 'snapshot.createdAt']);
    assert.equal(result.snapshot?.id, 'snapshot-1');
  } finally {
    (coreDataSource as any).getRepository = originalGetRepository;
  }
}

async function runOverviewCapabilityAssertions(): Promise<void> {
  const service = new PortfolioOverviewService() as any;

  service.portfolioService = {
    async getPortfolioPnL() {
      return createSuccess({
        dailyPnL: 0,
        weeklyPnL: 0,
        monthlyPnL: 0,
        source: 'scheduler_positions_snapshots',
        measurement: 'realized_pnl',
        freshnessModel: 'windowed_activity',
        observedAt: null,
        definition: 'Realized PnL aggregated from closed-position scheduler snapshots across active accounts.',
        windows: {
          timezone: 'Asia/Kolkata',
          daily: 'Today (Asia/Kolkata)',
          weekly: 'Trailing 7 days (Asia/Kolkata)',
          monthly: 'Trailing 30 days (Asia/Kolkata)',
        },
      });
    },
    async getPortfolioPerformance() {
      return createSuccess({
        timeframe: 'daily',
        source: 'scheduler_positions_snapshots',
        measurement: 'realized_pnl',
        freshnessModel: 'windowed_activity',
        observedAt: null,
        definition: 'Closed-position activity aggregated from scheduler snapshots for the selected portfolio timeframe.',
        points: [],
        summary: {
          totalEquity: 0,
          totalPnl: 0,
          totalProfit: 0,
          totalLoss: 0,
          totalTrades: 0,
          brokers: {},
        },
      });
    },
    async getPortfolioSummary() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: null,
        definition: 'Latest stored portfolio snapshot summary.',
        equity: 0,
        dayPnL: 0,
        netExposure: '--',
        diversification: '--',
      });
    },
    async getPortfolioHoldings() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: null,
        definition: 'Largest holdings ordered by market value from the latest stored portfolio snapshot.',
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
      });
    },
    async getPortfolioSnapshots() {
      return createSuccess({
        source: 'portfolio_snapshots',
        observedAt: null,
        definition: 'Stored portfolio snapshot history ordered from newest to oldest capture.',
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
    },
  };

  service.brokerWalletFacadeService = {
    async getWalletFundsForActiveAccounts() {
      return { items: [] };
    },
    async getFuturesFundsForActiveAccounts() {
      return { items: [] };
    },
  };

  const response = await service.getOverview('user-1', {
    timeframe: 'daily',
    snapshotsLimit: '10',
    holdingsLimit: '25',
  });

  assert.equal(response.data.meta.capabilities.indexedSnapshotReads, true);
  assert.equal(response.data.meta.capabilities.activityReadModelAcceleration, true);
  assert.equal(response.data.meta.capabilities.portfolioHealthChecks, true);
}

async function main(): Promise<void> {
  await runReadModelUpsertAssertions();
  await runReadModelRepositoryDateNormalizationAssertions();
  await runReadModelQueryAssertions();
  await runSchedulerFallbackAssertions();
  await runSnapshotRepositoryAssertions();
  await runOverviewCapabilityAssertions();
  console.log('Portfolio Phase 5 assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
