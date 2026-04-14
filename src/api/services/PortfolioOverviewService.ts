import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  PortfolioActivityResponse,
  PortfolioOverviewResponse,
  PortfolioActiveFundsResponse,
  PortfolioCapitalResponse,
  PortfolioFuturesSummaryResponse,
  PortfolioOverviewContractEvolution,
  PortfolioOverviewMeta,
  PortfolioOverviewSectionAvailability,
  PortfolioOverviewSectionFreshness,
  PortfolioOverviewSectionKey,
  PortfolioOverviewSectionProvenance,
  PortfolioOpenPositionsResponse,
  PortfolioOverviewWarning,
} from '../contracts/PortfolioOverview';
import {
  PortfolioHolding,
  PortfolioHoldingsResponse,
  PortfolioPnLResponse,
  PortfolioSnapshotsResponse,
  PortfolioSummary,
} from '../contracts/Portfolio';
import { successResponse } from '../utils/response';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';
import { env } from '../../env';
import { PortfolioService } from './PortfolioService';
import { UserTimeZoneService } from './UserTimeZoneService';
import {
  PortfolioOverviewQuery,
  validatePortfolioOverviewQuery,
} from '../validators/portfolio.validator';

@Service()
export class PortfolioOverviewService {
  private readonly fundsSnapshotStaleAfterMs = 30 * 60 * 1000;
  private readonly fundsSnapshotCriticalAfterMs = 2 * 60 * 60 * 1000;
  private readonly legacySource = 'portfolio_overview_futures_legacy_alias' as const;

  @Inject(() => PortfolioService)
  private portfolioService!: PortfolioService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async getOverview(
    userId: string,
    query: PortfolioOverviewQuery
  ): Promise<ApiSuccessResponse<PortfolioOverviewResponse>> {
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const generatedAtIso = new Date().toISOString();
    const resolvedQuery = validatePortfolioOverviewQuery(query);
    const timeframe = resolvedQuery.timeframe;
    const holdingsLimit = String(resolvedQuery.holdingsLimit);

    const [futuresSummaryResponse, positionsResponse, capitalResponse, activityResponse] =
      await Promise.all([
        this.portfolioService.getFuturesSummary(userId),
        this.portfolioService.getOpenPositionsOverview(userId, {
          limit: holdingsLimit,
          offset: '0',
        }),
        this.portfolioService.getCapitalOverview(userId),
        this.portfolioService.getActivityOverview(userId, timeframe),
      ]);

    const futuresSummary = futuresSummaryResponse.data ?? futuresSummaryResponse;
    const positions = positionsResponse.data ?? positionsResponse;
    const capital = capitalResponse.data ?? capitalResponse;
    const activity = activityResponse.data ?? activityResponse;
    const pnl = activity.pnl;
    const performance = activity.performance;
    const activeFunds = this.buildLegacyActiveFundsAlias(capital);
    const summary = this.buildLegacySummaryAlias(futuresSummary, capital, positions, pnl, timeZone);
    const holdings = this.buildLegacyHoldingsAlias(positions, timeZone);
    const snapshots = this.buildLegacySnapshotsAlias(
      resolvedQuery.snapshotsLimit,
      resolvedQuery.snapshotsOffset,
      timeZone
    );

    const sections = this.buildSections({
      generatedAtIso,
      timeframe,
      futuresSummary,
      positions,
      capital,
      activity,
      timeZone,
    });
    const warnings = this.buildWarnings({
      sections,
      openPositions: positions.total,
    });
    const evolution: PortfolioOverviewContractEvolution = {
      currentModel: 'futures_only_workspace',
      targetModel: 'futures_only_workspace',
      legacySectionKeys: ['pnl', 'performance', 'summary', 'holdings', 'snapshots', 'activeFunds'],
      futuresSectionKeys: ['summary', 'positions', 'capital', 'activity'],
      deprecatedLegacySections: ['holdings', 'snapshots', 'activeFunds'],
    };
    const meta: PortfolioOverviewMeta = {
      contractVersion: 'portfolio-overview-phase7-futures-2026-04-14',
      purpose: 'operator_portfolio_workspace',
      generatedAt: this.formatDisplayTime(generatedAtIso, timeZone) || generatedAtIso,
      generatedAtIso,
      summary:
        'The `/portfolio/overview` contract is futures-first: summary, positions, capital, and activity hydrate from live capital routes, the positions read model, and closed-position activity. Legacy fields remain only as compatibility aliases or placeholders.',
      primaryPageRoute: '/portfolio',
      primaryEndpoint: '/portfolio/overview',
      pageHydration: 'single-request',
      query: {
        supported: ['timeframe', 'snapshotsLimit', 'snapshotsOffset', 'holdingsLimit'],
        unsupported: ['brokerKey', 'accountId'],
        resolved: {
          timeframe,
          snapshots: {
            limit: resolvedQuery.snapshotsLimit,
            offset: resolvedQuery.snapshotsOffset,
          },
          holdings: {
            limit: resolvedQuery.holdingsLimit,
            offset: 0,
            filterMode: 'loaded_overview_slice_client_side',
          },
        },
      },
      sources: {
        pnl: 'scheduler_positions_snapshots',
        performance: 'scheduler_positions_snapshots',
        summary: 'futures_summary compatibility alias',
        holdings: 'positions compatibility alias',
        snapshots: 'deprecated legacy placeholder',
        activeFunds: 'capital compatibility alias',
        futuresSummary: 'funds_snapshots_plus_position_read_models',
        positions: 'position_read_models',
        capital: 'funds_snapshots via broker_wallet_facade',
        activity: 'scheduler_positions_snapshots',
      },
      pageTruth: {
        storedPosture: 'futures_summary_from_live_routes',
        holdingsWorkspace: 'open_positions_from_connected_accounts',
        liveCapital: 'active_account_funds_snapshots',
        activity: 'closed_position_scheduler_snapshots',
        reconciliation: 'operator_review_with_futures_aliases',
        workspaceStructure: 'futures_summary_positions_capital_activity',
      },
      capabilities: {
        singleRequestHydration: true,
        explicitSectionProvenance: true,
        explicitSectionFreshness: true,
        holdingsIncludedInOverview: false,
        indexedSnapshotReads: false,
        activityReadModelAcceleration: true,
        portfolioHealthChecks: true,
        shareableWorkspaceState: true,
        rebalanceReviewWorkflow: true,
        workspaceReportGeneration: true,
        serverScopedHoldingsFiltersInOverview: false,
        routeScopedPerformanceFilters: false,
        routeScopedPnlFilters: false,
        liveSnapshotReconciliationPolicy: true,
        exportReport: true,
        futuresOverview: true,
        positionsIncludedInOverview: true,
        legacyFieldsAreCompatibilityAliases: true,
      },
      reconciliationPolicy: {
        mode: 'manual_workspace_review',
        holdingsSource: 'position_read_models',
        capitalSource: 'funds_snapshots via broker_wallet_facade',
        activitySource: 'scheduler_positions_snapshots',
        holdingsScope: 'connected_accounts_live_positions',
        driftAlertThresholdPct: 15,
        reviewTriggers: [
          'positions read-model freshness crosses stale or critical thresholds',
          'capital routes are missing, partial, or materially stale',
          'wallet versus futures capital differs by more than 15% of visible capital',
          'selected timeframe realized activity is negative',
        ],
        operatorActions: [
          'review capital routes before treating wallet collateral as deployable futures margin',
          'inspect open futures positions before using legacy holdings aliases for decision-making',
          'generate and export a workspace report from the same shareable state',
          'refresh the overview before acting when capital or positions are stale',
        ],
      },
      futuresReconciliationPolicy: {
        mode: 'manual_workspace_review',
        positionsSource: 'position_read_models',
        capitalSource: 'funds_snapshots via broker_wallet_facade',
        activitySource: 'scheduler_positions_snapshots',
        positionsScope: 'connected_accounts_live_positions',
        driftAlertThresholdPct: 15,
        reviewTriggers: [
          'positions read-model freshness crosses stale or critical thresholds',
          'capital routes are missing, partial, or materially stale',
          'wallet versus futures capital differs by more than 15% of visible capital',
          'selected timeframe realized activity is negative',
        ],
        operatorActions: [
          'review capital routes before treating wallet collateral as deployable futures margin',
          'inspect open futures positions before changing exposure',
          'generate and export a workspace report from the same shareable state',
          'refresh the overview before acting when capital or positions are stale',
        ],
      },
      evolution,
      warnings,
      sections,
      time: buildApiTimeContract(timeZone),
    };

    return successResponse({
      meta,
      pnl,
      performance,
      summary,
      holdings,
      snapshots,
      activeFunds,
      futuresSummary,
      positions,
      capital,
      activity,
      time: buildApiTimeContract(timeZone),
    });
  }

  private buildLegacyActiveFundsAlias(
    capital: PortfolioCapitalResponse
  ): PortfolioActiveFundsResponse {
    return {
      source: capital.source,
      definition:
        'Deprecated alias for capital routes. Use `capital` for wallet and futures route totals in the futures-only portfolio workspace.',
      freshnessModel: capital.freshnessModel,
      latestObservedAt: capital.latestObservedAt,
      latestObservedAtIso: capital.latestObservedAtIso,
      oldestObservedAt: capital.oldestObservedAt,
      oldestObservedAtIso: capital.oldestObservedAtIso,
      walletItems: capital.walletItems,
      futuresItems: capital.futuresItems,
      time: capital.time,
    };
  }

  private buildLegacySummaryAlias(
    futuresSummary: PortfolioFuturesSummaryResponse,
    capital: PortfolioCapitalResponse,
    positions: PortfolioOpenPositionsResponse,
    pnl: PortfolioPnLResponse,
    timeZone: string
  ): PortfolioSummary {
    const totalEquity =
      this.toNumber(futuresSummary.futuresEquity) + this.toNumber(futuresSummary.walletCollateral);
    const largestPosition = [...(positions.items || [])].sort((left, right) => {
      return this.toNumber(right.exposure) - this.toNumber(left.exposure);
    })[0] || null;
    const allocationPct =
      largestPosition && this.toNumber(futuresSummary.grossExposure) > 0
        ? (this.toNumber(largestPosition.exposure) / this.toNumber(futuresSummary.grossExposure)) * 100
        : null;

    return {
      equity: totalEquity,
      dayPnL: this.toNumber(pnl.dailyPnL),
      netExposure:
        this.toNumber(futuresSummary.grossExposure) > 0
          ? this.formatCurrency(this.toNumber(futuresSummary.grossExposure))
          : '--',
      diversification:
        positions.total > 0
          ? `${positions.total} live position${positions.total === 1 ? '' : 's'}`
          : 'No open futures positions',
      source: this.legacySource,
      observedAt: futuresSummary.observedAt || null,
      observedAtIso: futuresSummary.observedAtIso || null,
      definition:
        'Deprecated legacy summary alias synthesized from futures capital, open positions, and realized activity.',
      portfolioValue: this.formatCurrency(totalEquity),
      netPnl: this.formatSignedCurrency(this.toNumber(pnl.dailyPnL)),
      holdings: positions.total,
      largestWeight:
        allocationPct !== null ? `${allocationPct.toFixed(1)}%` : '--',
      largestWeightLabel: largestPosition?.symbol || '--',
      assetAllocation: 'Futures capital routes',
      strategyMix: 'Live futures positions',
      riskPosture:
        positions.total > 0
          ? 'Live futures posture'
          : 'Capital-only posture',
      accountCurve: 'Use activity series',
      monthlyPace: this.formatSignedCurrency(this.toNumber(pnl.monthlyPnL)),
      time: buildApiTimeContract(timeZone),
    };
  }

  private buildLegacyHoldingsAlias(
    positions: PortfolioOpenPositionsResponse,
    timeZone: string
  ): PortfolioHoldingsResponse {
    const totalExposure = (positions.items || []).reduce(
      (sum, item) => sum + this.toNumber(item.exposure),
      0
    );
    const items: PortfolioHolding[] = (positions.items || []).map((item) => ({
      id: item.id,
      symbol: item.symbol || '--',
      quantity: this.toNumber(item.quantity),
      marketValue: this.toNumber(item.exposure),
      allocationPct:
        totalExposure > 0 ? (this.toNumber(item.exposure) / totalExposure) * 100 : 0,
      dayPnL: this.toNumber(item.unrealizedPnl),
      unrealizedPnL: this.toNumber(item.unrealizedPnl),
      side: item.side === 'Short' ? 'Short' : 'Long',
      strategy: item.accountName || item.brokerKey || 'Live futures route',
      riskState: this.mapLegacyRiskState(item.freshness?.state),
      sleeve: item.brokerKey || 'Futures',
      contribution: item.accountName || undefined,
      lastRebalanceAt: item.observedAt || undefined,
      lastRebalanceAtIso: item.observedAtIso || undefined,
    }));

    return {
      items,
      total: positions.total,
      limit: positions.limit,
      offset: positions.offset,
      source: this.legacySource,
      observedAt: positions.observedAt || null,
      observedAtIso: positions.observedAtIso || null,
      definition:
        'Deprecated legacy holdings alias synthesized from open futures positions. Use `positions` for the live futures workspace.',
      time: buildApiTimeContract(timeZone),
    };
  }

  private buildLegacySnapshotsAlias(
    limit: number,
    offset: number,
    timeZone: string
  ): PortfolioSnapshotsResponse {
    return {
      items: [],
      total: 0,
      limit,
      offset,
      source: this.legacySource,
      observedAt: null,
      observedAtIso: null,
      definition:
        'Deprecated legacy placeholder. Stored portfolio snapshot history is retired from the futures-only overview.',
      time: buildApiTimeContract(timeZone),
    };
  }

  private buildSections(input: {
    generatedAtIso: string;
    timeframe: 'daily' | 'weekly' | 'monthly';
    futuresSummary: PortfolioFuturesSummaryResponse;
    positions: PortfolioOpenPositionsResponse;
    capital: PortfolioCapitalResponse;
    activity: PortfolioActivityResponse;
    timeZone: string;
  }): Record<PortfolioOverviewSectionKey, PortfolioOverviewSectionProvenance> {
    const capitalObservedAt =
      this.toIsoString(input.capital.oldestObservedAtIso) ||
      this.toIsoString(input.capital.oldestObservedAt) ||
      this.toIsoString(input.capital.latestObservedAtIso) ||
      this.toIsoString(input.capital.latestObservedAt);
    const positionsObservedAt =
      this.toIsoString(input.positions.oldestObservedAtIso) ||
      this.toIsoString(input.positions.oldestObservedAt) ||
      this.toIsoString(input.positions.latestObservedAtIso) ||
      this.toIsoString(input.positions.latestObservedAt);
    const activityObservedAt =
      this.toIsoString(input.activity.observedAtIso) ||
      this.toIsoString(input.activity.observedAt);
    const capitalHasError = this.hasCapitalError(input.capital);
    const capitalAvailability = this.resolveCapitalAvailability(input.capital, capitalHasError);
    const positionsAvailability = this.resolvePositionsAvailability(input.positions);
    const capitalFreshness = this.buildFreshness(
      capitalObservedAt,
      this.fundsSnapshotStaleAfterMs,
      this.fundsSnapshotCriticalAfterMs
    );
    const positionsFreshness = this.buildFreshness(
      positionsObservedAt,
      env.positions.liveSnapshotStaleAfterMs,
      env.positions.liveSnapshotCriticalAfterMs
    );
    const summaryObservedAt = this.pickOldestTimestamp([
      capitalObservedAt,
      input.positions.total > 0 ? positionsObservedAt : null,
    ]);
    const summaryFreshness = this.buildSummaryFreshness(
      capitalFreshness,
      positionsFreshness,
      input.positions.total
    );

    return {
      summary: this.createSection({
        source: 'funds_snapshots_plus_position_read_models',
        sourceLabel: 'Futures capital and exposure summary',
        availability:
          capitalAvailability === 'missing' && input.positions.total > 0 && positionsAvailability === 'missing'
            ? 'missing'
            : capitalAvailability === 'partial' || positionsAvailability === 'partial'
              ? 'partial'
              : 'available',
        observedAt: this.formatDisplayTime(summaryObservedAt, input.timeZone),
        observedAtIso: summaryObservedAt,
        freshnessModel: 'mixed_futures_state',
        freshness: summaryFreshness,
        definition: input.futuresSummary.definition,
        note:
          'Summary is synthesized from capital routes and live open-position exposure. Stored portfolio snapshots are no longer part of this endpoint truth model.',
      }),
      positions: this.createSection({
        source: 'position_read_models',
        sourceLabel: 'Open futures positions',
        availability: positionsAvailability,
        observedAt: this.formatDisplayTime(positionsObservedAt, input.timeZone),
        observedAtIso: positionsObservedAt,
        freshnessModel: 'position_read_model_timestamp',
        freshness: positionsFreshness,
        definition:
          input.positions.definition ||
          'Open futures positions across connected accounts, normalized from the positions read model.',
        note:
          input.positions.total > 0
            ? 'Open positions are live-read-model based and should be treated as the portfolio desk posture.'
            : 'No open futures positions are visible on connected accounts right now.',
      }),
      capital: this.createSection({
        source: 'funds_snapshots via broker_wallet_facade',
        sourceLabel: 'Capital routes',
        availability: capitalAvailability,
        observedAt: this.formatDisplayTime(capitalObservedAt, input.timeZone),
        observedAtIso: capitalObservedAt,
        freshnessModel: 'funds_snapshot_timestamp',
        freshness: capitalFreshness,
        definition: input.capital.definition,
        note: capitalHasError
          ? 'One or more connected accounts are missing capital-route rows; inspect account-level route coverage before trusting totals.'
          : 'Wallet routes are secondary collateral context and futures routes are the primary live capital surface.',
      }),
      activity: this.createSection({
        source: 'scheduler_positions_snapshots',
        sourceLabel: 'Closed-position activity',
        availability: 'available',
        observedAt: this.formatDisplayTime(activityObservedAt, input.timeZone),
        observedAtIso: activityObservedAt,
        freshnessModel: 'windowed_activity',
        freshness: this.buildFreshness(activityObservedAt, null, null),
        definition: input.activity.definition,
        note: `Activity reflects ${input.timeframe} realized closed-position buckets, not live mark-to-market equity.`,
      }),
      holdings: this.createSection({
        source: 'position_read_models',
        sourceLabel: 'Legacy holdings alias',
        availability: positionsAvailability,
        observedAt: this.formatDisplayTime(positionsObservedAt, input.timeZone),
        observedAtIso: positionsObservedAt,
        freshnessModel: 'position_read_model_timestamp',
        freshness: positionsFreshness,
        definition:
          'Deprecated alias that maps open futures positions into the old holdings shape for compatibility.',
        note:
          'Use `positions` instead. This alias exists only to bridge older portfolio consumers during the futures migration.',
      }),
      snapshots: this.createSection({
        source: 'deprecated legacy placeholder',
        sourceLabel: 'Legacy snapshot history placeholder',
        availability: 'missing',
        observedAt: null,
        observedAtIso: null,
        freshnessModel: 'snapshot_timestamp',
        freshness: this.buildFreshness(null, null, null),
        definition:
          'Deprecated placeholder. Stored portfolio snapshot history is not part of the futures-only portfolio overview.',
        note:
          'Use capital, positions, and activity as the futures truth surfaces. This placeholder remains only to avoid breaking older consumers during migration.',
      }),
      activeFunds: this.createSection({
        source: 'funds_snapshots via broker_wallet_facade',
        sourceLabel: 'Legacy capital alias',
        availability: capitalAvailability,
        observedAt: this.formatDisplayTime(capitalObservedAt, input.timeZone),
        observedAtIso: capitalObservedAt,
        freshnessModel: 'funds_snapshot_timestamp',
        freshness: capitalFreshness,
        definition:
          'Deprecated alias for capital routes. Use `capital` for the futures-first funds surface.',
        note:
          'This alias remains for compatibility only. Wallet and futures route totals now live under `capital`.',
      }),
      pnl: this.createSection({
        source: 'scheduler_positions_snapshots',
        sourceLabel: 'Legacy realized PnL alias',
        availability: 'available',
        observedAt: this.formatDisplayTime(activityObservedAt, input.timeZone),
        observedAtIso: activityObservedAt,
        freshnessModel: 'windowed_activity',
        freshness: this.buildFreshness(activityObservedAt, null, null),
        definition:
          'Deprecated alias for the realized PnL slice of `activity`.',
        note:
          'Use `activity.pnl` for realized windows in the futures-only overview.',
      }),
      performance: this.createSection({
        source: 'scheduler_positions_snapshots',
        sourceLabel: 'Legacy performance alias',
        availability: 'available',
        observedAt: this.formatDisplayTime(activityObservedAt, input.timeZone),
        observedAtIso: activityObservedAt,
        freshnessModel: 'windowed_activity',
        freshness: this.buildFreshness(activityObservedAt, null, null),
        definition:
          'Deprecated alias for the performance slice of `activity`.',
        note:
          'Use `activity.performance` for realized closed-position series in the futures-only overview.',
      }),
    };
  }

  private createSection(
    section: PortfolioOverviewSectionProvenance
  ): PortfolioOverviewSectionProvenance {
    return section;
  }

  private buildWarnings(input: {
    sections: Record<PortfolioOverviewSectionKey, PortfolioOverviewSectionProvenance>;
    openPositions: number;
  }): PortfolioOverviewWarning[] {
    const sections = input.sections;
    const warnings: PortfolioOverviewWarning[] = [];

    if (sections.capital.availability === 'missing') {
      warnings.push({
        code: 'funds_snapshot_missing',
        tone: 'danger',
        section: 'capital',
        summary: 'Capital routes are unavailable for the futures workspace.',
        detail:
          'Wallet and futures route rows could not be assembled for connected accounts from the current capital route surface.',
      });
    } else if (
      sections.capital.availability === 'partial' ||
      sections.capital.freshness?.state === 'critical'
    ) {
      warnings.push({
        code: 'funds_snapshot_attention',
        tone: sections.capital.freshness?.state === 'critical' ? 'danger' : 'warning',
        section: 'capital',
        summary:
          sections.capital.availability === 'partial'
            ? 'Capital routes need attention because some connected accounts are missing route coverage.'
            : 'Capital routes are critically stale.',
        detail: sections.capital.note,
      });
    } else if (sections.capital.freshness?.state === 'stale') {
      warnings.push({
        code: 'funds_snapshot_attention',
        tone: 'warning',
        section: 'capital',
        summary: 'Capital routes are getting stale.',
        detail: sections.capital.note,
      });
    }

    if (input.openPositions > 0 && sections.positions.availability === 'missing') {
      warnings.push({
        code: 'positions_snapshot_missing',
        tone: 'danger',
        section: 'positions',
        summary: 'Open position coverage is unavailable for the futures workspace.',
        detail:
          'The positions read model is not returning live open positions even though connected routes are expected to contribute positions.',
      });
    } else if (
      input.openPositions > 0 &&
      (sections.positions.availability === 'partial' ||
        sections.positions.freshness?.state === 'critical')
    ) {
      warnings.push({
        code: 'positions_snapshot_attention',
        tone: sections.positions.freshness?.state === 'critical' ? 'danger' : 'warning',
        section: 'positions',
        summary:
          sections.positions.availability === 'partial'
            ? 'Open position coverage is partial and should be reviewed before trusting live posture.'
            : 'Open positions are critically stale.',
        detail: sections.positions.note,
      });
    } else if (input.openPositions > 0 && sections.positions.freshness?.state === 'stale') {
      warnings.push({
        code: 'positions_snapshot_attention',
        tone: 'warning',
        section: 'positions',
        summary: 'Open positions are getting stale.',
        detail: sections.positions.note,
      });
    }

    if (sections.summary.freshness?.state === 'critical') {
      warnings.push({
        code: 'futures_summary_attention',
        tone: 'danger',
        section: 'summary',
        summary: 'The futures summary is critically stale or incomplete.',
        detail: sections.summary.note,
      });
    } else if (sections.summary.freshness?.state === 'stale') {
      warnings.push({
        code: 'futures_summary_attention',
        tone: 'warning',
        section: 'summary',
        summary: 'The futures summary is getting stale.',
        detail: sections.summary.note,
      });
    }

    return warnings;
  }

  private resolveCapitalAvailability(
    capital: PortfolioCapitalResponse,
    hasError: boolean
  ): PortfolioOverviewSectionAvailability {
    const allItems = [...(capital.walletItems || []), ...(capital.futuresItems || [])];

    if (!allItems.length) {
      return 'missing';
    }

    const observedCount = allItems.filter((item) => Boolean(item?.observedAt)).length;

    if (!observedCount) {
      return 'missing';
    }

    if (hasError || observedCount < allItems.length) {
      return 'partial';
    }

    return 'available';
  }

  private resolvePositionsAvailability(
    positions: PortfolioOpenPositionsResponse
  ): PortfolioOverviewSectionAvailability {
    if (positions.total === 0) {
      return 'available';
    }
    if (!(positions.items || []).length) {
      return 'missing';
    }
    if ((positions.items || []).length < positions.total) {
      return 'partial';
    }
    return 'available';
  }

  private hasCapitalError(capital: PortfolioCapitalResponse): boolean {
    return [...(capital.walletItems || []), ...(capital.futuresItems || [])].some((item) =>
      Boolean(item.error)
    );
  }

  private buildSummaryFreshness(
    capitalFreshness: PortfolioOverviewSectionFreshness | null,
    positionsFreshness: PortfolioOverviewSectionFreshness | null,
    openPositions: number
  ): PortfolioOverviewSectionFreshness | null {
    const activeFreshness = [
      capitalFreshness,
      openPositions > 0 ? positionsFreshness : null,
    ].filter(Boolean) as PortfolioOverviewSectionFreshness[];

    if (!activeFreshness.length) {
      return this.buildFreshness(null, null, null);
    }

    const state = activeFreshness.some((item) => item.state === 'critical')
      ? 'critical'
      : activeFreshness.some((item) => item.state === 'stale')
        ? 'stale'
        : activeFreshness.every((item) => item.state === 'fresh')
          ? 'fresh'
          : 'unknown';

    return {
      state,
      freshnessMs: Math.max(...activeFreshness.map((item) => item.freshnessMs || 0)),
      staleAfterMs: Math.min(
        ...activeFreshness
          .map((item) => item.staleAfterMs)
          .filter((value): value is number => value !== null)
      ),
      criticalAfterMs: Math.min(
        ...activeFreshness
          .map((item) => item.criticalAfterMs)
          .filter((value): value is number => value !== null)
      ),
    };
  }

  private buildFreshness(
    observedAt: string | null,
    staleAfterMs: number | null,
    criticalAfterMs: number | null
  ): PortfolioOverviewSectionFreshness | null {
    const observedTime = this.toTimestamp(observedAt);
    const freshnessMs =
      observedTime === null ? null : Math.max(0, Date.now() - observedTime);
    const state =
      observedTime === null
        ? 'unknown'
        : criticalAfterMs !== null && freshnessMs !== null && freshnessMs > criticalAfterMs
          ? 'critical'
          : staleAfterMs !== null && freshnessMs !== null && freshnessMs > staleAfterMs
            ? 'stale'
            : staleAfterMs === null && criticalAfterMs === null
              ? 'unknown'
              : 'fresh';

    return {
      state,
      freshnessMs,
      staleAfterMs,
      criticalAfterMs,
    };
  }

  private pickLatestTimestamp(values: Array<string | null | undefined>): string | null {
    const timestamps = values
      .map((value) => this.toTimestamp(value))
      .filter((value): value is number => value !== null)
      .sort((left, right) => right - left);

    return timestamps.length ? new Date(timestamps[0]).toISOString() : null;
  }

  private pickOldestTimestamp(values: Array<string | null | undefined>): string | null {
    const timestamps = values
      .map((value) => this.toTimestamp(value))
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);

    return timestamps.length ? new Date(timestamps[0]).toISOString() : null;
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

  private toIsoString(value: unknown): string | null {
    return this.formatRawIso(
      typeof value === 'string' || value instanceof Date ? value : null
    );
  }

  private toTimestamp(value: unknown): number | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    const timestamp = date.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private toNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private mapLegacyRiskState(
    state: PortfolioOverviewSectionFreshness['state'] | undefined
  ): PortfolioHolding['riskState'] {
    if (state === 'critical') {
      return 'At risk';
    }
    if (state === 'stale') {
      return 'Watch';
    }
    return 'Healthy';
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  }

  private formatSignedCurrency(value: number): string {
    if (value > 0) {
      return `+${this.formatCurrency(Math.abs(value))}`;
    }
    if (value < 0) {
      return `-${this.formatCurrency(Math.abs(value))}`;
    }
    return this.formatCurrency(0);
  }
}
