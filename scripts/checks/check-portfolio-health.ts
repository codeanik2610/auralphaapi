import assert from 'node:assert/strict';
import path from 'node:path';
import { env } from '../../src/env';

type JsonRecord = Record<string, unknown>;

export type PortfolioHealthSnapshot = {
  baseUrl: string;
  overviewLatencyMs: number;
  performanceLatencyMs: number;
  contractVersion: string | null;
  purpose: string | null;
  pageHydration: string | null;
  summarySource: string | null;
  overviewPerformanceSource: string | null;
  directPerformanceSource: string | null;
  indexedSnapshotReads: boolean;
  activityReadModelAcceleration: boolean;
  portfolioHealthChecks: boolean;
  shareableWorkspaceState: boolean;
  rebalanceReviewWorkflow: boolean;
  workspaceReportGeneration: boolean;
  liveSnapshotReconciliationPolicy: boolean;
  exportReport: boolean;
  reconciliationMode: string | null;
  holdingsCount: number;
  snapshotsCount: number;
  performancePointCount: number;
  performanceTrades: number;
  warningsCount: number;
};

export type PortfolioHealthAssertionOptions = {
  maxOverviewMs?: number;
  maxPerformanceMs?: number;
};

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.HEALTH_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const API_KEY = String(process.env.APP_API_KEY || process.env.API_KEY || '').trim();
const LOGIN_EMAIL = String(
  process.env.SMOKE_LOGIN_EMAIL || process.env.AUTH_SEED_EMAIL || env.auth.seedEmail
).trim();
const LOGIN_PASSWORD = String(
  process.env.SMOKE_LOGIN_PASSWORD || process.env.AUTH_SEED_PASSWORD || env.auth.seedPassword
).trim();
const MAX_OVERVIEW_MS = Math.max(0, Number(process.env.PORTFOLIO_MAX_OVERVIEW_MS || 2200));
const MAX_PERFORMANCE_MS = Math.max(
  0,
  Number(process.env.PORTFOLIO_MAX_PERFORMANCE_MS || 1600)
);
const HOLDINGS_LIMIT = Math.max(1, Number(process.env.PORTFOLIO_HEALTH_HOLDINGS_LIMIT || 25));
const SNAPSHOTS_LIMIT = Math.max(
  1,
  Number(process.env.PORTFOLIO_HEALTH_SNAPSHOTS_LIMIT || 10)
);

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function requestJson(
  path: string,
  init: RequestInit = {},
  accessToken = ''
): Promise<JsonRecord> {
  const headers = new Headers(init.headers || {});

  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  } else if (API_KEY) {
    headers.set('x-api-key', API_KEY);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let payload: JsonRecord = {};

  try {
    payload = text ? (JSON.parse(text) as JsonRecord) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function loginIfPossible(): Promise<string> {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    return '';
  }

  try {
    const response = await requestJson('/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
      }),
    });
    return readString(asRecord(response.data).accessToken);
  } catch {
    return '';
  }
}

async function timedRequest(
  path: string,
  accessToken: string
): Promise<{ payload: JsonRecord; durationMs: number }> {
  const startedAt = Date.now();
  const payload = await requestJson(path, {}, accessToken);
  return {
    payload,
    durationMs: Date.now() - startedAt,
  };
}

export function buildPortfolioHealthSnapshot(input: {
  baseUrl: string;
  overviewDurationMs: number;
  performanceDurationMs: number;
  overviewPayload: JsonRecord;
  performancePayload: JsonRecord;
}): PortfolioHealthSnapshot {
  const overviewData = asRecord(input.overviewPayload.data);
  const overviewMeta = asRecord(overviewData.meta);
  const overviewCapabilities = asRecord(overviewMeta.capabilities);
  const overviewSummary = asRecord(overviewData.summary);
  const overviewPerformance = asRecord(overviewData.performance);
  const overviewReconciliationPolicy = asRecord(overviewMeta.reconciliationPolicy);
  const holdings = asRecord(overviewData.holdings);
  const snapshots = asRecord(overviewData.snapshots);
  const performanceData = asRecord(input.performancePayload.data);
  const performanceSummary = asRecord(performanceData.summary);

  return {
    baseUrl: input.baseUrl,
    overviewLatencyMs: input.overviewDurationMs,
    performanceLatencyMs: input.performanceDurationMs,
    contractVersion: readString(overviewMeta.contractVersion) || null,
    purpose: readString(overviewMeta.purpose) || null,
    pageHydration: readString(overviewMeta.pageHydration) || null,
    summarySource: readString(overviewSummary.source) || null,
    overviewPerformanceSource: readString(overviewPerformance.source) || null,
    directPerformanceSource: readString(performanceData.source) || null,
    indexedSnapshotReads: overviewCapabilities.indexedSnapshotReads === true,
    activityReadModelAcceleration:
      overviewCapabilities.activityReadModelAcceleration === true,
    portfolioHealthChecks: overviewCapabilities.portfolioHealthChecks === true,
    shareableWorkspaceState: overviewCapabilities.shareableWorkspaceState === true,
    rebalanceReviewWorkflow: overviewCapabilities.rebalanceReviewWorkflow === true,
    workspaceReportGeneration: overviewCapabilities.workspaceReportGeneration === true,
    liveSnapshotReconciliationPolicy:
      overviewCapabilities.liveSnapshotReconciliationPolicy === true,
    exportReport: overviewCapabilities.exportReport === true,
    reconciliationMode: readString(overviewReconciliationPolicy.mode) || null,
    holdingsCount: readNumber(holdings.total),
    snapshotsCount: readNumber(snapshots.total),
    performancePointCount: readArray(performanceData.points).length,
    performanceTrades: readNumber(performanceSummary.totalTrades),
    warningsCount: readArray(overviewMeta.warnings).length,
  };
}

export function assertPortfolioHealthSnapshot(
  snapshot: PortfolioHealthSnapshot,
  options: PortfolioHealthAssertionOptions = {}
): void {
  const maxOverviewMs = Math.max(0, options.maxOverviewMs ?? MAX_OVERVIEW_MS);
  const maxPerformanceMs = Math.max(0, options.maxPerformanceMs ?? MAX_PERFORMANCE_MS);

  assert.equal(
    snapshot.purpose,
    'operator_portfolio_workspace',
    'portfolio overview purpose must remain operator_portfolio_workspace'
  );
  assert.equal(
    snapshot.pageHydration,
    'single-request',
    'portfolio page hydration must remain single-request'
  );
  assert.equal(
    snapshot.summarySource,
    'portfolio_snapshots',
    'portfolio summary must remain snapshot-backed'
  );
  assert.equal(
    snapshot.overviewPerformanceSource,
    'scheduler_positions_snapshots',
    'overview performance must preserve scheduler snapshot semantics'
  );
  assert.equal(
    snapshot.directPerformanceSource,
    'scheduler_positions_snapshots',
    'direct performance endpoint must preserve scheduler snapshot semantics'
  );
  assert.equal(
    snapshot.indexedSnapshotReads,
    true,
    'portfolio overview must advertise indexed snapshot reads after Phase 5'
  );
  assert.equal(
    snapshot.activityReadModelAcceleration,
    true,
    'portfolio overview must advertise read-model-backed activity acceleration after Phase 5'
  );
  assert.equal(
    snapshot.portfolioHealthChecks,
    true,
    'portfolio overview must advertise health-check coverage after Phase 5'
  );
  assert.equal(
    snapshot.shareableWorkspaceState,
    true,
    'portfolio overview must advertise shareable workspace state after Phase 6'
  );
  assert.equal(
    snapshot.rebalanceReviewWorkflow,
    true,
    'portfolio overview must advertise the rebalance review workflow after Phase 6'
  );
  assert.equal(
    snapshot.workspaceReportGeneration,
    true,
    'portfolio overview must advertise workspace report generation after Phase 6'
  );
  assert.equal(
    snapshot.liveSnapshotReconciliationPolicy,
    true,
    'portfolio overview must advertise the manual live-versus-snapshot reconciliation policy after Phase 6'
  );
  assert.equal(
    snapshot.exportReport,
    true,
    'portfolio overview must advertise report export after Phase 6'
  );
  assert.equal(
    snapshot.reconciliationMode,
    'manual_workspace_review',
    'portfolio overview must expose the manual workspace reconciliation mode after Phase 6'
  );
  assert.ok(
    snapshot.overviewLatencyMs <= maxOverviewMs,
    `portfolio overview latency ${snapshot.overviewLatencyMs}ms exceeds ${maxOverviewMs}ms`
  );
  assert.ok(
    snapshot.performanceLatencyMs <= maxPerformanceMs,
    `portfolio performance latency ${snapshot.performanceLatencyMs}ms exceeds ${maxPerformanceMs}ms`
  );
}

async function run(): Promise<void> {
  const accessToken = await loginIfPossible();
  assert.ok(
    accessToken || API_KEY,
    'Either admin login credentials or APP_API_KEY/API_KEY is required to poll /portfolio endpoints'
  );

  const [overviewResponse, performanceResponse] = await Promise.all([
    timedRequest(
      `/portfolio/overview?timeframe=daily&snapshotsLimit=${encodeURIComponent(
        String(SNAPSHOTS_LIMIT)
      )}&snapshotsOffset=0&holdingsLimit=${encodeURIComponent(String(HOLDINGS_LIMIT))}`,
      accessToken
    ),
    timedRequest('/portfolio/performance?timeframe=weekly', accessToken),
  ]);

  const snapshot = buildPortfolioHealthSnapshot({
    baseUrl: BASE_URL,
    overviewDurationMs: overviewResponse.durationMs,
    performanceDurationMs: performanceResponse.durationMs,
    overviewPayload: overviewResponse.payload,
    performancePayload: performanceResponse.payload,
  });

  console.log('portfolio-health-check:', JSON.stringify(snapshot));
  assertPortfolioHealthSnapshot(snapshot, {
    maxOverviewMs: MAX_OVERVIEW_MS,
    maxPerformanceMs: MAX_PERFORMANCE_MS,
  });
}

const isDirectRun = (() => {
  const executedFile = String(process.argv[1] || '');
  if (!executedFile) {
    return false;
  }
  return (
    executedFile.endsWith(path.join('scripts', 'checks', 'check-portfolio-health.ts')) ||
    executedFile.endsWith(path.join('scripts', 'checks', 'check-portfolio-health.js'))
  );
})();

if (isDirectRun) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
