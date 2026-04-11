import assert from 'node:assert/strict';

import { RiskService } from '../src/api/services/RiskService';

function createPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-1',
    userId: 'user-1',
    scope: 'broker',
    brokerKey: 'mudrex',
    accountId: null,
    enabled: true,
    monitorOnly: false,
    enforceHardBlock: true,
    marginUsageWarnPct: 70,
    marginUsageCriticalPct: 85,
    concentrationWarnPct: 30,
    concentrationCriticalPct: 45,
    dailyLossLimitPct: 5,
    weeklyLossLimitPct: 12,
    monthlyLossLimitPct: 20,
    maxLeverage: 5,
    maxOrderAllocation: 25,
    maxTotalAllocation: 70,
    maxAvgLeverage: 3,
    updatedAt: new Date('2026-04-09T12:00:00.000Z'),
    ...overrides,
  };
}

function createVersionPayload(
  snapshotOverrides: Record<string, unknown> = {},
  lifecycleOverrides: Record<string, unknown> = {}
) {
  return JSON.stringify({
    snapshot: {
      id: 'policy-1',
      scope: 'broker',
      brokerKey: 'mudrex',
      enabled: true,
      monitorOnly: false,
      enforceHardBlock: true,
      marginUsageWarnPct: 70,
      marginUsageCriticalPct: 85,
      concentrationWarnPct: 30,
      concentrationCriticalPct: 45,
      dailyLossLimitPct: 5,
      weeklyLossLimitPct: 12,
      monthlyLossLimitPct: 20,
      maxLeverage: 5,
      maxOrderAllocation: 25,
      maxTotalAllocation: 70,
      maxAvgLeverage: 3,
      updatedAt: '2026-04-09T12:00:00.000Z',
      ...snapshotOverrides,
    },
    lifecycle: {
      operation: 'update',
      approvalMode: 'auto_approved',
      approvalState: 'approved',
      approvedAt: '2026-04-09T12:00:00.000Z',
      approvedByUserId: 'actor-1',
      ...lifecycleOverrides,
    },
  });
}

async function runVersionHistoryAssertions(): Promise<void> {
  const service = new RiskService() as any;
  service.riskPolicyRepository = {
    async getPolicyById() {
      return createPolicy();
    },
    async listPolicyVersions() {
      return [
        {
          id: 'ver-3',
          policyId: 'policy-1',
          actorUserId: 'actor-3',
          versionPayload: createVersionPayload(
            { maxLeverage: 3, monitorOnly: true, enforceHardBlock: false },
            {
              operation: 'rollback',
              reason: 'Restore safer settings',
              rollbackFromVersionId: 'ver-1',
              approvedAt: '2026-04-09T12:15:00.000Z',
              approvedByUserId: 'actor-3',
            }
          ),
          createdAt: new Date('2026-04-09T12:15:00.000Z'),
        },
        {
          id: 'ver-2',
          policyId: 'policy-1',
          actorUserId: 'actor-2',
          versionPayload: createVersionPayload({
            maxLeverage: 7,
            marginUsageWarnPct: 68,
            updatedAt: '2026-04-09T11:00:00.000Z',
          }),
          createdAt: new Date('2026-04-09T11:00:00.000Z'),
        },
        {
          id: 'ver-1',
          policyId: 'policy-1',
          actorUserId: 'actor-1',
          versionPayload: JSON.stringify({
            scope: 'broker',
            brokerKey: 'mudrex',
            enabled: true,
            monitorOnly: true,
            enforceHardBlock: false,
            marginUsageWarnPct: 70,
            marginUsageCriticalPct: 85,
            concentrationWarnPct: 30,
            concentrationCriticalPct: 45,
            dailyLossLimitPct: 5,
            weeklyLossLimitPct: 12,
            monthlyLossLimitPct: 20,
            maxLeverage: 3,
            maxOrderAllocation: 25,
            maxTotalAllocation: 70,
            maxAvgLeverage: 3,
          }),
          createdAt: new Date('2026-04-09T10:00:00.000Z'),
        },
      ];
    },
  };

  const response = await service.getRiskPolicyVersions('user-1', 'policy-1');

  assert.equal(response.data.total, 3);
  assert.equal(response.data.currentVersionId, 'ver-3');
  assert.equal(response.data.items[0].operation, 'rollback');
  assert.equal(response.data.items[0].canRollback, false);
  assert.equal(response.data.items[0].rollbackFromVersionId, 'ver-1');
  assert.equal(response.data.items[0].approvalMode, 'auto_approved');
  assert.equal(response.data.items[0].links.activityPath, '/activity?route=Risk&referenceId=policy-1');
  assert.equal(
    response.data.items[0].links.enforcementActivityPath,
    '/activity?route=Risk&stream=Controls&referenceId=policy-1'
  );
  assert.equal(response.data.items[1].operation, 'update');
  assert.equal(response.data.items[1].canRollback, true);
  assert.equal(response.data.items[2].operation, 'create');
  assert.ok(response.data.items[1].changedFields.includes('Max leverage'));
}

async function runRollbackAssertions(): Promise<void> {
  const service = new RiskService() as any;
  const versionPayloads: unknown[] = [];
  const activityCalls: unknown[] = [];
  const alertCalls: unknown[] = [];

  service.riskPolicyRepository = {
    async getPolicyById() {
      return createPolicy({
        maxLeverage: 2,
        monitorOnly: true,
        enforceHardBlock: false,
        updatedAt: new Date('2026-04-09T12:00:00.000Z'),
      });
    },
    async listPolicyVersions() {
      return [
        {
          id: 'ver-current',
          policyId: 'policy-1',
          actorUserId: 'actor-2',
          versionPayload: createVersionPayload({
            maxLeverage: 2,
            monitorOnly: true,
            enforceHardBlock: false,
            updatedAt: '2026-04-09T12:00:00.000Z',
          }),
          createdAt: new Date('2026-04-09T12:00:00.000Z'),
        },
        {
          id: 'ver-safe',
          policyId: 'policy-1',
          actorUserId: 'actor-1',
          versionPayload: createVersionPayload(
            { maxLeverage: 5, monitorOnly: false, enforceHardBlock: false },
            { operation: 'create' }
          ),
          createdAt: new Date('2026-04-09T10:00:00.000Z'),
        },
      ];
    },
    async updatePolicy(_userId: string, policyId: string, payload: Record<string, unknown>) {
      assert.equal(policyId, 'policy-1');
      assert.equal(payload.maxLeverage, 5);
      assert.equal(payload.monitorOnly, false);
      assert.equal(payload.enforceHardBlock, false);
      return createPolicy({
        id: policyId,
        maxLeverage: 5,
        monitorOnly: false,
        enforceHardBlock: false,
        updatedAt: new Date('2026-04-09T12:30:00.000Z'),
      });
    },
    async findConflictingPolicy() {
      return null;
    },
    async createPolicyVersion(...args: unknown[]) {
      versionPayloads.push(args[3]);
      return { id: 'ver-rollback-created' };
    },
    isDuplicatePolicyTargetError() {
      return false;
    },
  };

  service.operationalEventService = {
    async logActivity(_userId: string, payload: unknown) {
      activityCalls.push(payload);
      return undefined;
    },
    async emitFailureAlert(_userId: string, payload: unknown) {
      alertCalls.push(payload);
      return undefined;
    },
  };

  const response = await service.rollbackRiskPolicy('user-1', 'actor-9', 'policy-1', {
    versionId: 'ver-safe',
    reason: 'Restore safer settings',
  });

  assert.equal(response.data.message, 'Risk policy rolled back.');
  assert.equal(response.data.restoredVersionId, 'ver-safe');
  assert.equal(response.data.createdVersionId, 'ver-rollback-created');
  assert.equal(response.data.policy.maxLeverage, 5);
  assert.equal(activityCalls.length, 1);
  assert.deepEqual(activityCalls[0], {
    type: 'Risk policy',
    title: 'Risk policy rolled back',
    status: 'Success',
    route: 'Risk',
    stream: 'Policies',
    referenceId: 'policy-1',
    related: 'ver-safe',
    correlationId: 'ver-rollback-created',
    description: 'Risk policy restored from version ver-safe',
  });
  assert.equal(alertCalls.length, 0);

  const rollbackVersionPayload = versionPayloads[0] as Record<string, any>;
  assert.equal(rollbackVersionPayload.lifecycle.operation, 'rollback');
  assert.equal(rollbackVersionPayload.lifecycle.reason, 'Restore safer settings');
  assert.equal(rollbackVersionPayload.lifecycle.rollbackFromVersionId, 'ver-safe');
  assert.equal(rollbackVersionPayload.lifecycle.approvedByUserId, 'actor-9');
}

async function main(): Promise<void> {
  await runVersionHistoryAssertions();
  await runRollbackAssertions();
  console.log('Risk Center Phase 4 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
