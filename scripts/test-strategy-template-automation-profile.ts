import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildDisplacementPullbackContinuationTemplateConfig } from '../src/api/strategies/templates/DisplacementPullbackContinuationTemplate';
import { buildFvgFakeoutContinuationTemplateConfig } from '../src/api/strategies/templates/FvgFakeoutContinuationTemplate';
import { buildTwoStageCandleBreakoutFvgConfirmationTemplateConfig } from '../src/api/strategies/templates/TwoStageCandleBreakoutFvgConfirmationTemplate';
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
assert.equal(twoStageProfile.tradePlan.long?.riskRewardRatio, 4);
assert.equal(twoStageProfile.tradePlan.short?.riskRewardRatio, 4);
assert.deepEqual(twoStageProfile.tradePlan.long?.takeProfitTargetsPct, []);
assert.equal(twoStageProfile.execution.useClosedCandlesOnly, true);
assert.equal(twoStageProfile.execution.evaluationTimeframe, 'automation');
assert.equal(twoStageProfile.tradeManagement?.trailingStop?.mode, 'custom_r_ladder');
assert.equal(twoStageProfile.tradeManagement?.trailingStop?.basis, 'actual_fill');
assert.equal(twoStageProfile.tradeManagement?.trailingStop?.timeframe, '1m');
assert.deepEqual(twoStageProfile.tradeManagement?.trailingStop?.rules, [
  { whenProfitR: 2, moveStopToR: 0 },
]);
assert.equal(twoStageRisk.riskRewardRatio, 4);
assert.equal(twoStageParameters.rewardR, 4);
assert.equal(twoStageParameters.stopBufferPct, 0.0005);
assert.equal(twoStageParameters.stop_buffer_pct, 0.0005);
assert.match(String(twoStageConfig.entryLogic || ''), /red candle 1/);
assert.match(
  String(twoStageConfig.entryLogic || ''),
  /internal candles that stay inside Candle 1 range/
);
assert.match(String(twoStageConfig.entryLogic || ''), /first green candle/);
assert.match(
  String(twoStageConfig.entryLogic || ''),
  /same-direction continuation before pullback/
);
assert.match(String(twoStageConfig.entryLogic || ''), /no candle may break the alert low/);
assert.match(String(twoStageConfig.entryLogic || ''), /intentionally not used/);
assert.match(String(twoStageConfig.entryLogic || ''), /first green after that red pullback/);
assert.match(
  String(twoStageConfig.entryLogic || ''),
  /Entry candles may be inside the alert candle/
);
assert.match(String(twoStageConfig.entryShortLogic || ''), /green candle 1/);
assert.match(
  String(twoStageConfig.entryShortLogic || ''),
  /internal candles that stay inside Candle 1 range/
);
assert.match(String(twoStageConfig.entryShortLogic || ''), /first red candle/);
assert.match(
  String(twoStageConfig.entryShortLogic || ''),
  /same-direction continuation before pullback/
);
assert.match(String(twoStageConfig.entryShortLogic || ''), /no candle may break the alert high/);
assert.match(String(twoStageConfig.entryShortLogic || ''), /intentionally not used/);
assert.match(String(twoStageConfig.entryShortLogic || ''), /first red after that green pullback/);
assert.match(
  String(twoStageConfig.entryShortLogic || ''),
  /Entry candles may be inside the alert candle/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /class TwoStageCandleBreakout4BELadder\(Strategy\):/
);
assert.match(String(twoStageConfig.codeDefinition || ''), /"reward_r": 4/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"risk_reward_ratio": 4/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"stop_buffer_pct": 0\.0005/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"block_recent_side_fvg": True/);
assert.match(String(twoStageConfig.codeDefinition || ''), /"recent_fvg_lookback_candles": 3/);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /def _find_long_alert\(self, df, first_red_index\):/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /def _find_short_alert\(self, df, first_green_index\):/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /self\._is_green\(df, scan_index\) and self\._close\(df, scan_index\) > first_red_high/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /self\._is_red\(df, scan_index\) and self\._close\(df, scan_index\) < first_green_low/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /"pre_alert_inside_indexes": pre_alert_inside_indexes/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /"candle_1_guard": "pre_alert_candles_stay_inside_candle_1_range"/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /def _has_recent_bullish_fvg\(self, df, entry_index\):/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /def _has_recent_bearish_fvg\(self, df, entry_index\):/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /def _is_inside_candle\(self, df, inner_index, outer_index\):/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /if first_red_index > 0 and self\._is_red\(df, first_red_index - 1\):/
);

const behaviorHarness = String.raw`
import json
import sys
import types

auralpha = types.ModuleType("auralpha")

class Strategy:
    pass

auralpha.Strategy = Strategy
sys.modules["auralpha"] = auralpha

namespace = {}
exec(sys.stdin.read(), namespace)
StrategyClass = namespace["TwoStageCandleBreakout4BELadder"]

class FakeSeries:
    def __init__(self, values):
        self.values = values
        self.iloc = self

    def __getitem__(self, index):
        return self.values[index]

class FakeFrame:
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __contains__(self, key):
        return key in self.rows[0]

    def __getitem__(self, key):
        return FakeSeries([row[key] for row in self.rows])

def run(rows):
    strategy = StrategyClass()
    df = FakeFrame(rows)
    strategy.prepare(df)
    return {
        "long_signals": strategy._long_signals,
        "short_signals": strategy._short_signals,
        "long_plans": strategy._long_plans,
        "short_plans": strategy._short_plans,
    }

long_with_inside = run([
    {"open": 105, "high": 106, "low": 99, "close": 100},
    {"open": 101, "high": 105, "low": 100, "close": 103},
    {"open": 104, "high": 105, "low": 100, "close": 102},
    {"open": 103, "high": 107, "low": 100, "close": 106.5},
    {"open": 104, "high": 105, "low": 101, "close": 102},
    {"open": 103, "high": 106, "low": 102, "close": 105},
])

short_with_inside = run([
    {"open": 100, "high": 106, "low": 99, "close": 105},
    {"open": 104, "high": 105, "low": 100, "close": 102},
    {"open": 102, "high": 105, "low": 100, "close": 104},
    {"open": 104, "high": 105, "low": 98, "close": 98.5},
    {"open": 100, "high": 103, "low": 99, "close": 102},
    {"open": 101, "high": 102, "low": 97, "close": 98},
])

long_immediate = run([
    {"open": 105, "high": 106, "low": 99, "close": 100},
    {"open": 101, "high": 107, "low": 100, "close": 106.5},
    {"open": 104, "high": 105, "low": 101, "close": 102},
    {"open": 103, "high": 106, "low": 102, "close": 105},
])

short_immediate = run([
    {"open": 100, "high": 106, "low": 99, "close": 105},
    {"open": 104, "high": 105, "low": 98, "close": 98.5},
    {"open": 100, "high": 103, "low": 99, "close": 102},
    {"open": 101, "high": 102, "low": 97, "close": 98},
])

long_recent_bullish_fvg = run([
    {"open": 99, "high": 100, "low": 90, "close": 95},
    {"open": 96, "high": 105, "low": 94, "close": 104},
    {"open": 107, "high": 108, "low": 105.5, "close": 106},
    {"open": 106.2, "high": 109, "low": 106.1, "close": 108},
])

short_recent_bearish_fvg = run([
    {"open": 101, "high": 110, "low": 100, "close": 108},
    {"open": 104, "high": 109, "low": 95, "close": 96},
    {"open": 91, "high": 94.5, "low": 90, "close": 93},
    {"open": 93, "high": 94, "low": 88, "close": 89},
])

print(json.dumps({
    "longInsideEntry": long_with_inside["long_signals"][5],
    "longInsidePreAlert": long_with_inside["long_plans"][5]["metadata"]["pre_alert_inside_indexes"],
    "shortInsideEntry": short_with_inside["short_signals"][5],
    "shortInsidePreAlert": short_with_inside["short_plans"][5]["metadata"]["pre_alert_inside_indexes"],
    "longImmediateEntry": long_immediate["long_signals"][3],
    "shortImmediateEntry": short_immediate["short_signals"][3],
    "longImmediateFvgLookback": long_immediate["long_plans"][3]["metadata"]["recent_side_fvg_filter"]["lookback_candles"],
    "shortImmediateFvgLookback": short_immediate["short_plans"][3]["metadata"]["recent_side_fvg_filter"]["lookback_candles"],
    "longRecentBullishFvgBlocked": any(long_recent_bullish_fvg["long_signals"]),
    "shortRecentBearishFvgBlocked": any(short_recent_bearish_fvg["short_signals"]),
}))
`;

const behaviorResult = spawnSync('python3', ['-c', behaviorHarness], {
  input: String(twoStageConfig.codeDefinition || ''),
  encoding: 'utf8',
});
assert.equal(
  behaviorResult.status,
  0,
  behaviorResult.stderr || behaviorResult.stdout || 'Two-stage Python behavior harness failed'
);
const behavior = JSON.parse(behaviorResult.stdout) as Record<string, unknown>;
assert.equal(behavior.longInsideEntry, true);
assert.deepEqual(behavior.longInsidePreAlert, [1, 2]);
assert.equal(behavior.shortInsideEntry, true);
assert.deepEqual(behavior.shortInsidePreAlert, [1, 2]);
assert.equal(behavior.longImmediateEntry, true);
assert.equal(behavior.shortImmediateEntry, true);
assert.equal(behavior.longImmediateFvgLookback, 3);
assert.equal(behavior.shortImmediateFvgLookback, 3);
assert.equal(behavior.longRecentBullishFvgBlocked, false);
assert.equal(behavior.shortRecentBearishFvgBlocked, false);
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
assert.match(
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
assert.match(
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
  /not self\._is_inside_candle\(df, scan_index, alert_index\)/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /"post_alert_guard": "no_candle_breaks_alert_low_before_entry"/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /"post_alert_guard": "no_candle_breaks_alert_high_before_entry"/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /"rule": "reject_buy_when_bullish_fvg_exists_in_recent_completed_candles"/
);
assert.match(
  String(twoStageConfig.codeDefinition || ''),
  /"rule": "reject_sell_when_bearish_fvg_exists_in_recent_completed_candles"/
);
assert.doesNotMatch(
  String(twoStageConfig.codeDefinition || ''),
  /"entry_alert_inside_guard": "entry_not_inside_alert_candle"/
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

const twoStageFvgConfig = buildTwoStageCandleBreakoutFvgConfirmationTemplateConfig();
const twoStageFvgProfile = buildStrategyTemplateAutomationProfile(twoStageFvgConfig);
const twoStageFvgParameters = twoStageFvgConfig.parameters as Record<string, unknown>;

assert.equal(twoStageFvgProfile.automationReady, true);
assert.equal(twoStageFvgProfile.tradePlan.long?.riskRewardRatio, 11);
assert.equal(twoStageFvgProfile.tradePlan.short?.riskRewardRatio, 11);
assert.equal(twoStageFvgProfile.tradeManagement?.trailingStop?.mode, 'custom_r_ladder');
assert.deepEqual(twoStageFvgProfile.tradeManagement?.trailingStop?.rules, [
  { whenProfitR: 4, moveStopToR: 1 },
  { whenProfitR: 9, moveStopToR: 4 },
  { whenProfitR: 11, moveStopToR: 9 },
]);
assert.equal(twoStageFvgParameters.requireFvgConfirmation, false);
assert.equal(twoStageFvgParameters.confirmFvgWhenPresent, true);
assert.equal(twoStageFvgParameters.fvgEntryRequiresContinuationClose, true);
assert.match(String(twoStageFvgConfig.entryLogic || ''), /bullish FVG/);
assert.match(String(twoStageFvgConfig.entryShortLogic || ''), /bearish FVG/);
assert.match(
  String(twoStageFvgConfig.codeDefinition || ''),
  /class TwoStageCandleBreakoutFvgConfirmation11Ladder\(Strategy\):/
);
assert.match(String(twoStageFvgConfig.codeDefinition || ''), /def _find_bullish_fvg/);
assert.match(String(twoStageFvgConfig.codeDefinition || ''), /def _find_bearish_fvg/);
assert.match(String(twoStageFvgConfig.codeDefinition || ''), /def _long_fvg_confirmation_status/);
assert.match(String(twoStageFvgConfig.codeDefinition || ''), /def _short_fvg_confirmation_status/);
assert.match(String(twoStageFvgConfig.codeDefinition || ''), /"fvg_confirmation":/);
assert.match(
  String(twoStageFvgConfig.codeDefinition || ''),
  /"retest_rule": "when_bullish_fvg_forms_price_must_touch_the_fvg_zone"/
);
assert.match(
  String(twoStageFvgConfig.codeDefinition || ''),
  /"retest_rule": "when_bearish_fvg_forms_price_must_touch_the_fvg_zone"/
);

const fvgBehaviorHarness = String.raw`
import json
import sys
import types

auralpha = types.ModuleType("auralpha")

class Strategy:
    pass

auralpha.Strategy = Strategy
sys.modules["auralpha"] = auralpha

namespace = {}
exec(sys.stdin.read(), namespace)
StrategyClass = namespace["TwoStageCandleBreakoutFvgConfirmation11Ladder"]

class FakeSeries:
    def __init__(self, values):
        self.values = values
        self.iloc = self

    def __getitem__(self, index):
        return self.values[index]

class FakeFrame:
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __contains__(self, key):
        return key in self.rows[0]

    def __getitem__(self, key):
        return FakeSeries([row[key] for row in self.rows])

def run(rows):
    strategy = StrategyClass()
    df = FakeFrame(rows)
    strategy.prepare(df)
    return {
        "long_signals": strategy._long_signals,
        "short_signals": strategy._short_signals,
        "long_plans": strategy._long_plans,
        "short_plans": strategy._short_plans,
    }

long_confirmed = run([
    {"open": 105, "high": 106, "low": 99, "close": 100},
    {"open": 101, "high": 105, "low": 100, "close": 103},
    {"open": 108, "high": 112, "low": 107, "close": 111},
    {"open": 109, "high": 110, "low": 107, "close": 108},
    {"open": 109, "high": 113, "low": 107, "close": 112},
])

long_without_fvg = run([
    {"open": 105, "high": 106, "low": 99, "close": 100},
    {"open": 101, "high": 105, "low": 100, "close": 103},
    {"open": 104, "high": 112, "low": 104, "close": 111},
    {"open": 109, "high": 110, "low": 104, "close": 108},
    {"open": 109, "high": 113, "low": 108, "close": 112},
])

long_unconfirmed_fvg = run([
    {"open": 105, "high": 106, "low": 99, "close": 100},
    {"open": 101, "high": 105, "low": 100, "close": 103},
    {"open": 108, "high": 112, "low": 107, "close": 111},
    {"open": 109, "high": 110, "low": 107, "close": 108.5},
    {"open": 109, "high": 113, "low": 108, "close": 112},
])

short_confirmed = run([
    {"open": 100, "high": 106, "low": 99, "close": 105},
    {"open": 104, "high": 105, "low": 100, "close": 102},
    {"open": 98, "high": 98, "low": 96, "close": 96.5},
    {"open": 97.2, "high": 98, "low": 97, "close": 97.8},
    {"open": 97.5, "high": 98, "low": 95, "close": 96},
])

short_without_fvg = run([
    {"open": 100, "high": 106, "low": 99, "close": 105},
    {"open": 104, "high": 105, "low": 100, "close": 102},
    {"open": 100, "high": 100, "low": 96, "close": 96.5},
    {"open": 97.2, "high": 98, "low": 97, "close": 97.8},
    {"open": 97.5, "high": 98, "low": 95, "close": 96},
])

short_unconfirmed_fvg = run([
    {"open": 100, "high": 106, "low": 99, "close": 105},
    {"open": 104, "high": 105, "low": 100, "close": 102},
    {"open": 98, "high": 98, "low": 96, "close": 96.5},
    {"open": 95.2, "high": 97.8, "low": 95.2, "close": 97.5},
    {"open": 97.4, "high": 97.6, "low": 94, "close": 94.5},
])

print(json.dumps({
    "longConfirmed": long_confirmed["long_signals"][4],
    "longFvgSide": long_confirmed["long_plans"][4]["metadata"]["fvg_confirmation"]["side"],
    "longFvgMode": long_confirmed["long_plans"][4]["metadata"]["fvg_confirmation"]["mode"],
    "longWithoutFvg": any(long_without_fvg["long_signals"]),
    "longUnconfirmedFvg": any(long_unconfirmed_fvg["long_signals"]),
    "shortConfirmed": short_confirmed["short_signals"][4],
    "shortFvgSide": short_confirmed["short_plans"][4]["metadata"]["fvg_confirmation"]["side"],
    "shortFvgMode": short_confirmed["short_plans"][4]["metadata"]["fvg_confirmation"]["mode"],
    "shortWithoutFvg": any(short_without_fvg["short_signals"]),
    "shortUnconfirmedFvg": any(short_unconfirmed_fvg["short_signals"]),
}))
`;

const fvgBehaviorResult = spawnSync('python3', ['-c', fvgBehaviorHarness], {
  input: String(twoStageFvgConfig.codeDefinition || ''),
  encoding: 'utf8',
});
assert.equal(
  fvgBehaviorResult.status,
  0,
  fvgBehaviorResult.stderr || fvgBehaviorResult.stdout || 'FVG Python behavior harness failed'
);
const fvgBehavior = JSON.parse(fvgBehaviorResult.stdout) as Record<string, unknown>;
assert.equal(fvgBehavior.longConfirmed, true);
assert.equal(fvgBehavior.longFvgSide, 'bullish');
assert.equal(fvgBehavior.longFvgMode, 'conditional_required_when_fvg_forms');
assert.equal(fvgBehavior.longWithoutFvg, true);
assert.equal(fvgBehavior.longUnconfirmedFvg, false);
assert.equal(fvgBehavior.shortConfirmed, true);
assert.equal(fvgBehavior.shortFvgSide, 'bearish');
assert.equal(fvgBehavior.shortFvgMode, 'conditional_required_when_fvg_forms');
assert.equal(fvgBehavior.shortWithoutFvg, true);
assert.equal(fvgBehavior.shortUnconfirmedFvg, false);

const displacementConfig = buildDisplacementPullbackContinuationTemplateConfig();
const displacementProfile = buildStrategyTemplateAutomationProfile(displacementConfig);
const displacementRisk = displacementConfig.risk as Record<string, unknown>;
const displacementParameters = displacementConfig.parameters as Record<string, unknown>;

assert.equal(displacementProfile.automationReady, true);
assert.deepEqual(displacementProfile.supports, {
  long: true,
  short: true,
  customPython: true,
  ruleBased: false,
});
assert.equal(displacementProfile.tradePlan.long?.stopLossMode, 'dynamic_pullback_extreme');
assert.equal(displacementProfile.tradePlan.short?.stopLossMode, 'dynamic_pullback_extreme');
assert.equal(displacementProfile.tradePlan.long?.takeProfitMode, 'dynamic_r_multiple');
assert.equal(displacementProfile.tradePlan.short?.takeProfitMode, 'dynamic_r_multiple');
assert.equal(displacementProfile.tradePlan.long?.riskRewardRatio, 5);
assert.equal(displacementProfile.tradePlan.short?.riskRewardRatio, 5);
assert.equal(displacementProfile.execution.useClosedCandlesOnly, true);
assert.equal(displacementProfile.tradeManagement?.trailingStop?.mode, 'custom_r_ladder');
assert.deepEqual(displacementProfile.tradeManagement?.trailingStop?.rules, [
  { whenProfitR: 5, moveStopToR: 3 },
  { whenProfitR: 6, moveStopToR: 4 },
]);
assert.equal(displacementRisk.riskRewardRatio, 5);
assert.equal(displacementParameters.displacementBodyMult, 2.0);
assert.equal(displacementParameters.breakoutLookbackBars, 3);
assert.equal(displacementParameters.minDisplacementRangeMult, 1.3);
assert.equal(displacementParameters.minDisplacementBodyToRange, 0.55);
assert.equal(displacementParameters.minBreakoutCloseRangeMult, 0.15);
assert.equal(displacementParameters.requireContinuationStructureBreak, true);
assert.equal(displacementParameters.maxPullbackBars, 10);
assert.equal(displacementParameters.trendContextBars, 28);
assert.equal(displacementParameters.trendMinSlopeR, 1.2);
assert.equal(displacementParameters.trendMinDirectionalCloses, 0.45);
assert.equal(displacementParameters.minTrendRangeR, 3.0);
assert.equal(displacementParameters.compressionBars, 5);
assert.equal(displacementParameters.compressionMinSmallBodies, 2);
assert.equal(displacementParameters.maxChopDirectionChangeRatio, 0.75);
assert.equal(displacementParameters.minTargetRoomR, 2.0);
assert.match(String(displacementConfig.entryLogic || ''), /clean uptrend context/);
assert.match(String(displacementConfig.entryShortLogic || ''), /clean downtrend context/);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /class DisplacementPullbackContinuation\(Strategy\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _is_bearish_displacement\(self, df, index\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _breakout_lookback_bars\(self\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _breakout_range\(self, df, index\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _displacement_quality_ok\(self, df, index\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _trend_context_ok_for_short\(self, df, index\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _compression_ok\(self, df, index\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _no_chop_context_ok\(self, df, index\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _target_room_r\(self, df, entry_index, risk_distance\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _apply_one_position_filter\(self, df\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _require_continuation_structure_break\(self\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /def _scan_short_entry_after_pullback\(self, df, pullback_start_index\):/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /"pullback_guard": "pullback_stays_inside_trend_context_high"/
);
assert.match(
  String(displacementConfig.codeDefinition || ''),
  /"pullback_guard": "pullback_stays_inside_trend_context_low"/
);
assert.match(String(displacementConfig.codeDefinition || ''), /"target_room"/);

const displacementBehaviorHarness = String.raw`
import json
import sys
import types

auralpha = types.ModuleType("auralpha")

class Strategy:
    pass

auralpha.Strategy = Strategy
sys.modules["auralpha"] = auralpha

namespace = {}
exec(sys.stdin.read(), namespace)
StrategyClass = namespace["DisplacementPullbackContinuation"]

class FakeSeries:
    def __init__(self, values):
        self.values = values
        self.iloc = self

    def __getitem__(self, index):
        return self.values[index]

class FakeFrame:
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __contains__(self, key):
        return key in self.rows[0]

    def __getitem__(self, key):
        return FakeSeries([row[key] for row in self.rows])

def run(rows):
    strategy = StrategyClass()
    df = FakeFrame(rows)
    strategy.prepare(df)
    return {
        "long_signals": strategy._long_signals,
        "short_signals": strategy._short_signals,
        "long_plans": strategy._long_plans,
        "short_plans": strategy._short_plans,
    }

short_setup = run([
    {"open": 100.4, "high": 100.6, "low": 100.0, "close": 100.2},
    {"open": 100.2, "high": 100.4, "low": 99.8, "close": 100.0},
    {"open": 100.0, "high": 100.3, "low": 99.7, "close": 99.9},
    {"open": 99.9, "high": 100.1, "low": 99.6, "close": 99.7},
    {"open": 99.7, "high": 100.0, "low": 99.5, "close": 99.8},
    {"open": 99.8, "high": 99.9, "low": 99.4, "close": 99.6},
    {"open": 99.6, "high": 99.7, "low": 97.6, "close": 97.9},
    {"open": 97.9, "high": 98.6, "low": 97.8, "close": 98.3},
    {"open": 98.3, "high": 98.4, "low": 97.1, "close": 97.3},
])

long_setup = run([
    {"open": 99.6, "high": 100.0, "low": 99.4, "close": 99.8},
    {"open": 99.8, "high": 100.2, "low": 99.6, "close": 100.0},
    {"open": 100.0, "high": 100.3, "low": 99.8, "close": 100.1},
    {"open": 100.1, "high": 100.4, "low": 100.0, "close": 100.3},
    {"open": 100.3, "high": 100.5, "low": 100.1, "close": 100.2},
    {"open": 100.2, "high": 100.6, "low": 100.1, "close": 100.4},
    {"open": 100.4, "high": 102.4, "low": 100.3, "close": 102.1},
    {"open": 102.1, "high": 102.2, "low": 101.4, "close": 101.7},
    {"open": 101.7, "high": 102.9, "low": 101.6, "close": 102.7},
])

local_breakout_short_setup = run([
    {"open": 102.0, "high": 102.5, "low": 98.0, "close": 101.8},
    {"open": 101.8, "high": 102.0, "low": 101.4, "close": 101.6},
    {"open": 101.6, "high": 101.8, "low": 101.2, "close": 101.4},
    {"open": 101.4, "high": 101.6, "low": 101.0, "close": 101.2},
    {"open": 101.2, "high": 101.5, "low": 100.9, "close": 101.0},
    {"open": 101.0, "high": 101.2, "low": 100.7, "close": 100.9},
    {"open": 100.9, "high": 101.1, "low": 100.6, "close": 100.8},
    {"open": 100.8, "high": 101.0, "low": 100.5, "close": 100.7},
    {"open": 100.7, "high": 100.8, "low": 98.2, "close": 98.5},
    {"open": 98.5, "high": 99.2, "low": 98.4, "close": 98.9},
    {"open": 98.9, "high": 99.0, "low": 97.9, "close": 98.1},
])

local_breakout_long_setup = run([
    {"open": 98.0, "high": 102.5, "low": 97.5, "close": 98.2},
    {"open": 98.2, "high": 98.6, "low": 98.0, "close": 98.4},
    {"open": 98.4, "high": 98.8, "low": 98.2, "close": 98.6},
    {"open": 98.6, "high": 99.0, "low": 98.4, "close": 98.8},
    {"open": 98.8, "high": 99.2, "low": 98.6, "close": 99.0},
    {"open": 99.0, "high": 99.3, "low": 98.8, "close": 99.1},
    {"open": 99.1, "high": 99.4, "low": 98.9, "close": 99.2},
    {"open": 99.2, "high": 99.5, "low": 99.0, "close": 99.3},
    {"open": 99.3, "high": 101.8, "low": 99.2, "close": 101.5},
    {"open": 101.5, "high": 101.6, "low": 100.8, "close": 101.1},
    {"open": 101.1, "high": 102.1, "low": 101.0, "close": 101.9},
])

print(json.dumps({
    "shortEntry": short_setup["short_signals"][8],
    "shortPattern": short_setup["short_plans"][8]["metadata"]["pattern"],
    "shortPullback": short_setup["short_plans"][8]["metadata"]["pullback_indexes"],
    "longEntry": long_setup["long_signals"][8],
    "longPattern": long_setup["long_plans"][8]["metadata"]["pattern"],
    "longPullback": long_setup["long_plans"][8]["metadata"]["pullback_indexes"],
    "localBreakoutShortEntry": local_breakout_short_setup["short_signals"][10],
    "localBreakoutLongEntry": local_breakout_long_setup["long_signals"][10],
}))
`;

const displacementBehaviorResult = spawnSync('python3', ['-c', displacementBehaviorHarness], {
  input: String(displacementConfig.codeDefinition || ''),
  encoding: 'utf8',
});
assert.equal(
  displacementBehaviorResult.status,
  0,
  displacementBehaviorResult.stderr ||
    displacementBehaviorResult.stdout ||
    'Displacement pullback Python behavior harness failed'
);
const displacementBehavior = JSON.parse(displacementBehaviorResult.stdout) as Record<
  string,
  unknown
>;
assert.equal(displacementBehavior.shortEntry, true);
assert.equal(displacementBehavior.shortPattern, 'bearish_visual_trend_pullback_short_continuation');
assert.deepEqual(displacementBehavior.shortPullback, [7]);
assert.equal(displacementBehavior.longEntry, true);
assert.equal(displacementBehavior.longPattern, 'bullish_visual_trend_pullback_long_continuation');
assert.deepEqual(displacementBehavior.longPullback, [7]);
assert.equal(displacementBehavior.localBreakoutShortEntry, true);
assert.equal(displacementBehavior.localBreakoutLongEntry, true);

const fvgFakeoutConfig = buildFvgFakeoutContinuationTemplateConfig();
const fvgFakeoutProfile = buildStrategyTemplateAutomationProfile(fvgFakeoutConfig);
const fvgFakeoutRisk = fvgFakeoutConfig.risk as Record<string, unknown>;
const fvgFakeoutParameters = fvgFakeoutConfig.parameters as Record<string, unknown>;

assert.equal(fvgFakeoutProfile.automationReady, true);
assert.deepEqual(fvgFakeoutProfile.supports, {
  long: true,
  short: true,
  customPython: true,
  ruleBased: false,
});
assert.equal(fvgFakeoutProfile.tradePlan.long?.stopLossMode, 'dynamic_fvg_fakeout_extreme');
assert.equal(fvgFakeoutProfile.tradePlan.short?.stopLossMode, 'dynamic_fvg_fakeout_extreme');
assert.equal(fvgFakeoutProfile.tradePlan.long?.takeProfitMode, 'dynamic_r_multiple');
assert.equal(fvgFakeoutProfile.tradePlan.short?.takeProfitMode, 'dynamic_r_multiple');
assert.equal(fvgFakeoutProfile.tradePlan.long?.riskRewardRatio, 4);
assert.equal(fvgFakeoutProfile.tradePlan.short?.riskRewardRatio, 4);
assert.equal(fvgFakeoutProfile.execution.useClosedCandlesOnly, true);
assert.equal(fvgFakeoutProfile.tradeManagement?.trailingStop?.mode, 'custom_r_ladder');
assert.deepEqual(fvgFakeoutProfile.tradeManagement?.trailingStop?.rules, [
  { whenProfitR: 2, moveStopToR: 0 },
]);
assert.equal(fvgFakeoutRisk.riskRewardRatio, 4);
assert.equal(fvgFakeoutParameters.rewardR, 4);
assert.equal(fvgFakeoutParameters.minCompressionBars, 2);
assert.equal(fvgFakeoutParameters.maxEntryBarsAfterSweep, 4);
assert.match(String(fvgFakeoutConfig.entryLogic || ''), /fake-break below compression low/);
assert.match(String(fvgFakeoutConfig.entryShortLogic || ''), /fake-break above compression high/);
assert.match(
  String(fvgFakeoutConfig.codeDefinition || ''),
  /class FvgFakeoutContinuation\(Strategy\):/
);
assert.match(String(fvgFakeoutConfig.codeDefinition || ''), /def _bullish_fvg\(self, df, index\):/);
assert.match(String(fvgFakeoutConfig.codeDefinition || ''), /def _bearish_fvg\(self, df, index\):/);
assert.match(
  String(fvgFakeoutConfig.codeDefinition || ''),
  /def _valid_long_sweep_rejection\(self, df, sweep_index, compression_low, fvg\):/
);
assert.match(
  String(fvgFakeoutConfig.codeDefinition || ''),
  /def _valid_short_sweep_rejection\(self, df, sweep_index, compression_high, fvg\):/
);

const fvgFakeoutBehaviorHarness = String.raw`
import json
import sys
import types

auralpha = types.ModuleType("auralpha")

class Strategy:
    pass

auralpha.Strategy = Strategy
sys.modules["auralpha"] = auralpha

namespace = {}
exec(sys.stdin.read(), namespace)
StrategyClass = namespace["FvgFakeoutContinuation"]

class FakeSeries:
    def __init__(self, values):
        self.values = values
        self.iloc = self

    def __getitem__(self, index):
        return self.values[index]

class FakeFrame:
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __contains__(self, key):
        return key in self.rows[0]

    def __getitem__(self, key):
        return FakeSeries([row[key] for row in self.rows])

def run(rows):
    strategy = StrategyClass()
    df = FakeFrame(rows)
    strategy.prepare(df)
    return {
        "long_signals": strategy._long_signals,
        "short_signals": strategy._short_signals,
        "long_plans": strategy._long_plans,
        "short_plans": strategy._short_plans,
    }

long_setup = run([
    {"open": 98.5, "high": 100.0, "low": 97.0, "close": 99.0},
    {"open": 99.0, "high": 100.5, "low": 98.5, "close": 99.5},
    {"open": 101.2, "high": 104.0, "low": 101.0, "close": 103.8},
    {"open": 103.6, "high": 103.9, "low": 102.8, "close": 103.2},
    {"open": 103.1, "high": 103.5, "low": 102.6, "close": 103.3},
    {"open": 103.2, "high": 103.4, "low": 100.5, "close": 102.8},
    {"open": 102.9, "high": 104.5, "low": 102.7, "close": 104.2},
])

short_setup = run([
    {"open": 102.0, "high": 103.0, "low": 101.0, "close": 102.2},
    {"open": 102.2, "high": 102.5, "low": 101.0, "close": 101.8},
    {"open": 99.5, "high": 100.0, "low": 96.5, "close": 97.0},
    {"open": 97.2, "high": 98.2, "low": 96.8, "close": 97.8},
    {"open": 97.8, "high": 98.4, "low": 97.0, "close": 97.5},
    {"open": 97.6, "high": 100.5, "low": 97.4, "close": 98.1},
    {"open": 98.0, "high": 98.2, "low": 96.0, "close": 96.5},
])

print(json.dumps({
    "longEntry": long_setup["long_signals"][6],
    "longPattern": long_setup["long_plans"][6]["metadata"]["pattern"],
    "longFvgSide": long_setup["long_plans"][6]["metadata"]["fvg"]["side"],
    "longStopBasis": long_setup["long_plans"][6]["metadata"]["stop_basis"],
    "shortEntry": short_setup["short_signals"][6],
    "shortPattern": short_setup["short_plans"][6]["metadata"]["pattern"],
    "shortFvgSide": short_setup["short_plans"][6]["metadata"]["fvg"]["side"],
    "shortStopBasis": short_setup["short_plans"][6]["metadata"]["stop_basis"],
}))
`;

const fvgFakeoutBehaviorResult = spawnSync('python3', ['-c', fvgFakeoutBehaviorHarness], {
  input: String(fvgFakeoutConfig.codeDefinition || ''),
  encoding: 'utf8',
});
assert.equal(
  fvgFakeoutBehaviorResult.status,
  0,
  fvgFakeoutBehaviorResult.stderr ||
    fvgFakeoutBehaviorResult.stdout ||
    'FVG fakeout continuation Python behavior harness failed'
);
const fvgFakeoutBehavior = JSON.parse(fvgFakeoutBehaviorResult.stdout) as Record<string, unknown>;
assert.equal(fvgFakeoutBehavior.longEntry, true);
assert.equal(
  fvgFakeoutBehavior.longPattern,
  'bullish_displacement_compression_fakeout_fvg_rejection_continuation'
);
assert.equal(fvgFakeoutBehavior.longFvgSide, 'bullish');
assert.equal(fvgFakeoutBehavior.longStopBasis, 'fake_breakout_low_buffered');
assert.equal(fvgFakeoutBehavior.shortEntry, true);
assert.equal(
  fvgFakeoutBehavior.shortPattern,
  'bearish_displacement_compression_fakeout_fvg_rejection_continuation'
);
assert.equal(fvgFakeoutBehavior.shortFvgSide, 'bearish');
assert.equal(fvgFakeoutBehavior.shortStopBasis, 'fake_breakout_high_buffered');

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
