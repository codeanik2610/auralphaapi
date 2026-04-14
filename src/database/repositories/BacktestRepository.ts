import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { strategyDataSource } from '../pg-data-source';
import { Backtest } from '../entities/Backtest';
import { BacktestResult } from '../entities/BacktestResult';

export interface BacktestListQuery {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}

export interface BacktestTopSetupCandidateQuery {
  search?: string;
  timeframe?: string;
  minScore?: number;
  minTrades?: number;
}

export interface CreateBacktestPayload {
  name: string;
  strategy: string;
  symbol: string;
  parameter: string;
  status: string;
  stability?: string;
  trades?: number;
  config?: Record<string, unknown>;
}

export interface UpdateBacktestResultPayload {
  status?: string;
  stability?: string | null;
  trades?: number;
  cagr?: number;
  sharpe?: number;
  drawdown?: number;
  winRate?: number;
  profitFactor?: number;
  performanceSurface?: unknown;
  config?: Record<string, unknown> | null;
}

export interface BacktestOperationalSnapshot {
  totalRuns: number;
  activeRuns: number;
  queuedRuns: number;
  runningRuns: number;
  staleRunningRuns: number;
  recoverableRuns: number;
  incompleteTradeHistoryRuns: number;
  oldestActiveCreatedAt: Date | null;
  oldestStaleUpdatedAt: Date | null;
}

export interface StrategyLibraryLatestBacktest {
  libraryId: string;
  backtestId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StrategyLibraryRecentBacktest {
  libraryId: string;
  backtestId: string;
  status: string;
  parameter: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface BacktestResultOperationalFields {
  progressState: string | null;
  progressProcessed: number | null;
  progressTotal: number | null;
  progressPercent: number | null;
  resumeCheckpointState: string | null;
  tradeEventCount: number | null;
  performanceSurfaceResultCount: number | null;
}

@Service()
export class BacktestRepository {
  private static readonly ACTIVE_RUN_STATUSES = [
    'queued',
    'running',
    'started',
    'processing',
    'in_progress',
    'in-progress',
  ];

  private static readonly RUNNING_STATUSES = [
    'running',
    'started',
    'processing',
    'in_progress',
    'in-progress',
  ];

  private static readonly COMPLETED_RUN_STATUSES = [
    'completed',
    'complete',
    'finished',
    'done',
    'success',
    'succeeded',
    'stable',
    'review',
  ];

  private get backtestRepository(): Repository<Backtest> {
    return strategyDataSource.getRepository(Backtest);
  }

  private get backtestResultRepository(): Repository<BacktestResult> {
    return strategyDataSource.getRepository(BacktestResult);
  }

  async listBacktests(userId: string, query: BacktestListQuery) {
    const builder = this.backtestRepository
      .createQueryBuilder('backtest')
      .leftJoinAndSelect('backtest.result', 'result')
      .where('backtest.userId = :userId', { userId })
      .orderBy('backtest.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    if (query.status) {
      builder.andWhere('backtest.status = :status', { status: query.status });
    }

    if (query.search) {
      builder.andWhere(
        this.buildSearchDocumentClause('backtest'),
        { search: this.buildSearchPattern(query.search) }
      );
    }

    const [data, total] = await builder.getManyAndCount();
    return { data, total };
  }

  async getBacktestById(userId: string, backtestId: string): Promise<Backtest | null> {
    return this.backtestRepository.findOne({
      where: { id: backtestId, userId },
      relations: {
        result: true,
      },
    });
  }

  async getBacktestByIdAny(backtestId: string): Promise<Backtest | null> {
    return this.backtestRepository.findOne({
      where: { id: backtestId },
      relations: {
        result: true,
      },
    });
  }

  async listTopSetupCandidateBacktests(
    userId: string,
    query: BacktestTopSetupCandidateQuery = {}
  ): Promise<Backtest[]> {
    const builder = this.backtestRepository
      .createQueryBuilder('backtest')
      .leftJoinAndSelect('backtest.result', 'result')
      .where('backtest.userId = :userId', { userId })
      .andWhere('result.id IS NOT NULL')
      .andWhere('LOWER(COALESCE(backtest.status, \'\')) IN (:...completedStatuses)', {
        completedStatuses: BacktestRepository.COMPLETED_RUN_STATUSES,
      })
      .andWhere(`${this.buildPerformanceSurfaceResultCountSql('result')} > 0`)
      .orderBy('backtest.createdAt', 'DESC');

    return builder.getMany();
  }

  async getBacktestsSummary(userId: string): Promise<{
    activeRuns: number;
    bestCagr: number | null;
    bestCagrLabel: string | null;
    bestSharpe: number | null;
    maxDrawdown: number | null;
  }> {
    const activeStatuses = BacktestRepository.ACTIVE_RUN_STATUSES.map((status) => `'${status}'`).join(', ');
    const rows = (await strategyDataSource.query(
      `
        WITH scoped_backtests AS (
          SELECT
            backtest.id,
            backtest.parameter,
            backtest.created_at,
            LOWER(COALESCE(backtest.status, '')) AS status_lower
          FROM backtests backtest
          WHERE backtest.user_id = $1
        ),
        scoped_results AS (
          SELECT
            result.backtest_id,
            result.cagr,
            result.sharpe,
            result.drawdown
          FROM backtest_results result
          WHERE result.user_id = $1
        ),
        best_cagr AS (
          SELECT
            scoped_backtests.parameter,
            scoped_results.cagr
          FROM scoped_results
          INNER JOIN scoped_backtests
            ON scoped_backtests.id = scoped_results.backtest_id
          WHERE scoped_results.cagr IS NOT NULL
          ORDER BY scoped_results.cagr DESC, scoped_backtests.created_at DESC
          LIMIT 1
        ),
        best_sharpe AS (
          SELECT scoped_results.sharpe
          FROM scoped_results
          WHERE scoped_results.sharpe IS NOT NULL
          ORDER BY scoped_results.sharpe DESC
          LIMIT 1
        ),
        max_drawdown AS (
          SELECT scoped_results.drawdown
          FROM scoped_results
          WHERE scoped_results.drawdown IS NOT NULL
          ORDER BY scoped_results.drawdown DESC
          LIMIT 1
        )
        SELECT
          COALESCE(
            (
              SELECT COUNT(*)::int
              FROM scoped_backtests
              WHERE status_lower IN (${activeStatuses})
            ),
            0
          ) AS active_runs,
          (SELECT cagr FROM best_cagr) AS best_cagr,
          (SELECT parameter FROM best_cagr) AS best_cagr_label,
          (SELECT sharpe FROM best_sharpe) AS best_sharpe,
          (SELECT drawdown FROM max_drawdown) AS max_drawdown
      `,
      [userId]
    )) as Array<Record<string, unknown>>;
    const row = rows[0] || {};

    return {
      activeRuns: Number(row.active_runs ?? 0),
      bestCagr: row.best_cagr == null ? null : Number(row.best_cagr),
      bestCagrLabel:
        typeof row.best_cagr_label === 'string' && row.best_cagr_label.trim()
          ? row.best_cagr_label
          : null,
      bestSharpe: row.best_sharpe == null ? null : Number(row.best_sharpe),
      maxDrawdown: row.max_drawdown == null ? null : Number(row.max_drawdown),
    };
  }

  async getLatestStrategyLibraryBacktests(
    userId: string,
    libraryIds: string[]
  ): Promise<Map<string, StrategyLibraryLatestBacktest>> {
    const normalizedLibraryIds = Array.from(
      new Set(
        (Array.isArray(libraryIds) ? libraryIds : [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );

    if (!normalizedLibraryIds.length) {
      return new Map();
    }

    const rows = (await strategyDataSource.query(
      `
        SELECT DISTINCT ON (lineage.library_id)
          lineage.library_id,
          backtest.id AS backtest_id,
          backtest.status,
          backtest.created_at,
          backtest.updated_at
        FROM backtests backtest
        INNER JOIN backtest_results result
          ON result.backtest_id = backtest.id
          AND result.user_id = backtest.user_id
        CROSS JOIN LATERAL (
          SELECT NULLIF(
            BTRIM(
              COALESCE(
                result.config #>> '{inputSnapshot,libraryId}',
                result.config->>'libraryId',
                ''
              )
            ),
            ''
          ) AS library_id
        ) lineage
        WHERE backtest.user_id = $1
          AND lineage.library_id = ANY($2::text[])
        ORDER BY
          lineage.library_id,
          backtest.created_at DESC,
          backtest.updated_at DESC,
          backtest.id DESC
      `,
      [userId, normalizedLibraryIds]
    )) as Array<{
      library_id?: string | null;
      backtest_id?: string | null;
      status?: string | null;
      created_at?: string | Date | null;
      updated_at?: string | Date | null;
    }>;

    const toDate = (value: string | Date | null | undefined): Date | null => {
      if (!value) {
        return null;
      }
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    return new Map(
      rows.flatMap((row) => {
        const libraryId = String(row.library_id || '').trim();
        const backtestId = String(row.backtest_id || '').trim();
        const status = String(row.status || '').trim();
        const createdAt = toDate(row.created_at);
        const updatedAt = toDate(row.updated_at);
        if (!libraryId || !backtestId || !status || !createdAt || !updatedAt) {
          return [];
        }
        return [
          [
            libraryId,
            {
              libraryId,
              backtestId,
              status,
              createdAt,
              updatedAt,
            } satisfies StrategyLibraryLatestBacktest,
          ] as const,
        ];
      })
    );
  }

  async getRecentStrategyLibraryBacktests(
    userId: string,
    libraryIds: string[],
    limitPerLibrary = 5
  ): Promise<Map<string, StrategyLibraryRecentBacktest[]>> {
    const normalizedLibraryIds = Array.from(
      new Set(
        (Array.isArray(libraryIds) ? libraryIds : [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );

    if (!normalizedLibraryIds.length) {
      return new Map();
    }

    const normalizedLimit = Number.isFinite(limitPerLibrary)
      ? Math.max(1, Math.min(10, Math.floor(limitPerLibrary)))
      : 5;

    const rows = (await strategyDataSource.query(
      `
        WITH scoped_backtests AS (
          SELECT
            lineage.library_id,
            backtest.id AS backtest_id,
            backtest.status,
            backtest.parameter,
            backtest.created_at,
            backtest.updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY lineage.library_id
              ORDER BY
                backtest.created_at DESC,
                backtest.updated_at DESC,
                backtest.id DESC
            ) AS run_rank
          FROM backtests backtest
          INNER JOIN backtest_results result
            ON result.backtest_id = backtest.id
            AND result.user_id = backtest.user_id
          CROSS JOIN LATERAL (
            SELECT NULLIF(
              BTRIM(
                COALESCE(
                  result.config #>> '{inputSnapshot,libraryId}',
                  result.config->>'libraryId',
                  ''
                )
              ),
              ''
            ) AS library_id
          ) lineage
          WHERE backtest.user_id = $1
            AND lineage.library_id = ANY($2::text[])
        )
        SELECT
          library_id,
          backtest_id,
          status,
          parameter,
          created_at,
          updated_at
        FROM scoped_backtests
        WHERE run_rank <= $3
        ORDER BY
          library_id,
          created_at DESC,
          updated_at DESC,
          backtest_id DESC
      `,
      [userId, normalizedLibraryIds, normalizedLimit]
    )) as Array<{
      library_id?: string | null;
      backtest_id?: string | null;
      status?: string | null;
      parameter?: string | null;
      created_at?: string | Date | null;
      updated_at?: string | Date | null;
    }>;

    const toDate = (value: string | Date | null | undefined): Date | null => {
      if (!value) {
        return null;
      }
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const historyByLibraryId = new Map<string, StrategyLibraryRecentBacktest[]>();

    rows.forEach((row) => {
      const libraryId = String(row.library_id || '').trim();
      const backtestId = String(row.backtest_id || '').trim();
      const status = String(row.status || '').trim();
      const createdAt = toDate(row.created_at);
      const updatedAt = toDate(row.updated_at);
      if (!libraryId || !backtestId || !status || !createdAt || !updatedAt) {
        return;
      }

      const nextItem = {
        libraryId,
        backtestId,
        status,
        parameter:
          typeof row.parameter === 'string' && row.parameter.trim()
            ? row.parameter.trim()
            : null,
        createdAt,
        updatedAt,
      } satisfies StrategyLibraryRecentBacktest;

      const existing = historyByLibraryId.get(libraryId) ?? [];
      existing.push(nextItem);
      historyByLibraryId.set(libraryId, existing);
    });

    return historyByLibraryId;
  }

  async getOperationalSnapshot(staleThresholdMinutes = 30): Promise<BacktestOperationalSnapshot> {
    const quoteList = (values: string[]) => values.map((value) => `'${value}'`).join(', ');
    const activeStatuses = quoteList(BacktestRepository.ACTIVE_RUN_STATUSES);
    const runningStatuses = quoteList(BacktestRepository.RUNNING_STATUSES);
    const completedStatuses = quoteList(BacktestRepository.COMPLETED_RUN_STATUSES);
    const threshold = Math.max(5, Math.trunc(staleThresholdMinutes || 30));
    const resumeCheckpointStateSql = this.buildResumeCheckpointStateSql('result');
    const tradeEventCountSql = this.buildTradeEventCountSql('result');

    const rows = (await strategyDataSource.query(
      `
        WITH trade_counts AS (
          SELECT backtest_id, COUNT(*)::int AS stored_trade_events
          FROM backtest_trades
          GROUP BY backtest_id
        )
        SELECT
          COUNT(*)::int AS total_runs,
          COALESCE(
            SUM(
              CASE
                WHEN LOWER(COALESCE(backtest.status, '')) IN (${activeStatuses}) THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS active_runs,
          COALESCE(
            SUM(
              CASE
                WHEN LOWER(COALESCE(backtest.status, '')) = 'queued' THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS queued_runs,
          COALESCE(
            SUM(
              CASE
                WHEN LOWER(COALESCE(backtest.status, '')) IN (${runningStatuses}) THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS running_runs,
          COALESCE(
            SUM(
              CASE
                WHEN LOWER(COALESCE(backtest.status, '')) IN (${runningStatuses})
                  AND backtest.updated_at < NOW() - ($1::text || ' minutes')::interval THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS stale_running_runs,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(jsonb_typeof(result.config), '') = 'object'
                  AND ${resumeCheckpointStateSql} IS NOT NULL
                  AND LOWER(COALESCE(backtest.status, '')) NOT IN (${activeStatuses}, ${completedStatuses})
                  AND COALESCE(LOWER(${resumeCheckpointStateSql}), '') <> 'completed'
                THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS recoverable_runs,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(jsonb_typeof(result.config), '') = 'object'
                  AND COALESCE(${tradeEventCountSql}, 0) > COALESCE(trade_counts.stored_trade_events, 0)
                THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS incomplete_trade_history_runs,
          MIN(
            CASE
              WHEN LOWER(COALESCE(backtest.status, '')) IN (${activeStatuses}) THEN backtest.created_at
              ELSE NULL
            END
          ) AS oldest_active_created_at,
          MIN(
            CASE
              WHEN LOWER(COALESCE(backtest.status, '')) IN (${runningStatuses})
                AND backtest.updated_at < NOW() - ($1::text || ' minutes')::interval
              THEN backtest.updated_at
              ELSE NULL
            END
          ) AS oldest_stale_updated_at
        FROM backtests backtest
        LEFT JOIN backtest_results result
          ON result.backtest_id = backtest.id
        LEFT JOIN trade_counts
          ON trade_counts.backtest_id = backtest.id
      `,
      [String(threshold)]
    )) as Array<{
      total_runs?: number | string;
      active_runs?: number | string;
      queued_runs?: number | string;
      running_runs?: number | string;
      stale_running_runs?: number | string;
      recoverable_runs?: number | string;
      incomplete_trade_history_runs?: number | string;
      oldest_active_created_at?: string | Date | null;
      oldest_stale_updated_at?: string | Date | null;
    }>;

    const row = rows[0] ?? {};
    const toDate = (value: string | Date | null | undefined): Date | null => {
      if (!value) {
        return null;
      }
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    return {
      totalRuns: Number(row.total_runs ?? 0),
      activeRuns: Number(row.active_runs ?? 0),
      queuedRuns: Number(row.queued_runs ?? 0),
      runningRuns: Number(row.running_runs ?? 0),
      staleRunningRuns: Number(row.stale_running_runs ?? 0),
      recoverableRuns: Number(row.recoverable_runs ?? 0),
      incompleteTradeHistoryRuns: Number(row.incomplete_trade_history_runs ?? 0),
      oldestActiveCreatedAt: toDate(row.oldest_active_created_at),
      oldestStaleUpdatedAt: toDate(row.oldest_stale_updated_at),
    };
  }

  async createQueuedBacktest(userId: string, payload: CreateBacktestPayload): Promise<Backtest> {
    const backtest = this.backtestRepository.create({
      userId,
      name: payload.name,
      strategy: payload.strategy,
      symbol: payload.symbol,
      parameter: payload.parameter,
      status: payload.status,
      stability: payload.stability ?? null,
      trades: payload.trades ?? 0,
    });

    const savedBacktest = await this.backtestRepository.save(backtest);

    const result = this.backtestResultRepository.create({
      userId,
      backtestId: savedBacktest.id,
      config: payload.config ?? null,
      ...this.buildOperationalResultColumns(payload.config ?? null),
    });

    await this.backtestResultRepository.save(result);

    return this.getBacktestById(userId, savedBacktest.id) as Promise<Backtest>;
  }

  async updateBacktestResult(
    userId: string,
    backtestId: string,
    payload: UpdateBacktestResultPayload
  ): Promise<Backtest | null> {
    const backtest = await this.backtestRepository.findOne({
      where: { id: backtestId, userId },
      relations: { result: true },
    });

    if (!backtest) {
      return null;
    }

    if (payload.status !== undefined) {
      backtest.status = payload.status;
    }
    if (payload.stability !== undefined) {
      backtest.stability = payload.stability;
    }
    if (payload.trades !== undefined) {
      backtest.trades = payload.trades;
    }

    let result = backtest.result;
    if (!result) {
      result = this.backtestResultRepository.create({
        userId,
        backtestId: backtest.id,
        config: null,
      });
    }

    if (payload.cagr !== undefined) {
      result.cagr = payload.cagr;
    }
    if (payload.sharpe !== undefined) {
      result.sharpe = payload.sharpe;
    }
    if (payload.drawdown !== undefined) {
      result.drawdown = payload.drawdown;
    }
    if (payload.winRate !== undefined) {
      result.winRate = payload.winRate;
    }
    if (payload.profitFactor !== undefined) {
      result.profitFactor = payload.profitFactor;
    }

    const currentConfig =
      result.config && typeof result.config === 'object' && !Array.isArray(result.config)
        ? { ...(result.config as Record<string, unknown>) }
        : {};
    let configUpdated = false;

    if (payload.config !== undefined) {
      if (payload.config === null) {
        Object.keys(currentConfig).forEach((key) => delete currentConfig[key]);
      } else {
        Object.assign(currentConfig, payload.config);
      }
      configUpdated = true;
    }

    if (payload.performanceSurface !== undefined) {
      currentConfig.performanceSurface = payload.performanceSurface;
      configUpdated = true;
    }

    if (configUpdated) {
      result.config = Object.keys(currentConfig).length ? currentConfig : null;
      Object.assign(
        result,
        this.buildOperationalResultColumns(
          Object.keys(currentConfig).length ? currentConfig : null
        )
      );
    }

    await this.backtestRepository.save(backtest);
    await this.backtestResultRepository.save(result);

    return this.getBacktestById(userId, backtest.id);
  }

  private buildSearchDocumentClause(alias: string): string {
    return `LOWER(CONCAT_WS(' ', ${alias}.name, ${alias}.strategy, ${alias}.symbol, ${alias}.parameter, ${alias}.status, ${alias}.stability)) LIKE :search ESCAPE '\\'`;
  }

  private buildSearchPattern(search: string): string {
    const normalized = String(search || '').trim().toLowerCase();
    const escaped = normalized.replace(/[\\%_]/g, '\\$&');
    return `%${escaped}%`;
  }

  private buildPerformanceSurfaceResultCountSql(resultAlias: string): string {
    return `CASE WHEN COALESCE(jsonb_typeof(${resultAlias}.config), '') = 'object' AND COALESCE(jsonb_typeof(${resultAlias}.config->'performanceSurface'), '') = 'object' AND COALESCE(jsonb_typeof(${resultAlias}.config->'performanceSurface'->'results'), '') = 'array' THEN jsonb_array_length(${resultAlias}.config->'performanceSurface'->'results') ELSE 0 END`;
  }

  private buildResumeCheckpointStateSql(resultAlias: string): string {
    return `CASE WHEN COALESCE(jsonb_typeof(${resultAlias}.config), '') = 'object' AND COALESCE(jsonb_typeof(${resultAlias}.config->'resumeCheckpoint'), '') = 'object' THEN NULLIF(BTRIM(${resultAlias}.config #>> '{resumeCheckpoint,state}'), '') ELSE NULL END`;
  }

  private buildTradeEventCountSql(resultAlias: string): string {
    return `CASE WHEN COALESCE(jsonb_typeof(${resultAlias}.config), '') = 'object' AND COALESCE(${resultAlias}.config->>'tradeEventCount', '') ~ '^[0-9]+$' THEN (${resultAlias}.config->>'tradeEventCount')::int ELSE NULL END`;
  }

  private buildOperationalResultColumns(
    config: Record<string, unknown> | null
  ): BacktestResultOperationalFields {
    const progress =
      config?.progress && typeof config.progress === 'object' && !Array.isArray(config.progress)
        ? (config.progress as Record<string, unknown>)
        : null;
    const resumeCheckpoint =
      config?.resumeCheckpoint &&
      typeof config.resumeCheckpoint === 'object' &&
      !Array.isArray(config.resumeCheckpoint)
        ? (config.resumeCheckpoint as Record<string, unknown>)
        : null;
    const performanceSurface =
      config?.performanceSurface &&
      typeof config.performanceSurface === 'object' &&
      !Array.isArray(config.performanceSurface)
        ? (config.performanceSurface as Record<string, unknown>)
        : null;
    const surfaceResults = Array.isArray(performanceSurface?.results)
      ? performanceSurface.results
      : null;

    return {
      progressState: this.readTrimmedString(progress?.state),
      progressProcessed: this.readNonNegativeInteger(progress?.processed),
      progressTotal: this.readNonNegativeInteger(progress?.total),
      progressPercent: this.readFiniteNumber(progress?.percent),
      resumeCheckpointState: this.readTrimmedString(resumeCheckpoint?.state),
      tradeEventCount: this.readNonNegativeInteger(config?.tradeEventCount),
      performanceSurfaceResultCount: surfaceResults ? surfaceResults.length : null,
    };
  }

  private readTrimmedString(value: unknown): string | null {
    const trimmed = String(value || '').trim();
    return trimmed || null;
  }

  private readNonNegativeInteger(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    return Math.max(0, Math.trunc(numeric));
  }

  private readFiniteNumber(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return numeric;
  }
}
