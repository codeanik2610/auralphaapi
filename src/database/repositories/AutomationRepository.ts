import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Automation } from '../entities/Automation';
import { AutomationAlert } from '../entities/AutomationAlert';
import { AutomationEvent } from '../entities/AutomationEvent';
import { extractAutomationLineage } from '../../api/utils/automationLineage';
import { deriveAutomationPersistenceFields } from '../utils/automationPersistence';

const AUTOMATION_DETAIL_ALERT_LIMIT = 10;
const AUTOMATION_DETAIL_EVENT_LIMIT = 10;

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
    const automation = await this.getAutomationCoreById(userId, automationId);

    if (!automation) {
      return null;
    }

    const [events, alerts] = await Promise.all([
      this.automationEventRepository.find({
        where: { automationId: automation.id },
        order: { createdAt: 'DESC' },
        take: AUTOMATION_DETAIL_EVENT_LIMIT,
      }),
      this.automationAlertRepository.find({
        where: { automationId: automation.id },
        order: { createdAt: 'DESC' },
        take: AUTOMATION_DETAIL_ALERT_LIMIT,
      }),
    ]);

    automation.events = events;
    automation.alerts = alerts;

    return automation;
  }

  async getAutomationCoreById(userId: string, automationId: string): Promise<Automation | null> {
    return this.automationRepository.findOne({
      where: { id: automationId, userId },
    });
  }

  async getAutomationByIdAny(automationId: string): Promise<Automation | null> {
    return this.automationRepository.findOne({
      where: { id: automationId },
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
    if (normalizedUserId) {
      const automationIds = await this.automationRepository
        .createQueryBuilder('automation')
        .select('automation.id', 'id')
        .where('automation.userId = :userId', { userId: normalizedUserId })
        .getRawMany<{ id: string }>();

      const ids = automationIds
        .map((row) => this.readString(row?.id))
        .filter((value): value is string => Boolean(value));

      if (!ids.length) {
        return {
          overlapSkips24h: 0,
        };
      }

      const overlapSkips24h = await this.automationEventRepository
        .createQueryBuilder('event')
        .where('event.automationId IN (:...automationIds)', { automationIds: ids })
        .andWhere('event.createdAt >= :since', { since })
        .andWhere('event.type = :type', { type: 'Run skipped' })
        .getCount();

      return {
        overlapSkips24h,
      };
    }

    const overlapSkips24h = await this.automationEventRepository
      .createQueryBuilder('event')
      .where('event.createdAt >= :since', { since })
      .andWhere('event.type = :type', { type: 'Run skipped' })
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
    const persistence = deriveAutomationPersistenceFields({
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
      automationType: persistence.automationType,
      timeZone: payload.timeZone ?? null,
      riskMode: payload.riskMode ?? null,
      schedule: payload.schedule ?? null,
      config: persistence.normalizedConfig,
      searchText: persistence.searchText,
      sourceBacktestId: persistence.sourceBacktestId,
      scopeSymbol: persistence.scopeSymbol,
      scopeTimeframe: persistence.scopeTimeframe,
      sourceTemplateId: persistence.sourceTemplateId,
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
    const persistence = deriveAutomationPersistenceFields(automation);
    automation.automationType = persistence.automationType;
    automation.config = persistence.normalizedConfig;
    automation.searchText = persistence.searchText;
    automation.sourceBacktestId = persistence.sourceBacktestId;
    automation.scopeSymbol = persistence.scopeSymbol;
    automation.scopeTimeframe = persistence.scopeTimeframe;
    automation.sourceTemplateId = persistence.sourceTemplateId;
    return this.automationRepository.save(automation);
  }

  async backfillTradeSuggestionAutomationContracts(): Promise<{
    inspected: number;
    updated: number;
  }> {
    const automations = await this.automationRepository.find();
    let inspected = 0;
    let updated = 0;

    for (const automation of automations) {
      const persistence = deriveAutomationPersistenceFields(automation);
      if (persistence.automationType !== 'trade-suggestion') {
        continue;
      }

      inspected += 1;
      const nextConfig = persistence.normalizedConfig ?? null;
      const changed =
        automation.automationType !== persistence.automationType ||
        JSON.stringify(automation.config ?? null) !== JSON.stringify(nextConfig) ||
        automation.searchText !== persistence.searchText ||
        automation.sourceBacktestId !== persistence.sourceBacktestId ||
        automation.scopeSymbol !== persistence.scopeSymbol ||
        automation.scopeTimeframe !== persistence.scopeTimeframe ||
        automation.sourceTemplateId !== persistence.sourceTemplateId;

      if (!changed) {
        continue;
      }

      automation.automationType = persistence.automationType;
      automation.config = nextConfig;
      automation.searchText = persistence.searchText;
      automation.sourceBacktestId = persistence.sourceBacktestId;
      automation.scopeSymbol = persistence.scopeSymbol;
      automation.scopeTimeframe = persistence.scopeTimeframe;
      automation.sourceTemplateId = persistence.sourceTemplateId;
      await this.automationRepository.save(automation);
      updated += 1;
    }

    return { inspected, updated };
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

}
