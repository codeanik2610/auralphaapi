import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SignalDirection,
  SignalScanRunResult,
  SignalSourceRefType,
  SignalScanSourceResult,
} from '../contracts/Signal';
import { successResponse } from '../utils/response';
import {
  RunSignalScanBody,
  validateRunSignalScanBody,
} from '../validators/signals.validator';
import {
  SignalRepository,
  StrategyLabProject,
  StrategyLabRepository,
  StrategyLibrary,
  StrategyLibraryRepository,
  StrategyTemplateRepository,
} from '../../database';
import {
  AutomationSignalEvaluatorService,
  EvaluatedAutomationSignalEvent,
  EvaluatedAutomationSignalItem,
} from './AutomationSignalEvaluatorService';
import { OperationalEventService } from './OperationalEventService';

type SignalScanSourceType = 'strategy_library' | 'strategy_lab';

interface SignalScanCandidate {
  userId: string;
  sourceRefType: SignalScanSourceType;
  sourceRefId: string;
  sourceName: string;
  templateId: string;
  templateName: string;
  templateVersion: number | null;
  templateConfig: Record<string, unknown>;
  symbols: string[];
  timeframes: string[];
  market: string | null;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

@Service()
export class SignalScanService {
  @Inject(() => StrategyLibraryRepository)
  private strategyLibraryRepository!: StrategyLibraryRepository;

  @Inject(() => StrategyLabRepository)
  private strategyLabRepository!: StrategyLabRepository;

  @Inject(() => StrategyTemplateRepository)
  private strategyTemplateRepository!: StrategyTemplateRepository;

  @Inject(() => AutomationSignalEvaluatorService)
  private automationSignalEvaluatorService!: AutomationSignalEvaluatorService;

  @Inject(() => SignalRepository)
  private signalRepository!: SignalRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async runSignalScan(
    userId: string,
    body: RunSignalScanBody
  ): Promise<ApiSuccessResponse<SignalScanRunResult>> {
    const options = validateRunSignalScanBody(body);

    try {
      // Ensure PostgreSQL connection is initialized for strategy tables
      const { strategyDataSource } = await import('../../database/pg-data-source');
      if (!strategyDataSource.isInitialized) {
        await strategyDataSource.initialize();
      }

      const candidates = await this.loadCandidates(userId, options);
      if (!candidates.length) {
        const emptyResult: SignalScanRunResult = {
          message: 'No strategy sources were eligible for signal scanning',
          scannedSources: 0,
          skippedSources: 0,
          evaluationsRun: 0,
          evaluatedSymbols: 0,
          detectedSignals: 0,
          insertedSignals: 0,
          updatedSignals: 0,
          sources: [],
        };
        return successResponse(emptyResult);
      }

      const sourceResults: SignalScanSourceResult[] = [];
      const payloadByDedupeKey = new Map<string, Parameters<SignalRepository['upsertSignals']>[0][number]>();
      let evaluationsRun = 0;
      let evaluatedSymbols = 0;

      for (const candidate of candidates) {
        const sourceResult: SignalScanSourceResult = {
          sourceRefType: candidate.sourceRefType as SignalSourceRefType,
          sourceRefId: candidate.sourceRefId,
          name: candidate.sourceName,
          status: 'completed',
          symbols: candidate.symbols.length,
          timeframes: candidate.timeframes,
          evaluationsRun: 0,
          evaluatedSymbols: 0,
          detectedSignals: 0,
          issues: [],
        };

        if (!candidate.symbols.length) {
          sourceResult.status = 'skipped';
          sourceResult.issues.push('No assets are configured for this source');
          sourceResults.push(sourceResult);
          continue;
        }

        if (!candidate.timeframes.length) {
          sourceResult.status = 'skipped';
          sourceResult.issues.push('No timeframes are configured for this source');
          sourceResults.push(sourceResult);
          continue;
        }

        for (const timeframe of candidate.timeframes) {
          try {
            const evaluation = await this.automationSignalEvaluatorService.evaluateLatestSignals({
              templateId: candidate.templateId,
              templateName: candidate.templateName,
              templateConfig: candidate.templateConfig,
              symbols: candidate.symbols,
              timeframe,
            });

            evaluationsRun += 1;
            evaluatedSymbols += evaluation.evaluatedSymbols;
            sourceResult.evaluationsRun += 1;
            sourceResult.evaluatedSymbols += evaluation.evaluatedSymbols;

            const signalPayloads = this.buildSignalPayloads(candidate, timeframe, evaluation.items);
            sourceResult.detectedSignals += signalPayloads.length;

            for (const payload of signalPayloads) {
              payloadByDedupeKey.set(payload.dedupeKey, payload);
            }
          } catch (error) {
            sourceResult.issues.push(
              `${timeframe}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        if (sourceResult.issues.length && sourceResult.evaluationsRun === 0) {
          sourceResult.status = 'failed';
        } else if (sourceResult.issues.length) {
          sourceResult.status = 'partial';
        }

        sourceResults.push(sourceResult);
      }

      const upsertResult = await this.signalRepository.upsertSignals(
        Array.from(payloadByDedupeKey.values())
      );

      const result: SignalScanRunResult = {
        message: 'Signal scan completed',
        scannedSources: sourceResults.filter((item) => item.status !== 'skipped').length,
        skippedSources: sourceResults.filter((item) => item.status === 'skipped').length,
        evaluationsRun,
        evaluatedSymbols,
        detectedSignals: Array.from(payloadByDedupeKey.values()).length,
        insertedSignals: upsertResult.inserted,
        updatedSignals: upsertResult.updated,
        sources: sourceResults,
      };

      await this.operationalEventService.logActivity(userId, {
        type: 'Signal',
        title: 'Signal scan completed',
        status: 'Success',
        route: 'Signals',
        stream: 'Scan',
        description: `Scanned ${result.scannedSources} source(s), inserted ${result.insertedSignals}, updated ${result.updatedSignals}`,
      });

      return successResponse(result);
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Signal',
        title: 'Signal scan failed',
        status: 'Failed',
        route: 'Signals',
        stream: 'Scan',
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Signals',
        source: 'signals-scan',
        message: `Signal scan failed: ${error instanceof Error ? error.message : String(error)}`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  private async loadCandidates(
    userId: string,
    options: ReturnType<typeof validateRunSignalScanBody>
  ): Promise<SignalScanCandidate[]> {
    const [libraryRecords, labProjects] = await Promise.all([
      options.includeStrategyLibrary
        ? this.strategyLibraryRepository.listForSignalScan(userId, options.maxSources)
        : Promise.resolve([]),
      options.includeStrategyLab
        ? this.strategyLabRepository.listProjectsForSignalScan(userId, options.maxSources)
        : Promise.resolve([]),
    ]);

    const candidates: SignalScanCandidate[] = [];

    for (const record of libraryRecords) {
      const candidate = await this.buildLibraryCandidate(userId, record);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    for (const project of labProjects) {
      const candidate = this.buildStrategyLabCandidate(project);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    return candidates
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, options.maxSources);
  }

  private async buildLibraryCandidate(
    userId: string,
    record: StrategyLibrary
  ): Promise<SignalScanCandidate | null> {
    const template = await this.strategyTemplateRepository.getStrategyTemplateById(
      userId,
      record.templateId
    );
    if (!template) {
      return null;
    }

    const templateConfig = this.parseRecord(template.config);
    const overrides = this.parseRecord(record.overrides);
    const assets = this.normalizeAssets(record.assets ?? templateConfig.assets ?? null);
    const symbols = this.extractSymbols(assets);
    const timeframes = this.normalizeTimeframes(
      record.timeframes,
      templateConfig.timeframes,
      templateConfig.timeframe
    );
    const mergedConfig = this.mergeConfig(templateConfig, overrides);
    mergedConfig.assets = assets;
    mergedConfig.timeframes = timeframes;
    mergedConfig.sourceTemplateId = template.id;
    mergedConfig.sourceTemplateVersion = Number(template.templateVersion || 1);
    mergedConfig.sourceTemplateName = template.name;

    return {
      userId,
      sourceRefType: 'strategy_library',
      sourceRefId: record.id,
      sourceName: record.name,
      templateId: template.id,
      templateName: record.name || template.name,
      templateVersion: Number(template.templateVersion || 1),
      templateConfig: mergedConfig,
      symbols,
      timeframes,
      market: this.readString(mergedConfig.market, templateConfig.market) ?? 'crypto-futures',
      updatedAt: record.updatedAt,
      metadata: {
        sourceTemplateId: template.id,
        sourceTemplateVersion: Number(template.templateVersion || 1),
        sourceTemplateName: template.name,
        libraryStatus: record.status,
      },
    };
  }

  private buildStrategyLabCandidate(project: StrategyLabProject): SignalScanCandidate | null {
    const config = this.parseRecord(project.config);
    const assets = this.normalizeAssets(config.assets ?? null);
    const symbols = this.extractSymbols(assets);
    const timeframes = this.normalizeTimeframes(
      config.timeframes,
      project.timeframe,
      config.timeframe
    );
    const parameters = this.mergeRecord(
      this.parseRecord(config.parameters),
      this.parseRecord(project.parameters)
    );
    const risk = this.mergeRecord(
      this.parseRecord(config.risk),
      this.parseRecord(project.riskConfig)
    );
    const mergedConfig = {
      ...config,
      assets,
      timeframes,
      parameters,
      risk,
      codeTarget: this.readString(project.codeTarget, config.codeTarget) ?? 'dsl',
      codeDefinition: this.readString(project.codeDefinition, config.codeDefinition) ?? null,
      market: this.readString(project.market, config.market) ?? 'crypto-futures',
      sourceTemplateId:
        this.readString(project.sourceTemplateId, config.sourceTemplateId) ?? null,
      sourceTemplateVersion: this.readNumber(
        project.sourceTemplateVersion,
        config.sourceTemplateVersion
      ),
      sourceTemplateName: this.readString(config.sourceTemplateName) ?? null,
      projectVersion: Number(project.projectVersion || 1),
    };

    return {
      userId: project.userId,
      sourceRefType: 'strategy_lab',
      sourceRefId: project.id,
      sourceName: project.name,
      templateId: `lab-${project.id}`,
      templateName: project.name,
      templateVersion: Number(project.projectVersion || 1),
      templateConfig: mergedConfig,
      symbols,
      timeframes,
      market: this.readString(mergedConfig.market) ?? 'crypto-futures',
      updatedAt: project.updatedAt,
      metadata: {
        projectVersion: Number(project.projectVersion || 1),
        sourceTemplateId: this.readString(project.sourceTemplateId, config.sourceTemplateId),
        sourceTemplateVersion: this.readNumber(
          project.sourceTemplateVersion,
          config.sourceTemplateVersion
        ),
        sourceTemplateName: this.readString(config.sourceTemplateName),
        authoringMode: project.authoringMode,
      },
    };
  }

  private buildSignalPayloads(
    candidate: SignalScanCandidate,
    timeframe: string,
    items: EvaluatedAutomationSignalItem[]
  ): Parameters<SignalRepository['upsertSignals']>[0] {
    const confidence = this.resolveConfidence(candidate.templateConfig);
    const aiScore = Math.round(confidence * 100);
    const payloads: Parameters<SignalRepository['upsertSignals']>[0] = [];

    for (const item of items) {
      if (item.status !== 'ok') {
        continue;
      }

      const events = item.signals?.length
        ? item.signals
        : this.buildFallbackEvents(item);

      for (const event of events) {
        const signalTime = new Date(event.signalTime);
        if (Number.isNaN(signalTime.getTime())) {
          continue;
        }

        const direction: SignalDirection = event.side === 'short' ? 'Short' : 'Long';
        const expiresAt = this.computeExpiry(signalTime, timeframe);
        const dedupeKey = [
          candidate.sourceRefType,
          candidate.sourceRefId,
          item.symbol,
          timeframe,
          direction,
          signalTime.toISOString(),
        ].join(':');

        payloads.push({
          userId: candidate.userId,
          dedupeKey,
          symbol: item.symbol,
          source: candidate.sourceName,
          confidence,
          direction,
          timeframe,
          status: 'Triggered',
          market: candidate.market,
          signalTime,
          entryPrice: event.entryPrice,
          sourceRefType: candidate.sourceRefType,
          sourceRefId: candidate.sourceRefId,
          expiresAt,
          aiScore,
          thesis: `${direction} entry detected on the latest closed ${timeframe} candle`,
          metadata: {
            ...candidate.metadata,
            evaluatedSymbol: item.symbol,
            evaluatedTimeframe: timeframe,
            evaluatedSignalTime: signalTime.toISOString(),
            signalSide: event.side,
          },
        });
      }
    }

    return payloads;
  }

  private buildFallbackEvents(
    item: EvaluatedAutomationSignalItem
  ): EvaluatedAutomationSignalEvent[] {
    const events: EvaluatedAutomationSignalEvent[] = [];
    if (
      item.longEntry &&
      !item.longEntryPrevious &&
      !item.longExit &&
      item.signalTime
    ) {
      events.push({
        side: 'long',
        signalTime: item.signalTime,
        entryPrice: item.entryPrice ?? null,
      });
    }
    if (
      item.shortEntry &&
      !item.shortEntryPrevious &&
      !item.shortExit &&
      item.signalTime
    ) {
      events.push({
        side: 'short',
        signalTime: item.signalTime,
        entryPrice: item.entryPrice ?? null,
      });
    }
    return events;
  }

  private computeExpiry(signalTime: Date, timeframe: string): Date | null {
    const seconds = this.timeframeToSeconds(timeframe);
    if (!seconds) {
      return null;
    }
    return new Date(signalTime.getTime() + seconds * 1000);
  }

  private timeframeToSeconds(value: string): number | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    const suffix = normalized.slice(-1);
    const amount = Number(normalized.slice(0, -1));
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    switch (suffix) {
      case 'm':
        return amount * 60;
      case 'h':
        return amount * 3600;
      case 'd':
        return amount * 86400;
      case 'w':
        return amount * 604800;
      default:
        return null;
    }
  }

  private resolveConfidence(config: Record<string, unknown>): number {
    const parameters = this.parseRecord(config.parameters);
    const risk = this.parseRecord(config.risk);
    const raw = this.readNumber(
      parameters.signalThreshold,
      parameters.signal_threshold,
      risk.signal_threshold,
      risk.signalThreshold
    );
    if (raw === null) {
      return 0.8;
    }
    if (raw > 1 && raw <= 100) {
      return Math.min(1, Math.max(0, raw / 100));
    }
    return Math.min(1, Math.max(0, raw));
  }

  private normalizeAssets(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    );
  }

  private extractSymbols(value: Array<Record<string, unknown>>): string[] {
    const symbols = value
      .map((item) =>
        this.readString(item.symbol, item.asset, item.ticker, item.instrument)
      )
      .filter((item): item is string => Boolean(item))
      .map((item) => item.toUpperCase());
    return Array.from(new Set(symbols));
  }

  private normalizeTimeframes(...values: unknown[]): string[] {
    const items: string[] = [];
    for (const value of values) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          const normalized = this.readString(entry);
          if (normalized) {
            items.push(normalized);
          }
        }
        continue;
      }
      const normalized = this.readString(value);
      if (normalized) {
        items.push(normalized);
      }
    }
    return Array.from(new Set(items));
  }

  private mergeConfig(
    base: Record<string, unknown>,
    overrides: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      ...base,
      ...overrides,
      parameters: this.mergeRecord(
        this.parseRecord(base.parameters),
        this.parseRecord(overrides.parameters)
      ),
      risk: this.mergeRecord(this.parseRecord(base.risk), this.parseRecord(overrides.risk)),
      filters: this.mergeRecord(
        this.parseRecord(base.filters),
        this.parseRecord(overrides.filters)
      ),
    };
  }

  private mergeRecord(
    base: Record<string, unknown>,
    overrides: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      ...base,
      ...overrides,
    };
  }

  private parseRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private readString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private readNumber(...values: unknown[]): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return null;
  }
}
