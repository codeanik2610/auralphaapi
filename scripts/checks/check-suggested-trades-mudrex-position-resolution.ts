import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SuggestedTradeRepository } from '../../src/database/repositories/SuggestedTradeRepository';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';

type JsonRecord = Record<string, unknown>;

type MudrexExecutionRow = {
  suggestedTradeId: string;
  userId: string;
  accountId: string;
  symbol: string;
  timeframe: string;
  side: string;
  signalTime: Date | string | null;
  submittedAt: Date | string | null;
  filledAt: Date | string | null;
  positionOpenedAt: Date | string | null;
  positionId: string;
};

type CandidateRow = {
  externalId: string | null;
  side: string | null;
  sideKey: string | null;
  firstSeenAt: Date | string | null;
  positionCreatedAt: Date | string | null;
  lastSeenAt: Date | string | null;
  payload: unknown;
  diffSeconds: number | string | null;
};

type ResolutionClassification =
  | 'exact_read_model'
  | 'direct_raw_payload'
  | 'strict_open_time'
  | 'unresolved_preferred'
  | 'unsafe_mismatch';

type ResolutionItem = {
  type: ResolutionClassification;
  suggestedTradeId: string;
  accountId: string;
  symbol: string;
  timeframe: string;
  side: string;
  positionId: string;
  anchor: string | null;
  resolvedExternalId: string | null;
  resolvedFirstSeenAt: string | null;
  resolvedLastSeenAt: string | null;
  diffSeconds: number | null;
  exactReadModel: boolean;
  candidateSummary: {
    directRawPayloadCandidates: number;
    strictOpenTimeCandidates: number;
    oneMinuteOpenTimeCandidates: number;
    thirtyMinuteOpenTimeCandidates: number;
    unresolvedReason: string | null;
  };
};

const LOOKBACK_DAYS = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_MUDREX_POSITION_LOOKBACK_DAYS || 7)
);
const LIMIT = Math.max(
  1,
  Number(process.env.SUGGESTED_TRADES_MUDREX_POSITION_RESOLUTION_LIMIT || 1000)
);
const MAX_UNSAFE_MISMATCHES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_MUDREX_POSITION_UNSAFE_MISMATCHES || 0)
);
const MAX_UNRESOLVED_PREFERRED = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_MUDREX_POSITION_UNRESOLVED || 0)
);
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_MUDREX_POSITION_RESOLUTION_OUTPUT_FILE ||
    'artifacts/suggested-trades-mudrex-position-resolution.json'
).trim();

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNullableString(value: unknown): string | null {
  const valueAsString = readString(value);
  return valueAsString ? valueAsString : null;
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readCount(value: unknown): number {
  const numeric = readNullableNumber(value);
  return numeric === null ? 0 : Math.max(0, Math.floor(numeric));
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDate(value: unknown): Date | null {
  const iso = toIsoString(value);
  return iso ? new Date(iso) : null;
}

function parsePayload(value: unknown): JsonRecord | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as JsonRecord)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function normalizeDirection(value: unknown): 'LONG' | 'SHORT' | null {
  const normalized = readString(value).toUpperCase();
  if (normalized === 'BUY' || normalized === 'LONG') {
    return 'LONG';
  }
  if (normalized === 'SELL' || normalized === 'SHORT') {
    return 'SHORT';
  }
  return null;
}

function resolvePayloadDirection(payload: JsonRecord | null): 'LONG' | 'SHORT' | null {
  return (
    normalizeDirection(payload?.position_type) ??
    normalizeDirection(payload?.positionType) ??
    normalizeDirection(payload?.order_type) ??
    normalizeDirection(payload?.orderType) ??
    normalizeDirection(payload?.side) ??
    normalizeDirection(payload?.position_side) ??
    normalizeDirection(payload?.positionSide)
  );
}

function resolveSnapshotDirection(externalId: string | null, payload: JsonRecord | null) {
  return resolvePayloadDirection(payload) ?? normalizeDirection(externalId?.split(':').pop());
}

function resolveRowDirection(row: CandidateRow): 'LONG' | 'SHORT' | null {
  const payload = parsePayload(row.payload);
  return (
    normalizeDirection(row.sideKey) ??
    normalizeDirection(row.side) ??
    resolvePayloadDirection(payload) ??
    normalizeDirection(row.externalId?.split(':').pop())
  );
}

function resolveAnchor(row: MudrexExecutionRow): Date | null {
  return (
    toDate(row.positionOpenedAt) ??
    toDate(row.filledAt) ??
    toDate(row.submittedAt) ??
    toDate(row.signalTime)
  );
}

function resolveOpenedDiffSeconds(firstSeenAt: unknown, anchor: Date | null): number | null {
  if (!anchor) {
    return null;
  }
  const firstSeenDate = toDate(firstSeenAt);
  if (!firstSeenDate) {
    return null;
  }
  return Math.abs(firstSeenDate.getTime() - anchor.getTime()) / 1000;
}

function hasDirectRawPayloadMatch(payload: JsonRecord | null, positionId: string): boolean {
  if (!payload) {
    return false;
  }
  const identifiers = [payload.id, payload.position_id, payload.positionId];
  return identifiers.some((value) => readNullableString(value) === positionId);
}

function countByType(items: ResolutionItem[]): JsonRecord {
  return items.reduce<JsonRecord>((acc, item) => {
    acc[item.type] = readCount(acc[item.type]) + 1;
    return acc;
  }, {});
}

async function persistReport(report: JsonRecord): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }
  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function queryMudrexExecutions(): Promise<MudrexExecutionRow[]> {
  const rows = (await coreDataSource.query(
    `SELECT execution_record.suggested_trade_id AS suggestedTradeId,
            execution_record.user_id AS userId,
            execution_record.account_id AS accountId,
            suggested_trade.symbol AS symbol,
            suggested_trade.timeframe AS timeframe,
            suggested_trade.side AS side,
            suggested_trade.signal_time AS signalTime,
            execution_record.submitted_at AS submittedAt,
            execution_record.filled_at AS filledAt,
            execution_record.position_opened_at AS positionOpenedAt,
            execution_record.position_id AS positionId
       FROM suggested_trade_executions execution_record
       JOIN suggested_trades suggested_trade
         ON suggested_trade.id = execution_record.suggested_trade_id
      WHERE LOWER(COALESCE(execution_record.broker_key, '')) = 'mudrex'
        AND execution_record.position_id IS NOT NULL
        AND COALESCE(
              execution_record.position_opened_at,
              execution_record.filled_at,
              execution_record.submitted_at,
              suggested_trade.signal_time
            ) >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
      ORDER BY COALESCE(
                 execution_record.position_opened_at,
                 execution_record.filled_at,
                 execution_record.submitted_at,
                 suggested_trade.signal_time
               ) DESC,
               execution_record.updated_at DESC
      LIMIT ${LIMIT}`,
    [LOOKBACK_DAYS]
  )) as JsonRecord[];

  return rows
    .map((row) => ({
      suggestedTradeId: readString(row.suggestedTradeId),
      userId: readString(row.userId),
      accountId: readString(row.accountId),
      symbol: readString(row.symbol),
      timeframe: readString(row.timeframe),
      side: readString(row.side).toUpperCase(),
      signalTime: (row.signalTime as Date | string | null) ?? null,
      submittedAt: (row.submittedAt as Date | string | null) ?? null,
      filledAt: (row.filledAt as Date | string | null) ?? null,
      positionOpenedAt: (row.positionOpenedAt as Date | string | null) ?? null,
      positionId: readString(row.positionId),
    }))
    .filter((row) => row.suggestedTradeId && row.userId && row.accountId && row.positionId);
}

async function hasExactReadModel(row: MudrexExecutionRow): Promise<boolean> {
  const rows = (await coreDataSource.query(
    `SELECT position_model.external_id AS externalId
       FROM position_read_models position_model
      WHERE position_model.user_id = ?
        AND position_model.account_id = ?
        AND LOWER(position_model.broker_key) = 'mudrex'
        AND position_model.external_id = ?
      LIMIT 1`,
    [row.userId, row.accountId, row.positionId]
  )) as JsonRecord[];
  return rows.length > 0;
}

async function queryCandidates(
  row: MudrexExecutionRow,
  anchor: Date | null
): Promise<CandidateRow[]> {
  if (!anchor) {
    return [];
  }

  const rows = (await coreDataSource.query(
    `SELECT position_model.external_id AS externalId,
            position_model.side AS side,
            position_model.side_key AS sideKey,
            position_model.first_seen_at AS firstSeenAt,
            position_model.position_created_at AS positionCreatedAt,
            position_model.last_seen_at AS lastSeenAt,
            position_model.payload_json AS payload,
            ABS(TIMESTAMPDIFF(
              SECOND,
              COALESCE(position_model.position_created_at, position_model.first_seen_at),
              ?
            )) AS diffSeconds
       FROM position_read_models position_model
      WHERE position_model.user_id = ?
        AND position_model.account_id = ?
        AND LOWER(position_model.broker_key) = 'mudrex'
        AND LOWER(position_model.symbol) = LOWER(?)
        AND COALESCE(position_model.position_created_at, position_model.first_seen_at) IS NOT NULL
        AND COALESCE(position_model.position_created_at, position_model.first_seen_at)
              BETWEEN DATE_SUB(?, INTERVAL 30 MINUTE)
                  AND DATE_ADD(?, INTERVAL 30 MINUTE)
      ORDER BY diffSeconds ASC, position_model.last_seen_at DESC
      LIMIT 20`,
    [anchor, row.userId, row.accountId, row.symbol, anchor, anchor]
  )) as JsonRecord[];

  return rows.map((candidate) => ({
    externalId: readNullableString(candidate.externalId),
    side: readNullableString(candidate.side),
    sideKey: readNullableString(candidate.sideKey),
    firstSeenAt: (candidate.firstSeenAt as Date | string | null) ?? null,
    positionCreatedAt: (candidate.positionCreatedAt as Date | string | null) ?? null,
    lastSeenAt: (candidate.lastSeenAt as Date | string | null) ?? null,
    payload: candidate.payload,
    diffSeconds: (candidate.diffSeconds as number | string | null) ?? null,
  }));
}

function summarizeCandidates(
  row: MudrexExecutionRow,
  candidates: CandidateRow[],
  anchor: Date | null
): ResolutionItem['candidateSummary'] {
  const expectedDirection = normalizeDirection(row.side);
  const directRawPayloadCandidates = candidates.filter((candidate) =>
    hasDirectRawPayloadMatch(parsePayload(candidate.payload), row.positionId)
  ).length;
  const compatibleCandidates = candidates
    .map((candidate) => {
      const direction = resolveRowDirection(candidate);
      const diffSeconds =
        readNullableNumber(candidate.diffSeconds) ??
        resolveOpenedDiffSeconds(candidate.positionCreatedAt ?? candidate.firstSeenAt, anchor);
      return { direction, diffSeconds };
    })
    .filter((candidate): candidate is { direction: 'LONG' | 'SHORT'; diffSeconds: number } =>
      Boolean(
        expectedDirection &&
        candidate.direction === expectedDirection &&
        candidate.diffSeconds !== null
      )
    );
  const strictOpenTimeCandidates = compatibleCandidates.filter(
    (candidate) => candidate.diffSeconds <= 5
  ).length;
  const oneMinuteOpenTimeCandidates = compatibleCandidates.filter(
    (candidate) => candidate.diffSeconds <= 60
  ).length;
  const thirtyMinuteOpenTimeCandidates = compatibleCandidates.filter(
    (candidate) => candidate.diffSeconds <= 30 * 60
  ).length;
  let unresolvedReason: string | null = null;
  if (!anchor) {
    unresolvedReason = 'missing_anchor';
  } else if (!expectedDirection) {
    unresolvedReason = 'missing_expected_side';
  } else if (strictOpenTimeCandidates > 1) {
    unresolvedReason = 'ambiguous_strict_open_time';
  } else if (strictOpenTimeCandidates === 0 && oneMinuteOpenTimeCandidates > 1) {
    unresolvedReason = 'ambiguous_one_minute_open_time';
  } else if (directRawPayloadCandidates === 0 && thirtyMinuteOpenTimeCandidates === 0) {
    unresolvedReason = 'no_direct_or_time_candidate';
  }

  return {
    directRawPayloadCandidates,
    strictOpenTimeCandidates,
    oneMinuteOpenTimeCandidates,
    thirtyMinuteOpenTimeCandidates,
    unresolvedReason,
  };
}

function classifyResolution(input: {
  row: MudrexExecutionRow;
  exactReadModel: boolean;
  resolvedExternalId: string | null;
  resolvedPayload: JsonRecord | null;
  resolvedFirstSeenAt: unknown;
  anchor: Date | null;
}): ResolutionClassification {
  const expectedDirection = normalizeDirection(input.row.side);
  const resolvedDirection = resolveSnapshotDirection(
    input.resolvedExternalId,
    input.resolvedPayload
  );
  const diffSeconds = resolveOpenedDiffSeconds(input.resolvedFirstSeenAt, input.anchor);

  if (!input.resolvedExternalId) {
    return 'unresolved_preferred';
  }
  if (input.exactReadModel && input.resolvedExternalId === input.row.positionId) {
    return 'exact_read_model';
  }
  if (hasDirectRawPayloadMatch(input.resolvedPayload, input.row.positionId)) {
    return 'direct_raw_payload';
  }
  if (
    expectedDirection &&
    resolvedDirection === expectedDirection &&
    diffSeconds !== null &&
    diffSeconds <= 60
  ) {
    return 'strict_open_time';
  }
  return 'unsafe_mismatch';
}

async function auditExecution(
  repository: SuggestedTradeRepository,
  row: MudrexExecutionRow,
  since: Date
): Promise<ResolutionItem> {
  const anchor = resolveAnchor(row);
  const exactReadModel = await hasExactReadModel(row);
  const snapshots = await repository.getLinkedPositionSnapshots(
    row.userId,
    'mudrex',
    row.accountId,
    row.symbol,
    since,
    20,
    row.positionId,
    {
      preferredPositionOpenedAt: anchor,
      preferredSide: row.side,
    }
  );
  const first = snapshots[0] ?? null;
  const resolvedExternalId = first?.externalId ?? null;
  const resolvedPayload = parsePayload(first?.payload);
  const diffSeconds = resolveOpenedDiffSeconds(first?.firstSeenAt, anchor);
  const candidates = await queryCandidates(row, anchor);
  const candidateSummary = summarizeCandidates(row, candidates, anchor);
  const type = classifyResolution({
    row,
    exactReadModel,
    resolvedExternalId,
    resolvedPayload,
    resolvedFirstSeenAt: first?.firstSeenAt,
    anchor,
  });

  return {
    type,
    suggestedTradeId: row.suggestedTradeId,
    accountId: row.accountId,
    symbol: row.symbol,
    timeframe: row.timeframe,
    side: row.side,
    positionId: row.positionId,
    anchor: anchor?.toISOString() ?? null,
    resolvedExternalId,
    resolvedFirstSeenAt: toIsoString(first?.firstSeenAt),
    resolvedLastSeenAt: toIsoString(first?.lastSeenAt),
    diffSeconds,
    exactReadModel,
    candidateSummary,
  };
}

async function run(): Promise<void> {
  await initializeCoreDataSource();

  try {
    const generatedAt = new Date();
    const since = new Date(generatedAt.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const repository = new SuggestedTradeRepository();
    const executions = await queryMudrexExecutions();
    const items: ResolutionItem[] = [];

    for (const row of executions) {
      items.push(await auditExecution(repository, row, since));
    }

    const unsafeItems = items.filter((item) => item.type === 'unsafe_mismatch');
    const unresolvedItems = items.filter((item) => item.type === 'unresolved_preferred');
    const rawPositionItems = items.filter((item) => !item.exactReadModel);
    const report = {
      generatedAt: generatedAt.toISOString(),
      lookbackDays: LOOKBACK_DAYS,
      limit: LIMIT,
      audited: items.length,
      exactReadModel: items.filter((item) => item.exactReadModel).length,
      rawOrMissingExactReadModel: rawPositionItems.length,
      directRawPayload: items.filter((item) => item.type === 'direct_raw_payload').length,
      strictOpenTime: items.filter((item) => item.type === 'strict_open_time').length,
      unresolvedPreferred: unresolvedItems.length,
      unsafeMismatch: unsafeItems.length,
      maxUnsafeMismatches: MAX_UNSAFE_MISMATCHES,
      maxUnresolvedPreferred: MAX_UNRESOLVED_PREFERRED,
      byType: countByType(items),
      rawPositionItems,
      unsafeItems,
      unresolvedItems,
    };

    await persistReport(report);
    console.log('suggested-trades-mudrex-position-resolution:', JSON.stringify(report));

    if (unsafeItems.length > MAX_UNSAFE_MISMATCHES) {
      throw new Error(
        `Mudrex unsafe position resolutions ${unsafeItems.length} exceeds ${MAX_UNSAFE_MISMATCHES}`
      );
    }
    if (unresolvedItems.length > MAX_UNRESOLVED_PREFERRED) {
      throw new Error(
        `Mudrex unresolved preferred position resolutions ${unresolvedItems.length} exceeds ${MAX_UNRESOLVED_PREFERRED}`
      );
    }
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
