import assert from 'node:assert/strict';

import { RiskService } from '../src/api/services/RiskService';

function createPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-1',
    userId: 'user-1',
    scope: 'user',
    brokerKey: null,
    accountId: null,
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
    maxLeverage: 5,
    maxOrderAllocation: 25,
    maxTotalAllocation: 60,
    maxAvgLeverage: 3,
    updatedAt: new Date('2026-04-09T12:00:00.000Z'),
    ...overrides,
  };
}

function createVersionRecord(
  versionId: string,
  lifecycleOverrides: Record<string, unknown> = {},
  snapshotOverrides: Record<string, unknown> = {}
) {
  return {
    id: versionId,
    policyId: 'policy-1',
    actorUserId: 'actor-1',
    versionPayload: JSON.stringify({
      snapshot: {
        id: 'policy-1',
        scope: 'user',
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
        maxLeverage: 2,
        maxOrderAllocation: 20,
        maxTotalAllocation: 55,
        maxAvgLeverage: 2,
        updatedAt: '2026-04-09T12:30:00.000Z',
        ...snapshotOverrides,
      },
      lifecycle: {
        operation: 'update',
        approvalMode: 'manual_review',
        approvalState: 'pending_review',
        ...lifecycleOverrides,
      },
    }),
    createdAt: new Date('2026-04-09T12:30:00.000Z'),
  };
}

async function runManualReviewSubmissionAssertions(): Promise<void> {
  const service = new RiskService() as any;
  const versionPayloads: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];

  service.riskPolicyRepository = {
    async getPolicyById() {
      return createPolicy();
    },
    async listPolicyVersions() {
      return [];
    },
    async findConflictingPolicy() {
      return null;
    },
    async createPolicyVersion(
      _policyId: string,
      _userId: string,
      _actorUserId: string,
      payload: Record<string, unknown>
    ) {
      versionPayloads.push(payload);
      return { id: 'ver-pending-1' };
    },
    async updatePolicy() {
      throw new Error('updatePolicy should not run while a change is pending review');
    },
    isDuplicatePolicyTargetError() {
      return false;
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activities.push(payload);
    },
    async emitFailureAlert() {
      throw new Error('emitFailureAlert should not run for a successful review submission');
    },
  };

  const response = await service.updateRiskPolicy('user-1', 'reviewer-1', 'policy-1', {
    scope: 'user',
    enabled: true,
    monitorOnly: false,
    enforceHardBlock: true,
    marginUsageWarnPct: 65,
    marginUsageCriticalPct: 82,
    concentrationWarnPct: 28,
    concentrationCriticalPct: 42,
    dailyLossLimitPct: 4,
    weeklyLossLimitPct: 10,
    monthlyLossLimitPct: 18,
    maxLeverage: 2,
    maxOrderAllocation: 20,
    maxTotalAllocation: 55,
    maxAvgLeverage: 2,
  });

  assert.equal(response.data.message, 'Risk policy change submitted for approval.');
  assert.equal(response.data.policyId, 'policy-1');
  assert.equal(response.data.versionId, 'ver-pending-1');
  assert.equal(response.data.applied, false);
  assert.equal(response.data.approvalMode, 'manual_review');
  assert.equal(response.data.approvalState, 'pending_review');
  assert.equal(response.data.policy.pendingVersionId, 'ver-pending-1');
  assert.equal(response.data.policy.pendingVersionCount, 1);
  assert.equal(versionPayloads.length, 1);

  const payload = versionPayloads[0] as {
    lifecycle?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
  };
  assert.equal(payload.lifecycle?.approvalMode, 'manual_review');
  assert.equal(payload.lifecycle?.approvalState, 'pending_review');
  assert.equal(payload.lifecycle?.operation, 'update');
  assert.equal(payload.snapshot?.enforceHardBlock, true);
  assert.equal(payload.snapshot?.maxLeverage, 2);

  assert.deepEqual(activities[0], {
    type: 'Risk policy',
    title: 'Risk policy change submitted for review',
    status: 'In progress',
    route: 'Risk',
    stream: 'Policies',
    referenceId: 'policy-1',
    related: 'user-default',
    correlationId: 'ver-pending-1',
    description: 'Risk policy update requires approval before it becomes effective (user)',
  });
}

async function runApprovalAssertions(): Promise<void> {
  const service = new RiskService() as any;
  const updatedPayloads: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];

  service.riskPolicyRepository = {
    async getPolicyById() {
      return createPolicy();
    },
    async getPolicyVersionById() {
      return createVersionRecord('ver-pending-1');
    },
    async findConflictingPolicy() {
      return null;
    },
    async updatePolicy(_userId: string, policyId: string, payload: Record<string, unknown>) {
      assert.equal(policyId, 'policy-1');
      assert.equal(payload.enforceHardBlock, false);
      assert.equal(payload.maxLeverage, 2);
      return createPolicy({
        id: 'policy-1',
        monitorOnly: true,
        enforceHardBlock: false,
        maxLeverage: 2,
        maxOrderAllocation: 20,
        maxTotalAllocation: 55,
        maxAvgLeverage: 2,
        updatedAt: new Date('2026-04-09T12:45:00.000Z'),
      });
    },
    async updatePolicyVersionPayload(
      _userId: string,
      _policyId: string,
      _versionId: string,
      payload: Record<string, unknown>
    ) {
      updatedPayloads.push(payload);
      return createVersionRecord('ver-pending-1', {
        approvalState: 'approved',
        approvedAt: '2026-04-09T12:45:00.000Z',
        approvedByUserId: 'reviewer-2',
      });
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activities.push(payload);
    },
  };

  const response = await service.approveRiskPolicyVersion(
    'user-1',
    'reviewer-2',
    'policy-1',
    'ver-pending-1',
    { reason: 'Safe to activate' }
  );

  assert.equal(response.data.message, 'Risk policy change approved.');
  assert.equal(response.data.approvalState, 'approved');
  assert.equal(response.data.applied, true);
  assert.equal(response.data.policy?.maxLeverage, 2);
  assert.equal(response.data.policy?.approvalMode, 'manual_review');
  assert.equal(updatedPayloads.length, 1);
  assert.equal(
    (updatedPayloads[0].lifecycle as Record<string, unknown>).approvalState,
    'approved'
  );
  assert.equal(
    (updatedPayloads[0].lifecycle as Record<string, unknown>).reviewReason,
    'Safe to activate'
  );
  assert.deepEqual(activities[0], {
    type: 'Risk policy',
    title: 'Risk policy change approved',
    status: 'Success',
    route: 'Risk',
    stream: 'Policies',
    referenceId: 'policy-1',
    related: 'ver-pending-1',
    correlationId: 'ver-pending-1',
    description: 'Pending risk policy version ver-pending-1 is now effective',
  });
}

async function runRejectionAssertions(): Promise<void> {
  const service = new RiskService() as any;
  const updatedPayloads: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];

  service.riskPolicyRepository = {
    async getPolicyById() {
      return createPolicy();
    },
    async getPolicyVersionById() {
      return createVersionRecord('ver-pending-2');
    },
    async updatePolicyVersionPayload(
      _userId: string,
      _policyId: string,
      _versionId: string,
      payload: Record<string, unknown>
    ) {
      updatedPayloads.push(payload);
      return createVersionRecord('ver-pending-2', {
        approvalState: 'rejected',
        reviewReason: 'Needs another review',
      });
    },
  };
  service.operationalEventService = {
    async logActivity(_userId: string, payload: Record<string, unknown>) {
      activities.push(payload);
    },
  };

  const response = await service.rejectRiskPolicyVersion(
    'user-1',
    'reviewer-3',
    'policy-1',
    'ver-pending-2',
    { reason: 'Needs another review' }
  );

  assert.equal(response.data.message, 'Risk policy change rejected.');
  assert.equal(response.data.approvalState, 'rejected');
  assert.equal(response.data.applied, false);
  assert.equal(response.data.policy?.maxLeverage, 5);
  assert.equal(updatedPayloads.length, 1);
  assert.equal(
    (updatedPayloads[0].lifecycle as Record<string, unknown>).approvalState,
    'rejected'
  );
  assert.equal(
    (updatedPayloads[0].lifecycle as Record<string, unknown>).reviewReason,
    'Needs another review'
  );
  assert.deepEqual(activities[0], {
    type: 'Risk policy',
    title: 'Risk policy change rejected',
    status: 'Watch',
    route: 'Risk',
    stream: 'Policies',
    referenceId: 'policy-1',
    related: 'ver-pending-2',
    correlationId: 'ver-pending-2',
    description: 'Pending risk policy version ver-pending-2 was rejected',
  });
}

async function runHistoryGovernanceAssertions(): Promise<void> {
  const service = new RiskService() as any;

  service.riskPolicyRepository = {
    async getPolicyById() {
      return createPolicy();
    },
    async listPolicyVersions() {
      return [
        createVersionRecord('ver-pending-1', {
          operation: 'update',
          approvalMode: 'manual_review',
          approvalState: 'pending_review',
        }),
        createVersionRecord(
          'ver-approved-1',
          {
            operation: 'update',
            approvalMode: 'auto_approved',
            approvalState: 'approved',
            approvedAt: '2026-04-09T12:00:00.000Z',
            approvedByUserId: 'actor-1',
          },
          {
            maxLeverage: 5,
            maxOrderAllocation: 25,
            maxTotalAllocation: 60,
            maxAvgLeverage: 3,
            updatedAt: '2026-04-09T12:00:00.000Z',
          }
        ),
      ];
    },
  };

  const versionsResponse = await service.getRiskPolicyVersions('user-1', 'policy-1');
  assert.equal(versionsResponse.data.currentVersionId, 'ver-approved-1');
  assert.equal(versionsResponse.data.pendingVersionId, 'ver-pending-1');
  assert.equal(versionsResponse.data.pendingVersionCount, 1);
  assert.equal(versionsResponse.data.approvalMode, 'manual_review');
  assert.equal(versionsResponse.data.currentApprovalState, 'pending_review');
  assert.equal(versionsResponse.data.items[0].canApprove, true);
  assert.equal(versionsResponse.data.items[0].canReject, true);
  assert.equal(versionsResponse.data.items[0].effective, false);
  assert.equal(versionsResponse.data.items[1].effective, true);
  assert.equal(versionsResponse.data.items[1].canRollback, false);

  service.riskPolicyRepository = {
    async listPolicies() {
      return [createPolicy()];
    },
    async listPolicyVersions() {
      return [
        createVersionRecord('ver-pending-1', {
          operation: 'update',
          approvalMode: 'manual_review',
          approvalState: 'pending_review',
        }),
        createVersionRecord(
          'ver-approved-1',
          {
            operation: 'update',
            approvalMode: 'auto_approved',
            approvalState: 'approved',
            approvedAt: '2026-04-09T12:00:00.000Z',
            approvedByUserId: 'actor-1',
          },
          {
            maxLeverage: 5,
            maxOrderAllocation: 25,
            maxTotalAllocation: 60,
            maxAvgLeverage: 3,
            updatedAt: '2026-04-09T12:00:00.000Z',
          }
        ),
      ];
    },
  };

  const policiesResponse = await service.getRiskPolicies('user-1');
  assert.equal(policiesResponse.data.items[0].approvalMode, 'manual_review');
  assert.equal(policiesResponse.data.items[0].approvalState, 'pending_review');
  assert.equal(policiesResponse.data.items[0].pendingVersionId, 'ver-pending-1');
  assert.equal(policiesResponse.data.items[0].pendingVersionCount, 1);
}

async function main(): Promise<void> {
  await runManualReviewSubmissionAssertions();
  await runApprovalAssertions();
  await runRejectionAssertions();
  await runHistoryGovernanceAssertions();
  console.log('Risk Center Phase 8 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
