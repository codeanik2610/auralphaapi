import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Container } from 'typedi';
import { SuggestedTradesProtectionGuardrailService } from '../../src/api/services/SuggestedTradesProtectionGuardrailService';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';

const OUTPUT_FILE = String(
  process.env.SUGGESTED_TRADES_PROTECTION_GUARDRAIL_OUTPUT_FILE ||
    'artifacts/suggested-trades-protection-guardrails.json'
).trim();
const EMIT_ALERTS = ['1', 'true', 'yes'].includes(
  String(process.env.SUGGESTED_TRADES_PROTECTION_GUARDRAIL_EMIT_ALERTS || '')
    .trim()
    .toLowerCase()
);
const MAX_ISSUE_TRADES = Math.max(
  0,
  Number(process.env.SUGGESTED_TRADES_MAX_PROTECTION_GUARDRAIL_ISSUE_TRADES || 0)
);

async function persistReport(report: Record<string, unknown>): Promise<void> {
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
    const report = await Container.get(SuggestedTradesProtectionGuardrailService).runAudit({
      emitAlerts: EMIT_ALERTS,
    });
    await persistReport(report as unknown as Record<string, unknown>);
    console.log('suggested-trades-protection-guardrails:', JSON.stringify(report));

    if (report.issueTrades > MAX_ISSUE_TRADES) {
      throw new Error(
        `protection guardrail issue trades ${report.issueTrades} exceeds ${MAX_ISSUE_TRADES}`
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
