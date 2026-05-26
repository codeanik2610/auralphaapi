import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { Service } from 'typedi';
import { ServiceUnavailableAppError } from '../errors/AppError';
import { Logger } from '../../lib/logger';
import { env } from '../../env';

const log = new Logger('AutomationSignalEvaluatorService');

export interface EvaluatedAutomationSignalEvent {
  side: 'long' | 'short';
  signalTime: string;
  candleState?: 'closed' | 'open' | null;
  entryPrice: number | null;
  tradePlan: Record<string, unknown> | null;
}

export interface EvaluatedAutomationSignalItem {
  symbol: string;
  timeframe: string;
  status: 'ok' | 'no_data' | 'stale' | 'failed';
  reason?: string | null;
  signalTime?: string | null;
  latestClosedSignalTime?: string | null;
  entryPrice?: number | null;
  longEntry?: boolean;
  longEntryPrevious?: boolean;
  longExit?: boolean;
  shortEntry?: boolean;
  shortEntryPrevious?: boolean;
  shortExit?: boolean;
  includeOpenCandleSignals?: boolean;
  openSignalTime?: string | null;
  signalEvaluationMode?: string | null;
  signals?: EvaluatedAutomationSignalEvent[];
}

export interface EvaluateAutomationSignalsPayload {
  templateId?: string | null;
  templateName?: string | null;
  templateConfig: Record<string, unknown>;
  symbols: string[];
  timeframe: string;
  evaluatedAt?: Date;
  maxBars?: number;
  warmupBars?: number;
  candlesTable?: string | null;
  candlesSchema?: string | null;
  candlesMaxRows?: number | null;
  cursorBySymbol?: Record<string, string | Date | null> | null;
  signalSelectionMode?: 'latest_closed_only' | 'cursor_gap' | string | null;
  includeOpenCandleSignals?: boolean | null;
}

export interface EvaluateAutomationSignalsResult {
  items: EvaluatedAutomationSignalItem[];
  evaluatedSymbols: number;
  skippedSymbols: number;
}

@Service()
export class AutomationSignalEvaluatorService {
  async evaluateLatestSignals(
    payload: EvaluateAutomationSignalsPayload
  ): Promise<EvaluateAutomationSignalsResult> {
    if (!env.pg.enabled) {
      throw new ServiceUnavailableAppError(
        'Postgres market data is not enabled. Enable env.pg.enabled to evaluate automation signals.'
      );
    }

    const symbols = Array.from(
      new Set(
        (Array.isArray(payload.symbols) ? payload.symbols : [])
          .map((value) =>
            String(value || '')
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      )
    );

    if (!symbols.length) {
      return {
        items: [],
        evaluatedSymbols: 0,
        skippedSymbols: 0,
      };
    }

    const scriptPath = path.resolve(
      process.cwd(),
      'scripts',
      '_runtime',
      'automation_signal_eval.py'
    );
    if (!existsSync(scriptPath)) {
      throw new ServiceUnavailableAppError(
        `Automation signal evaluator script was not found at ${scriptPath}`
      );
    }

    const pythonBin = env.automationSignals.pythonBin;
    if (path.isAbsolute(pythonBin) && !existsSync(pythonBin)) {
      throw new ServiceUnavailableAppError(
        `Automation signal evaluator python binary was not found at ${pythonBin}`
      );
    }

    const rawOutput = await this.runPythonEvaluation(pythonBin, scriptPath, {
      discoveryEngineRoot: env.automationSignals.discoveryEngineRoot,
      dbUrl: this.buildPostgresUrl(),
      template: {
        id: payload.templateId || 'automation-template',
        name: payload.templateName || payload.templateId || 'Automation Template',
        config: payload.templateConfig,
      },
      symbols,
      timeframe: String(payload.timeframe || '').trim(),
      evaluatedAt: (payload.evaluatedAt || new Date()).toISOString(),
      limit:
        typeof payload.maxBars === 'number' && Number.isFinite(payload.maxBars)
          ? Math.max(50, Math.round(payload.maxBars))
          : env.automationSignals.evalBars,
      candlesTable: payload.candlesTable || 'market_candles_1m',
      candlesSchema: payload.candlesSchema || 'public',
      candlesMaxRows:
        typeof payload.candlesMaxRows === 'number' && Number.isFinite(payload.candlesMaxRows)
          ? Math.max(1000, Math.round(payload.candlesMaxRows))
          : 200000,
      warmupBars:
        typeof payload.warmupBars === 'number' && Number.isFinite(payload.warmupBars)
          ? Math.max(10, Math.round(payload.warmupBars))
          : undefined,
      cursorBySymbol: payload.cursorBySymbol || undefined,
      signalSelectionMode: this.normalizeSignalSelectionMode(payload.signalSelectionMode),
      includeOpenCandleSignals: payload.includeOpenCandleSignals === true,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawOutput) as Record<string, unknown>;
    } catch (error) {
      log.error(`Unable to parse automation signal evaluator output: ${rawOutput}`);
      throw new ServiceUnavailableAppError(
        `Automation signal evaluation returned invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items = rawItems
      .map((item) => this.mapEvaluatedSignalItem(item))
      .filter((item): item is EvaluatedAutomationSignalItem => Boolean(item));

    const evaluatedSymbols = Number(parsed.evaluatedSymbols);
    const skippedSymbols = Number(parsed.skippedSymbols);

    return {
      items,
      evaluatedSymbols: Number.isFinite(evaluatedSymbols)
        ? Math.max(0, Math.trunc(evaluatedSymbols))
        : items.filter((item) => item.status === 'ok').length,
      skippedSymbols: Number.isFinite(skippedSymbols)
        ? Math.max(0, Math.trunc(skippedSymbols))
        : items.filter((item) => item.status !== 'ok').length,
    };
  }

  private mapEvaluatedSignalItem(value: unknown): EvaluatedAutomationSignalItem | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const item = value as Record<string, unknown>;
    const symbol = String(item.symbol || '')
      .trim()
      .toUpperCase();
    const timeframe = String(item.timeframe || '').trim();
    const status = String(item.status || '')
      .trim()
      .toLowerCase();

    if (!symbol || !timeframe) {
      return null;
    }

    const normalizedStatus =
      status === 'ok' || status === 'no_data' || status === 'stale' || status === 'failed'
        ? status
        : 'failed';

    return {
      symbol,
      timeframe,
      status: normalizedStatus,
      reason: typeof item.reason === 'string' ? item.reason : null,
      signalTime: typeof item.signalTime === 'string' ? item.signalTime : null,
      latestClosedSignalTime:
        typeof item.latestClosedSignalTime === 'string' ? item.latestClosedSignalTime : null,
      entryPrice: this.readNumber(item.entryPrice),
      longEntry: Boolean(item.longEntry),
      longEntryPrevious: Boolean(item.longEntryPrevious),
      longExit: Boolean(item.longExit),
      shortEntry: Boolean(item.shortEntry),
      shortEntryPrevious: Boolean(item.shortEntryPrevious),
      shortExit: Boolean(item.shortExit),
      ...(item.includeOpenCandleSignals === true ? { includeOpenCandleSignals: true } : {}),
      ...(typeof item.openSignalTime === 'string' ? { openSignalTime: item.openSignalTime } : {}),
      ...(typeof item.signalEvaluationMode === 'string'
        ? { signalEvaluationMode: item.signalEvaluationMode }
        : {}),
      signals: this.mapSignalEvents(item.signals),
    };
  }

  private mapSignalEvents(value: unknown): EvaluatedAutomationSignalEvent[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const events: EvaluatedAutomationSignalEvent[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const record = item as Record<string, unknown>;
      const side = String(record.side || '')
        .trim()
        .toLowerCase();
      const signalTime = String(record.signalTime || '').trim();
      if ((side !== 'long' && side !== 'short') || !signalTime) {
        continue;
      }

      const rawCandleState = String(record.candleState || '')
        .trim()
        .toLowerCase();
      const candleState: EvaluatedAutomationSignalEvent['candleState'] =
        rawCandleState === 'open' ? 'open' : rawCandleState === 'closed' ? 'closed' : null;

      events.push({
        side: side as 'long' | 'short',
        signalTime,
        ...(candleState ? { candleState } : {}),
        entryPrice: this.readNumber(record.entryPrice),
        tradePlan: this.parseRecord(record.tradePlan),
      });
    }
    return events;
  }

  private parseRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private normalizeSignalSelectionMode(
    value: EvaluateAutomationSignalsPayload['signalSelectionMode']
  ): 'latest_closed_only' | 'cursor_gap' {
    return String(value || '')
      .trim()
      .toLowerCase() === 'cursor_gap'
      ? 'cursor_gap'
      : 'latest_closed_only';
  }

  private buildPostgresUrl(): string {
    const username = encodeURIComponent(env.pg.username || '');
    const password = encodeURIComponent(env.pg.password || '');
    const host = env.pg.host || '127.0.0.1';
    const auth = password ? `${username}:${password}` : username;
    const credentials = auth ? `${auth}@` : '';
    const sslSuffix = env.pg.ssl ? '?sslmode=require' : '';
    return `postgresql+asyncpg://${credentials}${host}:${env.pg.port}/${env.pg.database}${sslSuffix}`;
  }

  private runPythonEvaluation(
    pythonBin: string,
    scriptPath: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const symbolCount = Array.isArray(payload.symbols) ? payload.symbols.length : 0;
      const timeframe = String(payload.timeframe || '').trim() || 'unknown';
      const timeoutMs = this.resolveEvaluationTimeoutMs(symbolCount);
      const child = spawn(pythonBin, ['-B', scriptPath], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGKILL');
        const durationMs = Date.now() - startedAt;
        log.warn(
          `Automation signal evaluation timed out after ${durationMs}ms for ${symbolCount} symbol(s) on ${timeframe}`
        );
        reject(
          new ServiceUnavailableAppError(
            `Automation signal evaluation timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(
          new ServiceUnavailableAppError(
            `Automation signal evaluator failed to start: ${error.message}`
          )
        );
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);

        if (code !== 0) {
          const durationMs = Date.now() - startedAt;
          log.error(
            `Automation signal evaluation failed in ${durationMs}ms for ${symbolCount} symbol(s) on ${timeframe}: ${stderr.trim() || stdout.trim() || 'Unknown error'}`
          );
          reject(
            new ServiceUnavailableAppError(
              `Automation signal evaluation failed (${code}): ${stderr.trim() || stdout.trim() || 'Unknown error'}`
            )
          );
          return;
        }

        const durationMs = Date.now() - startedAt;
        log.info(
          `Automation signal evaluation completed in ${durationMs}ms for ${symbolCount} symbol(s) on ${timeframe}`
        );
        resolve(stdout.trim());
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }

  private resolveEvaluationTimeoutMs(symbolCount: number): number {
    const baseTimeoutMs = Math.max(1000, env.automationSignals.timeoutMs);
    const perSymbolMs = Math.max(0, env.automationSignals.timeoutPerSymbolMs);
    const maxTimeoutMs = Math.max(baseTimeoutMs, env.automationSignals.maxTimeoutMs);
    const normalizedSymbolCount = Number.isFinite(symbolCount)
      ? Math.max(0, Math.trunc(symbolCount))
      : 0;

    return Math.min(maxTimeoutMs, baseTimeoutMs + normalizedSymbolCount * perSymbolMs);
  }
}
