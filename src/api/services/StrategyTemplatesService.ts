import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  ImportStrategyTemplateSuggestionBody,
  StrategyTemplateDuplicateBody,
  StrategyTemplateCreateBody,
  StrategyTemplateListResponse,
  StrategyTemplateItem,
  StrategyTemplateStatusUpdateBody,
  StrategyTemplateUpdateBody,
  StrategyTemplateVersionItem,
  StrategyTemplateVersionListResponse,
} from '../contracts/StrategyTemplate';
import { NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  StrategyTemplatesQuery,
  validateStrategyTemplateDuplicateBody,
  validateImportStrategyTemplateSuggestionBody,
  validateStrategyTemplatesQuery,
  validateStrategyTemplateCreateBody,
  validateStrategyTemplateId,
  validateStrategyTemplateStatusUpdateBody,
  validateStrategyTemplateUpdateBody,
} from '../validators/strategy-templates.validator';
import { buildStrategyTemplateAutomationProfile } from '../utils/strategyTemplateAutomation';
import { StrategyTemplate, StrategyTemplateVersion } from '../../database';
import { StrategyTemplateRepository } from '../../database';
import { OperationalEventService } from './OperationalEventService';

@Service()
export class StrategyTemplatesService {
  @Inject(() => StrategyTemplateRepository)
  private strategyTemplateRepository!: StrategyTemplateRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async listStrategyTemplates(userId: string, query: StrategyTemplatesQuery): Promise<ApiSuccessResponse<StrategyTemplateListResponse>> {
    const params = validateStrategyTemplatesQuery(query);
    const { data, total } = await this.strategyTemplateRepository.listStrategyTemplates(userId, params);

    return successResponse({
      items: data.map((item) => this.mapTemplate(item)),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getStrategyTemplateById(userId: string, strategyId: string): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    const validatedId = validateStrategyTemplateId(strategyId);
    const strategy = await this.strategyTemplateRepository.getStrategyTemplateById(userId, validatedId);

    if (!strategy) {
      throw new NotFoundAppError('Strategy template not found');
    }

    return successResponse(this.mapTemplate(strategy));
  }

  async listStrategyTemplateVersions(
    userId: string,
    strategyId: string
  ): Promise<ApiSuccessResponse<StrategyTemplateVersionListResponse>> {
    const validatedId = validateStrategyTemplateId(strategyId);
    const strategy = await this.strategyTemplateRepository.getStrategyTemplateById(userId, validatedId);

    if (!strategy) {
      throw new NotFoundAppError('Strategy template not found');
    }

    const versions = await this.strategyTemplateRepository.listStrategyTemplateVersions(
      userId,
      validatedId
    );

    return successResponse({
      items: versions.map((item) => this.mapTemplateVersion(item)),
      total: versions.length,
    });
  }

  async createStrategyTemplate(
    userId: string,
    body: StrategyTemplateCreateBody
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    const validated = validateStrategyTemplateCreateBody(body);
    const normalized = {
      ...validated,
      config: this.coerceTemplateConfigToPython(validated.config, validated.name),
    };
    try {
      const strategy = await this.strategyTemplateRepository.createStrategyTemplate(userId, normalized);

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template created: ' + strategy.name,
        status: 'Success',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: strategy.id,
        description: 'Strategy template record created',
      });

      return successResponse(this.mapTemplate(strategy));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template creation failed',
        status: 'Failed',
        route: 'Strategy Template',
        stream: 'Definitions',
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Template',
        source: 'strategy-template',
        message: `Strategy template create failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Strategy Template',
      });
      throw error;
    }
  }

  async importStrategyTemplateSuggestion(
    body: ImportStrategyTemplateSuggestionBody
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    const validated = validateImportStrategyTemplateSuggestionBody(body);
    const description = this.buildSuggestionImportDescription(validated);

    return this.createStrategyTemplate(validated.userId, {
      name: validated.suggestedName,
      description,
      status: 'Draft',
      config: validated.suggestedConfig,
    });
  }

  async updateStrategyTemplate(
    userId: string,
    strategyId: string,
    body: StrategyTemplateUpdateBody
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    const validatedId = validateStrategyTemplateId(strategyId);
    const validated = validateStrategyTemplateUpdateBody(body);
    const normalized = {
      ...validated,
      config: validated.config === undefined
        ? undefined
        : this.coerceTemplateConfigToPython(validated.config, validated.name),
    };
    try {
      const strategy = await this.strategyTemplateRepository.updateStrategyTemplate(userId, validatedId, normalized);

      if (!strategy) {
        throw new NotFoundAppError('Strategy template not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template updated: ' + strategy.name,
        status: 'Success',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: strategy.id,
        description: 'Strategy template record updated',
      });

      return successResponse(this.mapTemplate(strategy));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template update failed',
        status: 'Failed',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Template',
        source: 'strategy-template',
        message: `Strategy template update failed (${validatedId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Strategy Template',
      });
      throw error;
    }
  }

  async updateStrategyTemplateStatus(
    userId: string,
    strategyId: string,
    body: StrategyTemplateStatusUpdateBody
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    const validatedId = validateStrategyTemplateId(strategyId);
    const validated = validateStrategyTemplateStatusUpdateBody(body);

    try {
      const strategy = await this.strategyTemplateRepository.updateStrategyTemplateStatus(
        userId,
        validatedId,
        validated
      );

      if (!strategy) {
        throw new NotFoundAppError('Strategy template not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: `Strategy template ${String(validated.status || '').toLowerCase()}: ${strategy.name}`,
        status: 'Success',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: strategy.id,
        description: `Strategy template moved to ${validated.status}`,
      });

      return successResponse(this.mapTemplate(strategy));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template status update failed',
        status: 'Failed',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Template',
        source: 'strategy-template',
        message: `Strategy template status update failed (${validatedId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Strategy Template',
      });
      throw error;
    }
  }

  async duplicateStrategyTemplate(
    userId: string,
    strategyId: string,
    body: StrategyTemplateDuplicateBody
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    const validatedId = validateStrategyTemplateId(strategyId);
    const validated = validateStrategyTemplateDuplicateBody(body);

    try {
      const strategy = await this.strategyTemplateRepository.duplicateStrategyTemplate(
        userId,
        validatedId,
        validated
      );

      if (!strategy) {
        throw new NotFoundAppError('Strategy template not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template duplicated: ' + strategy.name,
        status: 'Success',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: strategy.id,
        description: `Duplicated from template ${validatedId}`,
      });

      return successResponse(this.mapTemplate(strategy));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template duplicate failed',
        status: 'Failed',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Template',
        source: 'strategy-template',
        message: `Strategy template duplicate failed (${validatedId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Strategy Template',
      });
      throw error;
    }
  }

  async deleteStrategyTemplate(userId: string, strategyId: string): Promise<ApiSuccessResponse<{ id: string }>> {
    const validatedId = validateStrategyTemplateId(strategyId);
    try {
      const deleted = await this.strategyTemplateRepository.deleteStrategyTemplate(userId, validatedId);

      if (!deleted) {
        throw new NotFoundAppError('Strategy template not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template deleted: ' + validatedId,
        status: 'Success',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: validatedId,
        description: 'Strategy template record deleted',
      });

      return successResponse({ id: validatedId });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Template',
        title: 'Strategy template delete failed',
        status: 'Failed',
        route: 'Strategy Template',
        stream: 'Definitions',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Template',
        source: 'strategy-template',
        message: `Strategy template delete failed (${validatedId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Strategy Template',
      });
      throw error;
    }
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

  private mapTemplateVersion(version: StrategyTemplateVersion): StrategyTemplateVersionItem {
    return {
      id: version.id,
      strategyId: version.strategyTemplateId,
      name: version.name,
      description: version.description,
      status: version.status as StrategyTemplateItem['status'],
      templateVersion: Number(version.templateVersion || 1),
      changeType: version.changeType,
      config: version.config,
      actorUserId: version.actorUserId,
      createdAt: this.formatDate(version.createdAt),
    };
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

  private coerceTemplateConfigToPython(
    config: Record<string, unknown> | null | undefined,
    name?: string
  ): Record<string, unknown> | null | undefined {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return config;
    }
    const mutable = { ...(config as Record<string, unknown>) };
    const legacyCode =
      typeof mutable.codeDefinition === 'string' ? String(mutable.codeDefinition) : '';
    const authoredCode =
      typeof mutable.authoredCodeDefinition === 'string'
        ? String(mutable.authoredCodeDefinition)
        : '';
    const compiledCode =
      typeof mutable.compiledCodeDefinition === 'string'
        ? String(mutable.compiledCodeDefinition)
        : '';
    const rawCode = authoredCode || legacyCode || compiledCode;
    const authoredCodeTarget = this.normalizeCodeTarget(mutable.authoredCodeTarget);
    const legacyCodeTarget = this.normalizeCodeTarget(mutable.codeTarget);
    const detectedTarget = this.detectCodeTargetFromDefinition(rawCode);
    const effectiveTarget = authoredCodeTarget || detectedTarget || legacyCodeTarget;

    const entryLogic =
      this.cleanText(mutable.entryLogic) ||
      this.extractDslClause(rawCode, ['ENTRY', 'ENTRY_LONG']) ||
      '';
    const exitLogic =
      this.cleanText(mutable.exitLogic) ||
      this.extractDslClause(rawCode, ['EXIT', 'EXIT_LONG']) ||
      '';
    let entryShortLogic =
      this.cleanText(mutable.entryShortLogic) ||
      this.extractDslClause(rawCode, ['ENTRY_SHORT']) ||
      '';
    let exitShortLogic =
      this.cleanText(mutable.exitShortLogic) ||
      this.extractDslClause(rawCode, ['EXIT_SHORT']) ||
      '';
    const market = this.cleanText(mutable.market) || 'crypto-futures';
    const strategyName = name?.trim() || this.cleanText(mutable.name) || 'Strategy Draft';
    const risk =
      mutable.risk && typeof mutable.risk === 'object' && !Array.isArray(mutable.risk)
        ? (mutable.risk as Record<string, unknown>)
        : {};
    const parameters =
      mutable.parameters && typeof mutable.parameters === 'object' && !Array.isArray(mutable.parameters)
        ? (mutable.parameters as Record<string, unknown>)
        : {};
    const filters =
      mutable.filters && typeof mutable.filters === 'object' && !Array.isArray(mutable.filters)
        ? (mutable.filters as Record<string, unknown>)
        : {};
    const maxRisk = this.cleanText(risk.maxRisk ?? risk.max_per_trade);
    const sizingNotes = this.cleanText(risk.sizingNotes);
    const executionRisk = this.extractExecutionRiskFromCodeDefinition(rawCode);
    const signalThreshold = this.cleanText(parameters.signalThreshold ?? parameters.signal_threshold);
    const notes = this.cleanText(mutable.notes);
    const description = this.cleanText(mutable.description);
    const explicitCompiledTarget = this.normalizeCodeTarget(mutable.compiledCodeTarget);
    const resolvedAuthoredTarget = effectiveTarget || (legacyCode ? 'python' : 'dsl');
    const explicitShortEnabled =
      typeof mutable.shortEnabled === 'boolean' ? mutable.shortEnabled : null;

    if (explicitShortEnabled === false) {
      entryShortLogic = '';
      exitShortLogic = '';
    }

    const hasShortLogic =
      explicitShortEnabled === null
        ? Boolean(entryShortLogic || exitShortLogic)
        : explicitShortEnabled;
    const hasStructuredLongLogic = Boolean(entryLogic && exitLogic);
    const generatedPythonDefinition = hasStructuredLongLogic
      ? this.generatePythonFromLogic({
          name: strategyName,
          market,
          entryLogic,
          exitLogic,
          entryShortLogic,
          exitShortLogic,
          maxRisk,
          signalThreshold,
        })
      : '';

    let pythonDefinition = compiledCode || legacyCode;
    if (effectiveTarget === 'python') {
      const preferredPythonSource = authoredCode || compiledCode || legacyCode;
      if (hasStructuredLongLogic) {
        pythonDefinition = generatedPythonDefinition || preferredPythonSource;
      } else if (preferredPythonSource.trim()) {
        pythonDefinition = preferredPythonSource;
      } else {
        pythonDefinition =
          generatedPythonDefinition ||
          this.generatePythonFromLogic({
            name: strategyName,
            market,
            entryLogic,
            exitLogic,
            entryShortLogic,
            exitShortLogic,
            maxRisk,
            signalThreshold,
          });
      }
    } else if (
      effectiveTarget === 'dsl' ||
      effectiveTarget === 'javascript' ||
      this.isDslDefinition(rawCode)
    ) {
      pythonDefinition = this.generatePythonFromLogic({
        name: strategyName,
        market,
        entryLogic,
        exitLogic,
        entryShortLogic,
        exitShortLogic,
        maxRisk,
        signalThreshold,
      });
    }

    const shouldPreserveNonPythonAuthoredSource =
      Boolean(resolvedAuthoredTarget) &&
      resolvedAuthoredTarget !== 'python' &&
      Boolean((authoredCode || rawCode).trim());
    const normalizedAuthoredTarget = shouldPreserveNonPythonAuthoredSource
      ? resolvedAuthoredTarget
      : 'python';
    const normalizedAuthoredDefinition = shouldPreserveNonPythonAuthoredSource
      ? authoredCode || rawCode || pythonDefinition
      : pythonDefinition;

    const normalizedConfig = {
      codeTarget: 'python',
      codeDefinition: pythonDefinition,
      authoredCodeTarget: normalizedAuthoredTarget,
      authoredCodeDefinition: normalizedAuthoredDefinition,
      compiledCodeTarget: explicitCompiledTarget || 'python',
      compiledCodeDefinition: pythonDefinition,
      market,
      entryLogic,
      exitLogic,
      entryShortLogic,
      exitShortLogic,
      shortEnabled: hasShortLogic,
      risk: {
        maxRisk: maxRisk || '',
        sizingNotes: sizingNotes || '',
        ...executionRisk,
      },
      parameters: {
        signalThreshold: signalThreshold || '',
      },
      notes: notes || '',
      filters: {
        useAiFilter: Boolean(filters.useAiFilter),
        useRegimeFilter: Boolean(filters.useRegimeFilter),
        paperTradeFirst: Boolean(filters.paperTradeFirst),
      },
      description: description || '',
    };

    return {
      ...normalizedConfig,
      automationProfile: buildStrategyTemplateAutomationProfile(normalizedConfig),
    };
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
    return `from auralpha import Strategy\n\n\nclass StrategyDraft(Strategy):\n    name = \"${safeName}\"\n    market = \"${safeMarket}\"\n\n    def entry(self, ctx):\n        return ${entryExpr || 'False'}\n\n    def exit(self, ctx):\n        return ${exitExpr || 'False'}\n\n    def entry_short(self, ctx):\n        return ${entryShortExpr || 'False'}\n\n    def exit_short(self, ctx):\n        return ${exitShortExpr || 'False'}\n\n    risk = {\n        \"max_per_trade\": ${maxRisk},\n        \"signal_threshold\": ${signalThreshold},\n    }`;
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

  private extractDslClause(code: string, keywords: string[]): string {
    const value = String(code || '');
    for (const rawLine of value.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      for (const keyword of keywords) {
        if (line.toUpperCase().startsWith(keyword)) {
          const parts = line.split(/\s+/, 2);
          if (parts.length > 1) {
            return parts[1].trim();
          }
        }
      }
    }
    return '';
  }

  private isDslDefinition(code: string): boolean {
    return /^\s*STRATEGY\b/i.test(code || '');
  }

  private detectCodeTargetFromDefinition(code: string): string {
    const trimmed = String(code || '').trim();
    if (!trimmed) return '';
    if (/export\s+default\s+defineStrategy/i.test(trimmed)) return 'javascript';
    if (/^from\s+\w+/i.test(trimmed) || /class\s+\w+\(Strategy\)/i.test(trimmed)) return 'python';
    if (/^STRATEGY\s+/i.test(trimmed)) return 'dsl';
    return '';
  }

  private extractExecutionRiskFromCodeDefinition(codeDefinition: string): Record<string, unknown> {
    if (!String(codeDefinition || '').trim()) {
      return {};
    }

    const riskBlock = this.extractRiskBlock(codeDefinition);
    if (!riskBlock) {
      return {};
    }

    const risk: Record<string, unknown> = {};
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
      risk.stop_loss_pct = stopLoss;
    }
    if (takeProfit !== null) {
      risk.take_profit_pct = takeProfit;
    }

    return risk;
  }

  private extractRiskBlock(codeDefinition: string): string {
    const source = String(codeDefinition || '');
    const match = /\brisk\s*[:=]\s*\{/.exec(source);
    if (!match) {
      return '';
    }

    const openingBraceIndex = source.indexOf('{', match.index);
    if (openingBraceIndex < 0) {
      return '';
    }

    let depth = 0;
    let quote: '"' | "'" | null = null;
    let escaped = false;

    for (let index = openingBraceIndex; index < source.length; index += 1) {
      const char = source[index];

      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
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
          return source.slice(openingBraceIndex + 1, index);
        }
      }
    }

    return '';
  }

  private extractRiskLiteralValue(
    block: string,
    keys: string[]
  ): string | number | boolean | null {
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
        const parsed = this.parseRiskLiteralValue(match[1]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }

    return null;
  }

  private parseRiskLiteralValue(value: string | undefined): string | number | boolean | null {
    const trimmed = String(value || '').trim().replace(/,$/, '');
    if (!trimmed) {
      return null;
    }

    const quoted = trimmed.match(/^['"]([\s\S]*)['"]$/);
    if (quoted) {
      return quoted[1];
    }

    if (/^(true|false)$/i.test(trimmed)) {
      return trimmed.toLowerCase() === 'true';
    }

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    return null;
  }

  private normalizeCodeTarget(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'js' || normalized === 'javascript') return 'javascript';
    if (normalized === 'py' || normalized === 'python') return 'python';
    if (normalized === 'dsl') return 'dsl';
    return '';
  }

  private sanitizeCodeString(value: string): string {
    return String(value || '').trim().replace(/"/g, '\\"');
  }

  private cleanText(value: unknown): string {
    return String(value || '').trim();
  }

  private buildSuggestionImportDescription(input: {
    suggestionId: string;
    templateId: string | null;
    templateName: string | null;
    diffSummary: string;
    reasoning: string;
  }): string {
    const parts = [`Imported from AI Discovery suggestion ${input.suggestionId}`];

    if (input.templateName) {
      parts.push(`Source template: ${input.templateName}`);
    } else if (input.templateId) {
      parts.push(`Source template id: ${input.templateId}`);
    }

    if (input.diffSummary) {
      parts.push(`Change summary: ${input.diffSummary}`);
    }

    if (input.reasoning) {
      parts.push(`Reasoning: ${input.reasoning}`);
    }

    return parts.join(' | ');
  }
}
