import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertSchedulerAccountScopeLiveSnapshot,
  buildSchedulerAccountScopeLiveSnapshot,
  type SchedulerAccountScopeLiveSnapshot,
} from '../checks/check-scheduler-account-scope-live';

export type SchedulerAccountScopeProofSummary = {
  decision: 'ready';
  generatedAt: string;
  proofMode: string;
  contract: string;
  liveOutputFile: string;
  proofOutputFile: string;
  baseUrl: string;
  activeTotal: number;
  activeUserOwned: number;
  activeSystemOwned: number;
  ownerlessAccountIds: string[];
  orders: SchedulerAccountScopeLiveSnapshot['orders'];
  positions: SchedulerAccountScopeLiveSnapshot['positions'];
  funds: SchedulerAccountScopeLiveSnapshot['funds'];
  operationalDecision: string;
};

export type SchedulerAccountScopeProofArtifacts = {
  snapshot: SchedulerAccountScopeLiveSnapshot;
  proof: SchedulerAccountScopeProofSummary;
};

const LIVE_OUTPUT_FILE = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_OUTPUT_FILE || 'artifacts/scheduler-account-scope-live.json'
).trim();
const OUTPUT_FILE = String(
  process.env.SCHEDULER_ACCOUNT_SCOPE_PROOF_OUTPUT_FILE ||
    'artifacts/scheduler-account-scope-live-proof.json'
).trim();
const PROOF_MODE = String(process.env.SCHEDULER_ACCOUNT_SCOPE_PROOF_MODE || 'manual-smoke').trim();

async function persistSummary(filePath: string, summary: Record<string, unknown>): Promise<void> {
  if (!filePath) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

export async function buildSchedulerAccountScopeProofArtifacts(
  liveOutputFile: string = LIVE_OUTPUT_FILE,
  proofOutputFile: string = OUTPUT_FILE
): Promise<SchedulerAccountScopeProofArtifacts> {
  const snapshot = await buildSchedulerAccountScopeLiveSnapshot();
  assertSchedulerAccountScopeLiveSnapshot(snapshot);

  const proof: SchedulerAccountScopeProofSummary = {
    decision: 'ready' as const,
    generatedAt: new Date().toISOString(),
    proofMode: PROOF_MODE || 'manual-smoke',
    contract: 'broker_accounts.user_id IS NOT NULL',
    liveOutputFile: path.resolve(process.cwd(), liveOutputFile),
    proofOutputFile: path.resolve(process.cwd(), proofOutputFile),
    baseUrl: snapshot.baseUrl,
    activeTotal: snapshot.activeTotal,
    activeUserOwned: snapshot.activeUserOwned,
    activeSystemOwned: snapshot.activeSystemOwned,
    ownerlessAccountIds: snapshot.ownerlessAccountIds,
    orders: snapshot.orders,
    positions: snapshot.positions,
    funds: snapshot.funds,
    operationalDecision:
      'manual-smoke proof remains opt-in and is not wired into test:all or an automatic release gate',
  };

  return { snapshot, proof };
}

async function run(): Promise<void> {
  const artifacts = await buildSchedulerAccountScopeProofArtifacts();
  await persistSummary(LIVE_OUTPUT_FILE, artifacts.snapshot);
  await persistSummary(OUTPUT_FILE, artifacts.proof);
  console.log('scheduler-account-scope-live-proof:', JSON.stringify(artifacts.proof));
}

const isMainModule =
  path.basename(String(process.argv[1] || '')) === 'proof-scheduler-account-scope-live.ts';

if (isMainModule) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
