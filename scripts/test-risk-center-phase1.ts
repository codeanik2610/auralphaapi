import assert from 'node:assert/strict';

import { RiskService } from '../src/api/services/RiskService';
import { RiskPolicyRepository } from '../src/database/repositories/RiskPolicyRepository';
import { UpsertRiskPolicyBody } from '../src/api/contracts/Risk';

function createPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-1',
    userId: 'user-1',
    scope: 'user',
    brokerKey: null,
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
    updatedAt: new Date('2026-04-09T10:00:00.000Z'),
    ...overrides,
  };
}

function createPolicyBody(overrides: Partial<UpsertRiskPolicyBody> = {}): UpsertRiskPolicyBody {
  return {
    scope: 'user',
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
    ...overrides,
  };
}

function createRiskService(
  riskPolicyRepositoryOverrides: Record<string, unknown> = {},
  operationalEventOverrides: Record<string, unknown> = {}
) {
  const service = new RiskService() as any;

  service.riskPolicyRepository = {
    async findConflictingPolicy() {
      return null;
    },
    async createPolicy(_userId: string, payload: UpsertRiskPolicyBody) {
      return createPolicy(payload as unknown as Record<string, unknown>);
    },
    async getPolicyById(_userId: string, policyId: string) {
      return createPolicy({ id: policyId });
    },
    async updatePolicy(_userId: string, policyId: string, payload: UpsertRiskPolicyBody) {
      return createPolicy({ id: policyId, ...(payload as unknown as Record<string, unknown>) });
    },
    async listPolicyVersions() {
      return [];
    },
    async createPolicyVersion() {
      return {};
    },
    isDuplicatePolicyTargetError() {
      return false;
    },
    ...riskPolicyRepositoryOverrides,
  };

  service.operationalEventService = {
    async logActivity() {
      return undefined;
    },
    async emitFailureAlert() {
      return undefined;
    },
    ...operationalEventOverrides,
  };

  return service;
}

async function expectConflict(run: () => Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 409 &&
      error.message === message
  );
}

async function runRepositoryAssertions(): Promise<void> {
  const repository = new RiskPolicyRepository() as any;
  repository.listPolicies = async () => [
    createPolicy({
      id: 'user-newer',
      scope: 'user',
      brokerKey: null,
      maxLeverage: 2,
      enforceHardBlock: true,
      updatedAt: new Date('2026-04-09T12:00:00.000Z'),
    }),
    createPolicy({
      id: 'broker-mudrex',
      scope: 'broker',
      brokerKey: 'mudrex',
      maxLeverage: 8,
      enforceHardBlock: false,
      updatedAt: new Date('2026-04-09T09:00:00.000Z'),
    }),
    createPolicy({
      id: 'broker-disabled',
      scope: 'broker',
      brokerKey: 'binance',
      enabled: false,
      updatedAt: new Date('2026-04-09T11:00:00.000Z'),
    }),
  ];

  const brokerEffective = await repository.getEffectivePolicy('user-1', ' MuDrEx ');
  assert.equal(brokerEffective?.id, 'broker-mudrex');

  const fallbackEffective = await repository.getEffectivePolicy('user-1', 'binance');
  assert.equal(fallbackEffective?.id, 'user-newer');

  const noBrokerEffective = await repository.getEffectivePolicy('user-1');
  assert.equal(noBrokerEffective?.id, 'user-newer');

  assert.equal(
    repository.isDuplicatePolicyTargetError({
      code: 'ER_DUP_ENTRY',
      message: 'Duplicate entry for key uidx_risk_policies_user_target_key',
    }),
    true
  );
}

async function runCreatePolicyAssertions(): Promise<void> {
  const versionCalls: unknown[][] = [];
  const createdResponse = await createRiskService(
    {
      async createPolicy(userId: string, payload: UpsertRiskPolicyBody) {
        assert.equal(userId, 'user-1');
        assert.equal(payload.scope, 'broker');
        assert.equal(payload.brokerKey, 'mudrex');
        return createPolicy({
          id: 'policy-created',
          scope: payload.scope,
          brokerKey: payload.brokerKey ?? null,
          enabled: payload.enabled,
          monitorOnly: payload.monitorOnly,
          enforceHardBlock: payload.enforceHardBlock,
          marginUsageWarnPct: payload.marginUsageWarnPct,
          marginUsageCriticalPct: payload.marginUsageCriticalPct,
          concentrationWarnPct: payload.concentrationWarnPct,
          concentrationCriticalPct: payload.concentrationCriticalPct,
          dailyLossLimitPct: payload.dailyLossLimitPct,
          weeklyLossLimitPct: payload.weeklyLossLimitPct,
          monthlyLossLimitPct: payload.monthlyLossLimitPct,
          maxLeverage: payload.maxLeverage,
          maxOrderAllocation: payload.maxOrderAllocation,
          maxTotalAllocation: payload.maxTotalAllocation,
          maxAvgLeverage: payload.maxAvgLeverage,
        });
      },
      async createPolicyVersion(...args: unknown[]) {
        versionCalls.push(args);
        return {};
      },
    }
  ).createRiskPolicy(
    'user-1',
    'actor-1',
    createPolicyBody({
      scope: 'broker',
      brokerKey: 'MUDREX',
      enabled: 'true' as unknown as boolean,
      monitorOnly: 'false' as unknown as boolean,
      enforceHardBlock: 'true' as unknown as boolean,
    })
  );

  assert.equal(createdResponse.data.policyId, 'policy-created');
  assert.equal(createdResponse.data.policy.brokerKey, 'mudrex');
  assert.equal(versionCalls.length, 1);
  assert.deepEqual(versionCalls[0]?.slice(0, 3), ['policy-created', 'user-1', 'actor-1']);
  const versionPayload = versionCalls[0]?.[3] as Record<string, any>;
  assert.deepEqual(versionPayload.snapshot, {
    id: 'policy-created',
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
    approvalMode: 'auto_approved',
    approvalState: 'approved',
    pendingVersionId: undefined,
    pendingVersionCount: 0,
    updatedAt: '2026-04-09T10:00:00.000Z',
  });
  assert.equal(versionPayload.lifecycle.operation, 'create');
  assert.equal(versionPayload.lifecycle.approvalMode, 'auto_approved');
  assert.equal(versionPayload.lifecycle.approvalState, 'approved');
  assert.equal(versionPayload.lifecycle.approvedByUserId, 'actor-1');
}

async function runDuplicateProtectionAssertions(): Promise<void> {
  let createCalled = false;
  const duplicateUserMessage =
    'A user-default risk policy already exists. Update the existing default policy instead of creating another one.';

  await expectConflict(
    () =>
      createRiskService({
        async findConflictingPolicy() {
          return createPolicy({ id: 'duplicate-user-policy' });
        },
        async createPolicy() {
          createCalled = true;
          return createPolicy();
        },
      }).createRiskPolicy('user-1', 'actor-1', createPolicyBody()),
    duplicateUserMessage
  );

  assert.equal(createCalled, false);

  await expectConflict(
    () =>
      createRiskService({
        async findConflictingPolicy() {
          return null;
        },
        async createPolicy() {
          throw {
            code: 'ER_DUP_ENTRY',
            message: 'Duplicate entry for key uidx_risk_policies_user_target_key',
          };
        },
        isDuplicatePolicyTargetError(error: unknown) {
          return new RiskPolicyRepository().isDuplicatePolicyTargetError(error);
        },
      }).createRiskPolicy(
        'user-1',
        'actor-1',
        createPolicyBody({
          scope: 'broker',
          brokerKey: 'mudrex',
        })
      ),
    'A broker risk policy already exists for "mudrex". Update the existing broker policy instead of creating another one.'
  );

  let updateCalled = false;
  await expectConflict(
    () =>
      createRiskService({
        async getPolicyById(_userId: string, policyId: string) {
          return createPolicy({ id: policyId });
        },
        async findConflictingPolicy() {
          return createPolicy({ id: 'other-broker-policy' });
        },
        async updatePolicy() {
          updateCalled = true;
          return createPolicy();
        },
      }).updateRiskPolicy(
        'user-1',
        'actor-1',
        'policy-1',
        createPolicyBody({
          scope: 'broker',
          brokerKey: 'mudrex',
        })
      ),
    'A broker risk policy already exists for "mudrex". Update the existing broker policy instead of creating another one.'
  );

  assert.equal(updateCalled, false);
}

async function runPreTradeAssertions(): Promise<void> {
  const service = createRiskService({
    async getEffectivePolicy(userId: string, brokerKey?: string) {
      assert.equal(userId, 'user-1');
      assert.equal(brokerKey, 'mudrex');
      return createPolicy({
        id: 'broker-effective',
        scope: 'broker',
        brokerKey: 'mudrex',
        maxLeverage: 3,
        enforceHardBlock: true,
      });
    },
  });

  const blockedResult = await service.evaluatePreTradeOrder(
    'user-1',
    { brokerKey: 'mudrex', accountId: 'account-1' },
    { assetId: 'asset-1', quantity: 2, orderPrice: 10, leverage: 5 }
  );

  assert.equal(blockedResult.policyId, 'broker-effective');
  assert.equal(blockedResult.blocked, true);
  assert.deepEqual(blockedResult.breaches, ['Leverage exceeds max (3)']);

  const allowedResult = await createRiskService({
    async getEffectivePolicy() {
      return createPolicy({
        id: 'user-fallback',
        scope: 'user',
        brokerKey: null,
        maxLeverage: 8,
        enforceHardBlock: false,
      });
    },
  }).evaluatePreTradeOrder(
    'user-1',
    { brokerKey: 'binance', accountId: 'account-2' },
    { assetId: 'asset-2', quantity: 1, orderPrice: 5, leverage: 6 }
  );

  assert.equal(allowedResult.policyId, 'user-fallback');
  assert.equal(allowedResult.blocked, false);
  assert.deepEqual(allowedResult.breaches, []);
}

async function main(): Promise<void> {
  await runRepositoryAssertions();
  await runCreatePolicyAssertions();
  await runDuplicateProtectionAssertions();
  await runPreTradeAssertions();
  console.log('Risk Center Phase 1 assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
