import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { loadBrokerOrderOrphans, OrphanOrderItem } from './broker-order-orphans-lib';

type JsonRecord = Record<string, unknown>;

type LineageReportItem = {
  brokerKey: string;
  accountId: string;
  accountName: string | null;
  userId: string;
  symbol: string;
  externalId: string;
  orderStatus: string | null;
  directExecutionMatches: JsonRecord[];
  directSubmissionMatches: JsonRecord[];
  relatedExecutions: JsonRecord[];
  relatedSubmissions: JsonRecord[];
  recentSuggestedTrades: JsonRecord[];
  automationOutputs: JsonRecord[];
  recommendation: 'review_keep_candidate' | 'stale_cancel_candidate' | 'manual_review_required';
  reason: string;
};

const OUTPUT_FILE = String(
  process.env.BROKER_ORPHAN_ENTRY_LINEAGE_OUTPUT_FILE ||
    'artifacts/broker-orphan-entry-lineage.json'
).trim();
const RELATED_LOOKBACK_HOURS = Math.max(
  1,
  Number(process.env.BROKER_ORPHAN_ENTRY_LINEAGE_LOOKBACK_HOURS || 72)
);
const LIMIT = Math.max(1, Number(process.env.BROKER_ORPHAN_ENTRY_LINEAGE_LIMIT || 100));

function readString(value: unknown): string {
  return String(value || '').trim();
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',');
}

function lower(value: unknown): string {
  return readString(value).toLowerCase();
}

function upper(value: unknown): string {
  return readString(value).toUpperCase();
}

function asIso(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeRow(row: JsonRecord): JsonRecord {
  const output: JsonRecord = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      output[key] = value.toISOString();
    } else {
      output[key] = value;
    }
  }
  return output;
}

function isActiveExecution(row: JsonRecord): boolean {
  const executionState = lower(row.executionState);
  const orderStatus = lower(row.orderStatus);
  const tradeStatus = lower(row.tradeStatus);
  const positionStatus = lower(row.positionStatus);
  const terminal = new Set([
    'closed',
    'cancelled',
    'canceled',
    'rejected',
    'expired',
    'failed',
    'filled',
    'completed',
  ]);

  return !(
    terminal.has(executionState) ||
    terminal.has(orderStatus) ||
    terminal.has(tradeStatus) ||
    terminal.has(positionStatus)
  );
}

function isTerminalExecution(row: JsonRecord): boolean {
  return (
    ['closed', 'cancelled', 'canceled', 'rejected', 'expired', 'failed'].includes(
      lower(row.executionState)
    ) || ['closed', 'liquidated'].includes(lower(row.positionStatus))
  );
}

function isActiveSubmission(row: JsonRecord): boolean {
  const status = lower(row.status);
  const placementState = lower(row.placementState);
  const brokerOrderStatus = lower(row.brokerOrderStatus);
  const terminal = new Set([
    'closed',
    'cancelled',
    'canceled',
    'rejected',
    'expired',
    'failed',
    'filled',
  ]);

  return (
    !terminal.has(status) &&
    !terminal.has(placementState) &&
    !terminal.has(brokerOrderStatus) &&
    ['open', 'pending', 'placed', 'completed'].some(
      (value) => status === value || placementState === value || brokerOrderStatus === value
    )
  );
}

function isActiveAutomation(row: JsonRecord): boolean {
  return ['active', 'running', 'enabled'].includes(lower(row.automationStatus));
}

function chooseRecommendation(
  directExecutionMatches: JsonRecord[],
  directSubmissionMatches: JsonRecord[],
  recentSuggestedTrades: JsonRecord[]
): Pick<LineageReportItem, 'recommendation' | 'reason'> {
  const activeDirectExecution = directExecutionMatches.some(isActiveExecution);
  const terminalDirectExecution =
    directExecutionMatches.length > 0 && directExecutionMatches.every(isTerminalExecution);
  const activeDirectSubmission = directSubmissionMatches.some(isActiveSubmission);
  const activeRecentTrade = recentSuggestedTrades.some(
    (row) => isActiveExecution(row) && isActiveAutomation(row)
  );

  if (terminalDirectExecution && !activeDirectExecution) {
    return {
      recommendation: 'stale_cancel_candidate',
      reason:
        'The broker order has a direct execution owner, but that execution/position is terminal while the entry order is still open.',
    };
  }

  if (activeDirectExecution || activeDirectSubmission) {
    return {
      recommendation: 'review_keep_candidate',
      reason:
        'This orphan entry has a direct live execution/submission ledger match. Review before cancelling.',
    };
  }

  if (directExecutionMatches.length || directSubmissionMatches.length || activeRecentTrade) {
    return {
      recommendation: 'manual_review_required',
      reason:
        'There is nearby automation lineage, but no clearly active direct owner for the broker order.',
    };
  }

  return {
    recommendation: 'stale_cancel_candidate',
    reason:
      'No direct execution/submission owner or active recent automation lineage was found for this broker order.',
  };
}

async function queryRows(sql: string, params: unknown[]): Promise<JsonRecord[]> {
  return ((await coreDataSource.query(sql, params)) as JsonRecord[]).map(normalizeRow);
}

async function loadExecutionRows(
  entries: OrphanOrderItem[],
  sinceIso: string
): Promise<JsonRecord[]> {
  const ids = Array.from(new Set(entries.map((item) => item.externalId)));
  const symbols = Array.from(new Set(entries.map((item) => upper(item.symbol))));
  const accountIds = Array.from(new Set(entries.map((item) => item.accountId)));

  if (!ids.length || !symbols.length || !accountIds.length) {
    return [];
  }

  return queryRows(
    `SELECT ste.suggested_trade_id AS suggestedTradeId,
            st.automation_id AS automationId,
            st.automation_run_id AS automationRunId,
            st.symbol,
            st.timeframe,
            st.side,
            st.status AS tradeStatus,
            st.signal_time AS signalTime,
            st.created_at AS suggestedTradeCreatedAt,
            a.name AS automationName,
            a.status AS automationStatus,
            a.scopeSymbol AS automationScopeSymbol,
            a.scopeTimeframe AS automationScopeTimeframe,
            ste.user_id AS userId,
            ste.broker_key AS brokerKey,
            ste.account_id AS accountId,
            ste.order_id AS orderId,
            ste.order_status AS orderStatus,
            ste.execution_state AS executionState,
            ste.position_id AS positionId,
            ste.position_status AS positionStatus,
            ste.submitted_at AS submittedAt,
            ste.linked_at AS linkedAt,
            ste.filled_at AS filledAt,
            ste.canceled_at AS canceledAt,
            ste.updated_at AS updatedAt,
            ste.note AS note
       FROM suggested_trade_executions ste
       LEFT JOIN suggested_trades st
         ON st.id = ste.suggested_trade_id
       LEFT JOIN automations a
         ON a.id = st.automation_id
      WHERE ste.order_id IN (${placeholders(ids)})
         OR (
              ste.updated_at >= ?
          AND ste.account_id IN (${placeholders(accountIds)})
          AND UPPER(st.symbol) IN (${placeholders(symbols)})
         )
      ORDER BY ste.updated_at DESC
      LIMIT ${LIMIT}`,
    [...ids, sinceIso, ...accountIds, ...symbols]
  );
}

async function loadSubmissionRows(
  entries: OrphanOrderItem[],
  sinceIso: string
): Promise<JsonRecord[]> {
  const ids = Array.from(new Set(entries.map((item) => item.externalId)));
  const symbols = Array.from(new Set(entries.map((item) => upper(item.symbol))));
  const accountIds = Array.from(new Set(entries.map((item) => item.accountId)));

  if (!ids.length || !symbols.length || !accountIds.length) {
    return [];
  }

  return queryRows(
    `SELECT osr.id,
            osr.user_id AS userId,
            osr.broker_key AS brokerKey,
            osr.account_id AS accountId,
            osr.suggested_trade_id AS suggestedTradeId,
            osr.asset_id AS assetId,
            osr.status,
            osr.placement_state AS placementState,
            osr.broker_order_id AS brokerOrderId,
            osr.broker_order_status AS brokerOrderStatus,
            osr.reconciliation_state AS reconciliationState,
            osr.created_at AS createdAt,
            osr.updated_at AS updatedAt,
            osr.completed_at AS completedAt,
            osr.failed_at AS failedAt,
            JSON_UNQUOTE(JSON_EXTRACT(osr.request_json, '$.symbol')) AS requestSymbol,
            JSON_UNQUOTE(JSON_EXTRACT(osr.request_json, '$.order.symbol')) AS requestOrderSymbol,
            JSON_UNQUOTE(JSON_EXTRACT(osr.response_json, '$.order_id')) AS responseOrderId,
            JSON_UNQUOTE(JSON_EXTRACT(osr.response_json, '$.data.order_id')) AS responseDataOrderId
       FROM order_submission_requests osr
      WHERE osr.broker_order_id IN (${placeholders(ids)})
         OR JSON_UNQUOTE(JSON_EXTRACT(osr.response_json, '$.order_id')) IN (${placeholders(ids)})
         OR JSON_UNQUOTE(JSON_EXTRACT(osr.response_json, '$.data.order_id')) IN (${placeholders(ids)})
         OR (
              osr.updated_at >= ?
          AND osr.account_id IN (${placeholders(accountIds)})
          AND (
               UPPER(osr.asset_id) IN (${placeholders(symbols)})
            OR UPPER(JSON_UNQUOTE(JSON_EXTRACT(osr.request_json, '$.symbol'))) IN (${placeholders(symbols)})
            OR UPPER(JSON_UNQUOTE(JSON_EXTRACT(osr.request_json, '$.order.symbol'))) IN (${placeholders(symbols)})
          )
         )
      ORDER BY osr.updated_at DESC
      LIMIT ${LIMIT}`,
    [...ids, ...ids, ...ids, sinceIso, ...accountIds, ...symbols, ...symbols, ...symbols]
  );
}

async function loadRecentSuggestedTrades(
  entries: OrphanOrderItem[],
  sinceIso: string
): Promise<JsonRecord[]> {
  const symbols = Array.from(new Set(entries.map((item) => upper(item.symbol))));
  if (!symbols.length) {
    return [];
  }

  return queryRows(
    `SELECT st.id AS suggestedTradeId,
            st.automation_id AS automationId,
            st.automation_run_id AS automationRunId,
            st.symbol,
            st.timeframe,
            st.side,
            st.status AS tradeStatus,
            st.signal_time AS signalTime,
            st.created_at AS createdAt,
            st.updated_at AS updatedAt,
            a.name AS automationName,
            a.status AS automationStatus,
            a.scopeSymbol AS automationScopeSymbol,
            a.scopeTimeframe AS automationScopeTimeframe,
            ste.broker_key AS brokerKey,
            ste.account_id AS accountId,
            ste.order_id AS orderId,
            ste.order_status AS orderStatus,
            ste.execution_state AS executionState,
            ste.position_id AS positionId,
            ste.position_status AS positionStatus,
            ste.updated_at AS executionUpdatedAt
       FROM suggested_trades st
       LEFT JOIN suggested_trade_executions ste
         ON ste.suggested_trade_id = st.id
       LEFT JOIN automations a
         ON a.id = st.automation_id
      WHERE st.created_at >= ?
        AND UPPER(st.symbol) IN (${placeholders(symbols)})
      ORDER BY st.created_at DESC
      LIMIT ${LIMIT}`,
    [sinceIso, ...symbols]
  );
}

async function loadAutomationOutputs(entries: OrphanOrderItem[]): Promise<JsonRecord[]> {
  const ids = Array.from(new Set(entries.map((item) => item.externalId)));
  const symbols = Array.from(new Set(entries.map((item) => upper(item.symbol))));
  if (!ids.length || !symbols.length) {
    return [];
  }

  return queryRows(
    `SELECT aro.id,
            aro.automation_id AS automationId,
            aro.automation_run_id AS automationRunId,
            aro.suggested_trade_id AS suggestedTradeId,
            aro.output_type AS outputType,
            aro.status,
            aro.title,
            aro.created_at AS createdAt,
            aro.updated_at AS updatedAt,
            JSON_UNQUOTE(JSON_EXTRACT(aro.payload_json, '$.symbol')) AS payloadSymbol,
            JSON_UNQUOTE(JSON_EXTRACT(aro.payload_json, '$.order_id')) AS payloadOrderId,
            JSON_UNQUOTE(JSON_EXTRACT(aro.payload_json, '$.broker_order_id')) AS payloadBrokerOrderId
       FROM automation_run_outputs aro
      WHERE JSON_UNQUOTE(JSON_EXTRACT(aro.payload_json, '$.order_id')) IN (${placeholders(ids)})
         OR JSON_UNQUOTE(JSON_EXTRACT(aro.payload_json, '$.broker_order_id')) IN (${placeholders(ids)})
         OR UPPER(JSON_UNQUOTE(JSON_EXTRACT(aro.payload_json, '$.symbol'))) IN (${placeholders(symbols)})
      ORDER BY aro.created_at DESC
      LIMIT ${LIMIT}`,
    [...ids, ...ids, ...symbols]
  );
}

function belongsToEntry(row: JsonRecord, item: OrphanOrderItem): boolean {
  const rowAccountId = readString(row.accountId);
  const rowBrokerKey = lower(row.brokerKey);
  const rowSymbol = upper(row.symbol || row.requestSymbol || row.requestOrderSymbol || row.assetId);
  return (
    (!rowAccountId || rowAccountId === item.accountId) &&
    (!rowBrokerKey || rowBrokerKey === lower(item.brokerKey)) &&
    rowSymbol === upper(item.symbol)
  );
}

function buildReportItem(
  item: OrphanOrderItem,
  executions: JsonRecord[],
  submissions: JsonRecord[],
  suggestedTrades: JsonRecord[],
  automationOutputs: JsonRecord[]
): LineageReportItem {
  const directExecutionMatches = executions.filter(
    (row) => readString(row.orderId) === item.externalId
  );
  const directSubmissionMatches = submissions.filter(
    (row) =>
      readString(row.brokerOrderId) === item.externalId ||
      readString(row.responseOrderId) === item.externalId ||
      readString(row.responseDataOrderId) === item.externalId
  );
  const relatedExecutions = executions.filter((row) => belongsToEntry(row, item));
  const relatedSubmissions = submissions.filter((row) => belongsToEntry(row, item));
  const recentSuggestedTrades = suggestedTrades.filter((row) => belongsToEntry(row, item));
  const itemAutomationOutputs = automationOutputs.filter((row) => {
    const payloadOrderIds = [row.payloadOrderId, row.payloadBrokerOrderId].map(readString);
    const payloadSymbol = upper(row.payloadSymbol);
    return payloadOrderIds.includes(item.externalId) || payloadSymbol === upper(item.symbol);
  });
  const recommendation = chooseRecommendation(
    directExecutionMatches,
    directSubmissionMatches,
    recentSuggestedTrades
  );

  return {
    brokerKey: item.brokerKey,
    accountId: item.accountId,
    accountName: item.accountName,
    userId: item.userId,
    symbol: item.symbol,
    externalId: item.externalId,
    orderStatus: item.orderStatus,
    directExecutionMatches,
    directSubmissionMatches,
    relatedExecutions,
    relatedSubmissions,
    recentSuggestedTrades,
    automationOutputs: itemAutomationOutputs,
    ...recommendation,
  };
}

function summarize(items: LineageReportItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.recommendation] = (acc[item.recommendation] || 0) + 1;
    return acc;
  }, {});
}

async function persistReport(report: JsonRecord): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }
  const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  await initializeCoreDataSource();
  const sinceDate = new Date(Date.now() - RELATED_LOOKBACK_HOURS * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();
  const entries = (await loadBrokerOrderOrphans()).filter((item) => item.kind === 'orphan_entry');
  const [executions, submissions, suggestedTrades, automationOutputs] = await Promise.all([
    loadExecutionRows(entries, sinceIso),
    loadSubmissionRows(entries, sinceIso),
    loadRecentSuggestedTrades(entries, sinceIso),
    loadAutomationOutputs(entries),
  ]);
  const items = entries.map((entry) =>
    buildReportItem(entry, executions, submissions, suggestedTrades, automationOutputs)
  );
  const report = {
    generatedAt: new Date().toISOString(),
    relatedLookbackHours: RELATED_LOOKBACK_HOURS,
    relatedSince: asIso(sinceIso),
    summary: summarize(items),
    items,
  };

  await persistReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  });
