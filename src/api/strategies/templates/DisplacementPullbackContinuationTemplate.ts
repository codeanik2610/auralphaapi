import { buildStrategyTemplateAutomationProfile } from '../../utils/strategyTemplateAutomation';

export const DISPLACEMENT_PULLBACK_CONTINUATION_TEMPLATE_NAME =
  'Visual Trend Pullback Continuation 1:5';

export const DISPLACEMENT_PULLBACK_CONTINUATION_TEMPLATE_DESCRIPTION =
  'Visual trend-leg pullback continuation template. It reads the broader trend leg first, accepts a shallow pause or pullback inside that trend, and enters when price continues in the trend direction with enough room for a 1:5 target. Stops are buffered beyond the pullback extreme.';

export const DISPLACEMENT_PULLBACK_CONTINUATION_PYTHON_CODE = String.raw`from auralpha import Strategy


class DisplacementPullbackContinuation(Strategy):
    name = "Visual Trend Pullback Continuation 1:5"
    market = "crypto-futures"
    timeframe = "automation"

    params = {
        "reward_r": 5,
        "structure_lookback_bars": 6,
        "breakout_lookback_bars": 3,
        "average_body_period": 12,
        "displacement_body_mult": 2.0,
        "continuation_body_mult": 0.6,
        "max_pullback_bars": 10,
        "max_pullback_retrace": 0.65,
        "close_near_extreme_pct": 0.3,
        "min_displacement_range_mult": 1.3,
        "min_displacement_body_to_range": 0.55,
        "min_breakout_close_range_mult": 0.15,
        "max_context_range_mult": 5.0,
        "trend_context_bars": 28,
        "trend_min_slope_r": 1.2,
        "trend_min_directional_closes": 0.45,
        "min_trend_range_r": 3.0,
        "compression_bars": 5,
        "compression_max_range_mult": 0.95,
        "compression_min_small_bodies": 2,
        "max_chop_direction_change_ratio": 0.75,
        "max_chop_overlap_ratio": 0.75,
        "room_lookback_bars": 48,
        "min_target_room_r": 2.0,
        "require_continuation_structure_break": True,
        "stop_buffer_pct": 0.0005,
    }

    risk = {
        "max_per_trade": 1,
        "signal_threshold": 0.68,
        "stopLossMode": "dynamic_pullback_extreme",
        "takeProfitMode": "dynamic_r_multiple",
        "risk_reward_ratio": 5,
    }

    def prepare(self, df):
        total = len(df)
        self._long_signals = [False] * total
        self._short_signals = [False] * total
        self._long_plans = [None] * total
        self._short_plans = [None] * total

        if total < self._structure_lookback_bars() + 3:
            return None

        self._build_long_signals(df)
        self._build_short_signals(df)
        self._apply_one_position_filter(df)
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

    def _param_float(self, name, default):
        try:
            value = float(self.params.get(name, default))
        except Exception:
            return default
        return value

    def _param_int(self, name, default):
        try:
            value = int(float(self.params.get(name, default)))
        except Exception:
            return default
        return value

    def _param_bool(self, name, default):
        value = self.params.get(name, default)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in ("1", "true", "yes", "on"):
                return True
            if normalized in ("0", "false", "no", "off"):
                return False
        return bool(value)

    def _structure_lookback_bars(self):
        return max(3, self._param_int("structure_lookback_bars", 6))

    def _breakout_lookback_bars(self):
        return max(2, self._param_int("breakout_lookback_bars", 3))

    def _average_body_period(self):
        return max(3, self._param_int("average_body_period", 12))

    def _reward_r(self):
        return max(1.0, self._param_float("reward_r", 6.0))

    def _stop_buffer_pct(self):
        return max(0.0, self._param_float("stop_buffer_pct", 0.0005))

    def _displacement_body_mult(self):
        return max(1.0, self._param_float("displacement_body_mult", 1.6))

    def _continuation_body_mult(self):
        return max(0.1, self._param_float("continuation_body_mult", 0.6))

    def _max_pullback_bars(self):
        return max(1, self._param_int("max_pullback_bars", 6))

    def _max_pullback_retrace(self):
        return min(1.0, max(0.2, self._param_float("max_pullback_retrace", 0.85)))

    def _close_near_extreme_pct(self):
        return min(0.8, max(0.05, self._param_float("close_near_extreme_pct", 0.4)))

    def _min_displacement_range_mult(self):
        return max(0.1, self._param_float("min_displacement_range_mult", 1.3))

    def _min_displacement_body_to_range(self):
        return min(0.95, max(0.1, self._param_float("min_displacement_body_to_range", 0.55)))

    def _min_breakout_close_range_mult(self):
        return max(0.0, self._param_float("min_breakout_close_range_mult", 0.15))

    def _max_context_range_mult(self):
        return max(1.0, self._param_float("max_context_range_mult", 5.0))

    def _trend_context_bars(self):
        return max(4, self._param_int("trend_context_bars", 12))

    def _trend_min_slope_r(self):
        return max(0.0, self._param_float("trend_min_slope_r", 0.8))

    def _trend_min_directional_closes(self):
        return min(1.0, max(0.0, self._param_float("trend_min_directional_closes", 0.55)))

    def _min_trend_range_r(self):
        return max(0.0, self._param_float("min_trend_range_r", 3.0))

    def _compression_bars(self):
        return max(3, self._param_int("compression_bars", 5))

    def _compression_max_range_mult(self):
        return max(0.1, self._param_float("compression_max_range_mult", 0.95))

    def _compression_min_small_bodies(self):
        return max(1, self._param_int("compression_min_small_bodies", 2))

    def _max_chop_direction_change_ratio(self):
        return min(1.0, max(0.0, self._param_float("max_chop_direction_change_ratio", 0.65)))

    def _max_chop_overlap_ratio(self):
        return min(1.0, max(0.0, self._param_float("max_chop_overlap_ratio", 0.75)))

    def _room_lookback_bars(self):
        return max(6, self._param_int("room_lookback_bars", 36))

    def _min_target_room_r(self):
        return max(0.0, self._param_float("min_target_room_r", 3.0))

    def _require_continuation_structure_break(self):
        return self._param_bool("require_continuation_structure_break", True)

    def _open(self, df, index):
        return float(df["open"].iloc[index])

    def _high(self, df, index):
        return float(df["high"].iloc[index])

    def _low(self, df, index):
        return float(df["low"].iloc[index])

    def _close(self, df, index):
        return float(df["close"].iloc[index])

    def _body(self, df, index):
        return abs(self._close(df, index) - self._open(df, index))

    def _range(self, df, index):
        return max(0.0, self._high(df, index) - self._low(df, index))

    def _mid(self, df, index):
        return (self._high(df, index) + self._low(df, index)) / 2.0

    def _is_red(self, df, index):
        return self._close(df, index) < self._open(df, index)

    def _is_green(self, df, index):
        return self._close(df, index) > self._open(df, index)

    def _avg_body(self, df, index):
        start = max(0, index - self._average_body_period())
        bodies = [self._body(df, item) for item in range(start, index)]
        if not bodies:
            return max(self._body(df, index), 0.00000001)
        return max(sum(bodies) / len(bodies), 0.00000001)

    def _avg_range(self, df, index):
        start = max(0, index - self._average_body_period())
        ranges = [self._range(df, item) for item in range(start, index)]
        if not ranges:
            return max(self._range(df, index), 0.00000001)
        return max(sum(ranges) / len(ranges), 0.00000001)

    def _previous_range(self, df, index):
        lookback = self._structure_lookback_bars()
        start = max(0, index - lookback)
        highs = [self._high(df, item) for item in range(start, index)]
        lows = [self._low(df, item) for item in range(start, index)]
        if not highs or not lows:
            return None
        return min(lows), max(highs)

    def _breakout_range(self, df, index):
        lookback = self._breakout_lookback_bars()
        start = max(0, index - lookback)
        highs = [self._high(df, item) for item in range(start, index)]
        lows = [self._low(df, item) for item in range(start, index)]
        if not highs or not lows:
            return None
        return min(lows), max(highs)

    def _is_small_body(self, df, index):
        return self._body(df, index) <= self._avg_body(df, index) * 0.9

    def _context_range_ok(self, df, index):
        previous = self._previous_range(df, index)
        if previous is None:
            return False
        previous_low, previous_high = previous
        context_range = previous_high - previous_low
        return context_range <= self._avg_range(df, index) * self._max_context_range_mult()

    def _trend_context_details(self, df, index):
        lookback = self._trend_context_bars()
        start = max(0, index - lookback)
        minimum_context = max(4, min(self._structure_lookback_bars(), lookback))
        if index - start < minimum_context:
            return None

        highs = [self._high(df, item) for item in range(start, index)]
        lows = [self._low(df, item) for item in range(start, index)]
        closes = [self._close(df, item) for item in range(start, index)]
        if not highs or not lows or not closes:
            return None

        return {
            "start": start,
            "high": max(highs),
            "low": min(lows),
            "range": max(highs) - min(lows),
            "first_close": closes[0],
            "last_close": closes[-1],
        }

    def _trend_context_ok_for_short(self, df, index):
        details = self._trend_context_details(df, index)
        if details is None:
            return False

        average_range = self._avg_range(df, index)
        if details["range"] < average_range * self._min_trend_range_r():
            return False

        slope_r = (details["first_close"] - details["last_close"]) / average_range
        if slope_r < self._trend_min_slope_r():
            return False

        lower_closes = 0
        comparisons = 0
        start = details["start"]
        for item in range(start + 1, index):
            comparisons += 1
            if self._close(df, item) <= self._close(df, item - 1):
                lower_closes += 1
        if comparisons <= 0:
            return False
        return (
            (lower_closes / comparisons) >= self._trend_min_directional_closes()
            and self._no_chop_context_ok(df, index)
        )

    def _trend_context_ok_for_long(self, df, index):
        details = self._trend_context_details(df, index)
        if details is None:
            return False

        average_range = self._avg_range(df, index)
        if details["range"] < average_range * self._min_trend_range_r():
            return False

        slope_r = (details["last_close"] - details["first_close"]) / average_range
        if slope_r < self._trend_min_slope_r():
            return False

        higher_closes = 0
        comparisons = 0
        start = details["start"]
        for item in range(start + 1, index):
            comparisons += 1
            if self._close(df, item) >= self._close(df, item - 1):
                higher_closes += 1
        if comparisons <= 0:
            return False
        return (
            (higher_closes / comparisons) >= self._trend_min_directional_closes()
            and self._no_chop_context_ok(df, index)
        )

    def _short_context_pullback_retrace_ok(self, df, pullback_start_index, pullback_high):
        details = self._trend_context_details(df, pullback_start_index)
        if details is None or details["range"] <= 0:
            return False
        retrace = (pullback_high - details["low"]) / details["range"]
        return retrace <= self._max_pullback_retrace()

    def _long_context_pullback_retrace_ok(self, df, pullback_start_index, pullback_low):
        details = self._trend_context_details(df, pullback_start_index)
        if details is None or details["range"] <= 0:
            return False
        retrace = (details["high"] - pullback_low) / details["range"]
        return retrace <= self._max_pullback_retrace()

    def _compression_ok(self, df, index):
        lookback = self._compression_bars()
        start = max(0, index - lookback)
        if index - start < min(3, lookback):
            return False

        ranges = [self._range(df, item) for item in range(start, index)]
        if not ranges:
            return False

        average_compression_range = sum(ranges) / len(ranges)
        range_is_compact = average_compression_range <= self._avg_range(df, index) * self._compression_max_range_mult()
        small_bodies = 0
        for item in range(start, index):
            if self._is_small_body(df, item):
                small_bodies += 1
        return range_is_compact or small_bodies >= self._compression_min_small_bodies()

    def _candle_direction(self, df, index):
        if self._is_green(df, index):
            return 1
        if self._is_red(df, index):
            return -1
        return 0

    def _overlap_ratio(self, df, first_index, second_index):
        overlap = min(self._high(df, first_index), self._high(df, second_index)) - max(
            self._low(df, first_index),
            self._low(df, second_index),
        )
        if overlap <= 0:
            return 0.0
        denominator = max(
            min(self._range(df, first_index), self._range(df, second_index)),
            0.00000001,
        )
        return min(1.0, overlap / denominator)

    def _no_chop_context_ok(self, df, index):
        lookback = self._structure_lookback_bars()
        start = max(0, index - lookback)
        if index - start < 3:
            return True

        changes = 0
        comparisons = 0
        previous_direction = 0
        overlaps = []
        for item in range(start, index):
            direction = self._candle_direction(df, item)
            if direction != 0:
                if previous_direction != 0:
                    comparisons += 1
                    if direction != previous_direction:
                        changes += 1
                previous_direction = direction
            if item > start:
                overlaps.append(self._overlap_ratio(df, item - 1, item))

        direction_change_ratio = changes / comparisons if comparisons > 0 else 0.0
        average_overlap = sum(overlaps) / len(overlaps) if overlaps else 0.0
        return not (
            direction_change_ratio > self._max_chop_direction_change_ratio()
            and average_overlap > self._max_chop_overlap_ratio()
        )

    def _displacement_quality_ok(self, df, index):
        candle_range = self._range(df, index)
        if candle_range <= 0:
            return False
        body_to_range = self._body(df, index) / candle_range
        return (
            candle_range >= self._avg_range(df, index) * self._min_displacement_range_mult()
            and body_to_range >= self._min_displacement_body_to_range()
            and self._context_range_ok(df, index)
        )

    def _has_weak_context_for_short(self, df, index):
        lookback = self._structure_lookback_bars()
        start = max(0, index - lookback)
        green_count = 0
        small_count = 0
        for item in range(start, index):
            if self._is_green(df, item):
                green_count += 1
            if self._is_small_body(df, item):
                small_count += 1
        return green_count >= 1 or small_count >= 2

    def _has_weak_context_for_long(self, df, index):
        lookback = self._structure_lookback_bars()
        start = max(0, index - lookback)
        red_count = 0
        small_count = 0
        for item in range(start, index):
            if self._is_red(df, item):
                red_count += 1
            if self._is_small_body(df, item):
                small_count += 1
        return red_count >= 1 or small_count >= 2

    def _is_bearish_displacement(self, df, index):
        breakout = self._breakout_range(df, index)
        if breakout is None:
            return False

        breakout_low, _breakout_high = breakout
        candle_range = self._range(df, index)
        if candle_range <= 0:
            return False

        close_position = (self._close(df, index) - self._low(df, index)) / candle_range
        clear_break = breakout_low - self._close(df, index)
        return (
            self._is_red(df, index)
            and self._body(df, index) >= self._avg_body(df, index) * self._displacement_body_mult()
            and self._displacement_quality_ok(df, index)
            and self._close(df, index) < breakout_low
            and clear_break >= self._avg_range(df, index) * self._min_breakout_close_range_mult()
            and close_position <= self._close_near_extreme_pct()
            and self._has_weak_context_for_short(df, index)
            and self._trend_context_ok_for_short(df, index)
            and self._compression_ok(df, index)
            and self._no_chop_context_ok(df, index)
        )

    def _is_bullish_displacement(self, df, index):
        breakout = self._breakout_range(df, index)
        if breakout is None:
            return False

        _breakout_low, breakout_high = breakout
        candle_range = self._range(df, index)
        if candle_range <= 0:
            return False

        close_position = (self._high(df, index) - self._close(df, index)) / candle_range
        clear_break = self._close(df, index) - breakout_high
        return (
            self._is_green(df, index)
            and self._body(df, index) >= self._avg_body(df, index) * self._displacement_body_mult()
            and self._displacement_quality_ok(df, index)
            and self._close(df, index) > breakout_high
            and clear_break >= self._avg_range(df, index) * self._min_breakout_close_range_mult()
            and close_position <= self._close_near_extreme_pct()
            and self._has_weak_context_for_long(df, index)
            and self._trend_context_ok_for_long(df, index)
            and self._compression_ok(df, index)
            and self._no_chop_context_ok(df, index)
        )

    def _short_pullback_retrace_ok(self, df, displacement_index, pullback_high):
        displacement_high = self._high(df, displacement_index)
        displacement_close = self._close(df, displacement_index)
        distance = displacement_high - displacement_close
        if distance <= 0:
            return True
        retrace = (pullback_high - displacement_close) / distance
        return retrace <= self._max_pullback_retrace()

    def _long_pullback_retrace_ok(self, df, displacement_index, pullback_low):
        displacement_low = self._low(df, displacement_index)
        displacement_close = self._close(df, displacement_index)
        distance = displacement_close - displacement_low
        if distance <= 0:
            return True
        retrace = (displacement_close - pullback_low) / distance
        return retrace <= self._max_pullback_retrace()

    def _valid_short_pullback_candle(self, df, index):
        return (
            self._is_green(df, index)
            or self._is_small_body(df, index)
            or (
                self._is_red(df, index)
                and self._body(df, index) < self._avg_body(df, index) * self._continuation_body_mult()
            )
        )

    def _valid_long_pullback_candle(self, df, index):
        return (
            self._is_red(df, index)
            or self._is_small_body(df, index)
            or (
                self._is_green(df, index)
                and self._body(df, index) < self._avg_body(df, index) * self._continuation_body_mult()
            )
        )

    def _valid_short_pullback_seed(self, df, index):
        return self._is_green(df, index) or self._is_small_body(df, index)

    def _valid_long_pullback_seed(self, df, index):
        return self._is_red(df, index) or self._is_small_body(df, index)

    def _valid_short_continuation(self, df, index, pullback_low):
        if not self._is_red(df, index):
            return False
        body_break = self._body(df, index) >= self._avg_body(df, index) * self._continuation_body_mult()
        structure_break = self._close(df, index) < pullback_low
        candle_range = self._range(df, index)
        close_near_low = candle_range <= 0 or (
            (self._close(df, index) - self._low(df, index)) / candle_range
        ) <= min(0.6, self._close_near_extreme_pct() + 0.15)
        if self._require_continuation_structure_break():
            return structure_break and body_break
        return structure_break or (
            body_break
            and self._close(df, index) < self._close(df, index - 1)
        )

    def _valid_long_continuation(self, df, index, pullback_high):
        if not self._is_green(df, index):
            return False
        body_break = self._body(df, index) >= self._avg_body(df, index) * self._continuation_body_mult()
        structure_break = self._close(df, index) > pullback_high
        candle_range = self._range(df, index)
        close_near_high = candle_range <= 0 or (
            (self._high(df, index) - self._close(df, index)) / candle_range
        ) <= min(0.6, self._close_near_extreme_pct() + 0.15)
        if self._require_continuation_structure_break():
            return structure_break and body_break
        return structure_break or (
            body_break
            and self._close(df, index) > self._close(df, index - 1)
        )

    def _target_room_r(self, df, entry_index, risk_distance):
        if risk_distance <= 0:
            return 0.0
        lookback = self._room_lookback_bars()
        start = max(0, entry_index - lookback)
        if entry_index - start < 3:
            return 0.0
        highs = [self._high(df, item) for item in range(start, entry_index + 1)]
        lows = [self._low(df, item) for item in range(start, entry_index + 1)]
        if not highs or not lows:
            return 0.0
        return (max(highs) - min(lows)) / risk_distance

    def _target_room_ok(self, df, entry_index, risk_distance):
        return self._target_room_r(df, entry_index, risk_distance) >= self._min_target_room_r()

    def _plan_exit_index(self, df, side, entry_index, plan):
        stop_loss_price = float(plan.get("stop_loss_price"))
        take_profit_price = float(plan.get("take_profit_price"))
        for index in range(entry_index + 1, len(df)):
            if side == "long":
                if self._low(df, index) <= stop_loss_price:
                    return index
                if self._high(df, index) >= take_profit_price:
                    return index
            else:
                if self._high(df, index) >= stop_loss_price:
                    return index
                if self._low(df, index) <= take_profit_price:
                    return index
        return None

    def _clear_plan(self, side, index):
        if side == "long":
            self._long_signals[index] = False
            self._long_plans[index] = None
        else:
            self._short_signals[index] = False
            self._short_plans[index] = None

    def _apply_one_position_filter(self, df):
        candidates = []
        for index, plan in enumerate(self._long_plans):
            if plan is not None:
                candidates.append((index, "long", plan))
        for index, plan in enumerate(self._short_plans):
            if plan is not None:
                candidates.append((index, "short", plan))

        candidates.sort(key=lambda item: item[0])
        blocked_until = -1
        for index, side, plan in candidates:
            if index < blocked_until:
                self._clear_plan(side, index)
                continue

            exit_index = self._plan_exit_index(df, side, index, plan)
            blocked_until = len(df) if exit_index is None else exit_index + 1

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

    def _build_short_signals(self, df):
        total = len(df)
        index = max(self._structure_lookback_bars(), self._breakout_lookback_bars())

        while index < total - 1:
            if not (
                self._trend_context_ok_for_short(df, index)
                and self._valid_short_pullback_seed(df, index)
            ):
                index += 1
                continue

            entry_index = self._scan_short_entry_after_pullback(df, index)
            if entry_index is not None:
                index = entry_index + 1
                continue

            index += 1

    def _build_long_signals(self, df):
        total = len(df)
        index = max(self._structure_lookback_bars(), self._breakout_lookback_bars())

        while index < total - 1:
            if not (
                self._trend_context_ok_for_long(df, index)
                and self._valid_long_pullback_seed(df, index)
            ):
                index += 1
                continue

            entry_index = self._scan_long_entry_after_pullback(df, index)
            if entry_index is not None:
                index = entry_index + 1
                continue

            index += 1

    def _scan_short_entry_after_pullback(self, df, pullback_start_index):
        details = self._trend_context_details(df, pullback_start_index)
        if details is None:
            return None

        pullback_indexes = []
        pullback_high = None
        pullback_low = None
        scan_index = pullback_start_index
        max_index = min(len(df), pullback_start_index + self._max_pullback_bars())

        while scan_index < max_index:
            if self._high(df, scan_index) > details["high"]:
                return None

            if pullback_indexes and self._valid_short_continuation(df, scan_index, pullback_low):
                if self._set_short_plan(
                    df,
                    scan_index,
                    details["start"],
                    pullback_indexes,
                    pullback_high,
                    pullback_low,
                ):
                    return scan_index
                return None

            if self._valid_short_pullback_candle(df, scan_index):
                next_pullback_high = (
                    self._high(df, scan_index)
                    if pullback_high is None
                    else max(pullback_high, self._high(df, scan_index))
                )
                if not self._short_context_pullback_retrace_ok(
                    df,
                    pullback_start_index,
                    next_pullback_high,
                ):
                    return None
                pullback_indexes.append(scan_index)
                pullback_high = next_pullback_high
                pullback_low = (
                    self._low(df, scan_index)
                    if pullback_low is None
                    else min(pullback_low, self._low(df, scan_index))
                )
                scan_index += 1
                continue

            return None

        return None

    def _scan_long_entry_after_pullback(self, df, pullback_start_index):
        details = self._trend_context_details(df, pullback_start_index)
        if details is None:
            return None

        pullback_indexes = []
        pullback_high = None
        pullback_low = None
        scan_index = pullback_start_index
        max_index = min(len(df), pullback_start_index + self._max_pullback_bars())

        while scan_index < max_index:
            if self._low(df, scan_index) < details["low"]:
                return None

            if pullback_indexes and self._valid_long_continuation(df, scan_index, pullback_high):
                if self._set_long_plan(
                    df,
                    scan_index,
                    details["start"],
                    pullback_indexes,
                    pullback_high,
                    pullback_low,
                ):
                    return scan_index
                return None

            if self._valid_long_pullback_candle(df, scan_index):
                next_pullback_low = (
                    self._low(df, scan_index)
                    if pullback_low is None
                    else min(pullback_low, self._low(df, scan_index))
                )
                if not self._long_context_pullback_retrace_ok(
                    df,
                    pullback_start_index,
                    next_pullback_low,
                ):
                    return None
                pullback_indexes.append(scan_index)
                pullback_high = (
                    self._high(df, scan_index)
                    if pullback_high is None
                    else max(pullback_high, self._high(df, scan_index))
                )
                pullback_low = next_pullback_low
                scan_index += 1
                continue

            return None

        return None

    def _scan_short_entry_after_displacement(self, df, displacement_index):
        displacement_high = self._high(df, displacement_index)
        pullback_indexes = []
        pullback_high = None
        pullback_low = None
        scan_index = displacement_index + 1
        max_index = min(len(df), displacement_index + 1 + self._max_pullback_bars())

        while scan_index < max_index:
            if self._high(df, scan_index) > displacement_high:
                return None

            if pullback_indexes and self._valid_short_continuation(df, scan_index, pullback_low):
                if self._set_short_plan(
                    df,
                    scan_index,
                    displacement_index,
                    pullback_indexes,
                    pullback_high,
                    pullback_low,
                ):
                    return scan_index
                return None

            if self._valid_short_pullback_candle(df, scan_index):
                next_pullback_high = (
                    self._high(df, scan_index)
                    if pullback_high is None
                    else max(pullback_high, self._high(df, scan_index))
                )
                if not self._short_pullback_retrace_ok(df, displacement_index, next_pullback_high):
                    return None
                pullback_indexes.append(scan_index)
                pullback_high = next_pullback_high
                pullback_low = (
                    self._low(df, scan_index)
                    if pullback_low is None
                    else min(pullback_low, self._low(df, scan_index))
                )

            scan_index += 1

        return None

    def _scan_long_entry_after_displacement(self, df, displacement_index):
        displacement_low = self._low(df, displacement_index)
        pullback_indexes = []
        pullback_high = None
        pullback_low = None
        scan_index = displacement_index + 1
        max_index = min(len(df), displacement_index + 1 + self._max_pullback_bars())

        while scan_index < max_index:
            if self._low(df, scan_index) < displacement_low:
                return None

            if pullback_indexes and self._valid_long_continuation(df, scan_index, pullback_high):
                if self._set_long_plan(
                    df,
                    scan_index,
                    displacement_index,
                    pullback_indexes,
                    pullback_high,
                    pullback_low,
                ):
                    return scan_index
                return None

            if self._valid_long_pullback_candle(df, scan_index):
                next_pullback_low = (
                    self._low(df, scan_index)
                    if pullback_low is None
                    else min(pullback_low, self._low(df, scan_index))
                )
                if not self._long_pullback_retrace_ok(df, displacement_index, next_pullback_low):
                    return None
                pullback_indexes.append(scan_index)
                pullback_high = (
                    self._high(df, scan_index)
                    if pullback_high is None
                    else max(pullback_high, self._high(df, scan_index))
                )
                pullback_low = next_pullback_low

            scan_index += 1

        return None

    def _set_short_plan(
        self,
        df,
        entry_index,
        trend_context_start_index,
        pullback_indexes,
        pullback_high,
        pullback_low,
    ):
        entry_price = self._mid(df, entry_index)
        stop_base = max(pullback_high, self._high(df, entry_index))
        stop_loss_price = stop_base * (1.0 + self._stop_buffer_pct())
        risk_distance = stop_loss_price - entry_price
        if risk_distance <= 0:
            return False

        reward_r = self._reward_r()
        take_profit_price = entry_price - reward_r * risk_distance
        target_room_r = self._target_room_r(df, entry_index, risk_distance)
        if target_room_r < self._min_target_room_r():
            return False
        self._short_signals[entry_index] = True
        self._short_plans[entry_index] = {
            "entry_price": entry_price,
            "stop_loss_price": stop_loss_price,
            "take_profit_price": take_profit_price,
            "risk_reward_ratio": reward_r,
            "label": "visual_trend_pullback_continuation_short",
            "metadata": {
                "pattern": "bearish_visual_trend_pullback_short_continuation",
                "trend_context_start_index": trend_context_start_index,
                "pullback_indexes": pullback_indexes,
                "entry_index": entry_index,
                "entry_basis": "continuation_candle_midpoint",
                "stop_basis": "pullback_high_buffered",
                "target_basis": "entry_minus_configured_r",
                "structure_guard": "trend_context_high",
                "pullback_guard": "pullback_stays_inside_trend_context_high",
                "context_filters": [
                    "trend_context",
                    "shallow_pullback",
                    "continuation",
                    "no_chop",
                    "target_room",
                ],
                "pullback_high": pullback_high,
                "pullback_low": pullback_low,
                "target_room_r": target_room_r,
                "setup_markers": [
                    self._setup_marker(
                        df,
                        "TR",
                        "trend_context",
                        trend_context_start_index,
                        self._low(df, trend_context_start_index),
                    ),
                    self._setup_marker(
                        df,
                        "PB",
                        "pullback",
                        pullback_indexes[-1],
                        pullback_high,
                    ),
                    self._setup_marker(
                        df,
                        "EN",
                        "entry",
                        entry_index,
                        entry_price,
                    ),
                ],
            },
        }
        return True

    def _set_long_plan(
        self,
        df,
        entry_index,
        trend_context_start_index,
        pullback_indexes,
        pullback_high,
        pullback_low,
    ):
        entry_price = self._mid(df, entry_index)
        stop_base = min(pullback_low, self._low(df, entry_index))
        stop_loss_price = stop_base * (1.0 - self._stop_buffer_pct())
        risk_distance = entry_price - stop_loss_price
        if risk_distance <= 0:
            return False

        reward_r = self._reward_r()
        take_profit_price = entry_price + reward_r * risk_distance
        target_room_r = self._target_room_r(df, entry_index, risk_distance)
        if target_room_r < self._min_target_room_r():
            return False
        self._long_signals[entry_index] = True
        self._long_plans[entry_index] = {
            "entry_price": entry_price,
            "stop_loss_price": stop_loss_price,
            "take_profit_price": take_profit_price,
            "risk_reward_ratio": reward_r,
            "label": "visual_trend_pullback_continuation_long",
            "metadata": {
                "pattern": "bullish_visual_trend_pullback_long_continuation",
                "trend_context_start_index": trend_context_start_index,
                "pullback_indexes": pullback_indexes,
                "entry_index": entry_index,
                "entry_basis": "continuation_candle_midpoint",
                "stop_basis": "pullback_low_buffered",
                "target_basis": "entry_plus_configured_r",
                "structure_guard": "trend_context_low",
                "pullback_guard": "pullback_stays_inside_trend_context_low",
                "context_filters": [
                    "trend_context",
                    "shallow_pullback",
                    "continuation",
                    "no_chop",
                    "target_room",
                ],
                "pullback_high": pullback_high,
                "pullback_low": pullback_low,
                "target_room_r": target_room_r,
                "setup_markers": [
                    self._setup_marker(
                        df,
                        "TR",
                        "trend_context",
                        trend_context_start_index,
                        self._high(df, trend_context_start_index),
                    ),
                    self._setup_marker(
                        df,
                        "PB",
                        "pullback",
                        pullback_indexes[-1],
                        pullback_low,
                    ),
                    self._setup_marker(
                        df,
                        "EN",
                        "entry",
                        entry_index,
                        entry_price,
                    ),
                ],
            },
        }
        return True
`;

export function buildDisplacementPullbackContinuationTemplateConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {
    codeTarget: 'python',
    codeDefinition: DISPLACEMENT_PULLBACK_CONTINUATION_PYTHON_CODE,
    authoredCodeTarget: 'python',
    authoredCodeDefinition: DISPLACEMENT_PULLBACK_CONTINUATION_PYTHON_CODE,
    compiledCodeTarget: 'python',
    compiledCodeDefinition: DISPLACEMENT_PULLBACK_CONTINUATION_PYTHON_CODE,
    market: 'crypto-futures',
    entryLogic:
      'Buy: require a clean uptrend context first. Then accept a shallow red/small-body pause or pullback that stays inside the trend context low. Entry triggers when a green continuation candle closes above pullback structure, using the continuation candle midpoint, with enough recent room for the configured target.',
    exitLogic:
      'Long exit is managed by a pullback-low buffered stop, configurable dynamic R target defaulting to 1:5, and custom SL ladder that can lock profit as the trend leg extends.',
    entryShortLogic:
      'Sell: require a clean downtrend context first. Then accept a shallow green/small-body pause or pullback that stays inside the trend context high. Entry triggers when a red continuation candle closes below pullback structure, using the continuation candle midpoint, with enough recent room for the configured target.',
    exitShortLogic:
      'Short exit is managed by a pullback-high buffered stop, configurable dynamic R target defaulting to 1:5, and custom SL ladder that can lock profit as the trend leg extends.',
    shortEnabled: true,
    risk: {
      maxRisk: '1',
      max_per_trade: 1,
      signal_threshold: 0.68,
      stopLossMode: 'dynamic_pullback_extreme',
      stop_loss_mode: 'dynamic_pullback_extreme',
      takeProfitMode: 'dynamic_r_multiple',
      take_profit_mode: 'dynamic_r_multiple',
      riskRewardRatio: 5,
      risk_reward_ratio: 5,
      sizingNotes:
        'Per-trade entry, stop, and target are emitted by the Python entry plan. Long stops are buffered below the pullback low, short stops are buffered above the pullback high. The setup rejects pullbacks that violate the broader trend-context guard. Default target is 5R.',
    },
    parameters: {
      signalThreshold: '0.68',
      signal_threshold: 0.68,
      rewardR: 5,
      reward_r: 5,
      structureLookbackBars: 6,
      structure_lookback_bars: 6,
      breakoutLookbackBars: 3,
      breakout_lookback_bars: 3,
      averageBodyPeriod: 12,
      average_body_period: 12,
      displacementBodyMult: 2.0,
      displacement_body_mult: 2.0,
      continuationBodyMult: 0.6,
      continuation_body_mult: 0.6,
      maxPullbackBars: 10,
      max_pullback_bars: 10,
      maxPullbackRetrace: 0.65,
      max_pullback_retrace: 0.65,
      closeNearExtremePct: 0.3,
      close_near_extreme_pct: 0.3,
      minDisplacementRangeMult: 1.3,
      min_displacement_range_mult: 1.3,
      minDisplacementBodyToRange: 0.55,
      min_displacement_body_to_range: 0.55,
      minBreakoutCloseRangeMult: 0.15,
      min_breakout_close_range_mult: 0.15,
      maxContextRangeMult: 5.0,
      max_context_range_mult: 5.0,
      trendContextBars: 28,
      trend_context_bars: 28,
      trendMinSlopeR: 1.2,
      trend_min_slope_r: 1.2,
      trendMinDirectionalCloses: 0.45,
      trend_min_directional_closes: 0.45,
      minTrendRangeR: 3.0,
      min_trend_range_r: 3.0,
      compressionBars: 5,
      compression_bars: 5,
      compressionMaxRangeMult: 0.95,
      compression_max_range_mult: 0.95,
      compressionMinSmallBodies: 2,
      compression_min_small_bodies: 2,
      maxChopDirectionChangeRatio: 0.75,
      max_chop_direction_change_ratio: 0.75,
      maxChopOverlapRatio: 0.75,
      max_chop_overlap_ratio: 0.75,
      roomLookbackBars: 48,
      room_lookback_bars: 48,
      minTargetRoomR: 2.0,
      min_target_room_r: 2.0,
      requireContinuationStructureBreak: true,
      require_continuation_structure_break: true,
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
          { whenProfitR: 5, moveStopToR: 3 },
          { whenProfitR: 6, moveStopToR: 4 },
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
      'This template is designed to turn the screenshot-style visual read into deterministic rules: find the broader trend leg, avoid messy chop, accept a shallow pause/pullback inside that trend, then enter only when continuation closes through pullback structure. A single displacement candle is no longer mandatory; the trend leg itself is the context. Red zones are short continuations, green zones are long continuations, and target-room filtering keeps trades away from cramped ranges.',
    description: DISPLACEMENT_PULLBACK_CONTINUATION_TEMPLATE_DESCRIPTION,
  };

  return {
    ...config,
    automationProfile: buildStrategyTemplateAutomationProfile(config),
  };
}

export function buildDisplacementPullbackContinuationTemplatePayload() {
  return {
    name: DISPLACEMENT_PULLBACK_CONTINUATION_TEMPLATE_NAME,
    description: DISPLACEMENT_PULLBACK_CONTINUATION_TEMPLATE_DESCRIPTION,
    status: 'Active' as const,
    config: buildDisplacementPullbackContinuationTemplateConfig(),
  };
}
