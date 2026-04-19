export type CoverageLane = 'baseline' | 'module-only' | 'cross-cutting' | 'aggregate-only';

export type ScriptSurface = {
  key?: string;
  file?: string;
};

export type CoverageModule = {
  key: string;
  label: string;
  lane: CoverageLane;
  controllers: string[];
  services: string[];
  tests: ScriptSurface[];
  checks?: ScriptSurface[];
  proofs?: ScriptSurface[];
  releaseGates?: ScriptSurface[];
  signoffs?: ScriptSurface[];
  smokes?: ScriptSurface[];
  captures?: ScriptSurface[];
  notes?: string[];
};

const script = (key: string, file?: string): ScriptSurface => ({ key, ...(file ? { file } : {}) });
const fileOnly = (file: string): ScriptSurface => ({ file });

export const COVERAGE_MODULES: CoverageModule[] = [
  {
    key: 'activity',
    label: 'Activity',
    lane: 'baseline',
    controllers: ['ActivityController.ts'],
    services: [
      'ActivityService.ts',
      'ActivityMaintenanceService.ts',
      'ActivityExportProcessorService.ts',
      'ActivityExportStorageService.ts',
    ],
    tests: [script('test:activity', 'scripts/test-activity.ts')],
    checks: [
      script('check:activity-health', 'scripts/checks/check-activity-health.ts'),
    ],
    releaseGates: [script('release-gate:activity', 'scripts/release-gates/release-gate-activity.ts')],
    signoffs: [script('signoff:activity', 'scripts/signoffs/signoff-activity.ts')],
  },
  {
    key: 'alerts',
    label: 'Alerts',
    lane: 'baseline',
    controllers: [
      'AlertsController.ts',
      'AlertsOverviewController.ts',
      'RiskAlertsOverviewController.ts',
    ],
    services: ['AlertsService.ts', 'AlertsOverviewService.ts', 'RiskAlertsOverviewService.ts'],
    tests: [script('test:alerts', 'scripts/test-alerts.ts')],
    checks: [script('check:alerts-health', 'scripts/checks/check-alerts-health.ts')],
    releaseGates: [script('release-gate:alerts', 'scripts/release-gates/release-gate-alerts.ts')],
    signoffs: [script('signoff:alerts', 'scripts/signoffs/signoff-alerts.ts')],
  },
  {
    key: 'asset-price-sync',
    label: 'Asset Price Sync',
    lane: 'baseline',
    controllers: ['AssetPriceSchedulerController.ts'],
    services: ['AssetPriceSchedulerService.ts'],
    tests: [script('test:asset-price-sync', 'scripts/test-asset-price-sync.ts')],
    checks: [script('check:asset-price-sync-health', 'scripts/checks/check-asset-price-sync-health.ts')],
    proofs: [script('proof:asset-price-sync-live', 'scripts/proofs/proof-asset-price-sync-live.ts')],
    releaseGates: [
      script('release-gate:asset-price-sync', 'scripts/release-gates/release-gate-asset-price-sync.ts'),
    ],
    signoffs: [script('signoff:asset-price-sync', 'scripts/signoffs/signoff-asset-price-sync.ts')],
    captures: [
      script(
        'capture:asset-price-sync-evidence',
        'scripts/capture/capture-asset-price-sync-evidence.ts'
      ),
    ],
  },
  {
    key: 'assets',
    label: 'Assets',
    lane: 'baseline',
    controllers: [
      'AssetsController.ts',
      'BinanceAssetsSchedulerController.ts',
      'CandlesSchedulerController.ts',
      'CryptoAssetsController.ts',
      'ExchangeAssetsController.ts',
    ],
    services: [
      'BinanceAssetsSchedulerService.ts',
      'CandlesSchedulerService.ts',
      'ExchangeAssetsService.ts',
    ],
    tests: [script('test:assets', 'scripts/test-assets.ts')],
    checks: [script('check:assets-health', 'scripts/checks/check-assets-health.ts')],
  },
  {
    key: 'auth',
    label: 'Auth',
    lane: 'baseline',
    controllers: ['AuthController.ts'],
    services: ['AuthService.ts', 'AuthLoginProtectionService.ts'],
    tests: [
      script('test:auth-contract', 'scripts/test-auth-contract.ts'),
      script('test:auth-security', 'scripts/test-auth-security.ts'),
    ],
    checks: [script('check:auth-health', 'scripts/checks/check-auth-health.ts')],
    releaseGates: [script('release-gate:auth', 'scripts/release-gates/release-gate-auth.ts')],
    signoffs: [script('signoff:auth', 'scripts/signoffs/signoff-auth.ts')],
  },
  {
    key: 'automations',
    label: 'Automations',
    lane: 'baseline',
    controllers: ['AutomationsController.ts', 'InternalAutomationsController.ts'],
    services: [
      'AutomationsService.ts',
      'AutomationExecutionService.ts',
      'AutomationSignalEvaluatorService.ts',
    ],
    tests: [
      script('test:automations', 'scripts/test-automations.ts'),
      script('test:automation-type', 'scripts/test-automation-type-utils.ts'),
    ],
    checks: [
      script('check:automations-health', 'scripts/checks/check-automations-health.ts'),
    ],
    proofs: [script('proof:automations-live', 'scripts/proofs/proof-automations-live.ts')],
    releaseGates: [script('release-gate:automations', 'scripts/release-gates/release-gate-automations.ts')],
    signoffs: [script('signoff:automations', 'scripts/signoffs/signoff-automations.ts')],
    smokes: [script('smoke:automations-lifecycle', 'scripts/smokes/smoke-automations-lifecycle.ts')],
  },
  {
    key: 'backtests',
    label: 'Backtests',
    lane: 'baseline',
    controllers: ['BacktestsController.ts'],
    services: [
      'BacktestsService.ts',
      'BacktestChartService.ts',
      'BacktestPromotionService.ts',
      'BacktestReadModelService.ts',
      'BacktestRecoveryService.ts',
      'BacktestSnapshotService.ts',
      'BacktestTopSetupsService.ts',
    ],
    tests: [script('test:backtests', 'scripts/test-backtests.ts')],
    checks: [script('check:backtests-health', 'scripts/checks/check-backtests-health.ts')],
    proofs: [script('proof:backtests-live', 'scripts/proofs/proof-backtests-live.ts')],
    releaseGates: [script('release-gate:backtests', 'scripts/release-gates/release-gate-backtests.ts')],
    signoffs: [script('signoff:backtests', 'scripts/signoffs/signoff-backtests.ts')],
    smokes: [script('smoke:backtests-lifecycle', 'scripts/smokes/smoke-backtests-lifecycle.ts')],
  },
  {
    key: 'broker-accounts',
    label: 'Broker Accounts',
    lane: 'baseline',
    controllers: [
      'BrokerAccountsController.ts',
      'BrokerDefinitionsController.ts',
      'InternalBrokerAccountsController.ts',
    ],
    services: ['BrokerAccountsService.ts', 'BrokerDefinitionsService.ts'],
    tests: [script('test:broker-accounts', 'scripts/test-broker-accounts.ts')],
    checks: [
      script('check:broker-accounts-health', 'scripts/checks/check-broker-accounts-health.ts'),
    ],
    releaseGates: [
      script(
        'release-gate:broker-accounts',
        'scripts/release-gates/release-gate-broker-accounts.ts'
      ),
    ],
    signoffs: [script('signoff:broker-accounts', 'scripts/signoffs/signoff-broker-accounts.ts')],
  },
  {
    key: 'broker-assets',
    label: 'Broker Assets',
    lane: 'module-only',
    controllers: ['SchedulerController.ts'],
    services: ['SchedulerService.ts', 'BrokerReferenceDataService.ts'],
    tests: [script('test:broker-assets', 'scripts/test-broker-assets.ts')],
    checks: [script('check:broker-assets-health', 'scripts/checks/check-broker-assets-health.ts')],
    proofs: [script('proof:broker-assets-live', 'scripts/proofs/proof-broker-assets-live.ts')],
    releaseGates: [script('release-gate:broker-assets', 'scripts/release-gates/release-gate-broker-assets.ts')],
    signoffs: [script('signoff:broker-assets', 'scripts/signoffs/signoff-broker-assets.ts')],
    captures: [
      script('capture:broker-assets-evidence', 'scripts/capture/capture-broker-assets-evidence.ts'),
    ],
  },
  {
    key: 'connections',
    label: 'Connections',
    lane: 'baseline',
    controllers: ['ConnectionsController.ts'],
    services: ['ConnectionsService.ts'],
    tests: [script('test:connections', 'scripts/test-connections.ts')],
    checks: [script('check:connections-health', 'scripts/checks/check-connections-health.ts')],
    releaseGates: [script('release-gate:connections', 'scripts/release-gates/release-gate-connections.ts')],
    signoffs: [script('signoff:connections', 'scripts/signoffs/signoff-connections.ts')],
  },
  {
    key: 'discovery',
    label: 'Discovery',
    lane: 'baseline',
    controllers: ['DiscoveryController.ts'],
    services: ['DiscoveryDependencyService.ts', 'DiscoveryFeedService.ts', 'DiscoverySummaryService.ts'],
    tests: [script('test:discovery', 'scripts/test-discovery.ts')],
    releaseGates: [script('release-gate:discovery', 'scripts/release-gates/release-gate-discovery.ts')],
    smokes: [
      script('smoke:discovery-contract', 'scripts/smokes/smoke-discovery-contract.ts'),
      script('smoke:discovery-dependency', 'scripts/smokes/smoke-discovery-dependency.ts'),
    ],
  },
  {
    key: 'email-deliveries',
    label: 'Email Deliveries',
    lane: 'baseline',
    controllers: ['EmailDeliveriesController.ts'],
    services: ['EmailDeliveriesService.ts'],
    tests: [script('test:email-deliveries', 'scripts/test-email-deliveries.ts')],
  },
  {
    key: 'funds-scheduler',
    label: 'Funds Scheduler',
    lane: 'cross-cutting',
    controllers: ['FundsSchedulerController.ts', 'InternalFundsSchedulerController.ts'],
    services: ['FundsSchedulerService.ts'],
    tests: [script('test:funds-scheduler', 'scripts/test-funds-scheduler.ts')],
    checks: [script('check:funds-scheduler-health', 'scripts/checks/check-funds-scheduler-health.ts')],
    proofs: [
      script('proof:funds-scheduler-live', 'scripts/proofs/proof-funds-scheduler-live.ts'),
      script(
        'proof:funds-scheduler-promotion',
        'scripts/proofs/proof-funds-scheduler-promotion.ts'
      ),
    ],
    releaseGates: [
      script(
        'release-gate:funds-scheduler',
        'scripts/release-gates/release-gate-funds-scheduler.ts'
      ),
    ],
    signoffs: [script('signoff:funds-scheduler', 'scripts/signoffs/signoff-funds-scheduler.ts')],
  },
  {
    key: 'funds-snapshots',
    label: 'Funds Snapshots',
    lane: 'baseline',
    controllers: ['FundsSnapshotsController.ts'],
    services: [],
    tests: [script('test:funds-snapshots', 'scripts/test-funds-snapshots.ts')],
    checks: [
      script('check:funds-snapshots-health', 'scripts/checks/check-funds-snapshots-health.ts'),
    ],
  },
  {
    key: 'global-system-schedulers',
    label: 'Global System Schedulers',
    lane: 'baseline',
    controllers: ['HealthCheckSchedulerController.ts', 'SchedulerOverviewController.ts'],
    services: ['HealthCheckSchedulerService.ts', 'SchedulerOverviewService.ts'],
    tests: [
      script('test:global-system-schedulers', 'scripts/test-global-system-schedulers-suite.ts'),
      fileOnly('scripts/test-global-system-schedulers.ts'),
    ],
    checks: [
      script(
        'check:global-system-schedulers-health',
        'scripts/checks/check-global-system-schedulers-health.ts'
      ),
    ],
    proofs: [
      script(
        'proof:global-system-schedulers-live',
        'scripts/proofs/proof-global-system-schedulers-live.ts'
      ),
    ],
    releaseGates: [
      script(
        'release-gate:global-system-schedulers',
        'scripts/release-gates/release-gate-global-system-schedulers.ts'
      ),
    ],
    signoffs: [
      script(
        'signoff:global-system-schedulers',
        'scripts/signoffs/signoff-global-system-schedulers.ts'
      ),
    ],
    captures: [
      script(
        'capture:global-system-schedulers-evidence',
        'scripts/capture/capture-global-system-schedulers-evidence.ts'
      ),
    ],
  },
  {
    key: 'markets',
    label: 'Markets',
    lane: 'baseline',
    controllers: ['InternalMarketsSnapshotController.ts', 'MarketController.ts', 'MarketsOverviewController.ts'],
    services: [
      'BrokerMarketFacadeService.ts',
      'MarketMetricsService.ts',
      'MarketPriceRefreshService.ts',
      'MarketSnapshotRefreshService.ts',
      'MarketsOverviewService.ts',
    ],
    tests: [script('test:markets', 'scripts/test-markets.ts')],
    checks: [script('check:markets-health', 'scripts/checks/check-markets-health.ts')],
  },
  {
    key: 'operational',
    label: 'Operational',
    lane: 'aggregate-only',
    controllers: ['HealthController.ts', 'InternalRuntimeController.ts'],
    services: ['OperationalEventService.ts', 'RuntimeDiagnosticsService.ts'],
    tests: [
      script('test:operational'),
      script('test:operational-events', 'scripts/test-operational-events.ts'),
      script('test:operational-audit', 'scripts/test-operational-audit.ts'),
      script('test:runtime-recovery', 'scripts/test-runtime-recovery.ts'),
    ],
    checks: [script('check:runtime-health', 'scripts/checks/check-runtime-health.ts')],
    releaseGates: [
      script(
        'release-gate:runtime-recovery',
        'scripts/release-gates/release-gate-runtime-recovery.ts'
      ),
      script('release-gate:runtime-recovery:live'),
    ],
    signoffs: [
      script('signoff:runtime-recovery', 'scripts/signoffs/signoff-runtime-recovery.ts'),
      script('signoff:runtime-recovery:live'),
    ],
    smokes: [
      script('smoke:scheduler-health', 'scripts/smokes/smoke-scheduler-health.ts'),
      script('smoke:runtime-recovery', 'scripts/smokes/smoke-runtime-recovery.ts'),
    ],
    notes: [
      'Cross-cutting operational event plumbing intentionally remains outside the deterministic baseline.',
    ],
  },
  {
    key: 'orders',
    label: 'Orders',
    lane: 'baseline',
    controllers: ['OrdersController.ts', 'OrdersOverviewController.ts'],
    services: ['BrokerOrdersFacadeService.ts', 'OrdersOverviewService.ts', 'PaperOrderExecutionService.ts'],
    tests: [
      script('test:orders', 'scripts/test-orders.ts'),
      script('test:orders-contract', 'scripts/test-orders-contract.ts'),
      script('test:orders-live-proof', 'scripts/test-orders-live-proof.ts'),
    ],
    checks: [script('check:orders-health', 'scripts/checks/check-orders-health.ts')],
    proofs: [script('proof:orders-live', 'scripts/proofs/proof-orders-live.ts')],
    releaseGates: [script('release-gate:orders', 'scripts/release-gates/release-gate-orders.ts')],
    signoffs: [script('signoff:orders', 'scripts/signoffs/signoff-orders.ts')],
  },
  {
    key: 'orders-scheduler',
    label: 'Orders Scheduler',
    lane: 'cross-cutting',
    controllers: ['InternalOrdersSchedulerController.ts', 'OrdersSchedulerController.ts'],
    services: [
      'OrdersSchedulerService.ts',
      'OrdersSyncDiagnosticsService.ts',
      'PaperOrdersSchedulerService.ts',
      'SchedulerRuntimeSchemaService.ts',
    ],
    tests: [
      script('test:schedulers', 'scripts/test-schedulers.ts'),
      script('test:orders-scheduler'),
    ],
    checks: [
      script('check:orders-scheduler-health', 'scripts/checks/check-orders-scheduler-health.ts'),
    ],
    proofs: [
      script('proof:orders-scheduler-live', 'scripts/proofs/proof-orders-scheduler-live.ts'),
    ],
    releaseGates: [
      script(
        'release-gate:orders-scheduler',
        'scripts/release-gates/release-gate-orders-scheduler.ts'
      ),
    ],
    signoffs: [script('signoff:orders-scheduler', 'scripts/signoffs/signoff-orders-scheduler.ts')],
  },
  {
    key: 'overview',
    label: 'Overview',
    lane: 'baseline',
    controllers: ['OverviewController.ts'],
    services: ['OverviewService.ts'],
    tests: [
      script('test:overview', 'scripts/test-overview.ts'),
      script('test:overview-contract', 'scripts/test-overview-contract.ts'),
      script('test:overview-resilience', 'scripts/test-overview-resilience.ts'),
    ],
    checks: [script('check:overview-health', 'scripts/checks/check-overview-health.ts')],
    releaseGates: [script('release-gate:overview', 'scripts/release-gates/release-gate-overview.ts')],
    signoffs: [script('signoff:overview', 'scripts/signoffs/signoff-overview.ts')],
  },
  {
    key: 'portfolio',
    label: 'Portfolio',
    lane: 'cross-cutting',
    controllers: ['PortfolioController.ts', 'PortfolioOverviewController.ts'],
    services: ['PortfolioService.ts', 'PortfolioOverviewService.ts'],
    tests: [script('test:portfolio', 'scripts/test-portfolio.ts')],
    checks: [script('check:portfolio-health', 'scripts/checks/check-portfolio-health.ts')],
    proofs: [script('proof:portfolio-live', 'scripts/proofs/proof-portfolio-live.ts')],
    releaseGates: [script('release-gate:portfolio', 'scripts/release-gates/release-gate-portfolio.ts')],
    signoffs: [script('signoff:portfolio', 'scripts/signoffs/signoff-portfolio.ts')],
  },
  {
    key: 'positions',
    label: 'Positions',
    lane: 'cross-cutting',
    controllers: ['PositionsController.ts'],
    services: ['BrokerPositionsFacadeService.ts'],
    tests: [script('test:positions', 'scripts/test-positions.ts')],
    checks: [script('check:positions-health', 'scripts/checks/check-positions-health.ts')],
    releaseGates: [script('release-gate:positions', 'scripts/release-gates/release-gate-positions.ts')],
    signoffs: [script('signoff:positions', 'scripts/signoffs/signoff-positions.ts')],
  },
  {
    key: 'positions-orders-sync',
    label: 'Positions Orders Sync',
    lane: 'baseline',
    controllers: [],
    services: ['InternalOrdersSyncService.ts', 'InternalPositionsSyncService.ts'],
    tests: [script('test:positions-orders-sync', 'scripts/test-positions-orders-sync.ts')],
  },
  {
    key: 'positions-scheduler',
    label: 'Positions Scheduler',
    lane: 'cross-cutting',
    controllers: ['InternalPositionsSchedulerController.ts', 'PositionsSchedulerController.ts'],
    services: ['PositionsSchedulerService.ts'],
    tests: [script('test:positions-scheduler', 'scripts/test-positions-scheduler.ts')],
    checks: [
      script('check:positions-scheduler-health', 'scripts/checks/check-positions-scheduler-health.ts'),
    ],
    proofs: [
      script('proof:positions-scheduler-live', 'scripts/proofs/proof-positions-scheduler-live.ts'),
    ],
    releaseGates: [
      script(
        'release-gate:positions-scheduler',
        'scripts/release-gates/release-gate-positions-scheduler.ts'
      ),
    ],
    signoffs: [
      script('signoff:positions-scheduler', 'scripts/signoffs/signoff-positions-scheduler.ts'),
    ],
  },
  {
    key: 'risk-center',
    label: 'Risk Center',
    lane: 'cross-cutting',
    controllers: ['RiskController.ts', 'RiskOverviewController.ts'],
    services: ['RiskService.ts', 'RiskOverviewService.ts', 'RiskPreTradeService.ts'],
    tests: [
      script('test:risk-center', 'scripts/test-risk-center.ts'),
      script('test:risk-center-contract', 'scripts/test-risk-center-contract.ts'),
    ],
    checks: [script('check:risk-center-health', 'scripts/checks/check-risk-center-health.ts')],
    releaseGates: [
      script('release-gate:risk-center', 'scripts/release-gates/release-gate-risk-center.ts'),
    ],
    signoffs: [script('signoff:risk-center', 'scripts/signoffs/signoff-risk-center.ts')],
  },
  {
    key: 'risk-scheduler',
    label: 'Risk Scheduler',
    lane: 'baseline',
    controllers: ['InternalRiskSchedulerController.ts', 'RiskSchedulerController.ts'],
    services: ['RiskSchedulerService.ts'],
    tests: [script('test:risk-scheduler', 'scripts/test-risk-scheduler.ts')],
    checks: [script('check:risk-scheduler-health', 'scripts/checks/check-risk-scheduler-health.ts')],
    releaseGates: [
      script('release-gate:risk-scheduler', 'scripts/release-gates/release-gate-risk-scheduler.ts'),
    ],
    signoffs: [script('signoff:risk-scheduler', 'scripts/signoffs/signoff-risk-scheduler.ts')],
  },
  {
    key: 'scheduler-account-scope',
    label: 'Scheduler Account Scope',
    lane: 'baseline',
    controllers: [],
    services: [],
    tests: [script('test:scheduler-account-scope', 'scripts/test-scheduler-account-scope.ts')],
    checks: [
      script('check:scheduler-account-scope-live', 'scripts/checks/check-scheduler-account-scope-live.ts'),
    ],
    proofs: [
      script('proof:scheduler-account-scope-live', 'scripts/proofs/proof-scheduler-account-scope-live.ts'),
    ],
    releaseGates: [
      script(
        'release-gate:scheduler-account-scope',
        'scripts/release-gates/release-gate-scheduler-account-scope.ts'
      ),
    ],
    signoffs: [
      script('signoff:scheduler-account-scope', 'scripts/signoffs/signoff-scheduler-account-scope.ts'),
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    lane: 'baseline',
    controllers: ['SettingsController.ts'],
    services: ['SettingsService.ts'],
    tests: [script('test:settings', 'scripts/test-settings.ts')],
    checks: [script('check:settings-health', 'scripts/checks/check-settings-health.ts')],
    releaseGates: [script('release-gate:settings', 'scripts/release-gates/release-gate-settings.ts')],
    signoffs: [script('signoff:settings', 'scripts/signoffs/signoff-settings.ts')],
  },
  {
    key: 'signals',
    label: 'Signals',
    lane: 'module-only',
    controllers: [
      'InternalSignalsSchedulerController.ts',
      'SignalsAutomationController.ts',
      'SignalsController.ts',
      'SignalsOverviewController.ts',
    ],
    services: ['SignalScanService.ts', 'SignalsOverviewService.ts', 'SignalsSchedulerService.ts', 'SignalsService.ts'],
    tests: [script('test:signals', 'scripts/test-signals.ts')],
    checks: [script('check:signals-health', 'scripts/checks/check-signals-health.ts')],
    releaseGates: [script('release-gate:signals', 'scripts/release-gates/release-gate-signals.ts')],
    signoffs: [script('signoff:signals', 'scripts/signoffs/signoff-signals.ts')],
  },
  {
    key: 'strategy-core',
    label: 'Strategy Core',
    lane: 'baseline',
    controllers: ['StrategyController.ts'],
    services: ['StrategyService.ts'],
    tests: [script('test:strategy-core', 'scripts/test-strategy-core.ts')],
  },
  {
    key: 'strategy-library',
    label: 'Strategy Library',
    lane: 'baseline',
    controllers: [
      'InternalStrategyTemplatesController.ts',
      'StrategyLabController.ts',
      'StrategyLibraryController.ts',
      'StrategyTemplatesController.ts',
    ],
    services: ['StrategyLabService.ts', 'StrategyLibraryService.ts', 'StrategyTemplatesService.ts'],
    tests: [script('test:strategy-library', 'scripts/test-strategy-library.ts')],
    releaseGates: [
      script(
        'release-gate:strategy-library',
        'scripts/release-gates/release-gate-strategy-library.ts'
      ),
    ],
    smokes: [
      script(
        'smoke:strategy-library-lineage',
        'scripts/smokes/smoke-strategy-library-lineage.ts'
      ),
    ],
  },
  {
    key: 'suggested-trades',
    label: 'Suggested Trades',
    lane: 'baseline',
    controllers: ['SuggestedTradesController.ts', 'SuggestedTradesOverviewController.ts'],
    services: [
      'SuggestedTradesService.ts',
      'SuggestedTradesOverviewService.ts',
      'SuggestedTradesHealthService.ts',
      'SuggestedTradeExecutionSyncService.ts',
    ],
    tests: [
      script('test:suggested-trades', 'scripts/test-suggested-trades.ts'),
    ],
    checks: [
      script('check:suggested-trades-health', 'scripts/checks/check-suggested-trades-health.ts'),
      script(
        'check:broker-auto-canary-readiness',
        'scripts/checks/check-broker-auto-canary-readiness.ts'
      ),
    ],
    proofs: [
      script('proof:suggested-trades-live', 'scripts/proofs/proof-suggested-trades-live.ts'),
    ],
    releaseGates: [
      script(
        'release-gate:suggested-trades',
        'scripts/release-gates/release-gate-suggested-trades.ts'
      ),
    ],
    signoffs: [script('signoff:suggested-trades', 'scripts/signoffs/signoff-suggested-trades.ts')],
    smokes: [
      script(
        'smoke:suggested-trades-lifecycle',
        'scripts/smokes/smoke-suggested-trades-lifecycle.ts'
      ),
    ],
  },
  {
    key: 'timezones',
    label: 'Timezones',
    lane: 'cross-cutting',
    controllers: [],
    services: ['UserTimeZoneService.ts'],
    tests: [
      script('test:timezones'),
      script('test:legacy-scheduler-timezones', 'scripts/test-legacy-scheduler-timezones.ts'),
      script('test:mysql-session-timezone', 'scripts/test-mysql-session-timezone.ts'),
      script('test:api-display-timezones', 'scripts/test-api-display-timezones.ts'),
      script('test:timezone-boundaries', 'scripts/test-timezone-boundaries.ts'),
    ],
  },
  {
    key: 'wallets',
    label: 'Wallets',
    lane: 'baseline',
    controllers: ['LeverageController.ts', 'WalletController.ts'],
    services: ['BrokerWalletFacadeService.ts', 'BrokerWalletLiveFetchService.ts'],
    tests: [script('test:wallets', 'scripts/test-wallets.ts')],
    checks: [script('check:wallets-health', 'scripts/checks/check-wallets-health.ts')],
  },
  {
    key: 'watchlists',
    label: 'Watchlists',
    lane: 'baseline',
    controllers: ['WatchlistsController.ts'],
    services: ['WatchlistsService.ts'],
    tests: [script('test:watchlists', 'scripts/test-watchlists.ts')],
    checks: [script('check:watchlists-health', 'scripts/checks/check-watchlists-health.ts')],
    releaseGates: [
      script('release-gate:watchlists', 'scripts/release-gates/release-gate-watchlists.ts'),
    ],
    signoffs: [script('signoff:watchlists', 'scripts/signoffs/signoff-watchlists.ts')],
  },
];

export const SYSTEM_SCRIPT_SURFACE = {
  tests: [
    script('test:services', 'scripts/test-services.ts'),
    script('test:controllers', 'scripts/test-controllers.ts'),
    script('test:core-contracts'),
    script('test:aggregate-catchall'),
    script('test:coverage-audit', 'scripts/test-coverage-audit.ts'),
    script('test:changed', 'scripts/_support/run-changed-tests.ts'),
    script('test:release-baseline'),
    script('test:module-only'),
    script('test:all'),
    script('test'),
  ],
  releaseGates: [
    script('release-gate:foundation', 'scripts/release-gates/release-gate-foundation.ts'),
  ],
  smokes: [script('smoke:modules', 'scripts/smokes/smoke-modules.sh')],
  runtimeFiles: ['scripts/_runtime/automation_signal_eval.py'],
  supportFiles: [
    'scripts/_support/check-changed-coverage.ts',
    'scripts/_support/coverage-change-tools.ts',
    'scripts/_support/http-ops.ts',
    'scripts/_support/install-git-hooks.ts',
    'scripts/_support/module-probes.ts',
    'scripts/_support/pg.d.ts',
    'scripts/_support/resolve-test-command.ts',
    'scripts/_support/run-changed-tests.ts',
    'scripts/_support/run-doc-aware-test.ts',
    'scripts/_support/run-package-suite.ts',
    'scripts/_support/run-script-suite.ts',
    'scripts/_support/system-coverage-manifest.ts',
  ],
  dbScripts: [
    script('db:baseline', 'scripts/db/db-baseline-persistence.ts'),
    script('db:migrate', 'scripts/db/db-run-migrations.ts'),
    script('db:seed:backtests-chart-smoke', 'scripts/db/db-seed-backtests-chart-smoke.ts'),
    script('db:seed:production-bootstrap', 'scripts/db/db-seed-production-bootstrap.ts'),
    script(
      'db:copy-admin-broker-settings-to-system',
      'scripts/db/db-copy-admin-broker-settings-to-system.ts'
    ),
    script('db:bootstrap'),
    script('db:encrypt-broker-secrets', 'scripts/db/db-encrypt-broker-account-secrets.ts'),
  ],
  rebuildScripts: [
    script('rebuild:positions-read-model', 'scripts/rebuild/rebuild-positions-read-model.ts'),
    script('rebuild:risk-normalized-storage', 'scripts/rebuild/rebuild-risk-normalized-storage.ts'),
  ],
};
