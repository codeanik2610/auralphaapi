import assert from 'node:assert/strict';
import { runScriptSuite, runSuiteSteps } from './_support/run-script-suite';
import type { UpsertRiskPolicyBody } from '../src/api/contracts/Risk';
import type { RiskBrokerOverviewItem } from '../src/api/contracts/RiskOverview';

// Consolidated module suite.

async function risk_centerGuard01(): Promise<void> {
  const { RiskService } = await import('../src/api/services/RiskService');
  const { RiskPreTradeService } = await import('../src/api/services/RiskPreTradeService');
  const { RiskPolicyRepository } =
    await import('../src/database/repositories/RiskPolicyRepository');

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
      minLeverage: 1,
      maxLeverage: 5,
      minNotionalPerTrade: 100,
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
      minLeverage: 1,
      maxLeverage: 5,
      minNotionalPerTrade: 100,
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
        return createPolicy({
          id: policyId,
          ...(payload as unknown as Record<string, unknown>),
        });
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

    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
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
    const createdResponse = await createRiskService({
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
          minLeverage: payload.minLeverage,
          maxLeverage: payload.maxLeverage,
          minNotionalPerTrade: payload.minNotionalPerTrade,
          maxOrderAllocation: payload.maxOrderAllocation,
          maxTotalAllocation: payload.maxTotalAllocation,
          maxAvgLeverage: payload.maxAvgLeverage,
        });
      },
      async createPolicyVersion(...args: unknown[]) {
        versionCalls.push(args);
        return {};
      },
    }).createRiskPolicy(
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
      minLeverage: 1,
      maxLeverage: 5,
      minNotionalPerTrade: 100,
      maxOrderAllocation: 25,
      tradeSizePctOfBalance: undefined,
      maxTotalAllocation: 70,
      maxAvgLeverage: 3,
      mode: 'hard_block',
      approvalMode: 'auto_approved',
      approvalState: 'approved',
      pendingVersionId: undefined,
      pendingVersionCount: 0,
      updatedAt: '2026-04-09T10:00:00.000+00:00',
      updatedAtIso: '2026-04-09T10:00:00.000Z',
    });
    assert.equal(versionPayload.lifecycle.operation, 'create');
    assert.equal(versionPayload.lifecycle.approvalMode, 'auto_approved');
    assert.equal(versionPayload.lifecycle.approvalState, 'approved');
    assert.equal(versionPayload.lifecycle.approvedByUserId, 'actor-1');

    await assert.rejects(
      () =>
        createRiskService().createRiskPolicy(
          'user-1',
          'actor-1',
          createPolicyBody({ minLeverage: 6, maxLeverage: 5 })
        ),
      /maxLeverage must be greater than or equal to minLeverage/
    );

    await assert.rejects(
      () =>
        createRiskService().createRiskPolicy(
          'user-1',
          'actor-1',
          createPolicyBody({ minNotionalPerTrade: 0 })
        ),
      /minNotionalPerTrade must be greater than 0 when provided/
    );
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
          minNotionalPerTrade: null,
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
          minLeverage: null,
          minNotionalPerTrade: null,
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

    const belowMinimumsResult = await createRiskService({
      async getEffectivePolicy() {
        return createPolicy({
          id: 'broker-minimums',
          scope: 'broker',
          brokerKey: 'mudrex',
          minLeverage: 2,
          maxLeverage: 10,
          minNotionalPerTrade: 250,
          maxOrderAllocation: null,
          enforceHardBlock: true,
        });
      },
    }).evaluatePreTradeOrder(
      'user-1',
      { brokerKey: 'mudrex', accountId: 'account-1' },
      { assetId: 'asset-1', quantity: 1, orderPrice: 100, leverage: 1 }
    );

    assert.equal(belowMinimumsResult.policyId, 'broker-minimums');
    assert.equal(belowMinimumsResult.blocked, true);
    assert.deepEqual(belowMinimumsResult.breaches, ['Leverage below min (2)']);
  }

  async function runSnapshotPreTradeThresholdAssertions(): Promise<void> {
    const service = new RiskPreTradeService() as any;
    const freshEmptyRoute = service.resolveFreshness(
      { createdAt: new Date() },
      {
        latestSuccessWalletAvailable: false,
        latestSuccessFuturesAvailable: true,
        positionsObservedAt: null,
        latestPositionSnapshotSeenAt: null,
        latestPositionReadModelSeenAt: null,
        positionsCheckpointAt: new Date(),
        openPositions: 0,
        positionTotalRows: 0,
        positionSnapshotRows: 0,
        positionReadModelRows: 0,
        rowsMissingFromReadModel: 0,
        rowsBehindSnapshot: 0,
        orphanReadModelRows: 0,
      }
    );
    assert.equal(freshEmptyRoute.freshnessState, 'fresh');
    assert.equal(freshEmptyRoute.blocking, false);

    const missingEmptyRouteCheckpoint = service.resolveFreshness(
      { createdAt: new Date() },
      {
        latestSuccessWalletAvailable: false,
        latestSuccessFuturesAvailable: true,
        positionsObservedAt: null,
        latestPositionSnapshotSeenAt: null,
        latestPositionReadModelSeenAt: null,
        positionsCheckpointAt: null,
        openPositions: 0,
        positionTotalRows: 0,
        positionSnapshotRows: 0,
        positionReadModelRows: 0,
        rowsMissingFromReadModel: 0,
        rowsBehindSnapshot: 0,
        orphanReadModelRows: 0,
      }
    );
    assert.equal(missingEmptyRouteCheckpoint.freshnessState, 'partial');
    assert.equal(missingEmptyRouteCheckpoint.blocking, true);

    const thresholds = {
      marginUsageWarnPct: 70,
      marginUsageCriticalPct: 85,
      concentrationWarnPct: 30,
      concentrationCriticalPct: 45,
      dailyLossLimitPct: 5,
      weeklyLossLimitPct: 12,
      monthlyLossLimitPct: 20,
      minLeverage: 2,
      maxLeverage: 5,
      maxStopLossPctOfMargin: 10,
      minNotionalPerTrade: 250,
      maxOrderAllocation: null,
      maxTotalAllocation: 70,
      maxAvgLeverage: 3,
    };
    const ruleDrafts = service.buildRuleEvaluationDrafts({
      snapshot: {
        portfolioEquity: 10000,
        grossExposure: 0,
      },
      route: {
        routeMode: 'fixed',
        brokerKey: 'mudrex',
        accountId: 'account-1',
        accountName: 'Mudrex Main',
      },
      order: {
        symbol: 'BTCUSDT',
        timeframe: '1h',
        side: 'BUY',
        orderType: 'market',
        timeInForce: null,
        quantityMode: 'notional',
        quantity: null,
        notional: 100,
        riskPercent: null,
        entryPrice: 100,
        stopLossPrice: 95,
        takeProfitTargets: [110],
        leverage: 1,
        reduceOnly: false,
      },
      coverage: {
        accountId: 'account-1',
      },
      freshness: {
        freshnessState: 'fresh',
        snapshotLagMinutes: 1,
        blocking: false,
        message: 'Risk snapshot freshness is within the expected decision window.',
      },
      globalThresholds: thresholds,
      routePolicyContext: {
        id: 'policy-context-1',
        enforceHardBlock: true,
      },
      routeThresholds: thresholds,
      accountSnapshot: {
        accountId: 'account-1',
        trackedBalance: 10000,
        grossExposure: 0,
      },
      brokerSnapshot: null,
      assetSnapshot: null,
      brokerAssetSnapshot: null,
      grossExposureDelta: 100,
      netExposureDelta: 100,
      openOrderExposureDelta: 100,
      reservedOrderMarginDelta: 100,
      notional: 100,
    });

    const minNotionalRule = ruleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'order_min_notional'
    );
    assert.equal(minNotionalRule?.status, 'critical');
    assert.equal(minNotionalRule?.blocking, true);
    assert.equal(minNotionalRule?.actualValue, 100);
    assert.equal(minNotionalRule?.criticalThresholdValue, 250);

    const minLeverageRule = ruleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'order_min_leverage'
    );
    assert.equal(minLeverageRule?.status, 'critical');
    assert.equal(minLeverageRule?.blocking, true);
    assert.equal(minLeverageRule?.actualValue, 1);
    assert.equal(minLeverageRule?.criticalThresholdValue, 2);

    const maxLeverageRule = ruleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'order_leverage'
    );
    assert.equal(maxLeverageRule?.status, 'ok');
    assert.equal(maxLeverageRule?.blocking, false);

    const stopLossMarginPassRule = ruleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'order_stop_loss_pct_of_margin'
    );
    assert.equal(stopLossMarginPassRule?.status, 'ok');
    assert.equal(stopLossMarginPassRule?.blocking, false);
    assert.equal(stopLossMarginPassRule?.actualValue, 5);
    assert.equal(stopLossMarginPassRule?.basisValue, 100);
    assert.equal(stopLossMarginPassRule?.criticalThresholdValue, 10);

    const futuresRuleDrafts = service.buildRuleEvaluationDrafts({
      snapshot: {
        portfolioEquity: 10000,
        grossExposure: 9000,
        reservedOrderMargin: 200,
      },
      route: {
        routeMode: 'fixed',
        brokerKey: 'mudrex',
        accountId: 'account-1',
        accountName: 'Mudrex Main',
      },
      order: {
        symbol: 'BTCUSDT',
        timeframe: '1h',
        side: 'BUY',
        orderType: 'market',
        timeInForce: null,
        quantityMode: 'notional',
        quantity: null,
        notional: 100,
        riskPercent: null,
        entryPrice: 100,
        stopLossPrice: 95,
        takeProfitTargets: [110],
        leverage: 10,
        reduceOnly: false,
      },
      coverage: {
        accountId: 'account-1',
      },
      freshness: {
        freshnessState: 'fresh',
        snapshotLagMinutes: 1,
        blocking: false,
        message: 'Risk snapshot freshness is within the expected decision window.',
      },
      globalThresholds: {
        ...thresholds,
        minLeverage: 1,
        minNotionalPerTrade: 100,
        maxOrderAllocation: 10,
        maxTotalAllocation: 70,
      },
      routePolicyContext: {
        id: 'policy-context-1',
        enforceHardBlock: true,
      },
      routeThresholds: {
        ...thresholds,
        minLeverage: 1,
        minNotionalPerTrade: 100,
        maxOrderAllocation: 10,
        maxTotalAllocation: 70,
      },
      accountSnapshot: {
        accountId: 'account-1',
        trackedBalance: 10000,
        grossExposure: 9000,
        reservedOrderMargin: 200,
      },
      brokerSnapshot: {
        brokerKey: 'mudrex',
        trackedBalance: 10000,
        grossExposure: 9000,
        reservedOrderMargin: 200,
      },
      assetSnapshot: {
        symbol: 'BTCUSDT',
        grossExposure: 9000,
        reservedOrderMargin: 200,
      },
      brokerAssetSnapshot: {
        brokerKey: 'mudrex',
        symbol: 'BTCUSDT',
        grossExposure: 9000,
        reservedOrderMargin: 200,
      },
      grossExposureDelta: 100,
      netExposureDelta: 100,
      openOrderExposureDelta: 100,
      reservedOrderMarginDelta: 10,
      notional: 100,
    });

    const portfolioMarginRule = futuresRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'portfolio_margin_usage'
    );
    assert.equal(portfolioMarginRule?.status, 'ok');
    assert.equal(portfolioMarginRule?.blocking, false);
    assert.equal(portfolioMarginRule?.actualValue, 2.1);

    const accountMarginRule = futuresRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'account_margin_usage'
    );
    assert.equal(accountMarginRule?.status, 'ok');
    assert.equal(accountMarginRule?.blocking, false);
    assert.equal(accountMarginRule?.actualValue, 2.1);

    const orderAllocationRule = futuresRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'order_allocation'
    );
    assert.equal(orderAllocationRule?.status, 'ok');
    assert.equal(orderAllocationRule?.blocking, false);
    assert.equal(orderAllocationRule?.actualValue, 0.1);

    const brokerAllocationRule = futuresRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'broker_total_allocation'
    );
    assert.equal(brokerAllocationRule?.status, 'ok');
    assert.equal(brokerAllocationRule?.blocking, false);
    assert.equal(brokerAllocationRule?.metricName, 'marginAllocationPct');
    assert.equal(brokerAllocationRule?.actualValue, 2.1);

    const assetConcentrationRule = futuresRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'asset_concentration'
    );
    assert.equal(assetConcentrationRule?.status, 'ok');
    assert.equal(assetConcentrationRule?.blocking, false);
    assert.equal(assetConcentrationRule?.metricName, 'marginConcentrationPct');
    assert.equal(assetConcentrationRule?.actualValue, 2.1);

    const brokerAssetConcentrationRule = futuresRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'broker_asset_concentration'
    );
    assert.equal(brokerAssetConcentrationRule?.status, 'ok');
    assert.equal(brokerAssetConcentrationRule?.blocking, false);
    assert.equal(brokerAssetConcentrationRule?.metricName, 'marginConcentrationPct');
    assert.equal(brokerAssetConcentrationRule?.actualValue, 2.1);

    const stopLossMarginBlockRule = futuresRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'order_stop_loss_pct_of_margin'
    );
    assert.equal(stopLossMarginBlockRule?.status, 'critical');
    assert.equal(stopLossMarginBlockRule?.blocking, true);
    assert.equal(stopLossMarginBlockRule?.actualValue, 50);
    assert.equal(stopLossMarginBlockRule?.basisValue, 10);
    assert.equal(stopLossMarginBlockRule?.criticalThresholdValue, 10);

    const marginBlockedRuleDrafts = service.buildRuleEvaluationDrafts({
      snapshot: {
        portfolioEquity: 10000,
        grossExposure: 9000,
        reservedOrderMargin: 6900,
      },
      route: {
        routeMode: 'fixed',
        brokerKey: 'mudrex',
        accountId: 'account-1',
        accountName: 'Mudrex Main',
      },
      order: {
        symbol: 'BTCUSDT',
        timeframe: '1h',
        side: 'BUY',
        orderType: 'market',
        timeInForce: null,
        quantityMode: 'notional',
        quantity: null,
        notional: 100,
        riskPercent: null,
        entryPrice: 100,
        stopLossPrice: 95,
        takeProfitTargets: [110],
        leverage: 10,
        reduceOnly: false,
      },
      coverage: {
        accountId: 'account-1',
      },
      freshness: {
        freshnessState: 'fresh',
        snapshotLagMinutes: 1,
        blocking: false,
        message: 'Risk snapshot freshness is within the expected decision window.',
      },
      globalThresholds: {
        ...thresholds,
        minLeverage: 1,
        minNotionalPerTrade: 100,
        maxOrderAllocation: 10,
        maxTotalAllocation: 70,
      },
      routePolicyContext: {
        id: 'policy-context-1',
        enforceHardBlock: true,
      },
      routeThresholds: {
        ...thresholds,
        minLeverage: 1,
        minNotionalPerTrade: 100,
        maxOrderAllocation: 10,
        maxTotalAllocation: 70,
      },
      accountSnapshot: {
        accountId: 'account-1',
        trackedBalance: 10000,
        grossExposure: 9000,
        reservedOrderMargin: 6900,
      },
      brokerSnapshot: {
        brokerKey: 'mudrex',
        trackedBalance: 10000,
        grossExposure: 9000,
        reservedOrderMargin: 6900,
      },
      assetSnapshot: {
        symbol: 'BTCUSDT',
        grossExposure: 100,
        reservedOrderMargin: 4400,
      },
      brokerAssetSnapshot: {
        brokerKey: 'mudrex',
        symbol: 'BTCUSDT',
        grossExposure: 100,
        reservedOrderMargin: 4400,
      },
      grossExposureDelta: 100,
      netExposureDelta: 100,
      openOrderExposureDelta: 100,
      reservedOrderMarginDelta: 200,
      notional: 100,
    });
    const marginBlockedBrokerRule = marginBlockedRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'broker_total_allocation'
    );
    assert.equal(marginBlockedBrokerRule?.status, 'critical');
    assert.equal(marginBlockedBrokerRule?.blocking, true);
    assert.equal(marginBlockedBrokerRule?.actualValue, 71);

    const marginBlockedAssetRule = marginBlockedRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'asset_concentration'
    );
    assert.equal(marginBlockedAssetRule?.status, 'critical');
    assert.equal(marginBlockedAssetRule?.blocking, true);
    assert.equal(marginBlockedAssetRule?.actualValue, 46);

    const marginBlockedBrokerAssetRule = marginBlockedRuleDrafts.find(
      (item: Record<string, unknown>) => item.ruleCode === 'broker_asset_concentration'
    );
    assert.equal(marginBlockedBrokerAssetRule?.status, 'critical');
    assert.equal(marginBlockedBrokerAssetRule?.blocking, true);
    assert.equal(marginBlockedBrokerAssetRule?.actualValue, 46);
  }

  async function runPreviewPreTradeCheckAssertions(): Promise<void> {
    const service = new RiskPreTradeService() as any;
    let createCheckCalled = false;

    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
    };
    service.riskRepository = {
      async getLatestSnapshot() {
        return {
          id: 'snapshot-1',
          createdAt: new Date('2026-04-09T10:00:00.000Z'),
          portfolioEquity: 10000,
          grossExposure: 1000,
          netExposure: 1000,
          openOrderExposure: 100,
          reservedOrderMargin: 200,
          portfolioRiskScore: 12,
          portfolioRisk: 'ok',
        };
      },
    };
    service.brokerAccountRepository = {
      async getBrokerAccountById(_userId: string, accountId: string) {
        assert.equal(accountId, 'account-1');
        return {
          id: 'account-1',
          brokerKey: 'mudrex',
          accountName: 'Mudrex Main',
        };
      },
    };
    service.riskAccountSnapshotRepository = {
      async listBySnapshotId() {
        return [
          {
            accountId: 'account-1',
            trackedBalance: 10000,
            grossExposure: 1000,
            netExposure: 1000,
            openOrderExposure: 100,
            reservedOrderMargin: 200,
            portfolioConcentrationPct: 10,
          },
        ];
      },
    };
    service.riskBrokerSnapshotRepository = {
      async listBySnapshotId() {
        return [
          {
            brokerKey: 'mudrex',
            trackedBalance: 10000,
            grossExposure: 1000,
            netExposure: 1000,
            openOrderExposure: 100,
            reservedOrderMargin: 200,
            riskScore: 8,
            riskState: 'ok',
          },
        ];
      },
    };
    service.riskAssetSnapshotRepository = {
      async listBySnapshotId() {
        return [
          {
            symbol: 'BTCUSDT',
            grossExposure: 400,
            netExposure: 400,
            openOrderExposure: 50,
            reservedOrderMargin: 80,
            riskScore: 6,
            riskState: 'ok',
          },
        ];
      },
    };
    service.riskBrokerAssetSnapshotRepository = {
      async listBySnapshotId() {
        return [
          {
            brokerKey: 'mudrex',
            symbol: 'BTCUSDT',
            grossExposure: 250,
            netExposure: 250,
            openOrderExposure: 25,
            reservedOrderMargin: 40,
            riskScore: 5,
            riskState: 'ok',
          },
        ];
      },
    };
    service.riskSnapshotPolicyContextRepository = {
      async listBySnapshotId() {
        return [
          {
            id: 'policy-context-1',
            policyId: 'policy-1',
            policyScope: 'broker',
            policyTargetKey: 'mudrex',
            monitorOnly: false,
            enforceHardBlock: true,
          },
        ];
      },
    };
    service.riskSnapshotSourceCoverageRepository = {
      async listBySnapshotId() {
        return [
          {
            accountId: 'account-1',
            latestSuccessWalletAvailable: true,
            latestSuccessFuturesAvailable: true,
            positionsObservedAt: new Date('2026-04-09T09:59:00.000Z'),
            latestPositionSnapshotSeenAt: new Date('2026-04-09T09:59:00.000Z'),
            latestPositionReadModelSeenAt: new Date('2026-04-09T09:59:00.000Z'),
            positionsCheckpointAt: new Date('2026-04-09T09:59:00.000Z'),
            openPositions: 1,
            positionTotalRows: 1,
            positionSnapshotRows: 1,
            positionReadModelRows: 1,
            rowsMissingFromReadModel: 0,
            rowsBehindSnapshot: 0,
            orphanReadModelRows: 0,
          },
        ];
      },
    };
    service.riskPolicyRepository = {
      async getEffectivePolicy() {
        return createPolicy({
          scope: 'broker',
          brokerKey: 'mudrex',
          minLeverage: 1,
          maxLeverage: 5,
          minNotionalPerTrade: 50,
          maxOrderAllocation: 25,
          maxTotalAllocation: 70,
        });
      },
    };
    service.riskRequestCheckRepository = {
      async createCheck() {
        createCheckCalled = true;
        throw new Error('previewPreTradeCheck must not persist request checks');
      },
    };
    service.riskRequestScopeImpactRepository = {
      async createScopeImpacts() {
        throw new Error('previewPreTradeCheck must not persist scope impacts');
      },
    };
    service.riskRequestRuleEvaluationRepository = {
      async createRuleEvaluations() {
        throw new Error('previewPreTradeCheck must not persist rule evaluations');
      },
    };

    const response = await service.previewPreTradeCheck('user-1', {
      sourceType: 'preview-test',
      executionMode: 'live',
      approvalMode: 'auto_if_safe',
      routing: {
        routeMode: 'fixed',
        brokerKey: 'mudrex',
        accountId: 'account-1',
      },
      order: {
        symbol: 'BTCUSDT',
        timeframe: '1h',
        side: 'BUY',
        orderType: 'market',
        quantityMode: 'notional',
        notional: 100,
        entryPrice: 100,
        stopLossPrice: 95,
        takeProfitTargets: [110],
        leverage: 2,
        reduceOnly: false,
      },
    });

    assert.equal(createCheckCalled, false);
    assert.equal(response.data.checkId.startsWith('preview:'), true);
    assert.equal(response.data.request.routing.brokerKey, 'mudrex');
    assert.equal(response.data.request.routing.accountId, 'account-1');
    assert.equal(response.data.decision.allowed, true);
    assert.equal(
      response.data.scopeImpacts.some(
        (item: { scopeType?: string; accountId?: string | null }) =>
          item.scopeType === 'account' && item.accountId === 'account-1'
      ),
      true
    );
  }

  async function runFundsBalanceExtractionAssertions(): Promise<void> {
    const service = createRiskService();

    assert.equal(
      service.extractFundsBalanceFromPayload(
        {
          balance: '145.3509',
          locked_amount: '201.5992',
          first_time_user: false,
        },
        'mudrex'
      ),
      346.95
    );
    assert.equal(
      service.extractFundsBalanceFromPayload(
        {
          balance: '145.3509',
          locked_amount: '201.5992',
          first_time_user: false,
        },
        'delta_exchange'
      ),
      145.3509
    );
    assert.equal(
      service.extractFundsBalanceFromPayload(
        {
          total_balance: '346.9501',
          balance: '145.3509',
          locked_amount: '201.5992',
        },
        'mudrex'
      ),
      346.9501
    );

    const deltaBreakdown = service.extractFundsBalanceBreakdown({
      broker_key: 'delta_exchange',
      futures_funds_json: JSON.stringify({
        balance: '119.55',
        locked_amount: '4.91',
      }),
      wallet_funds_json: null,
    });
    assert.equal(deltaBreakdown.trackedBalance, 119.55);
    assert.equal(deltaBreakdown.lockedMargin, 4.91);
  }

  async function runDeltaProtectiveOrderInferenceAssertions(): Promise<void> {
    const service = createRiskService();
    const account = {
      accountId: 'account-1',
      brokerKey: 'delta_exchange',
      accountName: 'Delta Production',
      fundsSnapshot: null,
      fundsCoverage: null,
      walletBalance: null,
      futuresBalance: 119.55,
      lockedMargin: 4.91,
      balance: 119.55,
      positions: [
        {
          symbol: 'EIGENUSD',
          side: 'Short',
          quantity: 565,
          positionSummary: {
            symbol: 'EIGENUSD',
            side: 'Short',
            quantity: 565,
          },
        },
      ],
      positionsFreshness: null,
      positionCoverage: null,
      thresholds: service.buildRiskThresholdProfile(null),
      policyContext: service.buildEffectiveRiskPolicyContext(null, 'delta_exchange'),
    };

    const snapshot = service.mapOpenOrderSnapshot(account, {
      externalId: 'order-1',
      payloadJson: JSON.stringify({
        symbol: 'EIGENUSD',
        side: 'buy',
        quantity: '565',
        price: '0.180336',
      }),
      firstSeenAt: new Date('2026-04-28T00:00:00.000Z'),
      lastSeenAt: new Date('2026-04-28T00:01:00.000Z'),
      statusRank: 1,
    });

    assert.equal(snapshot.reduceOnly, true);
  }

  async function runDeltaPreferredMarginAssertions(): Promise<void> {
    const service = createRiskService();
    const deltaAccount = {
      accountId: 'account-1',
      brokerKey: 'delta_exchange',
      accountName: 'Delta Production',
      fundsSnapshot: null,
      fundsCoverage: null,
      walletBalance: null,
      futuresBalance: 119.55,
      lockedMargin: 4.91,
      balance: 119.55,
      positions: [],
      positionsFreshness: null,
      positionCoverage: null,
      thresholds: service.buildRiskThresholdProfile(null),
      policyContext: service.buildEffectiveRiskPolicyContext(null, 'delta_exchange'),
    };

    const mudrexAccount = {
      ...deltaAccount,
      brokerKey: 'mudrex',
      lockedMargin: 4.91,
      policyContext: service.buildEffectiveRiskPolicyContext(null, 'mudrex'),
    };

    assert.equal(service.resolvePreferredAccountReservedMargin(deltaAccount, 298.25), 4.91);
    assert.equal(service.resolvePreferredAccountReservedMargin(mudrexAccount, 298.25), 298.25);
  }

  async function runPositionLeverageTruthAssertions(): Promise<void> {
    const service = createRiskService() as any;
    const account = {
      accountId: 'account-1',
      brokerKey: 'delta_exchange',
      accountName: 'Delta Production',
      fundsSnapshot: null,
      fundsCoverage: null,
      walletBalance: null,
      futuresBalance: 119.55,
      lockedMargin: 4.91,
      balance: 119.55,
      positions: [],
      positionsFreshness: null,
      positionCoverage: null,
      thresholds: service.buildRiskThresholdProfile(null),
      policyContext: service.buildEffectiveRiskPolicyContext(null, 'delta_exchange'),
    };

    const confirmedOrderPosition = {
      symbol: 'EIGENUSD',
      side: 'Short',
      quantity: 10,
      current_price: 10,
      leverage: 1,
      requested_leverage: 10,
      confirmed_order_leverage: 10,
      observed_position_leverage: null,
      leverage_source: 'confirmed_order_submission',
      positionSummary: {
        symbol: 'EIGENUSD',
        side: 'Short',
        quantity: 10,
        currentPrice: 10,
        leverage: 1,
        requestedLeverage: 10,
        confirmedOrderLeverage: 10,
        observedPositionLeverage: null,
        leverageSource: 'confirmed_order_submission',
      },
    };

    assert.equal(service.resolveEffectivePositionLeverage(confirmedOrderPosition), 10);

    const confirmedEvaluation = service.evaluatePositionRisk(confirmedOrderPosition, account, 500);
    assert.equal(confirmedEvaluation.leverage, 10);
    assert.equal(confirmedEvaluation.reservedMargin, 10);

    const brokerObservedPosition = {
      ...confirmedOrderPosition,
      leverage: 10,
      observed_position_leverage: 12,
      leverage_source: 'broker_position',
      positionSummary: {
        ...confirmedOrderPosition.positionSummary,
        leverage: 12,
        observedPositionLeverage: 12,
        leverageSource: 'broker_position',
      },
    };

    assert.equal(service.resolveEffectivePositionLeverage(brokerObservedPosition), 12);
  }

  async function main(): Promise<void> {
    await runRepositoryAssertions();
    await runCreatePolicyAssertions();
    await runDuplicateProtectionAssertions();
    await runPreTradeAssertions();
    await runSnapshotPreTradeThresholdAssertions();
    await runPreviewPreTradeCheckAssertions();
    await runFundsBalanceExtractionAssertions();
    await runDeltaProtectiveOrderInferenceAssertions();
    await runDeltaPreferredMarginAssertions();
    await runPositionLeverageTruthAssertions();
    console.log('Risk Center Phase 1 assertions passed.');
  }

  await main();
}

async function risk_centerGuard02(): Promise<void> {
  const { RiskOverviewService } = await import('../src/api/services/RiskOverviewService');

  function createSuccess<T>(data: T) {
    return { success: true as const, data };
  }

  async function runRiskOverviewTruthAssertions(): Promise<void> {
    const service = new RiskOverviewService() as any;
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
    };

    service.riskService = {
      async getRiskSummary() {
        return createSuccess({
          portfolioRisk: 'Watch',
          breachedRules: 1,
          liquidationWatch: 0,
          capitalAtRisk: 3200,
          drawdownBudgetUsed: '18%',
        });
      },
      async getRiskControls() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskScenarios() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskAlerts() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskPolicies() {
        return createSuccess({ items: [], total: 0 });
      },
    };

    service.riskRepository = {
      async getLatestSnapshot() {
        return {
          drawdownBudgetUsed: '18%',
          createdAt: new Date('2026-04-09T10:00:00.000Z'),
        };
      },
    };
    service.riskControlRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-09T10:18:00.000Z');
      },
    };
    service.riskAlertRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-09T10:19:00.000Z');
      },
    };
    service.riskScenarioRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-09T10:20:00.000Z');
      },
    };

    service.brokerDefinitionService = {
      async listActiveDefinitions() {
        return [
          { brokerKey: 'mudrex', name: 'Mudrex' },
          { brokerKey: 'delta_exchange', name: 'Delta Exchange' },
        ];
      },
    };

    service.brokerAccountRepository = {
      async getConnectedBrokerAccounts() {
        return [
          {
            id: 'mudrex-1',
            brokerKey: 'mudrex',
            accountName: 'Mudrex Prime',
          },
          {
            id: 'mudrex-2',
            brokerKey: 'mudrex',
            accountName: 'Mudrex Secondary',
          },
          {
            id: 'delta-1',
            brokerKey: 'delta_exchange',
            accountName: 'Delta Main',
          },
        ];
      },
    };

    service.fundsSnapshotRepository = {
      async getLatestSnapshot(_userId: string, brokerKey: string, accountId: string) {
        const key = `${String(brokerKey).toLowerCase()}::${accountId}`;
        if (key === 'mudrex::mudrex-1') {
          return {
            futures_funds_json: JSON.stringify({ balance: 2000 }),
            wallet_funds_json: null,
            computed_at: new Date('2026-04-09T10:10:00.000Z'),
            created_at: new Date('2026-04-09T10:10:00.000Z'),
          };
        }
        if (key === 'delta_exchange::delta-1') {
          return {
            futures_funds_json: null,
            wallet_funds_json: JSON.stringify({ total: 300 }),
            computed_at: new Date('2026-04-09T09:45:00.000Z'),
            created_at: new Date('2026-04-09T09:45:00.000Z'),
          };
        }
        return null;
      },
    };

    service.positionSnapshotRepository = {
      async getAccountOpenPositionSummary() {
        return new Map([
          [
            'mudrex-1',
            {
              accountId: 'mudrex-1',
              openPositions: 3,
              observedAt: new Date('2026-04-09T10:11:00.000Z'),
              hasSnapshotHistory: true,
            },
          ],
          [
            'mudrex-2',
            {
              accountId: 'mudrex-2',
              openPositions: 0,
              observedAt: new Date('2026-04-09T10:12:00.000Z'),
              hasSnapshotHistory: true,
            },
          ],
        ]);
      },
    };

    service.activityExportRepository = {
      async listExports() {
        return {
          items: [
            {
              id: 'export-risk-1',
              status: 'Ready',
              fileName: 'risk-activity.csv',
              createdAt: new Date('2026-04-09T10:20:00.000Z'),
              expiresAt: new Date('2026-04-16T10:20:00.000Z'),
              filters: {
                route: 'Risk',
              },
            },
          ],
          total: 1,
        };
      },
    };

    const response = await service.getOverview('user-1', {});

    assert.equal(response.data.meta.contractVersion, 'risk-center-phase9-2026-04-09');
    assert.equal(
      response.data.meta.summary,
      'Phase 9 makes the `/risk-center` activity trail operational: operators can filter the in-page risk feed, queue exports from the current trail posture, and see retention cues before handing off into the full Activity workspace.'
    );
    assert.equal(response.data.meta.capabilities.liveBrokerKpis, false);
    assert.equal(response.data.meta.capabilities.policyRollback, true);
    assert.equal(response.data.meta.capabilities.snapshotBrokerKpis, true);
    assert.equal(response.data.meta.capabilities.weeklyMonthlyRiskWindowUsage, false);
    assert.equal(response.data.meta.capabilities.riskActivityTrailUsedByPage, true);
    assert.equal(response.data.meta.capabilities.riskActivityTrailFiltersUsedByPage, true);
    assert.equal(response.data.meta.capabilities.riskActivityTrailExportsUsedByPage, true);
    assert.equal(response.data.meta.capabilities.pageModulesSplitByConcern, true);
    assert.equal(response.data.meta.capabilities.workspaceFocusBannerUsedByPage, true);
    assert.equal(response.data.meta.capabilities.policyReviewWorkflow, true);
    assert.deepEqual(response.data.meta.freshness, {
      state: 'lagging',
      blockers: [
        'missing_funds_snapshot_coverage',
        'missing_positions_snapshot_coverage',
        'risk_snapshot_behind_sources',
      ],
      connectedAccountCount: 3,
      fundsAccountsWithSnapshot: 2,
      positionsAccountsWithSnapshot: 2,
      latestRiskSnapshotAt: '2026-04-09T10:00:00.000+00:00',
      latestRiskSnapshotAtIso: '2026-04-09T10:00:00.000Z',
      latestFundsObservedAt: '2026-04-09T10:10:00.000+00:00',
      latestFundsObservedAtIso: '2026-04-09T10:10:00.000Z',
      latestPositionsObservedAt: '2026-04-09T10:12:00.000+00:00',
      latestPositionsObservedAtIso: '2026-04-09T10:12:00.000Z',
      latestControlAt: '2026-04-09T10:18:00.000+00:00',
      latestControlAtIso: '2026-04-09T10:18:00.000Z',
      latestAlertAt: '2026-04-09T10:19:00.000+00:00',
      latestAlertAtIso: '2026-04-09T10:19:00.000Z',
      latestScenarioAt: '2026-04-09T10:20:00.000+00:00',
      latestScenarioAtIso: '2026-04-09T10:20:00.000Z',
      snapshotLagMinutes: 12,
    });
    assert.deepEqual(response.data.meta.lineage, {
      summary: 'risk_snapshots_latest',
      riskWindows: 'risk_snapshots_latest_with_explicit_unavailable_windows',
      brokerCoverage: 'funds_snapshots_plus_position_read_models_for_connected_accounts',
      recomputeWrites: ['risk_snapshots', 'risk_controls', 'risk_alerts', 'risk_scenarios'],
    });
    assert.deepEqual(response.data.meta.pageTruth, {
      riskWindowSource: 'latest_risk_snapshot_with_explicit_unavailable_windows',
      brokerCoverageSource: 'snapshot_backed_connected_brokers',
      policyWorkspace: 'selected_rule_with_pending_review_history_controls',
      policyGovernance: 'manual_review_for_sensitive_policy_mutations',
      activityTrailSource: 'activity_logs_route_and_reference_filters',
      activityTrailControls: 'in_page_filters_export_and_retention_cues',
      alertHandoff: 'alerts_workspace_symbol_search',
      workspaceStructure: 'focus_coverage_policy_activity_modules',
    });
    assert.equal(
      response.data.activityTrail.exportHistoryPath,
      '/activity?panel=exports&route=Risk'
    );
    assert.equal(response.data.activityTrail.exportRetentionDays, 7);
    assert.equal(response.data.activityTrail.latestExport?.exportId, 'export-risk-1');

    const [dailyWindow, weeklyWindow, monthlyWindow] = response.data.riskWindows;
    assert.equal(dailyWindow.key, 'daily');
    assert.equal(dailyWindow.usedPct, 18);
    assert.equal(dailyWindow.availability, 'snapshot');
    assert.equal(weeklyWindow.availability, 'unavailable');
    assert.equal(monthlyWindow.availability, 'unavailable');

    const deltaItem = response.data.brokers.items.find(
      (item: RiskBrokerOverviewItem) => item.brokerKey === 'delta_exchange'
    );
    assert.deepEqual(deltaItem, {
      brokerKey: 'delta_exchange',
      brokerName: 'Delta Exchange',
      connectedAccountCount: 1,
      snapshotAvailability: 'partial',
      fundsBalance: {
        value: 300,
        availability: 'snapshot',
        observedAt: '2026-04-09T09:45:00.000+00:00',
        observedAtIso: '2026-04-09T09:45:00.000Z',
        sourceLabel: 'Latest funds snapshot',
      },
      openPositions: {
        value: null,
        availability: 'unavailable',
        observedAt: null,
        observedAtIso: null,
        sourceLabel: 'Latest positions snapshot',
      },
      note: 'Snapshot coverage is partial: funds 1/1, positions 0/1.',
    });

    const mudrexItem = response.data.brokers.items.find(
      (item: RiskBrokerOverviewItem) => item.brokerKey === 'mudrex'
    );
    assert.deepEqual(mudrexItem, {
      brokerKey: 'mudrex',
      brokerName: 'Mudrex',
      connectedAccountCount: 2,
      snapshotAvailability: 'partial',
      fundsBalance: {
        value: 2000,
        availability: 'snapshot',
        observedAt: '2026-04-09T10:10:00.000+00:00',
        observedAtIso: '2026-04-09T10:10:00.000Z',
        sourceLabel: 'Latest funds snapshot',
      },
      openPositions: {
        value: 3,
        availability: 'snapshot',
        observedAt: '2026-04-09T10:12:00.000+00:00',
        observedAtIso: '2026-04-09T10:12:00.000Z',
        sourceLabel: 'Latest positions snapshot',
      },
      note: 'Snapshot coverage is partial: funds 1/2, positions 2/2.',
    });
  }

  async function main(): Promise<void> {
    await runRiskOverviewTruthAssertions();
    console.log('Risk Center Phase 2 assertions passed.');
  }

  await main();
}

async function risk_centerGuard04(): Promise<void> {
  const { RiskService } = await import('../src/api/services/RiskService');

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
      minLeverage: 1,
      maxLeverage: 5,
      minNotionalPerTrade: 100,
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
        minLeverage: 1,
        maxLeverage: 5,
        minNotionalPerTrade: 100,
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
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
    };
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
    assert.equal(
      response.data.items[0].links.activityPath,
      '/activity?route=Risk&referenceId=policy-1'
    );
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
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
    };
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

  await main();
}

async function risk_centerGuard05(): Promise<void> {
  const { BadRequestAppError } = await import('../src/api/errors/AppError');
  const { BrokerOrdersFacadeService } =
    await import('../src/api/services/BrokerOrdersFacadeService');
  const { RemoveRiskCenterTables1763800000000 } =
    await import('./_fixtures/migrations/1763800000000-RemoveRiskCenterTables');
  const { RestoreRiskCenterTables1763800001000 } =
    await import('./_fixtures/migrations/1763800001000-RestoreRiskCenterTables');
  const { HardenRiskPolicyTargetIntegrity1770600000000 } =
    await import('./_fixtures/migrations/1770600000000-HardenRiskPolicyTargetIntegrity');

  function createOrderBody(overrides: Record<string, unknown> = {}) {
    return {
      brokerKey: 'mudrex',
      accountId: 'acct-1',
      symbol: 'BTCUSDT',
      side: 'long',
      execution_mode: 'live',
      leverage: 6,
      quantity: 1,
      order_price: 100,
      order_type: 'market',
      trigger_type: 'manual',
      is_takeprofit: false,
      is_stoploss: false,
      stoploss_price: 90,
      takeprofit_price: 120,
      reduce_only: false,
      ...overrides,
    };
  }

  function createRoute(overrides: Record<string, unknown> = {}) {
    return {
      brokerKey: 'mudrex',
      accountId: 'acct-1',
      ...overrides,
    };
  }

  function createMigrationQueryRunner(options: {
    hasTable?: Record<string, boolean>;
    hasColumn?: Record<string, boolean>;
    indexExists?: boolean;
    duplicateTargets?: Array<{
      user_id?: string;
      normalized_target_key?: string;
    }>;
  }) {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];

    const queryRunner = {
      async hasTable(tableName: string) {
        return options.hasTable?.[tableName] ?? false;
      },
      async hasColumn(tableName: string, columnName: string) {
        return options.hasColumn?.[`${tableName}.${columnName}`] ?? false;
      },
      async query(sql: string, params?: unknown[]) {
        queries.push({ sql, params });

        if (sql.includes('SHOW INDEX FROM risk_policies WHERE Key_name = ?')) {
          return options.indexExists ? [{ Key_name: 'uidx_risk_policies_user_target_key' }] : [];
        }

        if (sql.includes('HAVING normalized_target_key IS NOT NULL AND duplicate_count > 1')) {
          return options.duplicateTargets || [];
        }

        return [];
      },
    };

    return { queryRunner, queries };
  }

  async function runBlockedOrderActivityAssertions(): Promise<void> {
    const service = new BrokerOrdersFacadeService() as any;
    const activities: Array<Record<string, unknown>> = [];
    const alerts: Array<Record<string, unknown>> = [];
    let adapterCalls = 0;

    service.brokerAccountRoutingService = {
      async resolve() {
        return createRoute();
      },
    };
    service.riskService = {
      async evaluatePreTradeOrder() {
        return {
          blocked: true,
          breaches: ['Max leverage 6 exceeds policy limit 3'],
          reason: 'Max leverage 6 exceeds policy limit 3',
          policyId: 'policy-1',
        };
      },
    };
    service.riskPreTradeService = {
      async createPreTradeCheck() {
        return {
          success: true,
          data: {
            checkId: 'pretrade-pass-1',
            status: 'passed',
            decision: {
              allowed: true,
              blocked: false,
              approvalRequired: false,
              blockingRuleCount: 0,
              warningRuleCount: 0,
              summary: 'Pre-trade check passed.',
            },
          },
        };
      },
    };
    service.riskKillSwitchService = {
      async assertLiveTradingAllowed() {
        return undefined;
      },
    };
    service.operationalEventService = {
      async logActivity(_userId: string, payload: Record<string, unknown>) {
        activities.push(payload);
      },
      async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
        alerts.push(payload);
      },
    };
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createOrder() {
            adapterCalls += 1;
            return { ok: true };
          },
        };
      },
    };

    await assert.rejects(
      service.createFuturesOrder('user-1', 'asset-1', createOrderBody()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, new BadRequestAppError('x').name);
        assert.equal(error.message, 'Max leverage 6 exceeds policy limit 3');
        return true;
      }
    );

    assert.equal(adapterCalls, 0);
    assert.equal(activities.length, 2);
    assert.equal(alerts.length, 2);

    const riskActivity = activities.find((item) => item.title === 'Order blocked by risk policy');
    assert.deepEqual(riskActivity, {
      type: 'Risk control',
      title: 'Order blocked by risk policy',
      status: 'Failed',
      route: 'Risk',
      stream: 'Controls',
      related: 'mudrex · acct-1',
      referenceId: 'policy-1',
      correlationId: 'mudrex · acct-1',
      description: 'Max leverage 6 exceeds policy limit 3 (policy policy-1)',
    });

    const orderFailureActivity = activities.find((item) => item.title === 'Order create failed');
    assert.deepEqual(orderFailureActivity, {
      type: 'Order',
      title: 'Order create failed',
      status: 'Failed',
      route: 'Orders',
      stream: 'Execution',
      related: 'mudrex · acct-1',
      correlationId: 'mudrex · acct-1',
      description: 'Max leverage 6 exceeds policy limit 3',
    });

    assert.deepEqual(alerts[0], {
      channel: 'Risk',
      source: 'mudrex',
      message: 'Max leverage 6 exceeds policy limit 3',
      route: 'Risk review',
    });
    assert.deepEqual(alerts[1], {
      channel: 'Trading',
      source: 'mudrex',
      message: 'Order create failed: Max leverage 6 exceeds policy limit 3',
      route: 'Risk review',
    });
  }

  async function runWarningOrderActivityAssertions(): Promise<void> {
    const service = new BrokerOrdersFacadeService() as any;
    const activities: Array<Record<string, unknown>> = [];
    const alerts: Array<Record<string, unknown>> = [];
    let adapterCalls = 0;

    service.brokerAccountRoutingService = {
      async resolve() {
        return createRoute();
      },
    };
    service.riskService = {
      async evaluatePreTradeOrder() {
        return {
          blocked: false,
          breaches: ['Max leverage 6 exceeds policy limit 3'],
          reason: null,
          policyId: 'policy-1',
        };
      },
    };
    service.riskPreTradeService = {
      async createPreTradeCheck() {
        return {
          success: true,
          data: {
            checkId: 'pretrade-pass-2',
            status: 'passed',
            decision: {
              allowed: true,
              blocked: false,
              approvalRequired: false,
              blockingRuleCount: 0,
              warningRuleCount: 0,
              summary: 'Pre-trade check passed.',
            },
          },
        };
      },
    };
    service.riskKillSwitchService = {
      async assertLiveTradingAllowed() {
        return undefined;
      },
    };
    service.operationalEventService = {
      async logActivity(_userId: string, payload: Record<string, unknown>) {
        activities.push(payload);
      },
      async emitFailureAlert(_userId: string, payload: Record<string, unknown>) {
        alerts.push(payload);
      },
    };
    service.brokerRuntimeRegistry = {
      getOrdersAdapter() {
        return {
          async createOrder() {
            adapterCalls += 1;
            return {
              order_id: 'ext-1',
              status: 'OPEN',
            };
          },
        };
      },
    };
    service.suggestedTradesService = {
      async assertLiveOrderFreshnessForSuggestedTrade() {
        return undefined;
      },
      async linkSuggestedTradeOrder() {
        return undefined;
      },
      async syncExecutionForPaperOrderUpdates() {
        return undefined;
      },
    };

    const response = await service.createFuturesOrder('user-1', 'asset-1', createOrderBody());

    assert.equal(adapterCalls, 1);
    assert.equal((response as Record<string, unknown>).order_id, 'ext-1');
    assert.equal(activities.length, 2);
    assert.equal(alerts.length, 0);

    const warningActivity = activities.find(
      (item) => item.title === 'Order submitted with risk warnings'
    );
    assert.deepEqual(warningActivity, {
      type: 'Risk control',
      title: 'Order submitted with risk warnings',
      status: 'In progress',
      route: 'Risk',
      stream: 'Controls',
      related: 'mudrex · acct-1',
      referenceId: 'policy-1',
      correlationId: 'mudrex · acct-1',
      description: 'Max leverage 6 exceeds policy limit 3 (policy policy-1)',
    });

    const orderCreatedActivity = activities.find((item) => item.title === 'Order created: asset-1');
    assert.deepEqual(orderCreatedActivity, {
      type: 'Order',
      title: 'Order created: asset-1',
      status: 'Success',
      route: 'Orders',
      stream: 'Execution',
      related: 'mudrex · acct-1',
      referenceId: 'ext-1',
      correlationId: 'ext-1',
      description: 'Order placed via mudrex',
    });
  }

  async function runMigrationHygieneAssertions(): Promise<void> {
    const removeMigration = new RemoveRiskCenterTables1763800000000();
    const removeRunner = createMigrationQueryRunner({
      hasTable: {
        risk_policies: true,
      },
      hasColumn: {
        'risk_policies.liquidation_buffer_warn_pct': true,
        'risk_policies.liquidation_buffer_critical_pct': true,
        'risk_policies.drawdown_warn_pct': true,
        'risk_policies.drawdown_critical_pct': true,
      },
    });

    await removeMigration.up(removeRunner.queryRunner as any);

    assert.ok(
      removeRunner.queries.some(({ sql }) =>
        sql.includes('ALTER TABLE risk_policies DROP COLUMN liquidation_buffer_warn_pct')
      )
    );
    assert.ok(
      removeRunner.queries.some(({ sql }) => sql.includes('DROP TABLE IF EXISTS risk_controls'))
    );
    assert.ok(
      removeRunner.queries.some(({ sql }) =>
        sql.includes('DROP TABLE IF EXISTS risk_capacity_snapshots')
      )
    );

    const restoreMigration = new RestoreRiskCenterTables1763800001000();
    const restoreRunner = createMigrationQueryRunner({
      hasTable: {
        risk_controls: false,
        risk_alerts: false,
        risk_scenarios: false,
      },
    });

    await restoreMigration.up(restoreRunner.queryRunner as any);

    const restoreControlsSql =
      restoreRunner.queries.find(({ sql }) =>
        sql.includes('CREATE TABLE IF NOT EXISTS risk_controls')
      )?.sql || '';
    const restoreAlertsSql =
      restoreRunner.queries.find(({ sql }) =>
        sql.includes('CREATE TABLE IF NOT EXISTS risk_alerts')
      )?.sql || '';
    const restoreScenariosSql =
      restoreRunner.queries.find(({ sql }) =>
        sql.includes('CREATE TABLE IF NOT EXISTS risk_scenarios')
      )?.sql || '';

    assert.ok(restoreControlsSql.includes('user_id varchar(191) NOT NULL'));
    assert.ok(
      restoreControlsSql.includes('CONSTRAINT FK_risk_controls_USER_ID FOREIGN KEY (user_id)')
    );
    assert.ok(restoreAlertsSql.includes('user_id varchar(191) NOT NULL'));
    assert.ok(restoreAlertsSql.includes('CONSTRAINT FK_risk_alerts_USER_ID FOREIGN KEY (user_id)'));
    assert.ok(restoreScenariosSql.includes('user_id varchar(191) NOT NULL'));

    const hardenMigration = new HardenRiskPolicyTargetIntegrity1770600000000();
    const hardenRunner = createMigrationQueryRunner({
      hasTable: {
        risk_policies: true,
      },
      hasColumn: {
        'risk_policies.normalized_target_key': false,
      },
      indexExists: false,
    });

    await hardenMigration.up(hardenRunner.queryRunner as any);

    assert.ok(
      hardenRunner.queries.some(({ sql }) => sql.includes('SET scope = LOWER(TRIM(scope))'))
    );
    assert.ok(
      hardenRunner.queries.some(({ sql }) =>
        sql.includes('ADD COLUMN normalized_target_key varchar(255)')
      )
    );
    assert.ok(
      hardenRunner.queries.some(({ sql }) =>
        sql.includes('CREATE UNIQUE INDEX uidx_risk_policies_user_target_key')
      )
    );

    const hardenDownRunner = createMigrationQueryRunner({
      hasTable: {
        risk_policies: true,
      },
      hasColumn: {
        'risk_policies.normalized_target_key': true,
      },
      indexExists: true,
    });

    await hardenMigration.down(hardenDownRunner.queryRunner as any);

    assert.ok(
      hardenDownRunner.queries.some(({ sql }) =>
        sql.includes('DROP INDEX uidx_risk_policies_user_target_key ON risk_policies')
      )
    );
    assert.ok(
      hardenDownRunner.queries.some(({ sql }) =>
        sql.includes('ALTER TABLE risk_policies DROP COLUMN normalized_target_key')
      )
    );

    const duplicateRunner = createMigrationQueryRunner({
      hasTable: {
        risk_policies: true,
      },
      hasColumn: {
        'risk_policies.normalized_target_key': false,
      },
      duplicateTargets: [
        {
          user_id: 'user-1',
          normalized_target_key: 'broker::mudrex',
        },
      ],
    });

    await assert.rejects(
      hardenMigration.up(duplicateRunner.queryRunner as any),
      /Cannot harden risk policy targets because duplicate owner-scoped targets already exist: user-1:broker::mudrex/
    );
    assert.equal(
      duplicateRunner.queries.some(({ sql }) =>
        sql.includes('CREATE UNIQUE INDEX uidx_risk_policies_user_target_key')
      ),
      false
    );
  }

  async function main(): Promise<void> {
    await runBlockedOrderActivityAssertions();
    await runWarningOrderActivityAssertions();
    await runMigrationHygieneAssertions();
    console.log('Risk Center Phase 5 assertions passed.');
  }

  await main();
}

async function risk_centerGuard06(): Promise<void> {
  const { RiskOverviewService } = await import('../src/api/services/RiskOverviewService');
  const { buildApiTimeContract, formatApiDisplayTime } =
    await import('../src/api/utils/apiTimeContract');

  function createSuccess<T>(data: T) {
    return { success: true as const, data };
  }

  async function runRiskFreshnessAlignmentAssertions(): Promise<void> {
    const service = new RiskOverviewService() as any;
    const timeZone = 'Asia/Calcutta';

    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };

    service.riskService = {
      async getRiskSummary() {
        return createSuccess({
          portfolioRisk: 'Watch',
          drawdownBudgetUsed: '16%',
        });
      },
      async getRiskControls() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskScenarios() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskAlerts() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskPolicies() {
        return createSuccess({ items: [], total: 0 });
      },
    };

    service.brokerDefinitionService = {
      async listActiveDefinitions() {
        return [{ brokerKey: 'mudrex', name: 'Mudrex' }];
      },
    };

    service.brokerAccountRepository = {
      async getConnectedBrokerAccounts() {
        return [
          { id: 'acc-1', brokerKey: 'mudrex', accountName: 'Mudrex Prime' },
          { id: 'acc-2', brokerKey: 'mudrex', accountName: 'Mudrex Backup' },
        ];
      },
    };

    service.riskRepository = {
      async getLatestSnapshot() {
        return {
          drawdownBudgetUsed: '16%',
          createdAt: new Date('2026-04-10T09:55:00.000Z'),
        };
      },
    };

    service.riskControlRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-10T09:57:00.000Z');
      },
    };

    service.riskAlertRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-10T09:58:00.000Z');
      },
    };

    service.riskScenarioRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-10T09:59:00.000Z');
      },
    };

    service.fundsSnapshotRepository = {
      async getLatestSnapshot() {
        return {
          futures_funds_json: JSON.stringify({ balance: 1200 }),
          wallet_funds_json: null,
          computed_at: new Date('2026-04-10T09:54:00.000Z'),
          created_at: new Date('2026-04-10T09:54:00.000Z'),
        };
      },
    };

    service.positionSnapshotRepository = {
      async getAccountOpenPositionSummary() {
        return new Map([
          [
            'acc-1',
            {
              accountId: 'acc-1',
              openPositions: 1,
              observedAt: new Date('2026-04-10T09:53:00.000Z'),
              hasSnapshotHistory: true,
            },
          ],
          [
            'acc-2',
            {
              accountId: 'acc-2',
              openPositions: 0,
              observedAt: new Date('2026-04-10T09:52:00.000Z'),
              hasSnapshotHistory: true,
            },
          ],
        ]);
      },
    };

    service.activityExportRepository = {
      async listExports() {
        return { items: [], total: 0 };
      },
    };

    const response = await service.getOverview('user-1', {});

    assert.deepEqual(response.data.time, buildApiTimeContract(timeZone));
    assert.deepEqual(response.data.meta.freshness, {
      state: 'fresh',
      blockers: [],
      connectedAccountCount: 2,
      fundsAccountsWithSnapshot: 2,
      positionsAccountsWithSnapshot: 2,
      latestRiskSnapshotAt: formatApiDisplayTime('2026-04-10T09:55:00.000Z', timeZone),
      latestRiskSnapshotAtIso: '2026-04-10T09:55:00.000Z',
      latestFundsObservedAt: formatApiDisplayTime('2026-04-10T09:54:00.000Z', timeZone),
      latestFundsObservedAtIso: '2026-04-10T09:54:00.000Z',
      latestPositionsObservedAt: formatApiDisplayTime('2026-04-10T09:53:00.000Z', timeZone),
      latestPositionsObservedAtIso: '2026-04-10T09:53:00.000Z',
      latestControlAt: formatApiDisplayTime('2026-04-10T09:57:00.000Z', timeZone),
      latestControlAtIso: '2026-04-10T09:57:00.000Z',
      latestAlertAt: formatApiDisplayTime('2026-04-10T09:58:00.000Z', timeZone),
      latestAlertAtIso: '2026-04-10T09:58:00.000Z',
      latestScenarioAt: formatApiDisplayTime('2026-04-10T09:59:00.000Z', timeZone),
      latestScenarioAtIso: '2026-04-10T09:59:00.000Z',
      snapshotLagMinutes: null,
    });
    assert.deepEqual(response.data.meta.lineage, {
      summary: 'risk_snapshots_latest',
      riskWindows: 'risk_snapshots_latest_with_explicit_unavailable_windows',
      brokerCoverage: 'funds_snapshots_plus_position_read_models_for_connected_accounts',
      recomputeWrites: ['risk_snapshots', 'risk_controls', 'risk_alerts', 'risk_scenarios'],
    });
  }

  async function main(): Promise<void> {
    await runRiskFreshnessAlignmentAssertions();
    console.log('Risk Center Phase 6 assertions passed.');
  }

  await main();
}

async function risk_centerGuard08(): Promise<void> {
  const { RiskService } = await import('../src/api/services/RiskService');

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
      minLeverage: 1,
      maxLeverage: 5,
      minNotionalPerTrade: 100,
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
          minLeverage: 1,
          maxLeverage: 2,
          minNotionalPerTrade: 100,
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
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
    };
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
    assert.equal(response.data.versionId ?? response.data.pendingVersionId, 'ver-pending-1');
    assert.equal(response.data.applied, false);
    assert.equal(response.data.approvalMode, 'manual_review');
    assert.equal(response.data.approvalState, 'pending_review');
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
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
    };
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
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
    };
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
    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return 'UTC';
      },
    };

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

  await main();
}

async function risk_centerGuard09(): Promise<void> {
  const { RiskOverviewService } = await import('../src/api/services/RiskOverviewService');
  const { formatApiDisplayTime } = await import('../src/api/utils/apiTimeContract');

  function createSuccess<T>(data: T) {
    return { success: true as const, data };
  }

  async function runRiskActivityTrailAssertions(): Promise<void> {
    const service = new RiskOverviewService() as any;
    const timeZone = 'Asia/Calcutta';

    service.userTimeZoneService = {
      async resolveUserTimeZone() {
        return timeZone;
      },
    };

    service.riskService = {
      async getRiskSummary() {
        return createSuccess({
          portfolioRisk: 'Watch',
          breachedRules: 0,
          liquidationWatch: 0,
          capitalAtRisk: 1250,
          drawdownBudgetUsed: '12%',
        });
      },
      async getRiskControls() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskScenarios() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskAlerts() {
        return createSuccess({ items: [], total: 0, limit: 10, offset: 0 });
      },
      async getRiskPolicies() {
        return createSuccess({ items: [], total: 0 });
      },
    };

    service.riskRepository = {
      async getLatestSnapshot() {
        return {
          drawdownBudgetUsed: '12%',
          createdAt: new Date('2026-04-09T10:00:00.000Z'),
        };
      },
    };
    service.riskControlRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-09T10:10:00.000Z');
      },
    };
    service.riskAlertRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-09T10:11:00.000Z');
      },
    };
    service.riskScenarioRepository = {
      async getLatestCreatedAtForUsers() {
        return new Date('2026-04-09T10:12:00.000Z');
      },
    };

    service.brokerDefinitionService = {
      async listActiveDefinitions() {
        return [{ brokerKey: 'mudrex', name: 'Mudrex' }];
      },
    };

    service.brokerAccountRepository = {
      async getConnectedBrokerAccounts() {
        return [{ id: 'mudrex-1', brokerKey: 'mudrex', accountName: 'Mudrex Prime' }];
      },
    };

    service.fundsSnapshotRepository = {
      async getLatestSnapshot() {
        return null;
      },
    };

    service.positionSnapshotRepository = {
      async getAccountOpenPositionSummary() {
        return new Map();
      },
    };

    service.activityExportRepository = {
      async listExports(userId: string, query: { limit: number; offset: number }) {
        assert.equal(userId, 'user-1');
        assert.deepEqual(query, { limit: 10, offset: 0 });
        return {
          items: [
            {
              id: 'export-orders-1',
              status: 'Ready',
              fileName: 'orders.csv',
              createdAt: new Date('2026-04-09T11:00:00.000Z'),
              expiresAt: new Date('2026-04-16T11:00:00.000Z'),
              filters: { route: 'Orders' },
            },
            {
              id: 'export-risk-2',
              status: 'Queued',
              fileName: 'risk-queued.csv',
              createdAt: new Date('2026-04-09T10:45:00.000Z'),
              expiresAt: null,
              filters: { route: 'Risk', referenceId: 'policy-1' },
            },
            {
              id: 'export-risk-1',
              status: 'Ready',
              fileName: 'risk-ready.csv',
              createdAt: new Date('2026-04-09T10:30:00.000Z'),
              expiresAt: new Date('2026-04-16T10:30:00.000Z'),
              filters: { route: 'Risk' },
            },
          ],
          total: 3,
        };
      },
    };

    const response = await service.getOverview('user-1', {});

    assert.deepEqual(response.data.activityTrail.defaultFilters, {
      route: 'Risk',
      readState: 'all',
    });
    assert.deepEqual(response.data.activityTrail.supportedFilters, [
      'stream',
      'status',
      'readState',
    ]);
    assert.deepEqual(response.data.activityTrail.streamOptions, [
      { value: 'all', label: 'All streams' },
      { value: 'Policies', label: 'Policy lifecycle' },
      { value: 'Controls', label: 'Enforcement' },
    ]);
    assert.equal(
      response.data.activityTrail.exportHistoryPath,
      '/activity?panel=exports&route=Risk'
    );
    assert.equal(response.data.activityTrail.exportFormat, 'csv');
    assert.equal(response.data.activityTrail.exportRetentionDays, 7);
    assert.equal(
      response.data.activityTrail.exportRetentionLabel,
      'Exports from this trail are retained for 7 days.'
    );
    assert.deepEqual(response.data.activityTrail.latestExport, {
      exportId: 'export-risk-2',
      status: 'Queued',
      fileName: 'risk-queued.csv',
      createdAt: formatApiDisplayTime('2026-04-09T10:45:00.000Z', timeZone),
      createdAtIso: '2026-04-09T10:45:00.000Z',
      expiresAt: null,
      expiresAtIso: null,
      filters: { route: 'Risk', referenceId: 'policy-1' },
      downloadPath: undefined,
    });
  }

  async function main(): Promise<void> {
    await runRiskActivityTrailAssertions();
    console.log('Risk Center Phase 9 assertions passed.');
  }

  await main();
}

async function risk_centerGuard11(): Promise<void> {
  const { RiskService } = await import('../src/api/services/RiskService');

  const service = new RiskService() as any;
  const account = {
    accountId: 'account-1',
    brokerKey: 'delta_exchange',
    accountName: 'Delta Production',
    fundsSnapshot: null,
    fundsCoverage: null,
    walletBalance: null,
    futuresBalance: 119.55,
    lockedMargin: 4.91,
    balance: 119.55,
    positions: [],
    positionsFreshness: null,
    positionCoverage: null,
    thresholds: service.buildRiskThresholdProfile({ maxLeverage: 15 }),
    policyContext: service.buildEffectiveRiskPolicyContext(null, 'delta_exchange'),
  };

  const confirmedOrderPosition = {
    symbol: 'EIGENUSD',
    side: 'Short',
    quantity: 10,
    current_price: 10,
    leverage: 1,
    requested_leverage: 10,
    confirmed_order_leverage: 10,
    observed_position_leverage: null,
    leverage_source: 'confirmed_order_submission',
    positionSummary: {
      symbol: 'EIGENUSD',
      side: 'Short',
      quantity: 10,
      currentPrice: 10,
      leverage: 1,
      requestedLeverage: 10,
      confirmedOrderLeverage: 10,
      observedPositionLeverage: null,
      leverageSource: 'confirmed_order_submission',
    },
  };

  assert.equal(service.resolveEffectivePositionLeverage(confirmedOrderPosition), 10);

  const confirmedEvaluation = service.evaluatePositionRisk(confirmedOrderPosition, account, 500);
  assert.equal(confirmedEvaluation.leverage, 10);
  assert.equal(confirmedEvaluation.reservedMargin, 10);
  assert.ok(confirmedEvaluation.statuses.includes('watch'));
  assert.ok(
    confirmedEvaluation.notes.some((note: string) => note.includes('did not report leverage'))
  );
  const confirmedAlerts = service.buildRiskAlerts([confirmedEvaluation], []);
  assert.equal(confirmedAlerts[0]?.severity, 'Watch');
  assert.ok(String(confirmedAlerts[0]?.message || '').includes('did not report leverage'));

  const brokerObservedPosition = {
    ...confirmedOrderPosition,
    leverage: 10,
    observed_position_leverage: 12,
    leverage_source: 'broker_position',
    positionSummary: {
      ...confirmedOrderPosition.positionSummary,
      leverage: 12,
      observedPositionLeverage: 12,
      leverageSource: 'broker_position',
    },
  };

  assert.equal(service.resolveEffectivePositionLeverage(brokerObservedPosition), 12);
  const brokerObservedEvaluation = service.evaluatePositionRisk(
    brokerObservedPosition,
    account,
    500
  );
  assert.ok(brokerObservedEvaluation.statuses.includes('critical'));
  assert.ok(
    brokerObservedEvaluation.notes.some((note: string) =>
      note.includes('reporting 12x after the order was confirmed at 10x')
    )
  );

  const requestedMismatchPosition = {
    ...confirmedOrderPosition,
    confirmed_order_leverage: 8,
    positionSummary: {
      ...confirmedOrderPosition.positionSummary,
      confirmedOrderLeverage: 8,
    },
  };
  const requestedMismatchEvaluation = service.evaluatePositionRisk(
    requestedMismatchPosition,
    account,
    500
  );
  assert.ok(requestedMismatchEvaluation.statuses.includes('critical'));
  assert.ok(
    requestedMismatchEvaluation.notes.some((note: string) =>
      note.includes('requested 10x but the broker confirmed 8x')
    )
  );
  console.log('Risk Center Phase 11 assertions passed.');
}

const suiteSteps = {
  '01': risk_centerGuard01,
  '02': risk_centerGuard02,
  '04': risk_centerGuard04,
  '05': risk_centerGuard05,
  '06': risk_centerGuard06,
  '08': risk_centerGuard08,
  '09': risk_centerGuard09,
  '11': risk_centerGuard11,
} as const;

export async function runRiskCenterSuite(): Promise<void> {
  await runScriptSuite('Risk center module', ['scripts/test-risk-center-contract.ts']);
  await runSuiteSteps('Risk center module', 'scripts/test-risk-center.ts', [
    '01',
    '02',
    '04',
    '05',
    '06',
    '08',
    '09',
  ]);
  console.log('Risk center module assertions passed.');
}

async function runRequestedStep(): Promise<void> {
  const requestedStep = process.argv[3];
  if (!requestedStep) {
    return;
  }
  const step = suiteSteps[requestedStep as keyof typeof suiteSteps];
  if (!step) {
    throw new Error(`Unknown suite step: ${requestedStep}`);
  }
  await step();
}

if (process.argv[3]) {
  runRequestedStep().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
