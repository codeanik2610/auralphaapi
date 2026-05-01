import assert from 'node:assert/strict';
import { buildStrategyTemplateAutomationProfile } from '../src/api/utils/strategyTemplateAutomation';

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

console.log('Strategy template automation profile tests passed.');
