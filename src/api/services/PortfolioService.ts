import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  PortfolioHolding,
  PortfolioHoldingsResponse,
  PortfolioPerformanceResponse,
  PortfolioPnLResponse,
  PortfolioSnapshotItem,
  PortfolioSnapshotsResponse,
  PortfolioSummary,
  PortfolioWorkspaceAction,
  PortfolioWorkspaceContext,
  PortfolioWorkspaceHighlight,
  PortfolioWorkspaceReportBody,
  PortfolioWorkspaceReportFormat,
  PortfolioWorkspaceReportResult,
  RebalanceReviewBody,
  RebalanceReviewResult,
} from '../contracts/Portfolio';
import {
  PortfolioActiveFundsItem,
  PortfolioActivityResponse,
  PortfolioCapitalResponse,
  PortfolioFuturesSummaryResponse,
  PortfolioOpenPositionItem,
  PortfolioOpenPositionsResponse,
} from '../contracts/PortfolioOverview';
import { PositionRecord, PositionsFreshnessIndicator } from '../contracts/Positions';
import { NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  PortfolioTimeframe,
  PortfolioHoldingsQuery,
  PortfolioSnapshotsQuery,
  ValidatedPortfolioWorkspaceReportBody,
  ValidatedRebalanceReviewBody,
  validateHoldingId,
  validatePortfolioHoldingsQuery,
  validatePortfolioSnapshotsQuery,
  validatePortfolioTimeframe,
  validatePortfolioWorkspaceReportBody,
  validateRebalanceReviewBody,
} from '../validators/portfolio.validator';
import { PortfolioHolding as PortfolioHoldingEntity } from '../../database';
import {
  AppSettingsRepository,
  BrokerAccountRepository,
  PortfolioRepository,
  PositionReadModelRepository,
} from '../../database';
import { env } from '../../env';
import { DEFAULT_TIMEZONE, normalizeTimeZone } from '../utils/timezone';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';
import { coreDataSource } from '../../database/data-source';
import { BrokerWalletFacadeService } from './BrokerWalletFacadeService';
import { OperationalEventService } from './OperationalEventService';

type ClosedPositionSnapshotRow = {
  accountId: string;
  brokerKey: string;
  payload: Record<string, unknown>;
};

type PortfolioWorkspaceReviewPayload = {
  generatedAt: string;
  generatedAtIso: string;
  summary: string;
  note: string;
  context: PortfolioWorkspaceContext;
  snapshotObservedAt: string | null;
  snapshotObservedAtIso: string | null;
  activityObservedAt: string | null;
  activityObservedAtIso: string | null;
  highlights: PortfolioWorkspaceHighlight[];
  actions: PortfolioWorkspaceAction[];
  time: ReturnType<typeof buildApiTimeContract>;
};

type PortfolioOpenPositionsQuery = {
  limit?: string | number;
  offset?: string | number;
  brokerKey?: string;
  accountId?: string;
  symbol?: string;
  sideKey?: string;
};

type PortfolioNormalizedFundsPayload = {
  items: PortfolioActiveFundsItem[];
  latestObservedAtIso: string | null;
  oldestObservedAtIso: string | null;
};

type PortfolioWorkspaceCapitalRoute = {
  accountId: string;
  accountName: string;
  brokerKey: string;
  observedAt: string | null;
  balance: number;
  error: string | null;
};

type PortfolioWorkspaceCapitalSummary = {
  walletRoutes: PortfolioWorkspaceCapitalRoute[];
  futuresRoutes: PortfolioWorkspaceCapitalRoute[];
  walletTotal: number;
  futuresTotal: number;
  totalVisibleCapital: number;
  walletSharePct: number | null;
  futuresSharePct: number | null;
  driftPct: number | null;
  observedAt: string | null;
};

type PortfolioWorkspaceAnalysis = {
  generatedAt: string;
  summary: PortfolioSummary | null;
  holdings: PortfolioHolding[];
  filteredHoldings: PortfolioHolding[];
  selectedHolding: PortfolioHolding | null;
  performance: PortfolioPerformanceResponse | null;
  capital: PortfolioWorkspaceCapitalSummary;
  context: PortfolioWorkspaceContext;
  snapshotObservedAt: string | null;
  activityObservedAt: string | null;
  watchCount: number;
  atRiskCount: number;
  topSleeve: { name: string; allocationPct: number; marketValue: number; count: number } | null;
  largestHolding: PortfolioHolding | null;
  realizedPnl: number;
  realizedProfit: number;
  realizedLoss: number;
  realizedTrades: number;
  windowLabel: string;
};

@Service()
export class PortfolioService {
  private readonly workspaceHoldingsSliceLimit = 100;
  private readonly capitalDriftAlertThresholdPct = 15;

  @Inject(() => PortfolioRepository)
  private portfolioRepository!: PortfolioRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => AppSettingsRepository)
  private appSettingsRepository!: AppSettingsRepository;

  @Inject(() => PositionReadModelRepository)
  private positionReadModelRepository!: PositionReadModelRepository;

  @Inject(() => BrokerWalletFacadeService)
  private brokerWalletFacadeService!: BrokerWalletFacadeService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getPortfolioHoldings(
    userId: string,
    query: PortfolioHoldingsQuery
  ): Promise<ApiSuccessResponse<PortfolioHoldingsResponse>> {
    const params = validatePortfolioHoldingsQuery(query);
    const { items, total, snapshot } = await this.portfolioRepository.listHoldings(userId, params);
    const timeZone = await this.resolveUserTimeZone(userId);
    const observedAtIso = this.formatRawIso(snapshot?.createdAt);

    return successResponse({
      items: items.map((holding) => this.mapHolding(holding, timeZone)),
      total,
      limit: params.limit,
      offset: params.offset,
      source: 'portfolio_snapshots',
      observedAt: this.formatDisplayTime(observedAtIso, timeZone),
      observedAtIso,
      definition: 'Largest holdings ordered by market value from the latest stored portfolio snapshot.',
      time: buildApiTimeContract(timeZone),
    });
  }

  async getPortfolioSummary(userId: string): Promise<ApiSuccessResponse<PortfolioSummary>> {
    const snapshot = await this.portfolioRepository.getPortfolioSummary(userId);
    const timeZone = await this.resolveUserTimeZone(userId);

    if (!snapshot) {
      return successResponse({
        equity: 0,
        dayPnL: 0,
        netExposure: '--',
        diversification: '--',
        source: 'portfolio_snapshots',
        observedAt: null,
        observedAtIso: null,
        definition: 'Latest stored portfolio snapshot summary.',
        time: buildApiTimeContract(timeZone),
      });
    }

    const largest = [...(snapshot.holdings ?? [])].sort(
      (a, b) => b.allocationPct - a.allocationPct
    )[0];

    return successResponse({
      equity: snapshot.equity,
      dayPnL: snapshot.dayPnL,
      netExposure: snapshot.netExposure ?? '--',
      diversification: snapshot.diversification ?? '--',
      source: 'portfolio_snapshots',
      observedAt: this.formatDisplayTime(snapshot.createdAt, timeZone),
      observedAtIso: this.formatRawIso(snapshot.createdAt),
      definition: 'Latest stored portfolio snapshot summary.',
      portfolioValue: `$${Math.round(snapshot.equity).toLocaleString('en-US')}`,
      netPnl: `${snapshot.dayPnL >= 0 ? '+' : '-'}$${Math.round(Math.abs(snapshot.dayPnL)).toLocaleString('en-US')}`,
      holdings: snapshot.holdings?.length ?? 0,
      largestWeight: largest ? `${largest.allocationPct}%` : '--',
      largestWeightLabel: largest?.symbol ?? '--',
      assetAllocation: snapshot.assetAllocation ?? '--',
      strategyMix: snapshot.strategyMix ?? '--',
      riskPosture: snapshot.riskPosture ?? '--',
      accountCurve: snapshot.accountCurve ?? '--',
      monthlyPace: snapshot.monthlyPace ?? '--',
      time: buildApiTimeContract(timeZone),
    });
  }

  async getPortfolioHoldingById(userId: string, holdingId: string): Promise<ApiSuccessResponse<PortfolioHolding>> {
    const holding = await this.requireHolding(userId, holdingId);
    const timeZone = await this.resolveUserTimeZone(userId);
    return successResponse(this.mapHolding(holding, timeZone));
  }

  async getPortfolioSnapshots(
    userId: string,
    query: PortfolioSnapshotsQuery
  ): Promise<ApiSuccessResponse<PortfolioSnapshotsResponse>> {
    const params = validatePortfolioSnapshotsQuery(query);
    const { items, total } = await this.portfolioRepository.listSnapshots(userId, params);
    const timeZone = await this.resolveUserTimeZone(userId);
    const observedAtIso = this.formatRawIso(items[0]?.createdAt);

    return successResponse({
      items: items.map((snapshot) => this.mapSnapshot(snapshot, timeZone)),
      total,
      limit: params.limit,
      offset: params.offset,
      source: 'portfolio_snapshots',
      observedAt: this.formatDisplayTime(observedAtIso, timeZone),
      observedAtIso,
      definition: 'Stored portfolio snapshot history ordered from newest to oldest capture.',
      time: buildApiTimeContract(timeZone),
    });
  }

  async getPortfolioPnL(userId: string): Promise<ApiSuccessResponse<PortfolioPnLResponse>> {
    const now = new Date();
    const timezone = await this.resolveUserTimeZone(userId);
    const nowInTz = this.toDateKeyInTimeZone(now, timezone);
    const dailyWindow = this.getUtcWindowForLocalDateRange(nowInTz, nowInTz, timezone);
    const weeklyWindow = this.getUtcWindowForLocalDateRange(
      this.shiftDateKey(nowInTz, -6),
      nowInTz,
      timezone
    );
    const monthlyWindow = this.getUtcWindowForLocalDateRange(
      this.shiftDateKey(nowInTz, -29),
      nowInTz,
      timezone
    );

    const activeAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
    const activeAccountIds = activeAccounts.map((item) => item.id);

    const [dailyRows, weeklyRows, monthlyRows] = await Promise.all([
      this.queryClosedPositionSnapshotsByPayloadDateRange(
        userId,
        activeAccountIds,
        dailyWindow.startUtc,
        dailyWindow.endUtc
      ),
      this.queryClosedPositionSnapshotsByPayloadDateRange(
        userId,
        activeAccountIds,
        weeklyWindow.startUtc,
        weeklyWindow.endUtc
      ),
      this.queryClosedPositionSnapshotsByPayloadDateRange(
        userId,
        activeAccountIds,
        monthlyWindow.startUtc,
        monthlyWindow.endUtc
      ),
    ]);
    const dailyByConn = this.aggregateClosedPositionPnlByConnection(dailyRows);
    const weeklyByConn = this.aggregateClosedPositionPnlByConnection(weeklyRows);
    const monthlyByConn = this.aggregateClosedPositionPnlByConnection(monthlyRows);
    const latestObservedAt = this.resolveLatestPositionObservedAt(monthlyRows);

    const allConnectionKeys = Array.from(
      new Set<string>([...dailyByConn.keys(), ...weeklyByConn.keys(), ...monthlyByConn.keys()])
    );

    const connections = allConnectionKeys
      .map((key) => {
        const daily = dailyByConn.get(key);
        const weekly = weeklyByConn.get(key);
        const monthly = monthlyByConn.get(key);
        const brokerKey =
          daily?.brokerKey || weekly?.brokerKey || monthly?.brokerKey || key.split(':')[0];
        const accountId =
          daily?.accountId || weekly?.accountId || monthly?.accountId || key.split(':')[1] || '';
        return {
          brokerKey,
          accountId,
          dailyPnL: daily?.pnl ?? 0,
          weeklyPnL: weekly?.pnl ?? 0,
          monthlyPnL: monthly?.pnl ?? 0,
        };
      })
      .sort((a, b) =>
        `${a.brokerKey}:${a.accountId}`.localeCompare(`${b.brokerKey}:${b.accountId}`)
      );

    const dailyRealized = connections.reduce((sum, row) => sum + row.dailyPnL, 0);
    const weeklyRealized = connections.reduce((sum, row) => sum + row.weeklyPnL, 0);
    const monthlyRealized = connections.reduce((sum, row) => sum + row.monthlyPnL, 0);

    return successResponse({
      dailyPnL: dailyRealized,
      weeklyPnL: weeklyRealized,
      monthlyPnL: monthlyRealized,
      source: 'scheduler_positions_snapshots',
      measurement: 'realized_pnl',
      freshnessModel: 'windowed_activity',
      observedAt: this.formatDisplayTime(latestObservedAt, timezone),
      observedAtIso: this.formatRawIso(latestObservedAt),
      definition: 'Realized PnL aggregated from closed-position scheduler snapshots across active accounts.',
      windows: {
        timezone,
        daily: `Today (${timezone})`,
        weekly: `Trailing 7 days (${timezone})`,
        monthly: `Trailing 30 days (${timezone})`,
      },
      connections,
      time: buildApiTimeContract(timezone),
    });
  }

  async getPortfolioPerformance(
    userId: string,
    timeframe: string
  ): Promise<ApiSuccessResponse<PortfolioPerformanceResponse>> {
    const now = new Date();
    const timezone = await this.resolveUserTimeZone(userId);
    const nowInTz = this.toDateKeyInTimeZone(now, timezone);
    const resolved = validatePortfolioTimeframe(timeframe);
    let startDateKey: string;
    let endDateKey: string;
    let bucketType: 'hour' | 'day';
    let windowLabel: string;

    if (resolved === 'daily') {
      bucketType = 'hour';
      startDateKey = nowInTz;
      endDateKey = nowInTz;
      windowLabel = `Today (${timezone})`;
    } else if (resolved === 'weekly') {
      bucketType = 'day';
      startDateKey = this.shiftDateKey(nowInTz, -6);
      endDateKey = nowInTz;
      windowLabel = `Trailing 7 days (${timezone})`;
    } else {
      bucketType = 'day';
      startDateKey = this.shiftDateKey(nowInTz, -29);
      endDateKey = nowInTz;
      windowLabel = `Trailing 30 days (${timezone})`;
    }
    const window = this.getUtcWindowForLocalDateRange(startDateKey, endDateKey, timezone);

    const activeAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
    const activeAccountIds = activeAccounts.map((item) => item.id);

    const [rows, equitySnapshots] = await Promise.all([
      this.queryClosedPositionSnapshotsByPayloadDateRange(
        userId,
        activeAccountIds,
        window.startUtc,
        window.endUtc
      ),
      this.portfolioRepository.listPerformancePoints(userId, window.startUtc),
    ]);
    const latestObservedAt = this.resolveLatestPositionObservedAt(rows);

    const { positionPoints, statsRows } = this.buildPerformanceFromSnapshots(
      rows,
      timezone,
      bucketType
    );
    const equityByDate = this.buildSnapshotEquityByBucket(
      equitySnapshots,
      timezone,
      bucketType,
      window.endUtc
    );
    const pnlByDate = new Map<string, number>();
    for (const row of positionPoints.aggregated) {
      const key = String(row.bucket);
      pnlByDate.set(key, (pnlByDate.get(key) || 0) + this.toFiniteNumber(row.totalPnl));
    }

    const emptyBrokerTotals = () => ({ totalProfit: 0, totalLoss: 0, totalTrades: 0 });
    const statsByDate = new Map<string, { totalProfit: number; totalLoss: number; totalTrades: number }>();
    const brokerTotals: Record<string, { totalProfit: number; totalLoss: number; totalTrades: number }> = {};

    for (const row of statsRows) {
      const date = String(row.bucket);
      const brokerKey = String(row.brokerKey);
      const dateAgg = statsByDate.get(date) || emptyBrokerTotals();
      dateAgg.totalProfit += row.totalProfit;
      dateAgg.totalLoss += row.totalLoss;
      dateAgg.totalTrades += row.totalTrades;
      statsByDate.set(date, dateAgg);

      const bAgg = brokerTotals[brokerKey] || emptyBrokerTotals();
      bAgg.totalProfit += row.totalProfit;
      bAgg.totalLoss += row.totalLoss;
      bAgg.totalTrades += row.totalTrades;
      brokerTotals[brokerKey] = bAgg;
    }

    // Build unified points — gap-filled across all expected buckets
    const allBuckets = this.generateBucketKeys(bucketType, startDateKey, endDateKey);
    const points = allBuckets.map((date) => {
      const st = statsByDate.get(date) || emptyBrokerTotals();
      return {
        date,
        equity: equityByDate.get(date) ?? 0,
        pnl: pnlByDate.get(date) ?? 0,
        totalProfit: st.totalProfit,
        totalLoss: st.totalLoss,
        totalTrades: st.totalTrades,
      };
    });

    const totalEquity = this.resolveEndingEquity(points);
    let totalPnl = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    let totalTrades = 0;
    for (const p of points) {
      totalPnl += p.pnl;
      totalProfit += p.totalProfit;
      totalLoss += p.totalLoss;
      totalTrades += p.totalTrades;
    }

    return successResponse({
      timeframe: resolved,
      mode: 'closed-position-activity',
      source: 'scheduler_positions_snapshots',
      measurement: 'realized_pnl',
      freshnessModel: 'windowed_activity',
      observedAt: this.formatDisplayTime(latestObservedAt, timezone),
      observedAtIso: this.formatRawIso(latestObservedAt),
      definition:
        'Closed-position activity aggregated from scheduler snapshots for the selected portfolio timeframe.',
      windowLabel,
      bucketLabel: bucketType,
      points,
      summary: {
        totalEquity,
        totalPnl,
        totalProfit,
        totalLoss,
        totalTrades,
        brokers: brokerTotals,
      },
      time: buildApiTimeContract(timezone),
    });
  }

  async getCapitalOverview(userId: string): Promise<ApiSuccessResponse<PortfolioCapitalResponse>> {
    const timeZone = await this.resolveUserTimeZone(userId);
    return successResponse(await this.buildCapitalOverview(userId, timeZone));
  }

  async getFuturesSummary(
    userId: string
  ): Promise<ApiSuccessResponse<PortfolioFuturesSummaryResponse>> {
    const timeZone = await this.resolveUserTimeZone(userId);
    const activeAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
    const activeAccountIds = activeAccounts.map((account) => String(account.id || '').trim()).filter(Boolean);

    await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, activeAccountIds);

    const [capital, positionsByAccount] = await Promise.all([
      this.buildCapitalOverview(userId, timeZone),
      this.positionReadModelRepository.getOpenPositionSummaryForAccounts(userId, activeAccountIds),
    ]);

    const positionRows = Array.from(positionsByAccount.values());
    const openPositions = positionRows.reduce((sum, row) => sum + this.toFiniteNumber(row.openPositions), 0);
    const grossExposure = positionRows.reduce(
      (sum, row) => sum + this.toFiniteNumber(row.grossExposure),
      0
    );
    const longExposure = positionRows.reduce(
      (sum, row) => sum + this.toFiniteNumber(row.longExposure),
      0
    );
    const shortExposure = positionRows.reduce(
      (sum, row) => sum + this.toFiniteNumber(row.shortExposure),
      0
    );
    const unrealizedPnl = positionRows.reduce(
      (sum, row) => sum + this.toFiniteNumber(row.unrealizedPnl),
      0
    );
    const positionsObservedAtIso = this.pickLatestTimestamp(
      positionRows.map((row) => this.formatRawIso(row.latestObservedAt))
    );
    const capitalObservedAtIso =
      this.readTimeIso(capital.oldestObservedAtIso) ||
      this.readTimeIso(capital.latestObservedAtIso) ||
      null;
    const observedAtIso = this.pickLatestTimestamp([capitalObservedAtIso, positionsObservedAtIso]);

    return successResponse({
      source: 'funds_snapshots_plus_position_read_models',
      definition:
        'Futures summary built from live capital routes in funds snapshots plus open-position exposure in the positions read model.',
      freshnessModel: 'mixed_futures_state',
      observedAt: this.formatDisplayTime(observedAtIso, timeZone),
      observedAtIso,
      positionsObservedAt: this.formatDisplayTime(positionsObservedAtIso, timeZone),
      positionsObservedAtIso,
      capitalObservedAt: this.formatDisplayTime(capitalObservedAtIso, timeZone),
      capitalObservedAtIso,
      futuresEquity: this.toFiniteNumber(capital.futuresTotal),
      availableCollateral: capital.futuresItems.reduce(
        (sum, item) => sum + this.toFiniteNumber(item.funds.available),
        0
      ),
      usedMargin: capital.futuresItems.reduce(
        (sum, item) => sum + this.toFiniteNumber(item.funds.invested),
        0
      ),
      walletCollateral: this.toFiniteNumber(capital.walletTotal),
      openPositions,
      grossExposure,
      longExposure,
      shortExposure,
      unrealizedPnl,
      time: buildApiTimeContract(timeZone),
    });
  }

  async getOpenPositionsOverview(
    userId: string,
    query: PortfolioOpenPositionsQuery = {}
  ): Promise<ApiSuccessResponse<PortfolioOpenPositionsResponse>> {
    const timeZone = await this.resolveUserTimeZone(userId);
    return successResponse(await this.buildOpenPositionsOverview(userId, timeZone, query));
  }

  async getActivityOverview(
    userId: string,
    timeframe: string
  ): Promise<ApiSuccessResponse<PortfolioActivityResponse>> {
    const timeZone = await this.resolveUserTimeZone(userId);
    const [pnlResponse, performanceResponse] = await Promise.all([
      this.getPortfolioPnL(userId),
      this.getPortfolioPerformance(userId, timeframe),
    ]);
    const pnl = pnlResponse.data ?? pnlResponse;
    const performance = performanceResponse.data ?? performanceResponse;
    const observedAtIso = this.pickLatestTimestamp([
      this.readTimeIso(pnl?.observedAtIso) || this.readTimeIso(pnl?.observedAt),
      this.readTimeIso(performance?.observedAtIso) || this.readTimeIso(performance?.observedAt),
    ]);

    return successResponse({
      source: 'scheduler_positions_snapshots',
      definition:
        'Portfolio activity combines realized PnL windows and performance buckets from scheduler position snapshots.',
      freshnessModel: 'windowed_activity',
      observedAt: this.formatDisplayTime(observedAtIso, timeZone),
      observedAtIso,
      pnl,
      performance,
      time: buildApiTimeContract(timeZone),
    });
  }

  private async resolveUserTimeZone(userId: string): Promise<string> {
    const settings = await this.appSettingsRepository.getSettings(userId);
    return normalizeTimeZone(settings?.timezone, DEFAULT_TIMEZONE);
  }

  private async buildCapitalOverview(
    userId: string,
    timeZone: string
  ): Promise<PortfolioCapitalResponse> {
    const [walletFundsResponse, futuresFundsResponse] = await Promise.all([
      this.brokerWalletFacadeService.getWalletFundsForActiveAccounts(userId),
      this.brokerWalletFacadeService.getFuturesFundsForActiveAccounts(userId),
    ]);
    const wallet = this.normalizeActiveFundsPayload(walletFundsResponse, timeZone);
    const futures = this.normalizeActiveFundsPayload(futuresFundsResponse, timeZone);
    const walletTotal = wallet.items.reduce(
      (sum, item) => sum + this.toFiniteNumber(item.funds.balance),
      0
    );
    const futuresTotal = futures.items.reduce(
      (sum, item) => sum + this.toFiniteNumber(item.funds.balance),
      0
    );
    const totalVisibleCapital = walletTotal + futuresTotal;
    const latestObservedAtIso = this.pickLatestTimestamp([
      wallet.latestObservedAtIso,
      futures.latestObservedAtIso,
    ]);
    const oldestObservedAtIso = this.pickOldestTimestamp([
      wallet.oldestObservedAtIso,
      futures.oldestObservedAtIso,
    ]);

    return {
      source: 'funds_snapshots via broker_wallet_facade',
      definition:
        'Wallet and futures capital routes normalized from the latest funds snapshot for each connected account.',
      freshnessModel: 'funds_snapshot_timestamp',
      latestObservedAt: this.formatDisplayTime(latestObservedAtIso, timeZone),
      latestObservedAtIso,
      oldestObservedAt: this.formatDisplayTime(oldestObservedAtIso, timeZone),
      oldestObservedAtIso,
      walletItems: wallet.items,
      futuresItems: futures.items,
      walletTotal,
      futuresTotal,
      totalVisibleCapital,
      walletSharePct:
        totalVisibleCapital > 0 ? (walletTotal / totalVisibleCapital) * 100 : null,
      futuresSharePct:
        totalVisibleCapital > 0 ? (futuresTotal / totalVisibleCapital) * 100 : null,
      driftPct:
        totalVisibleCapital > 0
          ? (Math.abs(walletTotal - futuresTotal) / totalVisibleCapital) * 100
          : null,
      time: buildApiTimeContract(timeZone),
    };
  }

  private async buildOpenPositionsOverview(
    userId: string,
    timeZone: string,
    query: PortfolioOpenPositionsQuery = {}
  ): Promise<PortfolioOpenPositionsResponse> {
    const normalizedBrokerKey = String(query.brokerKey || '').trim().toLowerCase();
    const normalizedAccountId = String(query.accountId || '').trim();
    const activeAccounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(
      userId,
      normalizedBrokerKey || undefined
    );
    const accountById = new Map(
      activeAccounts
        .map((account) => [String(account.id || '').trim(), account] as const)
        .filter(([accountId]) => Boolean(accountId))
    );
    const activeAccountIds = Array.from(accountById.keys());
    const safeLimit = this.resolveQueryLimit(query.limit, 100);
    const safeOffset = this.resolveQueryOffset(query.offset);

    if (normalizedAccountId && !accountById.has(normalizedAccountId)) {
      return {
        items: [],
        total: 0,
        limit: safeLimit,
        offset: safeOffset,
        source: 'position_read_models',
        freshnessModel: 'position_read_model_timestamp',
        observedAt: null,
        observedAtIso: null,
        latestObservedAt: null,
        latestObservedAtIso: null,
        oldestObservedAt: null,
        oldestObservedAtIso: null,
        definition:
          'Open futures positions across connected accounts, normalized from the positions read model.',
        time: buildApiTimeContract(timeZone),
      };
    }

    await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, activeAccountIds);

    const [overview, freshnessByAccount] = await Promise.all([
      this.positionReadModelRepository.listLivePositionsOverview(userId, activeAccountIds, {
        limit: safeLimit,
        offset: safeOffset,
        brokerKey: normalizedBrokerKey || undefined,
        accountId: normalizedAccountId || undefined,
        symbol: String(query.symbol || '').trim() || undefined,
        sideKey: this.normalizePositionSideKey(query.sideKey),
      }),
      this.positionReadModelRepository.getAccountFreshness(userId, activeAccountIds),
    ]);

    const items = overview.items.map((record) =>
      this.mapOpenPositionRecord(
        record,
        timeZone,
        accountById.get(String(record.accountId || '').trim()),
        freshnessByAccount.get(String(record.accountId || '').trim()) || null
      )
    );
    const latestObservedAtIso = this.formatRawIso(overview.latestObservedAt);
    const oldestObservedAtIso = this.formatRawIso(overview.oldestObservedAt);
    const observedAtIso = latestObservedAtIso || oldestObservedAtIso || null;

    return {
      items,
      total: overview.total,
      limit: safeLimit,
      offset: safeOffset,
      source: 'position_read_models',
      freshnessModel: 'position_read_model_timestamp',
      observedAt: this.formatDisplayTime(observedAtIso, timeZone),
      observedAtIso,
      latestObservedAt: this.formatDisplayTime(latestObservedAtIso, timeZone),
      latestObservedAtIso,
      oldestObservedAt: this.formatDisplayTime(oldestObservedAtIso, timeZone),
      oldestObservedAtIso,
      definition:
        'Open futures positions across connected accounts, normalized from the positions read model.',
      time: buildApiTimeContract(timeZone),
    };
  }

  private toDateKeyInTimeZone(value: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(value);
    const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  private getUtcWindowForLocalDate(dateKey: string, timezone: string): { startUtc: Date; endUtc: Date } {
    const [year, month, day] = dateKey.split('-').map((value) => Number(value));
    const utcBase = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 0, 0, 0));
    const offsetMinutes = this.getTimeZoneOffsetMinutes(utcBase, timezone);
    const startUtc = new Date(utcBase.getTime() - offsetMinutes * 60 * 1000);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
    return { startUtc, endUtc };
  }

  private getUtcWindowForLocalDateRange(
    startDateKey: string,
    endDateKey: string,
    timezone: string
  ): { startUtc: Date; endUtc: Date } {
    const startWindow = this.getUtcWindowForLocalDate(startDateKey, timezone);
    const dayAfterEnd = this.shiftDateKey(endDateKey, 1);
    const endWindow = this.getUtcWindowForLocalDate(dayAfterEnd, timezone);
    return {
      startUtc: startWindow.startUtc,
      endUtc: endWindow.startUtc,
    };
  }

  private shiftDateKey(dateKey: string, dayOffset: number): string {
    const base = new Date(`${dateKey}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + dayOffset);
    return base.toISOString().slice(0, 10);
  }

  private getTimeZoneOffsetMinutes(date: Date, timezone: string): number {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(date);
      const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
      const year = Number(map.year);
      const month = Number(map.month);
      const day = Number(map.day);
      const hour = Number(map.hour);
      const minute = Number(map.minute);
      const second = Number(map.second);
      const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
      return (asUtc - date.getTime()) / (60 * 1000);
    } catch {
      return 0;
    }
  }

  private formatBucketInTimeZone(value: Date, timezone: string, bucketType: 'hour' | 'day'): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(value);
    const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
    const dateKey = `${map.year}-${map.month}-${map.day}`;
    if (bucketType === 'hour') {
      return `${dateKey} ${map.hour}`;
    }
    return dateKey;
  }

  private resolvePositionEventTimestamp(value: Record<string, unknown>): Date | null {
    const candidates = [
      value.closed_at,
      value.closedAt,
      value.closed_time,
      value.close_time,
      value.exit_time,
      value.exitTime,
      value.updated_at,
      value.updatedAt,
      value.created_at,
      value.createdAt,
      value.timestamp
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const parsed = new Date(String(candidate));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return null;
  }

  private extractNotional(value: Record<string, unknown>): number {
    const candidates = [
      value.notional,
      value.actual_amount,
      value.desired_amount,
      value.amount,
      value.order_value
    ];
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) {
        return Math.abs(numeric);
      }
    }
    const price = Number(
      value.price ?? value.order_price ?? value.entry_price ?? value.average_price ?? value.avg_price
    );
    const quantity = Number(value.quantity ?? value.size ?? value.filled_quantity ?? value.qty);
    if (Number.isFinite(price) && Number.isFinite(quantity)) {
      return Math.abs(price * quantity);
    }
    return 0;
  }

  private async queryClosedPositionSnapshotsByPayloadDateRange(
    userId: string,
    accountIds: string[] = [],
    startUtc: Date,
    endUtc: Date
  ): Promise<ClosedPositionSnapshotRow[]> {
    const readModelRows = await this.queryClosedPositionSnapshotsFromReadModels(
      userId,
      accountIds,
      startUtc,
      endUtc
    );
    if (readModelRows) {
      return readModelRows;
    }

    return this.queryClosedPositionSnapshotsByPayloadDateRangeFromScheduler(
      userId,
      accountIds,
      startUtc,
      endUtc
    );
  }

  private async queryClosedPositionSnapshotsFromReadModels(
    userId: string,
    accountIds: string[] = [],
    startUtc: Date,
    endUtc: Date
  ): Promise<ClosedPositionSnapshotRow[] | null> {
    try {
      if (!accountIds.length) return [];
      if (this.positionReadModelRepository?.ensureHydratedFromSnapshots) {
        await this.positionReadModelRepository.ensureHydratedFromSnapshots(userId, accountIds);
      }

      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId,
                broker_key AS brokerKey,
                realized_pnl AS realizedPnl,
                exposure,
                position_closed_at AS positionClosedAt,
                position_updated_at AS positionUpdatedAt,
                position_created_at AS positionCreatedAt,
                last_seen_at AS lastSeenAt
           FROM position_read_models
          WHERE user_id = ?
            AND account_id IN (${accountIds.map(() => '?').join(',')})
            AND status_rank >= 3
            AND position_closed_at IS NOT NULL
            AND position_closed_at >= ?
            AND position_closed_at < ?`,
        [userId, ...accountIds, startUtc, endUtc]
      )) as Array<{
        accountId?: unknown;
        brokerKey?: unknown;
        realizedPnl?: unknown;
        exposure?: unknown;
        positionClosedAt?: unknown;
        positionUpdatedAt?: unknown;
        positionCreatedAt?: unknown;
        lastSeenAt?: unknown;
      }>;

      return rows.map((row) => {
        const eventAt =
          this.toIsoString(row.positionClosedAt) ||
          this.toIsoString(row.positionUpdatedAt) ||
          this.toIsoString(row.positionCreatedAt) ||
          this.toIsoString(row.lastSeenAt);
        const observedAt =
          this.toIsoString(row.lastSeenAt) ||
          this.toIsoString(row.positionClosedAt) ||
          this.toIsoString(row.positionUpdatedAt);

        return {
          accountId: String(row.accountId || ''),
          brokerKey: String(row.brokerKey || ''),
          payload: {
            realized_pnl: this.toFiniteNumber(row.realizedPnl),
            realized: this.toFiniteNumber(row.realizedPnl),
            pnl: this.toFiniteNumber(row.realizedPnl),
            exposure: this.toFiniteNumber(row.exposure),
            notional: this.toFiniteNumber(row.exposure),
            closedAt: eventAt,
            updatedAt: observedAt,
          },
        };
      });
    } catch (error) {
      if (this.isMissingTableError(error)) return null;
      throw error;
    }
  }

  private async queryClosedPositionSnapshotsByPayloadDateRangeFromScheduler(
    userId: string,
    accountIds: string[] = [],
    startUtc: Date,
    endUtc: Date
  ): Promise<ClosedPositionSnapshotRow[]> {
    try {
      if (!accountIds.length) return [];
      const jsonCol = 'payload_json';
      const dateValueExpr = this.buildPositionEventDateValueExpr(jsonCol);
      const inClause = accountIds.map(() => '?').join(',');
      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId, broker_key AS brokerKey, payload_json AS payload
         FROM scheduler_positions_snapshots
         WHERE user_id = ?
           AND account_id IN (${inClause})
           AND status_rank >= 3
          AND ${dateValueExpr} IS NOT NULL
          AND ${dateValueExpr} <> ''
          AND ${dateValueExpr} >= ?
          AND ${dateValueExpr} < ?`,
        [userId, ...accountIds, startUtc.toISOString(), endUtc.toISOString()]
      )) as Array<{ accountId: string; brokerKey: string; payload?: unknown }>;
      return rows.map((row) => ({
        accountId: String(row.accountId),
        brokerKey: String(row.brokerKey),
        payload: this.parsePayloadJson(row.payload),
      }));
    } catch (error) {
      if (this.isMissingTableError(error)) return [];
      throw error;
    }
  }

  private buildPerformanceFromSnapshots(
    rows: Array<{ accountId: string; brokerKey: string; payload: Record<string, unknown> }>,
    timezone: string,
    bucketType: 'hour' | 'day'
  ): {
    positionPoints: {
      aggregated: Array<{ bucket: string; totalNotional: unknown; totalPnl: unknown }>;
      connections: Array<{ accountId: string; brokerKey: string; bucket: string; totalNotional: unknown; totalPnl: unknown }>;
    };
    statsRows: Array<{ bucket: string; brokerKey: string; totalProfit: number; totalLoss: number; totalTrades: number }>;
  } {
    const aggregatedMap = new Map<string, { totalNotional: number; totalPnl: number }>();
    const connectionMap = new Map<string, { accountId: string; brokerKey: string; bucket: string; totalNotional: number; totalPnl: number }>();
    const statsMap = new Map<string, { bucket: string; brokerKey: string; totalProfit: number; totalLoss: number; totalTrades: number }>();

    for (const row of rows) {
      const ts = this.resolvePositionEventTimestamp(row.payload);
      if (!ts) continue;
      const bucket = this.formatBucketInTimeZone(ts, timezone, bucketType);
      const notional = this.extractNotional(row.payload);
      const pnl = this.extractPnl(row.payload);

      const agg = aggregatedMap.get(bucket) || { totalNotional: 0, totalPnl: 0 };
      agg.totalNotional += notional;
      agg.totalPnl += pnl;
      aggregatedMap.set(bucket, agg);

      const connKey = `${row.brokerKey}:${row.accountId}:${bucket}`;
      const connAgg =
        connectionMap.get(connKey) ||
        { accountId: row.accountId, brokerKey: row.brokerKey, bucket, totalNotional: 0, totalPnl: 0 };
      connAgg.totalNotional += notional;
      connAgg.totalPnl += pnl;
      connectionMap.set(connKey, connAgg);

      const statsKey = `${bucket}:${row.brokerKey}`;
      const statsAgg =
        statsMap.get(statsKey) ||
        { bucket, brokerKey: row.brokerKey, totalProfit: 0, totalLoss: 0, totalTrades: 0 };
      if (pnl > 0) {
        statsAgg.totalProfit += pnl;
      } else if (pnl < 0) {
        statsAgg.totalLoss += Math.abs(pnl);
      }
      statsAgg.totalTrades += 1;
      statsMap.set(statsKey, statsAgg);
    }

    return {
      positionPoints: {
        aggregated: Array.from(aggregatedMap.entries()).map(([bucket, value]) => ({
          bucket,
          totalNotional: value.totalNotional,
          totalPnl: value.totalPnl,
        })),
        connections: Array.from(connectionMap.values()),
      },
      statsRows: Array.from(statsMap.values()),
    };
  }

  private aggregateClosedPositionPnlByConnection(
    rows: Array<{ accountId: string; brokerKey: string; payload: Record<string, unknown> }>
  ): Map<string, { accountId: string; brokerKey: string; pnl: number }> {
    const aggregated = new Map<string, { accountId: string; brokerKey: string; pnl: number }>();

    for (const row of rows) {
      const key = `${row.brokerKey}:${row.accountId}`;
      const current =
        aggregated.get(key) ||
        { accountId: row.accountId, brokerKey: row.brokerKey, pnl: 0 };
      current.pnl += this.extractPnl(row.payload);
      aggregated.set(key, current);
    }

    return aggregated;
  }

  private buildSnapshotEquityByBucket(
    snapshots: Array<{ equity: number; createdAt: Date }>,
    timezone: string,
    bucketType: 'hour' | 'day',
    endUtc: Date
  ): Map<string, number> {
    const equityByBucket = new Map<string, number>();

    for (const snapshot of snapshots) {
      const observedAt = snapshot?.createdAt ? new Date(snapshot.createdAt) : null;
      if (!observedAt || Number.isNaN(observedAt.getTime())) {
        continue;
      }
      if (observedAt >= endUtc) {
        continue;
      }

      const bucket = this.formatBucketInTimeZone(observedAt, timezone, bucketType);
      equityByBucket.set(bucket, this.toFiniteNumber(snapshot.equity));
    }

    return equityByBucket;
  }

  private resolveEndingEquity(points: Array<{ equity: number }>): number {
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const candidate = this.toFiniteNumber(points[index]?.equity);
      if (candidate !== 0) {
        return candidate;
      }
    }

    return this.toFiniteNumber(points[points.length - 1]?.equity);
  }
  // ---------------------------------------------------------------------------
  // Snapshot query helpers
  // ---------------------------------------------------------------------------

  private buildPositionEventDateValueExpr(jsonCol: string): string {
    return `COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.closed_at')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.closedAt')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.closed_time')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.close_time')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.exit_time')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.exitTime')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.updated_at')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.updatedAt')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.created_at')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.createdAt')),
      JSON_UNQUOTE(JSON_EXTRACT(${jsonCol}, '$.timestamp'))
    )`;
  }

  private buildPositionEventDateKeyExpr(jsonCol: string): string {
    return `LEFT(${this.buildPositionEventDateValueExpr(jsonCol)}, 10)`;
  }

  private buildPositionEventBucketExpr(jsonCol: string, bucketType: 'hour' | 'day'): string {
    if (bucketType === 'hour') {
      // Normalize ISO 'T' separator → space, then take "YYYY-MM-DD HH"
      return `LEFT(REPLACE(${this.buildPositionEventDateValueExpr(jsonCol)}, 'T', ' '), 13)`;
    }
    return this.buildPositionEventDateKeyExpr(jsonCol);
  }

  private generateBucketKeys(bucketType: 'hour' | 'day', startDateKey: string, endDateKey: string): string[] {
    const keys: string[] = [];
    if (bucketType === 'hour') {
      for (let h = 0; h < 24; h++) {
        keys.push(`${startDateKey} ${String(h).padStart(2, '0')}`);
      }
    } else {
      const current = new Date(startDateKey + 'T00:00:00Z');
      const end = new Date(endDateKey + 'T00:00:00Z');
      while (current <= end) {
        keys.push(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }
    return keys;
  }

  private async queryClosedPositionSnapshots(
    userId: string,
    startDateKey: string,
    endDateKey: string,
    accountIds: string[] = []
  ): Promise<Array<{ accountId: string; brokerKey: string; payload: Record<string, unknown> }>> {
    try {
      if (!accountIds.length) {
        return [];
      }
      const jsonCol = 'payload_json';
      const dateKeyExpr = this.buildPositionEventDateKeyExpr(jsonCol);
      const inClause = accountIds.map(() => '?').join(',');
      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId, broker_key AS brokerKey, payload_json AS payload
         FROM scheduler_positions_snapshots
         WHERE user_id = ?
           AND account_id IN (${inClause})
           AND status_rank >= 3
           AND ${dateKeyExpr} IS NOT NULL
           AND ${dateKeyExpr} <> ''
           AND ${dateKeyExpr} >= ?
           AND ${dateKeyExpr} <= ?`,
        [userId, ...accountIds, startDateKey, endDateKey]
      )) as Array<{ accountId: string; brokerKey: string; payload?: unknown }>; 
      return rows.map((r) => ({
        accountId: String(r.accountId),
        brokerKey: String(r.brokerKey),
        payload: this.parsePayloadJson(r.payload),
      }));
    } catch (error) {
      if (this.isMissingTableError(error)) return [];
      throw error;
    }
  }

  private async queryClosedPositionsPnLByConnection(
    userId: string,
    accountIds: string[] = [],
    startDateKey: string,
    endDateKey: string
  ): Promise<Map<string, { accountId: string; brokerKey: string; pnl: number }>> {
    try {
      if (!accountIds.length) return new Map();
      const jsonCol = 'payload_json';
      const dateKeyExpr = this.buildPositionEventDateKeyExpr(jsonCol);
      const inClause = accountIds.map(() => '?').join(',');

      const pnlExpr =
        "CAST(COALESCE(" +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.realized_pnl'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.realized'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.net_pnl'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.pnl'))," +
        " '0'" +
        ") AS DECIMAL(30,10))";

      const sql =
        `SELECT
           broker_key AS brokerKey,
           account_id AS accountId,
           SUM(${pnlExpr}) AS totalPnl
         FROM scheduler_positions_snapshots
         WHERE user_id = ?
           AND account_id IN (${inClause})
           AND status_rank >= 3
           AND ${dateKeyExpr} IS NOT NULL
           AND ${dateKeyExpr} <> ''
           AND ${dateKeyExpr} >= ?
           AND ${dateKeyExpr} <= ?
         GROUP BY broker_key, account_id`;

      const rows = (await coreDataSource.query(sql, [userId, ...accountIds, startDateKey, endDateKey])) as Array<{
        brokerKey: unknown;
        accountId: unknown;
        totalPnl: unknown;
      }>;

      const map = new Map<string, { accountId: string; brokerKey: string; pnl: number }>();
      for (const r of rows) {
        const brokerKey = String(r.brokerKey);
        const accountId = String(r.accountId);
        map.set(`${brokerKey}:${accountId}`, {
          brokerKey,
          accountId,
          pnl: this.toFiniteNumber(r.totalPnl),
        });
      }
      return map;
    } catch (error) {
      if (this.isMissingTableError(error)) return new Map();
      throw error;
    }
  }

  private async queryFilledOrderSnapshots(
    userId: string,
    since: Date,
    accountIds: string[] = []
  ): Promise<Array<{ accountId: string; brokerKey: string; payload: Record<string, unknown> }>> {
    try {
      if (!accountIds.length) {
        return [];
      }
      const inClause = accountIds.map(() => '?').join(',');
      const rows = (await coreDataSource.query(
        `SELECT account_id AS accountId, broker_key AS brokerKey, payload_json AS payload
         FROM scheduler_orders_snapshots
         WHERE user_id = ?
           AND account_id IN (${inClause})
           AND status_rank >= 3
           AND updated_at >= ?`,
        [userId, ...accountIds, since]
      )) as Array<{ accountId: string; brokerKey: string; payload?: unknown }>;
      return rows.map((r) => ({
        accountId: String(r.accountId),
        brokerKey: String(r.brokerKey),
        payload: this.parsePayloadJson(r.payload),
      }));
    } catch (error) {
      if (this.isMissingTableError(error)) return [];
      throw error;
    }
  }

  private async queryClosedPositionsTimeSeriesByConnectionFromPayloadDate(
    userId: string,
    accountIds: string[] = [],
    startDateKey: string,
    endDateKey: string,
    bucketType: 'hour' | 'day' = 'day'
  ): Promise<{
    aggregated: Array<{ bucket: string; totalNotional: unknown; totalPnl: unknown }>;
    connections: Array<{ accountId: string; brokerKey: string; bucket: string; totalNotional: unknown; totalPnl: unknown }>;
  }> {
    try {
      if (!accountIds.length) return { aggregated: [], connections: [] };
      const jsonCol = 'payload_json';
      const dateKeyExpr = this.buildPositionEventDateKeyExpr(jsonCol);
      const bucketExpr = this.buildPositionEventBucketExpr(jsonCol, bucketType);
      const inClause = accountIds.map(() => '?').join(',');

      const notionalExpr =
        "CAST(COALESCE(" +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.notional'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.actual_amount'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.amount'))," +
        " '0'" +
        ") AS DECIMAL(30,10))";

      const pnlExpr =
        "CAST(COALESCE(" +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.realized_pnl'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.realized'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.net_pnl'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.pnl'))," +
        " '0'" +
        ") AS DECIMAL(30,10))";

      const sqlAgg =
        `SELECT
           bucket,
           SUM(notional) AS totalNotional,
           SUM(pnl) AS totalPnl
         FROM (
           SELECT
             ${bucketExpr} AS bucket,
             ${notionalExpr} AS notional,
             ${pnlExpr} AS pnl
           FROM scheduler_positions_snapshots
           WHERE user_id = ?
             AND account_id IN (${inClause})
             AND status_rank >= 3
             AND ${dateKeyExpr} IS NOT NULL
             AND ${dateKeyExpr} <> ''
             AND ${dateKeyExpr} >= ?
             AND ${dateKeyExpr} <= ?
         ) x
         GROUP BY bucket
         ORDER BY bucket ASC`;

      const sqlConn =
        `SELECT
           broker_key AS brokerKey,
           account_id AS accountId,
           bucket,
           SUM(notional) AS totalNotional,
           SUM(pnl) AS totalPnl
         FROM (
           SELECT
             broker_key,
             account_id,
             ${bucketExpr} AS bucket,
             ${notionalExpr} AS notional,
             ${pnlExpr} AS pnl
           FROM scheduler_positions_snapshots
           WHERE user_id = ?
             AND account_id IN (${inClause})
             AND status_rank >= 3
             AND ${dateKeyExpr} IS NOT NULL
             AND ${dateKeyExpr} <> ''
             AND ${dateKeyExpr} >= ?
             AND ${dateKeyExpr} <= ?
         ) x
         GROUP BY broker_key, account_id, bucket
         ORDER BY broker_key ASC, account_id ASC, bucket ASC`;

      const params = [userId, ...accountIds, startDateKey, endDateKey];
      const aggregated = (await coreDataSource.query(sqlAgg, params)) as Array<{ bucket: string; totalNotional: unknown; totalPnl: unknown }>;
      const connections = (await coreDataSource.query(sqlConn, params)) as Array<{ brokerKey: string; accountId: string; bucket: string; totalNotional: unknown; totalPnl: unknown }>;
      return { aggregated, connections };
    } catch (error) {
      if (this.isMissingTableError(error)) return { aggregated: [], connections: [] };
      throw error;
    }
  }

  private async querySnapshotTimeSeriesByConnection(
    table: string,
    userId: string,
    since: Date,
    truncExpr: string,
    options: {
      accountIds: string[];
      statusFilter?: string[];
      statusRankMin?: number;
    }
  ): Promise<{
    aggregated: Array<{ bucket: string; totalNotional: unknown; totalPnl: unknown }>;
    connections: Array<{ accountId: string; brokerKey: string; bucket: string; totalNotional: unknown; totalPnl: unknown }>;
  }> {
    try {
      const accountIds = options.accountIds || [];
      if (!accountIds.length) {
        return { aggregated: [], connections: [] };
      }
      const accountClause = accountIds.map(() => '?').join(',');

      const whereParts: string[] = [
        'user_id = ?',
        `account_id IN (${accountClause})`,
        'last_seen_at >= ?',
      ];
      const params: unknown[] = [userId, ...accountIds, since];

      if (options.statusFilter?.length && table === 'scheduler_positions_snapshots') {
        whereParts.push(`status IN (${options.statusFilter.map(() => '?').join(',')})`);
        params.push(...options.statusFilter);
      }
      if (typeof options.statusRankMin === 'number' && table === 'scheduler_orders_snapshots') {
        whereParts.push('status_rank >= ?');
        params.push(options.statusRankMin);
      }

      const baseSelect = `
           ${truncExpr} AS bucket,
           SUM(COALESCE(
             JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.notional')),
             JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.actual_amount')),
             JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.amount')),
             0
           )) AS totalNotional,
           SUM(COALESCE(
             JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.realized_pnl')),
             JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.realized')),
             JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.net_pnl')),
             JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.pnl')),
             0
           )) AS totalPnl
      `;

      const aggregated = (await coreDataSource.query(
        `SELECT
           ${baseSelect}
         FROM ${table}
         WHERE ${whereParts.join(' AND ')}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        params
      )) as Array<{ bucket: string; totalNotional: unknown; totalPnl: unknown }>;

      const connections = (await coreDataSource.query(
        `SELECT
           broker_key AS brokerKey,
           account_id AS accountId,
           ${baseSelect}
         FROM ${table}
         WHERE ${whereParts.join(' AND ')}
         GROUP BY broker_key, account_id, bucket
         ORDER BY broker_key ASC, account_id ASC, bucket ASC`,
        params
      )) as Array<{ brokerKey: string; accountId: string; bucket: string; totalNotional: unknown; totalPnl: unknown }>;

      return { aggregated, connections };
    } catch (error) {
      if (this.isMissingTableError(error)) return { aggregated: [], connections: [] };
      throw error;
    }
  }

    private async queryClosedPositionsPerformanceStatsByBroker(
    userId: string,
    accountIds: string[] = [],
    startDateKey: string,
    endDateKey: string,
    bucketType: 'hour' | 'day' = 'day'
  ): Promise<Array<{ bucket: string; brokerKey: string; totalProfit: number; totalLoss: number; totalTrades: number }>> {
    try {
      if (!accountIds.length) {
        return [];
      }
      const jsonCol = 'payload_json';
      const dateKeyExpr = this.buildPositionEventDateKeyExpr(jsonCol);
      const bucketExpr = this.buildPositionEventBucketExpr(jsonCol, bucketType);
      const inClause = accountIds.map(() => '?').join(',');

      const pnlExpr =
        "CAST(COALESCE(" +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.realized_pnl'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.realized'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.net_pnl'))," +
        " JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.pnl'))," +
        " '0'" +
        ") AS DECIMAL(30,10))";

      const sql =
        `SELECT
           bucket,
           broker_key AS brokerKey,
           SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) AS totalProfit,
           SUM(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END) AS totalLoss,
           COUNT(*) AS totalTrades
         FROM (
           SELECT
             ${bucketExpr} AS bucket,
             broker_key,
             ${pnlExpr} AS pnl
           FROM scheduler_positions_snapshots
           WHERE user_id = ?
             AND account_id IN (${inClause})
             AND status_rank >= 3
             AND ${dateKeyExpr} IS NOT NULL
             AND ${dateKeyExpr} <> ''
             AND ${dateKeyExpr} >= ?
             AND ${dateKeyExpr} <= ?
         ) x
         GROUP BY bucket, broker_key
         ORDER BY bucket ASC, broker_key ASC`;

      const rows = (await coreDataSource.query(sql, [userId, ...accountIds, startDateKey, endDateKey])) as Array<{
        bucket: unknown;
        brokerKey: unknown;
        totalProfit: unknown;
        totalLoss: unknown;
        totalTrades: unknown;
      }>; 

      return rows.map((r) => ({
        bucket: String(r.bucket),
        brokerKey: String(r.brokerKey),
        totalProfit: this.toFiniteNumber(r.totalProfit),
        totalLoss: this.toFiniteNumber(r.totalLoss),
        totalTrades: Math.max(0, Math.floor(this.toFiniteNumber(r.totalTrades))),
      }));
    } catch (error) {
      if (this.isMissingTableError(error)) return [];
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Payload extraction helpers (same patterns as RiskService) (same patterns as RiskService)
  // ---------------------------------------------------------------------------

  private parsePayloadJson(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private toIsoString(value: unknown): string | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private extractPnl(value: Record<string, unknown>): number {
    const candidates = [value.realized_pnl, value.realized, value.net_pnl, value.pnl];
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) return numeric;
    }
    return 0;
  }

  private toFiniteNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private resolveLatestPositionObservedAt(
    rows: Array<{ payload: Record<string, unknown> }>
  ): string | null {
    let latest: Date | null = null;

    for (const row of rows) {
      const timestamp = this.resolvePositionEventTimestamp(row.payload);
      if (!timestamp || Number.isNaN(timestamp.getTime())) {
        continue;
      }
      if (!latest || timestamp.getTime() > latest.getTime()) {
        latest = timestamp;
      }
    }

    return latest?.toISOString?.() ?? null;
  }

  private isMissingTableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = String((error as { code?: unknown }).code || '').trim();
    const message = String((error as { message?: unknown }).message || '')
      .trim()
      .toLowerCase();
    return (
      code === 'ER_NO_SUCH_TABLE' ||
      code === '42P01' ||
      message.includes("doesn't exist")
    );
  }

  async rebalancePortfolio(
    userId: string,
    body: RebalanceReviewBody = {}
  ): Promise<ApiSuccessResponse<RebalanceReviewResult>> {
    const validated = validateRebalanceReviewBody(body);

    try {
      const review = await this.buildWorkspaceReviewPayload(userId, validated);
      await this.operationalEventService.logActivity(userId, {
        type: 'Portfolio workspace review',
        title: 'Portfolio rebalance review generated',
        status: 'Success',
        route: '/portfolio/rebalance-review',
        stream: 'portfolio',
        related: 'portfolio',
        description: `${review.actions.length} operator action${review.actions.length === 1 ? '' : 's'} generated for the ${validated.timeframe} portfolio workspace.`,
      });

      return successResponse({
        message: 'Rebalance review generated',
        review,
      });
    } catch (error) {
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Portfolio',
        source: 'portfolio.rebalance-review',
        route: '/portfolio/rebalance-review',
        message: error instanceof Error ? error.message : 'Unable to generate rebalance review',
        severity: 'Medium',
        urgency: 'Normal',
      });
      throw error;
    }
  }

  async generateWorkspaceReport(
    userId: string,
    body: PortfolioWorkspaceReportBody = {}
  ): Promise<ApiSuccessResponse<PortfolioWorkspaceReportResult>> {
    const validated = validatePortfolioWorkspaceReportBody(body);

    try {
      const review = await this.buildWorkspaceReviewPayload(userId, validated);
      const title = `Portfolio workspace report · ${this.toTitleCase(validated.timeframe)}`;
      const fileName = this.buildWorkspaceReportFileName(validated.timeframe, validated.format);
      const content =
        validated.format === 'json'
          ? this.buildWorkspaceJsonReport(review)
          : this.buildWorkspaceMarkdownReport(review);
      const contentType =
        validated.format === 'json'
          ? 'application/json; charset=utf-8'
          : 'text/markdown; charset=utf-8';

      await this.operationalEventService.logActivity(userId, {
        type: 'Portfolio workspace report',
        title: 'Portfolio workspace report generated',
        status: 'Success',
        route: '/portfolio/workspace-report',
        stream: 'portfolio',
        related: 'portfolio',
        description: `${validated.format.toUpperCase()} workspace report generated for the ${validated.timeframe} portfolio workspace.`,
      });

      return successResponse({
        message: 'Workspace report generated',
        report: {
          generatedAt: review.generatedAt,
          generatedAtIso: review.generatedAtIso,
          title,
          format: validated.format,
          fileName,
          contentType,
          content,
          summary: review.summary,
          note: review.note,
          context: review.context,
          snapshotObservedAt: review.snapshotObservedAt,
          snapshotObservedAtIso: review.snapshotObservedAtIso,
          activityObservedAt: review.activityObservedAt,
          activityObservedAtIso: review.activityObservedAtIso,
          highlights: review.highlights,
          actions: review.actions,
          time: review.time,
        },
      });
    } catch (error) {
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Portfolio',
        source: 'portfolio.workspace-report',
        route: '/portfolio/workspace-report',
        message: error instanceof Error ? error.message : 'Unable to generate workspace report',
        severity: 'Medium',
        urgency: 'Normal',
      });
      throw error;
    }
  }

  private async buildWorkspaceReviewPayload(
    userId: string,
    input: Pick<
      ValidatedRebalanceReviewBody | ValidatedPortfolioWorkspaceReportBody,
      'timeframe' | 'holdingsFocus' | 'holdingsSearch' | 'selectedHoldingId'
    >
  ): Promise<PortfolioWorkspaceReviewPayload> {
    const timeZone = await this.resolveUserTimeZone(userId);
    const generatedAtIso = new Date().toISOString();
    const [summaryResponse, holdingsResponse, performanceResponse, walletFundsResponse, futuresFundsResponse] =
      await Promise.all([
        this.getPortfolioSummary(userId),
        this.getPortfolioHoldings(userId, {
          limit: String(this.workspaceHoldingsSliceLimit),
          offset: '0',
        }),
        this.getPortfolioPerformance(userId, input.timeframe),
        this.brokerWalletFacadeService.getWalletFundsForActiveAccounts(userId),
        this.brokerWalletFacadeService.getFuturesFundsForActiveAccounts(userId),
      ]);

    const summary = (summaryResponse.data ?? summaryResponse) as PortfolioSummary;
    const holdingsPayload = (holdingsResponse.data ?? holdingsResponse) as PortfolioHoldingsResponse;
    const performance = (performanceResponse.data ?? performanceResponse) as PortfolioPerformanceResponse;
    const holdings = Array.isArray(holdingsPayload.items) ? holdingsPayload.items : [];
    const filteredHoldings = this.filterWorkspaceHoldings(holdings, input);
    const selectedHolding =
      holdings.find((holding) => holding.id === input.selectedHoldingId) ?? null;
    const selectedHoldingVisible =
      filteredHoldings.find((holding) => holding.id === input.selectedHoldingId) ??
      (filteredHoldings.length === 1 ? filteredHoldings[0] : null);
    const reviewHoldings = filteredHoldings.length ? filteredHoldings : holdings;
    const capital = this.buildWorkspaceCapitalSummary(walletFundsResponse, futuresFundsResponse);
    const sleeveSummary = this.buildSleeveSummary(reviewHoldings);
    const largestHolding = this.findLargestHolding(reviewHoldings);
    const watchCount = reviewHoldings.filter((holding) => this.isHoldingOnWatch(holding)).length;
    const atRiskCount = reviewHoldings.filter(
      (holding) => this.normalizeRiskState(holding.riskState) === 'at risk'
    ).length;
    const context: PortfolioWorkspaceContext = {
      timeframe: input.timeframe,
      holdingsFocus: input.holdingsFocus,
      holdingsSearch: input.holdingsSearch || null,
      selectedHoldingId: input.selectedHoldingId || null,
      selectedHoldingSymbol: selectedHolding?.symbol || null,
      sliceLimit: Number.isFinite(Number(holdingsPayload.limit))
        ? Number(holdingsPayload.limit)
        : this.workspaceHoldingsSliceLimit,
      filterMode: 'loaded_overview_slice_client_side',
    };
    const snapshotObservedAtIso =
      this.readTimeIso(holdingsPayload.observedAtIso) ||
      this.readTimeIso(holdingsPayload.observedAt) ||
      this.readTimeIso(summary?.observedAtIso) ||
      this.readTimeIso(summary?.observedAt) ||
      null;
    const activityObservedAtIso =
      this.readTimeIso(performance?.observedAtIso) ||
      this.readTimeIso(performance?.observedAt) ||
      null;

    const analysis: PortfolioWorkspaceAnalysis = {
      generatedAt: this.formatDisplayTime(generatedAtIso, timeZone) || generatedAtIso,
      summary,
      holdings,
      filteredHoldings,
      selectedHolding: selectedHoldingVisible || selectedHolding,
      performance,
      capital,
      context,
      snapshotObservedAt: this.formatDisplayTime(snapshotObservedAtIso, timeZone),
      activityObservedAt: this.formatDisplayTime(activityObservedAtIso, timeZone),
      watchCount,
      atRiskCount,
      topSleeve: sleeveSummary,
      largestHolding,
      realizedPnl: this.toFiniteNumber(performance?.summary?.totalPnl),
      realizedProfit: this.toFiniteNumber(performance?.summary?.totalProfit),
      realizedLoss: this.toFiniteNumber(performance?.summary?.totalLoss),
      realizedTrades: Math.max(0, Math.floor(this.toFiniteNumber(performance?.summary?.totalTrades))),
      windowLabel:
        String(performance?.windowLabel || '').trim() ||
        `${this.toTitleCase(input.timeframe)} activity window`,
    };

    const highlights = this.buildWorkspaceHighlights(analysis);
    const actions = this.buildWorkspaceActions(analysis);
    const summaryText = this.buildWorkspaceSummary(analysis, actions);
    const note = this.buildWorkspaceNote(analysis);

    return {
      generatedAt: analysis.generatedAt,
      generatedAtIso,
      summary: summaryText,
      note,
      context,
      snapshotObservedAt: analysis.snapshotObservedAt,
      snapshotObservedAtIso,
      activityObservedAt: analysis.activityObservedAt,
      activityObservedAtIso,
      highlights,
      actions,
      time: buildApiTimeContract(timeZone),
    };
  }

  private filterWorkspaceHoldings(
    holdings: PortfolioHolding[],
    input: Pick<
      ValidatedRebalanceReviewBody | ValidatedPortfolioWorkspaceReportBody,
      'holdingsFocus' | 'holdingsSearch'
    >
  ): PortfolioHolding[] {
    const search = this.normalizeSearchValue(input.holdingsSearch);

    return holdings.filter((holding) => {
      const side = String(holding.side || '').trim().toLowerCase();
      if (input.holdingsFocus === 'watch' && !this.isHoldingOnWatch(holding)) {
        return false;
      }
      if (input.holdingsFocus === 'long' && side !== 'long') {
        return false;
      }
      if (input.holdingsFocus === 'short' && side !== 'short') {
        return false;
      }
      if (!search) {
        return true;
      }

      const haystack = [
        holding.symbol,
        holding.strategy,
        holding.sleeve,
        holding.side,
        holding.riskState,
        holding.contribution,
      ]
        .map((value) => this.normalizeSearchValue(value))
        .filter(Boolean)
        .join(' ');

      return haystack.includes(search);
    });
  }

  private buildSleeveSummary(
    holdings: PortfolioHolding[]
  ): { name: string; allocationPct: number; marketValue: number; count: number } | null {
    const sleeves = new Map<string, { name: string; allocationPct: number; marketValue: number; count: number }>();

    holdings.forEach((holding) => {
      const key = String(holding.sleeve || 'Unassigned').trim() || 'Unassigned';
      const current = sleeves.get(key) || {
        name: key,
        allocationPct: 0,
        marketValue: 0,
        count: 0,
      };
      current.allocationPct += this.toFiniteNumber(holding.allocationPct);
      current.marketValue += this.toFiniteNumber(holding.marketValue);
      current.count += 1;
      sleeves.set(key, current);
    });

    return Array.from(sleeves.values()).sort((left, right) => {
      if (right.marketValue !== left.marketValue) {
        return right.marketValue - left.marketValue;
      }
      return right.allocationPct - left.allocationPct;
    })[0] || null;
  }

  private findLargestHolding(holdings: PortfolioHolding[]): PortfolioHolding | null {
    return (
      [...holdings].sort(
        (left, right) =>
          this.toFiniteNumber(right.allocationPct) - this.toFiniteNumber(left.allocationPct)
      )[0] || null
    );
  }

  private buildWorkspaceCapitalSummary(
    walletPayload: unknown,
    futuresPayload: unknown
  ): PortfolioWorkspaceCapitalSummary {
    const walletRoutes = this.normalizeCapitalRoutes(walletPayload);
    const futuresRoutes = this.normalizeCapitalRoutes(futuresPayload);
    const walletTotal = walletRoutes.reduce((sum, route) => sum + route.balance, 0);
    const futuresTotal = futuresRoutes.reduce((sum, route) => sum + route.balance, 0);
    const totalVisibleCapital = walletTotal + futuresTotal;
    const walletSharePct =
      totalVisibleCapital > 0 ? (walletTotal / totalVisibleCapital) * 100 : null;
    const futuresSharePct =
      totalVisibleCapital > 0 ? (futuresTotal / totalVisibleCapital) * 100 : null;
    const driftPct =
      totalVisibleCapital > 0
        ? (Math.abs(walletTotal - futuresTotal) / totalVisibleCapital) * 100
        : null;
    const observedAt = this.pickLatestTimestamp([
      ...walletRoutes.map((route) => route.observedAt),
      ...futuresRoutes.map((route) => route.observedAt),
    ]);

    return {
      walletRoutes,
      futuresRoutes,
      walletTotal,
      futuresTotal,
      totalVisibleCapital,
      walletSharePct,
      futuresSharePct,
      driftPct,
      observedAt,
    };
  }

  private normalizeActiveFundsPayload(
    payload: unknown,
    timeZone: string
  ): PortfolioNormalizedFundsPayload {
    const raw =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { items?: unknown[]; data?: { items?: unknown[] } })
        : {};
    const items =
      (Array.isArray(raw.items) && raw.items) ||
      (Array.isArray(raw.data?.items) && raw.data.items) ||
      (Array.isArray(payload) ? payload : []);
    const normalizedItems = items.map((item) => this.normalizeActiveFundsItem(item, timeZone));

    return {
      items: normalizedItems,
      latestObservedAtIso: this.pickLatestTimestamp(
        normalizedItems.map((item) => item.observedAtIso || item.observedAt || null)
      ),
      oldestObservedAtIso: this.pickOldestTimestamp(
        normalizedItems.map((item) => item.observedAtIso || item.observedAt || null)
      ),
    };
  }

  private normalizeActiveFundsItem(
    item: unknown,
    timeZone: string
  ): PortfolioActiveFundsItem {
    const safe =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    const rawFundsCandidate =
      safe.funds && typeof safe.funds === 'object' && !Array.isArray(safe.funds)
        ? (safe.funds as Record<string, unknown>)
        : safe;
    const rawFunds =
      rawFundsCandidate.data &&
      typeof rawFundsCandidate.data === 'object' &&
      !Array.isArray(rawFundsCandidate.data)
        ? (rawFundsCandidate.data as Record<string, unknown>)
        : rawFundsCandidate;
    const observedAtIso =
      safe.observedAt || safe.observed_at
        ? this.readTimeIso(safe.observedAt || safe.observed_at)
        : null;

    return {
      accountId: String(safe.accountId || safe.account_id || ''),
      accountName: String(safe.accountName || safe.account_name || ''),
      accountKey: String(safe.accountKey || safe.account_key || ''),
      brokerKey: String(safe.brokerKey || safe.broker_key || ''),
      status: String(safe.status || ''),
      observedAt: this.formatDisplayTime(observedAtIso, timeZone),
      observedAtIso,
      error: safe.error ? String(safe.error) : null,
      funds: {
        balance: this.toOptionalNumber(
          rawFunds.balance ??
            rawFunds.total ??
            rawFunds.equity ??
            rawFunds.wallet_balance ??
            rawFunds.futures_equity ??
            rawFunds.margin_balance
        ),
        available: this.toOptionalNumber(
          rawFunds.available_balance ??
            rawFunds.withdrawable ??
            rawFunds.free ??
            rawFunds.available ??
            rawFunds.free_balance
        ),
        invested: this.toOptionalNumber(
          rawFunds.invested ??
            rawFunds.locked_amount ??
            rawFunds.used_margin ??
            rawFunds.margin_used
        ),
      },
    };
  }

  private normalizeCapitalRoutes(payload: unknown): PortfolioWorkspaceCapitalRoute[] {
    const safe =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { items?: unknown[]; data?: { items?: unknown[] } })
        : {};
    const items =
      (Array.isArray(safe.items) && safe.items) ||
      (Array.isArray(safe.data?.items) && safe.data.items) ||
      (Array.isArray(payload) ? payload : []);

    return items.map((item) => {
      const source =
        item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const fundsCandidate =
        source.funds && typeof source.funds === 'object' && !Array.isArray(source.funds)
          ? (source.funds as Record<string, unknown>)
          : source;
      const funds =
        fundsCandidate.data &&
        typeof fundsCandidate.data === 'object' &&
        !Array.isArray(fundsCandidate.data)
          ? (fundsCandidate.data as Record<string, unknown>)
          : fundsCandidate;

      return {
        accountId: String(source.accountId || source.account_id || ''),
        accountName: String(source.accountName || source.account_name || ''),
        brokerKey: String(source.brokerKey || source.broker_key || ''),
        observedAt:
          source.observedAt || source.observed_at
            ? String(source.observedAt || source.observed_at)
            : null,
        balance: this.resolveFundsBalance(funds),
        error: source.error ? String(source.error) : null,
      };
    });
  }

  private resolveFundsBalance(payload: Record<string, unknown>): number {
    const candidates = [
      payload.balance,
      payload.total,
      payload.equity,
      payload.wallet_balance,
      payload.futures_equity,
      payload.margin_balance,
    ];
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    return 0;
  }

  private mapOpenPositionRecord(
    record: PositionRecord,
    timeZone: string,
    account:
      | {
          id: string;
          accountName: string;
          accountKey: string;
          brokerKey: string;
          status: string;
        }
      | undefined,
    freshnessRow:
      | {
          observedAt?: Date | null;
        }
      | null
  ): PortfolioOpenPositionItem {
    const summary =
      record.positionSummary && typeof record.positionSummary === 'object'
        ? record.positionSummary
        : {
            id: String(record.id || ''),
            externalId: String(record.externalId || record.external_id || '') || undefined,
            symbol: record.symbol ?? null,
            side: String(record.side || '--'),
            sideKey: String(record.sideKey || 'unknown'),
            status: String(record.status || '--'),
            statusKey: String(record.statusKey || 'unknown'),
            quantity: this.toOptionalNumber(record.quantity),
            entryPrice: this.toOptionalNumber(record.entry_price),
            currentPrice: this.toOptionalNumber(record.current_price),
            closedPrice: this.toOptionalNumber(record.closed_price),
            unrealizedPnl: this.toOptionalNumber(record.unrealized_pnl),
            realizedPnl: this.toOptionalNumber(record.realized_pnl ?? record.realized),
            leverage: this.toOptionalNumber(record.leverage),
            liquidationPrice: this.toOptionalNumber(record.liquidation_price),
            exposure: this.toOptionalNumber(record.exposure),
            createdAt: String(record.created_at || '') || undefined,
            updatedAt: String(record.updated_at || '') || undefined,
            closedAt: String(record.closed_at || '') || undefined,
          };
    const observedAtIso =
      this.readTimeIso(record.last_seen_at) ||
      this.readTimeIso(record.updated_at) ||
      this.readTimeIso(record.closed_at) ||
      this.readTimeIso(record.created_at) ||
      this.formatRawIso(freshnessRow?.observedAt || null) ||
      null;

    return {
      ...summary,
      accountId: String(account?.id || record.accountId || ''),
      accountName: String(account?.accountName || record.accountName || ''),
      accountKey: String(account?.accountKey || record.accountKey || ''),
      brokerKey: String(account?.brokerKey || record.brokerKey || ''),
      observedAt: this.formatDisplayTime(observedAtIso, timeZone),
      observedAtIso,
      freshness: this.buildPositionsFreshnessIndicator(observedAtIso, 'position_read_models'),
    };
  }

  private buildWorkspaceHighlights(
    analysis: PortfolioWorkspaceAnalysis
  ): PortfolioWorkspaceHighlight[] {
    const highlights: PortfolioWorkspaceHighlight[] = [
      {
        label: 'Workspace slice',
        value: `${analysis.filteredHoldings.length}/${analysis.holdings.length} loaded holdings`,
        tone: analysis.filteredHoldings.length ? 'info' : 'warning',
      },
      {
        label: 'Realized activity',
        value: `${this.formatSignedCurrencyValue(analysis.realizedPnl)} across ${analysis.realizedTrades} trade${analysis.realizedTrades === 1 ? '' : 's'}`,
        tone: analysis.realizedPnl < 0 ? 'warning' : analysis.realizedPnl > 0 ? 'success' : 'info',
      },
      {
        label: 'Capital split',
        value:
          analysis.capital.totalVisibleCapital > 0
            ? `Wallet ${this.formatPercentValue(analysis.capital.walletSharePct)} · Futures ${this.formatPercentValue(analysis.capital.futuresSharePct)}`
            : 'No visible capital routes',
        tone:
          analysis.capital.driftPct !== null &&
          analysis.capital.driftPct >= this.capitalDriftAlertThresholdPct
            ? 'warning'
            : 'info',
      },
    ];

    if (analysis.largestHolding) {
      highlights.push({
        label: 'Largest weight',
        value: `${analysis.largestHolding.symbol} · ${this.formatPercentValue(analysis.largestHolding.allocationPct)}`,
        tone:
          this.toFiniteNumber(analysis.largestHolding.allocationPct) >= 40 ? 'warning' : 'info',
      });
    }

    if (analysis.topSleeve) {
      highlights.push({
        label: 'Top sleeve',
        value: `${analysis.topSleeve.name} · ${this.formatPercentValue(analysis.topSleeve.allocationPct)}`,
        tone:
          this.toFiniteNumber(analysis.topSleeve.allocationPct) >= 55 ? 'warning' : 'info',
      });
    }

    highlights.push({
      label: 'Watch / at risk',
      value: `${analysis.watchCount}/${analysis.atRiskCount}`,
      tone: analysis.atRiskCount > 0 ? 'danger' : analysis.watchCount > 0 ? 'warning' : 'success',
    });

    if (analysis.selectedHolding) {
      highlights.push({
        label: 'Selected holding',
        value: `${analysis.selectedHolding.symbol} · ${analysis.selectedHolding.riskState || 'Unknown risk'}`,
        tone: this.isHoldingOnWatch(analysis.selectedHolding) ? 'warning' : 'info',
      });
    }

    return highlights;
  }

  private buildWorkspaceActions(
    analysis: PortfolioWorkspaceAnalysis
  ): PortfolioWorkspaceAction[] {
    const actions = new Map<PortfolioWorkspaceAction['code'], PortfolioWorkspaceAction>();

    if (
      analysis.largestHolding &&
      this.toFiniteNumber(analysis.largestHolding.allocationPct) >= 40
    ) {
      actions.set('trim_concentration', {
        code: 'trim_concentration',
        title: 'Trim concentration',
        priority: 'high',
        detail: `${analysis.largestHolding.symbol} is ${this.formatPercentValue(analysis.largestHolding.allocationPct)} of the current workspace slice, above the manual review trigger.`,
        metric: this.formatPercentValue(analysis.largestHolding.allocationPct),
      });
    }

    if (analysis.atRiskCount > 0) {
      actions.set('triage_at_risk', {
        code: 'triage_at_risk',
        title: 'Triage at-risk holdings',
        priority: 'high',
        detail: `${analysis.atRiskCount} holding${analysis.atRiskCount === 1 ? '' : 's'} are already marked at risk in the current workspace slice.`,
        metric: `${analysis.atRiskCount}`,
      });
    }

    if (analysis.watchCount > 0) {
      actions.set('review_watchlist', {
        code: 'review_watchlist',
        title: 'Review watchlist posture',
        priority: analysis.atRiskCount > 0 ? 'high' : 'medium',
        detail: `${analysis.watchCount} holding${analysis.watchCount === 1 ? '' : 's'} need closer monitoring before changing allocation.`,
        metric: `${analysis.watchCount}`,
      });
    }

    if (analysis.topSleeve && this.toFiniteNumber(analysis.topSleeve.allocationPct) >= 55) {
      actions.set('rebalance_sleeve', {
        code: 'rebalance_sleeve',
        title: 'Rebalance dominant sleeve',
        priority: 'medium',
        detail: `${analysis.topSleeve.name} accounts for ${this.formatPercentValue(analysis.topSleeve.allocationPct)} of the current workspace slice.`,
        metric: this.formatPercentValue(analysis.topSleeve.allocationPct),
      });
    }

    if (
      analysis.capital.driftPct !== null &&
      analysis.capital.driftPct >= this.capitalDriftAlertThresholdPct
    ) {
      actions.set('align_capital_routes', {
        code: 'align_capital_routes',
        title: 'Align capital routes',
        priority: 'medium',
        detail: `Wallet capital is ${this.formatCurrencyValue(analysis.capital.walletTotal)} and futures capital is ${this.formatCurrencyValue(analysis.capital.futuresTotal)}, a ${this.formatPercentValue(analysis.capital.driftPct)} split drift across visible capital.`,
        metric: this.formatPercentValue(analysis.capital.driftPct),
      });
    }

    if (analysis.realizedPnl < 0) {
      actions.set('review_recent_activity', {
        code: 'review_recent_activity',
        title: 'Review recent closed-position activity',
        priority: 'medium',
        detail: `${analysis.windowLabel} is running at ${this.formatSignedCurrencyValue(analysis.realizedPnl)} across ${analysis.realizedTrades} realized trade${analysis.realizedTrades === 1 ? '' : 's'}.`,
        metric: this.formatSignedCurrencyValue(analysis.realizedPnl),
      });
    }

    if (analysis.selectedHolding && this.isHoldingOnWatch(analysis.selectedHolding)) {
      actions.set('inspect_selected_holding', {
        code: 'inspect_selected_holding',
        title: 'Inspect selected holding',
        priority:
          this.normalizeRiskState(analysis.selectedHolding.riskState) === 'at risk'
            ? 'high'
            : 'medium',
        detail: `${analysis.selectedHolding.symbol} is selected in the workspace and currently marked ${analysis.selectedHolding.riskState || 'for review'}.`,
        metric: analysis.selectedHolding.symbol,
      });
    }

    if (!actions.size) {
      actions.set('monitor', {
        code: 'monitor',
        title: 'Monitor current posture',
        priority: 'low',
        detail:
          'No Phase 6 manual review trigger is active in the current workspace slice. Refresh the overview before making allocation changes.',
        metric: analysis.windowLabel,
      });
    }

    return Array.from(actions.values()).sort((left, right) => {
      const priorityRank = { high: 0, medium: 1, low: 2 };
      return priorityRank[left.priority] - priorityRank[right.priority];
    });
  }

  private buildWorkspaceSummary(
    analysis: PortfolioWorkspaceAnalysis,
    actions: PortfolioWorkspaceAction[]
  ): string {
    const workspaceCount = analysis.filteredHoldings.length;
    const actionLead = actions[0];
    const focusLabel =
      analysis.context.holdingsFocus === 'all'
        ? 'all holdings'
        : `${analysis.context.holdingsFocus} holdings`;

    if (!workspaceCount) {
      return `No holdings matched the current ${focusLabel} workspace filters, so the manual review is anchored to visible capital routes and ${analysis.windowLabel.toLowerCase()}.`;
    }

    const topLine = analysis.largestHolding
      ? `${analysis.largestHolding.symbol} leads the current workspace slice at ${this.formatPercentValue(analysis.largestHolding.allocationPct)}.`
      : 'The current workspace slice has no concentration leader yet.';
    const actionLine = actionLead
      ? `${actionLead.title} is the top recommended operator action for this workspace state.`
      : 'No explicit operator action is currently required.';

    return `${workspaceCount} holding${workspaceCount === 1 ? '' : 's'} match the current ${focusLabel} workspace. ${topLine} ${actionLine}`;
  }

  private buildWorkspaceNote(analysis: PortfolioWorkspaceAnalysis): string {
    const notes = [
      'This review is manual and does not auto-reconcile broker balances back into stored portfolio snapshots.',
      `Holdings focus and search run on the ${analysis.context.sliceLimit}-row overview slice already loaded into the workspace.`,
    ];

    if (analysis.context.holdingsSearch) {
      notes.push(
        `Applied search "${analysis.context.holdingsSearch}" matched ${analysis.filteredHoldings.length} holding${analysis.filteredHoldings.length === 1 ? '' : 's'} in the current slice.`
      );
    }

    if (analysis.context.selectedHoldingId && !analysis.selectedHolding) {
      notes.push(
        `Selected holding ${analysis.context.selectedHoldingId} is not present in the loaded workspace slice.`
      );
    }

    if (analysis.capital.totalVisibleCapital <= 0) {
      notes.push('Capital-route guidance is limited because no visible wallet or futures balance snapshot was found.');
    }

    return notes.join(' ');
  }

  private buildWorkspaceMarkdownReport(review: PortfolioWorkspaceReviewPayload): string {
    const lines = [
      `# Portfolio workspace report`,
      ``,
      `Generated at: ${review.generatedAt}`,
      `Timeframe: ${this.toTitleCase(review.context.timeframe)}`,
      `Holdings focus: ${this.toTitleCase(review.context.holdingsFocus)}`,
      `Holdings search: ${review.context.holdingsSearch || 'None'}`,
      `Selected holding: ${review.context.selectedHoldingSymbol || review.context.selectedHoldingId || 'None'}`,
      `Workspace slice limit: ${review.context.sliceLimit}`,
      `Snapshot observed at: ${review.snapshotObservedAt || 'Unavailable'}`,
      `Activity observed at: ${review.activityObservedAt || 'Unavailable'}`,
      ``,
      `## Summary`,
      review.summary,
      ``,
      `## Note`,
      review.note,
      ``,
      `## Highlights`,
      ...review.highlights.map(
        (item) => `- ${item.label}: ${item.value}${item.tone ? ` (${item.tone})` : ''}`
      ),
      ``,
      `## Recommended actions`,
      ...review.actions.map(
        (item, index) =>
          `${index + 1}. [${item.priority.toUpperCase()}] ${item.title}: ${item.detail}${
            item.metric ? ` (${item.metric})` : ''
          }`
      ),
      ``,
      `## Workspace context`,
      `- Filter mode: ${review.context.filterMode}`,
      `- Holdings focus: ${review.context.holdingsFocus}`,
      `- Holdings search: ${review.context.holdingsSearch || 'None'}`,
      `- Selected holding id: ${review.context.selectedHoldingId || 'None'}`,
      `- Selected holding symbol: ${review.context.selectedHoldingSymbol || 'None'}`,
    ];

    return lines.join('\n');
  }

  private buildWorkspaceJsonReport(review: PortfolioWorkspaceReviewPayload): string {
    return JSON.stringify(
      {
        generatedAt: review.generatedAt,
        generatedAtIso: review.generatedAtIso,
        summary: review.summary,
        note: review.note,
        context: review.context,
        snapshotObservedAt: review.snapshotObservedAt,
        snapshotObservedAtIso: review.snapshotObservedAtIso,
        activityObservedAt: review.activityObservedAt,
        activityObservedAtIso: review.activityObservedAtIso,
        highlights: review.highlights,
        actions: review.actions,
        time: review.time,
      },
      null,
      2
    );
  }

  private buildWorkspaceReportFileName(
    timeframe: PortfolioTimeframe,
    format: PortfolioWorkspaceReportFormat
  ): string {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const extension = format === 'json' ? 'json' : 'md';
    return `portfolio-workspace-${timeframe}-${stamp}.${extension}`;
  }

  private normalizeSearchValue(value: unknown): string {
    return String(value || '').trim().toLowerCase();
  }

  private normalizeRiskState(value: unknown): string {
    return String(value || '').trim().toLowerCase();
  }

  private isHoldingOnWatch(holding: PortfolioHolding | null): boolean {
    return this.normalizeRiskState(holding?.riskState) !== 'healthy';
  }

  private formatPercentValue(value: unknown): string {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : '--';
  }

  private formatCurrencyValue(value: unknown): string {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '--';
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(numeric);
  }

  private formatSignedCurrencyValue(value: unknown): string {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '--';
    }
    if (numeric > 0) {
      return `+${this.formatCurrencyValue(Math.abs(numeric))}`;
    }
    if (numeric < 0) {
      return `-${this.formatCurrencyValue(Math.abs(numeric))}`;
    }
    return this.formatCurrencyValue(0);
  }

  private toTitleCase(value: string): string {
    return String(value || '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private pickLatestTimestamp(values: Array<string | null | undefined>): string | null {
    return values.reduce<string | null>((latest, value) => {
      if (!value) {
        return latest;
      }
      const candidate = new Date(String(value));
      if (Number.isNaN(candidate.getTime())) {
        return latest;
      }
      if (!latest) {
        return candidate.toISOString();
      }
      const existing = new Date(latest);
      return candidate.getTime() > existing.getTime() ? candidate.toISOString() : latest;
    }, null);
  }

  private pickOldestTimestamp(values: Array<string | null | undefined>): string | null {
    return values.reduce<string | null>((oldest, value) => {
      if (!value) {
        return oldest;
      }
      const candidate = new Date(String(value));
      if (Number.isNaN(candidate.getTime())) {
        return oldest;
      }
      if (!oldest) {
        return candidate.toISOString();
      }
      const existing = new Date(oldest);
      return candidate.getTime() < existing.getTime() ? candidate.toISOString() : oldest;
    }, null);
  }

  private buildPositionsFreshnessIndicator(
    observedAt: string | null,
    source: string
  ): PositionsFreshnessIndicator {
    const observedAtIso = this.readTimeIso(observedAt);
    const observedAtMs = observedAtIso ? new Date(observedAtIso).getTime() : null;
    const freshnessMs =
      observedAtMs !== null && Number.isFinite(observedAtMs)
        ? Math.max(0, Date.now() - observedAtMs)
        : null;
    const staleAfterMs = env.positions.liveSnapshotStaleAfterMs;
    const criticalAfterMs = env.positions.liveSnapshotCriticalAfterMs;
    const state =
      freshnessMs === null
        ? 'unknown'
        : freshnessMs > criticalAfterMs
          ? 'critical'
          : freshnessMs > staleAfterMs
            ? 'stale'
            : 'fresh';

    return {
      state,
      observedAt: observedAtIso,
      freshnessMs,
      staleAfterMs,
      criticalAfterMs,
      isStale: state === 'stale' || state === 'critical',
      isCritical: state === 'critical',
      source,
    };
  }

  private toOptionalNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private resolveQueryLimit(value: string | number | undefined, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
  }

  private resolveQueryOffset(value: string | number | undefined): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
  }

  private normalizePositionSideKey(
    value: unknown
  ): 'long' | 'short' | undefined {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'long' || normalized === 'short' ? normalized : undefined;
  }

  private formatDisplayTime(
    value: Date | string | null | undefined,
    timeZone: string
  ): string | null {
    return formatApiDisplayTime(value, timeZone) || null;
  }

  private formatRawIso(value: Date | string | null | undefined): string | null {
    return formatApiRawIso(value) || null;
  }

  private readTimeIso(value: unknown): string | null {
    return this.formatRawIso(
      typeof value === 'string' || value instanceof Date ? value : null
    );
  }

  private mapSnapshot(
    snapshot: import('../../database').PortfolioSnapshot,
    timeZone: string
  ): PortfolioSnapshotItem {
    return {
      id: snapshot.id,
      equity: snapshot.equity,
      dayPnL: snapshot.dayPnL,
      netExposure: snapshot.netExposure ?? undefined,
      diversification: snapshot.diversification ?? undefined,
      assetAllocation: snapshot.assetAllocation ?? undefined,
      strategyMix: snapshot.strategyMix ?? undefined,
      riskPosture: snapshot.riskPosture ?? undefined,
      accountCurve: snapshot.accountCurve ?? undefined,
      monthlyPace: snapshot.monthlyPace ?? undefined,
      createdAt: this.formatDisplayTime(snapshot.createdAt, timeZone) || snapshot.createdAt.toISOString(),
      createdAtIso: this.formatRawIso(snapshot.createdAt) || undefined,
    };
  }

  private async requireHolding(userId: string, holdingId: string): Promise<PortfolioHoldingEntity> {
    const validatedHoldingId = validateHoldingId(holdingId);
    const holding = await this.portfolioRepository.getHoldingById(userId, validatedHoldingId);

    if (!holding) {
      throw new NotFoundAppError('Holding not found');
    }

    return holding;
  }

  private mapHolding(holding: PortfolioHoldingEntity, timeZone: string): PortfolioHolding {
    return {
      id: holding.id,
      symbol: holding.symbol,
      quantity: holding.quantity,
      marketValue: holding.marketValue,
      allocationPct: holding.allocationPct,
      dayPnL: holding.dayPnL,
      unrealizedPnL: holding.unrealizedPnL,
      side: holding.side as PortfolioHolding['side'],
      strategy: holding.strategy,
      riskState: holding.riskState as PortfolioHolding['riskState'],
      sleeve: holding.sleeve,
      contribution: holding.contribution ?? undefined,
      lastRebalanceAt: this.formatDisplayTime(holding.lastRebalanceAt, timeZone) || undefined,
      lastRebalanceAtIso: this.formatRawIso(holding.lastRebalanceAt) || undefined,
    };
  }
}
