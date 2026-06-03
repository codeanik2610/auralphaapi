import { buildStrategyTemplateAutomationProfile } from '../../utils/strategyTemplateAutomation';

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_NAME = 'Two-Stage Candle Breakout 1:11 SL Ladder';

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_LEGACY_NAMES = [
  'Two-Stage Candle Breakout 1:4',
  'Two-Stage Candle Breakout 1:6',
] as const;

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_DESCRIPTION =
  'Loose red/green or green/red pullback flow. Entry is on the pullback confirmation candle midpoint, stop is buffered beyond the second setup candle, target is 1:11, and SL ladders from 4R to 1R, 9R to 4R, and 11R to 9R.';

export const TWO_STAGE_CANDLE_BREAKOUT_PYTHON_CODE = String.raw`from auralpha import Strategy


class TwoStageCandleBreakout11Ladder(Strategy):
    name = "Two-Stage Candle Breakout 1:11 SL Ladder"
    market = "crypto-futures"
    timeframe = "automation"

    params = {
        "reward_r": 11,
        "stop_buffer_pct": 0.0005,
    }

    risk = {
        "max_per_trade": 1,
        "signal_threshold": 0.65,
        "stopLossMode": "dynamic_second_stage_candle",
        "takeProfitMode": "dynamic_r_multiple",
        "risk_reward_ratio": 11,
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

    def _mid(self, df, index):
        return (self._high(df, index) + self._low(df, index)) / 2.0

    def _is_red(self, df, index):
        return self._close(df, index) < self._open(df, index)

    def _is_green(self, df, index):
        return self._close(df, index) > self._open(df, index)

    def _time_ms(self, df, index):
        if "timestamp" not in df:
            return None

        value = df["timestamp"].iloc[index]
        try:
            return int(value.timestamp() * 1000)
        except Exception:
            return None

    def _setup_marker(self, df, label, role, candle_index, price):
        marker = {
            "label": label,
            "role": role,
            "candle_index": candle_index,
            "price": price,
        }
        time_ms = self._time_ms(df, candle_index)
        if time_ms is not None:
            marker["time"] = time_ms
        return marker

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
            alert_low = self._low(df, alert_index)
            second_red_index = None
            scan_index = alert_index + 1
            found_entry = False

            while scan_index < total:
                if self._is_red(df, scan_index):
                    second_red_index = scan_index
                    scan_index += 1
                    continue

                if second_red_index is not None and self._is_green(df, scan_index):
                    if (
                        self._low(df, scan_index) >= self._low(df, second_red_index)
                        and self._set_long_plan(
                            df,
                            scan_index,
                            first_red_index,
                            first_green_index,
                            alert_index,
                            second_red_index,
                        )
                    ):
                        found_entry = True
                        index = scan_index + 1
                        break

                    break

                scan_index += 1

            if not found_entry:
                index += 1

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
            alert_high = self._high(df, alert_index)
            second_green_index = None
            scan_index = alert_index + 1
            found_entry = False

            while scan_index < total:
                if self._is_green(df, scan_index):
                    second_green_index = scan_index
                    scan_index += 1
                    continue

                if second_green_index is not None and self._is_red(df, scan_index):
                    if (
                        self._high(df, scan_index) <= self._high(df, second_green_index)
                        and self._set_short_plan(
                            df,
                            scan_index,
                            first_green_index,
                            first_red_index,
                            alert_index,
                            second_green_index,
                        )
                    ):
                        found_entry = True
                        index = scan_index + 1
                        break

                    break

                scan_index += 1

            if not found_entry:
                index += 1

    def _set_long_plan(
        self,
        df,
        entry_index,
        first_red_index,
        first_green_index,
        alert_index,
        second_red_index,
    ):
        entry_price = self._mid(df, entry_index)
        stop_loss_price = self._low(df, second_red_index) * (1.0 - self._stop_buffer_pct())
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
                "pattern": "red_green_alert_guarded_pullback_green",
                "first_red_index": first_red_index,
                "first_green_index": first_green_index,
                "alert_index": alert_index,
                "second_red_index": second_red_index,
                "entry_index": entry_index,
                "entry_basis": "second_green_midpoint",
                "stop_basis": "second_red_low",
                "target_basis": "entry_plus_11r",
                "structure_guard": "alert_low",
                "alert_low": self._low(df, alert_index),
                "setup_markers": [
                    self._setup_marker(
                        df,
                        "1",
                        "candle_1",
                        first_red_index,
                        self._low(df, first_red_index),
                    ),
                    self._setup_marker(
                        df,
                        "2",
                        "candle_2",
                        second_red_index,
                        self._low(df, second_red_index),
                    ),
                ],
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
        entry_price = self._mid(df, entry_index)
        stop_loss_price = self._high(df, second_green_index) * (1.0 + self._stop_buffer_pct())
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
                "pattern": "green_red_alert_guarded_pullback_red",
                "first_green_index": first_green_index,
                "first_red_index": first_red_index,
                "alert_index": alert_index,
                "second_green_index": second_green_index,
                "entry_index": entry_index,
                "entry_basis": "second_red_midpoint",
                "stop_basis": "second_green_high",
                "target_basis": "entry_minus_11r",
                "structure_guard": "alert_high",
                "alert_high": self._high(df, alert_index),
                "setup_markers": [
                    self._setup_marker(
                        df,
                        "1",
                        "candle_1",
                        first_green_index,
                        self._high(df, first_green_index),
                    ),
                    self._setup_marker(
                        df,
                        "2",
                        "candle_2",
                        second_green_index,
                        self._high(df, second_green_index),
                    ),
                ],
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
      'Buy: red candle 1, immediate green alert that does not break the red low and closes above the red high, then any later red pullback may form; the first green after that red pullback must not break that red low and triggers entry at the green midpoint. Candle 1 freshness, same-direction continuation before pullback, and alert-low guard are intentionally not used.',
    exitLogic:
      'Long exit is managed by dynamic second-red stop, 1:11 target, and custom SL ladder: 4R locks 1R, 9R locks 4R, 11R locks 9R.',
    entryShortLogic:
      'Sell: green candle 1, immediate red alert that does not break the green high and closes below the green low, then any later green pullback may form; the first red after that green pullback must not break that green high and triggers entry at the red midpoint. Candle 1 freshness, same-direction continuation before pullback, and alert-high guard are intentionally not used.',
    exitShortLogic:
      'Short exit is managed by dynamic second-green stop, 1:11 target, and custom SL ladder: 4R locks 1R, 9R locks 4R, 11R locks 9R.',
    shortEnabled: true,
    risk: {
      maxRisk: '1',
      max_per_trade: 1,
      signal_threshold: 0.65,
      stopLossMode: 'dynamic_second_stage_candle',
      stop_loss_mode: 'dynamic_second_stage_candle',
      takeProfitMode: 'dynamic_r_multiple',
      take_profit_mode: 'dynamic_r_multiple',
      riskRewardRatio: 11,
      risk_reward_ratio: 11,
      sizingNotes:
        'Per-trade stop and target are emitted by the Python entry plan: long entry at second green midpoint with stop buffered below second red low, short entry at second red midpoint with stop buffered above second green high, target at 11R. Custom R ladder moves SL to +1R at +4R, +4R at +9R, and +9R at +11R.',
    },
    parameters: {
      signalThreshold: '0.65',
      signal_threshold: 0.65,
      rewardR: 11,
      reward_r: 11,
      stopBufferPct: 0.0005,
      stop_buffer_pct: 0.0005,
    },
    tradeManagement: {
      trailingStop: {
        enabled: true,
        mode: 'custom_r_ladder',
        basis: 'actual_fill',
        timeframe: '1m',
        updateOnlyInProfitDirection: true,
        rules: [
          { whenProfitR: 4, moveStopToR: 1 },
          { whenProfitR: 9, moveStopToR: 4 },
          { whenProfitR: 11, moveStopToR: 9 },
        ],
      },
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
      'Signals require closed candles. Candle 1 and alert must be immediate, but Candle 1 freshness is intentionally disabled. After alert, same-direction continuation before pullback is allowed and alert high/low guard is intentionally disabled. Once a pullback exists, the first opposite-color candidate must pass or the setup is cancelled. The old four-candle setup remains valid as the fastest case. Default stop buffer is 0.05% beyond candle 2. SL ladder: at 4R move SL to 1R, at 9R move SL to 4R, and at 11R move SL to 9R.',
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
