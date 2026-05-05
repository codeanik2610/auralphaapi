#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from math import ceil
from pathlib import Path
from typing import Any

import pandas as pd


def _load_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("Missing JSON payload for automation signal evaluation")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("Automation signal evaluation payload must be an object")
    return payload


def _install_discovery_engine_root(root_value: Any) -> Path:
    root = Path(str(root_value or "")).expanduser().resolve()
    if not root.exists():
        raise ValueError(f"Discovery engine root does not exist: {root}")
    if not (root / "app").exists():
        raise ValueError(f"Discovery engine root is missing app/: {root}")
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    return root


def _timeframe_to_seconds(value: str) -> int | None:
    match = value.strip().lower()
    if not match:
        return None
    units = {"m": 60, "h": 3600, "d": 86400, "w": 604800}
    suffix = match[-1]
    if suffix not in units:
        return None
    try:
        amount = int(match[:-1])
    except Exception:
        return None
    if amount <= 0:
        return None
    return amount * units[suffix]


def _bool_at(series: Any, index: int | None) -> bool:
    if index is None:
        return False
    if hasattr(series, "iloc"):
        try:
            return bool(series.iloc[index])
        except Exception:
            return False
    try:
        return bool(series[index])
    except Exception:
        return False


def _planned_entry_price(trade_plan: Any, fallback: Any) -> float:
    if isinstance(trade_plan, dict):
        for key in ("entry_price", "entryPrice"):
            try:
                value = float(trade_plan.get(key))
            except Exception:
                value = float("nan")
            if pd.notna(value) and value > 0:
                return float(value)
    return float(fallback)


def _parse_iso_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    raw = str(value or "").strip()
    if not raw:
        return datetime.now(timezone.utc)
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_optional_iso_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return _parse_iso_datetime(raw)
    except Exception:
        return None


def _resolve_closed_indexes(
    df: pd.DataFrame,
    timeframe: str,
    evaluated_at: datetime,
) -> tuple[int | None, int | None, str | None]:
    if df.empty or "timestamp" not in df.columns:
        return None, None, "No candles returned"

    bucket_seconds = _timeframe_to_seconds(timeframe)
    if bucket_seconds is None:
        return None, None, f"Unsupported timeframe: {timeframe}"

    timestamps = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    valid = timestamps.notna()
    if not valid.any():
        return None, None, "No valid timestamps available"

    current_bucket_start = pd.Timestamp(
        (int(evaluated_at.timestamp()) // bucket_seconds) * bucket_seconds,
        unit="s",
        tz="UTC",
    )
    eligible = timestamps[timestamps < current_bucket_start]
    if eligible.empty:
        return None, None, "No closed candle available yet"

    latest_index = int(eligible.index[-1])
    latest_time = timestamps.iloc[latest_index]
    if current_bucket_start.to_pydatetime() - latest_time.to_pydatetime() >= timedelta(
        seconds=bucket_seconds * 2
    ):
        return None, None, "Latest closed candle is stale"

    previous_index = int(eligible.index[-2]) if len(eligible.index) >= 2 else None
    return latest_index, previous_index, None


async def _evaluate() -> dict[str, Any]:
    payload = _load_payload()
    _install_discovery_engine_root(payload.get("discoveryEngineRoot"))

    from app.engine.data.db_candles_fetcher import DBCandlesFetcher
    from app.engine.strategy_templates.backtester import TemplateBacktester
    from app.engine.strategy_templates.models import StrategyTemplate
    from app.engine.strategy_templates.python_runner import PythonStrategyExecutor
    from app.engine.strategy_templates.rule_engine import RuleEngine

    template_payload = payload.get("template")
    if not isinstance(template_payload, dict):
        raise ValueError("template is required")

    template_config = template_payload.get("config")
    if not isinstance(template_config, dict):
        template_config = template_payload

    template = StrategyTemplate(
        id=str(template_payload.get("id") or "automation-template"),
        name=str(template_payload.get("name") or "Automation Template"),
        config=template_config if isinstance(template_config, dict) else {},
    )

    timeframe = str(payload.get("timeframe") or "").strip()
    if not timeframe:
        raise ValueError("timeframe is required")

    symbols = payload.get("symbols")
    if not isinstance(symbols, list) or not symbols:
        raise ValueError("symbols must be a non-empty list")
    normalized_symbols = [
        str(symbol or "").strip().upper() for symbol in symbols if str(symbol or "").strip()
    ]
    if not normalized_symbols:
        raise ValueError("symbols must contain at least one non-empty symbol")

    parser = TemplateBacktester(fetcher=None)
    spec = parser._parse_template(template)
    if spec is None:
        raise ValueError("Template is missing an executable entry/exit contract")
    python_executor = (
        PythonStrategyExecutor.from_code(spec.code_definition)
        if spec.code_target == "python" and spec.code_definition
        else None
    )

    db_url = str(payload.get("dbUrl") or "").strip()
    if not db_url:
        raise ValueError("dbUrl is required")

    evaluated_at = _parse_iso_datetime(payload.get("evaluatedAt"))
    limit = int(payload.get("limit") or 300)
    warmup_bars = max(int(payload.get("warmupBars") or 200), 10)
    candles_table = str(payload.get("candlesTable") or "market_candles_1m").strip()
    candles_schema = str(payload.get("candlesSchema") or "public").strip() or None
    candles_max_rows = int(payload.get("candlesMaxRows") or 200000)
    cursor_by_symbol = payload.get("cursorBySymbol")
    if not isinstance(cursor_by_symbol, dict):
        cursor_by_symbol = {}
    signal_selection_mode = str(payload.get("signalSelectionMode") or "latest_closed_only").strip().lower()
    if signal_selection_mode not in {"latest_closed_only", "cursor_gap"}:
        signal_selection_mode = "latest_closed_only"

    bucket_seconds = _timeframe_to_seconds(timeframe)
    if bucket_seconds is None:
        raise ValueError(f"Unsupported timeframe: {timeframe}")

    fetcher = DBCandlesFetcher(
        db_url=db_url,
        table=candles_table,
        schema=candles_schema,
        max_rows=max(1000, candles_max_rows),
    )

    items: list[dict[str, Any]] = []
    evaluated_symbols = 0
    skipped_symbols = 0

    try:
        for symbol in normalized_symbols:
            cursor_time = _parse_optional_iso_datetime(cursor_by_symbol.get(symbol))
            required_limit = max(50, limit)
            if cursor_time is not None:
                gap_seconds = max((evaluated_at - cursor_time).total_seconds(), 0.0)
                required_bars = int(ceil(gap_seconds / bucket_seconds)) + warmup_bars + 2
                if required_bars > candles_max_rows:
                    items.append(
                        {
                            "symbol": symbol,
                            "timeframe": timeframe,
                            "status": "failed",
                            "reason": "Cursor gap exceeds configured candle fetch limit",
                        }
                    )
                    skipped_symbols += 1
                    continue
                required_limit = max(required_limit, required_bars)

            try:
                df = await fetcher.fetch_ohlcv(
                    symbol,
                    timeframe,
                    limit=max(50, required_limit),
                    end=evaluated_at.isoformat(),
                )
            except Exception as exc:
                items.append(
                    {
                        "symbol": symbol,
                        "timeframe": timeframe,
                        "status": "failed",
                        "reason": f"Failed to load candles: {exc}",
                    }
                )
                skipped_symbols += 1
                continue

            if df.empty:
                items.append(
                    {
                        "symbol": symbol,
                        "timeframe": timeframe,
                        "status": "no_data",
                        "reason": "No candles available",
                    }
                )
                skipped_symbols += 1
                continue

            latest_index, previous_index, reason = _resolve_closed_indexes(df, timeframe, evaluated_at)
            if latest_index is None:
                items.append(
                    {
                        "symbol": symbol,
                        "timeframe": timeframe,
                        "status": "stale" if reason == "Latest closed candle is stale" else "no_data",
                        "reason": reason,
                    }
                )
                skipped_symbols += 1
                continue

            entry_trade_plans = None
            entry_short_trade_plans = None
            if python_executor is not None:
                bundle = python_executor.build_signal_bundle(df)
                entry = bundle.entry_long
                exit_ = bundle.exit_long
                entry_short = bundle.entry_short
                exit_short = bundle.exit_short
                entry_trade_plans = bundle.entry_long_plans
                entry_short_trade_plans = bundle.entry_short_plans
            else:
                engine = RuleEngine(df)
                entry, exit_, entry_short, exit_short = engine.build_signals_with_shorts(
                    spec.entry_rules,
                    spec.exit_rules,
                    spec.entry_short_rules,
                    spec.exit_short_rules,
                )

            latest_row = df.iloc[latest_index]
            timestamps = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
            current_bucket_start = pd.Timestamp(
                (int(evaluated_at.timestamp()) // bucket_seconds) * bucket_seconds,
                unit="s",
                tz="UTC",
            )
            closed_candidate_indexes = list(timestamps[timestamps < current_bucket_start].index)
            latest_closed_signal_time = pd.to_datetime(latest_row["timestamp"], utc=True).isoformat()
            latest_closed_datetime = pd.to_datetime(
                latest_row["timestamp"], utc=True
            ).to_pydatetime()
            if cursor_time is not None and latest_closed_datetime <= cursor_time:
                candidate_indexes = []
            elif signal_selection_mode == "latest_closed_only" or cursor_time is None:
                candidate_indexes = [latest_index]
            else:
                candidate_indexes = [
                    int(idx)
                    for idx in closed_candidate_indexes
                    if pd.to_datetime(df.iloc[int(idx)]["timestamp"], utc=True).to_pydatetime()
                    > cursor_time
                ]

            signal_events: list[dict[str, Any]] = []
            for candidate_index in candidate_indexes:
                previous_bar_index = candidate_index - 1 if candidate_index > 0 else None
                candidate_row = df.iloc[candidate_index]
                candidate_signal_time = pd.to_datetime(
                    candidate_row["timestamp"], utc=True
                ).isoformat()
                candidate_fallback_entry_price = float(candidate_row["close"])
                long_entry = _bool_at(entry, candidate_index)
                long_entry_previous = _bool_at(entry, previous_bar_index)
                long_exit = _bool_at(exit_, candidate_index)
                if long_entry and not long_entry_previous and not long_exit:
                    long_trade_plan = (
                        entry_trade_plans.iloc[candidate_index]
                        if entry_trade_plans is not None
                        else None
                    )
                    signal_events.append(
                        {
                            "side": "long",
                            "signalTime": candidate_signal_time,
                            "entryPrice": _planned_entry_price(
                                long_trade_plan, candidate_fallback_entry_price
                            ),
                            "tradePlan": long_trade_plan,
                        }
                    )

                short_entry = _bool_at(entry_short, candidate_index)
                short_entry_previous = _bool_at(entry_short, previous_bar_index)
                short_exit = _bool_at(exit_short, candidate_index)
                if short_entry and not short_entry_previous and not short_exit:
                    short_trade_plan = (
                        entry_short_trade_plans.iloc[candidate_index]
                        if entry_short_trade_plans is not None
                        else None
                    )
                    signal_events.append(
                        {
                            "side": "short",
                            "signalTime": candidate_signal_time,
                            "entryPrice": _planned_entry_price(
                                short_trade_plan, candidate_fallback_entry_price
                            ),
                            "tradePlan": short_trade_plan,
                        }
                    )

            evaluated_symbols += 1
            items.append(
                {
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "status": "ok",
                    "signalTime": pd.to_datetime(latest_row["timestamp"], utc=True).isoformat(),
                    "latestClosedSignalTime": latest_closed_signal_time,
                    "entryPrice": float(latest_row["close"]),
                    "longEntry": _bool_at(entry, latest_index),
                    "longEntryPrevious": _bool_at(entry, previous_index),
                    "longExit": _bool_at(exit_, latest_index),
                    "shortEntry": _bool_at(entry_short, latest_index),
                    "shortEntryPrevious": _bool_at(entry_short, previous_index),
                    "shortExit": _bool_at(exit_short, latest_index),
                    "signalSelectionMode": signal_selection_mode,
                    "signals": signal_events,
                }
            )
    finally:
        await fetcher.close()

    return {
        "items": items,
        "evaluatedSymbols": evaluated_symbols,
        "skippedSymbols": skipped_symbols,
    }


def main() -> int:
    try:
        result = asyncio.run(_evaluate())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
