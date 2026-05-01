import { Service } from 'typedi';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { coreDataSource } from '../data-source';
import { ActivityLog } from '../entities/ActivityLog';
import { env } from '../../env';
import {
  ACTIVITY_AUTOMATION_STREAMS,
  ACTIVITY_EXECUTION_STREAMS,
  ACTIVITY_REVIEW_STATUSES,
  ACTIVITY_SUCCESS_STATUSES,
  normalizeActivityFlags,
  normalizeActivityRoute,
  normalizeActivityStatus,
  normalizeActivityStream,
  normalizeActivityText,
  normalizeActivityTitle,
  normalizeActivityType,
  tokenizeActivitySearch,
} from '../../lib/activityEvents';
import { Logger } from '../../lib/logger';

const log = new Logger(__filename);

export interface ActivityFilterQuery {
  type?: string;
  status?: string;
  search?: string;
  stream?: string;
  route?: string;
  referenceId?: string;
  correlationId?: string;
  related?: string;
  readState?: 'all' | 'read' | 'unread';
  sortBy?: 'time' | 'status' | 'type' | 'route' | 'stream';
  sortOrder?: 'asc' | 'desc';
}

export interface ActivityListQuery extends ActivityFilterQuery {
  limit: number;
  offset: number;
}

export interface ActivitySummaryQuery extends ActivityFilterQuery {
  dayStart?: Date;
  recentStart?: Date;
}

export interface ActivitySummaryStats {
  totalEvents: number;
  eventsToday: number;
  successful: number;
  needsReview: number;
  recentEvents: number;
  executionEvents: number;
  automationEvents: number;
}

export interface ActivityOperationalCountQuery {
  userId?: string | null;
  type?: string;
  titleLike?: string;
  status?: string;
  stream?: string;
  route?: string;
  createdAfter?: Date;
}

export interface CreateActivityLogPayload {
  userId: string;
  type: string;
  title: string;
  status: string;
  actor?: string | null;
  symbol?: string | null;
  route?: string | null;
  description?: string | null;
  referenceId?: string | null;
  correlationId?: string | null;
  stream?: string | null;
  related?: string | null;
  flags?: ActivityLog['flags'];
}

@Service()
export class ActivityRepository {
  private static readonly FULLTEXT_SEARCH_EXPRESSION =
    'MATCH(activity.type, activity.title, activity.status, activity.actor, activity.symbol, activity.route, activity.referenceId, activity.stream, activity.related, activity.description)';

  private get activityRepository(): Repository<ActivityLog> {
    return coreDataSource.getRepository(ActivityLog);
  }

  async listActivity(userId: string, query: ActivityListQuery) {
    const startedAt = Date.now();
    const builder = this.applyActivityOrdering(this.buildActivityQuery(userId, query), query)
      .skip(query.offset)
      .take(query.limit);

    const [items, total] = await builder.getManyAndCount();
    this.logReadTelemetry('listActivity', Date.now() - startedAt, {
      total,
      limit: query.limit,
      offset: query.offset,
      hasSearch: Boolean(query.search),
      stream: query.stream,
      status: query.status,
      readState: query.readState,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
    return { items, total };
  }

  async countUnread(userId: string, query: ActivityFilterQuery = {}): Promise<number> {
    return this.buildActivityQuery(
      userId,
      {
        ...query,
        readState: 'all',
      },
      { ignoreReadState: true }
    )
      .andWhere('activity.readAt IS NULL')
      .getCount();
  }

  async listActivityWindow(
    userId: string,
    query: ActivityFilterQuery & { limit: number },
    cursor?: { createdAt: Date; id: string }
  ): Promise<ActivityLog[]> {
    const builder = this.applyActivityOrdering(
      this.buildActivityQuery(userId, {
        ...query,
        sortBy: 'time',
        sortOrder: 'desc',
      }),
      { sortBy: 'time', sortOrder: 'desc' }
    ).take(query.limit);

    if (cursor) {
      builder.andWhere(
        new Brackets((cursorQb) => {
          cursorQb
            .where('activity.createdAt < :cursorCreatedAt', {
              cursorCreatedAt: cursor.createdAt,
            })
            .orWhere('(activity.createdAt = :cursorCreatedAt AND activity.id < :cursorId)', {
              cursorCreatedAt: cursor.createdAt,
              cursorId: cursor.id,
            });
        })
      );
    }

    return builder.getMany();
  }

  async getActivitySummary(
    userId: string,
    query: ActivitySummaryQuery = {}
  ): Promise<ActivitySummaryStats> {
    const startedAt = Date.now();
    const baseQuery = this.buildActivityQuery(userId, query);
    const dayStart = query.dayStart ?? this.resolveUtcDayStart();
    const recentStart = query.recentStart ?? this.resolveRecentStart(dayStart);
    const summary = await baseQuery
      .clone()
      .select('COUNT(*)', 'totalEvents')
      .addSelect(
        'COALESCE(SUM(CASE WHEN activity.createdAt >= :dayStart THEN 1 ELSE 0 END), 0)',
        'eventsToday'
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN LOWER(COALESCE(activity.status, '')) IN (${this.buildStaticSqlStringList(
          ACTIVITY_SUCCESS_STATUSES
        )}) THEN 1 ELSE 0 END), 0)`,
        'successful'
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN LOWER(COALESCE(activity.status, '')) IN (${this.buildStaticSqlStringList(
          ACTIVITY_REVIEW_STATUSES
        )}) THEN 1 ELSE 0 END), 0)`,
        'needsReview'
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN activity.createdAt >= :recentStart THEN 1 ELSE 0 END), 0)',
        'recentEvents'
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN LOWER(COALESCE(activity.stream, '')) IN (${this.buildStaticSqlStringList(
          ACTIVITY_EXECUTION_STREAMS
        )}) THEN 1 ELSE 0 END), 0)`,
        'executionEvents'
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN LOWER(COALESCE(activity.stream, '')) IN (${this.buildStaticSqlStringList(
          ACTIVITY_AUTOMATION_STREAMS
        )}) THEN 1 ELSE 0 END), 0)`,
        'automationEvents'
      )
      .setParameters({ dayStart, recentStart })
      .getRawOne<{
        totalEvents: string | number | null;
        eventsToday: string | number | null;
        successful: string | number | null;
        needsReview: string | number | null;
        recentEvents: string | number | null;
        executionEvents: string | number | null;
        automationEvents: string | number | null;
      }>();

    const totalEvents = Number(summary?.totalEvents || 0);
    const eventsToday = Number(summary?.eventsToday || 0);
    const successful = Number(summary?.successful || 0);
    const needsReview = Number(summary?.needsReview || 0);
    const recentEvents = Number(summary?.recentEvents || 0);
    const executionEvents = Number(summary?.executionEvents || 0);
    const automationEvents = Number(summary?.automationEvents || 0);

    this.logReadTelemetry('getActivitySummary', Date.now() - startedAt, {
      totalEvents,
      hasSearch: Boolean(query.search),
      stream: query.stream,
      status: query.status,
      readState: query.readState,
    });

    return {
      totalEvents,
      eventsToday,
      successful,
      needsReview,
      recentEvents,
      executionEvents,
      automationEvents,
    };
  }

  async countOperationalActivities(query: ActivityOperationalCountQuery = {}): Promise<number> {
    const builder = this.activityRepository.createQueryBuilder('activity').where('1 = 1');

    if (query.userId) {
      builder.andWhere('activity.userId = :userId', { userId: query.userId });
    }

    if (query.type) {
      builder.andWhere("LOWER(COALESCE(activity.type, '')) = LOWER(:type)", {
        type: query.type,
      });
    }

    if (query.status) {
      builder.andWhere("LOWER(COALESCE(activity.status, '')) = LOWER(:status)", {
        status: query.status,
      });
    }

    if (query.stream) {
      builder.andWhere("LOWER(COALESCE(activity.stream, '')) = LOWER(:stream)", {
        stream: query.stream,
      });
    }

    if (query.route) {
      builder.andWhere("LOWER(COALESCE(activity.route, '')) = LOWER(:route)", {
        route: query.route,
      });
    }

    if (query.titleLike) {
      builder.andWhere("LOWER(COALESCE(activity.title, '')) LIKE :titleLike", {
        titleLike: `%${String(query.titleLike).trim().toLowerCase()}%`,
      });
    }

    if (query.createdAfter) {
      builder.andWhere('activity.createdAt >= :createdAfter', {
        createdAfter: query.createdAfter,
      });
    }

    return builder.getCount();
  }

  async getActivityById(userId: string, activityId: string): Promise<ActivityLog | null> {
    return this.activityRepository.findOne({ where: { id: activityId, userId } });
  }

  async getLatestEmailDeliveryCleanupActivity(): Promise<ActivityLog | null> {
    return this.activityRepository
      .createQueryBuilder('activity')
      .where("LOWER(COALESCE(activity.route, '')) = :route", {
        route: 'email deliveries',
      })
      .andWhere("LOWER(COALESCE(activity.related, '')) LIKE :related", {
        related: '%cleanup%',
      })
      .orderBy('activity.createdAt', 'DESC')
      .getOne();
  }

  async markActivityRead(
    userId: string,
    activityId: string,
    readAt = new Date()
  ): Promise<boolean> {
    const result = await this.activityRepository.update({ id: activityId, userId }, { readAt });
    return Number(result.affected || 0) > 0;
  }

  async markActivityUnread(userId: string, activityId: string): Promise<boolean> {
    const result = await this.activityRepository.update(
      { id: activityId, userId },
      { readAt: null }
    );
    return Number(result.affected || 0) > 0;
  }

  async markAllActivityRead(
    userId: string,
    query: ActivityFilterQuery = {},
    readAt = new Date()
  ): Promise<number> {
    const unreadSubquery = this.buildActivityQuery(
      userId,
      {
        ...query,
        readState: 'all',
      },
      { ignoreReadState: true }
    )
      .andWhere('activity.readAt IS NULL')
      .select('activity.id');

    const result = await this.activityRepository
      .createQueryBuilder()
      .update(ActivityLog)
      .set({ readAt })
      .where(`id IN (${unreadSubquery.getQuery()})`)
      .setParameters(unreadSubquery.getParameters())
      .execute();

    return Number(result.affected || 0);
  }

  async createActivityLog(payload: CreateActivityLogPayload): Promise<ActivityLog> {
    const startedAt = Date.now();
    const normalizedType = normalizeActivityType(payload.type);
    const normalizedStatus = normalizeActivityStatus(payload.status);
    const created = this.activityRepository.create({
      userId: payload.userId,
      type: normalizedType,
      title: normalizeActivityTitle(payload.title, normalizedType),
      status: normalizedStatus,
      actor: normalizeActivityText(payload.actor, 100),
      symbol: normalizeActivityText(payload.symbol, 50),
      route: normalizeActivityRoute(payload.route),
      description: normalizeActivityText(payload.description),
      referenceId: normalizeActivityText(payload.referenceId, 100),
      correlationId: normalizeActivityText(payload.correlationId ?? payload.referenceId, 191),
      stream: normalizeActivityStream(payload.stream),
      related: normalizeActivityText(payload.related, 100),
      flags: normalizeActivityFlags(payload.flags),
    });
    const saved = await this.activityRepository.save(created);
    this.logWriteTelemetry(Date.now() - startedAt, {
      type: saved.type,
      status: saved.status,
      stream: saved.stream,
      route: saved.route,
    });
    return saved;
  }

  async countOlderThanDays(retentionDays: number): Promise<number> {
    return this.activityRepository
      .createQueryBuilder('activity')
      .where('activity.createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
        retentionDays,
      })
      .getCount();
  }

  async deleteOlderThanDays(retentionDays: number): Promise<number> {
    const result = await this.activityRepository
      .createQueryBuilder()
      .delete()
      .from(ActivityLog)
      .where('createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
        retentionDays,
      })
      .execute();

    return Number(result.affected || 0);
  }

  private buildActivityQuery(
    userId: string,
    query: ActivityFilterQuery,
    options: { ignoreReadState?: boolean } = {}
  ): SelectQueryBuilder<ActivityLog> {
    const builder = this.activityRepository
      .createQueryBuilder('activity')
      .where('activity.userId = :userId', { userId });

    if (query.type) {
      builder.andWhere('activity.type = :type', {
        type: normalizeActivityType(query.type),
      });
    }

    if (query.status) {
      builder.andWhere('activity.status = :status', {
        status: normalizeActivityStatus(query.status),
      });
    }

    if (query.stream) {
      builder.andWhere('activity.stream = :stream', {
        stream: normalizeActivityStream(query.stream),
      });
    }

    if (query.route) {
      builder.andWhere('activity.route = :route', {
        route: normalizeActivityRoute(query.route),
      });
    }

    if (query.referenceId) {
      builder.andWhere('activity.referenceId = :referenceId', {
        referenceId: String(query.referenceId).trim(),
      });
    }

    if (query.correlationId) {
      builder.andWhere('activity.correlationId = :correlationId', {
        correlationId: String(query.correlationId).trim(),
      });
    }

    if (query.related) {
      builder.andWhere('activity.related = :related', {
        related: String(query.related).trim(),
      });
    }

    if (!options.ignoreReadState) {
      this.applyReadStateFilter(builder, query.readState);
    }

    if (query.search) {
      this.applySearchFilter(builder, query.search);
    }

    return builder;
  }

  private applySearchFilter(builder: SelectQueryBuilder<ActivityLog>, searchValue: string): void {
    const rawSearch = String(searchValue || '').trim();
    if (!rawSearch) {
      return;
    }

    const tokens = tokenizeActivitySearch(rawSearch);
    if (!tokens.length) {
      builder.andWhere(this.buildStructuredSearchFallback([rawSearch]));
      return;
    }

    const fullTextSearch = this.buildBooleanFullTextSearch(tokens);
    const structuredTerms = Array.from(new Set([rawSearch, ...tokens]));

    builder.andWhere(
      new Brackets((searchQb) => {
        const fallback = this.buildStructuredSearchFallback(structuredTerms);

        if (fullTextSearch) {
          searchQb
            .where(
              `${ActivityRepository.FULLTEXT_SEARCH_EXPRESSION} AGAINST (:fullTextSearch IN BOOLEAN MODE)`,
              { fullTextSearch }
            )
            .orWhere(fallback);
          return;
        }

        searchQb.where(fallback);
      })
    );
  }

  private buildStructuredSearchFallback(terms: string[]): Brackets {
    return new Brackets((fallbackQb) => {
      terms.forEach((term, index) => {
        const exactToken = String(term || '').trim();
        if (!exactToken) {
          return;
        }

        const normalizedType = normalizeActivityType(exactToken);
        const normalizedStatus = normalizeActivityStatus(exactToken);
        const normalizedRoute = normalizeActivityRoute(exactToken);
        const normalizedStream = normalizeActivityStream(exactToken);

        fallbackQb.andWhere(
          new Brackets((termQb) => {
            termQb
              .where(`activity.referenceId = :referenceExact${index}`, {
                [`referenceExact${index}`]: exactToken,
              })
              .orWhere(`activity.correlationId = :correlationExact${index}`, {
                [`correlationExact${index}`]: exactToken,
              })
              .orWhere(`activity.symbol = :symbolExact${index}`, {
                [`symbolExact${index}`]: exactToken,
              })
              .orWhere(`activity.related = :relatedExact${index}`, {
                [`relatedExact${index}`]: exactToken,
              });

            if (!/\s/.test(exactToken)) {
              const prefixToken = `${exactToken}%`;
              termQb
                .orWhere(`activity.referenceId LIKE :referencePrefix${index}`, {
                  [`referencePrefix${index}`]: prefixToken,
                })
                .orWhere(`activity.correlationId LIKE :correlationPrefix${index}`, {
                  [`correlationPrefix${index}`]: prefixToken,
                })
                .orWhere(`activity.symbol LIKE :symbolPrefix${index}`, {
                  [`symbolPrefix${index}`]: prefixToken,
                });
            }

            if (normalizedType) {
              termQb.orWhere(`activity.type = :typeExact${index}`, {
                [`typeExact${index}`]: normalizedType,
              });
            }

            if (normalizedStatus) {
              termQb.orWhere(`activity.status = :statusExact${index}`, {
                [`statusExact${index}`]: normalizedStatus,
              });
            }

            if (normalizedRoute) {
              termQb.orWhere(`activity.route = :routeExact${index}`, {
                [`routeExact${index}`]: normalizedRoute,
              });
            }

            if (normalizedStream) {
              termQb.orWhere(`activity.stream = :streamExact${index}`, {
                [`streamExact${index}`]: normalizedStream,
              });
            }
          })
        );
      });
    });
  }

  private applyReadStateFilter(
    builder: SelectQueryBuilder<ActivityLog>,
    readState?: ActivityFilterQuery['readState']
  ): void {
    if (readState === 'read') {
      builder.andWhere('activity.readAt IS NOT NULL');
      return;
    }

    if (readState === 'unread') {
      builder.andWhere('activity.readAt IS NULL');
    }
  }

  private applyActivityOrdering(
    builder: SelectQueryBuilder<ActivityLog>,
    query: Pick<ActivityFilterQuery, 'sortBy' | 'sortOrder'>
  ): SelectQueryBuilder<ActivityLog> {
    const direction = String(query.sortOrder || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const sortBy = query.sortBy || 'time';

    const sortColumn =
      sortBy === 'status'
        ? 'activity.status'
        : sortBy === 'type'
          ? 'activity.type'
          : sortBy === 'route'
            ? 'activity.route'
            : sortBy === 'stream'
              ? 'activity.stream'
              : 'activity.createdAt';

    builder.orderBy(sortColumn, direction);
    if (sortBy !== 'time') {
      builder.addOrderBy('activity.createdAt', direction);
    }
    builder.addOrderBy('activity.id', 'DESC');
    return builder;
  }

  private buildStaticSqlStringList(values: string[]): string {
    return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(', ');
  }

  private buildBooleanFullTextSearch(tokens: string[]): string {
    return tokens
      .map((token) => this.toBooleanFullTextToken(token))
      .filter((token): token is string => Boolean(token))
      .join(' ');
  }

  private toBooleanFullTextToken(value: string): string | null {
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitized.length < 2) {
      return null;
    }
    return `+${sanitized}*`;
  }

  private logWriteTelemetry(
    durationMs: number,
    payload: { type: string; status: string; stream: string | null; route: string | null }
  ): void {
    if (durationMs < env.observability.activityWriteWarnMs) {
      return;
    }

    log.warn(
      `Activity write slow (${durationMs}ms): type=${payload.type}, status=${payload.status}, stream=${
        payload.stream || 'none'
      }, route=${payload.route || 'none'}`
    );
  }

  private logReadTelemetry(
    operation: 'listActivity' | 'getActivitySummary',
    durationMs: number,
    payload: Record<string, unknown>
  ): void {
    if (durationMs >= env.observability.activityReadWarnMs) {
      log.warn(`Activity read slow (${operation}, ${durationMs}ms)`, payload);
      return;
    }

    const total = Number(payload.total ?? payload.totalEvents ?? 0);
    if (total >= env.observability.activityFeedVolumeInfoThreshold) {
      log.info(`Activity feed volume observed (${operation}, total=${total})`, payload);
    }
  }

  private resolveUtcDayStart(reference = new Date()): Date {
    return new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), 0, 0, 0)
    );
  }

  private resolveRecentStart(dayStart: Date): Date {
    return new Date(dayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  }
}
