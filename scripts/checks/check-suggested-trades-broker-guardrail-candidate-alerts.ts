import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Container } from 'typedi';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { AlertRepository } from '../../src/database/repositories/AlertRepository';
import { buildDeltaProtectionGuardrailReport } from './check-suggested-trades-delta-protection-guardrail';
import {
  buildDeltaProtectionRepairPreviewReport,
  type DeltaProtectionRepairPreviewReport,
} from './check-suggested-trades-delta-protection-repair-preview';
import { buildMudrexProtectionGuardrailReport } from './check-suggested-trades-mudrex-protection-guardrail';
import {
  buildMudrexProtectionRepairPreviewReport,
  type MudrexProtectionRepairPreviewReport,
} from './check-suggested-trades-mudrex-protection-repair-preview';

type JsonRecord = Record<string, unknown>;
type BrokerGuardrailAlertBroker = 'mudrex' | 'delta_exchange';
type BrokerGuardrailAlertReadiness = 'ready' | 'blocked' | 'manual_review' | string;
type BrokerGuardrailAlertDisposition =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'dry_run'
  | 'suppressed';

const CHANNEL = 'Suggested Trades';
const ROUTE = 'Broker Guardrails';
const OUTPUT_PREFIX = 'suggested-trades-broker-guardrail-candidate-alerts:';
const DEFAULT_OUTPUT_FILE = 'artifacts/suggested-trades-broker-guardrail-candidate-alerts.json';

export type BrokerGuardrailRepairPreviewItem = {
  suggestedTradeId: string;
  userId: string;
  accountId?: string | null;
  symbol: string;
  timeframe?: string | null;
  side?: string | null;
  entryOrderId?: string | null;
  positionId?: string | null;
  positionReadModelExternalId?: string | null;
  issues: string[];
  reasons?: string[];
  remediation: {
    action: string;
    readiness: BrokerGuardrailAlertReadiness;
    repairable: boolean;
    blockers: string[];
    notes?: string[];
    expectedMutation?: JsonRecord;
  };
};

export type BrokerGuardrailCandidateAlertPlan = {
  brokerKey: BrokerGuardrailAlertBroker;
  userId: string;
  suggestedTradeId: string;
  symbol: string;
  severity: 'High' | 'Medium';
  source: string;
  route: string;
  urgency: 'immediate' | 'review';
  message: string;
  remediationAction: string;
  readiness: BrokerGuardrailAlertReadiness;
  repairable: boolean;
  issues: string[];
  blockers: string[];
  entryOrderId: string | null;
  positionId: string | null;
};

export type BrokerGuardrailOpenAlert = {
  id: string;
  severity: string;
  symbol: string;
  message: string;
  route: string | null;
  urgency: string | null;
};

export type BrokerGuardrailAlertRepository = {
  findOpenAlertBySource(payload: {
    userId: string;
    channel: string;
    source?: string | null;
  }): Promise<BrokerGuardrailOpenAlert | null>;
  findOpenAlertBySignature(payload: {
    userId: string;
    channel: string;
    source?: string | null;
    message: string;
  }): Promise<BrokerGuardrailOpenAlert | null>;
  updateOpenAlertDetails(
    userId: string,
    alertId: string,
    payload: Partial<
      Pick<BrokerGuardrailOpenAlert, 'severity' | 'symbol' | 'message' | 'route' | 'urgency'>
    >
  ): Promise<void>;
  createAlert(payload: {
    userId: string;
    severity: string;
    channel: string;
    symbol: string;
    message: string;
    route?: string | null;
    status: string;
    source?: string | null;
    urgency?: string | null;
    applyEscalationPolicy?: boolean;
    suppressEmailDelivery?: boolean;
  }): Promise<unknown | null>;
};

export type BrokerGuardrailCandidateAlertReport = {
  generatedAt: string;
  dryRun: boolean;
  candidateItems: number;
  emittedAlerts: number;
  createdAlerts: number;
  updatedAlerts: number;
  unchangedAlerts: number;
  suppressedAlerts: number;
  byBroker: Record<
    BrokerGuardrailAlertBroker,
    {
      candidates: number;
      created: number;
      updated: number;
      unchanged: number;
      suppressed: number;
    }
  >;
  previewSummary: {
    mudrex: PreviewSummary;
    delta: PreviewSummary;
  };
  items: Array<
    BrokerGuardrailCandidateAlertPlan & { disposition: BrokerGuardrailAlertDisposition }
  >;
};

type PreviewSummary = {
  audited: number;
  issueTrades: number;
  repairableItems: number;
  blockedItems: number;
  manualReviewItems: number;
};

const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_BROKER_GUARDRAIL_ALERT_OUTPUT_FILE || DEFAULT_OUTPUT_FILE
).trim();

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) {
    return defaultValue;
  }
  return Math.trunc(value);
}

function brokerLabel(brokerKey: BrokerGuardrailAlertBroker): string {
  return brokerKey === 'delta_exchange' ? 'Delta' : 'Mudrex';
}

function brokerSourceLabel(brokerKey: BrokerGuardrailAlertBroker): string {
  return brokerKey === 'delta_exchange' ? 'delta' : 'mudrex';
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function shortToken(value: string | null | undefined, maxLength = 18): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'n/a';
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function actionLabel(action: string): string {
  switch (action) {
    case 'would_attach_missing_protection':
      return 'missing protection';
    case 'would_replace_mismatched_partial_fill_protection':
      return 'partial-fill protection mismatch';
    case 'would_cancel_stale_protection_orders':
      return 'stale protection cancel';
    case 'would_mark_terminal_protection_not_required':
      return 'terminal protection cleanup';
    case 'would_repair_or_close_missing_native_bracket_protection':
      return 'native bracket missing protection';
    case 'would_reconcile_native_bracket_protection':
      return 'native bracket reconcile';
    case 'manual_review_required':
      return 'manual review required';
    default:
      return action.replace(/_/g, ' ');
  }
}

function itemPositionId(item: BrokerGuardrailRepairPreviewItem): string | null {
  const expectedPositionId = item.remediation.expectedMutation?.positionId;
  return (
    item.positionReadModelExternalId ||
    item.positionId ||
    (typeof expectedPositionId === 'string' ? expectedPositionId : null) ||
    null
  );
}

function severityForItem(item: BrokerGuardrailRepairPreviewItem): 'High' | 'Medium' {
  if (
    item.remediation.readiness === 'ready' &&
    item.remediation.repairable &&
    item.remediation.action !== 'would_mark_terminal_protection_not_required'
  ) {
    return 'High';
  }
  return 'Medium';
}

function buildAlertSource(
  brokerKey: BrokerGuardrailAlertBroker,
  item: BrokerGuardrailRepairPreviewItem
): string {
  const fingerprint = shortHash(
    [
      brokerKey,
      item.suggestedTradeId,
      item.remediation.action,
      item.issues.slice().sort().join(','),
    ].join(':')
  );
  return [
    'st-broker-guardrail',
    brokerSourceLabel(brokerKey),
    item.suggestedTradeId.slice(0, 40),
    fingerprint,
  ]
    .join(':')
    .slice(0, 100);
}

function buildAlertMessage(
  brokerKey: BrokerGuardrailAlertBroker,
  item: BrokerGuardrailRepairPreviewItem,
  positionId: string | null
): string {
  const issueSummary = item.issues.slice(0, 3).join(',') || 'unclassified';
  const blockerSummary = item.remediation.blockers.length
    ? ` blockers=${item.remediation.blockers.slice(0, 2).join(',')}`
    : '';
  return `${brokerLabel(brokerKey)} ${item.symbol} guardrail: ${actionLabel(
    item.remediation.action
  )}; readiness=${item.remediation.readiness}; issues=${issueSummary}; entry=${shortToken(
    item.entryOrderId
  )}; pos=${shortToken(positionId)}${blockerSummary}`.slice(0, 255);
}

export function buildBrokerGuardrailCandidateAlertPlan(
  brokerKey: BrokerGuardrailAlertBroker,
  item: BrokerGuardrailRepairPreviewItem
): BrokerGuardrailCandidateAlertPlan | null {
  const userId = String(item.userId || '').trim();
  const suggestedTradeId = String(item.suggestedTradeId || '').trim();
  if (!userId || !suggestedTradeId || !item.issues.length) {
    return null;
  }

  const positionId = itemPositionId(item);
  const severity = severityForItem(item);
  return {
    brokerKey,
    userId,
    suggestedTradeId,
    symbol: String(item.symbol || 'SYSTEM').slice(0, 50) || 'SYSTEM',
    severity,
    source: buildAlertSource(brokerKey, item),
    route: ROUTE,
    urgency: severity === 'High' ? 'immediate' : 'review',
    message: buildAlertMessage(brokerKey, item, positionId),
    remediationAction: item.remediation.action,
    readiness: item.remediation.readiness,
    repairable: item.remediation.repairable,
    issues: [...item.issues],
    blockers: [...item.remediation.blockers],
    entryOrderId: item.entryOrderId || null,
    positionId,
  };
}

export function buildBrokerGuardrailCandidateAlertPlans(payload: {
  mudrex: MudrexProtectionRepairPreviewReport;
  delta: DeltaProtectionRepairPreviewReport;
  limit?: number;
}): BrokerGuardrailCandidateAlertPlan[] {
  const limit = payload.limit ?? Number.MAX_SAFE_INTEGER;
  const plans = [
    ...payload.mudrex.items
      .map((item) =>
        buildBrokerGuardrailCandidateAlertPlan('mudrex', item as BrokerGuardrailRepairPreviewItem)
      )
      .filter((item): item is BrokerGuardrailCandidateAlertPlan => Boolean(item)),
    ...payload.delta.items
      .map((item) =>
        buildBrokerGuardrailCandidateAlertPlan(
          'delta_exchange',
          item as BrokerGuardrailRepairPreviewItem
        )
      )
      .filter((item): item is BrokerGuardrailCandidateAlertPlan => Boolean(item)),
  ];
  return plans.slice(0, limit);
}

export async function emitBrokerGuardrailCandidateAlert(
  alertRepository: BrokerGuardrailAlertRepository,
  plan: BrokerGuardrailCandidateAlertPlan,
  options: { dryRun?: boolean } = {}
): Promise<BrokerGuardrailAlertDisposition> {
  if (options.dryRun) {
    return 'dry_run';
  }

  const existingBySource = await alertRepository.findOpenAlertBySource({
    userId: plan.userId,
    channel: CHANNEL,
    source: plan.source,
  });

  if (existingBySource) {
    if (
      existingBySource.severity !== plan.severity ||
      existingBySource.symbol !== plan.symbol ||
      existingBySource.message !== plan.message ||
      existingBySource.route !== plan.route ||
      existingBySource.urgency !== plan.urgency
    ) {
      await alertRepository.updateOpenAlertDetails(plan.userId, existingBySource.id, {
        severity: plan.severity,
        symbol: plan.symbol,
        message: plan.message,
        route: plan.route,
        urgency: plan.urgency,
      });
      return 'updated';
    }
    return 'unchanged';
  }

  const existing = await alertRepository.findOpenAlertBySignature({
    userId: plan.userId,
    channel: CHANNEL,
    source: plan.source,
    message: plan.message,
  });
  if (existing) {
    return 'unchanged';
  }

  const created = await alertRepository.createAlert({
    userId: plan.userId,
    severity: plan.severity,
    channel: CHANNEL,
    symbol: plan.symbol,
    message: plan.message,
    route: plan.route,
    status: 'Open',
    source: plan.source,
    urgency: plan.urgency,
    applyEscalationPolicy: true,
    suppressEmailDelivery: plan.severity !== 'High',
  });

  return created ? 'created' : 'suppressed';
}

async function emitBrokerGuardrailCandidateAlerts(
  alertRepository: BrokerGuardrailAlertRepository,
  plans: BrokerGuardrailCandidateAlertPlan[],
  options: { dryRun: boolean }
): Promise<
  Array<BrokerGuardrailCandidateAlertPlan & { disposition: BrokerGuardrailAlertDisposition }>
> {
  const items: Array<
    BrokerGuardrailCandidateAlertPlan & { disposition: BrokerGuardrailAlertDisposition }
  > = [];

  for (const plan of plans) {
    const disposition = await emitBrokerGuardrailCandidateAlert(alertRepository, plan, options);
    items.push({ ...plan, disposition });
  }

  return items;
}

function summarizePreview(
  report: MudrexProtectionRepairPreviewReport | DeltaProtectionRepairPreviewReport
): PreviewSummary {
  return {
    audited: report.audited,
    issueTrades: report.issueTrades,
    repairableItems: report.repairableItems,
    blockedItems: report.blockedItems,
    manualReviewItems: report.manualReviewItems,
  };
}

function dispositionCount(
  items: Array<{ disposition: BrokerGuardrailAlertDisposition }>,
  disposition: BrokerGuardrailAlertDisposition
): number {
  return items.filter((item) => item.disposition === disposition).length;
}

function countBrokerItems(
  items: Array<
    BrokerGuardrailCandidateAlertPlan & { disposition: BrokerGuardrailAlertDisposition }
  >,
  brokerKey: BrokerGuardrailAlertBroker,
  disposition?: BrokerGuardrailAlertDisposition
): number {
  return items.filter(
    (item) => item.brokerKey === brokerKey && (!disposition || item.disposition === disposition)
  ).length;
}

export async function buildBrokerGuardrailCandidateAlertReport(
  alertRepository: BrokerGuardrailAlertRepository,
  options: { dryRun: boolean; limit: number }
): Promise<BrokerGuardrailCandidateAlertReport> {
  const mudrexHealthReport = await buildMudrexProtectionGuardrailReport();
  const mudrexPreviewReport = buildMudrexProtectionRepairPreviewReport(mudrexHealthReport);
  const deltaGuardrailReport = await buildDeltaProtectionGuardrailReport();
  const deltaPreviewReport = buildDeltaProtectionRepairPreviewReport(deltaGuardrailReport);
  const plans = buildBrokerGuardrailCandidateAlertPlans({
    mudrex: mudrexPreviewReport,
    delta: deltaPreviewReport,
    limit: options.limit,
  });
  const items = await emitBrokerGuardrailCandidateAlerts(alertRepository, plans, {
    dryRun: options.dryRun,
  });

  return {
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    candidateItems: plans.length,
    emittedAlerts: dispositionCount(items, 'created') + dispositionCount(items, 'updated'),
    createdAlerts: dispositionCount(items, 'created'),
    updatedAlerts: dispositionCount(items, 'updated'),
    unchangedAlerts: dispositionCount(items, 'unchanged'),
    suppressedAlerts: dispositionCount(items, 'suppressed'),
    byBroker: {
      mudrex: {
        candidates: countBrokerItems(items, 'mudrex'),
        created: countBrokerItems(items, 'mudrex', 'created'),
        updated: countBrokerItems(items, 'mudrex', 'updated'),
        unchanged: countBrokerItems(items, 'mudrex', 'unchanged'),
        suppressed: countBrokerItems(items, 'mudrex', 'suppressed'),
      },
      delta_exchange: {
        candidates: countBrokerItems(items, 'delta_exchange'),
        created: countBrokerItems(items, 'delta_exchange', 'created'),
        updated: countBrokerItems(items, 'delta_exchange', 'updated'),
        unchanged: countBrokerItems(items, 'delta_exchange', 'unchanged'),
        suppressed: countBrokerItems(items, 'delta_exchange', 'suppressed'),
      },
    },
    previewSummary: {
      mudrex: summarizePreview(mudrexPreviewReport),
      delta: summarizePreview(deltaPreviewReport),
    },
    items,
  };
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
  const dryRun = readBooleanEnv('SUGGESTED_TRADES_BROKER_GUARDRAIL_ALERT_DRY_RUN', false);
  const limit = readPositiveIntegerEnv('SUGGESTED_TRADES_BROKER_GUARDRAIL_ALERT_LIMIT', 100);

  await initializeCoreDataSource();

  try {
    const report = await buildBrokerGuardrailCandidateAlertReport(Container.get(AlertRepository), {
      dryRun,
      limit,
    });
    await persistReport(report);
    console.log(OUTPUT_PREFIX, JSON.stringify(report));
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
