import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BacktestTemplateDiffSummary,
  BacktestTopSetupItem,
  PromoteBacktestBody,
  PromoteBacktestResult,
} from '../contracts/Backtest';
import { BadRequestAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  AutomationSchedule,
  computeNextRun,
  resolveAutomationSchedule,
} from '../utils/automationSchedule';
import {
  normalizeAutomationConfig,
  normalizeTradeSuggestionExecutionPolicy,
} from '../utils/automationType';
import { normalizeTimeZone } from '../utils/timezone';
import { AutomationRepository, Backtest } from '../../database';
import { OperationalEventService } from './OperationalEventService';
import { UserTimeZoneService } from './UserTimeZoneService';

export interface BacktestPromotionInput {
  userId: string;
  backtest: Backtest;
  payload: PromoteBacktestBody;
  selectedTopSetup: BacktestTopSetupItem;
}

export interface BacktestPromotionGroupEntry {
  backtest: Backtest;
  selectedTopSetup: BacktestTopSetupItem;
}

export interface BacktestPromotionGroupInput {
  userId: string;
  payload: PromoteBacktestBody;
  entries: BacktestPromotionGroupEntry[];
}

@Service()
export class BacktestPromotionService {
  @Inject(() => AutomationRepository)
  private automationRepository!: AutomationRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async promoteResolvedTopSetup({
    userId,
    backtest,
    payload,
    selectedTopSetup,
  }: BacktestPromotionInput): Promise<ApiSuccessResponse<PromoteBacktestResult>> {
    try {
      const config = this.parseConfig(backtest.result?.config) ?? {};
      const inputSnapshot = this.parseConfig(config.inputSnapshot) ?? {};
      const templateDiffSummary = this.parseTemplateDiffSummary(
        inputSnapshot.templateDiffSummary ?? config.templateDiffSummary
      );

      const existingAutomation =
        await this.automationRepository.findTradeSuggestionAutomationByScope({
          userId,
          backtestId: backtest.id,
          symbol: selectedTopSetup.symbol,
          timeframe: selectedTopSetup.timeframe,
        });

      if (existingAutomation) {
        await this.operationalEventService.logActivity(userId, {
          type: 'Automation',
          title: `Automation already exists for top setup: ${existingAutomation.name}`,
          status: 'Success',
          route: 'Automations',
          stream: 'Deployments',
          related: `${selectedTopSetup.symbol} · ${selectedTopSetup.timeframe}`,
          referenceId: existingAutomation.id,
          description: `Reused existing automation for backtest ${backtest.id} top setup ${selectedTopSetup.symbol} ${selectedTopSetup.timeframe}`,
        });

        return successResponse({
          message: 'Automation already exists for top setup',
          automation: {
            id: existingAutomation.id,
            status: existingAutomation.status as PromoteBacktestResult['automation']['status'],
            createdAt: existingAutomation.createdAt.toISOString(),
          },
        });
      }

      const baseAssets = Array.isArray(inputSnapshot.assets)
        ? inputSnapshot.assets
        : Array.isArray(config.assets)
          ? config.assets
          : [];
      const assets = this.filterAssetsForSymbol(baseAssets, selectedTopSetup.symbol);
      const timeframes = [selectedTopSetup.timeframe];

      if (!assets.length) {
        throw new BadRequestAppError(
          `Unable to scope automation assets to symbol ${selectedTopSetup.symbol}`
        );
      }

      const template =
        this.parseConfig(inputSnapshot.template) ?? this.parseConfig(config.template) ?? {};
      const templateConfig =
        template.config && typeof template.config === 'object'
          ? (template.config as Record<string, unknown>)
          : {};
      const primaryAsset =
        assets && Array.isArray(assets)
          ? (assets[0] as Record<string, unknown> | undefined)
          : undefined;
      const broker =
        payload.broker ||
        (primaryAsset ? String(primaryAsset.brokerKey || primaryAsset.broker || '').trim() : '') ||
        'paper';
      const market =
        String(inputSnapshot.market || config.market || templateConfig.market || '').trim() ||
        'crypto-futures';
      const status = payload.status || 'Draft';
      const scopedInputSnapshot =
        Object.keys(inputSnapshot).length > 0
          ? {
              ...inputSnapshot,
              assets,
              timeframes,
            }
          : {};

      const restConfig = { ...config };
      delete restConfig.performanceSurface;
      const normalizedConfig = {
        ...restConfig,
        assets,
        timeframes,
        market,
        ...(typeof inputSnapshot.sourceType === 'string'
          ? { sourceType: inputSnapshot.sourceType }
          : {}),
        ...(typeof inputSnapshot.sourceId === 'string' ? { sourceId: inputSnapshot.sourceId } : {}),
        ...(typeof inputSnapshot.libraryId === 'string'
          ? { libraryId: inputSnapshot.libraryId }
          : {}),
        ...(typeof inputSnapshot.libraryName === 'string'
          ? { libraryName: inputSnapshot.libraryName }
          : {}),
        ...(typeof inputSnapshot.projectId === 'string'
          ? { projectId: inputSnapshot.projectId }
          : {}),
        ...(typeof inputSnapshot.templateId === 'string'
          ? { templateId: inputSnapshot.templateId }
          : {}),
        ...(typeof inputSnapshot.templateVersion === 'number'
          ? { templateVersion: inputSnapshot.templateVersion }
          : {}),
        ...(typeof inputSnapshot.projectVersion === 'number'
          ? { projectVersion: inputSnapshot.projectVersion }
          : {}),
        ...(typeof inputSnapshot.sourceTemplateId === 'string'
          ? { sourceTemplateId: inputSnapshot.sourceTemplateId }
          : {}),
        ...(typeof inputSnapshot.sourceTemplateVersion === 'number'
          ? { sourceTemplateVersion: inputSnapshot.sourceTemplateVersion }
          : {}),
        ...(typeof inputSnapshot.sourceTemplateName === 'string'
          ? { sourceTemplateName: inputSnapshot.sourceTemplateName }
          : {}),
        ...(templateDiffSummary ? { templateDiffSummary } : {}),
        ...(Object.keys(template).length ? { template } : {}),
        ...(Object.keys(scopedInputSnapshot).length ? { inputSnapshot: scopedInputSnapshot } : {}),
      };

      const schedule = payload.schedule ?? null;
      const resolvedSchedule = resolveAutomationSchedule(schedule, payload.trigger);
      if (payload.schedule !== undefined && !resolvedSchedule) {
        throw new BadRequestAppError('schedule is missing or invalid');
      }
      if (status === 'Running' && !resolvedSchedule) {
        throw new BadRequestAppError('schedule is required to create a running automation');
      }

      const automationTimeZone = await this.resolveAutomationTimeZone(userId);
      const nextRun =
        status === 'Running' && resolvedSchedule
          ? computeNextRun(resolvedSchedule, automationTimeZone, new Date())
          : null;
      if (status === 'Running' && !nextRun) {
        throw new BadRequestAppError('Unable to compute next run from schedule');
      }

      const trigger =
        payload.trigger ||
        (resolvedSchedule
          ? this.describeAutomationSchedule(resolvedSchedule)
          : timeframes.length
            ? `timeframe:${timeframes.join(',')}`
            : 'manual');
      const name = payload.name || this.buildPromotedAutomationName(backtest, selectedTopSetup);
      const executionPolicy = this.finalizeTradeSuggestionExecutionPolicy(
        userId,
        payload.executionPolicy
      );
      const automationConfig = normalizeAutomationConfig('trade-suggestion', {
        source: 'backtest',
        backtestId: backtest.id,
        strategy: backtest.strategy,
        symbol: selectedTopSetup.symbol || backtest.symbol,
        timeframe: selectedTopSetup.timeframe || null,
        parameter: this.buildPromotedAutomationParameter(backtest, selectedTopSetup),
        setupScope: {
          symbol: selectedTopSetup.symbol,
          timeframe: selectedTopSetup.timeframe,
          score: selectedTopSetup.score,
          trades: selectedTopSetup.trades,
          winRate: selectedTopSetup.winRate,
          profitFactor: selectedTopSetup.profitFactor,
          returnPct: selectedTopSetup.returnPct,
          maxDrawdownPct: selectedTopSetup.maxDrawdownPct,
          dedupeKey: selectedTopSetup.dedupeKey,
          dateRangeStart: selectedTopSetup.dateRangeStart ?? null,
          dateRangeEnd: selectedTopSetup.dateRangeEnd ?? null,
        },
        config: normalizedConfig,
        tradeSuggestion: {
          execution: executionPolicy,
        },
      });

      const automation = await this.automationRepository.createAutomation({
        userId,
        name,
        strategy: backtest.strategy,
        broker,
        market,
        trigger,
        status,
        automationType: 'trade-suggestion',
        timeZone: automationTimeZone,
        schedule,
        riskMode: payload.riskMode ?? null,
        config: automationConfig,
      });

      if (nextRun) {
        automation.nextRun = nextRun;
        await this.automationRepository.saveAutomation(automation);
      }

      await this.automationRepository.createAutomationEvent({
        automationId: automation.id,
        type: 'Created',
        entity: 'Top setup',
        outcome: 'Promoted',
        meta: {
          symbol: selectedTopSetup.symbol,
          timeframe: selectedTopSetup.timeframe,
          schedule,
        },
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: `Automation created from top setup: ${automation.name}`,
        status: 'Success',
        route: 'Automations',
        stream: 'Deployments',
        related: `${selectedTopSetup.symbol} · ${selectedTopSetup.timeframe}`,
        referenceId: automation.id,
        description: `Backtest ${backtest.id} top setup ${selectedTopSetup.symbol} ${selectedTopSetup.timeframe} promoted to automation`,
      });

      return successResponse({
        message: 'Automation created from top setup',
        automation: {
          id: automation.id,
          status: automation.status as PromoteBacktestResult['automation']['status'],
          createdAt: automation.createdAt.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: 'Backtest promotion failed',
        status: 'Failed',
        route: 'Automations',
        stream: 'Deployments',
        related: `${selectedTopSetup.symbol} · ${selectedTopSetup.timeframe}`,
        referenceId: backtest.id,
        description: message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Automations',
        source: 'backtests:promotion-service',
        message: `Backtest promotion failed (${backtest.id}): ${message}`,
        route: 'Automations',
      });
      throw error;
    }
  }

  async promoteResolvedTopSetupGroup({
    userId,
    payload,
    entries,
  }: BacktestPromotionGroupInput): Promise<ApiSuccessResponse<PromoteBacktestResult>> {
    const normalizedEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
    if (!normalizedEntries.length) {
      throw new BadRequestAppError('No selected top setups were provided for timeframe deployment');
    }

    const primaryEntry = normalizedEntries[0];
    const primaryBacktest = primaryEntry.backtest;
    const primaryTopSetup = primaryEntry.selectedTopSetup;
    const timeframe = String(primaryTopSetup.timeframe || '').trim();

    if (!timeframe) {
      throw new BadRequestAppError('Selected top setup timeframe is required');
    }

    const mismatchedTimeframe = normalizedEntries.find(
      (entry) => String(entry.selectedTopSetup.timeframe || '').trim() !== timeframe
    );
    if (mismatchedTimeframe) {
      throw new BadRequestAppError('Batch deployment groups must contain one timeframe only');
    }

    const symbols = Array.from(
      new Set(
        normalizedEntries
          .map((entry) => this.normalizeAssetSymbol(entry.selectedTopSetup.symbol))
          .filter(Boolean)
      )
    );
    const primarySymbol = symbols[0];

    if (!primarySymbol) {
      throw new BadRequestAppError('Selected top setup symbol is required');
    }

    const relatedLabel = `${symbols.length} asset${symbols.length === 1 ? '' : 's'} · ${timeframe}`;

    try {
      const config = this.parseConfig(primaryBacktest.result?.config) ?? {};
      const inputSnapshot = this.parseConfig(config.inputSnapshot) ?? {};
      const templateDiffSummary = this.parseTemplateDiffSummary(
        inputSnapshot.templateDiffSummary ?? config.templateDiffSummary
      );

      const existingAutomation =
        await this.automationRepository.findTradeSuggestionAutomationByScope({
          userId,
          backtestId: primaryBacktest.id,
          symbol: primarySymbol,
          timeframe,
        });

      if (existingAutomation) {
        await this.operationalEventService.logActivity(userId, {
          type: 'Automation',
          title: `Automation already exists for timeframe group: ${existingAutomation.name}`,
          status: 'Success',
          route: 'Automations',
          stream: 'Deployments',
          related: relatedLabel,
          referenceId: existingAutomation.id,
          description: `Reused existing automation for backtest ${primaryBacktest.id} timeframe ${timeframe} covering ${symbols.join(', ')}`,
        });

        return successResponse({
          message: 'Automation already exists for timeframe group',
          automation: {
            id: existingAutomation.id,
            status: existingAutomation.status as PromoteBacktestResult['automation']['status'],
            createdAt: existingAutomation.createdAt.toISOString(),
          },
        });
      }

      const assets = this.dedupeAssetsBySymbol(
        normalizedEntries.flatMap((entry) => {
          const entryConfig = this.parseConfig(entry.backtest.result?.config) ?? {};
          const entryInputSnapshot = this.parseConfig(entryConfig.inputSnapshot) ?? {};
          const baseAssets = Array.isArray(entryInputSnapshot.assets)
            ? entryInputSnapshot.assets
            : Array.isArray(entryConfig.assets)
              ? entryConfig.assets
              : [];
          return this.filterAssetsForSymbol(baseAssets, entry.selectedTopSetup.symbol);
        })
      );
      const assetSymbols = new Set(
        assets.map((asset) => this.readAssetSymbol(asset)).filter(Boolean)
      );
      const missingSymbols = symbols.filter((symbol) => !assetSymbols.has(symbol));
      const timeframes = [timeframe];

      if (missingSymbols.length) {
        throw new BadRequestAppError(
          `Unable to scope automation assets to symbol(s) ${missingSymbols.join(', ')}`
        );
      }

      const template =
        this.parseConfig(inputSnapshot.template) ?? this.parseConfig(config.template) ?? {};
      const templateConfig =
        template.config && typeof template.config === 'object'
          ? (template.config as Record<string, unknown>)
          : {};
      const primaryAsset =
        assets && Array.isArray(assets)
          ? (assets[0] as Record<string, unknown> | undefined)
          : undefined;
      const broker =
        payload.broker ||
        (primaryAsset ? String(primaryAsset.brokerKey || primaryAsset.broker || '').trim() : '') ||
        'paper';
      const market =
        String(inputSnapshot.market || config.market || templateConfig.market || '').trim() ||
        'crypto-futures';
      const status = payload.status || 'Draft';
      const setupScopes = normalizedEntries.map((entry) => this.buildSetupScope(entry));
      const sourceBacktestIds = Array.from(
        new Set(normalizedEntries.map((entry) => entry.backtest.id).filter(Boolean))
      );
      const scopedInputSnapshot =
        Object.keys(inputSnapshot).length > 0
          ? {
              ...inputSnapshot,
              assets,
              symbol: primarySymbol,
              symbols,
              timeframe,
              timeframes,
              setupScopes,
              sourceBacktestIds,
            }
          : {};

      const restConfig = { ...config };
      delete restConfig.performanceSurface;
      const normalizedConfig = {
        ...restConfig,
        assets,
        symbol: primarySymbol,
        symbols,
        timeframe,
        timeframes,
        market,
        setupScopes,
        sourceBacktestIds,
        ...(typeof inputSnapshot.sourceType === 'string'
          ? { sourceType: inputSnapshot.sourceType }
          : {}),
        ...(typeof inputSnapshot.sourceId === 'string' ? { sourceId: inputSnapshot.sourceId } : {}),
        ...(typeof inputSnapshot.libraryId === 'string'
          ? { libraryId: inputSnapshot.libraryId }
          : {}),
        ...(typeof inputSnapshot.libraryName === 'string'
          ? { libraryName: inputSnapshot.libraryName }
          : {}),
        ...(typeof inputSnapshot.projectId === 'string'
          ? { projectId: inputSnapshot.projectId }
          : {}),
        ...(typeof inputSnapshot.templateId === 'string'
          ? { templateId: inputSnapshot.templateId }
          : {}),
        ...(typeof inputSnapshot.templateVersion === 'number'
          ? { templateVersion: inputSnapshot.templateVersion }
          : {}),
        ...(typeof inputSnapshot.projectVersion === 'number'
          ? { projectVersion: inputSnapshot.projectVersion }
          : {}),
        ...(typeof inputSnapshot.sourceTemplateId === 'string'
          ? { sourceTemplateId: inputSnapshot.sourceTemplateId }
          : {}),
        ...(typeof inputSnapshot.sourceTemplateVersion === 'number'
          ? { sourceTemplateVersion: inputSnapshot.sourceTemplateVersion }
          : {}),
        ...(typeof inputSnapshot.sourceTemplateName === 'string'
          ? { sourceTemplateName: inputSnapshot.sourceTemplateName }
          : {}),
        ...(templateDiffSummary ? { templateDiffSummary } : {}),
        ...(Object.keys(template).length ? { template } : {}),
        ...(Object.keys(scopedInputSnapshot).length ? { inputSnapshot: scopedInputSnapshot } : {}),
      };

      const schedule = payload.schedule ?? null;
      const resolvedSchedule = resolveAutomationSchedule(schedule, payload.trigger);
      if (payload.schedule !== undefined && !resolvedSchedule) {
        throw new BadRequestAppError('schedule is missing or invalid');
      }
      if (status === 'Running' && !resolvedSchedule) {
        throw new BadRequestAppError('schedule is required to create a running automation');
      }

      const automationTimeZone = await this.resolveAutomationTimeZone(userId);
      const nextRun =
        status === 'Running' && resolvedSchedule
          ? computeNextRun(resolvedSchedule, automationTimeZone, new Date())
          : null;
      if (status === 'Running' && !nextRun) {
        throw new BadRequestAppError('Unable to compute next run from schedule');
      }

      const trigger =
        payload.trigger ||
        (resolvedSchedule
          ? this.describeAutomationSchedule(resolvedSchedule)
          : `timeframe:${timeframe}`);
      const name =
        payload.name || this.buildPromotedAutomationGroupName(primaryBacktest, symbols, timeframe);
      const executionPolicy = this.finalizeTradeSuggestionExecutionPolicy(
        userId,
        payload.executionPolicy
      );
      const automationConfig = normalizeAutomationConfig('trade-suggestion', {
        source: 'backtest',
        backtestId: primaryBacktest.id,
        sourceBacktestIds,
        strategy: primaryBacktest.strategy,
        symbol: primarySymbol,
        symbols,
        timeframe,
        parameter: this.buildPromotedAutomationGroupParameter(primaryBacktest, symbols, timeframe),
        setupScope: {
          symbol: primarySymbol,
          symbols,
          timeframe,
          itemCount: normalizedEntries.length,
          setups: setupScopes,
        },
        config: normalizedConfig,
        tradeSuggestion: {
          execution: executionPolicy,
        },
      });

      const automation = await this.automationRepository.createAutomation({
        userId,
        name,
        strategy: primaryBacktest.strategy,
        broker,
        market,
        trigger,
        status,
        automationType: 'trade-suggestion',
        timeZone: automationTimeZone,
        schedule,
        riskMode: payload.riskMode ?? null,
        config: automationConfig,
      });

      if (nextRun) {
        automation.nextRun = nextRun;
        await this.automationRepository.saveAutomation(automation);
      }

      await this.automationRepository.createAutomationEvent({
        automationId: automation.id,
        type: 'Created',
        entity: 'Top setup group',
        outcome: 'Promoted',
        meta: {
          symbols,
          timeframe,
          itemCount: normalizedEntries.length,
          schedule,
        },
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: `Automation created from timeframe group: ${automation.name}`,
        status: 'Success',
        route: 'Automations',
        stream: 'Deployments',
        related: relatedLabel,
        referenceId: automation.id,
        description: `Backtest timeframe group ${timeframe} promoted to automation for ${symbols.join(', ')}`,
      });

      return successResponse({
        message: 'Automation created from timeframe group',
        automation: {
          id: automation.id,
          status: automation.status as PromoteBacktestResult['automation']['status'],
          createdAt: automation.createdAt.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.operationalEventService.logActivity(userId, {
        type: 'Automation',
        title: 'Backtest timeframe-group promotion failed',
        status: 'Failed',
        route: 'Automations',
        stream: 'Deployments',
        related: relatedLabel,
        referenceId: primaryBacktest.id,
        description: message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Automations',
        source: 'backtests:promotion-service',
        message: `Backtest timeframe-group promotion failed (${primaryBacktest.id}): ${message}`,
        route: 'Automations',
      });
      throw error;
    }
  }

  private async resolveAutomationTimeZone(userId: string): Promise<string> {
    const userTimeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    return normalizeTimeZone(userTimeZone, userTimeZone);
  }

  private finalizeTradeSuggestionExecutionPolicy(
    userId: string,
    value: unknown
  ): Record<string, unknown> {
    const normalized = normalizeTradeSuggestionExecutionPolicy(value);
    const liveConsent = this.parseConfig(normalized.liveConsent) ?? {};
    const executionMode = String(normalized.executionMode || 'suggestion_only')
      .trim()
      .toLowerCase();
    const liveEnabled = executionMode === 'live_trade_auto' && liveConsent.enabled === true;

    return {
      ...normalized,
      liveConsent: {
        enabled: liveEnabled,
        confirmedByUserId: liveEnabled
          ? String(liveConsent.confirmedByUserId || userId).trim()
          : null,
        confirmedAt: liveEnabled
          ? String(liveConsent.confirmedAt || new Date().toISOString()).trim()
          : null,
      },
    };
  }

  private describeAutomationSchedule(schedule: AutomationSchedule): string {
    if (schedule.type === 'interval') {
      return `every ${Math.max(1, Math.round(schedule.intervalMinutes))}m`;
    }
    if (schedule.type === 'every_n_seconds') {
      return `every ${Math.max(1, Math.round(schedule.intervalSeconds))}s`;
    }
    if (schedule.type === 'hourly_at_minute') {
      return `hourly :${String(Math.max(0, Math.round(schedule.minute))).padStart(2, '0')}`;
    }
    if (schedule.type === 'weekly') {
      const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const weekdays = Array.isArray(schedule.weekdays)
        ? schedule.weekdays
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
            .map((day) => labels[day] || String(day))
            .join(', ')
        : '';
      return `weekly ${weekdays} ${this.toTimeString(schedule.hour, schedule.minute)}`.trim();
    }
    const intervalDaysValue =
      typeof schedule.intervalDays === 'number' && Number.isFinite(schedule.intervalDays)
        ? schedule.intervalDays
        : 1;
    const intervalDays =
      intervalDaysValue > 1 ? `every ${Math.round(intervalDaysValue)}d ` : 'daily ';
    return `${intervalDays}${this.toTimeString(schedule.hour, schedule.minute)}`.trim();
  }

  private toTimeString(hour: number, minute: number): string {
    return `${String(Math.max(0, Math.min(23, Math.round(hour || 0)))).padStart(2, '0')}:${String(
      Math.max(0, Math.min(59, Math.round(minute || 0)))
    ).padStart(2, '0')}`;
  }

  private buildPromotedAutomationName(
    backtest: Backtest,
    selectedTopSetup: BacktestTopSetupItem
  ): string {
    const base =
      String(backtest.name || '').trim() ||
      String(backtest.strategy || '').trim() ||
      `Automation ${backtest.id}`;
    const scope = [selectedTopSetup.symbol, selectedTopSetup.timeframe].filter(Boolean).join(' · ');
    return scope ? `${base} · ${scope}` : base;
  }

  private buildPromotedAutomationParameter(
    backtest: Backtest,
    selectedTopSetup: BacktestTopSetupItem
  ): string {
    const base = String(backtest.name || backtest.parameter || backtest.strategy || '').trim();
    const scoped = `${selectedTopSetup.symbol} · ${selectedTopSetup.timeframe}`;
    return base ? `${base} | ${scoped}` : scoped;
  }

  private buildPromotedAutomationGroupName(
    backtest: Backtest,
    symbols: string[],
    timeframe: string
  ): string {
    const base =
      String(backtest.name || '').trim() ||
      String(backtest.strategy || '').trim() ||
      `Automation ${backtest.id}`;
    const scope = `${symbols.length} asset${symbols.length === 1 ? '' : 's'} · ${timeframe}`;
    return `${base} · ${scope}`;
  }

  private buildPromotedAutomationGroupParameter(
    backtest: Backtest,
    symbols: string[],
    timeframe: string
  ): string {
    const base = String(backtest.name || backtest.parameter || backtest.strategy || '').trim();
    const scoped = `${symbols.join(', ')} · ${timeframe}`;
    return base ? `${base} | ${scoped}` : scoped;
  }

  private buildSetupScope(entry: BacktestPromotionGroupEntry): Record<string, unknown> {
    const { backtest, selectedTopSetup } = entry;
    return {
      backtestId: backtest.id,
      symbol: selectedTopSetup.symbol,
      timeframe: selectedTopSetup.timeframe,
      score: selectedTopSetup.score,
      trades: selectedTopSetup.trades,
      winRate: selectedTopSetup.winRate,
      profitFactor: selectedTopSetup.profitFactor,
      returnPct: selectedTopSetup.returnPct,
      maxDrawdownPct: selectedTopSetup.maxDrawdownPct,
      dedupeKey: selectedTopSetup.dedupeKey,
      dateRangeStart: selectedTopSetup.dateRangeStart ?? null,
      dateRangeEnd: selectedTopSetup.dateRangeEnd ?? null,
    };
  }

  private dedupeAssetsBySymbol(assets: unknown[]): unknown[] {
    const seen = new Set<string>();
    const deduped: unknown[] = [];

    (Array.isArray(assets) ? assets : []).forEach((asset) => {
      const symbol = this.readAssetSymbol(asset);
      if (!symbol || seen.has(symbol)) {
        return;
      }
      seen.add(symbol);
      deduped.push(asset);
    });

    return deduped;
  }

  private filterAssetsForSymbol(assets: unknown[], symbol: string): unknown[] {
    const target = this.normalizeAssetSymbol(symbol);
    if (!target) {
      return Array.isArray(assets) ? assets : [];
    }

    return (Array.isArray(assets) ? assets : []).filter((asset) => {
      if (typeof asset === 'string') {
        return this.normalizeAssetSymbol(asset) === target;
      }
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
        return false;
      }
      const record = asset as Record<string, unknown>;
      const candidates = [
        record.symbol,
        record.assetSymbol,
        record.displaySymbol,
        record.label,
        record.id,
        record.asset,
        record.name,
      ];
      return candidates.some((candidate) => this.normalizeAssetSymbol(candidate) === target);
    });
  }

  private readAssetSymbol(value: unknown): string {
    if (typeof value === 'string') {
      return this.normalizeAssetSymbol(value);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return '';
    }

    const record = value as Record<string, unknown>;
    const candidates = [
      record.symbol,
      record.assetSymbol,
      record.displaySymbol,
      record.label,
      record.id,
      record.asset,
      record.name,
    ];
    const match = candidates.map((candidate) => this.normalizeAssetSymbol(candidate)).find(Boolean);

    return match || '';
  }

  private normalizeAssetSymbol(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase();
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

  private parseTemplateDiffSummary(value: unknown): BacktestTemplateDiffSummary | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const summary = value as Record<string, unknown>;
    const changedCount = Number(summary.changedCount);
    const inheritedCount = Number(summary.inheritedCount);
    const changedFields = Array.isArray(summary.changedFields)
      ? summary.changedFields.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (
      !Number.isFinite(changedCount) &&
      !Number.isFinite(inheritedCount) &&
      !changedFields.length
    ) {
      return null;
    }

    return {
      changedCount: Number.isFinite(changedCount)
        ? Math.max(0, Math.trunc(changedCount))
        : changedFields.length,
      inheritedCount: Number.isFinite(inheritedCount) ? Math.max(0, Math.trunc(inheritedCount)) : 0,
      changedFields,
    };
  }
}
