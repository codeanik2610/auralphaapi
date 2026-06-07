import { buildStrategyTemplateAutomationProfile } from '../../utils/strategyTemplateAutomation';

export const FVG_FAKEOUT_CONTINUATION_TEMPLATE_NAME = 'FVG Fakeout Continuation 1:4 BE';

export const FVG_FAKEOUT_CONTINUATION_TEMPLATE_DESCRIPTION =
  'Displacement move, compact compression, liquidity fakeout into the same-side FVG, rejection, and continuation entry. Buy setups reject a downside sweep from a bullish FVG; sell setups reject an upside sweep from a bearish FVG. Default target is 1:4 with SL moving to cost-to-cost at 2R.';

export const FVG_FAKEOUT_CONTINUATION_PYTHON_CODE = String.raw`from auralpha import Strategy


class FvgFakeoutContinuation(Strategy):
    name = "FVG Fakeout Continuation 1:4 BE"
    market = "crypto-futures"
    timeframe = "automation"

    params = {
        "reward_r": 4,
        "average_body_period": 12,
        "displacement_body_mult": 1.4,
        "displacement_range_mult": 1.1,
        "displacement_body_to_range": 0.5,
        "continuation_body_mult": 0.45,
        "close_near_extreme_pct": 0.4,
        "min_compression_bars": 2,
        "max_compression_bars": 8,
        "compression_max_range_mult": 1.25,
        "compression_min_overlap_ratio": 0.2,
        "compression_min_small_bodies": 1,
        "max_entry_bars_after_sweep": 4,
        "stop_buffer_pct": 0.0005,
    }

    risk = {
        "max_per_trade": 1,
        "signal_threshold": 0.68,
        "stopLossMode": "dynamic_fvg_fakeout_extreme",
        "takeProfitMode": "dynamic_r_multiple",
        "risk_reward_ratio": 4,
    }

    def prepare(self, df):
        total = len(df)
        self._long_signals = [False] * total
        self._short_signals = [False] * total
        self._long_plans = [None] * total
        self._short_plans = [None] * total

        if total < 7:
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

    def _reward_r(self):
        return max(1.0, self._param_float("reward_r", 4.0))

    def _average_body_period(self):
        return max(3, self._param_int("average_body_period", 12))

    def _displacement_body_mult(self):
        return max(0.5, self._param_float("displacement_body_mult", 1.4))

    def _displacement_range_mult(self):
        return max(0.5, self._param_float("displacement_range_mult", 1.1))

    def _displacement_body_to_range(self):
        return min(0.95, max(0.1, self._param_float("displacement_body_to_range", 0.5)))

    def _continuation_body_mult(self):
        return max(0.1, self._param_float("continuation_body_mult", 0.45))

    def _close_near_extreme_pct(self):
        return min(0.8, max(0.05, self._param_float("close_near_extreme_pct", 0.4)))

    def _min_compression_bars(self):
        return max(1, self._param_int("min_compression_bars", 2))

    def _max_compression_bars(self):
        return max(self._min_compression_bars(), self._param_int("max_compression_bars", 8))

    def _compression_max_range_mult(self):
        return max(0.2, self._param_float("compression_max_range_mult", 1.25))

    def _compression_min_overlap_ratio(self):
        return min(1.0, max(0.0, self._param_float("compression_min_overlap_ratio", 0.2)))

    def _compression_min_small_bodies(self):
        return max(0, self._param_int("compression_min_small_bodies", 1))

    def _max_entry_bars_after_sweep(self):
        return max(1, self._param_int("max_entry_bars_after_sweep", 4))

    def _stop_buffer_pct(self):
        return max(0.0, self._param_float("stop_buffer_pct", 0.0005))

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

    def _is_small_body(self, df, index):
        return self._body(df, index) <= self._avg_body(df, index) * 0.9

    def _body_to_range(self, df, index):
        candle_range = self._range(df, index)
        if candle_range <= 0:
            return 0.0
        return self._body(df, index) / candle_range

    def _bullish_fvg(self, df, index):
        if index < 2:
            return None
        lower = self._high(df, index - 2)
        upper = self._low(df, index)
        if lower >= upper:
            return None
        return {
            "origin_index": index,
            "side": "bullish",
            "lower": lower,
            "upper": upper,
            "source_index": index - 2,
        }

    def _bearish_fvg(self, df, index):
        if index < 2:
            return None
        lower = self._high(df, index)
        upper = self._low(df, index - 2)
        if lower >= upper:
            return None
        return {
            "origin_index": index,
            "side": "bearish",
            "lower": lower,
            "upper": upper,
            "source_index": index - 2,
        }

    def _is_bullish_displacement_with_fvg(self, df, index):
        fvg = self._bullish_fvg(df, index)
        if fvg is None:
            return False

        candle_range = self._range(df, index)
        if candle_range <= 0:
            return False

        close_near_high = (self._high(df, index) - self._close(df, index)) / candle_range
        return (
            self._is_green(df, index)
            and self._body(df, index) >= self._avg_body(df, index) * self._displacement_body_mult()
            and candle_range >= self._avg_range(df, index) * self._displacement_range_mult()
            and self._body_to_range(df, index) >= self._displacement_body_to_range()
            and close_near_high <= self._close_near_extreme_pct()
        )

    def _is_bearish_displacement_with_fvg(self, df, index):
        fvg = self._bearish_fvg(df, index)
        if fvg is None:
            return False

        candle_range = self._range(df, index)
        if candle_range <= 0:
            return False

        close_near_low = (self._close(df, index) - self._low(df, index)) / candle_range
        return (
            self._is_red(df, index)
            and self._body(df, index) >= self._avg_body(df, index) * self._displacement_body_mult()
            and candle_range >= self._avg_range(df, index) * self._displacement_range_mult()
            and self._body_to_range(df, index) >= self._displacement_body_to_range()
            and close_near_low <= self._close_near_extreme_pct()
        )

    def _compression_bounds(self, df, start_index, end_index):
        highs = [self._high(df, item) for item in range(start_index, end_index)]
        lows = [self._low(df, item) for item in range(start_index, end_index)]
        if not highs or not lows:
            return None
        return min(lows), max(highs)

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

    def _compression_ok(self, df, start_index, end_index):
        length = end_index - start_index
        if length < self._min_compression_bars():
            return False

        ranges = [self._range(df, item) for item in range(start_index, end_index)]
        if not ranges:
            return False

        average_compression_range = sum(ranges) / len(ranges)
        compact_range = average_compression_range <= self._avg_range(df, end_index) * self._compression_max_range_mult()

        small_bodies = 0
        overlaps = []
        for item in range(start_index, end_index):
            if self._is_small_body(df, item):
                small_bodies += 1
            if item > start_index:
                overlaps.append(self._overlap_ratio(df, item - 1, item))

        average_overlap = sum(overlaps) / len(overlaps) if overlaps else 0.0
        return (
            compact_range
            or small_bodies >= self._compression_min_small_bodies()
            or average_overlap >= self._compression_min_overlap_ratio()
        )

    def _pre_sweep_valid_for_long(self, df, start_index, end_index, fvg):
        for item in range(start_index, end_index):
            if self._close(df, item) < fvg["lower"]:
                return False
        return True

    def _pre_sweep_valid_for_short(self, df, start_index, end_index, fvg):
        for item in range(start_index, end_index):
            if self._close(df, item) > fvg["upper"]:
                return False
        return True

    def _valid_long_sweep_rejection(self, df, sweep_index, compression_low, fvg):
        return (
            self._low(df, sweep_index) < compression_low
            and self._low(df, sweep_index) <= fvg["upper"]
            and self._close(df, sweep_index) > compression_low
            and self._close(df, sweep_index) >= fvg["lower"]
        )

    def _valid_short_sweep_rejection(self, df, sweep_index, compression_high, fvg):
        return (
            self._high(df, sweep_index) > compression_high
            and self._high(df, sweep_index) >= fvg["lower"]
            and self._close(df, sweep_index) < compression_high
            and self._close(df, sweep_index) <= fvg["upper"]
        )

    def _valid_long_continuation(self, df, index, compression_high):
        return (
            self._is_green(df, index)
            and self._close(df, index) > compression_high
            and self._body(df, index) >= self._avg_body(df, index) * self._continuation_body_mult()
        )

    def _valid_short_continuation(self, df, index, compression_low):
        return (
            self._is_red(df, index)
            and self._close(df, index) < compression_low
            and self._body(df, index) >= self._avg_body(df, index) * self._continuation_body_mult()
        )

    def _build_long_signals(self, df):
        total = len(df)
        index = 2
        while index < total - self._min_compression_bars() - 2:
            if not self._is_bullish_displacement_with_fvg(df, index):
                index += 1
                continue

            entry_index = self._scan_long_after_displacement(df, index)
            if entry_index is not None:
                index = entry_index + 1
                continue

            index += 1

    def _build_short_signals(self, df):
        total = len(df)
        index = 2
        while index < total - self._min_compression_bars() - 2:
            if not self._is_bearish_displacement_with_fvg(df, index):
                index += 1
                continue

            entry_index = self._scan_short_after_displacement(df, index)
            if entry_index is not None:
                index = entry_index + 1
                continue

            index += 1

    def _scan_long_after_displacement(self, df, displacement_index):
        fvg = self._bullish_fvg(df, displacement_index)
        if fvg is None:
            return None

        compression_start = displacement_index + 1
        first_sweep = compression_start + self._min_compression_bars()
        last_sweep = min(len(df) - 1, compression_start + self._max_compression_bars())

        for sweep_index in range(first_sweep, last_sweep + 1):
            bounds = self._compression_bounds(df, compression_start, sweep_index)
            if bounds is None:
                continue
            compression_low, compression_high = bounds

            if not self._compression_ok(df, compression_start, sweep_index):
                continue
            if not self._pre_sweep_valid_for_long(df, compression_start, sweep_index, fvg):
                return None
            if not self._valid_long_sweep_rejection(df, sweep_index, compression_low, fvg):
                continue

            entry_index = self._scan_long_entry_after_sweep(
                df,
                displacement_index,
                compression_start,
                sweep_index,
                compression_low,
                compression_high,
                fvg,
            )
            if entry_index is not None:
                return entry_index

        return None

    def _scan_short_after_displacement(self, df, displacement_index):
        fvg = self._bearish_fvg(df, displacement_index)
        if fvg is None:
            return None

        compression_start = displacement_index + 1
        first_sweep = compression_start + self._min_compression_bars()
        last_sweep = min(len(df) - 1, compression_start + self._max_compression_bars())

        for sweep_index in range(first_sweep, last_sweep + 1):
            bounds = self._compression_bounds(df, compression_start, sweep_index)
            if bounds is None:
                continue
            compression_low, compression_high = bounds

            if not self._compression_ok(df, compression_start, sweep_index):
                continue
            if not self._pre_sweep_valid_for_short(df, compression_start, sweep_index, fvg):
                return None
            if not self._valid_short_sweep_rejection(df, sweep_index, compression_high, fvg):
                continue

            entry_index = self._scan_short_entry_after_sweep(
                df,
                displacement_index,
                compression_start,
                sweep_index,
                compression_low,
                compression_high,
                fvg,
            )
            if entry_index is not None:
                return entry_index

        return None

    def _scan_long_entry_after_sweep(
        self,
        df,
        displacement_index,
        compression_start,
        sweep_index,
        compression_low,
        compression_high,
        fvg,
    ):
        max_index = min(len(df), sweep_index + 1 + self._max_entry_bars_after_sweep())
        for entry_index in range(sweep_index + 1, max_index):
            if self._close(df, entry_index) < fvg["lower"]:
                return None
            if self._valid_long_continuation(df, entry_index, compression_high):
                if self._set_long_plan(
                    df,
                    displacement_index,
                    compression_start,
                    sweep_index,
                    entry_index,
                    compression_low,
                    compression_high,
                    fvg,
                ):
                    return entry_index
                return None
        return None

    def _scan_short_entry_after_sweep(
        self,
        df,
        displacement_index,
        compression_start,
        sweep_index,
        compression_low,
        compression_high,
        fvg,
    ):
        max_index = min(len(df), sweep_index + 1 + self._max_entry_bars_after_sweep())
        for entry_index in range(sweep_index + 1, max_index):
            if self._close(df, entry_index) > fvg["upper"]:
                return None
            if self._valid_short_continuation(df, entry_index, compression_low):
                if self._set_short_plan(
                    df,
                    displacement_index,
                    compression_start,
                    sweep_index,
                    entry_index,
                    compression_low,
                    compression_high,
                    fvg,
                ):
                    return entry_index
                return None
        return None

    def _set_long_plan(
        self,
        df,
        displacement_index,
        compression_start,
        sweep_index,
        entry_index,
        compression_low,
        compression_high,
        fvg,
    ):
        entry_price = self._close(df, entry_index)
        stop_loss_price = self._low(df, sweep_index) * (1.0 - self._stop_buffer_pct())
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
            "label": "fvg_fakeout_continuation_long",
            "metadata": {
                "pattern": "bullish_displacement_compression_fakeout_fvg_rejection_continuation",
                "displacement_index": displacement_index,
                "compression_start_index": compression_start,
                "sweep_index": sweep_index,
                "entry_index": entry_index,
                "entry_basis": "continuation_close",
                "stop_basis": "fake_breakout_low_buffered",
                "target_basis": "entry_plus_configured_r",
                "fvg": fvg,
                "compression_low": compression_low,
                "compression_high": compression_high,
                "context_filters": [
                    "bullish_displacement",
                    "bullish_fvg",
                    "compression",
                    "downside_liquidity_sweep",
                    "fvg_rejection",
                    "bullish_continuation_close",
                ],
                "setup_markers": [
                    self._setup_marker(df, "MV", "move", displacement_index, self._high(df, displacement_index)),
                    self._setup_marker(df, "FVG", "fair_value_gap", displacement_index, fvg["upper"]),
                    self._setup_marker(df, "CMP", "compression", sweep_index - 1, compression_low),
                    self._setup_marker(df, "SW", "fake_breakout", sweep_index, self._low(df, sweep_index)),
                    self._setup_marker(df, "EN", "entry", entry_index, entry_price),
                ],
            },
        }
        return True

    def _set_short_plan(
        self,
        df,
        displacement_index,
        compression_start,
        sweep_index,
        entry_index,
        compression_low,
        compression_high,
        fvg,
    ):
        entry_price = self._close(df, entry_index)
        stop_loss_price = self._high(df, sweep_index) * (1.0 + self._stop_buffer_pct())
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
            "label": "fvg_fakeout_continuation_short",
            "metadata": {
                "pattern": "bearish_displacement_compression_fakeout_fvg_rejection_continuation",
                "displacement_index": displacement_index,
                "compression_start_index": compression_start,
                "sweep_index": sweep_index,
                "entry_index": entry_index,
                "entry_basis": "continuation_close",
                "stop_basis": "fake_breakout_high_buffered",
                "target_basis": "entry_minus_configured_r",
                "fvg": fvg,
                "compression_low": compression_low,
                "compression_high": compression_high,
                "context_filters": [
                    "bearish_displacement",
                    "bearish_fvg",
                    "compression",
                    "upside_liquidity_sweep",
                    "fvg_rejection",
                    "bearish_continuation_close",
                ],
                "setup_markers": [
                    self._setup_marker(df, "MV", "move", displacement_index, self._low(df, displacement_index)),
                    self._setup_marker(df, "FVG", "fair_value_gap", displacement_index, fvg["lower"]),
                    self._setup_marker(df, "CMP", "compression", sweep_index - 1, compression_high),
                    self._setup_marker(df, "SW", "fake_breakout", sweep_index, self._high(df, sweep_index)),
                    self._setup_marker(df, "EN", "entry", entry_index, entry_price),
                ],
            },
        }
        return True

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
`;

export function buildFvgFakeoutContinuationTemplateConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {
    codeTarget: 'python',
    codeDefinition: FVG_FAKEOUT_CONTINUATION_PYTHON_CODE,
    authoredCodeTarget: 'python',
    authoredCodeDefinition: FVG_FAKEOUT_CONTINUATION_PYTHON_CODE,
    compiledCodeTarget: 'python',
    compiledCodeDefinition: FVG_FAKEOUT_CONTINUATION_PYTHON_CODE,
    market: 'crypto-futures',
    entryLogic:
      'Buy: require a bullish displacement candle that creates a bullish FVG. Price must compress after the move, fake-break below compression low into the FVG, close back above the compression low, then print a bullish continuation close above compression high. Entry uses the continuation close.',
    exitLogic:
      'Long exit is managed by a stop below the fake-breakout low, 1:4 dynamic R target, and SL ladder that moves to cost-to-cost at 2R.',
    entryShortLogic:
      'Sell: require a bearish displacement candle that creates a bearish FVG. Price must compress after the move, fake-break above compression high into the FVG, close back below the compression high, then print a bearish continuation close below compression low. Entry uses the continuation close.',
    exitShortLogic:
      'Short exit is managed by a stop above the fake-breakout high, 1:4 dynamic R target, and SL ladder that moves to cost-to-cost at 2R.',
    shortEnabled: true,
    risk: {
      maxRisk: '1',
      max_per_trade: 1,
      signal_threshold: 0.68,
      stopLossMode: 'dynamic_fvg_fakeout_extreme',
      stop_loss_mode: 'dynamic_fvg_fakeout_extreme',
      takeProfitMode: 'dynamic_r_multiple',
      take_profit_mode: 'dynamic_r_multiple',
      riskRewardRatio: 4,
      risk_reward_ratio: 4,
      sizingNotes:
        'Per-trade entry, stop, and target are emitted by the Python entry plan. Long stops are buffered below the fake-breakout low; short stops are buffered above the fake-breakout high. Default target is 4R. Custom R ladder moves SL to cost-to-cost at +2R.',
    },
    parameters: {
      signalThreshold: '0.68',
      signal_threshold: 0.68,
      rewardR: 4,
      reward_r: 4,
      averageBodyPeriod: 12,
      average_body_period: 12,
      displacementBodyMult: 1.4,
      displacement_body_mult: 1.4,
      displacementRangeMult: 1.1,
      displacement_range_mult: 1.1,
      displacementBodyToRange: 0.5,
      displacement_body_to_range: 0.5,
      continuationBodyMult: 0.45,
      continuation_body_mult: 0.45,
      closeNearExtremePct: 0.4,
      close_near_extreme_pct: 0.4,
      minCompressionBars: 2,
      min_compression_bars: 2,
      maxCompressionBars: 8,
      max_compression_bars: 8,
      compressionMaxRangeMult: 1.25,
      compression_max_range_mult: 1.25,
      compressionMinOverlapRatio: 0.2,
      compression_min_overlap_ratio: 0.2,
      compressionMinSmallBodies: 1,
      compression_min_small_bodies: 1,
      maxEntryBarsAfterSweep: 4,
      max_entry_bars_after_sweep: 4,
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
        rules: [{ whenProfitR: 2, moveStopToR: 0 }],
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
      'This template turns the visual idea into deterministic rules: displacement creates the FVG, compression forms after the move, a liquidity sweep must fake-break the compression in the opposite direction and reject from the FVG, and entry only happens after continuation closes back in the original move direction. It is separate from the two-stage candle breakout template.',
    description: FVG_FAKEOUT_CONTINUATION_TEMPLATE_DESCRIPTION,
  };

  return {
    ...config,
    automationProfile: buildStrategyTemplateAutomationProfile(config),
  };
}

export function buildFvgFakeoutContinuationTemplatePayload() {
  return {
    name: FVG_FAKEOUT_CONTINUATION_TEMPLATE_NAME,
    description: FVG_FAKEOUT_CONTINUATION_TEMPLATE_DESCRIPTION,
    status: 'Active' as const,
    config: buildFvgFakeoutContinuationTemplateConfig(),
  };
}
