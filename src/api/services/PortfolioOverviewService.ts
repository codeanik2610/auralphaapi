import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  PortfolioOverviewResponse,
  PortfolioActiveFundsResponse,
  PortfolioOverviewMeta,
  PortfolioOverviewSectionAvailability,
  PortfolioOverviewSectionFreshness,
  PortfolioOverviewSectionKey,
  PortfolioOverviewSectionProvenance,
  PortfolioOverviewWarning,
} from '../contracts/PortfolioOverview';
import { successResponse } from '../utils/response';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';
import { BrokerWalletFacadeService } from './BrokerWalletFacadeService';
import { PortfolioService } from './PortfolioService';
import { UserTimeZoneService } from './UserTimeZoneService';
import {
  PortfolioOverviewQuery,
  validatePortfolioOverviewQuery,
} from '../validators/portfolio.validator';

@Service()
export class PortfolioOverviewService {
  private readonly portfolioSnapshotStaleAfterMs = 6 * 60 * 60 * 1000;
  private readonly portfolioSnapshotCriticalAfterMs = 24 * 60 * 60 * 1000;
  private readonly fundsSnapshotStaleAfterMs = 30 * 60 * 1000;
  private readonly fundsSnapshotCriticalAfterMs = 2 * 60 * 60 * 1000;

  @Inject(() => PortfolioService)
  private portfolioService!: PortfolioService;

  @Inject(() => BrokerWalletFacadeService)
  private brokerWalletFacadeService!: BrokerWalletFacadeService;

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
    const snapshotsLimit = String(resolvedQuery.snapshotsLimit);
    const snapshotsOffset = String(resolvedQuery.snapshotsOffset);
    const holdingsLimit = String(resolvedQuery.holdingsLimit);

    const [
      pnlResponse,
      performanceResponse,
      summaryResponse,
      holdingsResponse,
      snapshotsResponse,
      walletFundsResponse,
      futuresFundsResponse,
    ] = await Promise.all([
      this.portfolioService.getPortfolioPnL(userId),
      this.portfolioService.getPortfolioPerformance(userId, timeframe),
      this.portfolioService.getPortfolioSummary(userId),
      this.portfolioService.getPortfolioHoldings(userId, {
        limit: holdingsLimit,
        offset: '0',
      }),
      this.portfolioService.getPortfolioSnapshots(userId, {
        limit: snapshotsLimit,
        offset: snapshotsOffset,
      }),
      this.brokerWalletFacadeService.getWalletFundsForActiveAccounts(userId),
      this.brokerWalletFacadeService.getFuturesFundsForActiveAccounts(userId),
    ]);

    const pnl = pnlResponse.data ?? pnlResponse;
    const performance = performanceResponse.data ?? performanceResponse;
    const summary = summaryResponse.data ?? summaryResponse;
    const holdings = holdingsResponse.data ?? holdingsResponse;
    const snapshots = snapshotsResponse.data ?? snapshotsResponse;
    const walletItems = this.normalizeFundsPayload(walletFundsResponse, timeZone);
    const futuresItems = this.normalizeFundsPayload(futuresFundsResponse, timeZone);
    const latestObservedAtIso = this.pickLatestTimestamp([
      ...walletItems.map((item) => item.observedAtIso || item.observedAt || null),
      ...futuresItems.map((item) => item.observedAtIso || item.observedAt || null),
    ]);
    const oldestObservedAtIso = this.pickOldestTimestamp([
      ...walletItems.map((item) => item.observedAtIso || item.observedAt || null),
      ...futuresItems.map((item) => item.observedAtIso || item.observedAt || null),
    ]);

    const activeFunds: PortfolioActiveFundsResponse = {
      source: 'funds_snapshots via broker_wallet_facade',
      definition:
        'Latest stored funds snapshot per connected account, normalized for wallet and futures capital review.',
      freshnessModel: 'funds_snapshot_timestamp',
      walletItems,
      futuresItems,
      latestObservedAt: this.formatDisplayTime(latestObservedAtIso, timeZone),
      latestObservedAtIso,
      oldestObservedAt: this.formatDisplayTime(oldestObservedAtIso, timeZone),
      oldestObservedAtIso,
      time: buildApiTimeContract(timeZone),
    };

    const sections = this.buildSections({
      generatedAtIso,
      timeframe,
      summary,
      holdings,
      snapshots,
      pnl,
      performance,
      activeFunds,
      timeZone,
    });
    const warnings = this.buildWarnings(sections);
    const meta: PortfolioOverviewMeta = {
      contractVersion: 'portfolio-overview-phase6-2026-04-10',
      purpose: 'operator_portfolio_workspace',
      generatedAt: this.formatDisplayTime(generatedAtIso, timeZone) || generatedAtIso,
      generatedAtIso,
      summary:
        'The `/portfolio/overview` contract is trust-aware, uses indexed snapshot reads plus read-model-backed activity queries, and now declares the manual reconciliation/reporting workflow available from the portfolio workspace.',
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
        summary: 'portfolio_snapshots',
        holdings: 'portfolio_snapshots',
        snapshots: 'portfolio_snapshots',
        activeFunds: 'funds_snapshots via broker_wallet_facade',
      },
      pageTruth: {
        storedPosture: 'latest_portfolio_snapshot',
        holdingsWorkspace: 'ranked_overview_slice_from_latest_snapshot',
        liveCapital: 'active_account_funds_snapshots',
        activity: 'closed_position_scheduler_snapshots',
        reconciliation: 'operator_review_without_auto_reconciliation',
        workspaceStructure: 'trust_posture_holdings_capital_activity_snapshots',
      },
      capabilities: {
        singleRequestHydration: true,
        explicitSectionProvenance: true,
        explicitSectionFreshness: true,
        holdingsIncludedInOverview: true,
        indexedSnapshotReads: true,
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
      },
      reconciliationPolicy: {
        mode: 'manual_workspace_review',
        holdingsSource: 'portfolio_snapshots',
        capitalSource: 'funds_snapshots via broker_wallet_facade',
        activitySource: 'scheduler_positions_snapshots',
        holdingsScope: 'loaded_overview_slice_client_side',
        driftAlertThresholdPct: 15,
        reviewTriggers: [
          'largest holding concentration above 40% of the loaded snapshot slice',
          'at-risk holdings present in the loaded snapshot slice',
          'wallet versus futures capital differs by more than 15% of visible capital',
          'selected timeframe realized activity is negative'
        ],
        operatorActions: [
          'generate a manual rebalance review from the current workspace state',
          'generate and export a workspace report from the same shareable state',
          'inspect the selected holding before changing allocations',
          'refresh the overview before acting when any section is stale'
        ],
      },
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
      time: buildApiTimeContract(timeZone),
    });
  }

  private normalizeFundsPayload(
    payload: unknown,
    timeZone: string
  ): PortfolioActiveFundsResponse['walletItems'] {
    const raw = payload as { items?: unknown[]; data?: { items?: unknown[] } };
    const items =
      (Array.isArray(raw?.items) && raw.items) ||
      (Array.isArray(raw?.data?.items) && raw.data?.items) ||
      (Array.isArray(raw) ? raw : []);

    return items.map((item) => this.normalizeFundsItem(item, timeZone));
  }

  private normalizeFundsItem(item: unknown, timeZone: string) {
    const safe = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
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
      safe.observedAt || safe.observed_at ? this.toIsoString(safe.observedAt || safe.observed_at) : null;
    const funds = rawFunds as Record<string, unknown>;
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
        balance: this.toNumber(
          funds.balance ??
            funds.total ??
            funds.equity ??
            funds.wallet_balance ??
            funds.futures_equity ??
            funds.margin_balance
        ),
        available: this.toNumber(
          funds.available_balance ??
            funds.withdrawable ??
            funds.free ??
            funds.available ??
            funds.free_balance
        ),
        invested: this.toNumber(
          funds.invested ??
            funds.locked_amount ??
            funds.used_margin ??
            funds.margin_used
        ),
      },
    };
  }

  private buildSections(input: {
    generatedAtIso: string;
    timeframe: 'daily' | 'weekly' | 'monthly';
    summary: any;
    holdings: any;
    snapshots: any;
    pnl: any;
    performance: any;
    activeFunds: PortfolioActiveFundsResponse;
    timeZone: string;
  }): Record<PortfolioOverviewSectionKey, PortfolioOverviewSectionProvenance> {
    const summaryObservedAt =
      this.toIsoString(input.summary?.observedAtIso) || this.toIsoString(input.summary?.observedAt);
    const holdingsObservedAt =
      this.toIsoString(input.holdings?.observedAtIso) || this.toIsoString(input.holdings?.observedAt);
    const snapshotsObservedAt =
      this.toIsoString(input.snapshots?.observedAtIso) ||
      this.toIsoString(input.snapshots?.observedAt) ||
      this.toIsoString(input.snapshots?.items?.[0]?.createdAtIso) ||
      this.toIsoString(input.snapshots?.items?.[0]?.createdAt);
    const pnlObservedAt =
      this.toIsoString(input.pnl?.observedAtIso) || this.toIsoString(input.pnl?.observedAt);
    const performanceObservedAt =
      this.toIsoString(input.performance?.observedAtIso) ||
      this.toIsoString(input.performance?.observedAt);
    const activeFundsObservedAt =
      this.toIsoString(input.activeFunds.oldestObservedAtIso) ||
      this.toIsoString(input.activeFunds.oldestObservedAt) ||
      this.toIsoString(input.activeFunds.latestObservedAtIso) ||
      this.toIsoString(input.activeFunds.latestObservedAt);
    const activeFundsHasError = [
      ...(input.activeFunds.walletItems || []),
      ...(input.activeFunds.futuresItems || []),
    ].some((item) => Boolean(item?.error));

    return {
      summary: this.createSection({
        source: 'portfolio_snapshots',
        sourceLabel: 'Latest stored portfolio snapshot summary',
        availability: summaryObservedAt ? 'available' : 'missing',
        observedAt: this.formatDisplayTime(summaryObservedAt, input.timeZone),
        observedAtIso: summaryObservedAt,
        freshnessModel: 'snapshot_timestamp',
        freshness: this.buildFreshness(
          summaryObservedAt,
          this.portfolioSnapshotStaleAfterMs,
          this.portfolioSnapshotCriticalAfterMs
        ),
        definition:
          input.summary?.definition || 'Latest stored portfolio snapshot summary.',
        note: summaryObservedAt
          ? 'Book posture is snapshot-backed and does not auto-reconcile to current broker balances.'
          : 'No stored portfolio snapshot is available yet, so stored posture is unavailable.',
      }),
      holdings: this.createSection({
        source: 'portfolio_snapshots',
        sourceLabel: 'Latest stored holdings snapshot',
        availability: holdingsObservedAt ? 'available' : 'missing',
        observedAt: this.formatDisplayTime(holdingsObservedAt, input.timeZone),
        observedAtIso: holdingsObservedAt,
        freshnessModel: 'snapshot_timestamp',
        freshness: this.buildFreshness(
          holdingsObservedAt,
          this.portfolioSnapshotStaleAfterMs,
          this.portfolioSnapshotCriticalAfterMs
        ),
        definition:
          input.holdings?.definition ||
          'Largest holdings ordered by market value from the latest stored portfolio snapshot.',
        note:
          'Search and focus on `/portfolio` apply to the loaded overview slice only; they do not change the stored backend snapshot.',
      }),
      snapshots: this.createSection({
        source: 'portfolio_snapshots',
        sourceLabel: 'Stored portfolio snapshot history',
        availability: Array.isArray(input.snapshots?.items) && input.snapshots.items.length ? 'available' : 'missing',
        observedAt: this.formatDisplayTime(snapshotsObservedAt, input.timeZone),
        observedAtIso: snapshotsObservedAt,
        freshnessModel: 'snapshot_timestamp',
        freshness: this.buildFreshness(
          snapshotsObservedAt,
          this.portfolioSnapshotStaleAfterMs,
          this.portfolioSnapshotCriticalAfterMs
        ),
        definition:
          input.snapshots?.definition ||
          'Stored portfolio snapshot history ordered from newest to oldest capture.',
        note: 'Snapshot history is an audit trail of stored posture, not a live balance feed.',
      }),
      activeFunds: this.createSection({
        source: 'funds_snapshots via broker_wallet_facade',
        sourceLabel: 'Latest per-account funds snapshots',
        availability: this.resolveActiveFundsAvailability(input.activeFunds, activeFundsHasError),
        observedAt: this.formatDisplayTime(activeFundsObservedAt, input.timeZone),
        observedAtIso: activeFundsObservedAt,
        freshnessModel: 'funds_snapshot_timestamp',
        freshness: this.buildFreshness(
          activeFundsObservedAt,
          this.fundsSnapshotStaleAfterMs,
          this.fundsSnapshotCriticalAfterMs
        ),
        definition: input.activeFunds.definition,
        note: activeFundsHasError
          ? 'One or more connected accounts are missing funds snapshots; inspect route rows before trusting totals.'
          : 'Live capital review is still snapshot-backed per connected account, not broker-streaming in real time.',
      }),
      pnl: this.createSection({
        source: 'scheduler_positions_snapshots',
        sourceLabel: 'Closed-position realized PnL windows',
        availability: 'available',
        observedAt: this.formatDisplayTime(pnlObservedAt, input.timeZone),
        observedAtIso: pnlObservedAt,
        freshnessModel: 'windowed_activity',
        freshness: this.buildFreshness(pnlObservedAt, null, null),
        definition:
          input.pnl?.definition ||
          'Realized PnL aggregated from closed-position scheduler snapshots across active accounts.',
        note:
          'Realized PnL is window-based activity. A missing recent event means there may have been no closed positions, not that the section failed.',
      }),
      performance: this.createSection({
        source: 'scheduler_positions_snapshots',
        sourceLabel: 'Closed-position activity series',
        availability: 'available',
        observedAt: this.formatDisplayTime(performanceObservedAt, input.timeZone),
        observedAtIso: performanceObservedAt,
        freshnessModel: 'windowed_activity',
        freshness: this.buildFreshness(performanceObservedAt, null, null),
        definition:
          input.performance?.definition ||
          'Closed-position activity aggregated from scheduler snapshots for the selected portfolio timeframe.',
        note: `Performance reflects ${input.timeframe} realized activity buckets, not live account equity.`,
      }),
    };
  }

  private createSection(
    section: PortfolioOverviewSectionProvenance
  ): PortfolioOverviewSectionProvenance {
    return section;
  }

  private buildWarnings(
    sections: Record<PortfolioOverviewSectionKey, PortfolioOverviewSectionProvenance>
  ): PortfolioOverviewWarning[] {
    const warnings: PortfolioOverviewWarning[] = [];

    if (sections.summary.availability === 'missing') {
      warnings.push({
        code: 'stored_snapshot_missing',
        tone: 'danger',
        section: 'summary',
        summary: 'Stored portfolio posture is unavailable because no snapshot has been captured yet.',
        detail:
          'Book posture, holdings, and stored snapshot history depend on portfolio snapshot ingestion. Capture a snapshot before using `/portfolio` as the stored book source.',
      });
    } else if (sections.summary.freshness?.state === 'critical' || sections.holdings.freshness?.state === 'critical') {
      warnings.push({
        code: 'stored_snapshot_stale',
        tone: 'danger',
        section: 'summary',
        summary: 'Stored portfolio posture is critically stale.',
        detail:
          'The latest stored portfolio snapshot is older than the critical freshness threshold, so posture and holdings may not reflect current allocation.',
      });
    } else if (sections.summary.freshness?.state === 'stale' || sections.holdings.freshness?.state === 'stale') {
      warnings.push({
        code: 'stored_snapshot_stale',
        tone: 'warning',
        section: 'summary',
        summary: 'Stored portfolio posture is getting stale.',
        detail:
          'The latest portfolio snapshot is older than the stale freshness threshold, so posture and holdings should be reviewed with care.',
      });
    }

    if (sections.activeFunds.availability === 'missing') {
      warnings.push({
        code: 'funds_snapshot_missing',
        tone: 'danger',
        section: 'activeFunds',
        summary: 'Connected account funds snapshots are unavailable.',
        detail:
          'Wallet and futures capital routes could not be assembled from stored funds snapshots for the connected accounts.',
      });
    } else if (
      sections.activeFunds.availability === 'partial' ||
      sections.activeFunds.freshness?.state === 'critical'
    ) {
      warnings.push({
        code: 'funds_snapshot_attention',
        tone: sections.activeFunds.freshness?.state === 'critical' ? 'danger' : 'warning',
        section: 'activeFunds',
        summary:
          sections.activeFunds.availability === 'partial'
            ? 'Capital routes need attention because some connected accounts are missing funds snapshots.'
            : 'Capital route snapshots are critically stale.',
        detail: sections.activeFunds.note,
      });
    } else if (sections.activeFunds.freshness?.state === 'stale') {
      warnings.push({
        code: 'funds_snapshot_attention',
        tone: 'warning',
        section: 'activeFunds',
        summary: 'Capital route snapshots are getting stale.',
        detail: sections.activeFunds.note,
      });
    }

    return warnings;
  }

  private resolveActiveFundsAvailability(
    activeFunds: PortfolioActiveFundsResponse,
    hasError: boolean
  ): PortfolioOverviewSectionAvailability {
    const allItems = [...(activeFunds.walletItems || []), ...(activeFunds.futuresItems || [])];

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

  private toNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
}
