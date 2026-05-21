import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { buildMudrexProtectionHealthReport } from './check-suggested-trades-mudrex-protection-health';
import {
  buildMudrexProtectionRepairPreviewReport,
  type MudrexProtectionRepairPreviewItem,
} from './check-suggested-trades-mudrex-protection-repair-preview';
import { selectMudrexProtectionRepairApplyCandidates } from '../maintenance/repair-suggested-trades-mudrex-protection';

type JsonRecord = Record<string, unknown>;

const STALE_CANCEL_ACTION = 'would_cancel_stale_protection_orders';
const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_WATCHDOG_OUTPUT_FILE ||
    'artifacts/suggested-trades-mudrex-stale-protection-watchdog.json'
).trim();
const LIMIT = Math.max(
  1,
  Math.floor(
    Number(
      process.env.SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_WATCHDOG_LIMIT ||
        process.env.SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_LIMIT ||
        25
    )
  )
);
const MAX_STALE_CANCEL_CANDIDATES = Math.max(
  0,
  Math.floor(Number(process.env.SUGGESTED_TRADES_MAX_MUDREX_STALE_CANCEL_CANDIDATES || 0))
);

function readBooleanFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env[name] || '')
      .trim()
      .toLowerCase()
  );
}

function summarizeItem(item: MudrexProtectionRepairPreviewItem): JsonRecord {
  return {
    suggestedTradeId: item.suggestedTradeId,
    userId: item.userId,
    accountId: item.accountId,
    symbol: item.symbol,
    side: item.side,
    entryOrderId: item.entryOrderId,
    positionId: item.positionId,
    positionStatus: item.positionStatus,
    executionState: item.executionState,
    stopLossOrderId: item.stopLossOrderId,
    stopLossOrderStatus: item.stopLossOrderStatus,
    takeProfitOrderId: item.takeProfitOrderId,
    takeProfitOrderStatus: item.takeProfitOrderStatus,
    issues: item.issues,
    reasons: item.reasons,
    remediation: item.remediation,
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
  await initializeCoreDataSource();

  try {
    const healthReport = await buildMudrexProtectionHealthReport();
    const previewReport = buildMudrexProtectionRepairPreviewReport(healthReport);
    const stalePreviewItems = previewReport.items.filter(
      (item) => item.remediation.action === STALE_CANCEL_ACTION
    );
    const staleCancelCandidates = selectMudrexProtectionRepairApplyCandidates(
      previewReport.items,
      LIMIT,
      { includeStaleCancel: true }
    ).filter((item) => item.remediation.action === STALE_CANCEL_ACTION);
    const applyEnabled = readBooleanFlag('SUGGESTED_TRADES_MUDREX_PROTECTION_REPAIR_APPLY');
    const staleCancelApplyEnabled = readBooleanFlag(
      'SUGGESTED_TRADES_MUDREX_STALE_PROTECTION_CANCEL_APPLY'
    );
    const applyFlagsSafe = !applyEnabled && !staleCancelApplyEnabled;
    const staleCancelCandidateItems = staleCancelCandidates.length;
    const thresholdExceeded = staleCancelCandidateItems > MAX_STALE_CANCEL_CANDIDATES;
    const passed = applyFlagsSafe && !thresholdExceeded;

    const report = {
      generatedAt: new Date().toISOString(),
      mode: 'preview',
      dryRun: true,
      mutation: 'disabled',
      applyEnabled,
      staleCancelApplyEnabled,
      applyFlagsSafe,
      maxStaleCancelCandidates: MAX_STALE_CANCEL_CANDIDATES,
      limit: LIMIT,
      preview: {
        generatedAt: previewReport.generatedAt,
        audited: previewReport.audited,
        openPositions: previewReport.openPositions,
        issueTrades: previewReport.issueTrades,
        staleProtectionForClosedPosition: previewReport.staleProtectionForClosedPosition,
        byAction: previewReport.byAction,
      },
      stalePreviewItems: stalePreviewItems.length,
      staleCancelCandidateItems,
      passed,
      items: staleCancelCandidates.map(summarizeItem),
    };

    await persistReport(report);
    console.log('suggested-trades-mudrex-stale-protection-watchdog:', JSON.stringify(report));

    if (!applyFlagsSafe) {
      console.error(
        'Mudrex stale protection watchdog refuses to run with Mudrex repair apply flags enabled.'
      );
      process.exit(1);
    }
    if (thresholdExceeded) {
      console.error(
        `Mudrex stale protection watchdog found ${staleCancelCandidateItems} stale cancel candidate(s).`
      );
      process.exit(1);
    }
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
