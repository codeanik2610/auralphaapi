import assert from 'node:assert/strict';
import {
  normalizeAutomationConfig,
  TRADE_SUGGESTION_EXECUTION_LIMIT_RULES,
  normalizeTradeSuggestionExecutionPolicy,
} from '../src/api/utils/automationType';
import {
  DEFAULT_TRADE_SUGGESTION_FRESHNESS_GRACE_SECONDS,
  evaluateSignalFreshness,
} from '../src/api/utils/signalFreshness';
import { resolveLimitOrderExpirySeconds } from '../src/api/utils/tradeSuggestionOrderExpiry';

// Test Suite 1: Basic Template ID Promotion
function runTemplateIdPromotionTests(): void {
  console.log('Test Suite 1: Template ID Promotion\n');

  // Test 1.1: Promote from config.config.templateId
  const case1 = {
    kind: 'trade-suggestion',
    config: {
      templateId: 'template-123',
      market: 'crypto-futures',
    },
  };

  const result1 = normalizeAutomationConfig('trade-suggestion', case1);

  assert.strictEqual(
    result1?.templateId,
    'template-123',
    'Should promote templateId from config.config to top-level'
  );
  assert.strictEqual(
    ((result1?.tradeSuggestion as Record<string, unknown>)?.execution as Record<string, unknown>)
      ?.executionMode,
    'suggestion_only',
    'Trade-suggestion automations should receive a normalized default execution policy'
  );
  console.log('  ✓ Promotes templateId from nested config');

  // Test 1.2: Promote from config.config.sourceTemplateId
  const case2 = {
    kind: 'trade-suggestion',
    config: {
      sourceTemplateId: 'template-456',
      market: 'crypto-futures',
    },
  };

  const result2 = normalizeAutomationConfig('trade-suggestion', case2);

  assert.strictEqual(
    result2?.sourceTemplateId,
    'template-456',
    'Should promote sourceTemplateId from config.config to top-level'
  );
  console.log('  ✓ Promotes sourceTemplateId from nested config');

  // Test 1.3: Promote from execution template object
  const case3 = {
    kind: 'trade-suggestion',
    config: {
      template: {
        id: 'template-789',
        name: 'Test Template',
      },
      market: 'crypto-futures',
    },
  };

  const result3 = normalizeAutomationConfig('trade-suggestion', case3);

  assert.strictEqual(
    result3?.templateId,
    'template-789',
    'Should extract templateId from nested template object'
  );
  console.log('  ✓ Extracts templateId from template object\n');

  // Test 1.4: Promote from legacy config.config.templateId shape
  const case4 = {
    kind: 'trade-suggestion',
    config: {
      config: {
        templateId: 'template-legacy',
        sourceTemplateId: 'template-legacy',
        inputSnapshot: {
          template: {
            id: 'template-legacy',
          },
        },
      },
    },
  };

  const result4 = normalizeAutomationConfig('trade-suggestion', case4);

  assert.strictEqual(
    result4?.templateId,
    'template-legacy',
    'Should promote templateId from legacy config.config shape'
  );
  assert.strictEqual(
    result4?.sourceTemplateId,
    'template-legacy',
    'Should promote sourceTemplateId from legacy config.config shape'
  );
  console.log('  ✓ Promotes template IDs from legacy double-nested config\n');
}

// Test Suite 2: Precedence Logic
function runPrecedenceTests(): void {
  console.log('Test Suite 2: Precedence Logic\n');

  // Test 2.1: Explicit top-level wins over nested
  const case1 = {
    kind: 'trade-suggestion',
    templateId: 'explicit-top-level',
    config: {
      templateId: 'nested-config',
    },
    tradeSuggestion: {
      templateId: 'nested-suggestion',
    },
  };

  const result1 = normalizeAutomationConfig('trade-suggestion', case1);

  assert.strictEqual(
    result1?.templateId,
    'explicit-top-level',
    'Explicit top-level templateId should take highest priority'
  );
  console.log('  ✓ Explicit top-level has highest priority');

  // Test 2.2: Nested config wins over tradeSuggestion
  const case2 = {
    kind: 'trade-suggestion',
    config: {
      templateId: 'nested-config',
    },
    tradeSuggestion: {
      templateId: 'nested-suggestion',
    },
  };

  const result2 = normalizeAutomationConfig('trade-suggestion', case2);

  assert.strictEqual(
    result2?.templateId,
    'nested-config',
    'Nested config templateId should win over tradeSuggestion'
  );
  console.log('  ✓ Nested config has priority over tradeSuggestion');

  // Test 2.3: sourceTemplateId follows same precedence
  const case3 = {
    kind: 'trade-suggestion',
    sourceTemplateId: 'explicit-source',
    config: {
      sourceTemplateId: 'nested-source',
    },
  };

  const result3 = normalizeAutomationConfig('trade-suggestion', case3);

  assert.strictEqual(
    result3?.sourceTemplateId,
    'explicit-source',
    'sourceTemplateId should follow same precedence as templateId'
  );
  console.log('  ✓ sourceTemplateId follows same precedence\n');
}

// Test Suite 3: Duplicate Handling
function runDuplicateHandlingTests(): void {
  console.log('Test Suite 3: Duplicate Handling\n');

  // Test 3.1: Don't create duplicates when already exists
  const case1 = {
    kind: 'trade-suggestion',
    templateId: 'existing-id',
    sourceTemplateId: 'existing-source',
    config: {
      templateId: 'existing-id', // Same value
      market: 'crypto-futures',
    },
  };

  const result1 = normalizeAutomationConfig('trade-suggestion', case1);

  assert.strictEqual(result1?.templateId, 'existing-id');
  assert.strictEqual(result1?.sourceTemplateId, 'existing-source');

  // Verify no duplicate keys (count occurrences)
  const keys = Object.keys(result1 || {});
  const templateIdCount = keys.filter((k) => k === 'templateId').length;
  const sourceTemplateIdCount = keys.filter((k) => k === 'sourceTemplateId').length;

  assert.strictEqual(templateIdCount, 1, 'Should not create duplicate templateId key');
  assert.strictEqual(sourceTemplateIdCount, 1, 'Should not create duplicate sourceTemplateId key');
  console.log('  ✓ No duplicate keys created');

  // Test 3.2: Handle null values correctly
  const case2 = {
    kind: 'trade-suggestion',
    templateId: null,
    config: {
      templateId: 'nested-id',
      market: 'crypto-futures',
    },
  };

  const result2 = normalizeAutomationConfig('trade-suggestion', case2);

  assert.strictEqual(
    result2?.templateId,
    'nested-id',
    'Should use nested value when top-level is null'
  );
  console.log('  ✓ Handles null values correctly\n');
}

// Test Suite 4: Backward Compatibility
function runBackwardCompatibilityTests(): void {
  console.log('Test Suite 4: Backward Compatibility\n');

  // Test 4.1: Existing automations without templateId
  const case1 = {
    kind: 'trade-suggestion',
    symbol: 'BTCUSD',
    timeframe: '15m',
    config: {
      market: 'crypto-futures',
    },
  };

  const result1 = normalizeAutomationConfig('trade-suggestion', case1);

  assert.strictEqual(result1?.templateId, undefined, 'Should not add templateId if not present');
  assert.strictEqual(
    result1?.sourceTemplateId,
    undefined,
    'Should not add sourceTemplateId if not present'
  );
  console.log("  ✓ Doesn't add fields when not present");

  // Test 4.2: Preserve all existing fields
  const case2 = {
    kind: 'trade-suggestion',
    symbol: 'ETHUSD',
    timeframe: '1h',
    market: 'crypto-futures',
    strategy: 'Momentum',
    config: {
      templateId: 'test-template',
      assets: [{ symbol: 'ETHUSD' }],
    },
  };

  const result2 = normalizeAutomationConfig('trade-suggestion', case2);

  assert.strictEqual(result2?.symbol, 'ETHUSD');
  assert.strictEqual(result2?.timeframe, '1h');
  assert.strictEqual(result2?.market, 'crypto-futures');
  assert.strictEqual(result2?.strategy, 'Momentum');
  assert.strictEqual(result2?.templateId, 'test-template');
  console.log('  ✓ Preserves all existing fields\n');
}

// Test Suite 5: Edge Cases
function runEdgeCaseTests(): void {
  console.log('Test Suite 5: Edge Cases\n');

  // Test 5.1: Empty strings should be ignored
  const case1 = {
    kind: 'trade-suggestion',
    templateId: '', // Empty string
    config: {
      templateId: 'valid-id',
    },
  };

  const result1 = normalizeAutomationConfig('trade-suggestion', case1);

  assert.strictEqual(
    result1?.templateId,
    'valid-id',
    'Empty string should be ignored, use nested value'
  );
  console.log('  ✓ Empty strings ignored');

  // Test 5.2: Whitespace-only strings should be ignored
  const case2 = {
    kind: 'trade-suggestion',
    templateId: '   ', // Whitespace only
    config: {
      templateId: 'valid-id',
    },
  };

  const result2 = normalizeAutomationConfig('trade-suggestion', case2);

  assert.strictEqual(result2?.templateId, 'valid-id', 'Whitespace-only string should be ignored');
  console.log('  ✓ Whitespace-only strings ignored');

  // Test 5.3: Backtest-runner type (typically no templates)
  const case3 = {
    kind: 'backtest-runner',
    backtestRunner: {
      libraryId: 'lib-123',
      runBody: {
        templateId: 'runner-template',
      },
    },
  };

  const result3 = normalizeAutomationConfig('backtest-runner', case3);

  assert.strictEqual(
    result3?.templateId,
    'runner-template',
    'Should handle backtest-runner type correctly'
  );
  console.log('  ✓ Handles backtest-runner type');

  // Test 5.4: Multiple nested template references
  const case4 = {
    kind: 'trade-suggestion',
    config: {
      templateId: 'config-id',
      inputSnapshot: {
        templateId: 'snapshot-id',
      },
      template: {
        id: 'template-obj-id',
      },
    },
  };

  const result4 = normalizeAutomationConfig('trade-suggestion', case4);

  assert.strictEqual(
    result4?.templateId,
    'config-id',
    'Should use first valid value in precedence order'
  );
  console.log('  ✓ Handles multiple nested references\n');
}

function runExecutionPolicyNormalizationTests(): void {
  console.log('Test Suite 6: Execution Policy Normalization\n');

  const defaults = normalizeTradeSuggestionExecutionPolicy(null);
  assert.equal(defaults.executionMode, 'suggestion_only');
  assert.equal(defaults.approvalMode, 'manual_review');
  assert.equal(
    (defaults.preTrade as Record<string, unknown>)?.required,
    true,
    'Pre-trade should always be required'
  );
  console.log('  ✓ Supplies safe defaults for legacy automations');

  const paperAutoPolicy = normalizeTradeSuggestionExecutionPolicy({
    executionMode: 'paper_trade_auto',
    approvalMode: 'auto_if_safe',
    orderTemplate: {
      leverage: null,
    },
  });
  assert.equal(
    ((paperAutoPolicy.orderTemplate as Record<string, unknown>) || {}).leverage,
    null,
    'Paper auto should not receive a live leverage default'
  );
  console.log('  ✓ Leaves paper-auto leverage unset by default');

  const liveAutoPolicy = normalizeTradeSuggestionExecutionPolicy({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    liveConsent: {
      enabled: true,
    },
    orderTemplate: {
      leverage: null,
    },
  });
  assert.equal(
    ((liveAutoPolicy.orderTemplate as Record<string, unknown>) || {}).leverage,
    null,
    'Live auto should leave leverage unset so risk policy can resolve it'
  );
  console.log('  ✓ Leaves live-auto leverage unset for risk-policy resolution');

  const normalizedLimits = normalizeTradeSuggestionExecutionPolicy({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    limits: {
      maxOrdersPerRun: 999999,
      maxOrdersPerDay: 999999,
      maxConcurrentOpenTrades: 999999,
      dedupeWindowSeconds: -5,
    },
  });
  const limits = (normalizedLimits.limits as Record<string, unknown>) || {};
  assert.equal(
    limits.maxOrdersPerRun,
    TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerRun.max,
    'Per-run limit should normalize from the shared rule definition'
  );
  assert.equal(
    limits.maxOrdersPerDay,
    TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxOrdersPerDay.max,
    'Per-day limit should normalize from the shared rule definition'
  );
  assert.equal(
    limits.maxConcurrentOpenTrades,
    TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.maxConcurrentOpenTrades.max,
    'Concurrent-open-trades limit should normalize from the shared rule definition'
  );
  assert.equal(
    limits.dedupeWindowSeconds,
    TRADE_SUGGESTION_EXECUTION_LIMIT_RULES.dedupeWindowSeconds.min,
    'Dedupe window should normalize from the shared rule definition'
  );
  console.log('  ✓ Centralizes trade-suggestion execution limit normalization');

  const oppositeSignalPolicy = normalizeTradeSuggestionExecutionPolicy({
    executionMode: 'live_trade_auto',
    approvalMode: 'auto_if_safe',
    oppositeSignalPolicy: {
      enabled: true,
      mode: 'reverse',
      allowSameAssetOppositeSide: true,
      blockSameSideDuplicate: true,
    },
  });
  const normalizedOppositeSignalPolicy =
    (oppositeSignalPolicy.oppositeSignalPolicy as Record<string, unknown>) || {};
  assert.equal(normalizedOppositeSignalPolicy.enabled, true);
  assert.equal(normalizedOppositeSignalPolicy.mode, 'reverse');
  assert.equal(normalizedOppositeSignalPolicy.allowSameAssetOppositeSide, true);
  assert.equal(normalizedOppositeSignalPolicy.blockSameSideDuplicate, true);
  console.log('  ✓ Normalizes same-asset opposite-signal execution policy');

  const freshness = (normalizedLimits.freshness as Record<string, unknown>) || {};
  const timeframeGraceSeconds = (freshness.timeframeGraceSeconds as Record<string, unknown>) || {};
  assert.equal(freshness.enabled, true);
  assert.equal(
    timeframeGraceSeconds['15m'],
    DEFAULT_TRADE_SUGGESTION_FRESHNESS_GRACE_SECONDS['15m'],
    'Freshness policy should expose timeframe-aware defaults for UI editing'
  );

  const customFreshnessPolicy = normalizeTradeSuggestionExecutionPolicy({
    freshness: {
      enabled: true,
      timeframeGraceSeconds: {
        '5m': 180,
        '15m': 600,
      },
    },
  });
  const customFreshness = (customFreshnessPolicy.freshness as Record<string, unknown>) || {};
  const customTimeframes = (customFreshness.timeframeGraceSeconds as Record<string, unknown>) || {};
  assert.equal(customTimeframes['5m'], 180);
  assert.equal(customTimeframes['15m'], 600);

  const staleEvaluation = evaluateSignalFreshness({
    signalTime: '2026-04-30T09:30:00.000Z',
    timeframe: '15m',
    policy: customFreshness as any,
    evaluatedAt: new Date('2026-04-30T09:56:00.000Z'),
  });
  assert.equal(staleEvaluation.allowed, false);
  assert.equal(staleEvaluation.ageAfterCloseSeconds, 660);
  assert.equal(staleEvaluation.maxAgeAfterCloseSeconds, 600);
  console.log('  ✓ Normalizes configurable timeframe-aware signal freshness guard');

  const preEntryGuardPolicy = normalizeTradeSuggestionExecutionPolicy({
    preEntryGuards: {
      minDistanceFromStopR: {
        enabled: true,
        minR: 0.5,
        basis: 'expected_fill',
        blockOnMissingMarketPrice: true,
      },
    },
  });
  const preEntryGuards = (preEntryGuardPolicy.preEntryGuards as Record<string, unknown>) || {};
  const minDistanceGuard = (preEntryGuards.minDistanceFromStopR as Record<string, unknown>) || {};
  assert.equal(minDistanceGuard.enabled, true);
  assert.equal(minDistanceGuard.minR, 0.5);
  assert.equal(minDistanceGuard.basis, 'expected_fill');
  assert.equal(minDistanceGuard.blockOnMissingMarketPrice, true);
  console.log('  ✓ Normalizes pre-entry min-distance-from-stop guard');

  const limitOrderExpiry = (normalizedLimits.limitOrderExpiry as Record<string, unknown>) || {};
  const timeframeExpirySeconds =
    (limitOrderExpiry.timeframeExpirySeconds as Record<string, unknown>) || {};
  assert.equal(limitOrderExpiry.enabled, true);
  assert.equal(
    timeframeExpirySeconds['5m'],
    900,
    'Limit order expiry policy should expose timeframe-aware defaults'
  );
  assert.equal(timeframeExpirySeconds['15m'], 2700);
  assert.equal(timeframeExpirySeconds['1h'], 10800);

  const customLimitExpiryPolicy = normalizeTradeSuggestionExecutionPolicy({
    limitOrderExpiry: {
      enabled: true,
      timeframeExpirySeconds: {
        '5m': 75,
        '1h': 600,
      },
    },
  });
  const customLimitExpiry =
    (customLimitExpiryPolicy.limitOrderExpiry as Record<string, unknown>) || {};
  const customLimitExpiryTimeframes =
    (customLimitExpiry.timeframeExpirySeconds as Record<string, unknown>) || {};
  assert.equal(customLimitExpiryTimeframes['5m'], 75);
  assert.equal(resolveLimitOrderExpirySeconds('1h', customLimitExpiry as any), 600);
  console.log('  ✓ Normalizes timeframe-aware limit order expiry');

  const liveConfig = normalizeAutomationConfig('trade-suggestion', {
    kind: 'trade-suggestion',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    sourceTemplateId: 'template-live',
    tradeSuggestion: {
      execution: {
        executionMode: 'live_trade_auto',
        approvalMode: 'auto_if_safe',
        liveConsent: {
          enabled: true,
        },
        routing: {
          routeMode: 'fixed',
          brokerKey: 'mudrex',
        },
      },
    },
  });

  const liveExecution = (liveConfig?.tradeSuggestion as Record<string, unknown>)
    ?.execution as Record<string, unknown>;
  assert.equal(liveExecution?.executionMode, 'live_trade_auto');
  assert.equal(((liveExecution?.routing as Record<string, unknown>) || {}).brokerKey, 'mudrex');
  assert.equal(((liveExecution?.liveConsent as Record<string, unknown>) || {}).enabled, true);
  console.log('  ✓ Preserves explicit live execution policy values\n');

  const promotedConfig = normalizeAutomationConfig('trade-suggestion', {
    kind: 'trade-suggestion',
    source: 'backtest',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    config: {
      market: 'crypto-futures',
      libraryId: 'library-1',
      templateVersion: 8,
      inputSnapshot: {
        sourceType: 'strategy_library',
        libraryId: 'library-1',
        templateId: 'template-1',
        templateVersion: 8,
      },
    },
  });

  const promotedRootConfig = (promotedConfig?.config || null) as Record<string, unknown> | null;
  assert.equal(promotedRootConfig?.libraryId, 'library-1');
  assert.equal(promotedRootConfig?.templateVersion, 8);
  assert.equal(
    ((promotedRootConfig?.inputSnapshot as Record<string, unknown>) || {}).templateId,
    'template-1'
  );
  assert.equal(
    (
      (promotedConfig?.tradeSuggestion as Record<string, unknown>)?.execution as Record<
        string,
        unknown
      >
    )?.executionMode,
    'suggestion_only'
  );
  console.log('  ✓ Preserves promoted snapshot config while normalizing execution policy\n');
}

// Main test runner
export async function main(): Promise<void> {
  console.log('Running automationType utils tests...\n');

  runTemplateIdPromotionTests();
  runPrecedenceTests();
  runDuplicateHandlingTests();
  runBackwardCompatibilityTests();
  runEdgeCaseTests();
  runExecutionPolicyNormalizationTests();

  console.log('✅ All automationType tests passed!\n');
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
