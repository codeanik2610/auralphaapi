import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  StrategyLibraryImportBody,
  StrategyLibraryItem,
  StrategyLibraryLatestRun,
  StrategyLibraryListResponse,
  StrategyLibraryRecentRun,
  StrategyLibraryRunBody,
  StrategyLibraryRunResult,
  StrategyLibraryRunsResponse,
  StrategyLibraryStatus,
  StrategyLibraryStatusUpdateBody,
  StrategyLibraryUpdateBody,
} from '../contracts/StrategyLibrary';
import { BadRequestAppError, ConflictAppError, NotFoundAppError } from '../errors/AppError';
import { buildStrategyTemplateAutomationProfile } from '../utils/strategyTemplateAutomation';
import {
  buildStrategyLibraryLifecycle,
  canStrategyLibraryBeEdited,
  canStrategyLibraryRunManually,
  isStrategyLibraryStatusTransitionAllowed,
  normalizeStrategyLibraryStatus,
} from '../utils/strategyLibraryLifecycle';
import { successResponse } from '../utils/response';
import {
  StrategyLibraryQuery,
  StrategyLibrarySort,
  validateStrategyLibraryId,
  validateStrategyLibraryImportBody,
  validateStrategyLibraryQuery,
  validateStrategyLibraryRunBody,
  validateStrategyLibraryRunsQuery,
  validateStrategyLibraryStatusUpdateBody,
  validateStrategyLibraryUpdateBody,
} from '../validators/strategy-library.validator';
import { StrategyLibrary, StrategyTemplate } from '../../database';
import { BacktestRepository, StrategyLibraryRepository, StrategyTemplateRepository } from '../../database';
import { OperationalEventService } from './OperationalEventService';

@Service()
export class StrategyLibraryService {
  @Inject(() => StrategyLibraryRepository)
  private strategyLibraryRepository!: StrategyLibraryRepository;

  @Inject(() => StrategyTemplateRepository)
  private strategyTemplateRepository!: StrategyTemplateRepository;

  @Inject(() => BacktestRepository)
  private backtestRepository!: BacktestRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async listLibrary(
    userId: string,
    query: StrategyLibraryQuery
  ): Promise<ApiSuccessResponse<StrategyLibraryListResponse>> {
    const params = validateStrategyLibraryQuery(query);
    const useDerivedListPipeline = this.shouldUseDerivedListPipeline(params);
    const { data, total } = await this.strategyLibraryRepository.listLibrary(
      userId,
      params,
      { paginate: !useDerivedListPipeline }
    );
    const templateById = await this.getTemplateMap(userId, data);
    const latestRunsByLibraryId = await this.backtestRepository.getLatestStrategyLibraryBacktests(
      userId,
      data.map((item) => item.id)
    );

    const mappedItems = data.map((item) =>
      this.mapLibrary(
        item,
        templateById.get(item.templateId) ?? null,
        latestRunsByLibraryId.get(item.id) ?? null
      )
    );

    if (!useDerivedListPipeline) {
      return successResponse({
        items: mappedItems,
        total,
        limit: params.limit,
        offset: params.offset,
      });
    }

    const filteredItems = this.applyDerivedLibraryFilters(mappedItems, params);
    const sortedItems = this.sortLibraryItems(filteredItems, params.sort);
    const paginatedItems = sortedItems.slice(params.offset, params.offset + params.limit);

    return successResponse({
      items: paginatedItems,
      total: sortedItems.length,
      limit: params.limit,
      offset: params.offset,
    });
  }


  async getLibraryById(userId: string, libraryId: string): Promise<ApiSuccessResponse<StrategyLibraryItem>> {
    const validatedId = validateStrategyLibraryId(libraryId);
    const record = await this.strategyLibraryRepository.getById(userId, validatedId);

    if (!record) {
      throw new NotFoundAppError('Strategy library entry not found');
    }

    const [template, latestRunsByLibraryId] = await Promise.all([
      this.strategyTemplateRepository.getStrategyTemplateById(userId, record.templateId),
      this.backtestRepository.getLatestStrategyLibraryBacktests(userId, [record.id]),
    ]);

    return successResponse(
      this.mapLibrary(
        record,
        template,
        latestRunsByLibraryId.get(record.id) ?? null
      )
    );
  }

  async getLibraryRuns(
    userId: string,
    libraryId: string,
    query: { limit?: string }
  ): Promise<ApiSuccessResponse<StrategyLibraryRunsResponse>> {
    const validatedId = validateStrategyLibraryId(libraryId);
    const params = validateStrategyLibraryRunsQuery(query);
    const record = await this.strategyLibraryRepository.getById(userId, validatedId);

    if (!record) {
      throw new NotFoundAppError('Strategy library entry not found');
    }

    const recentRunsByLibraryId = await this.getRecentRunsByLibraryId(userId, [validatedId], params.limit);
    const recentRuns = this.mapRecentRuns(recentRunsByLibraryId.get(validatedId) ?? []) ?? [];

    return successResponse({
      items: recentRuns,
      limit: params.limit,
    });
  }

  async updateLibrary(
    userId: string,
    libraryId: string,
    body: StrategyLibraryUpdateBody
  ): Promise<ApiSuccessResponse<StrategyLibraryItem>> {
    const validatedId = validateStrategyLibraryId(libraryId);
    const validated = validateStrategyLibraryUpdateBody(body);
    try {
      const existingRecord = await this.strategyLibraryRepository.getById(userId, validatedId);
      if (!existingRecord) {
        throw new NotFoundAppError('Strategy library entry not found');
      }
      this.assertCanEdit(normalizeStrategyLibraryStatus(existingRecord.status));
      if (
        validated.name &&
        this.normalizeLibraryName(validated.name) !== this.normalizeLibraryName(existingRecord.name)
      ) {
        await this.assertNoImportConflict(
          userId,
          existingRecord.templateId,
          validated.name,
          existingRecord.id
        );
      }

      const record = await this.strategyLibraryRepository.updateLibrary(userId, validatedId, validated);

      if (!record) {
        throw new NotFoundAppError('Strategy library entry not found');
      }

      const [template, latestRunsByLibraryId] = await Promise.all([
        this.strategyTemplateRepository.getStrategyTemplateById(userId, record.templateId),
        this.backtestRepository.getLatestStrategyLibraryBacktests(userId, [record.id]),
      ]);

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy library updated: ' + record.name,
        status: 'Success',
        route: 'Strategy Library',
        stream: 'Definitions',
        referenceId: record.id,
        description: 'Strategy library entry updated',
      });

      return successResponse(
        this.mapLibrary(
          record,
          template,
          latestRunsByLibraryId.get(record.id) ?? null
        )
      );
    } catch (error) {
      const mappedError = this.mapPersistenceError(error, validated.name);
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy library update failed',
        status: 'Failed',
        route: 'Strategy Library',
        stream: 'Definitions',
        referenceId: validatedId,
        description: mappedError.message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Library',
        source: 'strategy-library',
        message: `Strategy library update failed (${validatedId}): ${mappedError.message}`,
        route: 'Strategy Library',
      });
      throw mappedError;
    }
  }

  async updateLibraryStatus(
    userId: string,
    libraryId: string,
    body: StrategyLibraryStatusUpdateBody
  ): Promise<ApiSuccessResponse<StrategyLibraryItem>> {
    const validatedId = validateStrategyLibraryId(libraryId);
    const validated = validateStrategyLibraryStatusUpdateBody(body);

    try {
      const existingRecord = await this.strategyLibraryRepository.getById(userId, validatedId);
      if (!existingRecord) {
        throw new NotFoundAppError('Strategy library entry not found');
      }

      const currentStatus = normalizeStrategyLibraryStatus(existingRecord.status);
      if (
        !isStrategyLibraryStatusTransitionAllowed(currentStatus, validated.status)
      ) {
        throw new BadRequestAppError(
          `Strategy library entries cannot move from ${currentStatus} to ${validated.status}`
        );
      }

      const record = await this.strategyLibraryRepository.updateLibraryStatus(
        userId,
        validatedId,
        validated
      );

      if (!record) {
        throw new NotFoundAppError('Strategy library entry not found');
      }

      const [template, latestRunsByLibraryId] = await Promise.all([
        this.strategyTemplateRepository.getStrategyTemplateById(userId, record.templateId),
        this.backtestRepository.getLatestStrategyLibraryBacktests(userId, [record.id]),
      ]);

      if (currentStatus !== validated.status) {
        await this.operationalEventService.logActivity(userId, {
          type: 'Strategy Library',
          title: `Strategy library ${String(validated.status || '').toLowerCase()}: ${record.name}`,
          status: 'Success',
          route: 'Strategy Library',
          stream: 'Definitions',
          referenceId: record.id,
          description: `Strategy library entry moved to ${validated.status}`,
        });
      }

      return successResponse(
        this.mapLibrary(
          record,
          template,
          latestRunsByLibraryId.get(record.id) ?? null
        )
      );
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy library status update failed',
        status: 'Failed',
        route: 'Strategy Library',
        stream: 'Definitions',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Library',
        source: 'strategy-library',
        message: `Strategy library status update failed (${validatedId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Strategy Library',
      });
      throw error;
    }
  }

  async deleteLibrary(userId: string, libraryId: string): Promise<ApiSuccessResponse<{ id: string }>> {
    const validatedId = validateStrategyLibraryId(libraryId);
    try {
      const deleted = await this.strategyLibraryRepository.deleteLibrary(userId, validatedId);

      if (!deleted) {
        throw new NotFoundAppError('Strategy library entry not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy library deleted: ' + validatedId,
        status: 'Success',
        route: 'Strategy Library',
        stream: 'Definitions',
        referenceId: validatedId,
        description: 'Strategy library entry deleted',
      });

      return successResponse({ id: validatedId });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy library delete failed',
        status: 'Failed',
        route: 'Strategy Library',
        stream: 'Definitions',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Library',
        source: 'strategy-library',
        message: `Strategy library delete failed (${validatedId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Strategy Library',
      });
      throw error;
    }
  }

  async importTemplate(
    userId: string,
    body: StrategyLibraryImportBody
  ): Promise<ApiSuccessResponse<StrategyLibraryItem>> {
    const validated = validateStrategyLibraryImportBody(body);
    try {
      const template = await this.strategyTemplateRepository.getStrategyTemplateById(
        userId,
        validated.templateId
      );

      if (!template) {
        throw new NotFoundAppError('Strategy template not found');
      }
      await this.assertNoImportConflict(userId, template.id, validated.name);

      const record = await this.strategyLibraryRepository.createLibrary(userId, {
        templateId: template.id,
        name: validated.name,
        status: validated.status,
        assets: validated.assets,
        timeframes: validated.timeframes,
        overrides: validated.overrides,
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy template imported: ' + record.name,
        status: 'Success',
        route: 'Strategy Library',
        stream: 'Definitions',
        referenceId: record.id,
        description: 'Strategy template imported into library',
      });

      return successResponse(this.mapLibrary(record, template, null));
    } catch (error) {
      const mappedError = this.mapPersistenceError(error, validated.name);
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy template import failed',
        status: 'Failed',
        route: 'Strategy Library',
        stream: 'Definitions',
        description: mappedError.message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Library',
        source: 'strategy-library',
        message: `Strategy template import failed (${validated.templateId}): ${mappedError.message}`,
        route: 'Strategy Library',
      });
      throw mappedError;
    }
  }

  async runLibraryStrategy(
    userId: string,
    libraryId: string,
    body: StrategyLibraryRunBody
  ): Promise<ApiSuccessResponse<StrategyLibraryRunResult>> {
    const validatedId = validateStrategyLibraryId(libraryId);
    const validated = validateStrategyLibraryRunBody(body || {});
    try {
      const record = await this.strategyLibraryRepository.getById(userId, validatedId);

      if (!record) {
        throw new NotFoundAppError('Strategy library entry not found');
      }
      this.assertCanRun(normalizeStrategyLibraryStatus(record.status));

      const template = await this.strategyTemplateRepository.getStrategyTemplateById(
        userId,
        record.templateId
      );

      const resolvedAssets = Array.isArray(validated.assets)
        ? validated.assets
        : Array.isArray(record.assets)
          ? record.assets
          : [];

      const resolvedTimeframes = Array.isArray(validated.timeframes)
        ? validated.timeframes
        : Array.isArray(record.timeframes)
          ? record.timeframes
          : [];

      const resolvedOverrides = validated.overrides ?? record.overrides ?? null;
      const overridesValue =
        resolvedOverrides && typeof resolvedOverrides === 'object'
          ? (resolvedOverrides as Record<string, unknown>)
          : null;
      const rawStart =
        validated.start ??
        (overridesValue?.start as string | undefined) ??
        (overridesValue?.startDate as string | undefined) ??
        (overridesValue?.from as string | undefined) ??
        null;
      const rawEnd =
        validated.end ??
        (overridesValue?.end as string | undefined) ??
        (overridesValue?.endDate as string | undefined) ??
        (overridesValue?.to as string | undefined) ??
        null;
      const resolvedStart = this.normalizeRunBoundary(rawStart, 'start');
      const resolvedEnd = this.normalizeRunBoundary(rawEnd, 'end');

      if (!resolvedAssets.length) {
        throw new BadRequestAppError(
          'Strategy library runs require at least one asset in the saved entry or run request'
        );
      }

      if (!resolvedTimeframes.length) {
        throw new BadRequestAppError(
          'Strategy library runs require at least one timeframe in the saved entry or run request'
        );
      }

      const parsedStart = this.parseRunBoundary(resolvedStart, 'start');
      const parsedEnd = this.parseRunBoundary(resolvedEnd, 'end');

      if (parsedStart && parsedEnd && parsedStart.getTime() > parsedEnd.getTime()) {
        throw new BadRequestAppError('start must be before or equal to end');
      }

      const primaryAsset = resolvedAssets[0] as Record<string, unknown> | undefined;
      const rawSymbol = primaryAsset
        ? String(
            primaryAsset['symbol'] ||
              primaryAsset['label'] ||
              primaryAsset['id'] ||
              ''
          ).trim()
        : '';
      const symbol = rawSymbol || (resolvedAssets.length > 1 ? 'Multi-asset' : 'Unknown');
      const strategyName = template?.name || record.name;
      const parameterParts = [record.name, symbol];
      if (resolvedTimeframes.length) {
        parameterParts.push(resolvedTimeframes.join(', '));
      }
      const templateSnapshot = template
        ? {
            id: template.id,
            name: template.name,
            description: template.description ?? null,
            status: template.status,
            templateVersion: Number(template.templateVersion || 1),
            config: template.config ?? null,
            createdAt: this.formatDate(template.createdAt),
            updatedAt: this.formatDate(template.updatedAt),
          }
        : null;
      const templateConfig =
        templateSnapshot?.config &&
        typeof templateSnapshot.config === 'object' &&
        !Array.isArray(templateSnapshot.config)
          ? (templateSnapshot.config as Record<string, unknown>)
          : {};
      const resolvedMarket =
        String(
          overridesValue?.market ||
            overridesValue?.marketType ||
            templateConfig.market ||
            templateConfig.marketType ||
            ''
        ).trim() || 'crypto-futures';
      const queuedAt = new Date().toISOString();
      const inputSnapshot = {
        sourceType: 'strategy_library',
        sourceId: record.id,
        libraryId: record.id,
        libraryName: record.name,
        libraryStatus: record.status,
        templateId: record.templateId,
        templateName: template?.name ?? null,
        templateVersion: Number(template?.templateVersion || 1),
        template: templateSnapshot,
        market: resolvedMarket,
        assets: resolvedAssets,
        timeframes: resolvedTimeframes,
        overrides: resolvedOverrides,
        start: resolvedStart ?? null,
        end: resolvedEnd ?? null,
        automationId: validated.automationId ?? null,
        automationRunId: validated.automationRunId ?? null,
        queuedAt,
      };

      const queuedBacktest = await this.backtestRepository.createQueuedBacktest(userId, {
        name: record.name,
        strategy: strategyName,
        symbol,
        parameter: parameterParts.join(' | '),
        status: 'Queued',
        config: {
          source: 'strategy_library',
          sourceType: 'strategy_library',
          sourceId: record.id,
          libraryId: record.id,
          libraryName: record.name,
          libraryStatus: record.status,
          templateId: record.templateId,
          templateName: template?.name ?? null,
          templateVersion: Number(template?.templateVersion || 1),
          template: templateSnapshot,
          market: resolvedMarket,
          assets: resolvedAssets,
          timeframes: resolvedTimeframes,
          overrides: resolvedOverrides,
          start: resolvedStart ?? null,
          end: resolvedEnd ?? null,
          automationId: validated.automationId ?? null,
          automationRunId: validated.automationRunId ?? null,
          inputSnapshot,
          capturePerformanceSurface: true,
          performanceSurface: null,
        },
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy run requested: ' + record.name,
        status: 'Success',
        route: 'Strategy Library',
        stream: 'Runs',
        referenceId: record.id,
        description: `Strategy run queued as backtest ${queuedBacktest.id}`,
      });

      return successResponse({
        id: record.id,
        backtestId: queuedBacktest.id,
        status: 'queued',
        message: 'Backtest queued with current configuration',
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Strategy Library',
        title: 'Strategy run request failed',
        status: 'Failed',
        route: 'Strategy Library',
        stream: 'Runs',
        referenceId: validatedId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Strategy Library',
        source: 'strategy-library',
        message: `Strategy run request failed (${validatedId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Strategy Library',
      });
      throw error;
    }
  }

  private async getTemplateMap(
    userId: string,
    records: StrategyLibrary[]
  ): Promise<Map<string, StrategyTemplate>> {
    const templates = await this.strategyTemplateRepository.listStrategyTemplatesByIds(
      userId,
      records.map((record) => record.templateId)
    );
    return new Map(templates.map((template) => [template.id, template]));
  }

  private mapLibrary(
    record: StrategyLibrary,
    template: StrategyTemplate | null,
    latestRun?: {
      backtestId: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    } | null
  ): StrategyLibraryItem {
    const status = normalizeStrategyLibraryStatus(record.status);
    const overrides =
      record.overrides && typeof record.overrides === 'object'
        ? { ...(record.overrides as Record<string, unknown>) }
        : record.overrides;
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      if ('required' in overrides) {
        delete (overrides as Record<string, unknown>).required;
      }
      if ('risk' in overrides) {
        delete (overrides as Record<string, unknown>).risk;
      }
    }
    const automationProfile = buildStrategyTemplateAutomationProfile(template?.config ?? null);
    return {
      id: record.id,
      templateId: record.templateId,
      templateName: template?.name ?? null,
      templateDescription: template?.description ?? null,
      templateStatus: template?.status ?? null,
      templateVersion: template ? Number(template.templateVersion || 1) : null,
      templateType: this.deriveTemplateType(template?.config ?? null),
      templateAutomationReady: automationProfile.automationReady,
      templateAutomationReasons: automationProfile.readinessReasons,
      name: record.name,
      status,
      assets: record.assets,
      timeframes: record.timeframes,
      overrides: overrides || null,
      lifecycle: buildStrategyLibraryLifecycle(status),
      latestRun: this.mapLatestRun(latestRun ?? null),
      createdAt: this.formatDate(record.createdAt),
      updatedAt: this.formatDate(record.updatedAt),
    };
  }

  private mapLatestRun(
    latestRun:
      | {
          backtestId: string;
          status: string;
          createdAt: Date;
          updatedAt: Date;
        }
      | null
  ): StrategyLibraryLatestRun | null {
    if (!latestRun) {
      return null;
    }

    return {
      backtestId: latestRun.backtestId,
      status: latestRun.status,
      createdAt: this.formatDate(latestRun.createdAt),
      updatedAt: this.formatDate(latestRun.updatedAt),
    };
  }

  private mapRecentRuns(
    recentRuns:
      | Array<{
          backtestId: string;
          status: string;
          parameter?: string | null;
          createdAt: Date;
          updatedAt: Date;
        }>
      | null
      | undefined
  ): StrategyLibraryRecentRun[] | undefined {
    if (!Array.isArray(recentRuns)) {
      return undefined;
    }

    return recentRuns.map((run) => ({
      backtestId: run.backtestId,
      status: run.status,
      queuedAt: this.formatDate(run.createdAt),
      completedAt: this.isFinalBacktestStatus(run.status)
        ? this.formatDate(run.updatedAt)
        : null,
      updatedAt: this.formatDate(run.updatedAt),
      parameter:
        typeof run.parameter === 'string' && run.parameter.trim()
          ? run.parameter.trim()
          : null,
    }));
  }

  private async getRecentRunsByLibraryId(
    userId: string,
    libraryIds: string[],
    limit = 5
  ): Promise<
    Map<
      string,
      Array<{
        backtestId: string;
        status: string;
        parameter?: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>
    >
  > {
    if (
      !this.backtestRepository ||
      typeof this.backtestRepository.getRecentStrategyLibraryBacktests !== 'function'
    ) {
      return new Map();
    }

    return this.backtestRepository.getRecentStrategyLibraryBacktests(userId, libraryIds, limit);
  }

  private isFinalBacktestStatus(status: string): boolean {
    const normalized = String(status || '').trim().toLowerCase();
    return !['queued', 'running', 'started', 'processing', 'in_progress', 'in-progress'].includes(
      normalized
    );
  }

  private assertCanEdit(status: StrategyLibraryStatus): void {
    if (!canStrategyLibraryBeEdited(status)) {
      throw new BadRequestAppError(
        'Archived strategy library entries are read-only. Restore the entry before editing it.'
      );
    }
  }

  private assertCanRun(status: StrategyLibraryStatus): void {
    if (!canStrategyLibraryRunManually(status)) {
      throw new BadRequestAppError(
        'Archived strategy library entries cannot be run. Restore the entry before queueing a backtest.'
      );
    }
  }

  private async assertNoImportConflict(
    userId: string,
    templateId: string,
    name: string,
    excludeId?: string
  ): Promise<void> {
    const duplicate = await this.strategyLibraryRepository.findByTemplateAndNormalizedName(
      userId,
      templateId,
      name,
      excludeId
    );

    if (duplicate) {
      throw new ConflictAppError(this.buildDuplicateNameConflictMessage(name));
    }
  }

  private shouldUseDerivedListPipeline(
    params: ReturnType<typeof validateStrategyLibraryQuery>
  ): boolean {
    return Boolean(
      params.scopeReady !== undefined ||
        params.automationReady !== undefined ||
        params.lastRunFailed !== undefined ||
        params.sort !== 'updated_desc'
    );
  }

  private applyDerivedLibraryFilters(
    items: StrategyLibraryItem[],
    params: ReturnType<typeof validateStrategyLibraryQuery>
  ): StrategyLibraryItem[] {
    return items.filter((item) => {
      if (params.scopeReady !== undefined && this.isScopeReady(item) !== params.scopeReady) {
        return false;
      }

      if (
        params.automationReady !== undefined &&
        this.isAutomationReady(item) !== params.automationReady
      ) {
        return false;
      }

      if (
        params.lastRunFailed !== undefined &&
        this.isFailedLatestRun(item?.latestRun?.status) !== params.lastRunFailed
      ) {
        return false;
      }

      return true;
    });
  }

  private sortLibraryItems(
    items: StrategyLibraryItem[],
    sort: StrategyLibrarySort
  ): StrategyLibraryItem[] {
    const sortedItems = [...items];
    sortedItems.sort((left, right) => {
      switch (sort) {
        case 'updated_asc':
          return this.compareIsoDates(left.updatedAt, right.updatedAt, 'asc');
        case 'name_asc':
          return this.compareText(left.name, right.name, 'asc');
        case 'name_desc':
          return this.compareText(left.name, right.name, 'desc');
        case 'latest_run_desc':
          return this.compareLatestRun(left, right, 'desc');
        case 'latest_run_asc':
          return this.compareLatestRun(left, right, 'asc');
        case 'updated_desc':
        default:
          return this.compareIsoDates(left.updatedAt, right.updatedAt, 'desc');
      }
    });
    return sortedItems;
  }

  private compareText(left: string, right: string, direction: 'asc' | 'desc'): number {
    const comparison = String(left || '').localeCompare(String(right || ''), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    return direction === 'asc' ? comparison : comparison * -1;
  }

  private compareIsoDates(
    left: string | null | undefined,
    right: string | null | undefined,
    direction: 'asc' | 'desc'
  ): number {
    const comparison = this.toEpoch(left) - this.toEpoch(right);
    return direction === 'asc' ? comparison : comparison * -1;
  }

  private compareLatestRun(
    left: StrategyLibraryItem,
    right: StrategyLibraryItem,
    direction: 'asc' | 'desc'
  ): number {
    const leftValue = this.toEpoch(left.latestRun?.createdAt ?? null);
    const rightValue = this.toEpoch(right.latestRun?.createdAt ?? null);
    const bothMissing = leftValue === 0 && rightValue === 0;
    if (bothMissing) {
      return this.compareIsoDates(
        left.updatedAt,
        right.updatedAt,
        direction === 'asc' ? 'asc' : 'desc'
      );
    }
    if (leftValue === 0) {
      return 1;
    }
    if (rightValue === 0) {
      return -1;
    }
    const comparison = leftValue - rightValue;
    return direction === 'asc' ? comparison : comparison * -1;
  }

  private toEpoch(value: string | null | undefined): number {
    if (!value) {
      return 0;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  private isScopeReady(item: StrategyLibraryItem): boolean {
    const assetCount = Array.isArray(item.assets) ? item.assets.length : 0;
    const timeframeCount = Array.isArray(item.timeframes) ? item.timeframes.length : 0;
    return assetCount > 0 && timeframeCount > 0;
  }

  private isAutomationReady(item: StrategyLibraryItem): boolean {
    return Boolean(
      item.templateAutomationReady &&
        this.isScopeReady(item) &&
        item.lifecycle?.scheduledSignalsEnabled &&
        !item.lifecycle?.isReadOnly
    );
  }

  private isFailedLatestRun(status: string | null | undefined): boolean {
    return ['failed', 'error', 'cancelled', 'canceled'].includes(
      String(status || '').trim().toLowerCase()
    );
  }

  private normalizeLibraryName(name: string): string {
    return String(name || '').trim().toLowerCase();
  }

  private buildDuplicateNameConflictMessage(name: string): string {
    const attemptedName = String(name || '').trim() || 'the requested name';
    return `Strategy library entry already exists for this template with name "${attemptedName}". Use a different name or update the existing entry.`;
  }

  private mapPersistenceError(error: unknown, name?: string): Error {
    if (
      error instanceof ConflictAppError ||
      error instanceof BadRequestAppError ||
      error instanceof NotFoundAppError
    ) {
      return error;
    }

    if (this.isDuplicateNameConstraintError(error)) {
      return new ConflictAppError(this.buildDuplicateNameConflictMessage(name || ''));
    }

    if (this.isOwnedTemplateConstraintError(error)) {
      return new NotFoundAppError('Strategy template not found');
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private isDuplicateNameConstraintError(error: unknown): boolean {
    return this.matchesConstraintError(error, ['23505', 'ER_DUP_ENTRY'], [
      'uidx_strategy_library_user_template_name_ci',
      'strategy_library_user_template_name_ci',
    ]);
  }

  private isOwnedTemplateConstraintError(error: unknown): boolean {
    return this.matchesConstraintError(error, ['23503'], [
      'fk_strategy_library_user_template_owner',
      'strategy_library_user_template_owner',
    ]);
  }

  private matchesConstraintError(
    error: unknown,
    codes: string[],
    markers: string[]
  ): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = String((error as { code?: string }).code || '').trim();
    if (codes.length && !codes.includes(code)) {
      return false;
    }

    const constraint = String((error as { constraint?: string }).constraint || '').toLowerCase();
    const message = String((error as { message?: string }).message || '').toLowerCase();
    return markers.some((marker) => constraint.includes(marker) || message.includes(marker));
  }

  private normalizeRunBoundary(value: string | null, boundary: 'start' | 'end'): string | null {
    if (!value) {
      return null;
    }

    const trimmed = String(value).trim();
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

  private parseRunBoundary(value: string | null, fieldName: 'start' | 'end'): Date | null {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestAppError(`${fieldName} must be a valid date or datetime string`);
    }

    return parsed;
  }

  private deriveTemplateType(config: Record<string, unknown> | null | undefined): string | null {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return null;
    }

    const entryLogic = String(config.entryLogic || '').trim();
    const exitLogic = String(config.exitLogic || '').trim();
    const editorMode = String(config.editorMode || '').trim();
    const authoredTarget = String(config.authoredCodeTarget || config.codeTarget || '')
      .trim()
      .toLowerCase();
    const compiledTarget = String(config.compiledCodeTarget || '')
      .trim()
      .toLowerCase();
    const codeDefinition = String(
      config.authoredCodeDefinition || config.codeDefinition || config.compiledCodeDefinition || ''
    ).trim();
    const isPythonBackedTemplate =
      (authoredTarget === 'python' || compiledTarget === 'python') && Boolean(codeDefinition);

    if (editorMode === 'custom-python') {
      return 'Custom Python';
    }
    if (isPythonBackedTemplate) {
      return 'Custom Python';
    }
    if (editorMode === 'rule-based') {
      return 'Rule-based';
    }
    if (authoredTarget === 'python' && !entryLogic && !exitLogic && codeDefinition) {
      return 'Custom Python';
    }
    return 'Rule-based';
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
}
