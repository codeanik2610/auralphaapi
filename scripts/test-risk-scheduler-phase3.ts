import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalRiskSchedulerController } from '../src/api/controllers/InternalRiskSchedulerController';
import { RiskController } from '../src/api/controllers/RiskController';
import { RiskService } from '../src/api/services/RiskService';
import { env } from '../src/env';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createSuccess(data: Record<string, unknown>) {
  return {
    success: true,
    data,
  };
}

async function runProductRouteOwnUserAssertions(): Promise<void> {
  const controller = new RiskController() as any;
  const capturedUserIds: string[] = [];

  controller.riskService = {
    async recomputeRiskSnapshot(userId: string) {
      capturedUserIds.push(userId);
      return createSuccess({
        message: 'Risk snapshot recomputed',
        snapshotId: 'snapshot-1',
      });
    },
  };

  const response = await controller.recomputeRiskSnapshot({
    authUser: {
      sub: 'user-1',
      role: 'user',
    },
  } as any);

  assert.deepEqual(capturedUserIds, ['user-1']);
  assert.equal(response.data.snapshotId, 'snapshot-1');
}

async function runInternalBatchRouteAssertions(): Promise<void> {
  const controller = new InternalRiskSchedulerController() as any;
  const calls: Array<{ actorUserId: string; targetUserIds?: string[] }> = [];

  controller.riskService = {
    async recomputeRiskSnapshotBatch(actorUserId: string, targetUserIds?: string[]) {
      calls.push({ actorUserId, targetUserIds });
      return createSuccess({
        message: 'Risk batch recompute completed',
        processed: targetUserIds?.length || 0,
        succeeded: targetUserIds?.length || 0,
        failed: 0,
        completedAt: '2026-04-11T00:00:00.000Z',
        failures: [],
      });
    },
  };

  const normalizedResponse = await controller.recomputeBatch({
    actorUserId: ' admin-1 ',
    targetUserIds: ['user-1', '', ' user-2 ', 'user-1', '   '],
  });

  await controller.recomputeBatch({
    actorUserId: '   ',
    targetUserIds: ['   '],
  });

  assert.deepEqual(calls, [
    {
      actorUserId: 'admin-1',
      targetUserIds: ['user-1', 'user-2'],
    },
    {
      actorUserId: env.scheduler.systemUserId,
      targetUserIds: undefined,
    },
  ]);
  assert.equal(normalizedResponse.data.processed, 2);
}

async function runBatchServiceNormalizationAssertions(): Promise<void> {
  const service = new RiskService() as any;
  const recomputedUserIds: string[] = [];
  const activityLogs: Array<{ actorUserId: string; payload: Record<string, unknown> }> = [];

  service.recomputeRiskSnapshot = async (userId: string) => {
    recomputedUserIds.push(userId);
    return createSuccess({
      snapshotId: `snapshot-${userId}`,
      controlsCreated: userId === 'user-1' ? 2 : 1,
      alertsCreated: 1,
      scenariosCreated: 1,
    });
  };
  service.operationalEventService = {
    async logActivity(actorUserId: string, payload: Record<string, unknown>) {
      activityLogs.push({ actorUserId, payload });
    },
  };

  const response = await service.recomputeRiskSnapshotBatch('admin-1', [
    ' user-1 ',
    '',
    'user-2',
    'user-1',
    '   ',
  ] as any);

  assert.deepEqual(recomputedUserIds, ['user-1', 'user-2']);
  assert.equal(response.data.processed, 2);
  assert.equal(response.data.succeeded, 2);
  assert.equal(response.data.failed, 0);
  assert.equal(response.data.snapshotsCreated, 2);
  assert.equal(response.data.controlsCreated, 3);
  assert.equal(response.data.alertsCreated, 2);
  assert.equal(response.data.scenariosCreated, 2);
  assert.equal(activityLogs.length, 1);
  assert.equal(activityLogs[0]?.actorUserId, 'admin-1');
  assert.equal(activityLogs[0]?.payload.title, 'Risk batch recompute completed');
}

function runPhaseThreeDocAssertions(): void {
  const findings: string[] = [];

  const phaseDoc = read('RISK_SCHEDULER_PHASE3.md');
  for (const marker of [
    'Phase 3 freezes the internal execution contract for `risk-recompute-sync`.',
    '`/risk/recompute` remains signed-in-user only.',
    '`/internal/risk/recompute`',
    '`targetUserIds`',
    '`actorUserId`',
    'scheduler or cron execution still fans out across all real user-owned connections.',
    '`userId = null` connections are excluded from the scheduler target set.',
    'Phase 4 should focus on runtime proof and failure isolation rather than reopening the execution split.',
  ]) {
    if (!phaseDoc.includes(marker)) {
      findings.push(`RISK_SCHEDULER_PHASE3.md: missing Phase 3 marker ${marker}`);
    }
  }

  const productControllerSource = read('src/api/controllers/RiskController.ts');
  for (const marker of [
    "@Post('/recompute')",
    'return this.riskService.recomputeRiskSnapshot(requireAuthUserId(request));',
  ]) {
    if (!productControllerSource.includes(marker)) {
      findings.push(`RiskController.ts: missing Phase 3 product-route marker ${marker}`);
    }
  }

  const internalControllerSource = read('src/api/controllers/InternalRiskSchedulerController.ts');
  for (const marker of [
    "@JsonController('/internal/risk')",
    "@Post('/recompute')",
    'String(body.actorUserId || \'\').trim() || env.scheduler.systemUserId',
    'body.targetUserIds',
    'targetUserIds?.length ? targetUserIds : undefined',
  ]) {
    if (!internalControllerSource.includes(marker)) {
      findings.push(`InternalRiskSchedulerController.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const serviceSource = read('src/api/services/RiskService.ts');
  for (const marker of [
    'targetUserIds',
    '.map((item) => String(item || \'\').trim())',
    'new Set(',
    'this.recomputeRiskSnapshot(userId)',
    'await this.operationalEventService.logActivity(actorUserId, {',
  ]) {
    if (!serviceSource.includes(marker)) {
      findings.push(`RiskService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const workerExecutionSource = read('../aurAlphaSchedulerWorker/src/scheduler/services/SchedulerExecutionService.ts');
  for (const marker of [
    'executeRiskRecomputeSync(',
    'resolveRiskRecomputeTargetUserIds(',
    'listActorConnectedAccounts(',
    'env.scheduler.systemUserId',
    "/internal/risk/recompute",
    'actorUserId,',
    '...(targetUserIds.length > 0 ? { targetUserIds } : {}),',
  ]) {
    if (!workerExecutionSource.includes(marker)) {
      findings.push(`Worker SchedulerExecutionService.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const workerPollerSource = read('../aurAlphaSchedulerWorker/src/scheduler/queue/SchedulerCommandPoller.ts');
  for (const marker of [
    'buildRiskScheduledScope(',
    'listRiskTargetUserIds(',
    'user_id IS NOT NULL',
    "TRIM(user_id) <> ''",
    'userIds: targetUserIds',
  ]) {
    if (!workerPollerSource.includes(marker)) {
      findings.push(`Worker SchedulerCommandPoller.ts: missing Phase 3 marker ${marker}`);
    }
  }

  const readme = read('README.md');
  if (!readme.includes('RISK_SCHEDULER_PHASE3.md')) {
    findings.push('README.md: missing risk scheduler Phase 3 baseline link');
  }
  if (!readme.includes('test:risk-scheduler-phase3')) {
    findings.push('README.md: missing risk scheduler Phase 3 verification command');
  }
  if (!readme.includes('Phase 3 internal execution contract for `risk-recompute-sync`')) {
    findings.push('README.md: missing risk scheduler Phase 3 baseline summary');
  }

  const packageSource = read('package.json');
  if (!packageSource.includes('"test:risk-scheduler-phase3"')) {
    findings.push('package.json: missing risk scheduler Phase 3 test script');
  }
  if (!packageSource.includes('npm run test:risk-scheduler-phase3')) {
    findings.push('package.json: risk scheduler Phase 3 guard must stay wired');
  }

  assert.equal(
    findings.length,
    0,
    `Risk scheduler Phase 3 guard failed:\n${findings.join('\n')}`
  );
}

async function main(): Promise<void> {
  await runProductRouteOwnUserAssertions();
  await runInternalBatchRouteAssertions();
  await runBatchServiceNormalizationAssertions();
  runPhaseThreeDocAssertions();
  console.log('Risk scheduler phase 3 assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
