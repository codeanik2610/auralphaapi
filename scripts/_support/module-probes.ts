import assert from 'node:assert/strict';

import {
  asArray,
  asRecord,
  BASE_URL,
  readNumber,
  readString,
  requestJson,
} from './http-ops';

export type SignalsSnapshot = {
  baseUrl: string;
  totalSignals: number;
  listLatencyMs: number;
  summaryLatencyMs: number;
  overviewLatencyMs: number;
  scanState: string;
  cardsCount: number;
};

export type ConnectionsSnapshot = {
  baseUrl: string;
  totalConnections: number;
  healthyConnections: number;
  providerItems: number;
  exchangeItems: number;
  listLatencyMs: number;
  summaryLatencyMs: number;
  catalogLatencyMs: number;
};

export type SettingsSnapshot = {
  baseUrl: string;
  timezone: string;
  hasSavedSettings: boolean;
  hasPromotionRules: boolean;
  auditItems: number;
  getLatencyMs: number;
  auditLatencyMs: number;
};

export type WatchlistsSnapshot = {
  baseUrl: string;
  totalWatchlists: number;
  symbolsTracked: number;
  activeWatchlistId: string | null;
  listLatencyMs: number;
  summaryLatencyMs: number;
  overviewLatencyMs: number;
};

export type ActivitySnapshot = {
  baseUrl: string;
  totalEvents: number;
  unreadCount: number;
  savedViews: number;
  listLatencyMs: number;
  summaryLatencyMs: number;
  viewsLatencyMs: number;
};

export type AlertsSnapshot = {
  baseUrl: string;
  totalAlerts: number;
  openAlerts: number;
  criticalSeverity: number;
  listLatencyMs: number;
  summaryLatencyMs: number;
  overviewLatencyMs: number;
};

export type BrokerAccountsSnapshot = {
  baseUrl: string;
  totalAccounts: number;
  brokerDefinitions: number;
  connectedAccounts: number;
  testedAccounts: number;
  passed: number;
  failed: number;
  listLatencyMs: number;
  definitionsLatencyMs: number;
  healthCheckLatencyMs: number;
};

export type MarketsSnapshot = {
  baseUrl: string;
  totalAssets: number;
  selectedSymbol: string | null;
  overviewLatencyMs: number;
  symbolOverviewLatencyMs: number;
  chartLatencyMs: number;
  chartCandles: number;
};

export type AssetsSnapshot = {
  baseUrl: string;
  catalogItems: number;
  providerItems: number;
  exchangeItems: number;
  futuresItems: number;
  exchangeAssetsTotal: number;
  catalogLatencyMs: number;
  futuresLatencyMs: number;
  exchangeAssetsLatencyMs: number;
};

export type WalletsSnapshot = {
  baseUrl: string;
  totalActiveWalletAccounts: number;
  totalActiveFuturesAccounts: number;
  walletSuccessCount: number;
  walletFailureCount: number;
  futuresSuccessCount: number;
  futuresFailureCount: number;
  walletLatencyMs: number;
  futuresLatencyMs: number;
};

export type FundsSnapshotsSnapshot = {
  baseUrl: string;
  totalSnapshots: number;
  latestBrokerKey: string | null;
  latestAccountId: string | null;
  listLatencyMs: number;
  latestLatencyMs: number;
};

function now(): number {
  return Date.now();
}

export async function probeSignals(accessToken: string): Promise<SignalsSnapshot> {
  const listStartedAt = now();
  const listResponse = await requestJson('/signals?limit=5&offset=0', {}, accessToken);
  const listLatencyMs = now() - listStartedAt;
  const listData = asRecord(listResponse.data);
  const items = asArray(listData.items);
  const totalSignals = readNumber(listData.total, items.length);

  const summaryStartedAt = now();
  const summaryResponse = await requestJson('/signals/summary', {}, accessToken);
  const summaryLatencyMs = now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);

  const overviewStartedAt = now();
  const overviewResponse = await requestJson('/signals/overview?limit=5&offset=0', {}, accessToken);
  const overviewLatencyMs = now() - overviewStartedAt;
  const overviewData = asRecord(overviewResponse.data);
  const scanStatus = asRecord(overviewData.scanStatus);

  assert.ok(Array.isArray(listData.items), 'signals list should return items');
  assert.ok(typeof listData.total === 'number' || Array.isArray(listData.items), 'signals list should expose total');
  assert.ok(Object.keys(summaryData).length > 0, 'signals summary should not be empty');
  assert.ok(Object.keys(overviewData).length > 0, 'signals overview should not be empty');
  assert.ok(overviewData.summary, 'signals overview should include summary');
  assert.ok(overviewData.signals, 'signals overview should include signals');
  assert.ok(scanStatus.state, 'signals overview should include scanStatus.state');

  return {
    baseUrl: BASE_URL,
    totalSignals,
    listLatencyMs,
    summaryLatencyMs,
    overviewLatencyMs,
    scanState: readString(scanStatus.state || 'unknown'),
    cardsCount: Array.isArray(overviewData.cards) ? overviewData.cards.length : 0,
  };
}

export function assertSignalsThresholds(
  snapshot: SignalsSnapshot,
  thresholds: {
    maxListLatencyMs: number;
    maxSummaryLatencyMs: number;
    maxOverviewLatencyMs: number;
  },
  sampleLabel = 'signals probe'
): void {
  assert.ok(
    snapshot.listLatencyMs <= thresholds.maxListLatencyMs,
    `${sampleLabel}: signals list latency ${snapshot.listLatencyMs}ms exceeds ${thresholds.maxListLatencyMs}ms`
  );
  assert.ok(
    snapshot.summaryLatencyMs <= thresholds.maxSummaryLatencyMs,
    `${sampleLabel}: signals summary latency ${snapshot.summaryLatencyMs}ms exceeds ${thresholds.maxSummaryLatencyMs}ms`
  );
  assert.ok(
    snapshot.overviewLatencyMs <= thresholds.maxOverviewLatencyMs,
    `${sampleLabel}: signals overview latency ${snapshot.overviewLatencyMs}ms exceeds ${thresholds.maxOverviewLatencyMs}ms`
  );
}

export async function probeConnections(accessToken: string): Promise<ConnectionsSnapshot> {
  const listStartedAt = now();
  const listResponse = await requestJson('/connections?limit=5&offset=0', {}, accessToken);
  const listLatencyMs = now() - listStartedAt;
  const listData = asRecord(listResponse.data);

  const summaryStartedAt = now();
  const summaryResponse = await requestJson('/connections/summary', {}, accessToken);
  const summaryLatencyMs = now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);

  const catalogStartedAt = now();
  const catalogResponse = await requestJson('/connections/catalog', {}, accessToken);
  const catalogLatencyMs = now() - catalogStartedAt;
  const catalogData = asRecord(catalogResponse.data);

  assert.ok(Array.isArray(listData.items), 'connections list should return items');
  assert.ok(Object.keys(summaryData).length > 0, 'connections summary should not be empty');
  assert.ok(Array.isArray(catalogData.items), 'connections catalog should return items');
  assert.ok(Array.isArray(catalogData.providerItems), 'connections catalog should return providerItems');
  assert.ok(Array.isArray(catalogData.exchangeItems), 'connections catalog should return exchangeItems');

  return {
    baseUrl: BASE_URL,
    totalConnections: readNumber(listData.total, asArray(listData.items).length),
    healthyConnections: readNumber(summaryData.healthyConnections),
    providerItems: Array.isArray(catalogData.providerItems) ? catalogData.providerItems.length : 0,
    exchangeItems: Array.isArray(catalogData.exchangeItems) ? catalogData.exchangeItems.length : 0,
    listLatencyMs,
    summaryLatencyMs,
    catalogLatencyMs,
  };
}

export function assertConnectionsThresholds(
  snapshot: ConnectionsSnapshot,
  thresholds: {
    maxListLatencyMs: number;
    maxSummaryLatencyMs: number;
    maxCatalogLatencyMs: number;
    minCatalogItems: number;
  },
  sampleLabel = 'connections probe'
): void {
  assert.ok(
    snapshot.listLatencyMs <= thresholds.maxListLatencyMs,
    `${sampleLabel}: connections list latency ${snapshot.listLatencyMs}ms exceeds ${thresholds.maxListLatencyMs}ms`
  );
  assert.ok(
    snapshot.summaryLatencyMs <= thresholds.maxSummaryLatencyMs,
    `${sampleLabel}: connections summary latency ${snapshot.summaryLatencyMs}ms exceeds ${thresholds.maxSummaryLatencyMs}ms`
  );
  assert.ok(
    snapshot.catalogLatencyMs <= thresholds.maxCatalogLatencyMs,
    `${sampleLabel}: connections catalog latency ${snapshot.catalogLatencyMs}ms exceeds ${thresholds.maxCatalogLatencyMs}ms`
  );
  assert.ok(
    snapshot.providerItems + snapshot.exchangeItems >= thresholds.minCatalogItems,
    `${sampleLabel}: connections catalog items ${snapshot.providerItems + snapshot.exchangeItems} is below ${thresholds.minCatalogItems}`
  );
}

export async function probeSettings(accessToken: string): Promise<SettingsSnapshot> {
  const settingsStartedAt = now();
  const settingsResponse = await requestJson('/settings', {}, accessToken);
  const getLatencyMs = now() - settingsStartedAt;
  const settingsData = asRecord(settingsResponse.data);

  const auditStartedAt = now();
  const auditResponse = await requestJson('/settings/audit?limit=5&offset=0', {}, accessToken);
  const auditLatencyMs = now() - auditStartedAt;
  const auditData = asRecord(auditResponse.data);

  assert.ok(Object.keys(settingsData).length > 0, 'settings payload should not be empty');
  assert.ok(Array.isArray(auditData.items), 'settings audit should return items');

  return {
    baseUrl: BASE_URL,
    timezone: readString(settingsData.timezone || 'unknown'),
    hasSavedSettings: Boolean(settingsData.hasSavedSettings),
    hasPromotionRules:
      Boolean(settingsData.backtestPromotionRules) &&
      typeof settingsData.backtestPromotionRules === 'object' &&
      !Array.isArray(settingsData.backtestPromotionRules),
    auditItems: Array.isArray(auditData.items) ? auditData.items.length : 0,
    getLatencyMs,
    auditLatencyMs,
  };
}

export function assertSettingsThresholds(
  snapshot: SettingsSnapshot,
  thresholds: {
    maxGetLatencyMs: number;
    maxAuditLatencyMs: number;
    requirePromotionRules: boolean;
  },
  sampleLabel = 'settings probe'
): void {
  assert.ok(
    snapshot.getLatencyMs <= thresholds.maxGetLatencyMs,
    `${sampleLabel}: settings latency ${snapshot.getLatencyMs}ms exceeds ${thresholds.maxGetLatencyMs}ms`
  );
  assert.ok(
    snapshot.auditLatencyMs <= thresholds.maxAuditLatencyMs,
    `${sampleLabel}: settings audit latency ${snapshot.auditLatencyMs}ms exceeds ${thresholds.maxAuditLatencyMs}ms`
  );
  if (thresholds.requirePromotionRules) {
    assert.equal(snapshot.hasPromotionRules, true, `${sampleLabel}: backtestPromotionRules are missing`);
  }
}

export async function probeWatchlists(accessToken: string): Promise<WatchlistsSnapshot> {
  const listStartedAt = now();
  const listResponse = await requestJson('/watchlists', {}, accessToken);
  const listLatencyMs = now() - listStartedAt;
  const listData = asRecord(listResponse.data);

  const summaryStartedAt = now();
  const summaryResponse = await requestJson('/watchlists/summary', {}, accessToken);
  const summaryLatencyMs = now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);

  const overviewStartedAt = now();
  const overviewResponse = await requestJson('/watchlists/overview?limit=5&offset=0', {}, accessToken);
  const overviewLatencyMs = now() - overviewStartedAt;
  const overviewData = asRecord(overviewResponse.data);

  assert.ok(Array.isArray(listData.items), 'watchlists list should return items');
  assert.ok(Object.keys(summaryData).length > 0, 'watchlists summary should not be empty');
  assert.ok(overviewData.watchlists, 'watchlists overview should include watchlists');
  assert.ok(overviewData.items, 'watchlists overview should include items');

  return {
    baseUrl: BASE_URL,
    totalWatchlists: Array.isArray(listData.items) ? listData.items.length : 0,
    symbolsTracked: readNumber(summaryData.symbolsTracked),
    activeWatchlistId: readString(overviewData.activeWatchlistId) || null,
    listLatencyMs,
    summaryLatencyMs,
    overviewLatencyMs,
  };
}

export function assertWatchlistsThresholds(
  snapshot: WatchlistsSnapshot,
  thresholds: {
    maxListLatencyMs: number;
    maxSummaryLatencyMs: number;
    maxOverviewLatencyMs: number;
  },
  sampleLabel = 'watchlists probe'
): void {
  assert.ok(
    snapshot.listLatencyMs <= thresholds.maxListLatencyMs,
    `${sampleLabel}: watchlists list latency ${snapshot.listLatencyMs}ms exceeds ${thresholds.maxListLatencyMs}ms`
  );
  assert.ok(
    snapshot.summaryLatencyMs <= thresholds.maxSummaryLatencyMs,
    `${sampleLabel}: watchlists summary latency ${snapshot.summaryLatencyMs}ms exceeds ${thresholds.maxSummaryLatencyMs}ms`
  );
  assert.ok(
    snapshot.overviewLatencyMs <= thresholds.maxOverviewLatencyMs,
    `${sampleLabel}: watchlists overview latency ${snapshot.overviewLatencyMs}ms exceeds ${thresholds.maxOverviewLatencyMs}ms`
  );
}

export async function probeActivity(accessToken: string): Promise<ActivitySnapshot> {
  const listStartedAt = now();
  const listResponse = await requestJson('/activity?limit=5&offset=0', {}, accessToken);
  const listLatencyMs = now() - listStartedAt;
  const listData = asRecord(listResponse.data);

  const summaryStartedAt = now();
  const summaryResponse = await requestJson('/activity/summary', {}, accessToken);
  const summaryLatencyMs = now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);

  const viewsStartedAt = now();
  const viewsResponse = await requestJson('/activity/views', {}, accessToken);
  const viewsLatencyMs = now() - viewsStartedAt;
  const viewsData = asRecord(viewsResponse.data);

  assert.ok(Array.isArray(listData.items), 'activity list should return items');
  assert.ok(typeof listData.unreadCount === 'number', 'activity list should expose unreadCount');
  assert.ok(Object.keys(summaryData).length > 0, 'activity summary should not be empty');
  assert.ok(Array.isArray(viewsData.items), 'activity views should return items');

  return {
    baseUrl: BASE_URL,
    totalEvents: readNumber(listData.total, asArray(listData.items).length),
    unreadCount: readNumber(listData.unreadCount),
    savedViews: asArray(viewsData.items).length,
    listLatencyMs,
    summaryLatencyMs,
    viewsLatencyMs,
  };
}

export function assertActivityThresholds(
  snapshot: ActivitySnapshot,
  thresholds: {
    maxListLatencyMs: number;
    maxSummaryLatencyMs: number;
    maxViewsLatencyMs: number;
  },
  sampleLabel = 'activity probe'
): void {
  assert.ok(
    snapshot.listLatencyMs <= thresholds.maxListLatencyMs,
    `${sampleLabel}: activity list latency ${snapshot.listLatencyMs}ms exceeds ${thresholds.maxListLatencyMs}ms`
  );
  assert.ok(
    snapshot.summaryLatencyMs <= thresholds.maxSummaryLatencyMs,
    `${sampleLabel}: activity summary latency ${snapshot.summaryLatencyMs}ms exceeds ${thresholds.maxSummaryLatencyMs}ms`
  );
  assert.ok(
    snapshot.viewsLatencyMs <= thresholds.maxViewsLatencyMs,
    `${sampleLabel}: activity views latency ${snapshot.viewsLatencyMs}ms exceeds ${thresholds.maxViewsLatencyMs}ms`
  );
}

export async function probeAlerts(accessToken: string): Promise<AlertsSnapshot> {
  const listStartedAt = now();
  const listResponse = await requestJson('/alerts?limit=5&offset=0', {}, accessToken);
  const listLatencyMs = now() - listStartedAt;
  const listData = asRecord(listResponse.data);

  const summaryStartedAt = now();
  const summaryResponse = await requestJson('/alerts/summary', {}, accessToken);
  const summaryLatencyMs = now() - summaryStartedAt;
  const summaryData = asRecord(summaryResponse.data);

  const overviewStartedAt = now();
  const overviewResponse = await requestJson('/alerts/overview?limit=5&offset=0', {}, accessToken);
  const overviewLatencyMs = now() - overviewStartedAt;
  const overviewData = asRecord(overviewResponse.data);

  assert.ok(Array.isArray(listData.items), 'alerts list should return items');
  assert.ok(Object.keys(summaryData).length > 0, 'alerts summary should not be empty');
  assert.ok(overviewData.summary, 'alerts overview should include summary');
  assert.ok(overviewData.alerts, 'alerts overview should include alerts');

  return {
    baseUrl: BASE_URL,
    totalAlerts: readNumber(listData.total, asArray(listData.items).length),
    openAlerts: readNumber(summaryData.openAlerts),
    criticalSeverity: readNumber(summaryData.criticalSeverity),
    listLatencyMs,
    summaryLatencyMs,
    overviewLatencyMs,
  };
}

export function assertAlertsThresholds(
  snapshot: AlertsSnapshot,
  thresholds: {
    maxListLatencyMs: number;
    maxSummaryLatencyMs: number;
    maxOverviewLatencyMs: number;
  },
  sampleLabel = 'alerts probe'
): void {
  assert.ok(
    snapshot.listLatencyMs <= thresholds.maxListLatencyMs,
    `${sampleLabel}: alerts list latency ${snapshot.listLatencyMs}ms exceeds ${thresholds.maxListLatencyMs}ms`
  );
  assert.ok(
    snapshot.summaryLatencyMs <= thresholds.maxSummaryLatencyMs,
    `${sampleLabel}: alerts summary latency ${snapshot.summaryLatencyMs}ms exceeds ${thresholds.maxSummaryLatencyMs}ms`
  );
  assert.ok(
    snapshot.overviewLatencyMs <= thresholds.maxOverviewLatencyMs,
    `${sampleLabel}: alerts overview latency ${snapshot.overviewLatencyMs}ms exceeds ${thresholds.maxOverviewLatencyMs}ms`
  );
}

export async function probeBrokerAccounts(accessToken: string): Promise<BrokerAccountsSnapshot> {
  const listStartedAt = now();
  const listResponse = await requestJson('/broker-accounts?limit=5&offset=0', {}, accessToken);
  const listLatencyMs = now() - listStartedAt;
  const listData = asRecord(listResponse.data);

  const definitionsStartedAt = now();
  const definitionsResponse = await requestJson('/broker-definitions', {}, accessToken);
  const definitionsLatencyMs = now() - definitionsStartedAt;
  const definitionsData = asRecord(definitionsResponse.data);

  const healthCheckStartedAt = now();
  const healthCheckResponse = await requestJson(
    '/internal/broker-accounts/health-check',
    { method: 'POST' },
    accessToken
  );
  const healthCheckLatencyMs = now() - healthCheckStartedAt;
  const healthCheckData = asRecord(healthCheckResponse.data);

  assert.ok(Array.isArray(listData.items), 'broker accounts list should return items');
  assert.ok(Array.isArray(definitionsData.items), 'broker definitions list should return items');
  assert.ok(Array.isArray(healthCheckData.items), 'broker account health check should return items');

  return {
    baseUrl: BASE_URL,
    totalAccounts: readNumber(listData.total, asArray(listData.items).length),
    brokerDefinitions: readNumber(definitionsData.total, asArray(definitionsData.items).length),
    connectedAccounts: readNumber(healthCheckData.connectedAccounts),
    testedAccounts: readNumber(healthCheckData.testedAccounts),
    passed: readNumber(healthCheckData.passed),
    failed: readNumber(healthCheckData.failed),
    listLatencyMs,
    definitionsLatencyMs,
    healthCheckLatencyMs,
  };
}

export function assertBrokerAccountsThresholds(
  snapshot: BrokerAccountsSnapshot,
  thresholds: {
    maxListLatencyMs: number;
    maxDefinitionsLatencyMs: number;
    maxHealthCheckLatencyMs: number;
    minBrokerDefinitions: number;
  },
  sampleLabel = 'broker accounts probe'
): void {
  assert.ok(
    snapshot.listLatencyMs <= thresholds.maxListLatencyMs,
    `${sampleLabel}: broker accounts list latency ${snapshot.listLatencyMs}ms exceeds ${thresholds.maxListLatencyMs}ms`
  );
  assert.ok(
    snapshot.definitionsLatencyMs <= thresholds.maxDefinitionsLatencyMs,
    `${sampleLabel}: broker definitions latency ${snapshot.definitionsLatencyMs}ms exceeds ${thresholds.maxDefinitionsLatencyMs}ms`
  );
  assert.ok(
    snapshot.healthCheckLatencyMs <= thresholds.maxHealthCheckLatencyMs,
    `${sampleLabel}: broker account health latency ${snapshot.healthCheckLatencyMs}ms exceeds ${thresholds.maxHealthCheckLatencyMs}ms`
  );
  assert.ok(
    snapshot.brokerDefinitions >= thresholds.minBrokerDefinitions,
    `${sampleLabel}: broker definitions ${snapshot.brokerDefinitions} is below ${thresholds.minBrokerDefinitions}`
  );
}

export async function probeMarkets(accessToken: string): Promise<MarketsSnapshot> {
  const overviewStartedAt = now();
  const overviewResponse = await requestJson('/markets/overview?limit=5&offset=0', {}, accessToken);
  const overviewLatencyMs = now() - overviewStartedAt;
  const overviewData = asRecord(overviewResponse.data);
  const assets = asArray(overviewData.assets);
  const selectedAsset = asRecord(overviewData.selectedAsset);
  const selectedSymbol =
    readString(selectedAsset.symbol) || readString(asRecord(assets[0]).symbol) || null;

  assert.ok(assets.length > 0 || Boolean(selectedSymbol), 'markets overview should return assets');

  const symbolOverviewStartedAt = now();
  const symbolOverviewResponse = await requestJson(
    `/markets/${encodeURIComponent(selectedSymbol || 'BTCUSDT')}/overview?signalsLimit=3`,
    {},
    accessToken
  );
  const symbolOverviewLatencyMs = now() - symbolOverviewStartedAt;
  const symbolOverviewData = asRecord(symbolOverviewResponse.data);

  const chartStartedAt = now();
  const chartResponse = await requestJson(
    `/markets/${encodeURIComponent(selectedSymbol || 'BTCUSDT')}/chart?interval=1h&limit=10`,
    {},
    accessToken
  );
  const chartLatencyMs = now() - chartStartedAt;
  const chartData = asRecord(chartResponse.data);

  assert.ok(Object.keys(symbolOverviewData).length > 0, 'market symbol overview should not be empty');
  assert.equal(
    readString(symbolOverviewData.symbol),
    selectedSymbol || 'BTCUSDT',
    'market symbol overview should match selected symbol'
  );
  assert.ok(Array.isArray(chartData.candles), 'market chart should return candles');

  return {
    baseUrl: BASE_URL,
    totalAssets: readNumber(overviewData.total, assets.length),
    selectedSymbol,
    overviewLatencyMs,
    symbolOverviewLatencyMs,
    chartLatencyMs,
    chartCandles: asArray(chartData.candles).length,
  };
}

export function assertMarketsThresholds(
  snapshot: MarketsSnapshot,
  thresholds: {
    maxOverviewLatencyMs: number;
    maxSymbolOverviewLatencyMs: number;
    maxChartLatencyMs: number;
    minAssets: number;
  },
  sampleLabel = 'markets probe'
): void {
  assert.ok(
    snapshot.overviewLatencyMs <= thresholds.maxOverviewLatencyMs,
    `${sampleLabel}: markets overview latency ${snapshot.overviewLatencyMs}ms exceeds ${thresholds.maxOverviewLatencyMs}ms`
  );
  assert.ok(
    snapshot.symbolOverviewLatencyMs <= thresholds.maxSymbolOverviewLatencyMs,
    `${sampleLabel}: market symbol overview latency ${snapshot.symbolOverviewLatencyMs}ms exceeds ${thresholds.maxSymbolOverviewLatencyMs}ms`
  );
  assert.ok(
    snapshot.chartLatencyMs <= thresholds.maxChartLatencyMs,
    `${sampleLabel}: market chart latency ${snapshot.chartLatencyMs}ms exceeds ${thresholds.maxChartLatencyMs}ms`
  );
  assert.ok(
    snapshot.totalAssets >= thresholds.minAssets,
    `${sampleLabel}: markets total assets ${snapshot.totalAssets} is below ${thresholds.minAssets}`
  );
}

export async function probeAssets(accessToken: string): Promise<AssetsSnapshot> {
  const catalogStartedAt = now();
  const catalogResponse = await requestJson('/assets/catalog', {}, accessToken);
  const catalogLatencyMs = now() - catalogStartedAt;
  const catalogData = asRecord(catalogResponse.data);

  const futuresStartedAt = now();
  const futuresResponse = await requestJson(
    '/assets/futures?brokerKey=mudrex&limit=5&offset=0',
    {},
    accessToken
  );
  const futuresLatencyMs = now() - futuresStartedAt;
  const futuresData = asArray(futuresResponse.data);

  const exchangeAssetsStartedAt = now();
  const exchangeAssetsResponse = await requestJson('/exchange-assets?limit=5&offset=0', {}, accessToken);
  const exchangeAssetsLatencyMs = now() - exchangeAssetsStartedAt;
  const exchangeAssetsData = asRecord(exchangeAssetsResponse.data);

  assert.ok(Array.isArray(catalogData.items), 'assets catalog should return items');
  assert.ok(Array.isArray(catalogData.providerItems), 'assets catalog should return providerItems');
  assert.ok(Array.isArray(catalogData.exchangeItems), 'assets catalog should return exchangeItems');
  assert.ok(Array.isArray(futuresResponse.data), 'assets futures should return an array');
  assert.ok(Array.isArray(exchangeAssetsData.assets), 'exchange assets should return assets');

  return {
    baseUrl: BASE_URL,
    catalogItems: readNumber(catalogData.total, asArray(catalogData.items).length),
    providerItems: asArray(catalogData.providerItems).length,
    exchangeItems: asArray(catalogData.exchangeItems).length,
    futuresItems: futuresData.length,
    exchangeAssetsTotal: readNumber(exchangeAssetsData.total, asArray(exchangeAssetsData.assets).length),
    catalogLatencyMs,
    futuresLatencyMs,
    exchangeAssetsLatencyMs,
  };
}

export function assertAssetsThresholds(
  snapshot: AssetsSnapshot,
  thresholds: {
    maxCatalogLatencyMs: number;
    maxFuturesLatencyMs: number;
    maxExchangeAssetsLatencyMs: number;
    minCatalogItems: number;
  },
  sampleLabel = 'assets probe'
): void {
  assert.ok(
    snapshot.catalogLatencyMs <= thresholds.maxCatalogLatencyMs,
    `${sampleLabel}: assets catalog latency ${snapshot.catalogLatencyMs}ms exceeds ${thresholds.maxCatalogLatencyMs}ms`
  );
  assert.ok(
    snapshot.futuresLatencyMs <= thresholds.maxFuturesLatencyMs,
    `${sampleLabel}: assets futures latency ${snapshot.futuresLatencyMs}ms exceeds ${thresholds.maxFuturesLatencyMs}ms`
  );
  assert.ok(
    snapshot.exchangeAssetsLatencyMs <= thresholds.maxExchangeAssetsLatencyMs,
    `${sampleLabel}: exchange assets latency ${snapshot.exchangeAssetsLatencyMs}ms exceeds ${thresholds.maxExchangeAssetsLatencyMs}ms`
  );
  assert.ok(
    snapshot.catalogItems >= thresholds.minCatalogItems,
    `${sampleLabel}: assets catalog items ${snapshot.catalogItems} is below ${thresholds.minCatalogItems}`
  );
}

export async function probeWallets(accessToken: string): Promise<WalletsSnapshot> {
  const walletStartedAt = now();
  const walletResponse = await requestJson('/wallet/funds/active', {}, accessToken);
  const walletLatencyMs = now() - walletStartedAt;
  const walletData = asRecord(walletResponse.data);

  const futuresStartedAt = now();
  const futuresResponse = await requestJson('/wallet/futures/funds/active', {}, accessToken);
  const futuresLatencyMs = now() - futuresStartedAt;
  const futuresData = asRecord(futuresResponse.data);

  assert.ok(Array.isArray(walletData.items), 'wallet active funds should return items');
  assert.ok(Array.isArray(futuresData.items), 'wallet active futures funds should return items');

  return {
    baseUrl: BASE_URL,
    totalActiveWalletAccounts: readNumber(
      walletData.totalActiveAccounts,
      asArray(walletData.items).length
    ),
    totalActiveFuturesAccounts: readNumber(
      futuresData.totalActiveAccounts,
      asArray(futuresData.items).length
    ),
    walletSuccessCount: readNumber(walletData.successCount),
    walletFailureCount: readNumber(walletData.failureCount),
    futuresSuccessCount: readNumber(futuresData.successCount),
    futuresFailureCount: readNumber(futuresData.failureCount),
    walletLatencyMs,
    futuresLatencyMs,
  };
}

export function assertWalletsThresholds(
  snapshot: WalletsSnapshot,
  thresholds: {
    maxWalletLatencyMs: number;
    maxFuturesLatencyMs: number;
  },
  sampleLabel = 'wallets probe'
): void {
  assert.ok(
    snapshot.walletLatencyMs <= thresholds.maxWalletLatencyMs,
    `${sampleLabel}: wallet funds latency ${snapshot.walletLatencyMs}ms exceeds ${thresholds.maxWalletLatencyMs}ms`
  );
  assert.ok(
    snapshot.futuresLatencyMs <= thresholds.maxFuturesLatencyMs,
    `${sampleLabel}: wallet futures latency ${snapshot.futuresLatencyMs}ms exceeds ${thresholds.maxFuturesLatencyMs}ms`
  );
}

export async function probeFundsSnapshots(accessToken: string): Promise<FundsSnapshotsSnapshot> {
  const listStartedAt = now();
  const listResponse = await requestJson('/funds-snapshots?limit=5&offset=0', {}, accessToken);
  const listLatencyMs = now() - listStartedAt;
  const listData = asRecord(listResponse.data);

  const latestStartedAt = now();
  const latestResponse = await requestJson('/funds-snapshots/latest', {}, accessToken);
  const latestLatencyMs = now() - latestStartedAt;
  const latestData = asRecord(latestResponse.data);

  assert.ok(Array.isArray(listData.items), 'funds snapshots list should return items');

  return {
    baseUrl: BASE_URL,
    totalSnapshots: readNumber(listData.total, asArray(listData.items).length),
    latestBrokerKey: readString(latestData.broker_key) || null,
    latestAccountId: readString(latestData.account_id) || null,
    listLatencyMs,
    latestLatencyMs,
  };
}

export function assertFundsSnapshotsThresholds(
  snapshot: FundsSnapshotsSnapshot,
  thresholds: {
    maxListLatencyMs: number;
    maxLatestLatencyMs: number;
  },
  sampleLabel = 'funds snapshots probe'
): void {
  assert.ok(
    snapshot.listLatencyMs <= thresholds.maxListLatencyMs,
    `${sampleLabel}: funds snapshots list latency ${snapshot.listLatencyMs}ms exceeds ${thresholds.maxListLatencyMs}ms`
  );
  assert.ok(
    snapshot.latestLatencyMs <= thresholds.maxLatestLatencyMs,
    `${sampleLabel}: funds snapshots latest latency ${snapshot.latestLatencyMs}ms exceeds ${thresholds.maxLatestLatencyMs}ms`
  );
}
