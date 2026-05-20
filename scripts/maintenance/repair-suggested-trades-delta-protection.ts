import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Container } from 'typedi';
import type { SuggestedTradeExecutionLink } from '../../src/api/contracts/SuggestedTrade';
import { SuggestedTradesService } from '../../src/api/services/SuggestedTradesService';
import { isSuggestedTradeProtectionRepairEnabledForBroker } from '../../src/api/services/suggested-trades/SuggestedTradeBrokerControls';
import { SuggestedTrade } from '../../src/database/entities/SuggestedTrade';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { SuggestedTradeRepository } from '../../src/database/repositories/SuggestedTradeRepository';
import { buildDeltaProtectionGuardrailReport } from '../checks/check-suggested-trades-delta-protection-guardrail';
import {
  buildDeltaProtectionRepairPreviewReport,
  type DeltaProtectionRepairAction,
  type DeltaProtectionRepairPreviewItem,
} from '../checks/check-suggested-trades-delta-protection-repair-preview';

type JsonRecord = Record<string, unknown>;
type DeltaRepairApplyStatus =
  | 'not_applied_apply_disabled'
  | 'blocked_broker_repair_disabled'
  | 'skipped_not_repairable'
  | 'skipped_unsupported_action'
  | 'skipped_trade_not_found'
  | 'skipped_execution_missing'
  | 'skipped_execution_mismatch'
  | 'applied'
  | 'no_change'
  | 'error';

type PositionSnapshots = Awaited<
  ReturnType<SuggestedTradeRepository['getLinkedPositionSnapshots']>
>;

type SuggestedTradesServiceInternals = {
  getExecutionLink: (trade: SuggestedTrade) => SuggestedTradeExecutionLink | null;
  maybeRemediateLiveProtection: (
    userId: string,
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink,
    positionSnapshots: PositionSnapshots
  ) => Promise<SuggestedTradeExecutionLink>;
  alignLiveAutoExecutionStateWithProtectionLifecycle: (
    execution: SuggestedTradeExecutionLink
  ) => SuggestedTradeExecutionLink;
  persistExecutionState: (
    trade: SuggestedTrade,
    execution: SuggestedTradeExecutionLink
  ) => Promise<void>;
};

type DeltaRepairApplyItem = {
  suggestedTradeId: string;
  userId: string;
  symbol: string;
  action: DeltaProtectionRepairAction;
  status: DeltaRepairApplyStatus;
  reason: string | null;
  entryOrderId: string | null;
  positionId: string | null;
  before: JsonRecord | null;
  after: JsonRecord | null;
};

const APPLY =
  String(process.env.SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY || '')
    .trim()
    .toLowerCase() === 'true';
const LIMIT = Math.max(
  1,
  Math.floor(Number(process.env.SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_LIMIT || 5))
);
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_OUTPUT_FILE ||
    'artifacts/suggested-trades-delta-protection-repair.json'
).trim();
const SUPPORTED_APPLY_ACTIONS = new Set<DeltaProtectionRepairAction>([
  'would_attach_missing_protection',
  'would_replace_mismatched_partial_fill_protection',
  'would_reconcile_native_bracket_protection',
]);

function readString(value: unknown): string {
  return String(value ?? '').trim();
}

function readBooleanEnvOverride(name: string): boolean | null {
  const raw = process.env[name];
  if (raw === undefined) {
    return null;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function readDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoString(value: unknown): string | null {
  return readDate(value)?.toISOString() ?? null;
}

function buildPositionSearchAnchor(anchor: unknown): Date {
  const fallback = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const parsed = readDate(anchor);
  if (!parsed) {
    return fallback;
  }
  return new Date(parsed.getTime() - 24 * 60 * 60 * 1000);
}

function summarizeExecution(execution: SuggestedTradeExecutionLink | null): JsonRecord | null {
  if (!execution) {
    return null;
  }
  const protectionPlan =
    execution.protectionPlan && typeof execution.protectionPlan === 'object'
      ? (execution.protectionPlan as JsonRecord)
      : {};
  return {
    executionState: execution.executionState ?? null,
    orderStatus: execution.orderStatus ?? null,
    positionStatus: execution.positionStatus ?? null,
    protectionState: execution.protectionState ?? null,
    protectionSource: execution.protectionSource ?? null,
    protectionAttempts: execution.protectionAttempts ?? null,
    protectionLastError: execution.protectionLastError ?? null,
    protectionCheckedAt: toIsoString(execution.protectionCheckedAt),
    protectionAttachedAt: toIsoString(execution.protectionAttachedAt),
    positionId: execution.positionId ?? null,
    stopLossOrderId: readString(protectionPlan.stopLossOrderId) || null,
    takeProfitOrderId: readString(protectionPlan.takeProfitOrderId) || null,
  };
}

function executionMatchesPreview(
  item: DeltaProtectionRepairPreviewItem,
  execution: SuggestedTradeExecutionLink
): { matched: boolean; reason: string | null } {
  if (readString(execution.brokerKey).toLowerCase() !== 'delta_exchange') {
    return { matched: false, reason: 'execution is not routed to Delta Exchange' };
  }
  if (item.accountId && readString(execution.accountId) !== item.accountId) {
    return { matched: false, reason: 'execution account no longer matches preview' };
  }
  if (item.entryOrderId && readString(execution.orderId) !== item.entryOrderId) {
    return { matched: false, reason: 'execution entry order no longer matches preview' };
  }
  const executionPositionId = readString(execution.positionId);
  if (
    item.positionReadModelExternalId &&
    executionPositionId &&
    executionPositionId !== item.positionReadModelExternalId
  ) {
    return { matched: false, reason: 'execution position no longer matches preview' };
  }
  return { matched: true, reason: null };
}

export function isDeltaProtectionRepairApplyActionSupported(
  action: DeltaProtectionRepairAction
): boolean {
  return SUPPORTED_APPLY_ACTIONS.has(action);
}

export function selectDeltaProtectionRepairApplyCandidates(
  items: DeltaProtectionRepairPreviewItem[],
  limit = LIMIT
): DeltaProtectionRepairPreviewItem[] {
  return items
    .filter(
      (item) =>
        item.remediation.repairable &&
        item.remediation.readiness === 'ready' &&
        SUPPORTED_APPLY_ACTIONS.has(item.remediation.action)
    )
    .slice(0, Math.max(1, Math.floor(limit)));
}

function buildSkippedItem(
  item: DeltaProtectionRepairPreviewItem,
  status: DeltaRepairApplyStatus,
  reason: string | null
): DeltaRepairApplyItem {
  return {
    suggestedTradeId: item.suggestedTradeId,
    userId: item.userId,
    symbol: item.symbol,
    action: item.remediation.action,
    status,
    reason,
    entryOrderId: item.entryOrderId,
    positionId: item.positionReadModelExternalId,
    before: null,
    after: null,
  };
}

async function applyCandidate(input: {
  item: DeltaProtectionRepairPreviewItem;
  repository: SuggestedTradeRepository;
  service: SuggestedTradesServiceInternals;
}): Promise<DeltaRepairApplyItem> {
  const { item, repository, service } = input;
  const trade = await repository.getSuggestedTradeById(item.userId, item.suggestedTradeId);
  if (!trade) {
    return buildSkippedItem(item, 'skipped_trade_not_found', 'suggested trade was not found');
  }

  const execution = service.getExecutionLink(trade);
  if (!execution) {
    return buildSkippedItem(item, 'skipped_execution_missing', 'execution record was not found');
  }

  const match = executionMatchesPreview(item, execution);
  if (!match.matched) {
    return {
      ...buildSkippedItem(item, 'skipped_execution_mismatch', match.reason),
      before: summarizeExecution(execution),
    };
  }

  const accountId = readString(execution.accountId);
  if (!accountId) {
    return {
      ...buildSkippedItem(item, 'skipped_execution_mismatch', 'execution account id is missing'),
      before: summarizeExecution(execution),
    };
  }

  const anchor = buildPositionSearchAnchor(
    execution.submittedAt ??
      execution.filledAt ??
      execution.linkedAt ??
      trade.signalTime?.toISOString?.() ??
      trade.createdAt?.toISOString?.()
  );
  const positionSnapshots = await repository.getLinkedPositionSnapshots(
    item.userId,
    'delta_exchange',
    accountId,
    trade.symbol,
    anchor,
    20,
    item.positionReadModelExternalId ?? execution.positionId ?? item.positionId,
    {
      preferredPositionOpenedAt:
        execution.positionOpenedAt ??
        execution.filledAt ??
        execution.submittedAt ??
        execution.linkedAt ??
        trade.signalTime?.toISOString?.() ??
        trade.createdAt?.toISOString?.(),
      preferredSide: trade.side,
    }
  );

  const before = summarizeExecution(execution);
  try {
    let nextExecution = await service.maybeRemediateLiveProtection(
      item.userId,
      trade,
      execution,
      positionSnapshots
    );
    nextExecution = service.alignLiveAutoExecutionStateWithProtectionLifecycle(nextExecution);
    const after = summarizeExecution(nextExecution);
    if (JSON.stringify(execution ?? null) === JSON.stringify(nextExecution ?? null)) {
      return {
        ...buildSkippedItem(item, 'no_change', 'existing remediation path did not change state'),
        before,
        after,
      };
    }

    await service.persistExecutionState(trade, nextExecution);
    return {
      ...buildSkippedItem(item, 'applied', null),
      before,
      after,
    };
  } catch (error) {
    return {
      ...buildSkippedItem(
        item,
        'error',
        error instanceof Error ? error.message : String(error)
      ),
      before,
      after: null,
    };
  }
}

async function persistReport(report: JsonRecord): Promise<void> {
  if (!OUTPUT_FILE) {
    return;
  }
  const absoluteOutputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function run(): Promise<void> {
  await initializeCoreDataSource();

  try {
    const guardrailReport = await buildDeltaProtectionGuardrailReport();
    const previewReport = buildDeltaProtectionRepairPreviewReport(guardrailReport);
    const candidates = selectDeltaProtectionRepairApplyCandidates(previewReport.items, LIMIT);
    const unsupportedRepairableItems = previewReport.items.filter(
      (item) =>
        item.remediation.repairable &&
        item.remediation.readiness === 'ready' &&
        !SUPPORTED_APPLY_ACTIONS.has(item.remediation.action)
    ).length;
    const brokerRepairEnabled = isSuggestedTradeProtectionRepairEnabledForBroker(
      'delta_exchange',
      readBooleanEnvOverride
    );

    let items: DeltaRepairApplyItem[] = [];
    if (!APPLY) {
      items = candidates.map((item) =>
        buildSkippedItem(
          item,
          'not_applied_apply_disabled',
          'set SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY=true to enable apply mode'
        )
      );
    } else if (!brokerRepairEnabled) {
      items = candidates.map((item) =>
        buildSkippedItem(
          item,
          'blocked_broker_repair_disabled',
          'set SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED=true before applying Delta repairs'
        )
      );
    } else {
      const repository = Container.get(SuggestedTradeRepository);
      const service = Container.get(
        SuggestedTradesService
      ) as unknown as SuggestedTradesServiceInternals;
      for (const item of candidates) {
        items.push(await applyCandidate({ item, repository, service }));
      }
    }

    const appliedItems = items.filter((item) => item.status === 'applied').length;
    const noChangeItems = items.filter((item) => item.status === 'no_change').length;
    const errorItems = items.filter((item) => item.status === 'error').length;
    const blockedItems = items.filter(
      (item) =>
        item.status === 'blocked_broker_repair_disabled' ||
        item.status === 'skipped_execution_mismatch' ||
        item.status === 'skipped_trade_not_found' ||
        item.status === 'skipped_execution_missing'
    ).length;

    const report = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? 'apply' : 'dry_run',
      applyEnabled: APPLY,
      applyFlag: 'SUGGESTED_TRADES_DELTA_PROTECTION_REPAIR_APPLY',
      brokerRepairEnabled,
      brokerRepairFlag: 'SUGGESTED_TRADES_PROTECTION_REPAIR_DELTA_EXCHANGE_ENABLED',
      limit: LIMIT,
      preview: {
        generatedAt: previewReport.generatedAt,
        audited: previewReport.audited,
        openPositions: previewReport.openPositions,
        issueTrades: previewReport.issueTrades,
        repairableItems: previewReport.repairableItems,
        blockedItems: previewReport.blockedItems,
        manualReviewItems: previewReport.manualReviewItems,
        byAction: previewReport.byAction,
      },
      candidateItems: candidates.length,
      unsupportedRepairableItems,
      appliedItems,
      noChangeItems,
      blockedItems,
      errorItems,
      items,
    };
    await persistReport(report);
    console.log('suggested-trades-delta-protection-repair:', JSON.stringify(report));
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
