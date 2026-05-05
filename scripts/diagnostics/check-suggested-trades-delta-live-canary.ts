import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';

type AnyRecord = Record<string, any>;

const DEFAULT_LOOKBACK_MINUTES = 240;
const DEFAULT_LIMIT = 100;
const DELTA_BROKER_KEY = 'delta_exchange';

function readString(value: unknown): string {
  return String(value || '').trim();
}

function readNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeIso(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function resolveSinceIso(): string {
  const explicitSince = normalizeIso(process.env.SUGGESTED_TRADES_DELTA_LIVE_CANARY_SINCE);
  if (explicitSince) {
    return explicitSince;
  }
  const lookbackMinutes = Math.max(
    1,
    Math.floor(
      readNumber(
        process.env.SUGGESTED_TRADES_DELTA_LIVE_CANARY_LOOKBACK_MINUTES,
        DEFAULT_LOOKBACK_MINUTES
      )
    )
  );
  return new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();
}

function countBy(rows: AnyRecord[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = readString(row[key]) || 'unknown';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function countReasons(rows: AnyRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const reason =
      readString(row.deltaSupportMessage) ||
      readString(row.deltaSummary) ||
      readString(row.routeSummary) ||
      readString(row.preTradeBlockedReason) ||
      'no reason recorded';
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

async function queryRows(sql: string, params: unknown[]): Promise<AnyRecord[]> {
  return (await coreDataSource.query(sql, params)) as AnyRecord[];
}

async function run(): Promise<void> {
  const sinceIso = resolveSinceIso();
  const limit = Math.max(
    1,
    Math.floor(readNumber(process.env.SUGGESTED_TRADES_DELTA_LIVE_CANARY_LIMIT, DEFAULT_LIMIT))
  );
  const outputPath = readString(process.env.SUGGESTED_TRADES_DELTA_LIVE_CANARY_OUTPUT);

  await initializeCoreDataSource();

  const routeDecisions = await queryRows(
    `WITH RECURSIVE idx(i) AS (
       SELECT 0 UNION ALL SELECT i + 1 FROM idx WHERE i < 9
     )
     SELECT
       st.id AS suggestedTradeId,
       st.user_id AS userId,
       st.symbol,
       st.timeframe,
       st.side,
       st.status,
       st.created_at AS createdAt,
       st.signal_time AS signalTime,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.mode')) AS routeMode,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.decision')) AS routeDecision,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.selectedBrokerKey')) AS selectedBrokerKey,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.selectedAccountId')) AS selectedAccountId,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.selectedBrokerSymbol')) AS selectedBrokerSymbol,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.summary')) AS routeSummary,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', idx.i, '].brokerKey'))) AS deltaCandidateBrokerKey,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', idx.i, '].brokerSymbol'))) AS deltaBrokerSymbol,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', idx.i, '].supported'))) AS deltaSupported,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', idx.i, '].allowed'))) AS deltaAllowed,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', idx.i, '].supportMessage'))) AS deltaSupportMessage,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', idx.i, '].summary'))) AS deltaSummary,
       ste.broker_key AS executedBrokerKey,
       ste.order_id AS orderId,
       ste.execution_state AS executionState,
       ste.pre_trade_state AS preTradeState,
       ste.pre_trade_blocked_reason AS preTradeBlockedReason
     FROM suggested_trades st
     LEFT JOIN suggested_trade_executions ste ON ste.suggested_trade_id = st.id
     JOIN idx
     WHERE st.created_at >= ?
       AND JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, CONCAT('$.routeDecision.candidates[', idx.i, '].brokerKey'))) = ?
     ORDER BY st.created_at DESC
     LIMIT ${limit}`,
    [sinceIso, DELTA_BROKER_KEY]
  );

  const executions = await queryRows(
    `SELECT
       ste.suggested_trade_id AS suggestedTradeId,
       ste.user_id AS userId,
       st.symbol,
       st.timeframe,
       st.side,
       ste.broker_key AS brokerKey,
       ste.account_id AS accountId,
       ste.order_id AS orderId,
       ste.order_status AS orderStatus,
       ste.execution_state AS executionState,
       ste.pre_trade_state AS preTradeState,
       ste.pre_trade_blocked_reason AS preTradeBlockedReason,
       ste.protection_state AS protectionState,
       ste.protection_attempts AS protectionAttempts,
       ste.protection_last_error AS protectionLastError,
       ste.protection_checked_at AS protectionCheckedAt,
       ste.protection_attached_at AS protectionAttachedAt,
       ste.position_id AS positionId,
       ste.position_status AS positionStatus,
       ste.created_at AS createdAt,
       ste.updated_at AS updatedAt,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.selectedBrokerKey')) AS selectedBrokerKey,
       JSON_UNQUOTE(JSON_EXTRACT(st.meta_json, '$.routeDecision.summary')) AS routeSummary
     FROM suggested_trade_executions ste
     LEFT JOIN suggested_trades st ON st.id = ste.suggested_trade_id
     WHERE ste.created_at >= ? OR ste.updated_at >= ?
     ORDER BY ste.updated_at DESC
     LIMIT ${limit}`,
    [sinceIso, sinceIso]
  );

  const orderSubmissions = await queryRows(
    `SELECT
       osr.id,
       osr.user_id AS userId,
       osr.suggested_trade_id AS suggestedTradeId,
       osr.broker_key AS brokerKey,
       osr.account_id AS accountId,
       osr.asset_id AS assetId,
       osr.status,
       osr.placement_state AS placementState,
       osr.broker_order_id AS brokerOrderId,
       osr.broker_order_status AS brokerOrderStatus,
       osr.reconciliation_state AS reconciliationState,
       osr.created_at AS createdAt,
       osr.updated_at AS updatedAt,
       osr.failed_at AS failedAt,
       osr.error_json AS errorJson
     FROM order_submission_requests osr
     WHERE (osr.created_at >= ? OR osr.updated_at >= ?)
       AND LOWER(COALESCE(osr.broker_key, '')) = ?
     ORDER BY osr.updated_at DESC
     LIMIT ${limit}`,
    [sinceIso, sinceIso, DELTA_BROKER_KEY]
  );

  const deltaProtectionWatch = await queryRows(
    `SELECT
       ste.suggested_trade_id AS suggestedTradeId,
       st.symbol,
       ste.account_id AS accountId,
       ste.order_id AS orderId,
       ste.execution_state AS executionState,
       ste.protection_state AS protectionState,
       ste.protection_attempts AS protectionAttempts,
       ste.protection_last_error AS protectionLastError,
       ste.protection_checked_at AS protectionCheckedAt,
       ste.updated_at AS updatedAt
     FROM suggested_trade_executions ste
     LEFT JOIN suggested_trades st ON st.id = ste.suggested_trade_id
     WHERE LOWER(COALESCE(ste.broker_key, '')) = ?
       AND COALESCE(ste.protection_state, '') IN ('pending', 'waiting_for_fill', 'waiting_for_position', 'attaching', 'failed', 'manual_unlinked')
     ORDER BY ste.updated_at DESC
     LIMIT ${limit}`,
    [DELTA_BROKER_KEY]
  );

  const deltaExecutions = executions.filter(
    (row) => readString(row.brokerKey).toLowerCase() === DELTA_BROKER_KEY
  );
  const deltaSelected = routeDecisions.filter(
    (row) => readString(row.selectedBrokerKey).toLowerCase() === DELTA_BROKER_KEY
  );
  const deltaBlocked = routeDecisions.filter(
    (row) =>
      readString(row.deltaSupported).toLowerCase() === 'false' ||
      readString(row.deltaAllowed).toLowerCase() === 'false'
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    sinceIso,
    env: {
      brokerAllowlist: readString(process.env.SUGGESTED_TRADES_LIVE_AUTO_BROKER_ALLOWLIST),
      shadowBrokerAllowlist: readString(
        process.env.SUGGESTED_TRADES_LIVE_AUTO_SHADOW_BROKER_ALLOWLIST
      ),
      adaptiveRoutingMode: readString(
        process.env.SUGGESTED_TRADES_LIVE_AUTO_ADAPTIVE_ROUTING_MODE
      ),
      executionEnabled: readString(process.env.SUGGESTED_TRADES_LIVE_AUTO_EXECUTION_ENABLED),
    },
    counts: {
      routeDecisionsWithDeltaCandidate: routeDecisions.length,
      deltaSelectedRouteDecisions: deltaSelected.length,
      deltaBlockedRouteDecisions: deltaBlocked.length,
      executions: executions.length,
      deltaExecutions: deltaExecutions.length,
      deltaOrderSubmissions: orderSubmissions.length,
      deltaProtectionWatch: deltaProtectionWatch.length,
    },
    routeSelectedBrokerCounts: countBy(routeDecisions, 'selectedBrokerKey'),
    executionBrokerCounts: countBy(executions, 'brokerKey'),
    deltaExecutionStateCounts: countBy(deltaExecutions, 'executionState'),
    deltaOrderSubmissionStateCounts: countBy(orderSubmissions, 'placementState'),
    deltaProtectionStateCounts: countBy(deltaProtectionWatch, 'protectionState'),
    deltaBlockReasons: countReasons(deltaBlocked),
    routeDecisions,
    executions,
    orderSubmissions,
    deltaProtectionWatch,
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
