import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  StrategyLabBacktestHandoffBody,
  StrategyLabBacktestHandoffResult,
  StrategyLabDraftBody,
  StrategyLabDraftResult,
  StrategyLabMoveToTemplateResult,
  StrategyLabProjectItem,
  StrategyLabProjectsListResult,
  StrategyLabValidationResult,
  StrategyValidationMessage,
} from '../contracts/StrategyLab';
import type { StrategyTemplateItem } from '../contracts/StrategyTemplate';
import type { BacktestTemplateDiffSummary } from '../contracts/Backtest';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import { buildStrategyTemplateAutomationProfile } from '../utils/strategyTemplateAutomation';
import {
  validateStrategyLabBacktestHandoffBody,
  validateStrategyLabDraftBody,
  validateStrategyLabProjectId,
} from '../validators/strategyLab.validator';
import {
  BacktestRepository,
  StrategyLabProject,
  StrategyLabRepository,
  StrategyTemplate,
  StrategyTemplateRepository,
} from '../../database';
import type { StrategyTemplateCreatePayload } from '../../database/repositories/StrategyTemplateRepository';
import { OperationalEventService } from './OperationalEventService';

@Service()
export class StrategyLabService {
  @Inject(() => StrategyLabRepository)
  private strategyLabRepository!: StrategyLabRepository;

  @Inject(() => BacktestRepository)
  private backtestRepository!: BacktestRepository;

  @Inject(() => StrategyTemplateRepository)
  private strategyTemplateRepository!: StrategyTemplateRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async saveStrategyLabDraft(
    userId: string,
    body: StrategyLabDraftBody
  ): Promise<ApiSuccessResponse<StrategyLabDraftResult>> {
    try {
      const validated = validateStrategyLabDraftBody(body);
      const project = await this.strategyLabRepository.saveDraft(userId, validated);
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: `Draft created: ${project.name || project.id}`,
        status: 'Success',
        route: 'Strategy lab',
        stream: 'Drafts',
        related: project.market || undefined,
        referenceId: project.id,
        description: 'Strategy draft created',
      });
      return successResponse({
        message: 'Strategy draft saved',
        project: this.mapProject(project),
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: 'Draft create failed',
        status: 'Failed',
        route: 'Strategy lab',
        stream: 'Drafts',
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy',
        source: 'strategy_lab',
        message: `Strategy draft create failed: ${error instanceof Error ? error.message : String(error)}`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  async listStrategyLabProjects(
    userId: string,
    params: {
      limit?: string;
      offset?: string;
      search?: string;
    } = {}
  ): Promise<ApiSuccessResponse<StrategyLabProjectsListResult>> {
    const parsedLimit = Number.parseInt(String(params.limit || ''), 10);
    const parsedOffset = Number.parseInt(String(params.offset || ''), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 12;
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
    const search =
      typeof params.search === 'string' && params.search.trim().length
        ? params.search.trim()
        : undefined;

    const { items, total } = await this.strategyLabRepository.listProjects(userId, {
      limit,
      offset,
      search
    });

    return successResponse({
      items: items.map((project) => this.mapProject(project)),
      total
    });
  }

  async getStrategyLabProjectById(
    userId: string,
    projectId: string
  ): Promise<ApiSuccessResponse<StrategyLabProjectItem>> {
    const validatedProjectId = validateStrategyLabProjectId(projectId);
    const project = await this.strategyLabRepository.getProjectById(userId, validatedProjectId);

    if (!project) {
      throw new NotFoundAppError('Strategy lab project not found');
    }

    return successResponse(this.mapProject(project));
  }

  async updateStrategyLabProject(
    userId: string,
    projectId: string,
    body: StrategyLabDraftBody
  ): Promise<ApiSuccessResponse<StrategyLabDraftResult>> {
    const validatedProjectId = validateStrategyLabProjectId(projectId);
    try {
      const validated = validateStrategyLabDraftBody(body);
      const project = await this.strategyLabRepository.updateProject(
        userId,
        validatedProjectId,
        validated
      );

      if (!project) {
        throw new NotFoundAppError('Strategy lab project not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: `Draft updated: ${project.name || project.id}`,
        status: 'Success',
        route: 'Strategy lab',
        stream: 'Drafts',
        related: project.market || undefined,
        referenceId: project.id,
        description: 'Strategy draft updated',
      });

      return successResponse({
        message: 'Strategy draft updated',
        project: this.mapProject(project),
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: 'Draft update failed',
        status: 'Failed',
        route: 'Strategy lab',
        stream: 'Drafts',
        referenceId: validatedProjectId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy',
        source: 'strategy_lab',
        message: `Strategy draft update failed (${validatedProjectId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  async moveStrategyLabProjectToTemplate(
    userId: string,
    projectId: string
  ): Promise<ApiSuccessResponse<StrategyLabMoveToTemplateResult>> {
    const validatedProjectId = validateStrategyLabProjectId(projectId);
    try {
      const result = await this.strategyLabRepository.moveProjectToTemplate(
        userId,
        validatedProjectId,
        (project, movedAt) => this.buildTemplatePayloadFromLabProject(project, movedAt)
      );

      if (!result) {
        throw new NotFoundAppError('Strategy lab project not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: result.alreadyMoved
          ? `Draft already moved to template: ${result.project.name || result.project.id}`
          : `Draft moved to template: ${result.project.name || result.project.id}`,
        status: 'Success',
        route: 'Strategy lab',
        stream: 'Templates',
        related: result.project.market || undefined,
        referenceId: result.project.id,
        description: result.alreadyMoved
          ? `Existing template ${result.template.id} returned`
          : `Created strategy template ${result.template.id}`,
      });

      return successResponse({
        message: result.alreadyMoved
          ? 'Strategy draft already moved to template'
          : 'Strategy draft moved to template',
        project: this.mapProject(result.project),
        template: this.mapTemplate(result.template),
        alreadyMoved: result.alreadyMoved,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: 'Move to template failed',
        status: 'Failed',
        route: 'Strategy lab',
        stream: 'Templates',
        referenceId: validatedProjectId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy',
        source: 'strategy_lab',
        message: `Move to template failed (${validatedProjectId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  async validateStrategyLabProject(
    userId: string,
    projectId: string
  ): Promise<ApiSuccessResponse<StrategyLabValidationResult>> {
    const validatedProjectId = validateStrategyLabProjectId(projectId);
    try {
      const project = await this.strategyLabRepository.getProjectById(userId, validatedProjectId);

      if (!project) {
        throw new NotFoundAppError('Strategy lab project not found');
      }

      const validatedAt = new Date();
      const validation = this.runValidation(project, validatedAt);

      await this.strategyLabRepository.updateValidation(
        userId,
        validatedProjectId,
        validation.validationState,
        validation.errors,
        validation.warnings,
        validatedAt
      );

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: `Draft validation ${validation.validationState}: ${project.name || project.id}`,
        status: validation.validationState === 'valid' ? 'Success' : 'Warning',
        route: 'Strategy lab',
        stream: 'Validation',
        related: project.market || undefined,
        referenceId: project.id,
        description: `${validation.errors.length} errors, ${validation.warnings.length} warnings`,
      });

      return successResponse(validation);
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: 'Draft validation failed',
        status: 'Failed',
        route: 'Strategy lab',
        stream: 'Validation',
        referenceId: validatedProjectId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy',
        source: 'strategy_lab',
        message: `Draft validation failed (${validatedProjectId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  async sendStrategyLabToBacktests(
    userId: string,
    body: StrategyLabBacktestHandoffBody = {}
  ): Promise<ApiSuccessResponse<StrategyLabBacktestHandoffResult>> {
    try {
      const validated = validateStrategyLabBacktestHandoffBody(body);
      const project = await this.strategyLabRepository.getProjectById(userId, validated.projectId);

      if (!project) {
        throw new NotFoundAppError('Strategy lab project not found');
      }

      if (project.validationState !== 'valid') {
        const validatedAt = new Date();
        const validation = this.runValidation(project, validatedAt);

        await this.strategyLabRepository.updateValidation(
          userId,
          project.id,
          validation.validationState,
          validation.errors,
          validation.warnings,
          validatedAt
        );

        project.validationState = validation.validationState;
        project.validationErrors =
          validation.errors as unknown as Array<Record<string, unknown>>;
        project.validationWarnings =
          validation.warnings as unknown as Array<Record<string, unknown>>;
        project.lastValidatedAt = validatedAt;

        if (validation.validationState !== 'valid') {
          throw new BadRequestAppError(
            'Strategy project must pass validation before sending to backtests'
          );
        }
      }

      const config =
        project.config && typeof project.config === 'object' && !Array.isArray(project.config)
          ? (project.config as Record<string, unknown>)
          : {};
      const assets = Array.isArray(config.assets) ? config.assets : [];
      const timeframes = Array.isArray(config.timeframes)
        ? config.timeframes
        : project.timeframe
          ? [project.timeframe]
          : [];

      if (!assets.length) {
        throw new BadRequestAppError('Select at least one asset before running a backtest');
      }

      if (!timeframes.length) {
        throw new BadRequestAppError('Select at least one timeframe before running a backtest');
      }

      const templateConfig = {
        ...(config || {}),
        codeTarget: project.codeTarget || config.codeTarget || 'dsl',
        codeDefinition: project.codeDefinition || config.codeDefinition || null,
        market: project.market || config.market || null,
        entryLogic: config.entryLogic || config.entry_logic || null,
        exitLogic: config.exitLogic || config.exit_logic || null,
        shortEnabled:
          typeof config.shortEnabled === 'boolean'
            ? config.shortEnabled
            : Boolean(config.entryShortLogic || config.exitShortLogic),
        entryShortLogic:
          config.entryShortLogic || config.entry_short_logic || null,
        exitShortLogic:
          config.exitShortLogic || config.exit_short_logic || null,
        risk: this.resolveTemplateRiskConfig(project, config),
        parameters: config.parameters || project.parameters || null,
        filters: config.filters || null,
        projectVersion: Number(project.projectVersion || config.projectVersion || 1),
        sourceTemplateId:
          project.sourceTemplateId ||
          (typeof config.sourceTemplateId === 'string' ? config.sourceTemplateId : null),
        sourceTemplateVersion:
          typeof project.sourceTemplateVersion === 'number'
            ? project.sourceTemplateVersion
            : typeof config.sourceTemplateVersion === 'number'
              ? config.sourceTemplateVersion
              : null,
        sourceTemplateName:
          typeof config.sourceTemplateName === 'string' ? config.sourceTemplateName : null,
      };

      const templateId = `lab-${project.id}`;
      const template = {
        id: templateId,
        name: project.name || templateId,
        templateVersion: Number(project.projectVersion || 1),
        sourceTemplateId: templateConfig.sourceTemplateId,
        sourceTemplateVersion: templateConfig.sourceTemplateVersion,
        config: templateConfig,
      };
      const templateDiffSummary = await this.buildTemplateDiffSummary(
        userId,
        project,
        config,
        templateConfig
      );
      const resolvedMarket =
        String(templateConfig.market || project.market || config.market || '').trim() ||
        'crypto-futures';
      const resolvedStart = this.normalizeDateBoundary(
        config.start ?? config.startDate ?? config.from ?? null,
        'start'
      );
      const resolvedEnd = this.normalizeDateBoundary(
        config.end ?? config.endDate ?? config.to ?? null,
        'end'
      );
      const queuedAt = new Date().toISOString();
      const inputSnapshot = {
        sourceType: 'strategy_lab',
        sourceId: project.id,
        projectId: project.id,
        projectVersion: Number(project.projectVersion || 1),
        templateId,
        templateVersion: Number(project.projectVersion || 1),
        template,
        sourceTemplateId: templateConfig.sourceTemplateId,
        sourceTemplateVersion: templateConfig.sourceTemplateVersion,
        sourceTemplateName: templateConfig.sourceTemplateName,
        templateDiffSummary,
        market: resolvedMarket,
        assets,
        timeframes,
        start: resolvedStart,
        end: resolvedEnd,
        queuedAt,
      };

      const primaryAsset =
        assets && Array.isArray(assets)
          ? (assets[0] as Record<string, unknown> | undefined)
          : undefined;
      const rawSymbol = primaryAsset
        ? String(
            primaryAsset['symbol'] ||
              primaryAsset['label'] ||
              primaryAsset['id'] ||
              primaryAsset['asset'] ||
              ''
          ).trim()
        : '';
      const symbol = rawSymbol || (assets.length > 1 ? 'Multi-asset' : 'Unknown');
      const parameterParts = [project.name || 'Strategy Lab', symbol];
      if (timeframes.length) {
        parameterParts.push(timeframes.join(', '));
      }

      const queuedBacktest = await this.backtestRepository.createQueuedBacktest(userId, {
        name: project.name || 'Strategy Lab Draft',
        strategy: template.name,
        symbol,
        parameter: parameterParts.join(' | '),
        status: 'Queued',
        config: {
          source: 'strategy_lab',
          sourceType: 'strategy_lab',
          sourceId: project.id,
          projectId: project.id,
          projectVersion: Number(project.projectVersion || 1),
          templateId,
          templateVersion: Number(project.projectVersion || 1),
          template,
          sourceTemplateId: templateConfig.sourceTemplateId,
          sourceTemplateVersion: templateConfig.sourceTemplateVersion,
          sourceTemplateName: templateConfig.sourceTemplateName,
          templateDiffSummary,
          market: resolvedMarket,
          assets,
          timeframes,
          start: resolvedStart,
          end: resolvedEnd,
          inputSnapshot,
          capturePerformanceSurface: true,
          performanceSurface: null,
        },
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: `Sent to backtests: ${project.name || project.id}`,
        status: 'Success',
        route: 'Strategy lab',
        stream: 'Backtests',
        related: project.market || undefined,
        referenceId: project.id,
        description: 'Project handed off to backtests',
      });

      return successResponse({
        message: 'Strategy sent to backtests',
        projectId: project.id,
        backtestId: queuedBacktest.id,
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy lab',
        title: 'Send to backtests failed',
        status: 'Failed',
        route: 'Strategy lab',
        stream: 'Backtests',
        referenceId: String(body?.projectId || ''),
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy',
        source: 'strategy_lab',
        message: `Send to backtests failed: ${error instanceof Error ? error.message : String(error)}`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  private buildTemplatePayloadFromLabProject(
    project: StrategyLabProject,
    movedAt: Date
  ): StrategyTemplateCreatePayload {
    const config =
      project.config && typeof project.config === 'object' && !Array.isArray(project.config)
        ? (project.config as Record<string, unknown>)
        : {};
    const rawCode = this.cleanText(
      project.codeDefinition ||
        config.codeDefinition ||
        config.authoredCodeDefinition ||
        config.compiledCodeDefinition
    );
    const authoredCodeTarget =
      this.resolveCodeTarget(project.codeTarget || config.authoredCodeTarget || config.codeTarget, rawCode) ||
      'dsl';
    const market =
      this.cleanText(project.market || config.market) || 'crypto-futures';
    const entryLogic =
      this.cleanText(config.entryLogic || config.entry_logic) ||
      this.extractDslClause(rawCode, ['ENTRY', 'ENTRY_LONG']);
    const exitLogic =
      this.cleanText(config.exitLogic || config.exit_logic) ||
      this.extractDslClause(rawCode, ['EXIT', 'EXIT_LONG']);
    const entryShortLogic =
      this.cleanText(config.entryShortLogic || config.entry_short_logic) ||
      this.extractDslClause(rawCode, ['ENTRY_SHORT']);
    const exitShortLogic =
      this.cleanText(config.exitShortLogic || config.exit_short_logic) ||
      this.extractDslClause(rawCode, ['EXIT_SHORT']);
    const shortEnabled =
      typeof config.shortEnabled === 'boolean'
        ? config.shortEnabled
        : Boolean(entryShortLogic || exitShortLogic);
    const risk = this.resolveTemplateRiskConfig(project, config) || {};
    const parameters = {
      ...this.toRecord(project.parameters),
      ...this.toRecord(config.parameters),
    };
    const filters = this.toRecord(config.filters);
    const maxRisk = this.cleanText(risk.maxRisk ?? risk.max_per_trade) || '1.5';
    const signalThreshold =
      this.cleanText(parameters.signalThreshold ?? parameters.signal_threshold) || '0.82';
    const sizingNotes = this.cleanText(risk.sizingNotes);
    const templateName = this.cleanText(project.name) || `Strategy Lab ${project.id}`;
    const description =
      project.description ??
      (typeof config.description === 'string' ? config.description : null);
    const generatedPython = this.generatePythonFromLogic({
      name: templateName,
      market,
      entryLogic,
      exitLogic,
      entryShortLogic: shortEnabled ? entryShortLogic : '',
      exitShortLogic: shortEnabled ? exitShortLogic : '',
      maxRisk,
      signalThreshold,
    });
    const pythonDefinition =
      authoredCodeTarget === 'python' && rawCode ? rawCode : generatedPython;
    const editorMode =
      this.cleanText(config.editorMode) ||
      (authoredCodeTarget === 'python' && !entryLogic && !exitLogic
        ? 'custom-python'
        : 'rule-based');
    const normalizedConfig = {
      codeTarget: 'python',
      codeDefinition: pythonDefinition,
      authoredCodeTarget,
      authoredCodeDefinition: rawCode || pythonDefinition,
      compiledCodeTarget: 'python',
      compiledCodeDefinition: pythonDefinition,
      editorMode,
      market,
      entryLogic,
      exitLogic,
      shortEnabled,
      entryShortLogic: shortEnabled ? entryShortLogic : '',
      exitShortLogic: shortEnabled ? exitShortLogic : '',
      risk: {
        ...risk,
        maxRisk,
        max_per_trade:
          risk.max_per_trade === undefined || risk.max_per_trade === null
            ? maxRisk
            : risk.max_per_trade,
        sizingNotes,
      },
      parameters: {
        ...parameters,
        signalThreshold,
        signal_threshold:
          parameters.signal_threshold === undefined || parameters.signal_threshold === null
            ? signalThreshold
            : parameters.signal_threshold,
      },
      notes: this.cleanText(config.notes),
      filters: {
        useAiFilter: Boolean(filters.useAiFilter),
        useRegimeFilter: Boolean(filters.useRegimeFilter),
        paperTradeFirst: Boolean(filters.paperTradeFirst),
      },
      description: description || '',
      source: 'strategy_lab',
      sourceType: 'strategy_lab',
      sourceProjectId: project.id,
      sourceProjectVersion: Number(project.projectVersion || 1),
      movedFromStrategyLabProjectId: project.id,
      movedFromStrategyLabProjectVersion: Number(project.projectVersion || 1),
      movedToTemplateAt: movedAt.toISOString(),
      sourceTemplateId:
        project.sourceTemplateId ||
        (typeof config.sourceTemplateId === 'string' ? config.sourceTemplateId : null),
      sourceTemplateVersion:
        typeof project.sourceTemplateVersion === 'number'
          ? project.sourceTemplateVersion
          : typeof config.sourceTemplateVersion === 'number'
            ? config.sourceTemplateVersion
            : null,
      sourceTemplateName:
        typeof config.sourceTemplateName === 'string' ? config.sourceTemplateName : null,
    };

    return {
      name: templateName,
      description,
      status: 'Draft',
      config: {
        ...normalizedConfig,
        automationProfile: buildStrategyTemplateAutomationProfile(normalizedConfig),
      },
    };
  }

  private mapTemplate(strategy: StrategyTemplate): StrategyTemplateItem {
    const automationProfile = buildStrategyTemplateAutomationProfile(strategy.config);
    return {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      status: strategy.status as StrategyTemplateItem['status'],
      templateVersion: Number(strategy.templateVersion || 1),
      config: strategy.config,
      automationReady: automationProfile.automationReady,
      automationProfile,
      createdAt: this.formatDate(strategy.createdAt),
      updatedAt: this.formatDate(strategy.updatedAt),
    };
  }

  private normalizeDateBoundary(
    value: unknown,
    boundary: 'start' | 'end'
  ): string | null {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return boundary === 'start'
        ? `${trimmed}T00:00:00.000Z`
        : `${trimmed}T23:59:59.999Z`;
    }
    return trimmed;
  }

  private runValidation(
    project: StrategyLabProject,
    validatedAt: Date
  ): StrategyLabValidationResult {
    const errors: StrategyValidationMessage[] = [];
    const warnings: StrategyValidationMessage[] = [];

    if (project.authoringMode === 'code') {
      const codeTarget = project.codeTarget || 'dsl';
      const code = project.codeDefinition?.trim() || '';
      if (codeTarget === 'dsl') {
        const lines = code
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        const requiredClauses = ['STRATEGY', 'MARKET', 'RISK'];

        requiredClauses.forEach((clause) => {
          if (!lines.some((line) => line.startsWith(`${clause} `))) {
            errors.push({ field: 'codeDefinition', message: `Missing ${clause} clause` });
          }
        });

        const hasEntry = lines.some((line) => line.startsWith('ENTRY ') || line.startsWith('ENTRY_LONG '));
        const hasExit = lines.some((line) => line.startsWith('EXIT ') || line.startsWith('EXIT_LONG '));

        if (!hasEntry) {
          errors.push({ field: 'codeDefinition', message: 'Missing ENTRY or ENTRY_LONG clause' });
        }
        if (!hasExit) {
          errors.push({ field: 'codeDefinition', message: 'Missing EXIT or EXIT_LONG clause' });
        }
      } else if (codeTarget === 'javascript') {
        if (!/export\s+default\s+defineStrategy\s*\(/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'JavaScript strategies must export defineStrategy(...)' });
        }
        if (!/name\s*:\s*['"`].+['"`]/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'JavaScript strategies must define a name' });
        }
        if (!/market\s*:\s*['"`].+['"`]/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'JavaScript strategies must define a market' });
        }
        if (!/(entryLong|entry)\s*\(/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'JavaScript strategies must define an entry(ctx) or entryLong(ctx) block' });
        }
        if (!/(exitLong|exit)\s*\(/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'JavaScript strategies must define an exit(ctx) or exitLong(ctx) block' });
        }
        if (!/risk\s*:\s*\{/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'JavaScript strategies must define a risk block' });
        }
        if (/\b(require|process\.|window\.|document\.|fetch\()/.test(code)) {
          warnings.push({ field: 'codeDefinition', message: 'JavaScript target is validated as a constrained strategy draft; avoid runtime globals and imports until sandbox execution is added.' });
        }
      } else if (codeTarget === 'python') {
        if (!/class\s+\w+\s*\(\s*Strategy\s*\)\s*:/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'Python strategies must define a class that extends Strategy' });
        }
        if (!/name\s*=\s*['"].+['"]/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'Python strategies must define a name' });
        }
        if (!/market\s*=\s*['"].+['"]/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'Python strategies must define a market' });
        }
        if (!/def\s+entry(_long)?\s*\(\s*self\s*,\s*ctx\s*\)\s*:/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'Python strategies must define an entry(self, ctx) or entry_long(self, ctx) method' });
        }
        if (!/def\s+exit(_long)?\s*\(\s*self\s*,\s*ctx\s*\)\s*:/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'Python strategies must define an exit(self, ctx) or exit_long(self, ctx) method' });
        }
        if (!/risk\s*=\s*\{/.test(code)) {
          errors.push({ field: 'codeDefinition', message: 'Python strategies must define a risk mapping' });
        }
        if (/\bimport\s+(os|sys|subprocess|requests)\b/.test(code)) {
          warnings.push({ field: 'codeDefinition', message: 'Python target is validated as a constrained strategy draft; avoid system and network imports until sandbox execution is added.' });
        }
      } else {
        errors.push({ field: 'codeTarget', message: 'Unsupported code target' });
      }
    } else {
      const visual = (project.visualDefinition || project.config || {}) as Record<string, any>;
      const identity = visual.identity || {};
      const market = visual.market || {};
      const entry = visual.entry || {};
      const exit = visual.exit || {};
      const risk = visual.risk || {};
      const filters = visual.filters || {};

      if (!(project.name || identity.name)) {
        errors.push({ field: 'name', message: 'name is required' });
      }
      if (!(project.objective || identity.objective)) {
        errors.push({ field: 'objective', message: 'objective is required' });
      }
      if (!(project.market || market.market)) {
        errors.push({ field: 'market', message: 'market is required' });
      }
      if (!(project.timeframe || market.timeframe)) {
        errors.push({ field: 'timeframe', message: 'timeframe is required' });
      }
      if (!(project.universe || market.universe)) {
        errors.push({ field: 'universe', message: 'universe is required' });
      }
      if (!entry.logic) {
        errors.push({ field: 'entryLogic', message: 'entry logic is required' });
      }
      if (!exit.logic) {
        errors.push({ field: 'exitLogic', message: 'exit logic is required' });
      }
      if (!risk.maxRisk) {
        errors.push({ field: 'maxRisk', message: 'max risk is required' });
      }
      if (filters.useAiFilter && !risk.signalThreshold) {
        errors.push({
          field: 'signalThreshold',
          message: 'signal threshold is required when AI filter is enabled',
        });
      }
    }

    return {
      message: 'Validation completed',
      validationState: errors.length ? 'invalid' : 'valid',
      errors,
      warnings,
      validatedAt: validatedAt.toISOString(),
    };
  }

  private mapProject(project: StrategyLabProject): StrategyLabProjectItem {
    const config =
      project.config && typeof project.config === 'object' && !Array.isArray(project.config)
        ? (project.config as Record<string, unknown>)
        : {};
    const assets = Array.isArray(config.assets) ? (config.assets as Array<Record<string, unknown>>) : null;
    const timeframes = Array.isArray(config.timeframes)
      ? (config.timeframes as string[])
      : project.timeframe
        ? [project.timeframe]
        : null;
    const start = typeof config.start === 'string' ? config.start : null;
    const end = typeof config.end === 'string' ? config.end : null;
    const description =
      project.description ??
      (typeof config.description === 'string' ? config.description : null);

    return {
      id: project.id,
      name: project.name,
      description,
      status: project.status,
      projectVersion: Number(project.projectVersion || config.projectVersion || 1),
      sourceTemplateId:
        project.sourceTemplateId ||
        (typeof config.sourceTemplateId === 'string' ? config.sourceTemplateId : null),
      sourceTemplateVersion:
        typeof project.sourceTemplateVersion === 'number'
          ? project.sourceTemplateVersion
          : typeof config.sourceTemplateVersion === 'number'
            ? config.sourceTemplateVersion
            : null,
      sourceTemplateName:
        typeof config.sourceTemplateName === 'string' ? config.sourceTemplateName : null,
      movedToTemplateId:
        typeof config.movedToTemplateId === 'string' ? config.movedToTemplateId : null,
      movedToTemplateAt:
        typeof config.movedToTemplateAt === 'string' ? config.movedToTemplateAt : null,
      movedToTemplateName:
        typeof config.movedToTemplateName === 'string' ? config.movedToTemplateName : null,
      movedToTemplateVersion:
        typeof config.movedToTemplateVersion === 'number'
          ? config.movedToTemplateVersion
          : null,
      authoringMode: project.authoringMode || 'no_code',
      codeTarget: project.codeTarget,
      visualDefinition:
        project.visualDefinition ||
        ((project.authoringMode || 'no_code') === 'no_code' ? project.config : null),
      config: Object.keys(config).length ? config : null,
      codeDefinition: project.codeDefinition,
      parameters: project.parameters,
      riskConfig: project.riskConfig,
      assets,
      timeframes,
      start,
      end,
      validationState: project.validationState || 'idle',
      validationErrors: (project.validationErrors as StrategyValidationMessage[] | null) || [],
      validationWarnings:
        (project.validationWarnings as StrategyValidationMessage[] | null) || [],
      objective: project.objective,
      market: project.market,
      timeframe: project.timeframe,
      universe: project.universe,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      lastValidatedAt: project.lastValidatedAt?.toISOString() || null,
    };
  }

  private async buildTemplateDiffSummary(
    userId: string,
    project: StrategyLabProject,
    config: Record<string, unknown>,
    templateConfig: Record<string, unknown>
  ): Promise<BacktestTemplateDiffSummary | null> {
    const sourceTemplateId =
      project.sourceTemplateId ||
      (typeof config.sourceTemplateId === 'string' ? config.sourceTemplateId : null);
    if (!sourceTemplateId) {
      return null;
    }

    const sourceTemplate = await this.strategyTemplateRepository.getStrategyTemplateById(
      userId,
      sourceTemplateId
    );
    if (!sourceTemplate) {
      return null;
    }

    const sourceConfig =
      sourceTemplate.config && typeof sourceTemplate.config === 'object' && !Array.isArray(sourceTemplate.config)
        ? (sourceTemplate.config as Record<string, unknown>)
        : {};

    const diffFields = [
      this.compareTemplateField('Name', project.name, sourceTemplate.name),
      this.compareTemplateField(
        'Description',
        project.description ??
          (typeof config.description === 'string' ? config.description : null),
        sourceTemplate.description ??
          (typeof sourceConfig.description === 'string' ? sourceConfig.description : null)
      ),
      this.compareTemplateField(
        'Market',
        project.market || templateConfig.market,
        sourceConfig.market
      ),
      this.compareTemplateField(
        'Code target',
        project.codeTarget || templateConfig.codeTarget,
        sourceConfig.authoredCodeTarget || sourceConfig.codeTarget
      ),
      this.compareTemplateField(
        'Long entry logic',
        templateConfig.entryLogic,
        sourceConfig.entryLogic
      ),
      this.compareTemplateField(
        'Long exit logic',
        templateConfig.exitLogic,
        sourceConfig.exitLogic
      ),
      this.compareTemplateField(
        'Short-side logic',
        this.normalizeCompareValue(templateConfig.shortEnabled),
        this.normalizeCompareValue(
          typeof sourceConfig.shortEnabled === 'boolean'
            ? sourceConfig.shortEnabled
            : Boolean(sourceConfig.entryShortLogic || sourceConfig.exitShortLogic)
        )
      ),
      this.compareTemplateField(
        'Short entry logic',
        templateConfig.entryShortLogic,
        sourceConfig.entryShortLogic
      ),
      this.compareTemplateField(
        'Short exit logic',
        templateConfig.exitShortLogic,
        sourceConfig.exitShortLogic
      ),
      this.compareTemplateField(
        'Max risk',
        this.extractRiskValue(templateConfig.risk, 'maxRisk'),
        this.extractRiskValue(sourceConfig.risk, 'maxRisk')
      ),
      this.compareTemplateField(
        'Signal threshold',
        this.extractParameterValue(templateConfig.parameters, 'signalThreshold'),
        this.extractParameterValue(sourceConfig.parameters, 'signalThreshold')
      ),
      this.compareTemplateField(
        'Sizing notes',
        this.extractRiskValue(templateConfig.risk, 'sizingNotes'),
        this.extractRiskValue(sourceConfig.risk, 'sizingNotes')
      ),
      this.compareTemplateField('Notes', templateConfig.notes, sourceConfig.notes),
      this.compareTemplateField(
        'AI filter',
        this.extractFilterValue(templateConfig.filters, 'useAiFilter'),
        this.extractFilterValue(sourceConfig.filters, 'useAiFilter')
      ),
      this.compareTemplateField(
        'Regime filter',
        this.extractFilterValue(templateConfig.filters, 'useRegimeFilter'),
        this.extractFilterValue(sourceConfig.filters, 'useRegimeFilter')
      ),
      this.compareTemplateField(
        'Paper trade first',
        this.extractFilterValue(templateConfig.filters, 'paperTradeFirst'),
        this.extractFilterValue(sourceConfig.filters, 'paperTradeFirst')
      ),
    ];

    const changedFields = diffFields.filter(Boolean) as string[];
    const totalFields = diffFields.length;
    return {
      changedCount: changedFields.length,
      inheritedCount: Math.max(totalFields - changedFields.length, 0),
      changedFields,
    };
  }

  private compareTemplateField(label: string, currentValue: unknown, sourceValue: unknown): string | null {
    return this.normalizeCompareValue(currentValue) === this.normalizeCompareValue(sourceValue)
      ? null
      : label;
  }

  private normalizeCompareValue(value: unknown): string {
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '';
    }
    return String(value || '').trim();
  }

  private cleanText(value: unknown): string {
    return String(value || '').trim();
  }

  private formatDate(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
      return value;
    }
    if (value && typeof (value as { toISOString?: unknown }).toISOString === 'function') {
      return (value as { toISOString: () => string }).toISOString();
    }
    return new Date().toISOString();
  }

  private extractDslClause(code: string, keywords: string[]): string {
    const value = String(code || '');
    for (const rawLine of value.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      for (const keyword of keywords) {
        const upperLine = line.toUpperCase();
        if (
          upperLine === keyword ||
          upperLine.startsWith(`${keyword} `) ||
          upperLine.startsWith(`${keyword}\t`)
        ) {
          return line.slice(keyword.length).trim();
        }
      }
    }
    return '';
  }

  private generatePythonFromLogic(input: {
    name: string;
    market: string;
    entryLogic: string;
    exitLogic: string;
    entryShortLogic?: string;
    exitShortLogic?: string;
    maxRisk?: string;
    signalThreshold?: string;
  }): string {
    const entryExpr = this.convertDslExpressionToPython(input.entryLogic || '');
    const exitExpr = this.convertDslExpressionToPython(input.exitLogic || '');
    const entryShortExpr = this.convertDslExpressionToPython(input.entryShortLogic || '');
    const exitShortExpr = this.convertDslExpressionToPython(input.exitShortLogic || '');
    const safeName = this.sanitizeCodeString(input.name || 'Strategy Draft');
    const safeMarket = this.sanitizeCodeString(input.market || 'crypto-futures');
    const maxRisk = Number(input.maxRisk || '1.5') || 1.5;
    const signalThreshold = Number(input.signalThreshold || '0.82') || 0.82;
    return `from auralpha import Strategy\n\n\nclass StrategyDraft(Strategy):\n    name = "${safeName}"\n    market = "${safeMarket}"\n\n    def entry(self, ctx):\n        return ${entryExpr || 'False'}\n\n    def exit(self, ctx):\n        return ${exitExpr || 'False'}\n\n    def entry_short(self, ctx):\n        return ${entryShortExpr || 'False'}\n\n    def exit_short(self, ctx):\n        return ${exitShortExpr || 'False'}\n\n    risk = {\n        "max_per_trade": ${maxRisk},\n        "signal_threshold": ${signalThreshold},\n    }`;
  }

  private convertDslExpressionToPython(expression: string): string {
    let expr = String(expression || '').trim();
    if (!expr) return '';
    expr = expr.replace(/\bAND\b/gi, 'and').replace(/\bOR\b/gi, 'or').replace(/\bNOT\b/gi, 'not');
    expr = expr.replace(/ema\((\d+)\)/gi, 'ema(ctx, $1)');
    expr = expr.replace(/rsi\((\d+)\)/gi, 'rsi(ctx, $1)');
    expr = expr.replace(/adx\((\d+)\)/gi, 'adx(ctx, $1)');
    expr = expr.replace(/\b(close|price)\b/gi, 'price(ctx)');
    expr = expr.replace(/\bhigh\b/gi, 'high(ctx)');
    expr = expr.replace(/\blow\b/gi, 'low(ctx)');
    expr = expr.replace(/\bopen\b/gi, 'open(ctx)');
    expr = expr.replace(/\bvolume\b/gi, 'volume(ctx)');
    return expr;
  }

  private sanitizeCodeString(value: string): string {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private extractRiskValue(value: unknown, key: 'maxRisk' | 'sizingNotes'): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const risk = value as Record<string, unknown>;
    if (key === 'maxRisk') {
      return risk.maxRisk ?? risk.max_per_trade ?? null;
    }
    return risk.sizingNotes ?? null;
  }

  private extractParameterValue(value: unknown, _key: 'signalThreshold'): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const parameters = value as Record<string, unknown>;
    return parameters.signalThreshold ?? parameters.signal_threshold ?? null;
  }

  private extractFilterValue(
    value: unknown,
    key: 'useAiFilter' | 'useRegimeFilter' | 'paperTradeFirst'
  ): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return (value as Record<string, unknown>)[key] ?? null;
  }

  private resolveTemplateRiskConfig(
    project: StrategyLabProject,
    config: Record<string, unknown>
  ): Record<string, unknown> | null {
    const baseRisk = {
      ...this.toRecord(config.risk),
      ...this.toRecord(project.riskConfig),
      ...this.toRecord(config.riskConfig),
    };
    const inferredRisk = this.extractExecutionRiskFromCodeDefinition(
      project.codeTarget || config.codeTarget,
      project.codeDefinition || config.codeDefinition
    );
    const resolvedRisk = {
      ...baseRisk,
      ...inferredRisk,
    };

    return Object.keys(resolvedRisk).length ? resolvedRisk : null;
  }

  private extractExecutionRiskFromCodeDefinition(
    codeTarget: unknown,
    codeDefinition: unknown
  ): Record<string, unknown> {
    if (typeof codeDefinition !== 'string' || !codeDefinition.trim()) {
      return {};
    }

    const resolvedCodeTarget = this.resolveCodeTarget(codeTarget, codeDefinition);
    if (!resolvedCodeTarget || !['python', 'javascript'].includes(resolvedCodeTarget)) {
      return {};
    }

    const riskBlock = this.extractRiskBlock(codeDefinition);
    if (!riskBlock) {
      return {};
    }

    const inferredRisk: Record<string, unknown> = {};
    const stopLoss = this.extractRiskLiteralValue(riskBlock, [
      'stop_loss_pct',
      'stopLossPct',
      'stop_loss',
      'stopLoss',
    ]);
    const takeProfit = this.extractRiskLiteralValue(riskBlock, [
      'take_profit_pct',
      'takeProfitPct',
      'take_profit',
      'takeProfit',
    ]);

    if (stopLoss !== null) {
      inferredRisk.stop_loss_pct = stopLoss;
    }
    if (takeProfit !== null) {
      inferredRisk.take_profit_pct = takeProfit;
    }

    return inferredRisk;
  }

  private resolveCodeTarget(codeTarget: unknown, codeDefinition: string): string | null {
    const normalizedCodeTarget = String(codeTarget || '').trim().toLowerCase();
    if (normalizedCodeTarget) {
      return normalizedCodeTarget;
    }

    return /class\s+\w+\s*\(\s*Strategy\s*\)\s*:/.test(codeDefinition) ? 'python' : null;
  }

  private extractRiskBlock(codeDefinition: string): string | null {
    const match = /\brisk\s*[:=]\s*\{/.exec(codeDefinition);
    if (!match) {
      return null;
    }

    const openingBraceIndex = codeDefinition.indexOf('{', match.index);
    if (openingBraceIndex < 0) {
      return null;
    }

    let depth = 0;
    let quote: '"' | "'" | null = null;
    let isEscaped = false;

    for (let index = openingBraceIndex; index < codeDefinition.length; index += 1) {
      const char = codeDefinition[index];

      if (quote) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }
        if (char === '\\') {
          isEscaped = true;
          continue;
        }
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char as '"' | "'";
        continue;
      }

      if (char === '{') {
        depth += 1;
        continue;
      }

      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return codeDefinition.slice(openingBraceIndex + 1, index);
        }
      }
    }

    return null;
  }

  private extractRiskLiteralValue(block: string, keys: string[]): string | number | boolean | null {
    for (const key of keys) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        new RegExp(`["']${escapedKey}["']\\s*:\\s*([^,\\n}]+)`, 'm'),
        new RegExp(`\\b${escapedKey}\\b\\s*:\\s*([^,\\n}]+)`, 'm'),
      ];

      for (const pattern of patterns) {
        const match = pattern.exec(block);
        if (!match) {
          continue;
        }

        const rawValue = match[1]?.trim();
        const parsedValue = this.parseLiteralValue(rawValue);
        if (parsedValue !== null) {
          return parsedValue;
        }
      }
    }

    return null;
  }

  private parseLiteralValue(value: string | undefined): string | number | boolean | null {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim().replace(/,$/, '');
    if (!trimmedValue) {
      return null;
    }

    const quotedMatch = trimmedValue.match(/^['"]([\s\S]*)['"]$/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    if (/^(true|false)$/i.test(trimmedValue)) {
      return trimmedValue.toLowerCase() === 'true';
    }

    if (/^-?\d+(\.\d+)?$/.test(trimmedValue)) {
      return Number(trimmedValue);
    }

    return null;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return { ...(value as Record<string, unknown>) };
  }
}
