import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Automation } from '../entities/Automation';
import { AutomationAlert } from '../entities/AutomationAlert';
import { AutomationEvent } from '../entities/AutomationEvent';
import { extractAutomationLineage } from '../../api/utils/automationLineage';
import { normalizeAutomationConfig, normalizeAutomationType } from '../../api/utils/automationType';

export interface AutomationListQuery {
  limit: number;
  offset: number;
  userId: string;
  status?: string;
  search?: string;
}

export interface AutomationListResult {
  data: Automation[];
  total: number;
}

export interface CreateAutomationPayload {
  userId: string;
  name: string;
  strategy: string;
  broker: string;
  market: string;
  trigger: string;
  status: string;
  automationType?: string | null;
  timeZone?: string | null;
  riskMode?: string | null;
  schedule?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
}

export interface TradeSuggestionAutomationScopeLookup {
  userId: string;
  backtestId: string;
  symbol: string;
  timeframe: string;
}

@Service()
export class AutomationRepository {
  private get automationRepository(): Repository<Automation> {
    return coreDataSource.getRepository(Automation);
  }

  private get automationEventRepository(): Repository<AutomationEvent> {
    return coreDataSource.getRepository(AutomationEvent);
  }

  private get automationAlertRepository(): Repository<AutomationAlert> {
    return coreDataSource.getRepository(AutomationAlert);
  }

  async listAutomations(query: AutomationListQuery): Promise<AutomationListResult> {
    const builder = this.automationRepository
      .createQueryBuilder('automation')
      .where('automation.userId = :userId', { userId: query.userId })
      .orderBy('automation.updatedAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    if (query.status) {
      builder.andWhere('automation.status = :status', { status: query.status });
    }

    if (query.search) {
      const normalizedSearch = this.normalizeSearchQuery(query.search);
      const fullTextSearch = this.buildFullTextBooleanSearch(normalizedSearch);
      const scopeSymbol = this.normalizeAssetSymbol(normalizedSearch);
      const scopeTimeframe = this.normalizeTimeframe(normalizedSearch);
      const scopeReference = this.readString(normalizedSearch);
      const params = {
        searchLike: `%${this.escapeLikePattern(normalizedSearch)}%`,
        scopeSymbol,
        scopeTimeframe,
        scopeReference,
      };
      const clauses = [
        "LOWER(automation.searchText) LIKE :searchLike ESCAPE '\\'",
        'automation.scopeSymbol = :scopeSymbol',
        'automation.scopeTimeframe = :scopeTimeframe',
        'automation.sourceBacktestId = :scopeReference',
        'automation.sourceTemplateId = :scopeReference',
      ];
      if (fullTextSearch) {
        clauses.unshift('MATCH(automation.searchText) AGAINST (:search IN BOOLEAN MODE)');
        Object.assign(params, { search: fullTextSearch });
      }

      builder.andWhere(`(${clauses.join(' OR ')})`, params);
    }

    const [data, total] = await builder.getManyAndCount();
    return { data, total };
  }

  async getAutomationById(userId: string, automationId: string): Promise<Automation | null> {
    return this.automationRepository.findOne({
      where: { id: automationId, userId },
      relations: {
        events: true,
        alerts: true,
      },
      order: {
        events: {
          createdAt: 'DESC',
        },
        alerts: {
          createdAt: 'DESC',
        },
      },
    });
  }

  async getAutomationsSummary(userId?: string | null): Promise<{
    total: number;
    running: number;
    paused: number;
    failed: number;
    draft: number;
    connectedAccounts: number;
  }> {
    const normalizedUserId = this.readString(userId);
    const builder = this.automationRepository
      .createQueryBuilder('automation')
      .select('COUNT(*)', 'total')
      .addSelect(
        "COALESCE(SUM(CASE WHEN automation.status = 'Running' THEN 1 ELSE 0 END), 0)",
        'running'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN automation.status = 'Paused' THEN 1 ELSE 0 END), 0)",
        'paused'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN automation.status = 'Failed' THEN 1 ELSE 0 END), 0)",
        'failed'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN automation.status = 'Draft' THEN 1 ELSE 0 END), 0)",
        'draft'
      )
      .addSelect('COALESCE(SUM(automation.accounts), 0)', 'connectedAccounts');

    if (normalizedUserId) {
      builder.where('automation.userId = :userId', { userId: normalizedUserId });
    }

    const raw = await builder.getRawOne<{
      total?: string | number;
      running?: string | number;
      paused?: string | number;
      failed?: string | number;
      draft?: string | number;
      connectedAccounts?: string | number;
    }>();

    return {
      total: Number(raw?.total ?? 0),
      running: Number(raw?.running ?? 0),
      paused: Number(raw?.paused ?? 0),
      failed: Number(raw?.failed ?? 0),
      draft: Number(raw?.draft ?? 0),
      connectedAccounts: Number(raw?.connectedAccounts ?? 0),
    };
  }

  async getAutomationEventDiagnostics(
    userId: string | null | undefined,
    since: Date
  ): Promise<{
    overlapSkips24h: number;
  }> {
    const normalizedUserId = this.readString(userId);
    const builder = this.automationEventRepository
      .createQueryBuilder('event')
      .innerJoin(Automation, 'automation', 'automation.id = event.automationId')
      .where('event.createdAt >= :since', { since })
      .andWhere('event.type = :type', { type: 'Run skipped' });

    if (normalizedUserId) {
      builder.andWhere('automation.userId = :userId', { userId: normalizedUserId });
    }

    const overlapSkips24h = await builder
      .getCount();

    return {
      overlapSkips24h,
    };
  }

  async updateAutomationStatus(
    userId: string,
    automationId: string,
    status: string,
    nextRun?: Date | null
  ) {
    await this.automationRepository.update(
      { id: automationId, userId },
      {
        status,
        nextRun: nextRun === undefined ? undefined : nextRun,
      }
    );
  }

  async createAutomation(payload: CreateAutomationPayload): Promise<Automation> {
    const indexing = this.buildAutomationIndexFields({
      name: payload.name,
      strategy: payload.strategy,
      broker: payload.broker,
      market: payload.market,
      trigger: payload.trigger,
      status: payload.status,
      automationType: payload.automationType ?? null,
      timeZone: payload.timeZone ?? null,
      config: payload.config ?? null,
    });
    const automation = this.automationRepository.create({
      userId: payload.userId,
      name: payload.name,
      strategy: payload.strategy,
      broker: payload.broker,
      market: payload.market,
      trigger: payload.trigger,
      status: payload.status,
      automationType: payload.automationType ?? null,
      timeZone: payload.timeZone ?? null,
      riskMode: payload.riskMode ?? null,
      schedule: payload.schedule ?? null,
      config: payload.config ?? null,
      searchText: indexing.searchText,
      sourceBacktestId: indexing.sourceBacktestId,
      scopeSymbol: indexing.scopeSymbol,
      scopeTimeframe: indexing.scopeTimeframe,
      sourceTemplateId: indexing.sourceTemplateId,
    });

    return this.automationRepository.save(automation);
  }

  async findTradeSuggestionAutomationByScope(
    scope: TradeSuggestionAutomationScopeLookup
  ): Promise<Automation | null> {
    const userId = this.readString(scope.userId);
    const backtestId = this.readString(scope.backtestId);
    const symbol = this.normalizeAssetSymbol(scope.symbol);
    const timeframe = this.normalizeTimeframe(scope.timeframe);

    if (!userId || !backtestId || !symbol || !timeframe) {
      return null;
    }

    const candidates = await this.automationRepository
      .createQueryBuilder('automation')
      .where('automation.userId = :userId', { userId })
      .andWhere(
        '(automation.automationType IN (:...automationTypes) OR automation.automationType IS NULL)',
        { automationTypes: ['trade-suggestion', 'strategy'] }
      )
      .andWhere('automation.sourceBacktestId = :backtestId', { backtestId })
      .andWhere('automation.scopeSymbol = :scopeSymbol', { scopeSymbol: symbol })
      .andWhere('automation.scopeTimeframe = :scopeTimeframe', { scopeTimeframe: timeframe })
      .orderBy('automation.createdAt', 'DESC')
      .getOne();

    return candidates ?? null;
  }

  async saveAutomation(automation: Automation): Promise<Automation> {
    const indexing = this.buildAutomationIndexFields(automation);
    automation.searchText = indexing.searchText;
    automation.sourceBacktestId = indexing.sourceBacktestId;
    automation.scopeSymbol = indexing.scopeSymbol;
    automation.scopeTimeframe = indexing.scopeTimeframe;
    automation.sourceTemplateId = indexing.sourceTemplateId;
    return this.automationRepository.save(automation);
  }

  async createAutomationEvent(payload: {
    automationId: string;
    type: string;
    entity?: string;
    outcome?: string;
    meta?: Record<string, unknown> | null;
  }): Promise<AutomationEvent> {
    const meta = await this.resolveAutomationMeta(payload.automationId, payload.meta ?? null);
    const event = this.automationEventRepository.create({
      automationId: payload.automationId,
      type: payload.type,
      entity: payload.entity ?? null,
      outcome: payload.outcome ?? null,
      meta,
    });

    return this.automationEventRepository.save(event);
  }

  async createAutomationAlert(payload: {
    automationId: string;
    message: string;
    severity: string;
    status: string;
    meta?: Record<string, unknown> | null;
  }): Promise<AutomationAlert> {
    const meta = await this.resolveAutomationMeta(payload.automationId, payload.meta ?? null);
    const alert = this.automationAlertRepository.create({
      automationId: payload.automationId,
      message: payload.message,
      severity: payload.severity,
      status: payload.status,
      meta,
    });

    return this.automationAlertRepository.save(alert);
  }

  private async resolveAutomationMeta(
    automationId: string,
    existingMeta: Record<string, unknown> | null
  ): Promise<Record<string, unknown> | null> {
    const meta = existingMeta ? { ...existingMeta } : {};
    const hasLineage =
      meta.lineage && typeof meta.lineage === 'object' && !Array.isArray(meta.lineage);

    if (!hasLineage) {
      const automation = await this.automationRepository.findOne({
        where: { id: automationId },
      });
      const lineage = extractAutomationLineage(automation?.config ?? null);
      if (lineage) {
        meta.lineage = lineage;
      }
    }

    return Object.keys(meta).length ? meta : null;
  }

  private buildAutomationIndexFields(value: {
    name?: string | null;
    strategy?: string | null;
    broker?: string | null;
    market?: string | null;
    trigger?: string | null;
    status?: string | null;
    automationType?: string | null;
    timeZone?: string | null;
    config?: unknown;
  }): {
    searchText: string | null;
    sourceBacktestId: string | null;
    scopeSymbol: string | null;
    scopeTimeframe: string | null;
    sourceTemplateId: string | null;
  } {
    const root = this.parseRecord(value.config) ?? {};
    const rootTradeSuggestion = this.parseRecord(root.tradeSuggestion) ?? {};
    const automationType = normalizeAutomationType(value.automationType, root);
    const normalized = normalizeAutomationConfig(automationType, root) ?? root;
    const normalizedRoot = this.parseRecord(normalized) ?? {};
    const tradeSuggestion = this.parseRecord(normalizedRoot.tradeSuggestion) ?? {};
    const setupScope =
      this.parseRecord(tradeSuggestion.setupScope) ??
      this.parseRecord(normalizedRoot.setupScope) ??
      {};
    const lineage = extractAutomationLineage(normalizedRoot);

    const sourceBacktestId =
      this.readString(
        normalizedRoot.backtestId,
        tradeSuggestion.backtestId,
        lineage?.backtestId
      ) ?? null;
    const scopeSymbol =
      this.normalizeAssetSymbol(
        this.readString(tradeSuggestion.symbol, normalizedRoot.symbol, setupScope.symbol)
      ) || null;
    const scopeTimeframe =
      this.normalizeTimeframe(
        this.readString(tradeSuggestion.timeframe, normalizedRoot.timeframe, setupScope.timeframe)
      ) || null;
    const sourceTemplateId =
      this.readString(
        root.sourceTemplateId,
        root.templateId,
        rootTradeSuggestion.sourceTemplateId,
        rootTradeSuggestion.templateId,
        normalizedRoot.sourceTemplateId,
        normalizedRoot.templateId,
        tradeSuggestion.sourceTemplateId,
        tradeSuggestion.templateId,
        lineage?.sourceTemplateId,
        lineage?.templateId
      ) ?? null;

    const searchText = this.buildSearchText([
      value.name,
      value.strategy,
      value.broker,
      value.market,
      value.trigger,
      value.status,
      value.automationType,
      value.timeZone,
      sourceBacktestId,
      sourceTemplateId,
      scopeSymbol,
      scopeTimeframe,
    ]);

    return {
      searchText,
      sourceBacktestId,
      scopeSymbol,
      scopeTimeframe,
      sourceTemplateId,
    };
  }

  private parseRecord(value: unknown): Record<string, unknown> | null {
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

  private readString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private normalizeAssetSymbol(value: unknown): string {
    return String(value || '').trim().toUpperCase();
  }

  private normalizeTimeframe(value: unknown): string {
    return String(value || '').trim().toLowerCase();
  }

  private normalizeSearchQuery(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private escapeLikePattern(value: string): string {
    return String(value || '').replace(/[\\%_]/g, '\\$&');
  }

  private buildFullTextBooleanSearch(value: string): string {
    const tokens = String(value || '')
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9:_-]/gi, '').trim())
      .filter((token) => token.length >= 3);

    return tokens.length ? tokens.map((token) => `+${token}*`).join(' ') : '';
  }

  private buildSearchText(values: Array<unknown>): string | null {
    const normalized = values
      .map((value) => this.readString(value))
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .trim();
    return normalized || null;
  }
}
