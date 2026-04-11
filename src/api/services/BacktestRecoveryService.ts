import { Service } from 'typedi';
import {
  BacktestResumeCheckpoint,
  BacktestRunStatus,
} from '../contracts/Backtest';
import { BadRequestAppError } from '../errors/AppError';
import { Backtest } from '../../database';

export interface BacktestRecoveryPlan {
  message: string;
  status: 'Queued';
  stability: 'Queued';
  nextConfig: Record<string, unknown>;
}

@Service()
export class BacktestRecoveryService {
  buildRecoveryPlan(
    backtest: Backtest,
    runStatus: BacktestRunStatus,
    now = new Date()
  ): BacktestRecoveryPlan {
    if (runStatus === 'Queued' || runStatus === 'Running') {
      throw new BadRequestAppError('This backtest is already queued or running');
    }

    const config = this.parseConfig(backtest.result?.config) ?? {};
    const checkpoint = this.parseBacktestResumeCheckpoint(config.resumeCheckpoint);
    if (!checkpoint) {
      throw new BadRequestAppError('No resume checkpoint is available for this backtest');
    }

    const checkpointState = this.readTrimmedString(checkpoint.state)?.toLowerCase();
    if (runStatus === 'Completed' || checkpointState === 'completed') {
      throw new BadRequestAppError('Completed backtests do not need checkpoint recovery');
    }

    const nowIso = now.toISOString();
    const currentProgress =
      config.progress && typeof config.progress === 'object' && !Array.isArray(config.progress)
        ? ({ ...(config.progress as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const checkpointResultsSummary =
      checkpoint.resultsSummary && typeof checkpoint.resultsSummary === 'object'
        ? checkpoint.resultsSummary
        : null;

    const processed =
      checkpoint.completedCombinations ??
      this.readNonNegativeInteger(currentProgress.processed) ??
      checkpointResultsSummary?.processed ??
      0;
    const total =
      checkpoint.totalCombinations ?? this.readNonNegativeInteger(currentProgress.total) ?? 0;
    const percent =
      total > 0 ? Number(((processed / Math.max(total, 1)) * 100).toFixed(1)) : 0;

    const nextProgress: Record<string, unknown> = {
      ...currentProgress,
      state: 'queued',
      processed,
      total,
      percent,
      etaSeconds: null,
      startedAt:
        this.readTrimmedString(currentProgress.startedAt) ?? checkpoint.startedAt ?? nowIso,
      updatedAt: nowIso,
      finishedAt: null,
      okCount:
        checkpointResultsSummary?.okCount ??
        this.readNonNegativeInteger(currentProgress.okCount) ??
        0,
      failedCount:
        checkpointResultsSummary?.failedCount ??
        this.readNonNegativeInteger(currentProgress.failedCount) ??
        0,
      noDataCount:
        checkpointResultsSummary?.noDataCount ??
        this.readNonNegativeInteger(currentProgress.noDataCount) ??
        0,
      skippedCount:
        checkpointResultsSummary?.skippedCount ??
        this.readNonNegativeInteger(currentProgress.skippedCount) ??
        0,
      tradeEventCount:
        checkpoint.tradeEventCount ??
        this.readNonNegativeInteger(currentProgress.tradeEventCount) ??
        0,
      resumeCount:
        checkpoint.resumeCount ??
        this.readNonNegativeInteger(currentProgress.resumeCount) ??
        0,
      resumedFromCheckpoint:
        checkpoint.resumedFromCheckpoint ??
        this.readBoolean(currentProgress.resumedFromCheckpoint) ??
        false,
      error: null,
    };

    const nextCheckpoint = {
      ...(config.resumeCheckpoint && typeof config.resumeCheckpoint === 'object'
        ? (config.resumeCheckpoint as Record<string, unknown>)
        : {}),
      state: 'queued',
      lastUpdatedAt: nowIso,
      finishedAt: null,
      error: null,
    };

    return {
      message: 'Backtest re-queued from checkpoint',
      status: 'Queued',
      stability: 'Queued',
      nextConfig: {
        ...config,
        error: null,
        progress: nextProgress,
        progressPercent: percent,
        progressProcessed: processed,
        progressTotal: total,
        resumeCheckpoint: nextCheckpoint,
      },
    };
  }

  private parseConfig(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  private parseBacktestResumeCheckpoint(value: unknown): BacktestResumeCheckpoint | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const state = this.readTrimmedString(raw.state);
    const startedAt = this.readTrimmedString(raw.startedAt);
    const lastUpdatedAt = this.readTrimmedString(raw.lastUpdatedAt);
    const finishedAt = this.readTrimmedString(raw.finishedAt);
    const error = this.readTrimmedString(raw.error);
    const resumeCount = this.readNonNegativeInteger(raw.resumeCount);
    const resumedFromCheckpoint =
      typeof raw.resumedFromCheckpoint === 'boolean' ? raw.resumedFromCheckpoint : null;
    const completedCombinations = this.readNonNegativeInteger(raw.completedCombinations);
    const totalCombinations = this.readNonNegativeInteger(raw.totalCombinations);
    const tradeEventCount = this.readNonNegativeInteger(raw.tradeEventCount);
    const resultsSummary = this.parseBacktestResumeCheckpointSummary(raw);

    if (
      !state &&
      !startedAt &&
      !lastUpdatedAt &&
      !finishedAt &&
      !error &&
      resumeCount === null &&
      resumedFromCheckpoint === null &&
      completedCombinations === null &&
      totalCombinations === null &&
      tradeEventCount === null &&
      !resultsSummary
    ) {
      return null;
    }

    return {
      state,
      startedAt,
      lastUpdatedAt,
      finishedAt,
      error,
      resumeCount,
      resumedFromCheckpoint,
      completedCombinations,
      totalCombinations,
      tradeEventCount,
      resultsSummary,
    };
  }

  private parseBacktestResumeCheckpointSummary(
    value: Record<string, unknown>
  ): BacktestResumeCheckpoint['resultsSummary'] {
    const explicitSummary =
      value.resultsSummary && typeof value.resultsSummary === 'object' && !Array.isArray(value.resultsSummary)
        ? (value.resultsSummary as Record<string, unknown>)
        : null;

    const fallbackResults = Array.isArray(value.results)
      ? value.results.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        )
      : [];

    const summary = {
      processed:
        this.readNonNegativeInteger(explicitSummary?.processed) ??
        (fallbackResults.length ? fallbackResults.length : null),
      okCount:
        this.readNonNegativeInteger(explicitSummary?.okCount) ??
        (fallbackResults.length
          ? fallbackResults.filter(
              (item) => this.readTrimmedString(item.status)?.toLowerCase() === 'ok'
            ).length
          : null),
      failedCount:
        this.readNonNegativeInteger(explicitSummary?.failedCount) ??
        (fallbackResults.length
          ? fallbackResults.filter(
              (item) => this.readTrimmedString(item.status)?.toLowerCase() === 'failed'
            ).length
          : null),
      noDataCount:
        this.readNonNegativeInteger(explicitSummary?.noDataCount) ??
        (fallbackResults.length
          ? fallbackResults.filter(
              (item) => this.readTrimmedString(item.status)?.toLowerCase() === 'no_data'
            ).length
          : null),
      skippedCount:
        this.readNonNegativeInteger(explicitSummary?.skippedCount) ??
        (fallbackResults.length
          ? fallbackResults.filter((item) => {
              const status = this.readTrimmedString(item.status)?.toLowerCase();
              return status ? !['ok', 'failed', 'no_data'].includes(status) : false;
            }).length
          : null),
    };

    if (
      summary.processed === null &&
      summary.okCount === null &&
      summary.failedCount === null &&
      summary.noDataCount === null &&
      summary.skippedCount === null
    ) {
      return null;
    }

    return summary;
  }

  private readTrimmedString(value: unknown): string | null {
    const trimmed = String(value || '').trim();
    return trimmed || null;
  }

  private readNonNegativeInteger(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    return Math.max(0, Math.trunc(numeric));
  }

  private readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return null;
  }
}
