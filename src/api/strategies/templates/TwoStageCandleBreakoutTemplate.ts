import { buildStrategyTemplateAutomationProfile } from '../../utils/strategyTemplateAutomation';

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_NAME = 'Two-Stage Candle Breakout 1:4';

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_LEGACY_NAMES = [
  'Two-Stage Candle Breakout 1:6',
] as const;

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_DESCRIPTION =
  'Two-stage red/green or green/red candle flow. Entry is on the second confirmation candle close, stop is anchored to the first setup candle, and target is 1:4.';

export const TWO_STAGE_CANDLE_BREAKOUT_PYTHON_CODE = String.raw`from auralpha import Strategy


class TwoStageCandleBreakout14(Strategy):
    name = "Two-Stage Candle Breakout 1:4"
    market = "crypto-futures"
    timeframe = "automation"

    params = {
        "reward_r": 4,
        "stop_buffer_pct": 0.0,
    }

    risk = {
        "max_per_trade": 1,
        "signal_threshold": 0.65,
        "stopLossMode": "dynamic_first_stage_candle",
        "takeProfitMode": "dynamic_r_multiple",
        "risk_reward_ratio": 4,
    }

    def prepare(self, df):
        total = len(df)
        self._long_signals = [False] * total
        self._short_signals = [False] * total
        self._long_plans = [None] * total
        self._short_plans = [None] * total

        if total < 4:
            return None

        self._build_long_signals(df)
        self._build_short_signals(df)
        return None

    def entry(self, ctx):
        return ctx.index < len(self._long_signals) and self._long_signals[ctx.index]

    def exit(self, ctx):
        return False

    def entry_short(self, ctx):
        return ctx.index < len(self._short_signals) and self._short_signals[ctx.index]

    def exit_short(self, ctx):
        return False

    def entry_plan(self, ctx):
        if ctx.index < len(self._long_plans):
            return self._long_plans[ctx.index]
        return None

    def entry_short_plan(self, ctx):
        if ctx.index < len(self._short_plans):
            return self._short_plans[ctx.index]
        return None

    def _open(self, df, index):
        return float(df["open"].iloc[index])

    def _high(self, df, index):
        return float(df["high"].iloc[index])

    def _low(self, df, index):
        return float(df["low"].iloc[index])

    def _close(self, df, index):
        return float(df["close"].iloc[index])

    def _is_red(self, df, index):
        return self._close(df, index) < self._open(df, index)

    def _is_green(self, df, index):
        return self._close(df, index) > self._open(df, index)

    def _reward_r(self):
        value = float(self.params.get("reward_r", 4))
        if value <= 0:
            return 4.0
        return value

    def _stop_buffer_pct(self):
        value = float(self.params.get("stop_buffer_pct", 0.0))
        if value < 0:
            return 0.0
        return value

    def _build_long_signals(self, df):
        total = len(df)
        index = 0

        while index < total - 3:
            if not self._is_red(df, index):
                index += 1
                continue

            first_red_index = index
            first_red_low = self._low(df, first_red_index)
            first_red_high = self._high(df, first_red_index)
            first_green_index = first_red_index + 1

            if (
                first_green_index >= total
                or not self._is_green(df, first_green_index)
                or self._low(df, first_green_index) < first_red_low
                or self._close(df, first_green_index) <= first_red_high
            ):
                index += 1
                continue

            alert_index = first_green_index
            second_red_index = alert_index + 1
            found_entry = False

            while second_red_index < total - 1:
                if self._is_red(df, second_red_index):
                    second_green_index = second_red_index + 1
                    if (
                        self._is_green(df, second_green_index)
                        and self._low(df, second_green_index) >= self._low(df, second_red_index)
                    ):
                        if self._set_long_plan(
                            df,
                            second_green_index,
                            first_red_index,
                            first_green_index,
                            alert_index,
                            second_red_index,
                        ):
                            found_entry = True
                            index = second_green_index + 1
                            break
                second_red_index += 1

            if not found_entry:
                break

    def _build_short_signals(self, df):
        total = len(df)
        index = 0

        while index < total - 3:
            if not self._is_green(df, index):
                index += 1
                continue

            first_green_index = index
            first_green_high = self._high(df, first_green_index)
            first_green_low = self._low(df, first_green_index)
            first_red_index = first_green_index + 1

            if (
                first_red_index >= total
                or not self._is_red(df, first_red_index)
                or self._high(df, first_red_index) > first_green_high
                or self._close(df, first_red_index) >= first_green_low
            ):
                index += 1
                continue

            alert_index = first_red_index
            second_green_index = alert_index + 1
            found_entry = False

            while second_green_index < total - 1:
                if self._is_green(df, second_green_index):
                    second_red_index = second_green_index + 1
                    if (
                        self._is_red(df, second_red_index)
                        and self._high(df, second_red_index) <= self._high(df, second_green_index)
                    ):
                        if self._set_short_plan(
                            df,
                            second_red_index,
                            first_green_index,
                            first_red_index,
                            alert_index,
                            second_green_index,
                        ):
                            found_entry = True
                            index = second_red_index + 1
                            break
                second_green_index += 1

            if not found_entry:
                break

    def _set_long_plan(
        self,
        df,
        entry_index,
        first_red_index,
        first_green_index,
        alert_index,
        second_red_index,
    ):
        entry_price = self._close(df, entry_index)
        stop_loss_price = self._low(df, first_red_index) * (1.0 - self._stop_buffer_pct())
        risk_distance = entry_price - stop_loss_price
        if risk_distance <= 0:
            return False

        reward_r = self._reward_r()
        take_profit_price = entry_price + reward_r * risk_distance
        self._long_signals[entry_index] = True
        self._long_plans[entry_index] = {
            "entry_price": entry_price,
            "stop_loss_price": stop_loss_price,
            "take_profit_price": take_profit_price,
            "risk_reward_ratio": reward_r,
            "label": "two_stage_candle_breakout_long",
            "metadata": {
                "pattern": "red_green_alert_red_green",
                "first_red_index": first_red_index,
                "first_green_index": first_green_index,
                "alert_index": alert_index,
                "second_red_index": second_red_index,
                "entry_index": entry_index,
                "stop_basis": "first_red_low",
                "target_basis": "entry_plus_4r",
            },
        }
        return True

    def _set_short_plan(
        self,
        df,
        entry_index,
        first_green_index,
        first_red_index,
        alert_index,
        second_green_index,
    ):
        entry_price = self._close(df, entry_index)
        stop_loss_price = self._high(df, first_green_index) * (1.0 + self._stop_buffer_pct())
        risk_distance = stop_loss_price - entry_price
        if risk_distance <= 0:
            return False

        reward_r = self._reward_r()
        take_profit_price = entry_price - reward_r * risk_distance
        self._short_signals[entry_index] = True
        self._short_plans[entry_index] = {
            "entry_price": entry_price,
            "stop_loss_price": stop_loss_price,
            "take_profit_price": take_profit_price,
            "risk_reward_ratio": reward_r,
            "label": "two_stage_candle_breakout_short",
            "metadata": {
                "pattern": "green_red_alert_green_red",
                "first_green_index": first_green_index,
                "first_red_index": first_red_index,
                "alert_index": alert_index,
                "second_green_index": second_green_index,
                "entry_index": entry_index,
                "stop_basis": "first_green_high",
                "target_basis": "entry_minus_4r",
            },
        }
        return True
`;

export function buildTwoStageCandleBreakoutTemplateConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {
    codeTarget: 'python',
    codeDefinition: TWO_STAGE_CANDLE_BREAKOUT_PYTHON_CODE,
    authoredCodeTarget: 'python',
    authoredCodeDefinition: TWO_STAGE_CANDLE_BREAKOUT_PYTHON_CODE,
    compiledCodeTarget: 'python',
    compiledCodeDefinition: TWO_STAGE_CANDLE_BREAKOUT_PYTHON_CODE,
    market: 'crypto-futures',
    entryLogic:
      'Buy: red candle, immediate next green does not break that red low and closes above the red high, then a second red/green hold pair triggers entry at green close.',
    exitLogic: 'Long exit is managed by dynamic first-red stop and 1:4 target.',
    entryShortLogic:
      'Sell: inverse flow with green candle, immediate next red does not break that green high and closes below the green low, then a second green/red hold pair triggers entry at red close.',
    exitShortLogic: 'Short exit is managed by dynamic first-green stop and 1:4 target.',
    shortEnabled: true,
    risk: {
      maxRisk: '1',
      max_per_trade: 1,
      signal_threshold: 0.65,
      stopLossMode: 'dynamic_first_stage_candle',
      stop_loss_mode: 'dynamic_first_stage_candle',
      takeProfitMode: 'dynamic_r_multiple',
      take_profit_mode: 'dynamic_r_multiple',
      riskRewardRatio: 4,
      risk_reward_ratio: 4,
      sizingNotes:
        'Per-trade stop and target are emitted by the Python entry plan: long stop below first red low, short stop above first green high, target at 4R.',
    },
    parameters: {
      signalThreshold: '0.65',
      signal_threshold: 0.65,
      rewardR: 4,
      reward_r: 4,
      stopBufferPct: 0,
      stop_buffer_pct: 0,
    },
    automation: {
      timeframePolicy: {
        evaluationTimeframe: 'automation',
        useClosedCandlesOnly: true,
        initialStopLossTimeframe: 'evaluation',
        targetTimeframe: 'evaluation',
      },
    },
    filters: {
      useAiFilter: false,
      useRegimeFilter: false,
      paperTradeFirst: true,
    },
    notes:
      'Signals require closed candles. The first confirmation candle must also be the alert candle.',
    description: TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_DESCRIPTION,
  };

  return {
    ...config,
    automationProfile: buildStrategyTemplateAutomationProfile(config),
  };
}

export function buildTwoStageCandleBreakoutTemplatePayload() {
  return {
    name: TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_NAME,
    description: TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_DESCRIPTION,
    status: 'Active' as const,
    config: buildTwoStageCandleBreakoutTemplateConfig(),
  };
}
