import assert from 'node:assert/strict';
import { buildTwoStageCandleBreakoutTemplateConfig } from '../src/api/strategies/templates/TwoStageCandleBreakoutTemplate';
import { buildStrategyTemplateAutomationProfile } from '../src/api/utils/strategyTemplateAutomation';
import {
  First60TemplateSimulationCandle,
  simulateFirst60TemplateProfile,
} from '../src/api/utils/first60TemplateSimulator';
import { evaluateFirst60ObserveOnlyTrade } from '../src/api/utils/first60ObserveOnlyMonitor';

const buildCandles = (
  startIso: string,
  count: number,
  defaults: Omit<First60TemplateSimulationCandle, 'openTime'>,
  overrides: Record<number, Partial<First60TemplateSimulationCandle>> = {}
): First60TemplateSimulationCandle[] => {
  const start = new Date(startIso).getTime();
  return Array.from({ length: count }, (_, index) => ({
    openTime: new Date(start + index * 60_000).toISOString(),
    ...defaults,
    ...(overrides[index] || {}),
  }));
};

const pythonTemplate = {
  codeTarget: 'python',
  codeDefinition: `from auralpha import Strategy

class AlertConfirm15mBreakoutV2(Strategy):
    name = "Alert Confirm 15m Breakout v2"
    market = "crypto-futures"

    def entry(self, ctx):
        return True

    def exit(self, ctx):
        return False

    def entry_short(self, ctx):
        return True

    def exit_short(self, ctx):
        return False

    risk = {
        "stop_loss_pct": 1.2,
        "take_profit_pct": 2.6
    }`,
  risk: {
    maxRisk: '1.2',
  },
  parameters: {
    signalThreshold: '0.82',
  },
};

const profile = buildStrategyTemplateAutomationProfile(pythonTemplate);

assert.equal(profile.tradePlan.long?.stopLossPct, 1.2);
assert.deepEqual(profile.tradePlan.long?.takeProfitTargetsPct, [2.6]);
assert.equal(profile.tradePlan.short?.stopLossPct, 1.2);
assert.deepEqual(profile.tradePlan.short?.takeProfitTargetsPct, [2.6]);
assert.equal(profile.signalThreshold, 0.82);
assert.deepEqual(profile.execution, {
  evaluationTimeframe: 'automation',
  useClosedCandlesOnly: true,
  initialStopLossTimeframe: 'evaluation',
  targetTimeframe: 'evaluation',
});

const explicitRiskWins = buildStrategyTemplateAutomationProfile({
  ...pythonTemplate,
  risk: {
    maxRisk: '1.2',
    stop_loss_pct: 1.8,
    take_profit_pct: 3.4,
  },
});

assert.equal(explicitRiskWins.tradePlan.long?.stopLossPct, 1.8);
assert.deepEqual(explicitRiskWins.tradePlan.long?.takeProfitTargetsPct, [3.4]);

const first60Managed = buildStrategyTemplateAutomationProfile({
  ...pythonTemplate,
  automation: {
    timeframePolicy: {
      evaluationTimeframe: '15m',
      useClosedCandlesOnly: true,
      initialStopLossTimeframe: 'evaluation',
      targetTimeframe: 'evaluation',
    },
  },
  tradeManagement: {
    trailingStop: {
      enabled: true,
      mode: 'custom_r_ladder',
      timeframe: '1m',
      rules: [
        { whenProfitR: 0.5, moveStopToR: 0.1 },
        { whenProfitR: 1, moveStopToR: 0.3 },
        { whenProfitR: 2, moveStopToR: 1.2 },
        { whenProfitR: 3, moveStopToR: 2.2 },
        { whenProfitR: 4, moveStopToR: 3.2 },
        { whenProfitR: 5, moveStopToR: 4.2 },
      ],
    },
    first60: {
      enabled: true,
      mode: 'post_entry_hold_or_exit',
      dataSource: 'market_candles_1m',
      buy: {
        observeOnlyEnabled: true,
        managementEnabled: false,
        diagnosticsEnabled: true,
        decisionGate: {
          status: 'observe_only',
          reason: 'BUY passed Phase 3c evidence',
          evidenceRef: 'storage/first60-evidence/phase3c-summary-2026-05-07.md',
          decidedAt: '2026-05-07',
        },
        requiredFavorableR: 1,
        maxAdverseR: 0.75,
        targetR: 5,
        stopBasis: 'signal_candle_low',
      },
      sell: {
        observeOnlyEnabled: true,
        decisionGate: {
          status: 'blocked',
          reason: 'SELL failed Phase 3c evidence',
          evidenceRef: 'storage/first60-evidence/phase3c-summary-2026-05-07.md',
          decidedAt: '2026-05-07',
        },
        requiredFavorableR: 1,
        maxAdverseR: 0.75,
        targetR: 4.5,
        stopBasis: 'signal_candle_high',
      },
    },
  },
});

assert.equal(first60Managed.tradeManagement?.first60?.enabled, true);
assert.equal(first60Managed.tradeManagement?.trailingStop?.mode, 'custom_r_ladder');
assert.equal(first60Managed.execution.evaluationTimeframe, '15m');
assert.equal(first60Managed.execution.useClosedCandlesOnly, true);
assert.equal(first60Managed.tradeManagement?.trailingStop?.timeframe, '1m');
assert.deepEqual(first60Managed.tradeManagement?.trailingStop?.rules, [
  { whenProfitR: 0.5, moveStopToR: 0.1 },
  { whenProfitR: 1, moveStopToR: 0.3 },
  { whenProfitR: 2, moveStopToR: 1.2 },
  { whenProfitR: 3, moveStopToR: 2.2 },
  { whenProfitR: 4, moveStopToR: 3.2 },
  { whenProfitR: 5, moveStopToR: 4.2 },
]);
assert.equal(first60Managed.tradeManagement?.first60?.dataSource, 'market_candles_1m');
assert.equal(first60Managed.tradeManagement?.first60?.long?.targetR, 5);
assert.equal(first60Managed.tradeManagement?.first60?.long?.maxAdverseR, 0.75);
assert.equal(first60Managed.tradeManagement?.first60?.long?.stopBasis, 'signal_candle_low');
assert.equal(first60Managed.tradeManagement?.first60?.long?.decisionGate.status, 'observe_only');
assert.equal(first60Managed.tradeManagement?.first60?.long?.decisionGate.observeOnlyEnabled, true);
assert.equal(first60Managed.tradeManagement?.first60?.long?.decisionGate.managementEnabled, false);
assert.equal(
  first60Managed.tradeManagement?.first60?.long?.decisionGate.evidenceRef,
  'storage/first60-evidence/phase3c-summary-2026-05-07.md'
);
assert.equal(first60Managed.tradeManagement?.first60?.short?.targetR, 4.5);
assert.equal(first60Managed.tradeManagement?.first60?.short?.stopBasis, 'signal_candle_high');
assert.equal(first60Managed.tradeManagement?.first60?.short?.decisionGate.status, 'blocked');
assert.equal(
  first60Managed.tradeManagement?.first60?.short?.decisionGate.observeOnlyEnabled,
  false
);
assert.equal(first60Managed.tradeManagement?.first60?.short?.decisionGate.managementEnabled, false);
assert.equal(first60Managed.tradeManagement?.first60?.short?.decisionGate.diagnosticsEnabled, true);

const twoStageConfig = buildTwoStageCandleBreakoutTemplateConfig();
const twoStageProfile = buildStrategyTemplateAutomationProfile(twoStageConfig);
const twoStageRisk = twoStageConfig.risk as Record<string, unknown>;
const twoStageParameters = twoStageConfig.parameters as Record<string, unknown>;

assert.equal(twoStageProfile.automationReady, true);
assert.deepEqual(twoStageProfile.supports, {
  long: true,
  short: true,
  customPython: true,
  ruleBased: false,
});
assert.equal(twoStageProfile.tradePlan.long?.stopLossMode, 'dynamic_second_stage_candle');
assert.equal(twoStageProfile.tradePlan.short?.stopLossMode, 'dynamic_second_stage_candle');
assert.equal(twoStageProfile.tradePlan.long?.takeProfitMode, 'dynamic_r_multiple');
assert.equal(twoStageProfile.tradePlan.short?.takeProfitMode, 'dynamic_r_multiple');
assert.equal(twoStageProfile.tradePlan.long?.riskRewardRatio, 11);
assert.equal(twoStageProfile.tradePlan.short?.riskRewardRatio, 11);
assert.deepEqual(twoStageProfile.tradePlan.long?.takeProfitTargetsPct, []);
assert.equal(twoStageProfile.execution.useClosedCandlesOnly, true);
assert.equal(twoStageProfile.execution.evaluationTimeframe, 'automation');
assert.equal(twoStageProfile.tradeManagement?.trailingStop?.mode, 'custom_r_ladder');
assert.equal(twoStageProfile.tradeManagement?.trailingStop?.basis, 'actual_fill');
assert.equal(twoStageProfile.tradeManagement?.trailingStop?.timeframe, '1m');
assert.deepEqual(twoStageProfile.tradeManagement?.trailingStop?.rules, [
  { whenProfitR: 4, moveStopToR: 1 },
  { whenProfitR: 9, moveStopToR: 4 },
  { whenProfitR: 11, moveStopToR: 9 },
]);
assert.equal(twoStageRisk.riskRewardRatio, 11);
assert.equal(twoStageParameters.rewardR, 11);
assert.equal(twoStageParameters.stopBufferPct, 0.0005);
assert.equal(twoStageParameters.stop_buffer_pct, 0.0005);
assert.match(String(twoStageConfig.entryLogic || ''), /red candle 1/);
assert.match(String(twoStageConfig.entryLogic || ''), /immediate green alert/);
assert.match(String(twoStageConfig.entryLogic || ''), /same-direction continuation before pullback/);
assert.match(String(twoStageConfig.entryLogic || ''), /alert-low guard/);
assert.match(String(twoStageConfig.entryLogic || ''), /intentionally not used/);
assert.match(String(twoStageConfig.entryLogic || ''), /first green after that red pullback/);
assert.match(String(twoStageConfig.entryShortLogic || ''), /green candle 1/);
assert.match(String(twoStageConfig.entryShortLogic || ''), /immediate red alert/);
assert.match(String(twoStageConfig.entryShortLogic || ''), /same-direction continuation before pullback/);
assert.match(String(twoStageConfig.entryShortLogic || ''), /alert-high guard/);
assert.match(String(twoStageConfig.entryShortLogic || ''), /intentionally not used/);
assert.match(String(twoStageConfig.entryShortLogic || ''), /first red after that green pullback/);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /class TwoStageCandleBreakout11Ladder\(Strategy\):/
);
assert.match(String(twoStageConfig.codeDefinition || ''), /"reward_r": 11/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"risk_reward_ratio": 11/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"stop_buffer_pct": 0\.0005/);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /self\._close\(df, first_green_index\) <= first_red_high/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /self\._close\(df, first_red_index\) >= first_green_low/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /if first_red_index > 0 and self\._is_red\(df, first_red_index - 1\):/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /if first_green_index > 0 and self\._is_green\(df, first_green_index - 1\):/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /def _setup_marker\(self, df, label, role, candle_index, price\):/
);
assert.match(String(twoStageConfig.codeDefinition || ''), /def _mid\(self, df, index\):/);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /entry_price = self\._mid\(df, entry_index\)/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /alert_low = self\._low\(df, alert_index\)/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /if self\._low\(df, scan_index\) < alert_low:/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /if second_red_index is None and self\._is_green\(df, scan_index\):/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /alert_high = self\._high\(df, alert_index\)/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /if self\._high\(df, scan_index\) > alert_high:/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /if second_green_index is None and self\._is_red\(df, scan_index\):/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /if second_red_index is not None and self\._is_green\(df, scan_index\):/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /if second_green_index is not None and self\._is_red\(df, scan_index\):/
);
assert.doesNotMatch(String(twoStageConfig.codeDefinition || ''), /while second_red_index/);
assert.doesNotMatch(String(twoStageConfig.codeDefinition || ''), /while second_green_index/);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /self\._low\(df, scan_index\) >= self\._low\(df, second_red_index\)/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /self\._high\(df, scan_index\) <= self\._high\(df, second_green_index\)/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /second_red_index = None\s*\n\s*scan_index \+= 1/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /second_green_index = None\s*\n\s*scan_index \+= 1/
);
assert.match(String(twoStageConfig.codeDefinition || ''), /"structure_guard": "alert_low"/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"structure_guard": "alert_high"/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"stop_basis": "second_red_low"/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"stop_basis": "second_green_high"/);
assert.match(String(twoStageConfig.codeDefinition || ''), /def entry_short_plan\(self, ctx\):/);

const first60Report = simulateFirst60TemplateProfile(
  first60Managed,
  [
    {
      symbol: 'BTCUSDT',
      side: 'BUY',
      signalTime: '2026-04-04T10:00:00.000Z',
      entryPrice: 100,
      signalCandleLow: 98,
    },
    {
      symbol: 'ETHUSDT',
      side: 'SELL',
      signalTime: '2026-04-04T10:00:00.000Z',
      entryPrice: 100,
      signalCandleHigh: 102,
    },
    {
      symbol: 'SOLUSDT',
      side: 'long',
      signalTime: '2026-04-04T10:00:00.000Z',
      entryPrice: 100,
      stopLossPrice: 98,
    },
    {
      symbol: 'XRPUSDT',
      side: 'short',
      signalTime: '2026-04-04T10:00:00.000Z',
      entryPrice: 100,
      stopLossPrice: 102,
    },
  ],
  {
    BTCUSDT: buildCandles(
      '2026-04-04T10:00:00.000Z',
      70,
      { open: 100, high: 102.5, low: 99, close: 101 },
      {
        65: { high: 111, low: 101, close: 110 },
      }
    ),
    ETHUSDT: buildCandles(
      '2026-04-04T10:00:00.000Z',
      70,
      { open: 100, high: 101.4, low: 97.5, close: 99 },
      {
        65: { high: 99, low: 90, close: 91 },
      }
    ),
    SOLUSDT: buildCandles('2026-04-04T10:00:00.000Z', 60, {
      open: 100,
      high: 101.5,
      low: 99,
      close: 101,
    }),
    XRPUSDT: buildCandles('2026-04-04T10:00:00.000Z', 60, {
      open: 100,
      high: 101.8,
      low: 98.5,
      close: 101,
    }),
  },
  { maxHoldMinutes: 180, topSymbolsLimit: 2 }
);

assert.deepEqual(first60Report.warnings, []);
assert.equal(first60Report.sides.long.totalTrades, 2);
assert.equal(first60Report.sides.long.passedFirst60, 1);
assert.equal(first60Report.sides.long.failedFirst60, 1);
assert.equal(first60Report.sides.long.targetHits, 1);
assert.equal(first60Report.sides.long.targetHitRate, 0.5);
assert.equal(first60Report.sides.long.targetHitRateAfterPass, 1);
assert.equal(first60Report.sides.long.totalR, 5.5);
assert.equal(first60Report.sides.short.totalTrades, 2);
assert.equal(first60Report.sides.short.passedFirst60, 1);
assert.equal(first60Report.sides.short.failedFirst60, 1);
assert.equal(first60Report.sides.short.targetHits, 1);
assert.equal(first60Report.sides.short.targetHitRate, 0.5);
assert.equal(first60Report.sides.short.targetHitRateAfterPass, 1);
assert.equal(first60Report.sides.short.totalR, 4);
assert.equal(first60Report.trades[0]?.outcome, 'target');
assert.equal(first60Report.trades[0]?.targetPrice, 110);
assert.equal(first60Report.trades[1]?.outcome, 'target');
assert.equal(first60Report.trades[1]?.targetPrice, 91);
assert.equal(first60Report.trades[2]?.outcome, 'first60_failed');
assert.equal(first60Report.trades[2]?.realizedR, 0.5);
assert.equal(first60Report.trades[3]?.outcome, 'first60_failed');
assert.equal(first60Report.trades[3]?.realizedR, -0.5);

const buildObserveMeta = (side: 'long' | 'short') => ({
  tradeManagementSnapshot: {
    first60: {
      enabled: true,
      windowMinutes: 60,
      requiredFavorableR: 1,
      maxAdverseR: 0.75,
      targetR: side === 'long' ? 5 : 4.5,
      decisionGate:
        side === 'long'
          ? {
              status: 'observe_only',
              observeOnlyEnabled: true,
              managementEnabled: false,
              diagnosticsEnabled: true,
              reason: 'BUY passed Phase 3c evidence',
              evidenceRef: 'storage/first60-evidence/phase3c-summary-2026-05-07.md',
              decidedAt: '2026-05-07',
            }
          : {
              status: 'blocked',
              observeOnlyEnabled: false,
              managementEnabled: false,
              diagnosticsEnabled: true,
              reason: 'SELL failed Phase 3c evidence',
              evidenceRef: 'storage/first60-evidence/phase3c-summary-2026-05-07.md',
              decidedAt: '2026-05-07',
            },
    },
  },
});

const longObserveOnly = evaluateFirst60ObserveOnlyTrade(
  {
    id: 'trade-buy-observe',
    symbol: 'BTCUSDT',
    side: 'BUY',
    signalTime: '2026-04-04T10:00:00.000Z',
    entryPrice: 100,
    stopLossPrice: 98,
    meta: buildObserveMeta('long'),
  },
  buildCandles('2026-04-04T10:00:00.000Z', 61, {
    open: 100,
    high: 102,
    low: 99,
    close: 101,
  }),
  { now: '2026-04-04T11:01:00.000Z' }
);

assert.equal(longObserveOnly.action, 'observe_only');
assert.equal(longObserveOnly.eligibleForObserveOnly, true);
assert.equal(longObserveOnly.outcome, 'first60_passed');
assert.equal(longObserveOnly.first60Passed, true);
assert.equal(longObserveOnly.favorableR, 1);
assert.equal(longObserveOnly.adverseR, 0.5);
assert.equal(longObserveOnly.first60CloseR, 0.5);

const sellDiagnosticsOnly = evaluateFirst60ObserveOnlyTrade(
  {
    id: 'trade-sell-diagnostic',
    symbol: 'ETHUSDT',
    side: 'SELL',
    signalTime: '2026-04-04T10:00:00.000Z',
    entryPrice: 100,
    stopLossPrice: 102,
    meta: buildObserveMeta('short'),
  },
  buildCandles('2026-04-04T10:00:00.000Z', 61, {
    open: 100,
    high: 101,
    low: 98,
    close: 99,
  }),
  { now: '2026-04-04T11:01:00.000Z' }
);

assert.equal(sellDiagnosticsOnly.action, 'diagnostics_only');
assert.equal(sellDiagnosticsOnly.eligibleForObserveOnly, false);
assert.equal(sellDiagnosticsOnly.outcome, 'first60_passed');
assert.equal(sellDiagnosticsOnly.first60Passed, true);
assert.equal(sellDiagnosticsOnly.reason, 'Decision gate is diagnostics-only for this side');

console.log('Strategy template automation profile tests passed.');
