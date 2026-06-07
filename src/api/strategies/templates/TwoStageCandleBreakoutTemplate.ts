import { buildStrategyTemplateAutomationProfile } from '../../utils/strategyTemplateAutomation';

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_NAME = 'Two-Stage Candle Breakout 1:4 BE Ladder';

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_LEGACY_NAMES = [
  'Two-Stage Candle Breakout 1:11 SL Ladder',
  'Two-Stage Candle Breakout 1:4',
  'Two-Stage Candle Breakout 1:6',
] as const;

export const TWO_STAGE_CANDLE_BREAKOUT_TEMPLATE_DESCRIPTION =
  'Loose red/green or green/red pullback flow. Internal candles are allowed between Candle 1 and alert as long as they stay inside Candle 1 range. Entry is on the pullback confirmation candle midpoint, inside entry candles are allowed, but no candle may break the alert low/high before entry. Stop is buffered beyond the second setup candle, target is 1:4, and the SL ladder moves to cost-to-cost at 2R.';

export const TWO_STAGE_CANDLE_BREAKOUT_PYTHON_CODE = String.raw`from auralpha import Strategy


class TwoStageCandleBreakout4BELadder(Strategy):
    name = "Two-Stage Candle Breakout 1:4 BE Ladder"
    market = "crypto-futures"
    timeframe = "automation"

    params = {
        "reward_r": 4,
        "stop_buffer_pct": 0.0005,
    }

    risk = {
        "max_per_trade": 1,
        "signal_threshold": 0.65,
        "stopLossMode": "dynamic_second_stage_candle",
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

    def _find_long_alert(self, df, first_red_index):
        first_red_low = self._low(df, first_red_index)
        first_red_high = self._high(df, first_red_index)
        scan_index = first_red_index + 1
        inside_indexes = []

        while scan_index < len(df):
            candle_low = self._low(df, scan_index)
            candle_high = self._high(df, scan_index)

            if candle_low < first_red_low:
                return None, inside_indexes

            if self._is_green(df, scan_index) and self._close(df, scan_index) > first_red_high:
                return scan_index, inside_indexes

            if candle_high > first_red_high:
                return None, inside_indexes

            inside_indexes.append(scan_index)
            scan_index += 1

        return None, inside_indexes

    def _find_short_alert(self, df, first_green_index):
        first_green_high = self._high(df, first_green_index)
        first_green_low = self._low(df, first_green_index)
        scan_index = first_green_index + 1
        inside_indexes = []

        while scan_index < len(df):
            candle_high = self._high(df, scan_index)
            candle_low = self._low(df, scan_index)

            if candle_high > first_green_high:
                return None, inside_indexes

            if self._is_red(df, scan_index) and self._close(df, scan_index) < first_green_low:
                return scan_index, inside_indexes

            if candle_low < first_green_low:
                return None, inside_indexes

            inside_indexes.append(scan_index)
            scan_index += 1

        return None, inside_indexes

    def _build_long_signals(self, df):
        total = len(df)
        index = 0

        while index < total - 3:
            if not self._is_red(df, index):
                index += 1
                continue

            first_red_index = index
            alert_index, pre_alert_inside_indexes = self._find_long_alert(df, first_red_index)

            if alert_index is None:
                index += 1
                continue

            alert_low = self._low(df, alert_index)
            second_red_index = None
            scan_index = alert_index + 1
            found_entry = False

            while scan_index < total:
                if self._low(df, scan_index) < alert_low:
                    break

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
                            alert_index,
                            second_red_index,
                            pre_alert_inside_indexes,
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
            alert_index, pre_alert_inside_indexes = self._find_short_alert(df, first_green_index)

            if alert_index is None:
                index += 1
                continue

            alert_high = self._high(df, alert_index)
            second_green_index = None
            scan_index = alert_index + 1
            found_entry = False

            while scan_index < total:
                if self._high(df, scan_index) > alert_high:
                    break

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
                            alert_index,
                            second_green_index,
                            pre_alert_inside_indexes,
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
        alert_index,
        second_red_index,
        pre_alert_inside_indexes,
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
                "alert_index": alert_index,
                "second_red_index": second_red_index,
                "entry_index": entry_index,
                "pre_alert_inside_indexes": pre_alert_inside_indexes,
                "entry_basis": "second_green_midpoint",
                "stop_basis": "second_red_low",
                "target_basis": "entry_plus_4r",
                "candle_1_guard": "pre_alert_candles_stay_inside_candle_1_range",
                "structure_guard": "alert_low",
                "post_alert_guard": "no_candle_breaks_alert_low_before_entry",
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
        alert_index,
        second_green_index,
        pre_alert_inside_indexes,
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
                "alert_index": alert_index,
                "second_green_index": second_green_index,
                "entry_index": entry_index,
                "pre_alert_inside_indexes": pre_alert_inside_indexes,
                "entry_basis": "second_red_midpoint",
                "stop_basis": "second_green_high",
                "target_basis": "entry_minus_4r",
                "candle_1_guard": "pre_alert_candles_stay_inside_candle_1_range",
                "structure_guard": "alert_high",
                "post_alert_guard": "no_candle_breaks_alert_high_before_entry",
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
      'Buy: red candle 1, then zero or more internal candles that stay inside Candle 1 range. The alert is the first green candle that does not break Candle 1 low and closes above Candle 1 high. After the alert, no candle may break the alert low before entry. Any later red pullback may form; the first green after that red pullback must not break that red low and triggers entry at the green midpoint. Entry candles may be inside the alert candle. Candle 1 freshness is intentionally not used and same-direction continuation before pullback is allowed.',
    exitLogic:
      'Long exit is managed by dynamic second-red stop, 1:4 target, and custom SL ladder: 2R moves SL to cost-to-cost.',
    entryShortLogic:
      'Sell: green candle 1, then zero or more internal candles that stay inside Candle 1 range. The alert is the first red candle that does not break Candle 1 high and closes below Candle 1 low. After the alert, no candle may break the alert high before entry. Any later green pullback may form; the first red after that green pullback must not break that green high and triggers entry at the red midpoint. Entry candles may be inside the alert candle. Candle 1 freshness is intentionally not used and same-direction continuation before pullback is allowed.',
    exitShortLogic:
      'Short exit is managed by dynamic second-green stop, 1:4 target, and custom SL ladder: 2R moves SL to cost-to-cost.',
    shortEnabled: true,
    risk: {
      maxRisk: '1',
      max_per_trade: 1,
      signal_threshold: 0.65,
      stopLossMode: 'dynamic_second_stage_candle',
      stop_loss_mode: 'dynamic_second_stage_candle',
      takeProfitMode: 'dynamic_r_multiple',
      take_profit_mode: 'dynamic_r_multiple',
      riskRewardRatio: 4,
      risk_reward_ratio: 4,
      sizingNotes:
        'Per-trade stop and target are emitted by the Python entry plan: long entry at second green midpoint with stop buffered below second red low, short entry at second red midpoint with stop buffered above second green high, pre-alert internal candles must stay inside Candle 1 range, inside entry candles are allowed, post-alert candles cannot break the alert low/high before entry, target at 4R. Custom R ladder moves SL to cost-to-cost at +2R.',
    },
    parameters: {
      signalThreshold: '0.65',
      signal_threshold: 0.65,
      rewardR: 4,
      reward_r: 4,
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
          { whenProfitR: 2, moveStopToR: 0 },
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
      'Signals require closed candles. Candle 1 and alert do not need to be immediate; any candles between them must stay inside Candle 1 high/low until the alert break-and-close. Candle 1 freshness is intentionally disabled. After alert, same-direction continuation before pullback is allowed, inside entry candles are allowed, and the alert high/low guard remains active until entry. For buy, any post-alert candle that breaks alert low cancels the setup; for sell, any post-alert candle that breaks alert high cancels the setup. Once a pullback exists, the first opposite-color candidate must pass the candle-2 guard or the setup is cancelled. The old four-candle setup remains valid as the fastest case. Default stop buffer is 0.05% beyond candle 2. Target is 1:4. SL ladder: at 2R move SL to cost-to-cost.',
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
