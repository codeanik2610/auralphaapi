import { Service } from 'typedi';
import {
  BacktestExecutionAssumptions,
  BacktestInputSnapshotExport,
  BacktestInputSnapshotResponse,
  BacktestItem,
} from '../contracts/Backtest';
import { Backtest } from '../../database';

@Service()
export class BacktestSnapshotService {
  buildInputSnapshotResponse(
    backtest: Backtest,
    mappedBacktest: BacktestItem,
    generatedAt = new Date().toISOString()
  ): BacktestInputSnapshotResponse {
    return {
      backtestId: backtest.id,
      fileName: this.buildBacktestInputSnapshotFileName(backtest),
      generatedAt,
      snapshot: this.buildInputSnapshotExport(backtest, mappedBacktest, generatedAt),
    };
  }

  buildInputSnapshotExport(
    backtest: Backtest,
    mappedBacktest: BacktestItem,
    exportedAt: string
  ): BacktestInputSnapshotExport {
    const config = this.parseConfig(backtest.result?.config) ?? {};
    const inputs = this.buildImmutableInputSnapshotInputs(
      config,
      mappedBacktest.executionAssumptions ?? null
    );

    return {
      schemaVersion: 1,
      exportedAt,
      backtest: {
        id: mappedBacktest.id,
        name: mappedBacktest.name,
        parameter: mappedBacktest.parameter,
        strategy: mappedBacktest.strategy,
        symbol: mappedBacktest.symbol,
        status: mappedBacktest.status,
        runStatus: mappedBacktest.runStatus,
        assessmentStatus: mappedBacktest.assessmentStatus,
        createdAt: mappedBacktest.createdAt || backtest.createdAt.toISOString(),
      },
      lineage: {
        ...(mappedBacktest.lineage ?? this.buildMappedBacktestLineageFallback(mappedBacktest)),
      },
      dateRange: {
        start: mappedBacktest.dateRangeStart ?? null,
        end: mappedBacktest.dateRangeEnd ?? null,
      },
      executionAssumptions: mappedBacktest.executionAssumptions ?? null,
      inputs,
    };
  }

  private buildBacktestInputSnapshotFileName(backtest: Backtest): string {
    const baseName =
      this.readTrimmedString(backtest.parameter) ||
      this.readTrimmedString(backtest.name) ||
      this.readTrimmedString(backtest.strategy) ||
      'backtest';
    const sanitizedBase = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);

    return `backtest-input-snapshot-${sanitizedBase || 'run'}-${backtest.id}.json`;
  }

  private buildImmutableInputSnapshotInputs(
    config: Record<string, unknown>,
    executionAssumptions: BacktestExecutionAssumptions | null
  ): Record<string, unknown> {
    const inputs: Record<string, unknown> = { ...config };

    delete inputs.progress;
    delete inputs.resumeCheckpoint;
    delete inputs.performanceSurface;
    delete inputs.portfolioSummary;
    delete inputs.tradeEventCount;

    if (!inputs.executionAssumptions && executionAssumptions) {
      inputs.executionAssumptions = executionAssumptions as unknown as Record<string, unknown>;
    }

    return inputs;
  }

  private buildMappedBacktestLineageFallback(
    mappedBacktest: BacktestItem
  ): BacktestInputSnapshotExport['lineage'] {
    return {
      sourceType: mappedBacktest.sourceType ?? null,
      sourceId: mappedBacktest.sourceId ?? null,
      libraryId: mappedBacktest.libraryId ?? null,
      libraryName: mappedBacktest.libraryName ?? null,
      projectId: mappedBacktest.projectId ?? null,
      projectVersion: mappedBacktest.projectVersion ?? null,
      templateId: mappedBacktest.templateId ?? null,
      templateName: mappedBacktest.templateName ?? null,
      templateVersion: mappedBacktest.templateVersion ?? null,
      sourceTemplateId: mappedBacktest.sourceTemplateId ?? null,
      sourceTemplateName: mappedBacktest.sourceTemplateName ?? null,
      sourceTemplateVersion: mappedBacktest.sourceTemplateVersion ?? null,
      templateDiffSummary: mappedBacktest.templateDiffSummary ?? null,
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

  private readTrimmedString(value: unknown): string | null {
    const trimmed = String(value || '').trim();
    return trimmed || null;
  }
}
