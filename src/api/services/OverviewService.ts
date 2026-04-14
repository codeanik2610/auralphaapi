import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  OverviewHealth,
  OverviewMeta,
  OverviewResponse,
  OverviewSectionCacheState,
  OverviewSectionFetchMode,
  OverviewSectionFreshness,
  OverviewSectionKey,
  OverviewSectionProvenance,
  OverviewSectionRequestStatus,
  OverviewWarning,
} from '../contracts/Overview';
import { MudrexFuturesFunds, MudrexWalletFunds } from '../contracts/Mudrex';
import { PortfolioActiveFundsResponse } from '../contracts/PortfolioOverview';
import { successResponse } from '../utils/response';
import { BrokerWalletFacadeService } from './BrokerWalletFacadeService';
import { BrokerReferenceDataService } from './BrokerReferenceDataService';
import { AlertsService } from './AlertsService';
import { AutomationsService } from './AutomationsService';
import { PortfolioService } from './PortfolioService';
import { SignalsService } from './SignalsService';
import {
  BrokerAccountRepository,
  PortfolioHolding as PortfolioHoldingEntity,
  PortfolioSnapshot,
} from '../../database';
import { FundsSnapshotRepository } from '../../database/repositories/FundsSnapshotRepository';
import { PortfolioRepository } from '../../database/repositories/PortfolioRepository';
import { Logger } from '../../lib/logger';
import { ServiceUnavailableAppError } from '../errors/AppError';

interface OverviewQuery {
  selectedSymbol?: string;
  sort?: string;
  order?: string;
}

interface ResolvedOverviewRoute {
  route: { brokerKey: string; accountId?: string };
  resolution: 'resolved' | 'fallback_default_broker';
  detail: string;
  degraded: boolean;
}

interface SupportTaskResult<T> {
  value: T;
  errorMessage: string | null;
}

interface SectionLoadResult<T> {
  value: T;
  requestStatus: OverviewSectionRequestStatus;
  fetchMode: OverviewSectionFetchMode;
  statusDetail: string;
  timeoutMs: number | null;
  timedOut: boolean;
}

interface ReferenceCacheEntry<T> {
  value: T;
  cachedAt: number;
  expiresAt: number;
  staleExpiresAt: number;
}

interface ReferenceSectionLoadResult<T> extends SectionLoadResult<T> {
  cacheState: OverviewSectionCacheState;
  cacheObservedAt: string | null;
  cacheDetail: string;
}

interface SectionProvenanceRuntime {
  observedAt: string | null;
  availability: 'available' | 'missing';
  requestStatus: OverviewSectionRequestStatus;
  fetchMode: OverviewSectionFetchMode;
  statusDetail: string;
  timeoutMs?: number | null;
  freshness?: OverviewSectionFreshness | null;
  cache?: OverviewSectionProvenance['cache'] | null;
}

const AUTOMATIONS_LIMIT = 5;
const ALERTS_LIMIT = 5;
const SIGNALS_LIMIT = 3;
const HOLDINGS_LIMIT = 5;
const ASSETS_LIMIT = 8;
const OVERVIEW_CONTRACT_VERSION = 'overview-phase4-2026-04-09' as const;
const SUPPORTED_OVERVIEW_QUERY_PARAMS = ['selectedSymbol', 'sort', 'order'] as const;
const IGNORED_OVERVIEW_QUERY_PARAMS = ['brokerKey', 'accountId', 'limit'] as const;
const DEFAULT_EXTERNAL_SECTION_TIMEOUT_MS = 2500;
const REFERENCE_CACHE_TTL_MS = 15_000;
const REFERENCE_STALE_CACHE_TTL_MS = 5 * 60_000;
const REFERENCE_CACHE_MAX_ENTRIES = 200;
const FUNDS_SNAPSHOT_STALE_AFTER_MS = 30 * 60 * 60 * 1000;
const FUNDS_SNAPSHOT_CRITICAL_AFTER_MS = 48 * 60 * 60 * 1000;
const ACTIVE_FUNDS_SNAPSHOT_STALE_AFTER_MS = 30 * 60 * 1000;
const ACTIVE_FUNDS_SNAPSHOT_CRITICAL_AFTER_MS = 2 * 60 * 60 * 1000;
const PORTFOLIO_SNAPSHOT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const PORTFOLIO_SNAPSHOT_CRITICAL_AFTER_MS = 24 * 60 * 60 * 1000;

const log = new Logger(__filename);

@Service()
export class OverviewService {
  private externalSectionTimeoutMs = DEFAULT_EXTERNAL_SECTION_TIMEOUT_MS;
  private referenceCacheTtlMs = REFERENCE_CACHE_TTL_MS;
  private referenceCacheStaleTtlMs = REFERENCE_STALE_CACHE_TTL_MS;
  private referenceCacheMaxEntries = REFERENCE_CACHE_MAX_ENTRIES;
  private readonly assetsReferenceCache = new Map<
    string,
    ReferenceCacheEntry<OverviewResponse['assets']>
  >();
  private readonly selectedAssetReferenceCache = new Map<
    string,
    ReferenceCacheEntry<OverviewResponse['selectedAsset']>
  >();
  private readonly leverageReferenceCache = new Map<
    string,
    ReferenceCacheEntry<OverviewResponse['leverage']>
  >();

  @Inject(() => BrokerWalletFacadeService)
  private brokerWalletFacadeService!: BrokerWalletFacadeService;

  @Inject(() => BrokerReferenceDataService)
  private brokerReferenceDataService!: BrokerReferenceDataService;

  @Inject(() => AutomationsService)
  private automationsService!: AutomationsService;

  @Inject(() => AlertsService)
  private alertsService!: AlertsService;

  @Inject(() => SignalsService)
  private signalsService!: SignalsService;

  @Inject(() => PortfolioService)
  private portfolioService!: PortfolioService;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => FundsSnapshotRepository)
  private fundsSnapshotRepository!: FundsSnapshotRepository;

  @Inject(() => PortfolioRepository)
  private portfolioRepository!: PortfolioRepository;

  async getOverview(userId: string, query: OverviewQuery): Promise<ApiSuccessResponse<OverviewResponse>> {
    const startedAt = Date.now();
    const generatedAt = new Date().toISOString();
    const routeResolution = await this.resolveBrokerRouteSafely(userId);
    const { brokerKey, accountId } = routeResolution.route;
    const referenceBrokerKey = 'mudrex';
    const requestedSymbol = this.normalizeOptionalSymbol(query.selectedSymbol);
    const assetsCacheKey = this.buildAssetsCacheKey(referenceBrokerKey, query);

    const fundsSnapshotTask = this.runSupportTask(
      'fundsSnapshot',
      async () => this.fundsSnapshotRepository.getLatestSnapshot(userId, brokerKey, accountId)
    );
    const portfolioSnapshotTask = this.runSupportTask(
      'portfolioSnapshot',
      async () => this.portfolioRepository.getLatestSnapshot(userId)
    );

    const [
      walletFundsTask,
      futuresFundsTask,
      activeFundsTask,
      assetsTask,
      automationsTask,
      automationsSummaryTask,
      alertsTask,
      alertsSummaryTask,
      signalsTask,
      signalsSummaryTask,
      portfolioSummaryTask,
      portfolioHoldingsTask,
      fundsSnapshotResult,
      portfolioSnapshotResult,
    ] = await Promise.all([
      this.loadSection<MudrexWalletFunds | null>('walletFunds', {
        defaultValue: null,
        run: async () =>
          this.extractData<MudrexWalletFunds>(
            (await this.brokerWalletFacadeService.getWalletFunds(
              userId,
              brokerKey,
              accountId
            )) as MudrexWalletFunds | { data?: MudrexWalletFunds }
          ),
        fallback: async () =>
          this.parseSnapshotJson<MudrexWalletFunds>(
            (await fundsSnapshotTask).value?.wallet_funds_json
          ) ?? null,
        successDetail: 'Loaded wallet funds from the resolved broker-account snapshot.',
        fallbackDetail: 'Wallet funds lookup degraded, so the latest stored funds snapshot was reused.',
      }),
      this.loadSection<MudrexFuturesFunds | null>('futuresFunds', {
        defaultValue: null,
        run: async () =>
          this.extractData<MudrexFuturesFunds>(
            (await this.brokerWalletFacadeService.getFuturesFunds(
              userId,
              brokerKey,
              accountId
            )) as MudrexFuturesFunds | { data?: MudrexFuturesFunds }
          ),
        fallback: async () =>
          this.parseSnapshotJson<MudrexFuturesFunds>(
            (await fundsSnapshotTask).value?.futures_funds_json
          ) ?? null,
        successDetail: 'Loaded futures funds from the resolved broker-account snapshot.',
        fallbackDetail:
          'Futures funds lookup degraded, so the latest stored funds snapshot was reused.',
      }),
      this.loadSection<PortfolioActiveFundsResponse>('activeFunds', {
        defaultValue: this.getDefaultActiveFundsResponse(),
        run: async () => {
          const [walletFundsResponse, futuresFundsResponse] = await Promise.all([
            this.brokerWalletFacadeService.getWalletFundsForActiveAccounts(userId),
            this.brokerWalletFacadeService.getFuturesFundsForActiveAccounts(userId),
          ]);

          return this.buildActiveFundsResponse({
            walletFundsPayload:
              this.extractData(walletFundsResponse as { data?: unknown }) ?? walletFundsResponse,
            futuresFundsPayload:
              this.extractData(futuresFundsResponse as { data?: unknown }) ?? futuresFundsResponse,
          });
        },
        successDetail:
          'Loaded per-account capital routes from the latest funds snapshots across connected accounts.',
      }),
      this.loadCachedReferenceSection<OverviewResponse['assets']>('assets', {
        cache: this.assetsReferenceCache,
        cacheKey: assetsCacheKey,
        defaultValue: [],
        run: async () =>
          this.extractData<OverviewResponse['assets']>(
            await this.withTimeout(
              this.brokerReferenceDataService.getFuturesAssets(referenceBrokerKey, {
                sort: query.sort,
                order: query.order,
                offset: '0',
                limit: String(ASSETS_LIMIT),
              }),
              this.externalSectionTimeoutMs,
              'Overview market opportunities request timed out'
            )
          ) || [],
        successDetail: 'Loaded market opportunities from the live Mudrex futures reference feed.',
        freshFallbackDetail:
          'Live market opportunities degraded, so a recent cached futures feed response was reused.',
        staleFallbackDetail:
          'Live market opportunities degraded, so the last cached futures feed response was reused beyond the fresh cache window.',
        timeoutMs: this.externalSectionTimeoutMs,
      }),
      this.loadSection('automations', {
        defaultValue: this.getDefaultAutomationsResponse(),
        run: async () =>
          this.extractData(await this.automationsService.getAutomations(userId, {
            limit: String(AUTOMATIONS_LIMIT),
            offset: '0',
          })) ?? this.getDefaultAutomationsResponse(),
        successDetail: 'Loaded the automation operator digest from the application read model.',
      }),
      this.loadSection('automationsSummary', {
        defaultValue: this.getDefaultAutomationsSummary(),
        run: async () =>
          this.extractData(await this.automationsService.getAutomationsSummary(userId)) ??
          this.getDefaultAutomationsSummary(),
        successDetail: 'Loaded automation summary counters from the application read model.',
      }),
      this.loadSection('alerts', {
        defaultValue: this.getDefaultAlertsResponse(),
        run: async () =>
          this.extractData(await this.alertsService.getAlerts(userId, {
            limit: String(ALERTS_LIMIT),
            offset: '0',
          })) ?? this.getDefaultAlertsResponse(),
        successDetail: 'Loaded the latest alert digest for the operator inbox.',
      }),
      this.loadSection('alertsSummary', {
        defaultValue: this.getDefaultAlertsSummary(),
        run: async () =>
          this.extractData(await this.alertsService.getAlertsSummary(userId)) ??
          this.getDefaultAlertsSummary(),
        successDetail: 'Loaded alert summary counters from the application read model.',
      }),
      this.loadSection('signals', {
        defaultValue: this.getDefaultSignalsResponse(),
        run: async () =>
          this.extractData(await this.signalsService.getSignals(userId, {
            limit: String(SIGNALS_LIMIT),
            offset: '0',
          })) ?? this.getDefaultSignalsResponse(),
        successDetail: 'Loaded the signal review digest for the current user.',
      }),
      this.loadSection('signalsSummary', {
        defaultValue: this.getDefaultSignalsSummary(),
        run: async () =>
          this.extractData(await this.signalsService.getSignalsSummary(userId)) ??
          this.getDefaultSignalsSummary(),
        successDetail: 'Loaded signal summary counters from the application read model.',
      }),
      this.loadSection('portfolioSummary', {
        defaultValue: this.getDefaultPortfolioSummary(),
        run: async () =>
          this.extractData(await this.portfolioService.getPortfolioSummary(userId)) ??
          this.getDefaultPortfolioSummary(),
        fallback: async () =>
          this.mapPortfolioSummaryFromSnapshot((await portfolioSnapshotTask).value) ??
          this.getDefaultPortfolioSummary(),
        successDetail: 'Loaded the latest portfolio summary from the portfolio snapshot read model.',
        fallbackDetail:
          'Portfolio summary degraded, so the latest stored portfolio snapshot was mapped directly.',
      }),
      this.loadSection('portfolioHoldings', {
        defaultValue: this.getDefaultPortfolioHoldingsResponse(),
        run: async () =>
          this.extractData(await this.portfolioService.getPortfolioHoldings(userId, {
            limit: String(HOLDINGS_LIMIT),
            offset: '0',
          })) ?? this.getDefaultPortfolioHoldingsResponse(),
        fallback: async () =>
          this.mapPortfolioHoldingsFromSnapshot((await portfolioSnapshotTask).value) ??
          this.getDefaultPortfolioHoldingsResponse(),
        successDetail:
          'Loaded the latest portfolio holdings digest from the portfolio snapshot read model.',
        fallbackDetail:
          'Portfolio holdings degraded, so the latest stored portfolio snapshot holdings were reused.',
      }),
      fundsSnapshotTask,
      portfolioSnapshotTask,
    ]);

    const assets = assetsTask.value || [];
    const selectedSymbol = requestedSymbol || this.normalizeOptionalSymbol(assets[0]?.symbol) || '';

    const [selectedAssetTask, leverageTask] = await Promise.all([
      this.loadCachedReferenceSection('selectedAsset', {
        cache: this.selectedAssetReferenceCache,
        cacheKey: selectedSymbol || 'none',
        defaultValue: null,
        skip: !selectedSymbol,
        skipDetail: 'No selected symbol was available for this overview request.',
        run: async () =>
          this.extractData(
            await this.withTimeout(
              this.brokerReferenceDataService.getFuturesAssetDetailBySymbol(
                referenceBrokerKey,
                selectedSymbol
              ),
              this.externalSectionTimeoutMs,
              `Overview selected asset detail timed out for ${selectedSymbol}`
            )
          ),
        successDetail: `Loaded live selected-asset detail for ${selectedSymbol}.`,
        freshFallbackDetail: `Live selected-asset detail degraded, so a recent cached response was reused for ${selectedSymbol}.`,
        staleFallbackDetail: `Live selected-asset detail degraded, so the last cached response was reused beyond the fresh cache window for ${selectedSymbol}.`,
        timeoutMs: this.externalSectionTimeoutMs,
      }),
      this.loadCachedReferenceSection('leverage', {
        cache: this.leverageReferenceCache,
        cacheKey: selectedSymbol || 'none',
        defaultValue: null,
        skip: !selectedSymbol,
        skipDetail: 'No selected symbol was available for this overview request.',
        run: async () =>
          this.extractData(
            await this.withTimeout(
              this.brokerReferenceDataService.getLeverageBySymbol(
                referenceBrokerKey,
                selectedSymbol
              ),
              this.externalSectionTimeoutMs,
              `Overview leverage lookup timed out for ${selectedSymbol}`
            )
          ),
        successDetail: `Loaded live leverage detail for ${selectedSymbol}.`,
        freshFallbackDetail: `Live leverage detail degraded, so a recent cached response was reused for ${selectedSymbol}.`,
        staleFallbackDetail: `Live leverage detail degraded, so the last cached response was reused beyond the fresh cache window for ${selectedSymbol}.`,
        timeoutMs: this.externalSectionTimeoutMs,
      }),
    ]);

    const walletFunds = walletFundsTask.value;
    const futuresFunds = futuresFundsTask.value;
    const activeFunds = activeFundsTask.value;
    const selectedAsset = selectedAssetTask.value;
    const leverage = leverageTask.value;
    const automations = automationsTask.value;
    const automationsSummary = automationsSummaryTask.value;
    const alerts = alertsTask.value;
    const alertsSummary = alertsSummaryTask.value;
    const signals = signalsTask.value;
    const signalsSummary = signalsSummaryTask.value;
    const portfolioSummary = portfolioSummaryTask.value;
    const portfolioHoldings = portfolioHoldingsTask.value;
    const fundsSnapshot = fundsSnapshotResult.value;
    const portfolioSnapshot = portfolioSnapshotResult.value;
    const walletSnapshotObservedAt =
      fundsSnapshot?.observed_at?.toISOString?.() ??
      fundsSnapshot?.computed_at?.toISOString?.() ??
      null;
    const portfolioSnapshotObservedAt = portfolioSnapshot?.createdAt?.toISOString?.() ?? null;
    const assetsObservedAt = assets.length
      ? this.resolveReferenceObservedAt(assetsTask.cacheState, assetsTask.cacheObservedAt, generatedAt)
      : null;
    const selectedAssetObservedAt = selectedAsset
      ? this.resolveReferenceObservedAt(
          selectedAssetTask.cacheState,
          selectedAssetTask.cacheObservedAt,
          generatedAt
        )
      : null;
    const leverageObservedAt = leverage
      ? this.resolveReferenceObservedAt(
          leverageTask.cacheState,
          leverageTask.cacheObservedAt,
          generatedAt
        )
      : null;
    const automationsObservedAt =
      this.pickLatestTimestamp(
        automations.items[0]?.updatedAt,
        automations.items[0]?.lastRun,
        generatedAt
      ) ?? generatedAt;
    const alertsObservedAt =
      this.pickLatestTimestamp(alerts.items[0]?.updatedAt, alerts.items[0]?.time, generatedAt) ??
      generatedAt;
    const signalsObservedAt =
      this.pickLatestTimestamp(
        signals.items[0]?.signalTime,
        signals.items[0]?.updatedAt,
        signals.items[0]?.createdAt,
        generatedAt
      ) ?? generatedAt;
    const walletFreshness = this.buildFreshness(
      walletSnapshotObservedAt,
      FUNDS_SNAPSHOT_STALE_AFTER_MS,
      FUNDS_SNAPSHOT_CRITICAL_AFTER_MS
    );
    const activeFundsObservedAt: string | null =
      activeFunds.oldestObservedAtIso ?? activeFunds.latestObservedAtIso ?? null;
    const activeFundsHasError = this.hasActiveFundsError(activeFunds);
    const activeFundsFreshness = this.buildFreshness(
      activeFundsObservedAt,
      ACTIVE_FUNDS_SNAPSHOT_STALE_AFTER_MS,
      ACTIVE_FUNDS_SNAPSHOT_CRITICAL_AFTER_MS
    );
    const portfolioFreshness = this.buildFreshness(
      portfolioSnapshotObservedAt,
      PORTFOLIO_SNAPSHOT_STALE_AFTER_MS,
      PORTFOLIO_SNAPSHOT_CRITICAL_AFTER_MS
    );
    const assetsFreshness = this.buildFreshness(
      assetsObservedAt,
      this.referenceCacheTtlMs,
      this.referenceCacheStaleTtlMs
    );
    const selectedAssetFreshness = this.buildFreshness(
      selectedAssetObservedAt,
      this.referenceCacheTtlMs,
      this.referenceCacheStaleTtlMs
    );
    const leverageFreshness = this.buildFreshness(
      leverageObservedAt,
      this.referenceCacheTtlMs,
      this.referenceCacheStaleTtlMs
    );
    const assetsCache = this.buildReferenceCacheMetadata(assetsTask);
    const selectedAssetCache = this.buildReferenceCacheMetadata(selectedAssetTask);
    const leverageCache = this.buildReferenceCacheMetadata(leverageTask);

    const sections = {
      health: this.createSectionProvenance(
        {
          sourceType: 'computed_summary',
          source: 'OverviewService request assembly timestamp',
          sourceLabel: 'Overview assembly heartbeat',
          uiUsage: 'rendered',
          notes:
            'Use this as an overview request heartbeat only. It does not represent platform-wide system health.',
        },
        {
          observedAt: generatedAt,
          availability: 'available',
          requestStatus: 'ok',
          fetchMode: 'primary',
          statusDetail: 'Overview request assembly completed.',
          freshness: this.buildFreshness(generatedAt, null, null),
        }
      ),
      walletFunds: this.createSectionProvenance(
        {
          sourceType: 'db_snapshot',
          source: 'funds_snapshots.wallet_funds_json for the resolved broker account',
          sourceLabel: 'Latest wallet funds snapshot',
          uiUsage: 'rendered',
          notes:
            'Snapshot-backed capital data. Treat missing data as an ingestion or account-routing gap, not as zero balance.',
        },
        {
          observedAt: walletSnapshotObservedAt,
          availability: walletFunds ? 'available' : 'missing',
          requestStatus: walletFundsTask.requestStatus,
          fetchMode: walletFundsTask.fetchMode,
          statusDetail: walletFundsTask.statusDetail,
          timeoutMs: walletFundsTask.timeoutMs,
          freshness: walletFreshness,
        }
      ),
      futuresFunds: this.createSectionProvenance(
        {
          sourceType: 'db_snapshot',
          source: 'funds_snapshots.futures_funds_json for the resolved broker account',
          sourceLabel: 'Latest futures funds snapshot',
          uiUsage: 'rendered',
          notes: 'Snapshot-backed futures balance data for the resolved broker account.',
        },
        {
          observedAt: walletSnapshotObservedAt,
          availability: futuresFunds ? 'available' : 'missing',
          requestStatus: futuresFundsTask.requestStatus,
          fetchMode: futuresFundsTask.fetchMode,
          statusDetail: futuresFundsTask.statusDetail,
          timeoutMs: futuresFundsTask.timeoutMs,
          freshness: walletFreshness,
        }
      ),
      activeFunds: this.createSectionProvenance(
        {
          sourceType: 'db_snapshot',
          source: 'funds_snapshots via broker_wallet_facade across connected accounts',
          sourceLabel: 'Capital routes',
          uiUsage: 'rendered',
          notes: activeFundsHasError
            ? 'One or more connected accounts are missing funds snapshots; inspect the route rows before trusting visible capital totals.'
            : 'Per-account wallet and futures funds snapshots across connected accounts.',
        },
        {
          observedAt: activeFundsObservedAt,
          availability:
            activeFunds.walletItems.length || activeFunds.futuresItems.length
              ? 'available'
              : 'missing',
          requestStatus:
            activeFundsHasError && activeFundsTask.requestStatus === 'ok'
              ? 'degraded'
              : activeFundsTask.requestStatus,
          fetchMode: activeFundsTask.fetchMode,
          statusDetail: activeFundsHasError
            ? 'One or more connected accounts are missing funds snapshots; inspect the capital routes before trusting totals.'
            : activeFundsTask.statusDetail,
          timeoutMs: activeFundsTask.timeoutMs,
          freshness: activeFundsFreshness,
        }
      ),
      assets: this.createSectionProvenance(
        {
          sourceType: 'live_external',
          source: 'Mudrex futures reference feed via BrokerReferenceDataService.getFuturesAssets',
          sourceLabel: 'Live Mudrex futures feed',
          uiUsage: 'rendered',
        },
        {
          observedAt: assetsObservedAt,
          availability: assets.length ? 'available' : 'missing',
          requestStatus: assetsTask.requestStatus,
          fetchMode: assetsTask.fetchMode,
          statusDetail: assetsTask.statusDetail,
          timeoutMs: assetsTask.timeoutMs,
          freshness: assetsFreshness,
          cache: assetsCache,
        }
      ),
      selectedAsset: this.createSectionProvenance(
        {
          sourceType: 'live_external',
          source: 'Mudrex symbol detail via BrokerReferenceDataService.getFuturesAssetDetailBySymbol',
          sourceLabel: 'Live selected asset detail',
          uiUsage: 'rendered',
          notes:
            'Resolved from selectedSymbol when present, otherwise from the first asset in the returned assets list.',
        },
        {
          observedAt: selectedAssetObservedAt,
          availability: selectedAsset ? 'available' : 'missing',
          requestStatus: selectedAssetTask.requestStatus,
          fetchMode: selectedAssetTask.fetchMode,
          statusDetail: selectedAssetTask.statusDetail,
          timeoutMs: selectedAssetTask.timeoutMs,
          freshness: selectedAssetFreshness,
          cache: selectedAssetCache,
        }
      ),
      leverage: this.createSectionProvenance(
        {
          sourceType: 'live_external',
          source: 'Mudrex leverage lookup via BrokerReferenceDataService.getLeverageBySymbol',
          sourceLabel: 'Live leverage reference',
          uiUsage: 'rendered',
        },
        {
          observedAt: leverageObservedAt,
          availability: leverage ? 'available' : 'missing',
          requestStatus: leverageTask.requestStatus,
          fetchMode: leverageTask.fetchMode,
          statusDetail: leverageTask.statusDetail,
          timeoutMs: leverageTask.timeoutMs,
          freshness: leverageFreshness,
          cache: leverageCache,
        }
      ),
      automations: this.createSectionProvenance(
        {
          sourceType: 'computed_summary',
          source: 'AutomationsService.getAutomations limited operator digest',
          sourceLabel: 'Automation digest',
          uiUsage: 'rendered',
        },
        {
          observedAt: automations.items.length ? automationsObservedAt : null,
          availability: automations.items.length ? 'available' : 'missing',
          requestStatus: automationsTask.requestStatus,
          fetchMode: automationsTask.fetchMode,
          statusDetail: automationsTask.statusDetail,
          timeoutMs: automationsTask.timeoutMs,
        }
      ),
      automationsSummary: this.createSectionProvenance(
        {
          sourceType: 'computed_summary',
          source: 'AutomationsService.getAutomationsSummary aggregate counters',
          sourceLabel: 'Automation summary',
          uiUsage: 'rendered',
        },
        {
          observedAt:
            automationsSummaryTask.requestStatus === 'ok' ||
            automationsSummaryTask.fetchMode === 'fallback'
              ? automationsObservedAt
              : null,
          availability:
            automationsSummaryTask.requestStatus === 'ok' ||
            automationsSummaryTask.fetchMode === 'fallback'
              ? 'available'
              : 'missing',
          requestStatus: automationsSummaryTask.requestStatus,
          fetchMode: automationsSummaryTask.fetchMode,
          statusDetail: automationsSummaryTask.statusDetail,
          timeoutMs: automationsSummaryTask.timeoutMs,
        }
      ),
      alerts: this.createSectionProvenance(
        {
          sourceType: 'computed_summary',
          source: 'AlertsService.getAlerts limited operator digest',
          sourceLabel: 'Alert digest',
          uiUsage: 'rendered',
        },
        {
          observedAt: alerts.items.length ? alertsObservedAt : null,
          availability: alerts.items.length ? 'available' : 'missing',
          requestStatus: alertsTask.requestStatus,
          fetchMode: alertsTask.fetchMode,
          statusDetail: alertsTask.statusDetail,
          timeoutMs: alertsTask.timeoutMs,
        }
      ),
      alertsSummary: this.createSectionProvenance(
        {
          sourceType: 'computed_summary',
          source: 'AlertsService.getAlertsSummary aggregate counters',
          sourceLabel: 'Alert summary',
          uiUsage: 'rendered',
        },
        {
          observedAt:
            alertsSummaryTask.requestStatus === 'ok' ||
            alertsSummaryTask.fetchMode === 'fallback'
              ? alertsObservedAt
              : null,
          availability:
            alertsSummaryTask.requestStatus === 'ok' ||
            alertsSummaryTask.fetchMode === 'fallback'
              ? 'available'
              : 'missing',
          requestStatus: alertsSummaryTask.requestStatus,
          fetchMode: alertsSummaryTask.fetchMode,
          statusDetail: alertsSummaryTask.statusDetail,
          timeoutMs: alertsSummaryTask.timeoutMs,
        }
      ),
      signals: this.createSectionProvenance(
        {
          sourceType: 'computed_summary',
          source: 'SignalsService.getSignals limited operator digest',
          sourceLabel: 'Signal digest',
          uiUsage: 'rendered',
        },
        {
          observedAt: signals.items.length ? signalsObservedAt : null,
          availability: signals.items.length ? 'available' : 'missing',
          requestStatus: signalsTask.requestStatus,
          fetchMode: signalsTask.fetchMode,
          statusDetail: signalsTask.statusDetail,
          timeoutMs: signalsTask.timeoutMs,
        }
      ),
      signalsSummary: this.createSectionProvenance(
        {
          sourceType: 'computed_summary',
          source: 'SignalsService.getSignalsSummary aggregate counters',
          sourceLabel: 'Signal summary',
          uiUsage: 'rendered',
        },
        {
          observedAt:
            signalsSummaryTask.requestStatus === 'ok' ||
            signalsSummaryTask.fetchMode === 'fallback'
              ? signalsObservedAt
              : null,
          availability:
            signalsSummaryTask.requestStatus === 'ok' ||
            signalsSummaryTask.fetchMode === 'fallback'
              ? 'available'
              : 'missing',
          requestStatus: signalsSummaryTask.requestStatus,
          fetchMode: signalsSummaryTask.fetchMode,
          statusDetail: signalsSummaryTask.statusDetail,
          timeoutMs: signalsSummaryTask.timeoutMs,
        }
      ),
      portfolioSummary: this.createSectionProvenance(
        {
          sourceType: 'computed_summary',
          source: 'PortfolioService.getPortfolioSummary latest portfolio snapshot summary',
          sourceLabel: 'Portfolio summary',
          uiUsage: 'rendered',
        },
        {
          observedAt:
            portfolioSummaryTask.requestStatus === 'ok' ||
            portfolioSummaryTask.fetchMode === 'fallback'
              ? portfolioSnapshotObservedAt
              : null,
          availability:
            portfolioSnapshotObservedAt &&
            (portfolioSummaryTask.requestStatus === 'ok' ||
              portfolioSummaryTask.fetchMode === 'fallback')
              ? 'available'
              : 'missing',
          requestStatus: portfolioSummaryTask.requestStatus,
          fetchMode: portfolioSummaryTask.fetchMode,
          statusDetail: portfolioSummaryTask.statusDetail,
          timeoutMs: portfolioSummaryTask.timeoutMs,
          freshness: portfolioFreshness,
        }
      ),
      portfolioHoldings: this.createSectionProvenance(
        {
          sourceType: 'db_snapshot',
          source: 'PortfolioService.getPortfolioHoldings latest holdings snapshot digest',
          sourceLabel: 'Portfolio holdings snapshot',
          uiUsage: 'rendered',
        },
        {
          observedAt:
            portfolioHoldings.items.length &&
            (portfolioHoldingsTask.requestStatus === 'ok' ||
              portfolioHoldingsTask.fetchMode === 'fallback')
              ? portfolioSnapshotObservedAt
              : null,
          availability: portfolioHoldings.items.length ? 'available' : 'missing',
          requestStatus: portfolioHoldingsTask.requestStatus,
          fetchMode: portfolioHoldingsTask.fetchMode,
          statusDetail: portfolioHoldingsTask.statusDetail,
          timeoutMs: portfolioHoldingsTask.timeoutMs,
          freshness: portfolioFreshness,
        }
      ),
    } satisfies Record<OverviewSectionKey, OverviewSectionProvenance>;

    const degradedSections = (Object.entries(sections) as Array<[OverviewSectionKey, OverviewSectionProvenance]>)
      .filter(([sectionKey, section]) => sectionKey !== 'health' && section.requestStatus === 'degraded')
      .map(([sectionKey]) => sectionKey);
    const timeoutSections = [
      ...(assetsTask.timedOut ? (['assets'] as OverviewSectionKey[]) : []),
      ...(selectedAssetTask.timedOut ? (['selectedAsset'] as OverviewSectionKey[]) : []),
      ...(leverageTask.timedOut ? (['leverage'] as OverviewSectionKey[]) : []),
    ];
    const resilienceSummary = this.buildResilienceSummary({
      degradedSections,
      timeoutSections,
      routingFallback: routeResolution.degraded,
    });
    const warnings = this.buildOverviewWarnings({
      routeResolution,
      sections,
      automationsSummary,
    });
    const observability = this.buildOverviewObservability({
      totalMs: Date.now() - startedAt,
      degradedSections,
      timeoutSections,
      warnings,
      sections,
      assetsCacheState: assetsTask.cacheState,
      selectedAssetCacheState: selectedAssetTask.cacheState,
      leverageCacheState: leverageTask.cacheState,
    });
    const overviewHealth = this.buildOverviewHealth({
      generatedAt,
      degradedSections,
      timeoutSections,
      routingFallback: routeResolution.degraded,
      resilienceSummary,
    });

    sections.health = this.createSectionProvenance(
      {
        sourceType: 'computed_summary',
        source: 'OverviewService request assembly timestamp',
        sourceLabel: 'Overview assembly heartbeat',
        uiUsage: 'rendered',
        notes:
          'Use this as an overview request heartbeat only. It does not represent platform-wide system health.',
      },
      {
        observedAt: generatedAt,
        availability: 'available',
        requestStatus: overviewHealth.status === 'degraded' ? 'degraded' : 'ok',
        fetchMode: 'primary',
        statusDetail: resilienceSummary,
        freshness: this.buildFreshness(generatedAt, null, null),
      }
    );

    this.logOverviewObservability({
      userId,
      totalMs: observability.totalMs,
      degradedSections,
      timeoutSections,
      warningCount: warnings.length,
      staleSectionCount: observability.staleSectionCount,
      criticalSectionCount: observability.criticalSectionCount,
      routeResolution,
      assetsCacheState: assetsTask.cacheState,
      selectedAssetCacheState: selectedAssetTask.cacheState,
      leverageCacheState: leverageTask.cacheState,
    });

    return successResponse<OverviewResponse>({
      meta: this.buildOverviewMeta({
        generatedAt,
        routeResolution,
        referenceBrokerKey,
        requestedSymbol: requestedSymbol || null,
        resolvedSymbol: selectedSymbol || null,
        resilienceSummary,
        degradedSections,
        timeoutSections,
        warnings,
        observability,
        sections,
      }),
      health: overviewHealth,
      walletFunds,
      futuresFunds,
      activeFunds,
      assets,
      selectedAsset,
      leverage,
      automations,
      automationsSummary,
      alerts,
      alertsSummary,
      signals,
      signalsSummary,
      portfolioSummary,
      portfolioHoldings,
    });
  }

  private buildOverviewMeta(input: {
    generatedAt: string;
    routeResolution: ResolvedOverviewRoute;
    referenceBrokerKey: 'mudrex';
    requestedSymbol: string | null;
    resolvedSymbol: string | null;
    resilienceSummary: string;
    degradedSections: OverviewSectionKey[];
    timeoutSections: OverviewSectionKey[];
    warnings: OverviewWarning[];
    observability: OverviewMeta['observability'];
    sections: Record<OverviewSectionKey, OverviewSectionProvenance>;
  }): OverviewMeta {
    return {
      contractVersion: OVERVIEW_CONTRACT_VERSION,
      purpose: 'operator_command_center',
      generatedAt: input.generatedAt,
      summary:
        'Phase 4 overview contract adds snapshot freshness, explicit operator warnings, automation diagnostics, live-reference cache fallback metadata, and request observability for the operator dashboard.',
      query: {
        supported: [...SUPPORTED_OVERVIEW_QUERY_PARAMS],
        ignored: [...IGNORED_OVERVIEW_QUERY_PARAMS],
        sectionLimits: {
          assets: ASSETS_LIMIT,
          automations: AUTOMATIONS_LIMIT,
          alerts: ALERTS_LIMIT,
          signals: SIGNALS_LIMIT,
          portfolioHoldings: HOLDINGS_LIMIT,
        },
      },
      routing: {
        accountSelection: 'default_connected_account_or_first_connected_account',
        brokerKey: input.routeResolution.route.brokerKey,
        accountId: input.routeResolution.route.accountId || null,
        referenceBrokerKey: input.referenceBrokerKey,
        resolution: input.routeResolution.resolution,
        detail: input.routeResolution.detail,
      },
      resilience: {
        status:
          input.degradedSections.length || input.routeResolution.degraded ? 'partial' : 'full',
        degradedSections: input.degradedSections,
        timeoutSections: input.timeoutSections,
        routingFallback: input.routeResolution.degraded,
        summary: input.resilienceSummary,
      },
      selection: {
        requestedSymbol: input.requestedSymbol,
        resolvedSymbol: input.resolvedSymbol,
        mode: input.requestedSymbol
          ? 'requested'
          : input.resolvedSymbol
            ? 'first_asset_default'
            : 'none',
      },
      warnings: input.warnings,
      observability: input.observability,
      sections: input.sections,
    };
  }

  private buildOverviewHealth(input: {
    generatedAt: string;
    degradedSections: OverviewSectionKey[];
    timeoutSections: OverviewSectionKey[];
    routingFallback: boolean;
    resilienceSummary: string;
  }): OverviewHealth {
    const degraded =
      input.degradedSections.length > 0 || input.timeoutSections.length > 0 || input.routingFallback;

    return {
      status: degraded ? 'degraded' : 'assembled',
      timestamp: input.generatedAt,
      scope: 'overview_request',
      summary: `${input.resilienceSummary} This is a request-level overview status, not a platform-wide health signal.`,
      degradedSections: input.degradedSections,
      timeoutSections: input.timeoutSections,
    };
  }

  private buildResilienceSummary(input: {
    degradedSections: OverviewSectionKey[];
    timeoutSections: OverviewSectionKey[];
    routingFallback: boolean;
  }): string {
    if (!input.degradedSections.length && !input.routingFallback) {
      return 'Overview payload assembled successfully from primary dependencies.';
    }

    const parts: string[] = ['Overview payload assembled with partial degradation.'];

    if (input.routingFallback) {
      parts.push('Broker routing fell back to the default mudrex route for this request.');
    }

    if (input.degradedSections.length) {
      parts.push(
        `Degraded sections: ${input.degradedSections
          .map((sectionKey) => this.describeSectionKey(sectionKey))
          .join(', ')}.`
      );
    }

    if (input.timeoutSections.length) {
      parts.push(
        `Timeouts were observed in ${input.timeoutSections
          .map((sectionKey) => this.describeSectionKey(sectionKey))
          .join(', ')}.`
      );
    }

    return parts.join(' ');
  }

  private buildOverviewWarnings(input: {
    routeResolution: ResolvedOverviewRoute;
    sections: Record<OverviewSectionKey, OverviewSectionProvenance>;
    automationsSummary: OverviewResponse['automationsSummary'];
  }): OverviewWarning[] {
    const warnings: OverviewWarning[] = [];
    const walletSection = input.sections.walletFunds;
    const futuresSection = input.sections.futuresFunds;
    const portfolioSection = input.sections.portfolioSummary;
    const automationSummarySection = input.sections.automationsSummary;
    const referenceSections = [
      ['assets', input.sections.assets],
      ['selectedAsset', input.sections.selectedAsset],
      ['leverage', input.sections.leverage],
    ] as Array<[OverviewSectionKey, OverviewSectionProvenance]>;

    const capitalFreshness = walletSection.freshness ?? futuresSection.freshness;
    if (
      walletSection.availability === 'missing' ||
      futuresSection.availability === 'missing' ||
      !walletSection.observedAt ||
      !futuresSection.observedAt ||
      capitalFreshness?.state === 'stale' ||
      capitalFreshness?.state === 'critical'
    ) {
      warnings.push({
        code: 'capital_snapshot_attention',
        level:
          walletSection.availability === 'missing' ||
          futuresSection.availability === 'missing' ||
          !walletSection.observedAt ||
          !futuresSection.observedAt ||
          capitalFreshness?.state === 'critical'
            ? 'critical'
            : 'warning',
        section: 'walletFunds',
        summary:
          walletSection.availability === 'missing' ||
          futuresSection.availability === 'missing' ||
          !walletSection.observedAt ||
          !futuresSection.observedAt
            ? 'No recent capital snapshot is available for the resolved broker route.'
            : 'Capital snapshot freshness needs operator review.',
        detail:
          walletSection.availability === 'missing' ||
          futuresSection.availability === 'missing' ||
          !walletSection.observedAt ||
          !futuresSection.observedAt
            ? `Wallet/futures snapshots are missing for ${input.routeResolution.route.brokerKey}${input.routeResolution.route.accountId ? `:${input.routeResolution.route.accountId}` : ''}.`
            : `Latest capital snapshot is ${this.describeFreshness(capitalFreshness)}.`,
      });
    }

    if (
      portfolioSection.availability === 'missing' ||
      !portfolioSection.observedAt ||
      portfolioSection.freshness?.state === 'stale' ||
      portfolioSection.freshness?.state === 'critical'
    ) {
      warnings.push({
        code: 'portfolio_snapshot_attention',
        level:
          portfolioSection.availability === 'missing' ||
          !portfolioSection.observedAt ||
          portfolioSection.freshness?.state === 'critical'
            ? 'critical'
            : 'warning',
        section: 'portfolioSummary',
        summary:
          portfolioSection.availability === 'missing' || !portfolioSection.observedAt
            ? 'Portfolio snapshot is unavailable for this overview request.'
            : 'Portfolio snapshot is stale for operator decision-making.',
        detail:
          portfolioSection.availability === 'missing' || !portfolioSection.observedAt
            ? 'Daily PnL, net exposure, and holdings posture are unavailable until a fresh portfolio snapshot is written.'
            : `Latest portfolio snapshot is ${this.describeFreshness(portfolioSection.freshness)}.`,
      });
    }

    if (
      automationSummarySection.requestStatus === 'degraded' ||
      input.automationsSummary?.healthStatus === 'degraded' ||
      input.automationsSummary?.healthStatus === 'down'
    ) {
      warnings.push({
        code: 'automation_health_attention',
        level: input.automationsSummary?.healthStatus === 'down' ? 'critical' : 'warning',
        section: 'automationsSummary',
        summary:
          input.automationsSummary?.healthStatus === 'down'
            ? 'Automation health is down.'
            : 'Automation health is degraded.',
        detail:
          input.automationsSummary?.diagnostics?.workerDetail ||
          automationSummarySection.statusDetail ||
          'Worker, queue, overlap, or cursor diagnostics need review.',
      });
    }

    const degradedReferenceSections = referenceSections.filter(
      ([, section]) =>
        section.requestStatus === 'degraded' ||
        section.cache?.state === 'fresh-cache-fallback' ||
        section.cache?.state === 'stale-cache-fallback' ||
        section.cache?.state === 'unavailable'
    );

    if (degradedReferenceSections.length) {
      warnings.push({
        code: 'live_reference_feed_attention',
        level: degradedReferenceSections.some(
          ([, section]) => section.cache?.state === 'unavailable'
        )
          ? 'critical'
          : 'warning',
        section: degradedReferenceSections[0][0],
        summary: degradedReferenceSections.some(
          ([, section]) => section.cache?.state === 'unavailable'
        )
          ? 'Live reference feed is unavailable for part of this overview request.'
          : 'Live reference feed is degraded and cached market data is in use.',
        detail: degradedReferenceSections
          .map(([sectionKey, section]) => `${this.describeSectionKey(sectionKey)}: ${section.statusDetail}`)
          .join(' '),
      });
    }

    return warnings;
  }

  private buildOverviewObservability(input: {
    totalMs: number;
    degradedSections: OverviewSectionKey[];
    timeoutSections: OverviewSectionKey[];
    warnings: OverviewWarning[];
    sections: Record<OverviewSectionKey, OverviewSectionProvenance>;
    assetsCacheState: OverviewSectionCacheState;
    selectedAssetCacheState: OverviewSectionCacheState;
    leverageCacheState: OverviewSectionCacheState;
  }): OverviewMeta['observability'] {
    const freshnessStates = Object.values(input.sections)
      .map((section) => section.freshness?.state)
      .filter(Boolean);
    const staleSectionCount = freshnessStates.filter((state) => state === 'stale').length;
    const criticalSectionCount = freshnessStates.filter((state) => state === 'critical').length;

    return {
      totalMs: input.totalMs,
      degradedSectionCount: input.degradedSections.length,
      timeoutSectionCount: input.timeoutSections.length,
      staleSectionCount,
      criticalSectionCount,
      warningCount: input.warnings.length,
      referenceCache: {
        assets: input.assetsCacheState,
        selectedAsset: input.selectedAssetCacheState,
        leverage: input.leverageCacheState,
      },
      summary: `Overview assembled in ${input.totalMs}ms with ${input.degradedSections.length} degraded section${input.degradedSections.length === 1 ? '' : 's'}, ${staleSectionCount} stale section${staleSectionCount === 1 ? '' : 's'}, and ${input.warnings.length} operator warning${input.warnings.length === 1 ? '' : 's'}.`,
    };
  }

  private logOverviewObservability(input: {
    userId: string;
    totalMs: number;
    degradedSections: OverviewSectionKey[];
    timeoutSections: OverviewSectionKey[];
    warningCount: number;
    staleSectionCount: number;
    criticalSectionCount: number;
    routeResolution: ResolvedOverviewRoute;
    assetsCacheState: OverviewSectionCacheState;
    selectedAssetCacheState: OverviewSectionCacheState;
    leverageCacheState: OverviewSectionCacheState;
  }): void {
    const payload = {
      userId: input.userId,
      totalMs: input.totalMs,
      degradedSections: input.degradedSections,
      timeoutSections: input.timeoutSections,
      warningCount: input.warningCount,
      staleSectionCount: input.staleSectionCount,
      criticalSectionCount: input.criticalSectionCount,
      routingResolution: input.routeResolution.resolution,
      assetsCacheState: input.assetsCacheState,
      selectedAssetCacheState: input.selectedAssetCacheState,
      leverageCacheState: input.leverageCacheState,
    };

    if (
      input.degradedSections.length ||
      input.timeoutSections.length ||
      input.warningCount ||
      input.criticalSectionCount
    ) {
      log.warn('overview request assembled with operator warnings', payload);
      return;
    }

    log.info('overview request assembled', payload);
  }

  private describeFreshness(freshness: OverviewSectionFreshness | null | undefined): string {
    if (!freshness || freshness.ageMs === null) {
      return 'time unknown';
    }

    const ageLabel = this.describeDurationMs(freshness.ageMs);
    if (freshness.state === 'critical') {
      return `${ageLabel} old, beyond the critical threshold`;
    }
    if (freshness.state === 'stale') {
      return `${ageLabel} old, beyond the stale threshold`;
    }
    return `${ageLabel} old`;
  }

  private describeDurationMs(value: number): string {
    if (!Number.isFinite(value) || value <= 0) {
      return '0m';
    }

    const minutes = Math.max(1, Math.round(value / 60_000));
    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (!remainingMinutes) {
      return `${hours}h`;
    }

    return `${hours}h ${remainingMinutes}m`;
  }

  private createSectionProvenance(
    base: Omit<
      OverviewSectionProvenance,
      | 'observedAt'
      | 'availability'
      | 'requestStatus'
      | 'fetchMode'
      | 'statusDetail'
      | 'timeoutMs'
      | 'freshness'
      | 'cache'
    >,
    runtime: SectionProvenanceRuntime
  ): OverviewSectionProvenance {
    return {
      ...base,
      observedAt: runtime.observedAt,
      availability: runtime.availability,
      requestStatus: runtime.requestStatus,
      fetchMode: runtime.fetchMode,
      statusDetail: runtime.statusDetail,
      timeoutMs: runtime.timeoutMs ?? null,
      freshness: runtime.freshness ?? null,
      cache: runtime.cache ?? this.getNonCachedSectionMetadata(),
    };
  }

  private buildFreshness(
    observedAt: string | null,
    staleAfterMs: number | null,
    criticalAfterMs: number | null
  ): OverviewSectionFreshness {
    if (!observedAt) {
      return {
        state: 'unknown',
        ageMs: null,
        staleAfterMs,
        criticalAfterMs,
      };
    }

    const observedMs = new Date(observedAt).getTime();
    if (!Number.isFinite(observedMs)) {
      return {
        state: 'unknown',
        ageMs: null,
        staleAfterMs,
        criticalAfterMs,
      };
    }

    const ageMs = Math.max(0, Date.now() - observedMs);
    const state =
      criticalAfterMs !== null && ageMs > criticalAfterMs
        ? 'critical'
        : staleAfterMs !== null && ageMs > staleAfterMs
          ? 'stale'
          : 'fresh';

    return {
      state,
      ageMs,
      staleAfterMs,
      criticalAfterMs,
    };
  }

  private getNonCachedSectionMetadata(): OverviewSectionProvenance['cache'] {
    return {
      enabled: false,
      state: 'not_applicable',
      cachedAt: null,
      ttlMs: null,
      staleTtlMs: null,
      detail: 'Section does not use an overview reference cache.',
    };
  }

  private buildReferenceCacheMetadata<T>(
    result: ReferenceSectionLoadResult<T>
  ): OverviewSectionProvenance['cache'] {
    return {
      enabled: true,
      state: result.cacheState,
      cachedAt: result.cacheObservedAt,
      ttlMs: this.referenceCacheTtlMs,
      staleTtlMs: this.referenceCacheStaleTtlMs,
      detail: result.cacheDetail,
    };
  }

  private resolveReferenceObservedAt(
    cacheState: OverviewSectionCacheState,
    cacheObservedAt: string | null,
    generatedAt: string
  ): string {
    return cacheState === 'fresh-cache-fallback' || cacheState === 'stale-cache-fallback'
      ? cacheObservedAt || generatedAt
      : generatedAt;
  }

  private buildAssetsCacheKey(
    brokerKey: string,
    query: Pick<OverviewQuery, 'sort' | 'order'>
  ): string {
    return JSON.stringify({
      brokerKey,
      sort: String(query.sort || 'default').trim().toLowerCase(),
      order: String(query.order || 'default').trim().toLowerCase(),
      limit: ASSETS_LIMIT,
    });
  }

  private getFreshReferenceCache<T>(
    cache: Map<string, ReferenceCacheEntry<T>>,
    cacheKey: string
  ): ReferenceCacheEntry<T> | null {
    const entry = cache.get(cacheKey);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      return null;
    }
    return entry;
  }

  private getStaleReferenceCache<T>(
    cache: Map<string, ReferenceCacheEntry<T>>,
    cacheKey: string
  ): ReferenceCacheEntry<T> | null {
    const entry = cache.get(cacheKey);
    if (!entry) {
      return null;
    }
    if (entry.staleExpiresAt <= Date.now()) {
      cache.delete(cacheKey);
      return null;
    }
    return entry;
  }

  private setReferenceCache<T>(
    cache: Map<string, ReferenceCacheEntry<T>>,
    cacheKey: string,
    value: T
  ): number {
    const cachedAt = Date.now();
    cache.set(cacheKey, {
      value,
      cachedAt,
      expiresAt: cachedAt + this.referenceCacheTtlMs,
      staleExpiresAt: cachedAt + this.referenceCacheStaleTtlMs,
    });
    this.pruneReferenceCache(cache);
    return cachedAt;
  }

  private pruneReferenceCache<T>(cache: Map<string, ReferenceCacheEntry<T>>): void {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
      if (value.staleExpiresAt <= now) {
        cache.delete(key);
      }
    }

    if (cache.size <= this.referenceCacheMaxEntries) {
      return;
    }

    const overflow = [...cache.entries()]
      .sort((left, right) => left[1].staleExpiresAt - right[1].staleExpiresAt)
      .slice(0, cache.size - this.referenceCacheMaxEntries);

    for (const [key] of overflow) {
      cache.delete(key);
    }
  }

  private async loadCachedReferenceSection<T>(
    sectionKey: OverviewSectionKey,
    options: {
      cache: Map<string, ReferenceCacheEntry<T>>;
      cacheKey: string;
      defaultValue: T;
      run?: () => Promise<T>;
      successDetail: string;
      freshFallbackDetail: string;
      staleFallbackDetail: string;
      skip?: boolean;
      skipDetail?: string;
      timeoutMs?: number;
    }
  ): Promise<ReferenceSectionLoadResult<T>> {
    if (options.skip || !options.run) {
      return {
        value: options.defaultValue,
        requestStatus: 'ok',
        fetchMode: 'skipped',
        statusDetail: options.skipDetail || 'Skipped for this overview request.',
        timeoutMs: null,
        timedOut: false,
        cacheState: 'not_applicable',
        cacheObservedAt: null,
        cacheDetail: 'Reference cache was not used for this overview request.',
      };
    }

    try {
      const value = await options.run();
      const cachedAt = this.setReferenceCache(options.cache, options.cacheKey, value);
      return {
        value,
        requestStatus: 'ok',
        fetchMode: 'primary',
        statusDetail: options.successDetail,
        timeoutMs: options.timeoutMs ?? null,
        timedOut: false,
        cacheState: 'live',
        cacheObservedAt: new Date(cachedAt).toISOString(),
        cacheDetail: 'Live reference data succeeded and the overview fallback cache was refreshed.',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const timedOut = this.isTimeoutError(error);
      const freshCache = this.getFreshReferenceCache(options.cache, options.cacheKey);
      const staleCache = freshCache
        ? null
        : this.getStaleReferenceCache(options.cache, options.cacheKey);
      const cacheEntry = freshCache || staleCache;

      if (cacheEntry) {
        const staleFallback = cacheEntry === staleCache;
        return {
          value: cacheEntry.value,
          requestStatus: 'degraded',
          fetchMode: 'fallback',
          statusDetail: staleFallback
            ? options.staleFallbackDetail
            : options.freshFallbackDetail,
          timeoutMs: options.timeoutMs ?? null,
          timedOut,
          cacheState: staleFallback ? 'stale-cache-fallback' : 'fresh-cache-fallback',
          cacheObservedAt: new Date(cacheEntry.cachedAt).toISOString(),
          cacheDetail: staleFallback
            ? `Live ${this.describeSectionKey(sectionKey)} degraded, so a stale cached fallback response was reused.`
            : `Live ${this.describeSectionKey(sectionKey)} degraded, so a recent cached fallback response was reused.`,
        };
      }

      log.warn(`overview ${sectionKey} degraded`, {
        error: errorMessage,
        timeoutMs: options.timeoutMs ?? null,
        timedOut,
        cacheFallback: false,
      });

      return {
        value: options.defaultValue,
        requestStatus: 'degraded',
        fetchMode: 'primary',
        statusDetail: timedOut
          ? `${this.describeSectionKey(sectionKey)} timed out and no cached reference response was available.`
          : `${this.describeSectionKey(sectionKey)} degraded: ${errorMessage}`,
        timeoutMs: options.timeoutMs ?? null,
        timedOut,
        cacheState: 'unavailable',
        cacheObservedAt: null,
        cacheDetail: 'Live reference data degraded and no cached fallback response was available.',
      };
    }
  }

  private async loadSection<T>(
    sectionKey: OverviewSectionKey,
    options: {
      defaultValue: T;
      run?: () => Promise<T>;
      fallback?: () => Promise<T>;
      successDetail: string;
      fallbackDetail?: string;
      skip?: boolean;
      skipDetail?: string;
      timeoutMs?: number;
    }
  ): Promise<SectionLoadResult<T>> {
    if (options.skip || !options.run) {
      return {
        value: options.defaultValue,
        requestStatus: 'ok',
        fetchMode: 'skipped',
        statusDetail: options.skipDetail || 'Skipped for this overview request.',
        timeoutMs: null,
        timedOut: false,
      };
    }

    try {
      const value = await options.run();
      return {
        value,
        requestStatus: 'ok',
        fetchMode: 'primary',
        statusDetail: options.successDetail,
        timeoutMs: options.timeoutMs ?? null,
        timedOut: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const timedOut = this.isTimeoutError(error);

      if (options.fallback) {
        try {
          const fallbackValue = await options.fallback();
          return {
            value: fallbackValue,
            requestStatus: 'degraded',
            fetchMode: 'fallback',
            statusDetail:
              options.fallbackDetail ||
              `Primary ${this.describeSectionKey(sectionKey)} dependency degraded: ${errorMessage}`,
            timeoutMs: options.timeoutMs ?? null,
            timedOut,
          };
        } catch (fallbackError) {
          log.warn(`overview ${sectionKey} fallback failed`, {
            error: errorMessage,
            fallbackError:
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }

      log.warn(`overview ${sectionKey} degraded`, {
        error: errorMessage,
        timeoutMs: options.timeoutMs ?? null,
        timedOut,
      });

      return {
        value: options.defaultValue,
        requestStatus: 'degraded',
        fetchMode: 'primary',
        statusDetail: timedOut
          ? `${this.describeSectionKey(sectionKey)} timed out and no fallback response was available.`
          : `${this.describeSectionKey(sectionKey)} degraded: ${errorMessage}`,
        timeoutMs: options.timeoutMs ?? null,
        timedOut,
      };
    }
  }

  private async runSupportTask<T>(
    taskName: string,
    run: () => Promise<T>
  ): Promise<SupportTaskResult<T | null>> {
    try {
      return {
        value: await run(),
        errorMessage: null,
      };
    } catch (error) {
      log.warn(`overview ${taskName} support task degraded`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        value: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveBrokerRouteSafely(userId: string): Promise<ResolvedOverviewRoute> {
    try {
      const route = await this.resolveBrokerRoute(userId);
      return {
        route,
        resolution: 'resolved',
        detail: route.accountId
          ? 'Resolved the default connected broker account for this overview request.'
          : 'No connected account was set as default, so the overview is using the broker-level mudrex route.',
        degraded: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.warn('overview broker route degraded to default mudrex route', {
        error: errorMessage,
      });

      return {
        route: { brokerKey: 'mudrex' },
        resolution: 'fallback_default_broker',
        detail: `Broker routing degraded, so the overview fell back to the default mudrex route: ${errorMessage}`,
        degraded: true,
      };
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    return new Promise<T>((resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new ServiceUnavailableAppError(timeoutMessage));
      }, timeoutMs);

      promise
        .then((value) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          resolve(value);
        })
        .catch((error) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          reject(error);
        });
    });
  }

  private extractData<T>(value: T | { data?: T } | null | undefined): T | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'object' && value !== null && 'data' in value) {
      return (value as { data?: T }).data ?? null;
    }

    return value as T;
  }

  private parseSnapshotJson<T>(value: unknown): T | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'object') {
      return value as T;
    }

    try {
      return JSON.parse(String(value)) as T;
    } catch {
      return null;
    }
  }

  private mapPortfolioSummaryFromSnapshot(snapshot: PortfolioSnapshot | null): OverviewResponse['portfolioSummary'] | null {
    if (!snapshot) {
      return null;
    }

    const largest = [...(snapshot.holdings ?? [])].sort(
      (a, b) => b.allocationPct - a.allocationPct
    )[0];

    return {
      equity: snapshot.equity,
      dayPnL: snapshot.dayPnL,
      netExposure: snapshot.netExposure ?? '--',
      diversification: snapshot.diversification ?? '--',
      portfolioValue: `$${Math.round(snapshot.equity).toLocaleString('en-US')}`,
      netPnl: `${snapshot.dayPnL >= 0 ? '+' : '-'}$${Math.round(
        Math.abs(snapshot.dayPnL)
      ).toLocaleString('en-US')}`,
      holdings: snapshot.holdings?.length ?? 0,
      largestWeight: largest ? `${largest.allocationPct}%` : '--',
      largestWeightLabel: largest?.symbol ?? '--',
      assetAllocation: snapshot.assetAllocation ?? '--',
      strategyMix: snapshot.strategyMix ?? '--',
      riskPosture: snapshot.riskPosture ?? '--',
      accountCurve: snapshot.accountCurve ?? '--',
      monthlyPace: snapshot.monthlyPace ?? '--',
    };
  }

  private mapPortfolioHoldingsFromSnapshot(
    snapshot: PortfolioSnapshot | null
  ): OverviewResponse['portfolioHoldings'] | null {
    if (!snapshot) {
      return null;
    }

    const holdings = [...(snapshot.holdings ?? [])].sort(
      (a, b) => b.marketValue - a.marketValue
    );

    return {
      items: holdings.slice(0, HOLDINGS_LIMIT).map((holding) => this.mapPortfolioHolding(holding)),
      total: holdings.length,
      limit: HOLDINGS_LIMIT,
      offset: 0,
    };
  }

  private mapPortfolioHolding(holding: PortfolioHoldingEntity): OverviewResponse['portfolioHoldings']['items'][number] {
    return {
      id: holding.id,
      symbol: holding.symbol,
      quantity: holding.quantity,
      marketValue: holding.marketValue,
      allocationPct: holding.allocationPct,
      dayPnL: holding.dayPnL,
      unrealizedPnL: holding.unrealizedPnL,
      side: this.normalizeHoldingSide(holding.side),
      strategy: holding.strategy,
      riskState: this.normalizeHoldingRiskState(holding.riskState),
      sleeve: holding.sleeve,
      contribution: holding.contribution ?? undefined,
      lastRebalanceAt: holding.lastRebalanceAt?.toISOString?.(),
    };
  }

  private normalizeHoldingSide(value: string): 'Long' | 'Short' | 'Hedged' {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'short') {
      return 'Short';
    }
    if (normalized === 'hedged') {
      return 'Hedged';
    }
    return 'Long';
  }

  private normalizeHoldingRiskState(value: string): 'Healthy' | 'Watch' | 'At risk' {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'watch') {
      return 'Watch';
    }
    if (normalized === 'at risk') {
      return 'At risk';
    }
    return 'Healthy';
  }

  private getDefaultAutomationsResponse(): OverviewResponse['automations'] {
    return {
      items: [],
      total: 0,
      limit: AUTOMATIONS_LIMIT,
      offset: 0,
    };
  }

  private getDefaultAutomationsSummary(): OverviewResponse['automationsSummary'] {
    return {
      running: 0,
      paused: 0,
      connectedAccounts: 0,
      health: '--',
    };
  }

  private getDefaultAlertsResponse(): OverviewResponse['alerts'] {
    return {
      items: [],
      total: 0,
      limit: ALERTS_LIMIT,
      offset: 0,
    };
  }

  private getDefaultAlertsSummary(): OverviewResponse['alertsSummary'] {
    return {
      openAlerts: 0,
      acknowledged: 0,
      highSeverityAlerts: 0,
      criticalSeverity: 0,
      watchlistCapable: 'No',
    };
  }

  private getDefaultSignalsResponse(): OverviewResponse['signals'] {
    return {
      items: [],
      total: 0,
      limit: SIGNALS_LIMIT,
      offset: 0,
    };
  }

  private getDefaultSignalsSummary(): OverviewResponse['signalsSummary'] {
    return {
      liveSignals: 0,
      triggered: 0,
      watching: 0,
      queued: 0,
      muted: 0,
      highConfidence: 0,
      mutedOrQueued: 0,
    };
  }

  private getDefaultPortfolioSummary(): OverviewResponse['portfolioSummary'] {
    return {
      equity: 0,
      dayPnL: 0,
      netExposure: '--',
      diversification: '--',
    };
  }

  private getDefaultPortfolioHoldingsResponse(): OverviewResponse['portfolioHoldings'] {
    return {
      items: [],
      total: 0,
      limit: HOLDINGS_LIMIT,
      offset: 0,
    };
  }

  private getDefaultActiveFundsResponse(): PortfolioActiveFundsResponse {
    return {
      source: 'funds_snapshots via broker_wallet_facade',
      definition:
        'Latest stored funds snapshot per connected account, normalized for wallet and futures capital review.',
      freshnessModel: 'funds_snapshot_timestamp',
      latestObservedAt: null,
      latestObservedAtIso: null,
      oldestObservedAt: null,
      oldestObservedAtIso: null,
      walletItems: [],
      futuresItems: [],
    };
  }

  private buildActiveFundsResponse(input: {
    walletFundsPayload: unknown;
    futuresFundsPayload: unknown;
  }): PortfolioActiveFundsResponse {
    const walletItems = this.normalizeActiveFundsPayload(input.walletFundsPayload);
    const futuresItems = this.normalizeActiveFundsPayload(input.futuresFundsPayload);
    const latestObservedAtIso = this.pickLatestObservedTimestamp([
      ...walletItems.map((item) => item.observedAtIso || item.observedAt || null),
      ...futuresItems.map((item) => item.observedAtIso || item.observedAt || null),
    ]);
    const oldestObservedAtIso = this.pickOldestObservedTimestamp([
      ...walletItems.map((item) => item.observedAtIso || item.observedAt || null),
      ...futuresItems.map((item) => item.observedAtIso || item.observedAt || null),
    ]);

    return {
      source: 'funds_snapshots via broker_wallet_facade',
      definition:
        'Latest stored funds snapshot per connected account, normalized for wallet and futures capital review.',
      freshnessModel: 'funds_snapshot_timestamp',
      latestObservedAt: latestObservedAtIso,
      latestObservedAtIso,
      oldestObservedAt: oldestObservedAtIso,
      oldestObservedAtIso,
      walletItems,
      futuresItems,
    };
  }

  private normalizeActiveFundsPayload(
    payload: unknown
  ): PortfolioActiveFundsResponse['walletItems'] {
    const raw = payload as { items?: unknown[]; data?: { items?: unknown[] } };
    const items =
      (Array.isArray(raw?.items) && raw.items) ||
      (Array.isArray(raw?.data?.items) && raw.data?.items) ||
      (Array.isArray(raw) ? raw : []);

    return items.map((item) => this.normalizeActiveFundsItem(item));
  }

  private normalizeActiveFundsItem(item: unknown): PortfolioActiveFundsResponse['walletItems'][number] {
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
    const observedAtIso = this.toIsoString(safe.observedAt || safe.observed_at);
    const funds = rawFunds as Record<string, unknown>;

    return {
      accountId: String(safe.accountId || safe.account_id || ''),
      accountName: String(safe.accountName || safe.account_name || ''),
      accountKey: String(safe.accountKey || safe.account_key || ''),
      brokerKey: String(safe.brokerKey || safe.broker_key || ''),
      status: String(safe.status || ''),
      observedAt: observedAtIso,
      observedAtIso,
      error: safe.error ? String(safe.error) : null,
      funds: {
        balance: this.toNumber(
          funds.balance ??
            funds.total ??
            funds.equity ??
            funds.wallet_balance ??
            funds.futures_equity ??
            funds.withdrawable
        ),
        available: this.toNumber(
          funds.available ??
            funds.withdrawable ??
            funds.free ??
            funds.available_balance ??
            funds.coin_investable
        ),
        invested: this.toNumber(
          funds.invested ??
            funds.locked_amount ??
            funds.locked ??
            funds.used_margin ??
            funds.margin_used
        ),
      },
    };
  }

  private hasActiveFundsError(activeFunds: PortfolioActiveFundsResponse): boolean {
    return [...activeFunds.walletItems, ...activeFunds.futuresItems].some((item) => Boolean(item.error));
  }

  private normalizeOptionalSymbol(value: unknown): string {
    return String(value || '').trim().toUpperCase();
  }

  private pickLatestTimestamp(...values: Array<string | null | undefined>): string | null {
    for (const value of values) {
      const normalized = String(value || '').trim();
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  private pickLatestObservedTimestamp(values: Array<string | null | undefined>): string | null {
    const timestamps = values
      .map((value) => this.toTimestamp(value))
      .filter((value): value is number => value !== null)
      .sort((left, right) => right - left);

    return timestamps.length ? new Date(timestamps[0]).toISOString() : null;
  }

  private pickOldestObservedTimestamp(values: Array<string | null | undefined>): string | null {
    const timestamps = values
      .map((value) => this.toTimestamp(value))
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);

    return timestamps.length ? new Date(timestamps[0]).toISOString() : null;
  }

  private describeSectionKey(sectionKey: OverviewSectionKey): string {
    switch (sectionKey) {
      case 'walletFunds':
        return 'wallet funds';
      case 'futuresFunds':
        return 'futures funds';
      case 'selectedAsset':
        return 'selected asset detail';
      case 'automationsSummary':
        return 'automation summary';
      case 'alertsSummary':
        return 'alert summary';
      case 'signalsSummary':
        return 'signal summary';
      case 'portfolioSummary':
        return 'portfolio summary';
      case 'portfolioHoldings':
        return 'portfolio holdings';
      case 'activeFunds':
        return 'capital routes';
      default:
        return sectionKey.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
    }
  }

  private toIsoString(value: unknown): string | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    const timestamp = date.getTime();
    return Number.isFinite(timestamp) ? date.toISOString() : null;
  }

  private toTimestamp(value: unknown): number | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(String(value));
    const timestamp = date.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private toNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private isTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /timed out/i.test(message);
  }

  private async resolveBrokerRoute(userId: string): Promise<{ brokerKey: string; accountId?: string }> {
    const accounts = await this.brokerAccountRepository.getConnectedBrokerAccounts(userId);
    if (!accounts.length) {
      return { brokerKey: 'mudrex' };
    }
    const preferred = accounts.find((account) => account.isDefault) || accounts[0];
    return {
      brokerKey: preferred.brokerKey,
      accountId: preferred.id,
    };
  }
}
