import { buildStrategyTemplateAutomationProfile } from '../../utils/strategyTemplateAutomation';

export const TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_TEMPLATE_NAME =
  'Two-Stage Candle Breakout 1:11 SL Ladder + Conditional FVG';

export const TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_TEMPLATE_LEGACY_NAMES = [
  'Two-Stage Candle Breakout 1:11 SL Ladder + FVG Confirmation',
  'Two-Stage Candle Breakout 1:11 SL Ladder + Optional FVG',
] as const;

export const TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_TEMPLATE_DESCRIPTION =
  'Two-stage candle breakout with conditional FVG confirmation. The original 1:11 SL ladder flow remains, FVG is not mandatory, but when a same-side FVG forms between Candle 1 and the planned entry window, entry waits until the FVG confirmation candle closes. Stop is buffered beyond the second setup candle, target is 1:11, and SL ladders from 4R to 1R, 9R to 4R, and 11R to 9R.';

export const TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_PYTHON_CODE = String.raw`from auralpha import Strategy


class TwoStageCandleBreakoutFvgConfirmation11Ladder(Strategy):
    name = "Two-Stage Candle Breakout 1:11 SL Ladder + Conditional FVG"
    market = "crypto-futures"
    timeframe = "automation"

    params = {
        "reward_r": 11,
        "stop_buffer_pct": 0.0005,
        "require_fvg_confirmation": False,
        "confirm_fvg_when_present": True,
        "fvg_min_gap_pct": 0.0,
        "fvg_retest_requires_close_respect": True,
        "fvg_entry_requires_continuation_close": True,
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

    def _param_bool(self, key, default):
        value = self.params.get(key, default)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ["1", "true", "yes", "y", "on"]
        return bool(value)

    def _require_fvg_confirmation(self):
        return self._param_bool("require_fvg_confirmation", False)

    def _confirm_fvg_when_present(self):
        return self._param_bool("confirm_fvg_when_present", True)

    def _fvg_min_gap_pct(self):
        value = float(self.params.get("fvg_min_gap_pct", 0.0))
        if value < 0:
            return 0.0
        return value

    def _fvg_retest_requires_close_respect(self):
        return self._param_bool("fvg_retest_requires_close_respect", True)

    def _fvg_entry_requires_continuation_close(self):
        return self._param_bool("fvg_entry_requires_continuation_close", True)

    def _zone_touched(self, df, index, lower, upper):
        return self._low(df, index) <= upper and self._high(df, index) >= lower

    def _find_bullish_fvg(self, df, start_index, end_index):
        min_gap_pct = self._fvg_min_gap_pct()
        scan_index = end_index

        while scan_index >= start_index + 2:
            first_index = scan_index - 2
            lower = self._high(df, first_index)
            upper = self._low(df, scan_index)

            if upper > lower:
                gap_pct = (upper - lower) / max(abs(lower), 0.000000001)
                if gap_pct >= min_gap_pct:
                    return {
                        "side": "bullish",
                        "first_index": first_index,
                        "middle_index": scan_index - 1,
                        "end_index": scan_index,
                        "lower": lower,
                        "upper": upper,
                        "gap_pct": gap_pct,
                    }

            scan_index -= 1

        return None

    def _find_bearish_fvg(self, df, start_index, end_index):
        min_gap_pct = self._fvg_min_gap_pct()
        scan_index = end_index

        while scan_index >= start_index + 2:
            first_index = scan_index - 2
            lower = self._high(df, scan_index)
            upper = self._low(df, first_index)

            if upper > lower:
                gap_pct = (upper - lower) / max(abs(upper), 0.000000001)
                if gap_pct >= min_gap_pct:
                    return {
                        "side": "bearish",
                        "first_index": first_index,
                        "middle_index": scan_index - 1,
                        "end_index": scan_index,
                        "lower": lower,
                        "upper": upper,
                        "gap_pct": gap_pct,
                    }

            scan_index -= 1

        return None

    def _base_fvg_status(self, fvg, side):
        has_fvg = fvg is not None
        required = self._require_fvg_confirmation() or (
            has_fvg and self._confirm_fvg_when_present()
        )
        mode = "not_present"
        if self._require_fvg_confirmation():
            mode = "mandatory"
        elif has_fvg and self._confirm_fvg_when_present():
            mode = "conditional_required_when_fvg_forms"
        elif has_fvg:
            mode = "optional_context"

        status = {
            "required": required,
            "mode": mode,
            "confirmed": not required,
            "invalid": False,
            "side": side if has_fvg else None,
            "first_index": fvg["first_index"] if has_fvg else None,
            "middle_index": fvg["middle_index"] if has_fvg else None,
            "end_index": fvg["end_index"] if has_fvg else None,
            "lower": fvg["lower"] if has_fvg else None,
            "upper": fvg["upper"] if has_fvg else None,
            "gap_pct": fvg["gap_pct"] if has_fvg else None,
            "retest_index": None,
            "confirmation_index": None,
            "failure_reason": None,
        }

        if required and not has_fvg:
            status["failure_reason"] = side + "_fvg_not_formed_yet"

        return status

    def _long_fvg_confirmation_status(self, df, fvg, entry_index):
        status = self._base_fvg_status(fvg, "bullish")
        if fvg is None or not status["required"]:
            return status

        lower = float(fvg["lower"])
        upper = float(fvg["upper"])
        scan_index = int(fvg["end_index"]) + 1

        while scan_index <= entry_index:
            if self._fvg_retest_requires_close_respect() and self._close(df, scan_index) < lower:
                status["invalid"] = True
                status["failure_reason"] = "bullish_fvg_closed_below_lower_before_confirmation"
                return status

            if status["retest_index"] is None and self._zone_touched(
                df,
                scan_index,
                lower,
                upper,
            ):
                status["retest_index"] = scan_index

            retest_index = status["retest_index"]
            if retest_index is not None and self._is_green(df, scan_index):
                if not self._fvg_entry_requires_continuation_close():
                    status["confirmed"] = True
                    status["confirmation_index"] = scan_index
                    status["failure_reason"] = None
                    return status

                closes_above_zone = self._close(df, scan_index) > upper
                closes_above_retest = (
                    scan_index == retest_index
                    or self._close(df, scan_index) > self._high(df, retest_index)
                )

                if closes_above_zone and closes_above_retest:
                    status["confirmed"] = True
                    status["confirmation_index"] = scan_index
                    status["failure_reason"] = None
                    return status

            scan_index += 1

        status["failure_reason"] = "bullish_fvg_waiting_for_confirmation"
        return status

    def _short_fvg_confirmation_status(self, df, fvg, entry_index):
        status = self._base_fvg_status(fvg, "bearish")
        if fvg is None or not status["required"]:
            return status

        lower = float(fvg["lower"])
        upper = float(fvg["upper"])
        scan_index = int(fvg["end_index"]) + 1

        while scan_index <= entry_index:
            if self._fvg_retest_requires_close_respect() and self._close(df, scan_index) > upper:
                status["invalid"] = True
                status["failure_reason"] = "bearish_fvg_closed_above_upper_before_confirmation"
                return status

            if status["retest_index"] is None and self._zone_touched(
                df,
                scan_index,
                lower,
                upper,
            ):
                status["retest_index"] = scan_index

            retest_index = status["retest_index"]
            if retest_index is not None and self._is_red(df, scan_index):
                if not self._fvg_entry_requires_continuation_close():
                    status["confirmed"] = True
                    status["confirmation_index"] = scan_index
                    status["failure_reason"] = None
                    return status

                closes_below_zone = self._close(df, scan_index) < lower
                closes_below_retest = (
                    scan_index == retest_index
                    or self._close(df, scan_index) < self._low(df, retest_index)
                )

                if closes_below_zone and closes_below_retest:
                    status["confirmed"] = True
                    status["confirmation_index"] = scan_index
                    status["failure_reason"] = None
                    return status

            scan_index += 1

        status["failure_reason"] = "bearish_fvg_waiting_for_confirmation"
        return status

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
                    if self._low(df, scan_index) < self._low(df, second_red_index):
                        break

                    fvg = self._find_bullish_fvg(df, first_red_index, scan_index)
                    fvg_status = self._long_fvg_confirmation_status(df, fvg, scan_index)
                    if fvg_status["invalid"]:
                        break

                    if fvg_status["confirmed"]:
                        if self._set_long_plan(
                            df,
                            scan_index,
                            first_red_index,
                            alert_index,
                            second_red_index,
                            pre_alert_inside_indexes,
                            fvg_status,
                        ):
                            found_entry = True
                            index = scan_index + 1
                            break

                        break

                    scan_index += 1
                    continue

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
                    if self._high(df, scan_index) > self._high(df, second_green_index):
                        break

                    fvg = self._find_bearish_fvg(df, first_green_index, scan_index)
                    fvg_status = self._short_fvg_confirmation_status(df, fvg, scan_index)
                    if fvg_status["invalid"]:
                        break

                    if fvg_status["confirmed"]:
                        if self._set_short_plan(
                            df,
                            scan_index,
                            first_green_index,
                            alert_index,
                            second_green_index,
                            pre_alert_inside_indexes,
                            fvg_status,
                        ):
                            found_entry = True
                            index = scan_index + 1
                            break

                        break

                    scan_index += 1
                    continue

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
        fvg_status,
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
                "entry_basis": "green_midpoint_after_conditional_fvg_check",
                "entry_timing": (
                    "after_fvg_confirmation_candle_close"
                    if fvg_status["required"]
                    else "normal_two_stage_entry"
                ),
                "stop_basis": "second_red_low",
                "target_basis": "entry_plus_11r",
                "fvg_confirmation": {
                    "required": fvg_status["required"],
                    "mode": fvg_status["mode"],
                    "confirmed": fvg_status["confirmed"],
                    "side": fvg_status["side"],
                    "first_index": fvg_status["first_index"],
                    "middle_index": fvg_status["middle_index"],
                    "end_index": fvg_status["end_index"],
                    "lower": fvg_status["lower"],
                    "upper": fvg_status["upper"],
                    "gap_pct": fvg_status["gap_pct"],
                    "retest_index": fvg_status["retest_index"],
                    "confirmation_index": fvg_status["confirmation_index"],
                    "failure_reason": fvg_status["failure_reason"],
                    "retest_rule": "when_bullish_fvg_forms_price_must_touch_the_fvg_zone",
                    "respect_rule": "no_close_below_bullish_fvg_lower_before_confirmation",
                    "continuation_rule": "confirmation_candle_closes_green_above_fvg_zone_or_retest_high",
                },
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
        fvg_status,
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
                "entry_basis": "red_midpoint_after_conditional_fvg_check",
                "entry_timing": (
                    "after_fvg_confirmation_candle_close"
                    if fvg_status["required"]
                    else "normal_two_stage_entry"
                ),
                "stop_basis": "second_green_high",
                "target_basis": "entry_minus_11r",
                "fvg_confirmation": {
                    "required": fvg_status["required"],
                    "mode": fvg_status["mode"],
                    "confirmed": fvg_status["confirmed"],
                    "side": fvg_status["side"],
                    "first_index": fvg_status["first_index"],
                    "middle_index": fvg_status["middle_index"],
                    "end_index": fvg_status["end_index"],
                    "lower": fvg_status["lower"],
                    "upper": fvg_status["upper"],
                    "gap_pct": fvg_status["gap_pct"],
                    "retest_index": fvg_status["retest_index"],
                    "confirmation_index": fvg_status["confirmation_index"],
                    "failure_reason": fvg_status["failure_reason"],
                    "retest_rule": "when_bearish_fvg_forms_price_must_touch_the_fvg_zone",
                    "respect_rule": "no_close_above_bearish_fvg_upper_before_confirmation",
                    "continuation_rule": "confirmation_candle_closes_red_below_fvg_zone_or_retest_low",
                },
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

export function buildTwoStageCandleBreakoutFvgConfirmationTemplateConfig(): Record<
  string,
  unknown
> {
  const config: Record<string, unknown> = {
    codeTarget: 'python',
    codeDefinition: TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_PYTHON_CODE,
    authoredCodeTarget: 'python',
    authoredCodeDefinition: TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_PYTHON_CODE,
    compiledCodeTarget: 'python',
    compiledCodeDefinition: TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_PYTHON_CODE,
    market: 'crypto-futures',
    entryLogic:
      'Buy: red candle 1, then zero or more internal candles that stay inside Candle 1 range. The alert is the first green candle that does not break Candle 1 low and closes above Candle 1 high. After the alert, no candle may break the alert low before entry. Any later red pullback may form; the first green after that red pullback must not break that red low. FVG is not mandatory, but if a bullish FVG forms anywhere from Candle 1 through the planned entry window, price must touch/respect that FVG and a bullish confirmation candle must close before the entry plan is emitted. Candle 1 freshness is intentionally not used and same-direction continuation before pullback is allowed.',
    exitLogic:
      'Long exit is managed by dynamic second-red stop, 1:11 target, and custom SL ladder: 4R locks 1R, 9R locks 4R, 11R locks 9R.',
    entryShortLogic:
      'Sell: green candle 1, then zero or more internal candles that stay inside Candle 1 range. The alert is the first red candle that does not break Candle 1 high and closes below Candle 1 low. After the alert, no candle may break the alert high before entry. Any later green pullback may form; the first red after that green pullback must not break that green high. FVG is not mandatory, but if a bearish FVG forms anywhere from Candle 1 through the planned entry window, price must touch/respect that FVG and a bearish confirmation candle must close before the entry plan is emitted. Candle 1 freshness is intentionally not used and same-direction continuation before pullback is allowed.',
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
        'Per-trade stop and target are emitted by the Python entry plan: long entry at the green midpoint after the candle-2 guard and conditional FVG confirmation check, short entry at the red midpoint after the candle-2 guard and conditional FVG confirmation check, pre-alert internal candles must stay inside Candle 1 range, and post-alert candles cannot break the alert low/high before entry. FVG is not mandatory, but when it forms it must confirm before entry. Target is 11R. Custom R ladder moves SL to +1R at +4R, +4R at +9R, and +9R at +11R.',
    },
    parameters: {
      signalThreshold: '0.65',
      signal_threshold: 0.65,
      rewardR: 11,
      reward_r: 11,
      stopBufferPct: 0.0005,
      stop_buffer_pct: 0.0005,
      requireFvgConfirmation: false,
      require_fvg_confirmation: false,
      confirmFvgWhenPresent: true,
      confirm_fvg_when_present: true,
      fvgMinGapPct: 0,
      fvg_min_gap_pct: 0,
      fvgRetestRequiresCloseRespect: true,
      fvg_retest_requires_close_respect: true,
      fvgEntryRequiresContinuationClose: true,
      fvg_entry_requires_continuation_close: true,
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
      'Signals require closed candles. Candle 1 and alert do not need to be immediate; any candles between them must stay inside Candle 1 high/low until the alert break-and-close. Candle 1 freshness is intentionally disabled. FVG is not mandatory: if no same-side FVG forms between Candle 1 and the planned entry window, the normal two-stage entry can fire. If a bullish/bearish FVG does form in that window, the setup waits until price touches and respects the FVG zone and a same-side confirmation candle closes; only then is entry planned. After alert, same-direction continuation before pullback is allowed and the alert high/low guard remains active until entry. For buy, any post-alert candle that breaks alert low cancels the setup; for sell, any post-alert candle that breaks alert high cancels the setup. Once a pullback exists, the first opposite-color candidate must pass the candle-2 guard or the setup is cancelled unless it is only waiting for FVG confirmation. Default stop buffer is 0.05% beyond candle 2. SL ladder: at 4R move SL to 1R, at 9R move SL to 4R, and at 11R move SL to 9R.',
    description: TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_TEMPLATE_DESCRIPTION,
  };

  return {
    ...config,
    automationProfile: buildStrategyTemplateAutomationProfile(config),
  };
}

export function buildTwoStageCandleBreakoutFvgConfirmationTemplatePayload() {
  return {
    name: TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_TEMPLATE_NAME,
    description: TWO_STAGE_CANDLE_BREAKOUT_FVG_CONFIRMATION_TEMPLATE_DESCRIPTION,
    status: 'Active' as const,
    config: buildTwoStageCandleBreakoutFvgConfirmationTemplateConfig(),
  };
}
