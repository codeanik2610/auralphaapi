import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';
import { Container } from 'typedi';
import { SuggestedTradesService } from '../../src/api/services/SuggestedTradesService';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { SuggestedTrade } from '../../src/database/entities/SuggestedTrade';
import { SuggestedTradeRepository } from '../../src/database/repositories/SuggestedTradeRepository';

type AnyRecord = Record<string, any>;

type RouteCandidateSummary = {
  brokerKey: string;
  accountId: string | null;
  accountName: string | null;
  shadowOnly: boolean;
  requestedSymbol: string | null;
  brokerSymbol: string | null;
  candidateSymbols: string[];
  resolvedVia: string | null;
  supported: boolean;
  supportMessage: string | null;
  allowed: boolean;
  blocked: boolean;
  summary: string | null;
  warningRuleCount: number | null;
  blockingRuleCount: number | null;
  freshnessState: string | null;
};

type AuditRow = {
  id: string;
  userId: string;
  automationId: string | null;
  symbol: string;
  side: string;
  timeframe: string;
  status: string;
  signalTime: string | null;
  createdAt: string | null;
  skippedReason: string | null;
  error: string | null;
  selectedBrokerKey: string | null;
  selectedAccountId: string | null;
  selectedBrokerSymbol: string | null;
  decision: string | null;
  summary: string | null;
  mudrex: RouteCandidateSummary | null;
  delta: RouteCandidateSummary | null;
  candidates: RouteCandidateSummary[];
};

const SOURCE_TYPE = 'suggested_trade_automation_live_rollout';
const DEFAULT_LOOKBACK_DAYS = 2;
const DEFAULT_LIMIT = 25;
type DeltaRoutingAuditMode = 'shadow' | 'live';

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readCsv(value: unknown): string[] {
  return readString(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveAuditMode(): DeltaRoutingAuditMode {
  const normalized = readString(process.env.SUGGESTED_TRADES_DELTA_ROUTING_AUDIT_MODE)
    .toLowerCase()
    .replace(/-/g, '_');
  return normalized === 'live' || normalized === 'promoted_live' ? 'live' : 'shadow';
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeCandidate(value: unknown): RouteCandidateSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as AnyRecord;
  return {
    brokerKey: readString(candidate.brokerKey),
    accountId: readString(candidate.accountId) || null,
    accountName: readString(candidate.accountName) || null,
    shadowOnly: candidate.shadowOnly === true,
    requestedSymbol: readString(candidate.requestedSymbol) || null,
    brokerSymbol: readString(candidate.brokerSymbol) || null,
    candidateSymbols: Array.isArray(candidate.candidateSymbols)
      ? candidate.candidateSymbols.map((item) => readString(item)).filter(Boolean)
      : [],
    resolvedVia: readString(candidate.resolvedVia) || null,
    supported: candidate.supported === true,
    supportMessage: readString(candidate.supportMessage) || null,
    allowed: candidate.allowed === true,
    blocked: candidate.blocked === true,
    summary: readString(candidate.summary) || null,
    warningRuleCount: Number.isFinite(Number(candidate.warningRuleCount))
      ? Number(candidate.warningRuleCount)
      : null,
    blockingRuleCount: Number.isFinite(Number(candidate.blockingRuleCount))
      ? Number(candidate.blockingRuleCount)
      : null,
    freshnessState: readString(candidate.freshnessState) || null,
  };
}

function countByReason(rows: AuditRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const reason =
      row.skippedReason ||
      row.error ||
      row.delta?.supportMessage ||
      row.delta?.summary ||
      (row.delta ? 'delta pass' : 'delta candidate missing');
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

async function listTradeRefs(input: {
  userId: string | null;
  symbols: string[];
  limit: number;
  lookbackDays: number;
}): Promise<Array<{ id: string; userId: string }>> {
  const params: unknown[] = [new Date(Date.now() - input.lookbackDays * 24 * 60 * 60 * 1000)];
  const where = [
    'st.created_at >= ?',
    "LOWER(COALESCE(st.status, '')) IN ('open', 'accepted', 'queued')",
  ];

  if (input.userId) {
    where.push('st.user_id = ?');
    params.push(input.userId);
  }
  if (input.symbols.length) {
    where.push(`UPPER(st.symbol) IN (${input.symbols.map(() => '?').join(', ')})`);
    params.push(...input.symbols.map((symbol) => symbol.toUpperCase()));
  }

  const rows = (await coreDataSource.query(
    `SELECT st.id AS id, st.user_id AS userId
       FROM suggested_trades st
      WHERE ${where.join(' AND ')}
      ORDER BY st.created_at DESC, st.signal_time DESC
      LIMIT ${Math.max(1, Math.floor(input.limit))}`,
    params
  )) as AnyRecord[];

  return rows
    .map((row) => ({
      id: readString(row.id),
      userId: readString(row.userId ?? row.user_id),
    }))
    .filter((row) => row.id && row.userId);
}

async function auditTrade(
  service: SuggestedTradesService,
  repository: SuggestedTradeRepository,
  ref: { id: string; userId: string }
): Promise<AuditRow> {
  const internals = service as unknown as {
    loadTradeSuggestionExecutionPolicy: (
      userId: string,
      automationId: string | null | undefined
    ) => Promise<AnyRecord>;
    buildPreTradeCheckRequest: (
      trade: SuggestedTrade,
      executionPolicy: AnyRecord,
      existingExecution: AnyRecord | null
    ) => AnyRecord;
    applyBrokerPolicyTradeSize: (
      userId: string,
      request: AnyRecord,
      sourceType: string
    ) => Promise<AnyRecord>;
    resolveAdaptivePreTradeRoute: (
      userId: string,
      trade: SuggestedTrade,
      request: AnyRecord,
      sourceType: string
    ) => Promise<AnyRecord>;
  };

  const trade = await repository.getSuggestedTradeById(ref.userId, ref.id);
  if (!trade) {
    return {
      id: ref.id,
      userId: ref.userId,
      automationId: null,
      symbol: '',
      side: '',
      timeframe: '',
      status: '',
      signalTime: null,
      createdAt: null,
      skippedReason: 'suggested trade not found',
      error: null,
      selectedBrokerKey: null,
      selectedAccountId: null,
      selectedBrokerSymbol: null,
      decision: null,
      summary: null,
      mudrex: null,
      delta: null,
      candidates: [],
    };
  }

  const baseRow = {
    id: trade.id,
    userId: trade.userId,
    automationId: trade.automationId ?? null,
    symbol: trade.symbol,
    side: trade.side,
    timeframe: trade.timeframe,
    status: trade.status,
    signalTime: iso(trade.signalTime),
    createdAt: iso(trade.createdAt),
  };

  try {
    const policy = await internals.loadTradeSuggestionExecutionPolicy(
      trade.userId,
      trade.automationId
    );
    if (policy.executionMode !== 'live_trade_auto') {
      return {
        ...baseRow,
        skippedReason: `automation execution mode is ${policy.executionMode || 'unknown'}`,
        error: null,
        selectedBrokerKey: null,
        selectedAccountId: null,
        selectedBrokerSymbol: null,
        decision: null,
        summary: null,
        mudrex: null,
        delta: null,
        candidates: [],
      };
    }
    if (policy.liveConsentEnabled !== true) {
      return {
        ...baseRow,
        skippedReason: 'automation live consent is disabled',
        error: null,
        selectedBrokerKey: null,
        selectedAccountId: null,
        selectedBrokerSymbol: null,
        decision: null,
        summary: null,
        mudrex: null,
        delta: null,
        candidates: [],
      };
    }

    const request = internals.buildPreTradeCheckRequest(trade, policy, null);
    const liveRequest = await internals.applyBrokerPolicyTradeSize(
      trade.userId,
      {
        ...request,
        sourceType: SOURCE_TYPE,
        executionMode: 'live',
        approvalMode: 'auto_if_safe',
      },
      SOURCE_TYPE
    );
    const routeResult = await internals.resolveAdaptivePreTradeRoute(
      trade.userId,
      trade,
      liveRequest,
      SOURCE_TYPE
    );
    const decision =
      routeResult.routeDecision &&
      typeof routeResult.routeDecision === 'object' &&
      !Array.isArray(routeResult.routeDecision)
        ? (routeResult.routeDecision as AnyRecord)
        : null;
    const candidates = Array.isArray(decision?.candidates)
      ? decision.candidates
          .map((candidate: unknown) => normalizeCandidate(candidate))
          .filter((candidate: RouteCandidateSummary | null): candidate is RouteCandidateSummary =>
            Boolean(candidate)
          )
      : [];

    return {
      ...baseRow,
      skippedReason: decision ? null : 'no adaptive route candidates were returned',
      error: null,
      selectedBrokerKey: readString(decision?.selectedBrokerKey) || null,
      selectedAccountId: readString(decision?.selectedAccountId) || null,
      selectedBrokerSymbol: readString(decision?.selectedBrokerSymbol) || null,
      decision: readString(decision?.decision) || null,
      summary: readString(decision?.summary) || null,
      mudrex: candidates.find((candidate) => candidate.brokerKey === 'mudrex') ?? null,
      delta: candidates.find((candidate) => candidate.brokerKey === 'delta_exchange') ?? null,
      candidates,
    };
  } catch (error) {
    return {
      ...baseRow,
      skippedReason: null,
      error: error instanceof Error ? error.message : String(error),
      selectedBrokerKey: null,
      selectedAccountId: null,
      selectedBrokerSymbol: null,
      decision: null,
      summary: null,
      mudrex: null,
      delta: null,
      candidates: [],
    };
  }
}

async function run(): Promise<void> {
  const auditMode = resolveAuditMode();
  const brokerAllowlist = auditMode === 'live' ? ['mudrex', 'delta_exchange'] : ['mudrex'];
  const shadowBrokerAllowlist = auditMode === 'live' ? [] : ['delta_exchange'];
  const outputPath =
    readString(process.env.SUGGESTED_TRADES_DELTA_ROUTING_AUDIT_OUTPUT) ||
    readString(process.env.SUGGESTED_TRADES_DELTA_SHADOW_AUDIT_OUTPUT);
  const userId =
    readString(process.env.SUGGESTED_TRADES_DELTA_ROUTING_AUDIT_USER_ID) ||
    readString(process.env.SUGGESTED_TRADES_DELTA_SHADOW_AUDIT_USER_ID) ||
    null;
  const symbols = readCsv(
    process.env.SUGGESTED_TRADES_DELTA_ROUTING_AUDIT_SYMBOLS ??
      process.env.SUGGESTED_TRADES_DELTA_SHADOW_AUDIT_SYMBOLS
  );
  const limit = Math.max(
    1,
    Math.floor(
      readNumber(
        process.env.SUGGESTED_TRADES_DELTA_ROUTING_AUDIT_LIMIT ??
          process.env.SUGGESTED_TRADES_DELTA_SHADOW_AUDIT_LIMIT,
        DEFAULT_LIMIT
      )
    )
  );
  const lookbackDays = Math.max(
    1,
    Math.floor(
      readNumber(
        process.env.SUGGESTED_TRADES_DELTA_ROUTING_AUDIT_LOOKBACK_DAYS ??
          process.env.SUGGESTED_TRADES_DELTA_SHADOW_AUDIT_LOOKBACK_DAYS,
        DEFAULT_LOOKBACK_DAYS
      )
    )
  );

  process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE = 'live';
  process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST = brokerAllowlist.join(',');
  process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST =
    shadowBrokerAllowlist.join(',');

  await initializeCoreDataSource();
  const service = Container.get(SuggestedTradesService);
  const repository = Container.get(SuggestedTradeRepository);
  const refs = await listTradeRefs({ userId, symbols, limit, lookbackDays });
  const rows: AuditRow[] = [];
  for (const ref of refs) {
    rows.push(await auditTrade(service, repository, ref));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode:
      auditMode === 'live'
        ? 'dry_run_promoted_live_route_audit'
        : 'dry_run_shadow_route_audit',
    sourceType: SOURCE_TYPE,
    config: {
      adaptiveRoutingMode: 'live',
      brokerAllowlist,
      shadowBrokerAllowlist,
      userId,
      symbols,
      limit,
      lookbackDays,
    },
    sampled: refs.length,
    evaluated: rows.filter((row) => !row.skippedReason && !row.error).length,
    skipped: rows.filter((row) => Boolean(row.skippedReason)).length,
    errors: rows.filter((row) => Boolean(row.error)).length,
    mudrexSelected: rows.filter((row) => row.selectedBrokerKey === 'mudrex').length,
    deltaSelected: rows.filter((row) => row.selectedBrokerKey === 'delta_exchange').length,
    deltaPresent: rows.filter((row) => Boolean(row.delta)).length,
    deltaPass: rows.filter((row) => row.delta && row.delta.supported && row.delta.allowed).length,
    deltaBlocked: rows.filter(
      (row) => row.delta && (!row.delta.supported || !row.delta.allowed)
    ).length,
    deltaShadowPresent: rows.filter((row) => row.delta?.shadowOnly === true).length,
    deltaShadowPass: rows.filter(
      (row) => row.delta?.shadowOnly === true && row.delta.supported && row.delta.allowed
    ).length,
    deltaShadowBlocked: rows.filter(
      (row) => row.delta?.shadowOnly === true && (!row.delta.supported || !row.delta.allowed)
    ).length,
    deltaMissing: rows.filter((row) => !row.delta).length,
    reasons: countByReason(rows),
    rows,
  };

  const json = `${JSON.stringify(summary, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, json, 'utf8');
  }
  process.stdout.write(json);
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  });
