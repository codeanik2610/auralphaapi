import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalRuntimeController } from '../src/api/controllers/InternalRuntimeController';
import {
  validateRuntimeListQuery,
  validateRuntimeReleaseLockBody,
  validateRuntimeRepairBody,
  validateRuntimeRequeueBody,
} from '../src/api/validators/runtime.validator';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function readBackendRoot(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), '..', relativePath), 'utf8');
}

const adminReq = {
  authUser: {
    sub: 'admin-user-1',
    role: 'admin',
  },
} as any;

async function runRuntimeValidatorAssertions(): Promise<void> {
  assert.deepEqual(validateRuntimeListQuery({ limit: undefined }), { limit: 100 });
  assert.deepEqual(validateRuntimeListQuery({ limit: '25' }), { limit: 25 });
  assert.throws(
    () => validateRuntimeListQuery({ limit: '0' }),
    /limit must be an integer between 1 and 500/
  );

  assert.deepEqual(
    validateRuntimeRepairBody({
      status: 'Cancelled',
      reason: 'manual reset',
      actorUserId: 'admin-user-1',
      schedulerUserId: 'user-1',
    }),
    {
      status: 'Cancelled',
      reason: 'manual reset',
      actorUserId: 'admin-user-1',
      schedulerUserId: 'user-1',
    }
  );
  assert.deepEqual(validateRuntimeRepairBody(), {
    status: 'Failed',
    reason: null,
    actorUserId: null,
    schedulerUserId: null,
  });
  assert.throws(
    () => validateRuntimeRepairBody({ status: 'Running' }),
    /status must be Failed, Cancelled, or Queued/
  );

  assert.deepEqual(validateRuntimeRequeueBody({ schedulerUserId: 'user-2' }), {
    actorUserId: null,
    schedulerUserId: 'user-2',
  });
  assert.deepEqual(
    validateRuntimeReleaseLockBody({
      actorUserId: 'admin-user-1',
      schedulerUserId: 'user-3',
      reason: 'expired lock',
    }),
    {
      actorUserId: 'admin-user-1',
      schedulerUserId: 'user-3',
      reason: 'expired lock',
    }
  );
}

async function runRuntimeControllerAssertions(): Promise<void> {
  const controller = new InternalRuntimeController() as any;
  const calls: Array<{ method: string; args: unknown[] }> = [];

  controller.runtimeDiagnosticsService = {
    getRuntimeOverview: async () => {
      calls.push({ method: 'getRuntimeOverview', args: [] });
      return { status: 'ok', timestamp: '2026-04-13T00:00:00.000Z' };
    },
    listStaleItems: async (...args: unknown[]) => {
      calls.push({ method: 'listStaleItems', args });
      return { timestamp: '2026-04-13T00:00:00.000Z', total: 0, items: [] };
    },
    repairSchedulerCommand: async (...args: unknown[]) => {
      calls.push({ method: 'repairSchedulerCommand', args });
      return { repaired: true, itemType: 'scheduler-command', id: 'cmd-1', status: 'Failed' };
    },
    repairSchedulerRun: async (...args: unknown[]) => {
      calls.push({ method: 'repairSchedulerRun', args });
      return { repaired: true, itemType: 'scheduler-run', id: 'run-1', status: 'Failed' };
    },
    repairAutomationRun: async (...args: unknown[]) => {
      calls.push({ method: 'repairAutomationRun', args });
      return { repaired: true, itemType: 'automation-run', id: 'auto-run-1', status: 'Failed' };
    },
    repairActivityExport: async (...args: unknown[]) => {
      calls.push({ method: 'repairActivityExport', args });
      return { repaired: true, itemType: 'activity-export', id: 'exp-1', status: 'Queued' };
    },
    requeueScheduler: async (...args: unknown[]) => {
      calls.push({ method: 'requeueScheduler', args });
      return { repaired: true, itemType: 'scheduler-requeue', id: 'orders-sync', status: 'Queued' };
    },
    releaseSchedulerLock: async (...args: unknown[]) => {
      calls.push({ method: 'releaseSchedulerLock', args });
      return { repaired: true, itemType: 'scheduler-lock', id: 'orders-sync', status: 'Released' };
    },
  };

  assert.equal((await controller.getOverview(adminReq)).data.status, 'ok');
  assert.equal((await controller.listStaleItems(adminReq, '15')).data.total, 0);

  await controller.repairSchedulerCommand(adminReq, 'cmd-1', {
    reason: 'manual repair',
  });
  await controller.repairSchedulerRun(adminReq, 'run-1', {
    status: 'Cancelled',
  });
  await controller.repairAutomationRun(adminReq, 'auto-run-1', {
    reason: 'clear overlap block',
  });
  await controller.repairActivityExport(adminReq, 'exp-1', {
    status: 'Queued',
  });
  await controller.requeueScheduler(adminReq, 'orders-sync', {
    schedulerUserId: 'user-9',
  });
  await controller.releaseLock(adminReq, 'orders-sync', {
    schedulerUserId: 'user-9',
    reason: 'expired lease',
  });

  assert.deepEqual(calls, [
    { method: 'getRuntimeOverview', args: [] },
    { method: 'listStaleItems', args: [15] },
    {
      method: 'repairSchedulerCommand',
      args: [
        'cmd-1',
        {
          actorUserId: 'admin-user-1',
          status: 'Failed',
          reason: 'manual repair',
        },
      ],
    },
    {
      method: 'repairSchedulerRun',
      args: [
        'run-1',
        {
          actorUserId: 'admin-user-1',
          status: 'Cancelled',
          reason: null,
        },
      ],
    },
    {
      method: 'repairAutomationRun',
      args: [
        'auto-run-1',
        {
          actorUserId: 'admin-user-1',
          reason: 'clear overlap block',
        },
      ],
    },
    {
      method: 'repairActivityExport',
      args: [
        'exp-1',
        {
          actorUserId: 'admin-user-1',
          status: 'Queued',
          reason: null,
        },
      ],
    },
    {
      method: 'requeueScheduler',
      args: [
        'orders-sync',
        {
          actorUserId: 'admin-user-1',
          schedulerUserId: 'user-9',
        },
      ],
    },
    {
      method: 'releaseSchedulerLock',
      args: [
        'orders-sync',
        {
          actorUserId: 'admin-user-1',
          schedulerUserId: 'user-9',
          reason: 'expired lease',
        },
      ],
    },
  ]);
}

async function runRuntimeSourceCoverageAssertions(): Promise<void> {
  const findings: string[] = [];

  const requiredSourceMarkers: Array<{ relativePath: string; markers: string[] }> = [
    {
      relativePath: 'app.ts',
      markers: [
        'shutdownDrainTimeoutMs',
        'closeHttpServer',
        'API runtime shutdown completed successfully',
      ],
    },
    {
      relativePath: 'app.email-worker.ts',
      markers: ['draining email worker', 'worker.stop()', 'shutdownDrainTimeoutMs'],
    },
    {
      relativePath: 'src/loaders/AutomationRecoveryLoader.ts',
      markers: ['reconcileStaleRunsOnStartup()', 'Automation startup recovery scanned'],
    },
    {
      relativePath: 'src/api/services/RuntimeDiagnosticsService.ts',
      markers: [
        'getRuntimeOverview(',
        'listStaleItems(',
        'repairSchedulerCommand(',
        'repairSchedulerRun(',
        'repairAutomationRun(',
        'repairActivityExport(',
        'requeueScheduler(',
        'releaseSchedulerLock(',
        'fetchDiscoveryRuntimePayload(',
        'getApiLoopSnapshots()',
      ],
    },
    {
      relativePath: 'src/api/controllers/InternalRuntimeController.ts',
      markers: [
        "@JsonController('/internal/runtime')",
        "@Post('/repair/scheduler-command/:commandId')",
        "@Post('/repair/scheduler-run/:runId')",
        "@Post('/repair/automation-run/:runId')",
        "@Post('/repair/activity-export/:exportId')",
        "@Post('/requeue/scheduler/:schedulerKey')",
        "@Post('/release-lock/:schedulerKey')",
      ],
    },
    {
      relativePath: 'src/api/controllers/HealthController.ts',
      markers: [
        "@Get('/runtime')",
        'getRuntimeHealth(',
        'getRuntimeOverview()',
        'assertSecureEnvironmentConfig({',
        'activityExportStorageMode: env.activity.exportStorageMode',
        'activityExportStorageDir: env.activity.exportStorageDir',
      ],
    },
    {
      relativePath: 'src/api/services/ActivityExportProcessorService.ts',
      markers: ['recoverStaleProcessingExports()', 'getRuntimeSnapshot()', 'markExportProcessing('],
    },
    {
      relativePath: 'src/api/services/AutomationsService.ts',
      markers: ['getRuntimeStaleRunCandidates(', 'repairRuntimeRun(', 'reconcileStaleRunsOnStartup('],
    },
    {
      relativePath: 'scripts/_support/run-package-suite.ts',
      markers: ["'runtime-recovery': 'cross-cutting'", "'test:runtime-recovery'"],
    },
  ];

  for (const entry of requiredSourceMarkers) {
    const source = read(entry.relativePath);
    for (const marker of entry.markers) {
      if (!source.includes(marker)) {
        findings.push(`${entry.relativePath}: missing runtime recovery marker ${marker}`);
      }
    }
  }

  const packageSource = read('package.json');
  for (const marker of [
    '"test:runtime-recovery"',
    '"check:runtime-health"',
    '"smoke:runtime-recovery"',
    '"release-gate:runtime-recovery"',
    '"signoff:runtime-recovery"',
  ]) {
    if (!packageSource.includes(marker)) {
      findings.push(`package.json: missing runtime recovery workflow script ${marker}`);
    }
  }

  const operationalAuditSource = read('scripts/test-operational-audit.ts');
  for (const marker of [
    '"test:runtime-recovery"',
    '"check:runtime-health"',
    '"smoke:runtime-recovery"',
    '"release-gate:runtime-recovery"',
    '"signoff:runtime-recovery"',
  ]) {
    if (!operationalAuditSource.includes(marker)) {
      findings.push(`test-operational-audit.ts: missing runtime workflow guard ${marker}`);
    }
  }

  const startAllSource = readBackendRoot('start-all.sh');
  for (const marker of [
    'wait_for_http_ok',
    'API_RUNTIME_HEALTH_URL',
    'WORKER_HEALTH_URL',
    'DISCOVERY_READY_URL',
    'post_start_validation',
  ]) {
    if (!startAllSource.includes(marker)) {
      findings.push(`../start-all.sh: missing runtime deploy guard ${marker}`);
    }
  }

  const stopAllSource = readBackendRoot('stop-all.sh');
  for (const marker of ['TERM_TIMEOUT_SECONDS', 'wait_for_exit', 'kill -9']) {
    if (!stopAllSource.includes(marker)) {
      findings.push(`../stop-all.sh: missing graceful stop guard ${marker}`);
    }
  }

  const statusAllSource = readBackendRoot('status-all.sh');
  for (const marker of [
    'API runtime health',
    'Worker local health endpoint',
    'Discovery ready endpoint',
    'Runtime stale count',
  ]) {
    if (!statusAllSource.includes(marker)) {
      findings.push(`../status-all.sh: missing runtime status surface ${marker}`);
    }
  }

  assert.equal(
    findings.length,
    0,
    `Runtime recovery coverage guard failed:\n${findings.join('\n')}`
  );
}

async function run(): Promise<void> {
  await runRuntimeValidatorAssertions();
  await runRuntimeControllerAssertions();
  await runRuntimeSourceCoverageAssertions();
  console.log('Runtime recovery coverage assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
