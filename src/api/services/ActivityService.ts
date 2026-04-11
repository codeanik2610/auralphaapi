import { access, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  ActivityActionFilterBody,
  ActivityClusterSummary,
  ActivityDetailItem,
  ActivityExportBody,
  ActivityExportItem,
  ActivityExportListResponse,
  ActivityExportResult,
  ActivityFeedMeta,
  ActivityFeedView,
  ActivityGroupBy,
  ActivityGroupSummary,
  ActivityItem,
  ActivityLinkedEntity,
  ActivityListResponse,
  ActivityReadActionResult,
  ActivityRouteTarget,
  ActivitySavedViewItem,
  ActivitySavedViewListResponse,
  ActivitySaveViewBody,
  ActivityStatusTone,
  ActivitySummary,
} from '../contracts/Activity';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import {
  DEFAULT_TIMEZONE,
  formatDateInTimeZone,
  getTimeZoneWindowStarts,
} from '../utils/timezone';
import { successResponse } from '../utils/response';
import {
  ActivityExportHistoryQuery,
  ActivityQuery,
  ValidatedActivityActionFilterBody,
  ValidatedActivityQuery,
  validateActivityActionFilterBody,
  validateActivityExportHistoryQuery,
  validateActivityExportBody,
  validateActivityId,
  validateActivityQuery,
  validateActivitySaveViewBody,
} from '../validators/activity.validator';
import {
  ActivityExport,
  ActivityExportRepository,
  ActivityLog,
  ActivityRepository,
  ActivitySavedView,
  ActivitySavedViewRepository,
  ActivitySummaryStats,
  AlertRepository,
  AutomationRepository,
  BacktestRepository,
  BrokerAccountRepository,
  ConnectionRepository,
  RiskPolicyRepository,
  SignalRepository,
  StrategyLabRepository,
  StrategyLibraryRepository,
  StrategyTemplateRepository,
  WatchlistRepository,
} from '../../database';
import { env } from '../../env';
import { normalizeActivityStream } from '../../lib/activityEvents';
import { ActivityExportProcessorService } from './ActivityExportProcessorService';
import { OperationalEventService } from './OperationalEventService';
import { UserTimeZoneService } from './UserTimeZoneService';

interface ResolvedActivityFeedRequest {
  query: ValidatedActivityQuery;
  savedViews: ActivitySavedView[];
  appliedSavedView?: ActivitySavedView;
}

interface ResolvedActivityFilterRequest {
  filters: ValidatedActivityActionFilterBody;
  savedViews: ActivitySavedView[];
  appliedSavedView?: ActivitySavedView;
}

interface ResolvedActivityExportRequest {
  scope: string;
  format: 'csv' | 'json';
  fileName: string;
  contentType: string;
  filters: Record<string, string>;
}

export interface ActivityExportDownloadDescriptor {
  filePath: string;
  fileName: string;
  contentType: string;
}

@Service()
export class ActivityService {
  private readonly exportRetentionMs = env.activity.exportRetentionDays * 24 * 60 * 60 * 1000;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => ActivityExportRepository)
  private activityExportRepository!: ActivityExportRepository;

  @Inject(() => ActivitySavedViewRepository)
  private activitySavedViewRepository!: ActivitySavedViewRepository;

  @Inject(() => ActivityExportProcessorService)
  private activityExportProcessorService!: ActivityExportProcessorService;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => ConnectionRepository)
  private connectionRepository!: ConnectionRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => AutomationRepository)
  private automationRepository!: AutomationRepository;

  @Inject(() => SignalRepository)
  private signalRepository!: SignalRepository;

  @Inject(() => BacktestRepository)
  private backtestRepository!: BacktestRepository;

  @Inject(() => WatchlistRepository)
  private watchlistRepository!: WatchlistRepository;

  @Inject(() => StrategyLibraryRepository)
  private strategyLibraryRepository!: StrategyLibraryRepository;

  @Inject(() => StrategyLabRepository)
  private strategyLabRepository!: StrategyLabRepository;

  @Inject(() => StrategyTemplateRepository)
  private strategyTemplateRepository!: StrategyTemplateRepository;

  @Inject(() => RiskPolicyRepository)
  private riskPolicyRepository!: RiskPolicyRepository;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getActivity(userId: string, query: ActivityQuery): Promise<ApiSuccessResponse<ActivityListResponse>> {
    const resolved = await this.resolveActivityFeedRequest(userId, query);
    const feedQuery = resolved.query;
    const filterQuery = this.toActivityFilterQuery(feedQuery);
    const [timeZone, { items, total }, unreadCount] = await Promise.all([
      this.resolveActivityTimeZone(userId),
      this.activityRepository.listActivity(userId, feedQuery),
      this.activityRepository.countUnread
        ? this.activityRepository.countUnread(userId, filterQuery)
        : Promise.resolve(0),
    ]);
    const resolvedUnreadCount =
      unreadCount || (!this.activityRepository.countUnread ? items.filter((item) => !item.readAt).length : unreadCount);

    const mappedItems = items.map((item) => this.mapActivity(item));
    const grouped = this.buildActivityGrouping({
      visibleItems: mappedItems,
      groupingSnapshot: items,
      view: feedQuery.view,
      groupBy: feedQuery.groupBy,
      timeZone,
    });
    const responseItems =
      feedQuery.view === 'clustered'
        ? mappedItems.map((item) => ({
            ...item,
            cluster: grouped.clusterMap.get(item.id),
          }))
        : mappedItems;

    return successResponse({
      items: responseItems,
      total,
      limit: feedQuery.limit,
      offset: feedQuery.offset,
      unreadCount: resolvedUnreadCount,
      groups: feedQuery.view === 'feed' ? undefined : grouped.groups,
      meta: this.buildActivityFeedMeta({
        timeZone,
        query: feedQuery,
        unreadCount: resolvedUnreadCount,
        savedViews: resolved.savedViews,
        activeSavedViewId: resolved.appliedSavedView?.id,
        presentationWindowTruncated: false,
      }),
    });
  }

  async getActivitySummary(userId: string): Promise<ApiSuccessResponse<ActivitySummary>> {
    return successResponse(await this.resolveActivitySummary(userId));
  }

  async getScopedActivitySummary(
    userId: string,
    query: ActivityQuery
  ): Promise<ApiSuccessResponse<ActivitySummary>> {
    const resolved = await this.resolveActivityFeedRequest(userId, query);
    return successResponse(await this.resolveActivitySummary(userId, resolved.query));
  }

  async getActivityById(
    userId: string,
    activityId: string
  ): Promise<ApiSuccessResponse<ActivityDetailItem>> {
    const validatedActivityId = validateActivityId(activityId);
    const item = await this.activityRepository.getActivityById(userId, validatedActivityId);

    if (!item) {
      throw new NotFoundAppError('Activity event not found');
    }

    return successResponse(await this.mapActivityDetail(userId, item));
  }

  async markActivityRead(
    userId: string,
    activityId: string
  ): Promise<ApiSuccessResponse<ActivityReadActionResult>> {
    const validatedActivityId = validateActivityId(activityId);
    const readAt = new Date();
    const updated = await this.activityRepository.markActivityRead(userId, validatedActivityId, readAt);

    if (!updated) {
      throw new NotFoundAppError('Activity event not found');
    }

    const unreadCount = this.activityRepository.countUnread
      ? await this.activityRepository.countUnread(userId)
      : 0;
    return successResponse({
      message: 'Activity marked as read',
      updatedCount: 1,
      unreadCount,
      readAt: readAt.toISOString(),
    });
  }

  async markActivityUnread(
    userId: string,
    activityId: string
  ): Promise<ApiSuccessResponse<ActivityReadActionResult>> {
    const validatedActivityId = validateActivityId(activityId);
    const updated = await this.activityRepository.markActivityUnread(userId, validatedActivityId);

    if (!updated) {
      throw new NotFoundAppError('Activity event not found');
    }

    const unreadCount = this.activityRepository.countUnread
      ? await this.activityRepository.countUnread(userId)
      : 0;
    return successResponse({
      message: 'Activity marked as unread',
      updatedCount: 1,
      unreadCount,
    });
  }

  async markAllActivityRead(
    userId: string,
    filters: ActivityActionFilterBody
  ): Promise<ApiSuccessResponse<ActivityReadActionResult>> {
    const resolved = await this.resolveActivityFilterRequest(userId, filters);
    const readAt = new Date();
    const updatedCount = await this.activityRepository.markAllActivityRead(
      userId,
      this.toActivityFilterQuery(resolved.filters),
      readAt
    );
    const unreadCount = this.activityRepository.countUnread
      ? await this.activityRepository.countUnread(userId)
      : 0;

    return successResponse({
      message:
        updatedCount > 0
          ? `Marked ${updatedCount} activity event${updatedCount === 1 ? '' : 's'} as read`
          : 'No unread activity matched the current filters',
      updatedCount,
      unreadCount,
      readAt: updatedCount > 0 ? readAt.toISOString() : undefined,
    });
  }

  async listActivitySavedViews(
    userId: string
  ): Promise<ApiSuccessResponse<ActivitySavedViewListResponse>> {
    const items = await this.activitySavedViewRepository.listViews(userId);
    return successResponse({
      items: items.map((item) => this.mapSavedView(item)),
      total: items.length,
    });
  }

  async createActivitySavedView(
    userId: string,
    body: ActivitySaveViewBody
  ): Promise<ApiSuccessResponse<ActivitySavedViewItem>> {
    const validated = validateActivitySaveViewBody(body, { requireName: true });
    const created = await this.activitySavedViewRepository.createView({
      userId,
      name: validated.name,
      description: validated.description ?? null,
      isDefault: validated.isDefault,
      view: validated.view,
      groupBy: validated.groupBy ?? null,
      sortBy: validated.sortBy,
      sortOrder: validated.sortOrder,
      readState: validated.readState,
      filters: this.buildSavedViewFilters(validated),
    });

    return successResponse(this.mapSavedView(created));
  }

  async updateActivitySavedView(
    userId: string,
    viewId: string,
    body: ActivitySaveViewBody
  ): Promise<ApiSuccessResponse<ActivitySavedViewItem>> {
    const validatedViewId = validateActivityId(viewId);
    const existing = await this.activitySavedViewRepository.getViewById(userId, validatedViewId);

    if (!existing) {
      throw new NotFoundAppError('Activity saved view not found');
    }

    const validated = validateActivitySaveViewBody(
      {
        name: body.name !== undefined ? body.name : existing.name,
        description: body.description !== undefined ? body.description : existing.description ?? undefined,
        isDefault: body.isDefault !== undefined ? body.isDefault : existing.isDefault,
        view: body.view !== undefined ? body.view : (existing.view as ActivityFeedView),
        groupBy:
          body.groupBy !== undefined
            ? body.groupBy
            : ((existing.groupBy as ActivityGroupBy | null) ?? undefined),
        sortBy:
          body.sortBy !== undefined
            ? body.sortBy
            : (existing.sortBy as ActivitySavedViewItem['sortBy']),
        sortOrder:
          body.sortOrder !== undefined
            ? body.sortOrder
            : (existing.sortOrder as ActivitySavedViewItem['sortOrder']),
        readState:
          body.readState !== undefined
            ? body.readState
            : (existing.readState as ActivitySavedViewItem['readState']),
        type: body.type !== undefined ? body.type : existing.filters?.type,
        status: body.status !== undefined ? body.status : existing.filters?.status,
        search: body.search !== undefined ? body.search : existing.filters?.search,
        stream: body.stream !== undefined ? body.stream : existing.filters?.stream,
        route: body.route !== undefined ? body.route : existing.filters?.route,
        referenceId:
          body.referenceId !== undefined
            ? body.referenceId
            : existing.filters?.referenceId,
        correlationId:
          body.correlationId !== undefined
            ? body.correlationId
            : existing.filters?.correlationId,
        related: body.related !== undefined ? body.related : existing.filters?.related,
      },
      { requireName: true }
    );

    const updated = await this.activitySavedViewRepository.updateView(userId, validatedViewId, {
      name: validated.name,
      description: validated.description ?? null,
      isDefault: validated.isDefault,
      view: validated.view,
      groupBy: validated.groupBy ?? null,
      sortBy: validated.sortBy,
      sortOrder: validated.sortOrder,
      readState: validated.readState,
      filters: this.buildSavedViewFilters(validated),
    });

    if (!updated) {
      throw new NotFoundAppError('Activity saved view not found');
    }

    return successResponse(this.mapSavedView(updated));
  }

  async deleteActivitySavedView(
    userId: string,
    viewId: string
  ): Promise<ApiSuccessResponse<{ message: string }>> {
    const validatedViewId = validateActivityId(viewId);
    const deleted = await this.activitySavedViewRepository.deleteView(userId, validatedViewId);

    if (!deleted) {
      throw new NotFoundAppError('Activity saved view not found');
    }

    return successResponse({ message: 'Activity saved view deleted' });
  }

  async listActivityExports(
    userId: string,
    query: ActivityExportHistoryQuery
  ): Promise<ApiSuccessResponse<ActivityExportListResponse>> {
    const params = validateActivityExportHistoryQuery(query);
    const { items, total } = await this.activityExportRepository.listExports(userId, params);

    return successResponse({
      items: items.map((item) => this.mapActivityExportItem(item)),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getActivityExportById(
    userId: string,
    exportId: string
  ): Promise<ApiSuccessResponse<ActivityExportResult>> {
    const validatedExportId = validateActivityId(exportId);
    const item = await this.activityExportRepository.getExportById(userId, validatedExportId);

    if (!item) {
      throw new NotFoundAppError('Activity export not found');
    }

    return successResponse(
      this.mapActivityExportResult(item, this.buildActivityExportMessage(item))
    );
  }

  async getActivityExportDownload(
    userId: string,
    exportId: string
  ): Promise<ActivityExportDownloadDescriptor> {
    const validatedExportId = validateActivityId(exportId);
    const item = await this.activityExportRepository.getExportById(userId, validatedExportId);

    if (!item) {
      throw new NotFoundAppError('Activity export not found');
    }

    if (item.status !== 'Ready') {
      throw new BadRequestAppError('Activity export is not ready for download');
    }

    const filePath = await this.ensureActivityExportFile(item);
    if (!filePath) {
      throw new NotFoundAppError('Activity export file not found');
    }

    return {
      filePath,
      fileName: item.fileName,
      contentType: item.contentType,
    };
  }

  async exportActivity(
    userId: string,
    body: ActivityExportBody = {}
  ): Promise<ApiSuccessResponse<ActivityExportResult>> {
    let scope = 'all';

    try {
      const resolved = await this.resolveActivityExportRequest(userId, body);
      scope = resolved.scope;
      const exportRecord = await this.activityExportRepository.createExport({
        userId,
        scope: resolved.scope,
        format: resolved.format,
        status: 'Queued',
        fileName: resolved.fileName,
        contentType: resolved.contentType,
        exportedCount: 0,
        filters: resolved.filters,
        content: null,
        expiresAt: null,
      });

      await this.operationalEventService.logActivity(userId, {
        type: 'Activity Export',
        title: `Activity export queued: ${exportRecord.fileName}`,
        status: 'Queued',
        route: 'Activity',
        stream: 'Controls',
        related: exportRecord.scope,
        referenceId: exportRecord.id,
        correlationId: exportRecord.id,
        description: 'Activity export queued for background processing',
      });

      void this.activityExportProcessorService?.processPendingExportsOnce?.();
      return successResponse(this.mapActivityExportResult(exportRecord, 'Activity export queued'));
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Activity Export',
        title: 'Activity export failed',
        status: 'Failed',
        route: 'Activity',
        stream: 'Controls',
        related: scope,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Activity',
        source: 'activity-export',
        message: `Activity export failed (${scope}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Alerts',
      });
      throw error;
    }
  }

  private async resolveActivityFeedRequest(
    userId: string,
    query: ActivityQuery
  ): Promise<ResolvedActivityFeedRequest> {
    const validated = validateActivityQuery(query);
    const savedViews = this.activitySavedViewRepository?.listViews
      ? await this.activitySavedViewRepository.listViews(userId)
      : [];

    let appliedSavedView: ActivitySavedView | undefined;
    if (validated.savedViewId) {
      appliedSavedView = savedViews.find((item) => item.id === validated.savedViewId);
      if (!appliedSavedView) {
        throw new NotFoundAppError('Activity saved view not found');
      }
    } else if (!this.hasExplicitFeedCustomization(query)) {
      appliedSavedView = savedViews.find((item) => item.isDefault);
    }

    return {
      query: appliedSavedView
        ? this.mergeActivityQueryWithSavedView(validated, query, appliedSavedView)
        : {
            ...validated,
            groupBy: this.resolveGroupByForView(validated.view, validated.groupBy),
          },
      savedViews,
      appliedSavedView,
    };
  }

  private async resolveActivityFilterRequest(
    userId: string,
    filters: ActivityActionFilterBody = {}
  ): Promise<ResolvedActivityFilterRequest> {
    const validated = validateActivityActionFilterBody(filters);
    const savedViews = this.activitySavedViewRepository?.listViews
      ? await this.activitySavedViewRepository.listViews(userId)
      : [];

    let appliedSavedView: ActivitySavedView | undefined;
    if (validated.savedViewId) {
      appliedSavedView = savedViews.find((item) => item.id === validated.savedViewId);
      if (!appliedSavedView) {
        throw new NotFoundAppError('Activity saved view not found');
      }
    } else if (!this.hasExplicitActionFilters(filters)) {
      appliedSavedView = savedViews.find((item) => item.isDefault);
    }

    return {
      filters: appliedSavedView
        ? this.mergeActivityFiltersWithSavedView(validated, filters, appliedSavedView)
        : validated,
      savedViews,
      appliedSavedView,
    };
  }

  private async resolveActivityExportRequest(
    userId: string,
    body: ActivityExportBody
  ): Promise<ResolvedActivityExportRequest> {
    const validated = validateActivityExportBody(body);
    const resolvedFilters = await this.resolveActivityFilterRequest(userId, body);
    const { type, status, search, stream, route, referenceId, correlationId, related, readState } =
      resolvedFilters.filters;
    const scopedStream = this.resolveScopedStream(validated.scope, stream);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    return {
      scope: validated.scope,
      format: validated.format,
      fileName: `activity-${validated.scope || 'all'}-${timestamp}.${validated.format}`,
      contentType: validated.format === 'json' ? 'application/json' : 'text/csv',
      filters: this.buildActivityExportFilters(
        {
          type,
          status,
          search,
          stream: scopedStream,
          route,
          referenceId,
          correlationId,
          related,
        },
        validated.scope,
        readState
      ),
    };
  }

  private mapActivity(item: ActivityLog): ActivityItem {
    const normalizedStream = this.normalizeStream(item.stream);
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      actor: item.actor ?? '',
      time: item.createdAt.toISOString(),
      symbol: item.symbol ?? '',
      route: item.route ?? '',
      description: item.description ?? undefined,
      referenceId: item.referenceId ?? undefined,
      correlationId: item.correlationId ?? undefined,
      stream: normalizedStream,
      related: item.related ?? undefined,
      flags: item.flags ?? undefined,
      isRead: Boolean(item.readAt),
      readAt: item.readAt?.toISOString(),
    };
  }

  private async mapActivityDetail(
    userId: string,
    item: ActivityLog
  ): Promise<ActivityDetailItem> {
    const base = this.mapActivity(item);
    const linkedEntity = await this.resolveLinkedEntity(userId, item);
    const routeTargets = this.buildRouteTargets(item, linkedEntity);
    const exportFilters = this.buildActivityExportFiltersFromItem(item);

    return {
      ...base,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      streamKey: this.normalizeStreamKey(item.stream),
      statusTone: this.resolveStatusTone(item.status),
      linkedEntity,
      context: this.buildActivityContext(item, linkedEntity),
      routeTargets,
      exportContext: {
        formats: ['csv', 'json'],
        scope: this.deriveScopeFromActivity(item),
        filters: exportFilters,
        historyPath: '/activity?panel=exports',
      },
    };
  }

  private async resolveActivitySummary(
    userId: string,
    query?: Pick<
      ValidatedActivityQuery,
      | 'type'
      | 'status'
      | 'search'
      | 'stream'
      | 'route'
      | 'referenceId'
      | 'correlationId'
      | 'related'
      | 'readState'
    >
  ): Promise<ActivitySummary> {
    const timeZone = await this.resolveActivityTimeZone(userId);
    const { dayStart, weekStart } = getTimeZoneWindowStarts(new Date(), timeZone);
    const readyExportFilters = query ? this.buildReadyExportMatchFilters(query) : undefined;
    const [stats, exportsReady] = await Promise.all([
      this.activityRepository.getActivitySummary(userId, {
        type: query?.type,
        status: query?.status,
        search: query?.search,
        stream: query?.stream,
        route: query?.route,
        referenceId: query?.referenceId,
        correlationId: query?.correlationId,
        related: query?.related,
        readState: query?.readState,
        dayStart,
        recentStart: weekStart,
      }),
      this.activityExportRepository.countReadyExports(userId, {
        filters: readyExportFilters,
      }),
    ]);

    return this.mapActivitySummary({ ...stats, exportsReady });
  }

  private mapActivitySummary(stats: ActivitySummaryStats & { exportsReady: number }): ActivitySummary {
    return {
      eventsToday: stats.eventsToday,
      successful: stats.successful,
      needsReview: stats.needsReview,
      exportsReady: stats.exportsReady,
      recentEvents: stats.recentEvents,
      executionEvents: stats.executionEvents,
      automationEvents: stats.automationEvents,
      auditPosture: this.resolveAuditPosture(stats),
    };
  }

  private async resolveActivityTimeZone(userId: string): Promise<string> {
    try {
      return (await this.userTimeZoneService?.resolveUserTimeZone?.(userId)) || DEFAULT_TIMEZONE;
    } catch {
      return DEFAULT_TIMEZONE;
    }
  }

  private buildReadyExportMatchFilters(
    query: Pick<
      ValidatedActivityQuery,
      | 'type'
      | 'status'
      | 'search'
      | 'stream'
      | 'route'
      | 'referenceId'
      | 'correlationId'
      | 'related'
      | 'readState'
    >
  ): Record<string, string> | undefined {
    const filters = this.buildActivityExportFilters(
      {
        type: query.type,
        status: query.status,
        search: query.search,
        stream: query.stream,
        route: query.route,
        referenceId: query.referenceId,
        correlationId: query.correlationId,
        related: query.related,
      },
      'all',
      query.readState
    );

    return Object.keys(filters).length ? filters : undefined;
  }

  private buildActivityGrouping(options: {
    visibleItems: ActivityItem[];
    groupingSnapshot: Array<
      Pick<ActivityLog, 'id' | 'createdAt' | 'type' | 'status' | 'route' | 'stream' | 'readAt'>
    >;
    view: ActivityFeedView;
    groupBy?: ActivityGroupBy;
    timeZone: string;
  }): { groups?: ActivityGroupSummary[]; clusterMap: Map<string, ActivityClusterSummary> } {
    const { visibleItems, groupingSnapshot, view, groupBy, timeZone } = options;
    if (view === 'feed') {
      return { clusterMap: new Map() };
    }

    const resolvedGroupBy = groupBy || 'day';
    const visibleItemIds = new Set(visibleItems.map((item) => item.id));
    const buckets = new Map<
      string,
      {
        group: ActivityGroupSummary;
        firstTime: string;
        latestTime: string;
      }
    >();

    for (const item of groupingSnapshot) {
      const { key, label } = this.resolveActivityGroupKey(item, resolvedGroupBy, timeZone);
      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, {
          group: {
            key,
            label,
            count: 1,
            unreadCount: item.readAt ? 0 : 1,
            itemIds: visibleItemIds.has(item.id) ? [item.id] : [],
          },
          firstTime: item.createdAt.toISOString(),
          latestTime: item.createdAt.toISOString(),
        });
        continue;
      }

      existing.group.count += 1;
      existing.group.unreadCount += item.readAt ? 0 : 1;
      if (visibleItemIds.has(item.id)) {
        existing.group.itemIds.push(item.id);
      }
      const itemTime = item.createdAt.toISOString();
      if (itemTime < existing.firstTime) {
        existing.firstTime = itemTime;
      }
      if (itemTime > existing.latestTime) {
        existing.latestTime = itemTime;
      }
    }

    const groupedBuckets = Array.from(buckets.values()).sort((left, right) => {
      if (left.latestTime === right.latestTime) {
        return left.group.label.localeCompare(right.group.label);
      }
      return right.latestTime.localeCompare(left.latestTime);
    });
    const groups = groupedBuckets.map((bucket) => bucket.group);
    const clusterMap = new Map<string, ActivityClusterSummary>();

    for (const bucket of groupedBuckets) {
      const cluster: ActivityClusterSummary = {
        key: bucket.group.key,
        label: bucket.group.label,
        count: bucket.group.count,
        unreadCount: bucket.group.unreadCount,
        firstTime: bucket.firstTime,
        latestTime: bucket.latestTime,
        itemIds: [...bucket.group.itemIds],
      };
      for (const itemId of bucket.group.itemIds) {
        clusterMap.set(itemId, cluster);
      }
    }

    return {
      groups,
      clusterMap,
    };
  }

  private resolveActivityGroupKey(
    item: Pick<ActivityLog, 'createdAt' | 'route' | 'stream' | 'status' | 'type'>,
    groupBy: ActivityGroupBy,
    timeZone: string
  ): { key: string; label: string } {
    if (groupBy === 'day') {
      const dateKey = this.resolveActivityDayGroupKey(item.createdAt, timeZone);
      return {
        key: `day:${dateKey}`,
        label: dateKey,
      };
    }

    const value =
      groupBy === 'route'
        ? item.route || 'Unassigned'
        : groupBy === 'stream'
          ? this.normalizeStream(item.stream) || 'Unassigned'
          : groupBy === 'status'
            ? item.status || 'Unknown'
            : item.type || 'Activity';

    return {
      key: `${groupBy}:${value.toLowerCase()}`,
      label: value,
    };
  }

  private resolveActivityDayGroupKey(date: Date, timeZone: string): string {
    return (
      formatDateInTimeZone(date, timeZone, { includeMs: false })?.slice(0, 10) ||
      date.toISOString().slice(0, 10)
    );
  }

  private buildActivityFeedMeta(options: {
    timeZone: string;
    query: ValidatedActivityQuery;
    unreadCount: number;
    savedViews: ActivitySavedView[];
    activeSavedViewId?: string;
    presentationWindowTruncated: boolean;
  }): ActivityFeedMeta {
    return {
      timeZone: options.timeZone,
      activeSavedViewId: options.activeSavedViewId || undefined,
      view: options.query.view,
      groupBy: options.query.view === 'feed' ? undefined : options.query.groupBy || 'day',
      sortBy: options.query.sortBy,
      sortOrder: options.query.sortOrder,
      readState: options.query.readState,
      unreadCount: options.unreadCount,
      savedViews: options.savedViews.map((item) => this.mapSavedView(item)),
      availableViews: ['feed', 'grouped', 'clustered'],
      availableSorts: ['time', 'status', 'type', 'route', 'stream'],
      availableGroups: ['day', 'route', 'stream', 'status', 'type'],
      presentationWindowTruncated: options.presentationWindowTruncated || undefined,
    };
  }

  private mapSavedView(item: ActivitySavedView): ActivitySavedViewItem {
    return {
      id: item.id,
      name: item.name,
      description: item.description ?? undefined,
      isDefault: item.isDefault,
      view: item.view as ActivityFeedView,
      groupBy: (item.groupBy as ActivityGroupBy | null) ?? undefined,
      sortBy: item.sortBy as ActivitySavedViewItem['sortBy'],
      sortOrder: item.sortOrder as ActivitySavedViewItem['sortOrder'],
      readState: item.readState as ActivitySavedViewItem['readState'],
      filters: item.filters ?? {},
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private buildSavedViewFilters(validated: {
    type?: string;
    status?: string;
    search?: string;
    stream?: string;
    route?: string;
    referenceId?: string;
    correlationId?: string;
    related?: string;
  }): Record<string, string> {
    const filters: Record<string, string> = {};
    if (validated.type) filters.type = validated.type;
    if (validated.status) filters.status = validated.status;
    if (validated.search) filters.search = validated.search;
    if (validated.stream) filters.stream = validated.stream;
    if (validated.route) filters.route = validated.route;
    if (validated.referenceId) filters.referenceId = validated.referenceId;
    if (validated.correlationId) filters.correlationId = validated.correlationId;
    if (validated.related) filters.related = validated.related;
    return filters;
  }

  private buildActivityExportFilters(
    filters: {
      type?: string;
      status?: string;
      search?: string;
      stream?: string;
      route?: string;
      referenceId?: string;
      correlationId?: string;
      related?: string;
    },
    scope: string,
    readState: 'all' | 'read' | 'unread'
  ): Record<string, string> {
    const output: Record<string, string> = {};
    if (filters.type) output.type = filters.type;
    if (filters.status) output.status = filters.status;
    if (filters.search) output.search = filters.search;
    if (filters.stream) output.stream = filters.stream;
    if (filters.route) output.route = filters.route;
    if (filters.referenceId) output.referenceId = filters.referenceId;
    if (filters.correlationId) output.correlationId = filters.correlationId;
    if (filters.related) output.related = filters.related;
    if (scope && scope !== 'all') output.scope = scope;
    if (readState !== 'all') output.readState = readState;
    return output;
  }

  private buildActivityExportFiltersFromItem(item: ActivityLog): Record<string, string> {
    const filters: Record<string, string> = {};
    if (item.referenceId) filters.referenceId = item.referenceId;
    if (item.correlationId) filters.correlationId = item.correlationId;
    if (item.related) filters.related = item.related;
    if (item.route) filters.route = item.route;
    if (item.stream) filters.stream = this.normalizeStreamKey(item.stream) || String(item.stream);
    if (!item.readAt) {
      filters.readState = 'unread';
    }
    return filters;
  }

  private mapActivityExportItem(item: ActivityExport): ActivityExportItem {
    return {
      exportId: item.id,
      scope: item.scope,
      format: item.format as ActivityExportItem['format'],
      status: item.status as ActivityExportItem['status'],
      fileName: item.fileName,
      contentType: item.contentType,
      exportedCount: item.exportedCount,
      createdAt: item.createdAt.toISOString(),
      expiresAt: item.expiresAt?.toISOString(),
      filters: item.filters ?? undefined,
      downloadPath: item.status === 'Ready' ? `/activity/exports/${item.id}/download` : undefined,
      errorMessage: item.errorMessage ?? undefined,
    };
  }

  private mapActivityExportResult(
    item: ActivityExport,
    message: string
  ): ActivityExportResult {
    return {
      ...this.mapActivityExportItem(item),
      message,
    };
  }

  private buildActivityExportMessage(item: ActivityExport): string {
    if (item.status === 'Queued') {
      return 'Activity export queued';
    }
    if (item.status === 'Processing') {
      return 'Activity export is processing';
    }
    if (item.status === 'Failed') {
      return item.errorMessage
        ? `Activity export failed: ${item.errorMessage}`
        : 'Activity export failed';
    }
    return 'Activity export ready';
  }

  private async ensureActivityExportFile(item: ActivityExport): Promise<string | null> {
    if (item.storagePath) {
      try {
        await access(item.storagePath);
        return item.storagePath;
      } catch {
        // Fall through and rebuild or materialize the file on the current node.
      }
    }

    if (item.content) {
      return this.materializeLegacyActivityExportFile(item);
    }

    if (!this.activityExportProcessorService?.rebuildExportFile) {
      return null;
    }

    const rebuilt = await this.activityExportProcessorService.rebuildExportFile({
      id: item.id,
      userId: item.userId,
      scope: item.scope,
      format: item.format,
      fileName: item.fileName,
      filters: item.filters ?? null,
    });

    await this.activityExportRepository.markExportReady?.(item.id, {
      exportedCount: rebuilt.exportedCount,
      storagePath: rebuilt.filePath,
      expiresAt: item.expiresAt ?? new Date(Date.now() + this.exportRetentionMs),
    });

    return rebuilt.filePath;
  }

  private async materializeLegacyActivityExportFile(item: ActivityExport): Promise<string> {
    await mkdir(env.activity.exportStorageDir, { recursive: true });
    const safeFileName = item.fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const filePath = path.join(env.activity.exportStorageDir, `${item.id}-${safeFileName}`);
    await writeFile(filePath, item.content || '', 'utf8');
    await this.activityExportRepository.updateExportStoragePath?.(item.id, filePath);
    return filePath;
  }

  private normalizeStream(value: ActivityLog['stream']): string | undefined {
    return normalizeActivityStream(value) ?? undefined;
  }

  private resolveAuditPosture(stats: ActivitySummaryStats): string {
    if (stats.needsReview > 0) {
      return 'Review needed';
    }
    if (stats.eventsToday > 0) {
      return 'Active';
    }
    if (stats.recentEvents > 0) {
      return 'Recent activity';
    }
    if (stats.totalEvents > 0) {
      return 'Monitored';
    }
    return 'No activity';
  }

  private buildActivityContext(
    item: ActivityLog,
    linkedEntity?: ActivityLinkedEntity
  ): Array<{ label: string; value: string }> {
    const context: Array<{ label: string; value: string }> = [
      { label: 'Status', value: item.status },
      { label: 'Route', value: item.route ?? 'Unassigned' },
      { label: 'Stream', value: this.normalizeStream(item.stream) ?? 'Unassigned' },
      { label: 'Actor', value: item.actor ?? 'System' },
      { label: 'Read state', value: item.readAt ? 'Read' : 'Unread' },
    ];

    if (item.readAt) {
      context.push({ label: 'Read at', value: item.readAt.toISOString() });
    }
    if (item.referenceId) {
      context.push({ label: 'Reference', value: item.referenceId });
    }
    if (item.correlationId) {
      context.push({ label: 'Correlation', value: item.correlationId });
    }
    if (item.related) {
      context.push({ label: 'Related', value: item.related });
    }
    if (linkedEntity?.description) {
      context.push({ label: 'Linked entity', value: linkedEntity.description });
    }
    if (item.description) {
      context.push({ label: 'Description', value: item.description });
    }

    return context;
  }

  private buildRouteTargets(
    item: ActivityLog,
    linkedEntity?: ActivityLinkedEntity
  ): ActivityRouteTarget[] {
    const targets: ActivityRouteTarget[] = [];

    if (linkedEntity?.path) {
      targets.push({
        id: 'entity',
        label: `Open ${linkedEntity.title}`,
        kind: linkedEntity.kind,
        path: linkedEntity.path,
      });
    }

    if (item.referenceId) {
      targets.push({
        id: 'activity-reference',
        label: 'View related activity',
        kind: 'activity',
        path: `/activity?referenceId=${encodeURIComponent(item.referenceId)}`,
      });
    }

    if (item.correlationId) {
      targets.push({
        id: 'activity-correlation',
        label: 'View correlated activity',
        kind: 'activity',
        path: `/activity?correlationId=${encodeURIComponent(item.correlationId)}`,
      });
    }

    if (item.related) {
      targets.push({
        id: 'activity-related',
        label: `View ${item.related} activity`,
        kind: 'activity',
        path: `/activity?related=${encodeURIComponent(item.related)}`,
      });
    }

    if (
      String(item.route || '').trim().toLowerCase() === 'settings' ||
      String(item.related || '').trim().toLowerCase() === 'app_settings'
    ) {
      targets.push({
        id: 'settings-audit',
        label: 'Open settings audit',
        kind: 'audit',
        path: '/settings',
      });
    }

    targets.push({
      id: 'activity-exports',
      label: 'Recent exports',
      kind: 'export',
      path: '/activity?panel=exports',
    });

    return targets;
  }

  private async resolveLinkedEntity(
    userId: string,
    item: ActivityLog
  ): Promise<ActivityLinkedEntity | undefined> {
    const referenceId = this.readNonEmptyString(item.referenceId);
    const route = String(item.route || '').trim().toLowerCase();
    const type = String(item.type || '').trim().toLowerCase();
    const related = this.readNonEmptyString(item.related);

    if (route === 'settings' || related === 'app_settings') {
      return {
        kind: 'settings',
        id: 'app_settings',
        title: 'User settings',
        path: '/settings',
        description: 'Personal preferences and notification controls',
      };
    }

    if (!referenceId) {
      return undefined;
    }

    try {
      if (route === 'alerts' || related === 'alerts') {
        const alert = await this.alertRepository.getAlertById(userId, referenceId);
        if (alert) {
          return {
            kind: 'alert',
            id: alert.id,
            title: alert.message,
            path: `/alerts?selected=${encodeURIComponent(alert.id)}`,
            status: alert.status,
            description: `${alert.severity} severity · ${alert.channel}`,
            updatedAt: alert.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'brokers data') {
        if (type.includes('broker account')) {
          const account = await this.brokerAccountRepository.getBrokerAccountById(
            userId,
            referenceId
          );
          if (account) {
            return {
              kind: 'broker_account',
              id: account.id,
              title: account.accountName,
              path: '/brokers-data',
              status: account.status,
              description: `${account.brokerKey} · ${account.accountKey}`,
              updatedAt: account.updatedAt.toISOString(),
            };
          }
        }

        const connection = await this.connectionRepository.getConnectionById(userId, referenceId);
        if (connection) {
          return {
            kind: 'connection',
            id: connection.id,
            title: connection.name,
            path: '/brokers-data',
            status: connection.status,
            description: `${connection.brokerKey} · ${connection.type}`,
            updatedAt: connection.updatedAt.toISOString(),
          };
        }

        const account = await this.brokerAccountRepository.getBrokerAccountById(userId, referenceId);
        if (account) {
          return {
            kind: 'broker_account',
            id: account.id,
            title: account.accountName,
            path: '/brokers-data',
            status: account.status,
            description: `${account.brokerKey} · ${account.accountKey}`,
            updatedAt: account.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'automations') {
        const automation = await this.automationRepository.getAutomationById(userId, referenceId);
        if (automation) {
          return {
            kind: 'automation',
            id: automation.id,
            title: automation.name,
            path: `/automations?selected=${encodeURIComponent(automation.id)}`,
            status: automation.status,
            description: `${automation.strategy} · ${automation.market}`,
            updatedAt: automation.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'signals') {
        const signal = await this.signalRepository.getSignalById(userId, referenceId);
        if (signal) {
          return {
            kind: 'signal',
            id: signal.id,
            title: signal.symbol,
            path: `/signals?signalId=${encodeURIComponent(signal.id)}`,
            status: signal.status,
            description: `${signal.source} · ${signal.timeframe ?? 'no timeframe'}`,
            updatedAt: signal.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'watchlists') {
        const watchlist = await this.watchlistRepository.getWatchlistById(userId, referenceId);
        if (watchlist) {
          return {
            kind: 'watchlist',
            id: watchlist.id,
            title: watchlist.name,
            path: `/watchlists?search=${encodeURIComponent(watchlist.name)}`,
            status: watchlist.type,
            description: `${watchlist.type} watchlist`,
            updatedAt: watchlist.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'backtests') {
        const backtest = await this.backtestRepository.getBacktestById(userId, referenceId);
        if (backtest) {
          return {
            kind: 'backtest',
            id: backtest.id,
            title: backtest.name,
            path: `/backtests?selected=${encodeURIComponent(backtest.id)}`,
            status: backtest.status,
            description: `${backtest.strategy} · ${backtest.symbol}`,
            updatedAt: backtest.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'risk') {
        const policy = await this.riskPolicyRepository.getPolicyById(userId, referenceId);
        if (policy) {
          return {
            kind: 'risk_policy',
            id: policy.id,
            title: `Risk policy (${policy.scope})`,
            path: '/risk-center',
            status: policy.enabled ? 'Enabled' : 'Disabled',
            description: policy.brokerKey ?? 'User policy',
            updatedAt: policy.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'strategy library') {
        const library = await this.strategyLibraryRepository.getById(userId, referenceId);
        if (library) {
          const template = await this.strategyTemplateRepository.getStrategyTemplateById(
            userId,
            library.templateId
          );
          const descriptionParts = [
            template?.name ? `Imported from ${template.name}` : `Template ${library.templateId}`,
            template?.templateVersion ? `v${template.templateVersion}` : '',
          ].filter(Boolean);
          return {
            kind: 'strategy_library',
            id: library.id,
            title: library.name,
            path: `/strategy-library?selected=${encodeURIComponent(library.id)}`,
            status: library.status,
            description: descriptionParts.join(' · '),
            updatedAt: library.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'strategy lab') {
        const project = await this.strategyLabRepository.getProjectById(userId, referenceId);
        if (project) {
          return {
            kind: 'strategy_lab',
            id: project.id,
            title: project.name,
            path: `/strategy-lab?projectId=${encodeURIComponent(project.id)}`,
            status: project.status,
            description: `${project.market ?? 'unscoped'} · ${project.timeframe ?? 'n/a'}`,
            updatedAt: project.updatedAt.toISOString(),
          };
        }
      }

      if (route === 'strategy' || route === 'strategy templates') {
        const template = await this.strategyTemplateRepository.getStrategyTemplateById(
          userId,
          referenceId
        );
        if (template) {
          return {
            kind: 'strategy_template',
            id: template.id,
            title: template.name,
            path: `/strategy-template?selected=${encodeURIComponent(template.id)}`,
            status: template.status,
            description: `v${template.templateVersion}`,
            updatedAt: template.updatedAt.toISOString(),
          };
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private deriveScopeFromActivity(item: ActivityLog): string {
    const normalized = this.normalizeStreamKey(item.stream);
    return normalized === 'controls' || normalized === 'execution' || normalized === 'automation'
      ? normalized
      : 'all';
  }

  private resolveScopedStream(scope: string, explicitStream?: string): string | undefined {
    if (explicitStream) {
      return explicitStream;
    }
    return scope === 'controls' || scope === 'execution' || scope === 'automation'
      ? scope
      : undefined;
  }

  private resolveStatusTone(status: string): ActivityStatusTone {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'success' || normalized === 'completed' || normalized === 'ready') {
      return 'success';
    }
    if (
      normalized === 'failed' ||
      normalized === 'error' ||
      normalized === 'rejected' ||
      normalized === 'disconnected'
    ) {
      return 'danger';
    }
    if (
      normalized === 'watch' ||
      normalized === 'review' ||
      normalized === 'warning' ||
      normalized === 'needs review'
    ) {
      return 'warning';
    }
    if (normalized === 'queued' || normalized === 'running' || normalized === 'open') {
      return 'info';
    }
    return 'neutral';
  }

  private normalizeStreamKey(value: ActivityLog['stream']): string | undefined {
    const normalized = normalizeActivityStream(value);
    return normalized ? normalized.toLowerCase() : undefined;
  }

  private readNonEmptyString(value: string | null | undefined): string | null {
    const candidate = String(value || '').trim();
    return candidate ? candidate : null;
  }

  private mergeActivityQueryWithSavedView(
    validated: ValidatedActivityQuery,
    rawQuery: ActivityQuery,
    savedView: ActivitySavedView
  ): ValidatedActivityQuery {
    const merged: ValidatedActivityQuery = {
      limit: validated.limit,
      offset: validated.offset,
      type: savedView.filters?.type,
      status: savedView.filters?.status,
      search: savedView.filters?.search,
      stream: savedView.filters?.stream,
      route: savedView.filters?.route,
      referenceId: savedView.filters?.referenceId,
      correlationId: savedView.filters?.correlationId,
      related: savedView.filters?.related,
      sortBy: savedView.sortBy as ValidatedActivityQuery['sortBy'],
      sortOrder: savedView.sortOrder as ValidatedActivityQuery['sortOrder'],
      view: savedView.view as ValidatedActivityQuery['view'],
      groupBy: this.resolveGroupByForView(
        savedView.view as ValidatedActivityQuery['view'],
        (savedView.groupBy as ValidatedActivityQuery['groupBy']) ?? undefined
      ),
      readState: savedView.readState as ValidatedActivityQuery['readState'],
      savedViewId: savedView.id,
    };

    const explicitOverrides: Partial<ValidatedActivityQuery> = {};
    if (rawQuery.type !== undefined) explicitOverrides.type = validated.type;
    if (rawQuery.status !== undefined) explicitOverrides.status = validated.status;
    if (rawQuery.search !== undefined) explicitOverrides.search = validated.search;
    if (rawQuery.stream !== undefined) explicitOverrides.stream = validated.stream;
    if (rawQuery.route !== undefined) explicitOverrides.route = validated.route;
    if (rawQuery.referenceId !== undefined) explicitOverrides.referenceId = validated.referenceId;
    if (rawQuery.correlationId !== undefined)
      explicitOverrides.correlationId = validated.correlationId;
    if (rawQuery.related !== undefined) explicitOverrides.related = validated.related;
    if (rawQuery.sortBy !== undefined) explicitOverrides.sortBy = validated.sortBy;
    if (rawQuery.sortOrder !== undefined) explicitOverrides.sortOrder = validated.sortOrder;
    if (rawQuery.view !== undefined) explicitOverrides.view = validated.view;
    if (rawQuery.groupBy !== undefined) explicitOverrides.groupBy = validated.groupBy;
    if (rawQuery.readState !== undefined) explicitOverrides.readState = validated.readState;

    const resolvedView = explicitOverrides.view ?? merged.view;
    return {
      ...merged,
      ...explicitOverrides,
      limit: validated.limit,
      offset: validated.offset,
      savedViewId: savedView.id,
      groupBy: this.resolveGroupByForView(
        resolvedView,
        explicitOverrides.groupBy ?? merged.groupBy
      ),
    };
  }

  private mergeActivityFiltersWithSavedView(
    validated: ValidatedActivityActionFilterBody,
    rawFilters: ActivityActionFilterBody,
    savedView: ActivitySavedView
  ): ValidatedActivityActionFilterBody {
    const merged: ValidatedActivityActionFilterBody = {
      type: savedView.filters?.type,
      status: savedView.filters?.status,
      search: savedView.filters?.search,
      stream: savedView.filters?.stream,
      route: savedView.filters?.route,
      referenceId: savedView.filters?.referenceId,
      correlationId: savedView.filters?.correlationId,
      related: savedView.filters?.related,
      readState: savedView.readState as ValidatedActivityActionFilterBody['readState'],
      savedViewId: savedView.id,
    };

    const explicitOverrides: Partial<ValidatedActivityActionFilterBody> = {};
    if (rawFilters.type !== undefined) explicitOverrides.type = validated.type;
    if (rawFilters.status !== undefined) explicitOverrides.status = validated.status;
    if (rawFilters.search !== undefined) explicitOverrides.search = validated.search;
    if (rawFilters.stream !== undefined) explicitOverrides.stream = validated.stream;
    if (rawFilters.route !== undefined) explicitOverrides.route = validated.route;
    if (rawFilters.referenceId !== undefined) explicitOverrides.referenceId = validated.referenceId;
    if (rawFilters.correlationId !== undefined) {
      explicitOverrides.correlationId = validated.correlationId;
    }
    if (rawFilters.related !== undefined) explicitOverrides.related = validated.related;
    if (rawFilters.readState !== undefined) explicitOverrides.readState = validated.readState;

    return {
      ...merged,
      ...explicitOverrides,
      savedViewId: savedView.id,
    };
  }

  private resolveGroupByForView(
    view: ActivityFeedView,
    groupBy?: ActivityGroupBy
  ): ActivityGroupBy | undefined {
    if (view === 'feed') {
      return undefined;
    }
    return groupBy || 'day';
  }

  private hasExplicitFeedCustomization(query: ActivityQuery): boolean {
    return [
      query.type,
      query.status,
      query.search,
      query.stream,
      query.route,
      query.referenceId,
      query.correlationId,
      query.related,
      query.sortBy,
      query.sortOrder,
      query.view,
      query.groupBy,
      query.readState,
      query.savedViewId,
    ].some((value) => value !== undefined);
  }

  private hasExplicitActionFilters(filters: ActivityActionFilterBody): boolean {
    return [
      filters.type,
      filters.status,
      filters.search,
      filters.stream,
      filters.route,
      filters.referenceId,
      filters.correlationId,
      filters.related,
      filters.readState,
      filters.savedViewId,
    ].some((value) => value !== undefined);
  }

  private toActivityFilterQuery(
    query: Pick<
      ValidatedActivityActionFilterBody | ValidatedActivityQuery,
      | 'type'
      | 'status'
      | 'search'
      | 'stream'
      | 'route'
      | 'referenceId'
      | 'correlationId'
      | 'related'
      | 'readState'
    >
  ) {
    return {
      type: query.type,
      status: query.status,
      search: query.search,
      stream: query.stream,
      route: query.route,
      referenceId: query.referenceId,
      correlationId: query.correlationId,
      related: query.related,
      readState: query.readState,
    };
  }
}
