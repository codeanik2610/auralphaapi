// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { Service } from 'typedi';
import { BadRequestAppError } from '../../errors/AppError';
import type {
  StrategyCatalogItem,
  StrategyRunQuery,
  SolSmcOnePositionStrategyResult,
} from '../../contracts/Strategy';
import type { StrategyHandler } from '../StrategyRegistry';

const DEFAULT_OUT_DIR = path.resolve('artifacts/smc-dry-run-solusdt/smc-3m-one-position-strategy');
const SYMBOL = 'SOLUSDT';
const SOURCE = 'https://fapi.binance.com/fapi/v1/klines';
const WINDOW_DAYS = 30;
const WARMUP_DAYS = 7;
const VALIDATION_DAYS = 10;
const ENV_WINDOW_END_ISO = String(process.env.SMC_WINDOW_END || '').trim();
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEFRAMES = [{ timeframe: '3m', intervalMs: 3 * 60 * 1000, htfMs: 60 * 60 * 1000 }];

const V1 = {
  name: 'SMC v1 baseline',
  swingWidth: 3,
  liquidityLookback: 90,
  structureLookback: 55,
  maxMssBars: 24,
  maxRetestBars: 64,
  maxHoldBars: 96,
  minRiskPct: 0.0005,
  rewardR: 3,
  strict: false,
};

const V2 = {
  ...V1,
  name: 'SMC v2 strict',
  liquidityLookback: 140,
  structureLookback: 80,
  maxMssBars: 18,
  maxRetestBars: 48,
  maxHoldBars: 96,
  minRiskPct: 0.0007,
  minSweepDepthRange: 0.2,
  minSweepWickRatio: 0.42,
  minDisplacementBodyMultiple: 1.15,
  minDisplacementBodyRatio: 0.55,
  fvgToleranceRange: 0.5,
  requireFvgConfluence: true,
  useHtfBias: true,
  entryMode: 'ob-edge',
  stopBufferRange: 0,
  breakEvenAtR: null,
  breakEvenOffsetR: 0,
  allowedHoursUtc: null,
  strict: true,
};

const STRATEGY = {
  ...V2,
  name: 'SOLUSDT 3m SMC one-position side-hour strategy',
  rewardR: 8,
  liquidityLookback: 40,
  structureLookback: 25,
  maxMssBars: 36,
  maxRetestBars: 96,
  maxHoldBars: 192,
  minRiskPct: 0.0005,
  minSweepDepthRange: 0.08,
  minSweepWickRatio: 0.28,
  minDisplacementBodyMultiple: 0.8,
  minDisplacementBodyRatio: 0.46,
  fvgToleranceRange: 1,
  requireFvgConfluence: false,
  useHtfBias: true,
  entryMode: 'ob-mid',
  stopBufferRange: 0,
  breakEvenAtR: null,
  breakEvenOffsetR: 0,
  maxConcurrent: 1,
  sideMode: 'both',
  sideHourMode: 'minedPositive',
  allowedHoursUtc: null,
  sessionName: 'all',
};

const EXPECTED_RESULT = {
  trades: 29,
  winRate: 0.3448,
  totalR: 83.18,
  validationR: 21.8,
  maxDrawdownR: 3,
  maxOpenTrades: 1,
};

export const SOL_SMC_ONE_POSITION_STRATEGY_ID = 'solusdt-smc-one-position';
export const SOL_SMC_ONE_POSITION_BACKTEST_STRATEGY = 'solusdt-3m-smc-one-position-sidehour';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const formatPrice = (value) =>
  Number.isFinite(value) ? value.toFixed(4).replace(/\.?0+$/, '') : 'n/a';

const formatTime = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      `Unexpected Binance payload for ${url}: ${JSON.stringify(payload).slice(0, 200)}`
    );
  }
  return payload;
};

const klineToCandle = (row, index = 0) => ({
  index,
  openTime: Number(row[0]),
  open: parseNumber(row[1]),
  high: parseNumber(row[2]),
  low: parseNumber(row[3]),
  close: parseNumber(row[4]),
  volume: parseNumber(row[5]) ?? 0,
});

const normalizeCandles = (rows) =>
  rows
    .map(klineToCandle)
    .filter(
      (item) =>
        Number.isFinite(item.openTime) &&
        [item.open, item.high, item.low, item.close].every((value) => Number.isFinite(value))
    )
    .sort((left, right) => left.openTime - right.openTime)
    .filter((item, index, array) => index === 0 || item.openTime !== array[index - 1].openTime)
    .map((item, index) => ({ ...item, index }));

const resolveWindowEndOption = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw || raw.toLowerCase() === 'latest' || raw.toLowerCase() === 'dynamic') {
    return {
      fixedWindowEnd: null,
      requestedWindowEnd: raw || 'latest',
      windowEndMode: 'latest',
    };
  }

  const fixedWindowEnd = Date.parse(raw);
  if (!Number.isFinite(fixedWindowEnd)) {
    throw new Error(`SMC windowEnd must be an ISO timestamp or "latest". Received: ${raw}`);
  }

  return {
    fixedWindowEnd,
    requestedWindowEnd: raw,
    windowEndMode: 'fixed',
  };
};

const fetchCandles = async ({ timeframe, intervalMs, fixedWindowEnd = null }) => {
  let windowEnd = Number(fixedWindowEnd);
  if (!Number.isFinite(windowEnd)) {
    const latestUrl = `${SOURCE}?symbol=${SYMBOL}&interval=${timeframe}&limit=1`;
    const latestRows = await fetchJson(latestUrl);
    if (!latestRows.length) {
      throw new Error(`No latest candle returned for ${SYMBOL} ${timeframe}`);
    }
    windowEnd = Number(latestRows[0][0]);
  }
  const windowStart = windowEnd - WINDOW_DAYS * DAY_MS;
  const fetchStart = windowEnd - (WINDOW_DAYS + WARMUP_DAYS) * DAY_MS;
  let endTime = windowEnd + intervalMs - 1;
  const rows = [];

  while (endTime >= fetchStart) {
    const url = `${SOURCE}?symbol=${SYMBOL}&interval=${timeframe}&limit=1500&endTime=${endTime}`;
    const batch = await fetchJson(url);
    if (!batch.length) break;
    rows.unshift(...batch);
    const firstOpenTime = Number(batch[0][0]);
    if (!Number.isFinite(firstOpenTime) || firstOpenTime <= fetchStart) break;
    endTime = firstOpenTime - 1;
    await sleep(80);
  }

  const candles = normalizeCandles(rows).filter(
    (candle) => candle.openTime >= fetchStart && candle.openTime <= windowEnd
  );
  return { candles, windowStart, windowEnd };
};

const resampleCandles = (candles, bucketMs) => {
  const buckets = new Map();
  for (const candle of candles) {
    const bucketOpenTime = Math.floor(candle.openTime / bucketMs) * bucketMs;
    const existing = buckets.get(bucketOpenTime);
    if (!existing) {
      buckets.set(bucketOpenTime, {
        openTime: bucketOpenTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      continue;
    }
    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }
  return Array.from(buckets.values())
    .sort((left, right) => left.openTime - right.openTime)
    .map((item, index) => ({ ...item, index }));
};

const findSwings = (candles, width) => {
  const highs = [];
  const lows = [];
  for (let index = width; index < candles.length - width; index += 1) {
    const candle = candles[index];
    let isHigh = true;
    let isLow = true;
    for (let offset = index - width; offset <= index + width; offset += 1) {
      if (offset === index) continue;
      if (candles[offset].high >= candle.high) isHigh = false;
      if (candles[offset].low <= candle.low) isLow = false;
    }
    if (isHigh) highs.push({ index, price: candle.high, openTime: candle.openTime });
    if (isLow) lows.push({ index, price: candle.low, openTime: candle.openTime });
  }
  return { highs, lows };
};

const recentSwing = (swings, beforeIndex, lookback) => {
  for (let index = swings.length - 1; index >= 0; index -= 1) {
    const swing = swings[index];
    if (swing.index < beforeIndex && beforeIndex - swing.index <= lookback) {
      return swing;
    }
  }
  return null;
};

const recentRange = (candles, index, length = 24) => {
  const start = Math.max(0, index - length);
  const scoped = candles.slice(start, index);
  const ranges = scoped.map((item) => item.high - item.low).filter((value) => value > 0);
  return (
    median(ranges) ||
    median(candles.slice(Math.max(0, index - 80), index).map((item) => item.high - item.low)) ||
    0
  );
};

const recentBody = (candles, index, length = 24) => {
  const start = Math.max(0, index - length);
  return (
    median(
      candles
        .slice(start, index)
        .map((item) => Math.abs(item.close - item.open))
        .filter((value) => value > 0)
    ) || 0
  );
};

const findOrderBlock = (candles, startIndex, endIndex, side) => {
  const from = Math.max(0, startIndex - 8);
  for (let index = endIndex - 1; index >= from; index -= 1) {
    const candle = candles[index];
    if (
      (side === 'long' && candle.close < candle.open) ||
      (side === 'short' && candle.close > candle.open)
    ) {
      return { ...candle, index };
    }
  }
  return null;
};

const findFvg = (candles, startIndex, endIndex, side) => {
  for (let index = startIndex + 2; index <= endIndex; index += 1) {
    const left = candles[index - 2];
    const right = candles[index];
    if (side === 'long' && left.high < right.low) {
      return {
        index,
        low: left.high,
        high: right.low,
      };
    }
    if (side === 'short' && left.low > right.high) {
      return {
        index,
        low: right.high,
        high: left.low,
      };
    }
  }
  return null;
};

const zonesConfluent = (zoneA, zoneB, tolerance) => {
  if (!zoneA || !zoneB) return false;
  const overlap = Math.max(0, Math.min(zoneA.high, zoneB.high) - Math.max(zoneA.low, zoneB.low));
  if (overlap > 0) return true;
  const distance =
    zoneA.high < zoneB.low
      ? zoneB.low - zoneA.high
      : zoneA.low > zoneB.high
        ? zoneA.low - zoneB.high
        : 0;
  return distance <= tolerance;
};

const buildHtfBias = (baseCandles, htfMs) => {
  const htf = resampleCandles(baseCandles, htfMs);
  const swings = findSwings(htf, 2);
  const biasByOpenTime = new Map();

  for (const candle of baseCandles) {
    const htfIndex = htf.findLastIndex((item) => item.openTime <= candle.openTime);
    if (htfIndex < 20) {
      biasByOpenTime.set(candle.openTime, 'neutral');
      continue;
    }
    const scopedHighs = swings.highs.filter((swing) => swing.index < htfIndex).slice(-2);
    const scopedLows = swings.lows.filter((swing) => swing.index < htfIndex).slice(-2);
    const recent = htf.slice(Math.max(0, htfIndex - 20), htfIndex);
    const rangeHigh = Math.max(...recent.map((item) => item.high));
    const rangeLow = Math.min(...recent.map((item) => item.low));
    const midpoint = rangeLow + (rangeHigh - rangeLow) / 2;
    const lastClose = htf[htfIndex].close;
    const bullishStructure =
      scopedHighs.length >= 2 &&
      scopedLows.length >= 2 &&
      scopedHighs[1].price > scopedHighs[0].price &&
      scopedLows[1].price > scopedLows[0].price;
    const bearishStructure =
      scopedHighs.length >= 2 &&
      scopedLows.length >= 2 &&
      scopedHighs[1].price < scopedHighs[0].price &&
      scopedLows[1].price < scopedLows[0].price;

    if (bullishStructure || lastClose > midpoint) {
      biasByOpenTime.set(candle.openTime, 'long');
    } else if (bearishStructure || lastClose < midpoint) {
      biasByOpenTime.set(candle.openTime, 'short');
    } else {
      biasByOpenTime.set(candle.openTime, 'neutral');
    }
  }

  return biasByOpenTime;
};

const passesSweepFilter = (candles, index, swing, side, settings) => {
  if (!settings.strict) return true;
  const candle = candles[index];
  const avgRange = recentRange(candles, index);
  if (!avgRange) return false;
  const range = Math.max(candle.high - candle.low, 0.000001);

  if (side === 'long') {
    const sweepDepth = swing.price - candle.low;
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    return (
      sweepDepth >= settings.minSweepDepthRange * avgRange &&
      lowerWick / range >= settings.minSweepWickRatio &&
      candle.close > candle.low + range * 0.5
    );
  }

  const sweepDepth = candle.high - swing.price;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  return (
    sweepDepth >= settings.minSweepDepthRange * avgRange &&
    upperWick / range >= settings.minSweepWickRatio &&
    candle.close < candle.low + range * 0.5
  );
};

const passesDisplacementFilter = (candles, index, side, settings) => {
  if (!settings.strict) return true;
  const candle = candles[index];
  const range = Math.max(candle.high - candle.low, 0.000001);
  const body = Math.abs(candle.close - candle.open);
  const medianBody = recentBody(candles, index);
  if (!medianBody) return false;
  const closesStrong =
    side === 'long'
      ? candle.close >= candle.low + range * 0.72
      : candle.close <= candle.low + range * 0.28;
  return (
    body >= settings.minDisplacementBodyMultiple * medianBody &&
    body / range >= settings.minDisplacementBodyRatio &&
    closesStrong
  );
};

const evaluateTrade = (candles, trade, settings) => {
  const endIndex = Math.min(candles.length - 1, trade.entryIndex + settings.maxHoldBars);
  let activeStop = trade.stopLoss;
  const breakEvenAtR = Number.isFinite(settings.breakEvenAtR) ? settings.breakEvenAtR : null;
  const breakEvenOffsetR = Number.isFinite(settings.breakEvenOffsetR)
    ? settings.breakEvenOffsetR
    : 0;

  for (let index = trade.entryIndex; index <= endIndex; index += 1) {
    const candle = candles[index];
    if (trade.side === 'long') {
      const stopHit = candle.low <= activeStop;
      const targetHit = candle.high >= trade.target;
      if (stopHit && targetHit) {
        return {
          outcome: activeStop === trade.stopLoss ? 'stop' : 'breakeven',
          exitIndex: index,
          exitPrice: activeStop,
          realizedR:
            activeStop === trade.stopLoss
              ? -1
              : Number(((activeStop - trade.entryPrice) / trade.risk).toFixed(2)),
        };
      }
      if (targetHit)
        return {
          outcome: 'target',
          exitIndex: index,
          exitPrice: trade.target,
          realizedR: settings.rewardR,
        };
      if (stopHit) {
        return {
          outcome: activeStop === trade.stopLoss ? 'stop' : 'breakeven',
          exitIndex: index,
          exitPrice: activeStop,
          realizedR:
            activeStop === trade.stopLoss
              ? -1
              : Number(((activeStop - trade.entryPrice) / trade.risk).toFixed(2)),
        };
      }
      if (breakEvenAtR !== null && candle.high >= trade.entryPrice + trade.risk * breakEvenAtR) {
        activeStop = Math.max(activeStop, trade.entryPrice + trade.risk * breakEvenOffsetR);
      }
    } else {
      const stopHit = candle.high >= activeStop;
      const targetHit = candle.low <= trade.target;
      if (stopHit && targetHit) {
        return {
          outcome: activeStop === trade.stopLoss ? 'stop' : 'breakeven',
          exitIndex: index,
          exitPrice: activeStop,
          realizedR:
            activeStop === trade.stopLoss
              ? -1
              : Number(((trade.entryPrice - activeStop) / trade.risk).toFixed(2)),
        };
      }
      if (targetHit)
        return {
          outcome: 'target',
          exitIndex: index,
          exitPrice: trade.target,
          realizedR: settings.rewardR,
        };
      if (stopHit) {
        return {
          outcome: activeStop === trade.stopLoss ? 'stop' : 'breakeven',
          exitIndex: index,
          exitPrice: activeStop,
          realizedR:
            activeStop === trade.stopLoss
              ? -1
              : Number(((trade.entryPrice - activeStop) / trade.risk).toFixed(2)),
        };
      }
      if (breakEvenAtR !== null && candle.low <= trade.entryPrice - trade.risk * breakEvenAtR) {
        activeStop = Math.min(activeStop, trade.entryPrice - trade.risk * breakEvenOffsetR);
      }
    }
  }
  const last = candles[endIndex];
  const openR =
    trade.side === 'long'
      ? (last.close - trade.entryPrice) / trade.risk
      : (trade.entryPrice - last.close) / trade.risk;
  return {
    outcome: 'expired',
    exitIndex: endIndex,
    exitPrice: last.close,
    realizedR: Number(openR.toFixed(2)),
  };
};

const buildTrade = ({
  side,
  candles,
  sweepIndex,
  mssIndex,
  liquidity,
  structure,
  orderBlock,
  fvg,
  settings,
}) => {
  const entryPrice =
    settings.entryMode === 'ob-mid'
      ? (orderBlock.high + orderBlock.low) / 2
      : side === 'long'
        ? orderBlock.high
        : orderBlock.low;
  const stopBuffer = recentRange(candles, mssIndex) * (settings.stopBufferRange ?? 0);
  const stopLoss =
    side === 'long'
      ? Math.min(candles[sweepIndex].low, orderBlock.low) - stopBuffer
      : Math.max(candles[sweepIndex].high, orderBlock.high) + stopBuffer;
  const risk = side === 'long' ? entryPrice - stopLoss : stopLoss - entryPrice;
  if (!Number.isFinite(risk) || risk <= 0 || risk / entryPrice < settings.minRiskPct) return null;

  const target =
    side === 'long' ? entryPrice + settings.rewardR * risk : entryPrice - settings.rewardR * risk;
  const oneR = side === 'long' ? entryPrice + risk : entryPrice - risk;
  const retestEnd = Math.min(candles.length - 1, mssIndex + settings.maxRetestBars);
  for (let index = mssIndex + 1; index <= retestEnd; index += 1) {
    const candle = candles[index];
    if (
      settings.allowedHoursUtc &&
      !settings.allowedHoursUtc.includes(new Date(candle.openTime).getUTCHours())
    ) {
      continue;
    }
    const touched =
      side === 'long'
        ? candle.low <= entryPrice && candle.high >= orderBlock.low
        : candle.high >= entryPrice && candle.low <= orderBlock.high;
    if (!touched) continue;
    const trade = {
      side,
      sweepIndex,
      mssIndex,
      entryIndex: index,
      entryPrice,
      stopLoss,
      oneR,
      target,
      rewardR: settings.rewardR,
      risk,
      liquidity,
      structure,
      orderBlock,
      fvg,
      zoneHigh: orderBlock.high,
      zoneLow: orderBlock.low,
      setupTime: candles[sweepIndex].openTime,
    };
    return { ...trade, ...evaluateTrade(candles, trade, settings) };
  }
  return null;
};

const findTrades = ({ candles, htfBias, settings }) => {
  const swings = findSwings(candles, settings.swingWidth);
  const trades = [];

  for (let index = settings.liquidityLookback; index < candles.length - 5; index += 1) {
    const candle = candles[index];
    const priorLow = recentSwing(swings.lows, index, settings.liquidityLookback);
    const priorHigh = recentSwing(swings.highs, index, settings.liquidityLookback);

    if (priorLow && candle.low < priorLow.price && candle.close > priorLow.price) {
      const bias = htfBias?.get(candle.openTime) ?? 'neutral';
      if (!settings.strict || settings.useHtfBias === false || bias === 'long') {
        const structure = recentSwing(swings.highs, index, settings.structureLookback);
        if (structure && passesSweepFilter(candles, index, priorLow, 'long', settings)) {
          for (
            let mssIndex = index + 1;
            mssIndex <= Math.min(candles.length - 1, index + settings.maxMssBars);
            mssIndex += 1
          ) {
            const mssCandle = candles[mssIndex];
            if (mssCandle.close <= structure.price || mssCandle.close <= mssCandle.open) continue;
            if (!passesDisplacementFilter(candles, mssIndex, 'long', settings)) continue;
            const orderBlock = findOrderBlock(candles, index, mssIndex, 'long');
            if (!orderBlock) break;
            const fvg = findFvg(candles, index, mssIndex, 'long');
            const tolerance = recentRange(candles, mssIndex) * (settings.fvgToleranceRange ?? 0);
            const obZone = { low: orderBlock.low, high: orderBlock.high };
            if (settings.requireFvgConfluence && !zonesConfluent(obZone, fvg, tolerance)) break;
            const trade = buildTrade({
              side: 'long',
              candles,
              sweepIndex: index,
              mssIndex,
              liquidity: priorLow,
              structure,
              orderBlock,
              fvg,
              settings,
            });
            if (trade) trades.push(trade);
            break;
          }
        }
      }
    }

    if (priorHigh && candle.high > priorHigh.price && candle.close < priorHigh.price) {
      const bias = htfBias?.get(candle.openTime) ?? 'neutral';
      if (!settings.strict || settings.useHtfBias === false || bias === 'short') {
        const structure = recentSwing(swings.lows, index, settings.structureLookback);
        if (structure && passesSweepFilter(candles, index, priorHigh, 'short', settings)) {
          for (
            let mssIndex = index + 1;
            mssIndex <= Math.min(candles.length - 1, index + settings.maxMssBars);
            mssIndex += 1
          ) {
            const mssCandle = candles[mssIndex];
            if (mssCandle.close >= structure.price || mssCandle.close >= mssCandle.open) continue;
            if (!passesDisplacementFilter(candles, mssIndex, 'short', settings)) continue;
            const orderBlock = findOrderBlock(candles, index, mssIndex, 'short');
            if (!orderBlock) break;
            const fvg = findFvg(candles, index, mssIndex, 'short');
            const tolerance = recentRange(candles, mssIndex) * (settings.fvgToleranceRange ?? 0);
            const obZone = { low: orderBlock.low, high: orderBlock.high };
            if (settings.requireFvgConfluence && !zonesConfluent(obZone, fvg, tolerance)) break;
            const trade = buildTrade({
              side: 'short',
              candles,
              sweepIndex: index,
              mssIndex,
              liquidity: priorHigh,
              structure,
              orderBlock,
              fvg,
              settings,
            });
            if (trade) trades.push(trade);
            break;
          }
        }
      }
    }
  }

  return trades;
};

const selectExecutableTrades = (trades, windowStart, windowEnd, maxConcurrent = 1) => {
  const selected = [];
  let activeExitIndexes = [];
  const seenEntries = new Set();

  for (const trade of [...trades].sort((left, right) => left.entryIndex - right.entryIndex)) {
    const entryTime = trade.entryTime;
    if (entryTime < windowStart || entryTime > windowEnd) continue;
    const entryKey = `${trade.side}:${trade.entryIndex}:${trade.entryPrice.toFixed(8)}`;
    activeExitIndexes = activeExitIndexes.filter((exitIndex) => exitIndex >= trade.entryIndex);
    if (activeExitIndexes.length >= maxConcurrent || seenEntries.has(entryKey)) continue;
    selected.push(trade);
    seenEntries.add(entryKey);
    activeExitIndexes.push(trade.exitIndex);
  }

  return selected;
};

const summarize = (trades) => {
  const targets = trades.filter((trade) => trade.outcome === 'target').length;
  const stops = trades.filter((trade) => trade.outcome === 'stop').length;
  const breakeven = trades.filter((trade) => trade.outcome === 'breakeven').length;
  const expired = trades.filter((trade) => trade.outcome === 'expired').length;
  const totalR = trades.reduce((sum, trade) => sum + trade.realizedR, 0);
  let maxLosingStreak = 0;
  let streak = 0;
  for (const trade of trades) {
    if (trade.realizedR < 0) {
      streak += 1;
      maxLosingStreak = Math.max(maxLosingStreak, streak);
    } else {
      streak = 0;
    }
  }
  return {
    trades: trades.length,
    targets,
    stops,
    breakeven,
    expired,
    winRate: trades.length ? Number((targets / trades.length).toFixed(4)) : 0,
    totalR: Number(totalR.toFixed(2)),
    avgR: trades.length ? Number((totalR / trades.length).toFixed(2)) : 0,
    maxLosingStreak,
  };
};

const xml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const createTradeChart = ({ candles, trade, timeframe, label, strategyName }) => {
  const width = 1280;
  const height = 760;
  const margin = { left: 82, right: 38, top: 58, bottom: 104 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const firstIndex = Math.max(0, trade.sweepIndex - 24);
  const lastIndex = Math.min(candles.length - 1, trade.exitIndex + 24);
  const scoped = candles.slice(firstIndex, lastIndex + 1);
  const xStep = chartWidth / Math.max(1, scoped.length - 1);
  const bodyWidth = Math.max(4, Math.min(12, xStep * 0.58));
  const importantPrices = [
    trade.entryPrice,
    trade.stopLoss,
    trade.oneR,
    trade.target,
    trade.liquidity.price,
    trade.structure.price,
    trade.zoneHigh,
    trade.zoneLow,
    ...(trade.fvg ? [trade.fvg.low, trade.fvg.high] : []),
  ];
  const rawMin = Math.min(...scoped.map((item) => item.low), ...importantPrices);
  const rawMax = Math.max(...scoped.map((item) => item.high), ...importantPrices);
  const padding = Math.max((rawMax - rawMin) * 0.12, rawMax * 0.001);
  const minPrice = rawMin - padding;
  const maxPrice = rawMax + padding;
  const y = (price) =>
    margin.top + ((maxPrice - price) / Math.max(0.000001, maxPrice - minPrice)) * chartHeight;
  const x = (index) => margin.left + (index - firstIndex) * xStep;
  const elements = [];

  elements.push(
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#f7f4ee"/>`,
    `<rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" fill="#fffdfa" stroke="#d8d1c5"/>`
  );

  for (let tick = 0; tick <= 5; tick += 1) {
    const price = minPrice + ((maxPrice - minPrice) * tick) / 5;
    const yy = y(price);
    elements.push(
      `<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" stroke="#ece4d8" stroke-width="1"/>`,
      `<text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" font-size="12" fill="#635c52">${formatPrice(price)}</text>`
    );
  }

  const obX1 = x(trade.orderBlock.index) - bodyWidth;
  const obX2 = x(trade.entryIndex) + bodyWidth;
  elements.push(
    `<rect x="${obX1}" y="${y(trade.zoneHigh)}" width="${obX2 - obX1}" height="${Math.max(2, y(trade.zoneLow) - y(trade.zoneHigh))}" fill="${trade.side === 'long' ? '#d7f0df' : '#f5d8d3'}" opacity="0.62" stroke="${trade.side === 'long' ? '#2f9d58' : '#b84b3c'}" stroke-dasharray="6 5"/>`
  );

  if (trade.fvg) {
    elements.push(
      `<rect x="${x(trade.fvg.index) - bodyWidth * 2}" y="${y(trade.fvg.high)}" width="${bodyWidth * 8}" height="${Math.max(2, y(trade.fvg.low) - y(trade.fvg.high))}" fill="#b9d7ff" opacity="0.35" stroke="#4579bd" stroke-dasharray="3 4"/>`
    );
  }

  for (let offset = 0; offset < scoped.length; offset += 1) {
    const candle = scoped[offset];
    const absoluteIndex = firstIndex + offset;
    const xx = x(absoluteIndex);
    const up = candle.close >= candle.open;
    const color = up ? '#1d8c57' : '#c44536';
    elements.push(
      `<line x1="${xx}" y1="${y(candle.high)}" x2="${xx}" y2="${y(candle.low)}" stroke="${color}" stroke-width="1.4"/>`
    );
    const top = y(Math.max(candle.open, candle.close));
    const bottom = y(Math.min(candle.open, candle.close));
    elements.push(
      `<rect x="${xx - bodyWidth / 2}" y="${top}" width="${bodyWidth}" height="${Math.max(1.5, bottom - top)}" fill="${color}" rx="1"/>`
    );
  }

  const line = (price, color, text, dash = '') => {
    const yy = y(price);
    elements.push(
      `<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" stroke="${color}" stroke-width="1.7" ${dash ? `stroke-dasharray="${dash}"` : ''}/>` +
        `<text x="${width - margin.right - 6}" y="${yy - 6}" text-anchor="end" font-size="13" fill="${color}" font-weight="700">${xml(text)} ${formatPrice(price)}</text>`
    );
  };

  line(trade.liquidity.price, '#8e6a17', 'Swept liquidity', '7 6');
  line(trade.structure.price, '#6b5db5', 'MSS break', '4 5');
  line(trade.entryPrice, '#1f6f8b', 'Entry');
  line(trade.stopLoss, '#9b1c1c', 'SL');
  line(trade.oneR, '#5e7a1f', '1R SL move');
  line(trade.target, '#147a3d', `${trade.rewardR ?? '?'}R target`);

  const marker = (index, price, color, text, above = true) => {
    const xx = x(index);
    const yy = y(price);
    elements.push(
      `<circle cx="${xx}" cy="${yy}" r="5" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`,
      `<text x="${xx}" y="${yy + (above ? -12 : 22)}" text-anchor="middle" font-size="12" fill="${color}" font-weight="700">${xml(text)}</text>`
    );
  };

  marker(
    trade.sweepIndex,
    trade.side === 'long' ? candles[trade.sweepIndex].low : candles[trade.sweepIndex].high,
    '#8e6a17',
    'Sweep',
    trade.side !== 'long'
  );
  marker(
    trade.mssIndex,
    trade.side === 'long' ? candles[trade.mssIndex].high : candles[trade.mssIndex].low,
    '#6b5db5',
    'MSS',
    trade.side === 'long'
  );
  marker(trade.entryIndex, trade.entryPrice, '#1f6f8b', 'Entry', true);
  marker(
    trade.exitIndex,
    trade.exitPrice,
    trade.realizedR > 0 ? '#147a3d' : '#9b1c1c',
    trade.outcome.toUpperCase(),
    trade.realizedR <= 0
  );

  const title = `${SYMBOL} ${timeframe} ${strategyName}: ${label} ${trade.side.toUpperCase()} ${trade.outcome.toUpperCase()} (${trade.realizedR}R)`;
  const subtitle = `Entry ${formatTime(candles[trade.entryIndex].openTime)} | exit ${formatTime(candles[trade.exitIndex].openTime)} | OB + FVG shown when present`;
  elements.push(
    `<text x="${margin.left}" y="30" font-size="21" font-weight="800" fill="#1e1b18">${xml(title)}</text>`,
    `<text x="${margin.left}" y="50" font-size="13" fill="#5f5950">${xml(subtitle)}</text>`,
    `<text x="${margin.left}" y="${height - 68}" font-size="12" fill="#5f5950">Rule: liquidity sweep -> displacement MSS/CHoCH -> OB/FVG retest. Same-candle SL/TP is stop-first.</text>`,
    `<text x="${margin.left}" y="${height - 46}" font-size="12" fill="#5f5950">Data source: Binance USD-M futures klines. Times are UTC.</text>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements.join('')}</svg>`;
};

const serializeTrade = (trade, candles) => ({
  side: trade.side,
  outcome: trade.outcome,
  realizedR: trade.realizedR,
  sweepTime: new Date(candles[trade.sweepIndex].openTime).toISOString(),
  mssTime: new Date(candles[trade.mssIndex].openTime).toISOString(),
  entryTime: new Date(candles[trade.entryIndex].openTime).toISOString(),
  exitTime: new Date(candles[trade.exitIndex].openTime).toISOString(),
  entryPrice: Number(trade.entryPrice.toFixed(8)),
  stopLoss: Number(trade.stopLoss.toFixed(8)),
  oneRStopMove: Number(trade.oneR.toFixed(8)),
  rewardR: trade.rewardR,
  targetR: Number(trade.target.toFixed(8)),
  exitPrice: Number(trade.exitPrice.toFixed(8)),
});

const rangeHours = (start, end) => {
  const hours = [];
  for (let hour = start; hour <= end; hour += 1) hours.push(hour);
  return hours;
};

const equityStats = (trades) => {
  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let activeExitIndexes = [];
  let maxOpenTrades = 0;

  for (const trade of [...trades].sort((left, right) => left.entryTime - right.entryTime)) {
    activeExitIndexes = activeExitIndexes.filter((exitIndex) => exitIndex >= trade.entryIndex);
    activeExitIndexes.push(trade.exitIndex);
    maxOpenTrades = Math.max(maxOpenTrades, activeExitIndexes.length);
    equity += trade.realizedR;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
    if (trade.realizedR > 0) grossWin += trade.realizedR;
    if (trade.realizedR < 0) grossLoss += Math.abs(trade.realizedR);
  }

  return {
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    profitFactor: grossLoss ? Number((grossWin / grossLoss).toFixed(2)) : grossWin ? 99 : 0,
    maxOpenTrades,
  };
};

const compactSettings = (settings) => ({
  rewardR: settings.rewardR,
  liquidityLookback: settings.liquidityLookback,
  structureLookback: settings.structureLookback,
  maxMssBars: settings.maxMssBars,
  maxRetestBars: settings.maxRetestBars,
  maxHoldBars: settings.maxHoldBars,
  minRiskPct: settings.minRiskPct,
  minSweepDepthRange: settings.minSweepDepthRange,
  minSweepWickRatio: settings.minSweepWickRatio,
  minDisplacementBodyMultiple: settings.minDisplacementBodyMultiple,
  minDisplacementBodyRatio: settings.minDisplacementBodyRatio,
  fvgToleranceRange: settings.fvgToleranceRange,
  requireFvgConfluence: settings.requireFvgConfluence,
  useHtfBias: settings.useHtfBias,
  entryMode: settings.entryMode,
  stopBufferRange: settings.stopBufferRange,
  breakEvenAtR: settings.breakEvenAtR,
  breakEvenOffsetR: settings.breakEvenOffsetR,
  maxConcurrent: settings.maxConcurrent,
  sideMode: settings.sideMode,
  sideHourMode: settings.sideHourMode,
  sessionName: settings.sessionName,
});

const buildBaseCandidates = () => {
  const structureSets = [{ liquidityLookback: 40, structureLookback: 25 }];
  const timingSets = [
    { maxMssBars: 36, maxRetestBars: 96, maxHoldBars: 192 },
    { maxMssBars: 48, maxRetestBars: 120, maxHoldBars: 288 },
  ];
  const filterSets = [
    {
      minSweepDepthRange: 0.08,
      minSweepWickRatio: 0.28,
      minDisplacementBodyMultiple: 0.8,
      minDisplacementBodyRatio: 0.46,
      fvgToleranceRange: 1,
      requireFvgConfluence: false,
    },
    {
      minSweepDepthRange: 0.12,
      minSweepWickRatio: 0.34,
      minDisplacementBodyMultiple: 0.9,
      minDisplacementBodyRatio: 0.5,
      fvgToleranceRange: 0.75,
      requireFvgConfluence: false,
    },
  ];
  const managementSets = [
    { entryMode: 'ob-mid', stopBufferRange: 0, breakEvenAtR: null, breakEvenOffsetR: 0 },
  ];

  const candidates = [];
  for (const structure of structureSets) {
    for (const timing of timingSets) {
      for (const filters of filterSets) {
        for (const management of managementSets) {
          candidates.push({
            ...V2,
            ...structure,
            ...timing,
            ...filters,
            ...management,
            name: 'SMC optimized candidate',
            rewardR: 3,
            minRiskPct: 0.0005,
            useHtfBias: true,
            maxConcurrent: 1,
            sideMode: 'both',
            sideHourMode: 'none',
            allowedHoursUtc: null,
            sessionName: 'all',
          });
        }
      }
    }
  }
  return candidates;
};

const expandCandidate = (settings) => {
  const sessions = [
    { sessionName: 'all', allowedHoursUtc: null },
    {
      sessionName: 'positive-hours-v1',
      allowedHoursUtc: [1, 2, 4, 5, 6, 7, 9, 12, 13, 16, 19, 21, 23],
    },
    { sessionName: 'strong-hours-v1', allowedHoursUtc: [1, 2, 7, 9, 16, 19, 21, 23] },
  ];
  const riskSettings = [0.0005];
  const htfOptions = [true, false];
  const rewards = [6, 8, 10, 12, 15];
  const concurrentOptions = [1, 3, 99];
  const sideModes = ['both', 'long', 'short'];
  const sideHourModes = ['none', 'minedPositive', 'minedStrong', 'shortPositive'];
  const expanded = [];

  for (const session of sessions) {
    for (const minRiskPct of riskSettings) {
      for (const useHtfBias of htfOptions) {
        for (const rewardR of rewards) {
          for (const maxConcurrent of concurrentOptions) {
            for (const sideMode of sideModes) {
              for (const sideHourMode of sideHourModes) {
                expanded.push({
                  ...settings,
                  ...session,
                  minRiskPct,
                  useHtfBias,
                  rewardR,
                  maxConcurrent,
                  sideMode,
                  sideHourMode,
                });
              }
            }
          }
        }
      }
    }
  }
  return expanded;
};

const scoreCandidate = ({ full, validation, stats }) => {
  const enoughTradesPenalty = full.trades < 10 ? (10 - full.trades) * 1.75 : 0;
  const validationPenalty = validation.trades < 3 ? (3 - validation.trades) * 3.5 : 0;
  const negativeValidationPenalty = validation.totalR < 0 ? Math.abs(validation.totalR) * 2.5 : 0;
  return Number(
    (
      full.totalR * 1.35 +
      validation.totalR * 1.9 +
      full.avgR * 2 +
      Math.min(full.trades, 35) * 0.12 -
      stats.maxDrawdownR * 0.35 -
      Math.max(0, (stats.maxOpenTrades ?? 1) - 1) * 1.25 -
      full.maxLosingStreak * 0.35 -
      enoughTradesPenalty -
      validationPenalty -
      negativeValidationPenalty
    ).toFixed(4)
  );
};

const SIDE_HOUR_SETS = {
  minedPositive: new Set([
    'short:1',
    'short:2',
    'long:4',
    'long:5',
    'short:6',
    'long:7',
    'short:9',
    'long:9',
    'short:12',
    'long:13',
    'long:16',
    'long:19',
    'long:21',
    'short:23',
  ]),
  minedStrong: new Set([
    'short:1',
    'short:2',
    'short:6',
    'long:7',
    'short:9',
    'short:12',
    'long:21',
    'short:23',
  ]),
  shortPositive: new Set(['short:1', 'short:2', 'short:6', 'short:9', 'short:12', 'short:23']),
};

const evaluateSettings = ({
  candles,
  htfBias,
  windowStart,
  windowEnd,
  validationStart,
  settings,
}) => {
  const rawSetups = findTrades({ candles, htfBias, settings })
    .map((trade) => ({
      ...trade,
      entryTime: candles[trade.entryIndex].openTime,
      exitTime: candles[trade.exitIndex].openTime,
    }))
    .filter((trade) => {
      if (settings.sideMode && settings.sideMode !== 'both' && trade.side !== settings.sideMode)
        return false;
      const sideHourSet = SIDE_HOUR_SETS[settings.sideHourMode];
      if (sideHourSet) {
        const key = `${trade.side}:${new Date(trade.entryTime).getUTCHours()}`;
        if (!sideHourSet.has(key)) return false;
      }
      return true;
    });
  const trades = selectExecutableTrades(
    rawSetups,
    windowStart,
    windowEnd,
    settings.maxConcurrent ?? 1
  );
  const trainTrades = trades.filter((trade) => trade.entryTime < validationStart);
  const validationTrades = trades.filter((trade) => trade.entryTime >= validationStart);
  const full = summarize(trades);
  const train = summarize(trainTrades);
  const validation = summarize(validationTrades);
  const stats = equityStats(trades);
  return {
    settings,
    rawSetups: rawSetups.filter(
      (trade) => trade.entryTime >= windowStart && trade.entryTime <= windowEnd
    ).length,
    score: scoreCandidate({ full, validation, stats }),
    full,
    train,
    validation,
    stats,
    trades,
  };
};

const publicCandidate = (candidate, candles) => ({
  score: candidate.score,
  rawSetups: candidate.rawSetups,
  settings: compactSettings(candidate.settings),
  full: candidate.full,
  train: candidate.train,
  validation: candidate.validation,
  stats: candidate.stats,
  trades: candidate.trades.map((trade) => serializeTrade(trade, candles)),
});

const writeCandidateCharts = ({ candles, candidate, timeframe, outputDir }) => {
  const charts = {};
  if (!candidate.trades.length) return charts;
  const best = [...candidate.trades].sort((left, right) => right.realizedR - left.realizedR)[0];
  const worst = [...candidate.trades].sort((left, right) => left.realizedR - right.realizedR)[0];
  const chartSpecs = [
    { key: 'best', trade: best, label: 'BEST' },
    { key: 'worst', trade: worst, label: 'WORST' },
  ];

  for (const spec of chartSpecs) {
    const svgPath = path.join(
      outputDir,
      `${SYMBOL.toLowerCase()}_${timeframe}_smc_one_position_${spec.key}.svg`
    );
    fs.writeFileSync(
      svgPath,
      createTradeChart({
        candles,
        trade: spec.trade,
        timeframe,
        label: spec.label,
        strategyName: candidate.settings.name,
      })
    );
    charts[spec.key] = svgPath;
  }
  return charts;
};

const compareMetric = (actual, expected) => {
  const tolerance = Number.isInteger(expected) ? 0 : 0.01;
  return Math.abs(actual - expected) <= tolerance;
};

const buildComparison = (actual) => {
  const metrics = {};
  for (const [key, expected] of Object.entries(EXPECTED_RESULT)) {
    metrics[key] = {
      expected,
      actual: actual[key],
      matches: compareMetric(actual[key], expected),
    };
  }
  return {
    expectedFrom:
      'artifacts/smc-dry-run-solusdt/smc-3m-sidehour-mined/summary.json#results[0].realistic',
    metrics,
    matches: Object.values(metrics).every((metric) => metric.matches),
  };
};

export const buildSolSmcOnePositionStrategySpec = () => ({
  name: STRATEGY.name,
  strategyId: SOL_SMC_ONE_POSITION_STRATEGY_ID,
  strategy: SOL_SMC_ONE_POSITION_BACKTEST_STRATEGY,
  symbol: SYMBOL,
  timeframe: TIMEFRAMES[0].timeframe,
  higherTimeframeBias: '1h resampled structure/midpoint bias',
  onePositionOnly: true,
  sideHourMode: STRATEGY.sideHourMode,
  allowedSideHoursUtc: [...SIDE_HOUR_SETS[STRATEGY.sideHourMode]].sort(),
  executionRules: [
    'Sweep recent swing liquidity.',
    'Require displacement close through recent opposite structure.',
    'Enter on order-block midpoint retest.',
    'Use sweep/order-block extreme as stop.',
    'Take profit at 8R or expire after 192 bars.',
    'If SL and target are inside the same candle, count stop first.',
    'Skip new entries while an existing SOLUSDT position is open.',
  ],
  settings: compactSettings(STRATEGY),
});

export const runSolSmcOnePositionBacktest = async (options = {}) => {
  const outputDir = path.resolve(String(options.outputDir || DEFAULT_OUT_DIR));
  const windowEndOption = resolveWindowEndOption(options.windowEndIso ?? ENV_WINDOW_END_ISO);
  const { requestedWindowEnd, fixedWindowEnd, windowEndMode } = windowEndOption;
  const writeArtifacts = options.writeArtifacts !== false;
  const writeCharts = writeArtifacts && options.writeCharts !== false;

  if (writeArtifacts) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const strategySpec = buildSolSmcOnePositionStrategySpec();
  const report = {
    symbol: SYMBOL,
    windowDays: WINDOW_DAYS,
    validationDays: VALIDATION_DAYS,
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    windowEndMode,
    requestedWindowEnd,
    strategy: strategySpec,
    results: [],
  };

  if (writeArtifacts) {
    fs.writeFileSync(path.join(outputDir, 'strategy.json'), JSON.stringify(strategySpec, null, 2));
  }

  for (const tf of TIMEFRAMES) {
    const { candles, windowStart, windowEnd } = await fetchCandles({ ...tf, fixedWindowEnd });
    const htfBias = buildHtfBias(candles, tf.htfMs);
    const validationStart = windowEnd - VALIDATION_DAYS * DAY_MS;
    const result = evaluateSettings({
      candles,
      htfBias,
      windowStart,
      windowEnd,
      validationStart,
      settings: STRATEGY,
    });
    const charts = writeCharts
      ? writeCandidateCharts({ candles, candidate: result, timeframe: tf.timeframe, outputDir })
      : {};
    const actual = {
      trades: result.full.trades,
      winRate: result.full.winRate,
      totalR: result.full.totalR,
      validationR: result.validation.totalR,
      maxDrawdownR: result.stats.maxDrawdownR,
      maxOpenTrades: result.stats.maxOpenTrades,
    };
    const comparison = buildComparison(actual);

    report.results.push({
      timeframe: tf.timeframe,
      dataStart: new Date(candles[0].openTime).toISOString(),
      dataEnd: new Date(candles.at(-1).openTime).toISOString(),
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(windowEnd).toISOString(),
      validationStart: new Date(validationStart).toISOString(),
      candles: candles.filter(
        (candle) => candle.openTime >= windowStart && candle.openTime <= windowEnd
      ).length,
      strategyResult: {
        ...publicCandidate(result, candles),
        charts,
      },
      comparison,
    });

    if (options.log) {
      console.log(
        `${tf.timeframe}: trades=${actual.trades}, winRate=${(actual.winRate * 100).toFixed(1)}%, ` +
          `totalR=${actual.totalR}, validationR=${actual.validationR}, maxDD=${actual.maxDrawdownR}, ` +
          `maxOpen=${actual.maxOpenTrades}, matchesExpected=${comparison.matches}`
      );
    }
  }

  const summaryPath = path.join(outputDir, 'summary.json');
  if (writeArtifacts) {
    fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
  }

  return {
    report,
    summaryPath: writeArtifacts ? summaryPath : null,
    strategyPath: writeArtifacts ? path.join(outputDir, 'strategy.json') : null,
  };
};

const toStrategyResponse = (execution, query) => {
  const firstResult = execution.report.results[0];
  return {
    strategyId: query.strategyId,
    strategy: SOL_SMC_ONE_POSITION_BACKTEST_STRATEGY,
    symbol: execution.report.symbol,
    interval: firstResult.timeframe,
    limit: query.limit,
    windowStart: firstResult.windowStart,
    windowEnd: firstResult.windowEnd,
    validationStart: firstResult.validationStart,
    candles: firstResult.candles,
    settings: execution.report.strategy.settings,
    full: firstResult.strategyResult.full,
    train: firstResult.strategyResult.train,
    validation: firstResult.strategyResult.validation,
    stats: firstResult.strategyResult.stats,
    comparison: firstResult.comparison,
    trades: firstResult.strategyResult.trades,
    charts: firstResult.strategyResult.charts,
    artifacts: {
      summaryPath: execution.summaryPath,
      strategyPath: execution.strategyPath,
    },
  };
};

const parseBooleanParam = (value, defaultValue) => {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  return String(value).trim().toLowerCase() !== 'false';
};

@Service()
export class SolSmcOnePositionStrategy implements StrategyHandler {
  readonly catalog: StrategyCatalogItem = {
    strategyId: SOL_SMC_ONE_POSITION_STRATEGY_ID,
    name: 'SOLUSDT 3m SMC one-position',
    description:
      'Runs the SOLUSDT 3m SMC side-hour model with one-position-only execution and a dynamic latest-candle backtest window unless a fixed windowEnd is supplied.',
    paramsSchema: [
      {
        key: 'windowEnd',
        type: 'string',
        required: false,
        description:
          'ISO end timestamp for the 30-day backtest window, or "latest" for the newest available candle.',
        defaultValue: 'latest',
      },
      {
        key: 'writeArtifacts',
        type: 'boolean',
        required: false,
        description: 'Write summary and chart artifacts to disk.',
        defaultValue: true,
      },
    ],
  };

  async execute(query: StrategyRunQuery): Promise<SolSmcOnePositionStrategyResult> {
    const symbols = query.symbols.map((symbol) => symbol.toUpperCase());
    if (symbols.length !== 1 || symbols[0] !== SYMBOL) {
      throw new BadRequestAppError(`${SOL_SMC_ONE_POSITION_STRATEGY_ID} only supports ${SYMBOL}`);
    }

    if (query.interval !== '3m') {
      throw new BadRequestAppError(
        `${SOL_SMC_ONE_POSITION_STRATEGY_ID} only supports the 3m interval`
      );
    }

    const rawWindowEnd = query.params.windowEnd ?? query.params.windowEndIso;
    const windowEndIso =
      typeof rawWindowEnd === 'string' && rawWindowEnd.trim()
        ? rawWindowEnd.trim()
        : undefined;
    const writeArtifacts = parseBooleanParam(query.params.writeArtifacts, true);
    const outputDir =
      typeof query.params.outputDir === 'string' && query.params.outputDir.trim()
        ? query.params.outputDir.trim()
        : DEFAULT_OUT_DIR;

    const execution = await runSolSmcOnePositionBacktest({
      windowEndIso,
      outputDir,
      writeArtifacts,
      writeCharts: writeArtifacts,
    });

    return toStrategyResponse(execution, query);
  }
}
