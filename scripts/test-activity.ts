import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ActivityController } from '../src/api/controllers/ActivityController';
import { ActivityMaintenanceService } from '../src/api/services/ActivityMaintenanceService';
import { ActivityService } from '../src/api/services/ActivityService';
import {
  validateActivityActionFilterBody,
  validateActivityExportBody,
  validateActivityExportHistoryQuery,
  validateActivityId,
  validateActivityQuery,
  validateActivitySaveViewBody,
} from '../src/api/validators/activity.validator';
import {
  ActivityExport,
  ActivityLog,
  ActivitySavedView,
} from '../src/database';
import { ActivityExportRepository } from '../src/database/repositories/ActivityExportRepository';
import { ActivityRepository } from '../src/database/repositories/ActivityRepository';
import { env } from '../src/env';
import { getMetadataArgsStorage } from 'typeorm';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const authReq = { authUser: { sub: 'user-1' } } as any;
const unauthReq = {} as any;

async function assertAuthRequired(
  run: () => Promise<unknown>,
  message = 'Authentication required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 401
  );
}

async function runActivityControllerAssertions(): Promise<void> {
  const controller: any = new ActivityController();

  controller.activityService = {
    getActivitySummary: async (...args: unknown[]) => createSuccess({ args }),
    getScopedActivitySummary: async (...args: unknown[]) => createSuccess({ args }),
    getActivity: async (...args: unknown[]) => createSuccess({ args }),
    listActivitySavedViews: async (...args: unknown[]) => createSuccess({ args }),
    createActivitySavedView: async (...args: unknown[]) => createSuccess({ args }),
    updateActivitySavedView: async (...args: unknown[]) => createSuccess({ args }),
    deleteActivitySavedView: async (...args: unknown[]) => createSuccess({ args }),
    getActivityById: async (...args: unknown[]) => createSuccess({ args }),
    markActivityRead: async (...args: unknown[]) => createSuccess({ args }),
    markActivityUnread: async (...args: unknown[]) => createSuccess({ args }),
    markAllActivityRead: async (...args: unknown[]) => createSuccess({ args }),
    listActivityExports: async (...args: unknown[]) => createSuccess({ args }),
    getActivityExportById: async (...args: unknown[]) => createSuccess({ args }),
    getActivityExportDownload: async (...args: unknown[]) => ({
      filePath: '/tmp/activity-export-1.json',
      fileName: 'activity-export-1.json',
      contentType: 'application/json',
      args,
    }),
    exportActivity: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getActivitySummary(authReq)).data.args, ['user-1']);
  assert.deepEqual(
    (
      await controller.getActivitySummary(
        authReq,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'unread',
        'Connections',
        'Success',
        'delta',
        'controls',
        'Brokers data',
        'conn-1',
        'corr-1',
        'delta_exchange',
        'view-1'
      )
    ).data.args,
    [
      'user-1',
      {
        type: 'Connections',
        status: 'Success',
        search: 'delta',
        stream: 'controls',
        route: 'Brokers data',
        referenceId: 'conn-1',
        correlationId: 'corr-1',
        related: 'delta_exchange',
        readState: 'unread',
        savedViewId: 'view-1',
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.getActivity(
        authReq,
        '25',
        '5',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'Connections',
        'Success',
        'delta',
        'controls',
        'Brokers data',
        'conn-1',
        'corr-1',
        'delta_exchange',
        undefined
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '25',
        offset: '5',
        type: 'Connections',
        status: 'Success',
        search: 'delta',
        stream: 'controls',
        route: 'Brokers data',
        referenceId: 'conn-1',
        correlationId: 'corr-1',
        related: 'delta_exchange',
      },
    ]
  );
  assert.deepEqual((await controller.getActivityById(authReq, 'activity-1')).data.args, [
    'user-1',
    'activity-1',
  ]);
  assert.deepEqual((await controller.getActivitySavedViews(authReq)).data.args, ['user-1']);

  const viewBody = { name: 'Unread controls', readState: 'unread' };
  assert.deepEqual((await controller.createActivitySavedView(authReq, viewBody)).data.args, [
    'user-1',
    viewBody,
  ]);
  assert.deepEqual(
    (await controller.updateActivitySavedView(authReq, 'view-1', viewBody)).data.args,
    ['user-1', 'view-1', viewBody]
  );
  assert.deepEqual((await controller.deleteActivitySavedView(authReq, 'view-1')).data.args, [
    'user-1',
    'view-1',
  ]);
  assert.deepEqual((await controller.markActivityRead(authReq, 'activity-1')).data.args, [
    'user-1',
    'activity-1',
  ]);
  assert.deepEqual((await controller.markActivityUnread(authReq, 'activity-1')).data.args, [
    'user-1',
    'activity-1',
  ]);
  assert.deepEqual(
    (
      await controller.markAllActivityRead(
        authReq,
        {
          type: 'Connections',
          status: 'Success',
          search: 'delta',
          stream: 'controls',
          route: 'Brokers data',
          referenceId: 'conn-1',
          correlationId: 'corr-1',
          related: 'delta_exchange',
          readState: 'unread',
          savedViewId: 'view-1',
        },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    ).data.args,
    [
      'user-1',
      {
        type: 'Connections',
        status: 'Success',
        search: 'delta',
        stream: 'controls',
        route: 'Brokers data',
        referenceId: 'conn-1',
        correlationId: 'corr-1',
        related: 'delta_exchange',
        readState: 'unread',
        savedViewId: 'view-1',
      },
    ]
  );
  assert.deepEqual((await controller.getActivityExports(authReq, '10', '2')).data.args, [
    'user-1',
    { limit: '10', offset: '2' },
  ]);
  assert.deepEqual((await controller.getActivityExportById(authReq, 'export-1')).data.args, [
    'user-1',
    'export-1',
  ]);

  const responseMock: any = {
    headers: {} as Record<string, string>,
    type(contentType: string) {
      this.headers.type = contentType;
      return this;
    },
    download(filePath: string, fileName: string) {
      this.downloadArgs = { filePath, fileName };
      return this;
    },
  };
  const downloadResponse = await controller.downloadActivityExport(
    authReq,
    'export-1',
    responseMock
  );
  assert.equal(downloadResponse, responseMock);
  assert.equal(responseMock.headers.type, 'application/json');
  assert.deepEqual(responseMock.downloadArgs, {
    filePath: '/tmp/activity-export-1.json',
    fileName: 'activity-export-1.json',
  });

  const exportBody = { scope: 'controls', format: 'csv', route: 'Brokers data' };
  assert.deepEqual((await controller.exportActivity(authReq, exportBody)).data.args, [
    'user-1',
    exportBody,
  ]);

  await assertAuthRequired(() => controller.getActivity(unauthReq));
  await assertAuthRequired(() => controller.getActivitySummary(unauthReq));
  await assertAuthRequired(() => controller.getActivitySavedViews(unauthReq));
  await assertAuthRequired(() => controller.createActivitySavedView(unauthReq, viewBody));
  await assertAuthRequired(() => controller.getActivityById(unauthReq, 'activity-1'));
  await assertAuthRequired(() => controller.markActivityRead(unauthReq, 'activity-1'));
  await assertAuthRequired(() => controller.getActivityExports(unauthReq));
}

function runActivityValidationAssertions(): void {
  assert.equal(validateActivityId('  activity-1  '), 'activity-1');
  assert.throws(() => validateActivityId('   '), /activityId is required/);

  assert.deepEqual(
    validateActivityQuery({
      limit: '25',
      offset: '5',
      sortBy: 'status',
      sortOrder: 'asc',
      view: 'grouped',
      groupBy: 'route',
      readState: 'unread',
      stream: ' controls ',
      route: ' Brokers data ',
    }),
    {
      limit: 25,
      offset: 5,
      sortBy: 'status',
      sortOrder: 'asc',
      view: 'grouped',
      groupBy: 'route',
      readState: 'unread',
      type: undefined,
      status: undefined,
      search: undefined,
      stream: 'controls',
      route: 'Brokers data',
      referenceId: undefined,
      correlationId: undefined,
      related: undefined,
      savedViewId: undefined,
    }
  );
  assert.throws(
    () => validateActivityQuery({ limit: '0' }),
    /limit must be an integer between 1 and 100/
  );

  assert.deepEqual(
    validateActivityActionFilterBody({
      stream: ' controls ',
      route: ' Risk ',
      readState: 'read',
    }),
    {
      type: undefined,
      status: undefined,
      search: undefined,
      stream: 'controls',
      route: 'Risk',
      referenceId: undefined,
      correlationId: undefined,
      related: undefined,
      savedViewId: undefined,
      readState: 'read',
    }
  );

  assert.deepEqual(
    validateActivityExportBody({
      scope: ' automation ',
      format: ' json ',
      route: ' Risk ',
    }),
    {
      scope: 'automation',
      format: 'json',
      type: undefined,
      status: undefined,
      search: undefined,
      stream: undefined,
      route: 'Risk',
      referenceId: undefined,
      correlationId: undefined,
      related: undefined,
      savedViewId: undefined,
      readState: 'all',
    }
  );
  assert.throws(
    () => validateActivityExportBody({ format: 'xlsx' as any }),
    /format must be csv or json/
  );

  assert.deepEqual(
    validateActivitySaveViewBody({
      name: ' Risk review ',
      description: ' unread risk events ',
      view: 'grouped',
      groupBy: 'status',
      sortBy: 'route',
      sortOrder: 'asc',
      readState: 'unread',
      route: 'Risk',
    }),
    {
      name: 'Risk review',
      description: 'unread risk events',
      isDefault: false,
      view: 'grouped',
      groupBy: 'status',
      sortBy: 'route',
      sortOrder: 'asc',
      readState: 'unread',
      type: undefined,
      status: undefined,
      search: undefined,
      stream: undefined,
      route: 'Risk',
      referenceId: undefined,
      correlationId: undefined,
      related: undefined,
    }
  );
  assert.throws(
    () => validateActivitySaveViewBody({}, { requireName: true }),
    /name is required/
  );

  assert.deepEqual(validateActivityExportHistoryQuery({ limit: '5', offset: '2' }), {
    limit: 5,
    offset: 2,
  });
}

async function runActivityQueryFilterAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  const capturedQueries: Array<Record<string, unknown>> = [];

  service.activityRepository = {
    listActivity: async (_userId: string, query: Record<string, unknown>) => {
      capturedQueries.push({ ...query });
      return {
        items: [
          {
            id: 'activity-1',
            type: 'Connections',
            title: 'Route test passed',
            status: 'Success',
            actor: 'user-1',
            symbol: null,
            route: 'Brokers data',
            description: 'Diagnostics completed',
            referenceId: 'conn-1',
            correlationId: 'corr-1',
            stream: 'controls',
            related: 'delta_exchange',
            flags: null,
            createdAt: new Date('2026-04-04T08:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
    async countUnread(_userId: string, query: Record<string, unknown>) {
      assert.equal(query.stream, 'controls');
      return 1;
    },
  };

  const response = await service.getActivity('user-1', {
    limit: '4',
    offset: '0',
    stream: 'controls',
    route: 'Brokers data',
    referenceId: 'conn-1',
    correlationId: 'corr-1',
    related: 'delta_exchange',
  });

  assert.deepEqual(capturedQueries, [
    {
      limit: 4,
      offset: 0,
      type: undefined,
      status: undefined,
      search: undefined,
      stream: 'controls',
      route: 'Brokers data',
      referenceId: 'conn-1',
      correlationId: 'corr-1',
      related: 'delta_exchange',
      readState: 'all',
      view: 'feed',
      savedViewId: undefined,
      groupBy: undefined,
      sortBy: 'time',
      sortOrder: 'desc',
    },
  ]);
  assert.equal(response.data.total, 1);
  assert.equal(response.data.unreadCount, 1);
  assert.equal(response.data.items[0]?.stream, 'Controls');
  assert.equal(response.data.items[0]?.referenceId, 'conn-1');
  assert.equal(response.data.items[0]?.correlationId, 'corr-1');
  assert.equal(response.data.items[0]?.related, 'delta_exchange');
  assert.equal(response.data.meta.timeZone, 'UTC');
  assert.deepEqual(response.data.meta.savedViews, []);
  assert.equal(response.data.meta.view, 'feed');
}

async function runScopedActivitySummaryAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  let capturedUserId = '';
  let capturedQuery: Record<string, unknown> | null = null;
  let capturedReadyExportFilters: Record<string, string> | undefined;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'Asia/Kolkata';
    },
  };
  service.activityExportRepository = {
    async countReadyExports(
      userId: string,
      options?: { filters?: Record<string, string> | null }
    ) {
      assert.equal(userId, 'user-1');
      capturedReadyExportFilters = options?.filters ?? undefined;
      return 1;
    },
  };
  service.activityRepository = {
    async getActivitySummary(userId: string, query: Record<string, unknown>) {
      capturedUserId = userId;
      capturedQuery = query;
      return {
        totalEvents: 3,
        eventsToday: 2,
        successful: 1,
        needsReview: 1,
        recentEvents: 3,
        executionEvents: 1,
        automationEvents: 1,
      };
    },
  };

  const response = await service.getScopedActivitySummary('user-1', {
    limit: '50',
    offset: '20',
    type: 'Connections',
    status: 'Success',
    search: 'delta',
    stream: 'controls',
    route: 'Brokers data',
    referenceId: 'conn-1',
    correlationId: 'corr-1',
    related: 'delta_exchange',
  });

  assert.equal(capturedUserId, 'user-1');
  assert.ok(capturedQuery);
  const summaryQuery = capturedQuery as Record<string, unknown>;
  assert.equal(summaryQuery.type, 'Connections');
  assert.equal(summaryQuery.status, 'Success');
  assert.equal(summaryQuery.search, 'delta');
  assert.equal(summaryQuery.stream, 'controls');
  assert.equal(summaryQuery.route, 'Brokers data');
  assert.equal(summaryQuery.referenceId, 'conn-1');
  assert.equal(summaryQuery.correlationId, 'corr-1');
  assert.equal(summaryQuery.related, 'delta_exchange');
  assert.equal(summaryQuery.readState, 'all');
  assert.ok((summaryQuery.dayStart as Date | undefined) instanceof Date);
  assert.ok((summaryQuery.recentStart as Date | undefined) instanceof Date);
  assert.deepEqual(capturedReadyExportFilters, {
    type: 'Connections',
    status: 'Success',
    search: 'delta',
    stream: 'controls',
    route: 'Brokers data',
    referenceId: 'conn-1',
    correlationId: 'corr-1',
    related: 'delta_exchange',
  });
  assert.deepEqual(response.data, {
    eventsToday: 2,
    successful: 1,
    needsReview: 1,
    exportsReady: 1,
    recentEvents: 3,
    executionEvents: 1,
    automationEvents: 1,
    auditPosture: 'Review needed',
  });
}

async function runActivityGroupingWindowAssertions(): Promise<void> {
  const service = new ActivityService() as any;

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'Asia/Kolkata';
    },
  };
  service.activitySavedViewRepository = {
    async listViews() {
      return [];
    },
  };
  service.activityRepository = {
    async listActivity(_userId: string, query: Record<string, unknown>) {
      assert.equal(query.view, 'grouped');
      return {
        items: [
          {
            id: 'activity-1',
            type: 'Connections',
            title: 'Primary connection synced',
            status: 'Success',
            actor: 'system',
            symbol: null,
            route: 'Brokers data',
            description: null,
            referenceId: 'conn-1',
            correlationId: 'corr-1',
            stream: 'controls',
            related: 'delta_exchange',
            flags: null,
            readAt: null,
            createdAt: new Date('2026-04-03T21:00:00.000Z'),
          },
        ],
        total: 2,
      };
    },
    async countUnread(_userId: string, query: Record<string, unknown>) {
      assert.equal(query.route, 'Brokers data');
      return 2;
    },
  };

  const response = await service.getActivity('user-1', {
    limit: '1',
    offset: '0',
    view: 'grouped',
    groupBy: 'day',
    route: 'Brokers data',
  });

  assert.equal(response.data.total, 2);
  assert.equal(response.data.meta.timeZone, 'Asia/Kolkata');
  assert.equal(response.data.meta.presentationWindowTruncated, undefined);
  assert.equal(response.data.groups?.length, 1);
  assert.deepEqual(response.data.groups?.[0], {
    key: 'day:2026-04-04',
    label: '2026-04-04',
    count: 1,
    unreadCount: 1,
    itemIds: ['activity-1'],
  });
}

async function runActivityRepositoryNormalizationAssertions(): Promise<void> {
  const repository = new ActivityRepository() as any;
  let createdPayload: Record<string, unknown> | null = null;
  let savedPayload: Record<string, unknown> | null = null;

  Object.defineProperty(repository, 'activityRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        createdPayload = { ...payload };
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        savedPayload = { ...payload };
        return {
          id: 'activity-1',
          createdAt: new Date('2026-04-04T10:00:00.000Z'),
          updatedAt: new Date('2026-04-04T10:00:00.000Z'),
          ...payload,
        };
      },
    }),
  });

  const saved = await repository.createActivityLog({
    userId: 'user-1',
    type: ' strategy lab ',
    title: '  draft   saved ',
    status: 'completed',
    actor: ' user-1 ',
    symbol: ' btcusdt ',
    route: ' strategy lab ',
    description: '  Visual draft saved from editor ',
    referenceId: ' proj-1 ',
    stream: 'review',
    related: ' momentum ',
    flags: [
      {
        id: ' draft-check ',
        message: '  Review before promoting ',
        channel: ' strategy lab ',
        time: ' 2026-04-04T10:00:00.000Z ',
        status: 'watch',
      },
    ],
  });

  assert.ok(createdPayload);
  assert.ok(savedPayload);
  const normalizedCreatedPayload = createdPayload as Record<string, unknown>;
  assert.equal(normalizedCreatedPayload.type, 'Strategy Lab');
  assert.equal(normalizedCreatedPayload.title, 'draft saved');
  assert.equal(normalizedCreatedPayload.status, 'Success');
  assert.equal(normalizedCreatedPayload.route, 'Strategy Lab');
  assert.equal(normalizedCreatedPayload.stream, 'Controls');
  assert.equal(normalizedCreatedPayload.referenceId, 'proj-1');
  assert.equal(normalizedCreatedPayload.related, 'momentum');
  assert.equal(normalizedCreatedPayload.symbol, 'btcusdt');
  assert.deepEqual(normalizedCreatedPayload.flags, [
    {
      id: 'draft-check',
      message: 'Review before promoting',
      channel: 'strategy lab',
      time: '2026-04-04T10:00:00.000Z',
      status: 'Needs review',
    },
  ]);
  assert.equal(saved.type, 'Strategy Lab');
  assert.equal(saved.status, 'Success');
}

async function runActivityExportRepositorySignatureAssertions(): Promise<void> {
  const repository = new ActivityExportRepository() as any;
  let createdPayload: Record<string, unknown> | null = null;
  let capturedFilterSignature = '';

  Object.defineProperty(repository, 'exportRepository', {
    get: () => ({
      create(payload: Record<string, unknown>) {
        createdPayload = { ...payload };
        return payload;
      },
      async save(payload: Record<string, unknown>) {
        return {
          id: 'export-1',
          createdAt: new Date('2026-04-04T10:00:00.000Z'),
          updatedAt: new Date('2026-04-04T10:00:00.000Z'),
          ...payload,
        };
      },
      createQueryBuilder() {
        const params: Record<string, unknown> = {};
        return {
          where(_sql: string, nextParams?: Record<string, unknown>) {
            if (nextParams) {
              Object.assign(params, nextParams);
            }
            return this;
          },
          andWhere(_sql: unknown, nextParams?: Record<string, unknown>) {
            if (nextParams) {
              Object.assign(params, nextParams);
            }
            return this;
          },
          async getCount() {
            capturedFilterSignature = String(params.filterSignature || '');
            return 2;
          },
        };
      },
    }),
  });

  const created = await repository.createExport({
    userId: 'user-1',
    scope: 'all',
    format: 'csv',
    fileName: 'activity-all.csv',
    contentType: 'text/csv',
    exportedCount: 0,
    filters: {
      route: ' Risk ',
      readState: 'unread',
    },
  });

  assert.ok(createdPayload);
  const normalizedCreatedPayload = createdPayload as Record<string, unknown>;
  assert.deepEqual(normalizedCreatedPayload.filters, {
    route: 'Risk',
    readState: 'unread',
  });
  assert.equal(String(normalizedCreatedPayload.filterSignature || '').length, 64);
  assert.equal(String(created.filterSignature || '').length, 64);

  const readyCount = await repository.countReadyExports(
    'user-1',
    {
      filters: {
        route: 'Risk',
      },
    },
    new Date('2026-04-04T10:00:00.000Z')
  );

  assert.equal(readyCount, 2);
  assert.equal(capturedFilterSignature.length, 64);
}

async function runLegacyActivityStreamNormalizationAssertions(): Promise<void> {
  const service = new ActivityService() as any;

  service.activityRepository = {
    async listActivity() {
      return {
        items: [
          {
            id: 'activity-legacy',
            type: 'Signal',
            title: 'Signal queued for review',
            status: 'Success',
            actor: 'user-1',
            symbol: 'BTCUSDT',
            route: 'Signals',
            description: 'Legacy review stream event',
            referenceId: 'sig-1',
            stream: 'Review',
            related: 'scanner',
            flags: null,
            createdAt: new Date('2026-04-04T08:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
  };

  const response = await service.getActivity('user-1', {
    limit: '10',
    offset: '0',
  });

  assert.equal(response.data.items[0]?.stream, 'Controls');
}

async function runActivityMaintenanceAssertions(): Promise<void> {
  const service = new ActivityMaintenanceService() as any;
  let countOlderThanDaysCalls = 0;
  let deleteOlderThanDaysCalls = 0;
  let countExpiredExportsCalls = 0;
  let listExpiredExportsCalls = 0;
  let deleteExpiredExportsCalls = 0;

  service.activityRepository = {
    async countOlderThanDays(retentionDays: number) {
      countOlderThanDaysCalls += 1;
      assert.equal(retentionDays, env.activity.retentionDays);
      return 7;
    },
    async deleteOlderThanDays(retentionDays: number) {
      deleteOlderThanDaysCalls += 1;
      assert.equal(retentionDays, env.activity.retentionDays);
      return 7;
    },
  };
  service.activityExportRepository = {
    async countExpiredExports(now: Date) {
      countExpiredExportsCalls += 1;
      assert.ok(now instanceof Date);
      return 2;
    },
    async listExpiredExports(now: Date, limit: number) {
      listExpiredExportsCalls += 1;
      assert.ok(now instanceof Date);
      assert.equal(limit, 100);
      if (listExpiredExportsCalls > 1) {
        return [];
      }
      return [
        { id: 'export-1', storagePath: null },
        { id: 'export-2', storagePath: null },
      ];
    },
    async deleteExportsByIds(ids: string[]) {
      deleteExpiredExportsCalls += 1;
      assert.deepEqual(ids, ['export-1', 'export-2']);
      return 2;
    },
  };

  const result = await service.runMaintenanceNow();

  assert.equal(countOlderThanDaysCalls, 1);
  assert.equal(deleteOlderThanDaysCalls, 1);
  assert.equal(countExpiredExportsCalls, 1);
  assert.equal(listExpiredExportsCalls, 2);
  assert.equal(deleteExpiredExportsCalls, 1);
  assert.deepEqual(result, {
    deletedActivityLogs: 7,
    deletedExpiredExports: 2,
    retentionDays: env.activity.retentionDays,
  });
}

async function runActivityDetailAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  const createdAt = new Date('2026-04-04T09:00:00.000Z');
  const updatedAt = new Date('2026-04-04T09:05:00.000Z');

  service.activityRepository = {
    async getActivityById(userId: string, activityId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(activityId, 'activity-1');
      return {
        id: 'activity-1',
        userId,
        type: 'Connection diagnostics',
        title: 'Connection test passed: delta_exchange',
        status: 'Success',
        actor: 'user-1',
        symbol: null,
        route: 'Brokers data',
        description: 'Signed wallet reachable',
        referenceId: 'conn-1',
        stream: 'Controls',
        related: 'delta_exchange',
        flags: [
          {
            id: 'connection-status-synced',
            message: 'Connection status updated to Connected.',
            channel: 'Brokers',
            time: createdAt.toISOString(),
            status: 'Ready',
          },
        ],
        createdAt,
        updatedAt,
      };
    },
  };
  service.connectionRepository = {
    async getConnectionById(userId: string, connectionId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(connectionId, 'conn-1');
      return {
        id: 'conn-1',
        name: 'Delta route',
        status: 'Connected',
        brokerKey: 'delta_exchange',
        type: 'exchange',
        updatedAt,
      };
    },
  };

  const response = await service.getActivityById('user-1', 'activity-1');

  assert.equal(response.data.statusTone, 'success');
  assert.equal(response.data.streamKey, 'controls');
  assert.equal(response.data.linkedEntity?.kind, 'connection');
  assert.equal(response.data.linkedEntity?.path, '/brokers-data');
  assert.deepEqual(
    response.data.flags?.map((flag: { id: string }) => flag.id),
    ['connection-status-synced']
  );
  assert.deepEqual(response.data.exportContext, {
    formats: ['csv', 'json'],
    scope: 'controls',
    filters: {
      referenceId: 'conn-1',
      readState: 'unread',
      related: 'delta_exchange',
      route: 'Brokers data',
      stream: 'controls',
    },
    historyPath: '/activity?panel=exports',
  });
  assert.deepEqual(
    response.data.routeTargets.map((target: { path: string }) => target.path),
    [
      '/brokers-data',
      '/activity?referenceId=conn-1',
      '/activity?related=delta_exchange',
      '/activity?panel=exports',
    ]
  );
}

async function runActivityStrategyLibraryLinkAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  const createdAt = new Date('2026-04-05T10:00:00.000Z');
  const updatedAt = new Date('2026-04-05T10:05:00.000Z');

  service.activityRepository = {
    async getActivityById() {
      return {
        id: 'activity-library-1',
        userId: 'user-1',
        type: 'Strategy Library',
        title: 'Strategy library updated: Momentum Runner',
        status: 'Success',
        actor: 'user-1',
        symbol: null,
        route: 'Strategy Library',
        description: 'Strategy library entry updated',
        referenceId: 'library-1',
        stream: 'Definitions',
        related: null,
        flags: [],
        createdAt,
        updatedAt,
      };
    },
  };
  service.strategyLibraryRepository = {
    async getById(_userId: string, libraryId: string) {
      assert.equal(libraryId, 'library-1');
      return {
        id: 'library-1',
        name: 'Momentum Runner',
        templateId: 'template-1',
        status: 'Active',
        updatedAt,
      };
    },
  };
  service.strategyTemplateRepository = {
    async getStrategyTemplateById(_userId: string, templateId: string) {
      assert.equal(templateId, 'template-1');
      return {
        id: 'template-1',
        name: 'Momentum Template',
        templateVersion: 8,
      };
    },
  };

  const response = await service.getActivityById('user-1', 'activity-library-1');

  assert.equal(response.data.linkedEntity?.kind, 'strategy_library');
  assert.equal(response.data.linkedEntity?.path, '/strategy-library?selected=library-1');
  assert.equal(response.data.linkedEntity?.description, 'Imported from Momentum Template · v8');
}

async function runActivityExportAssertions(): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const service = new ActivityService() as any;
  const createdAt = new Date('2026-04-04T10:00:00.000Z');
  type CreatedExportPayload = {
    scope: string;
    format: string;
    status: string;
    fileName: string;
    contentType: string;
    exportedCount: number;
    filters: Record<string, string>;
    content: string | null;
    expiresAt: Date | null;
  };
  let createdExportPayload: CreatedExportPayload | null = null;
  let exportProcessorCalls = 0;
  let rebuiltStoragePath = '';
  let markedReadyPayload: Record<string, unknown> | null = null;

  service.operationalEventService = {
    async logActivity() {
      return;
    },
    async emitFailureAlert() {
      return;
    },
  };
  service.activityExportProcessorService = {
    async processPendingExportsOnce() {
      exportProcessorCalls += 1;
    },
    async rebuildExportFile(item: Record<string, unknown>) {
      assert.equal(item.id, 'export-2');
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      rebuiltStoragePath = join(tmpdir(), 'activity-exports', 'export-2-rebuilt.json');
      await mkdir(join(tmpdir(), 'activity-exports'), { recursive: true });
      await writeFile(
        rebuiltStoragePath,
        JSON.stringify([{ id: 'activity-1', title: 'Connection test passed: delta_exchange' }], null, 2),
        'utf8'
      );
      return {
        filePath: rebuiltStoragePath,
        exportedCount: 1,
      };
    },
  };
  service.activityExportRepository = {
    async createExport(payload: CreatedExportPayload) {
      createdExportPayload = { ...payload };
      return {
        id: 'export-1',
        userId: 'user-1',
        storagePath: null,
        errorMessage: null,
        createdAt,
        updatedAt: createdAt,
        ...payload,
      };
    },
    async listExports(userId: string, query: { limit: number; offset: number }) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(query, { limit: 5, offset: 0 });
      return {
        items: [
          {
            id: 'export-2',
            userId,
            scope: 'all',
            format: 'json',
            status: 'Ready',
            fileName: 'activity-all-2026-04-04.json',
            contentType: 'application/json',
            exportedCount: 1,
            filters: { referenceId: 'conn-1' },
            storagePath: '/tmp/missing-activity-export-export-2.json',
            content: null,
            errorMessage: null,
            createdAt,
            updatedAt: createdAt,
            expiresAt: new Date('2026-04-11T10:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
    async getExportById(userId: string, exportId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(exportId, 'export-2');
      return {
        id: 'export-2',
        userId,
        scope: 'all',
        format: 'json',
        status: 'Ready',
        fileName: 'activity-all-2026-04-04.json',
        contentType: 'application/json',
        exportedCount: 1,
        filters: { referenceId: 'conn-1' },
        storagePath: '/tmp/missing-activity-export-export-2.json',
        content: null,
        errorMessage: null,
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date('2026-04-11T10:00:00.000Z'),
      };
    },
    async markExportReady(exportId: string, payload: Record<string, unknown>) {
      assert.equal(exportId, 'export-2');
      markedReadyPayload = payload;
      return null;
    },
  };

  const exportResponse = await service.exportActivity('user-1', {
    scope: 'controls',
    format: 'csv',
    status: 'Success',
    route: 'Brokers data',
  });

  assert.equal(exportProcessorCalls, 1);
  assert.ok(createdExportPayload);
  const exportPayload = createdExportPayload as CreatedExportPayload;
  assert.equal(exportPayload.scope, 'controls');
  assert.equal(exportPayload.format, 'csv');
  assert.equal(exportPayload.status, 'Queued');
  assert.equal(exportPayload.contentType, 'text/csv');
  assert.equal(exportPayload.exportedCount, 0);
  assert.deepEqual(exportPayload.filters, {
    status: 'Success',
    stream: 'controls',
    route: 'Brokers data',
    scope: 'controls',
  });
  assert.ok(exportPayload.fileName);
  assert.match(String(exportPayload.fileName), /^activity-controls-.*\.csv$/);
  assert.equal(exportPayload.expiresAt, null);
  assert.equal(exportPayload.content, null);
  assert.equal(exportResponse.data.message, 'Activity export queued');

  const historyResponse = await service.listActivityExports('user-1', {
    limit: '5',
    offset: '0',
  });
  assert.equal(historyResponse.data.total, 1);
  assert.equal(historyResponse.data.items[0]?.exportId, 'export-2');
  assert.equal(
    historyResponse.data.items[0]?.downloadPath,
    '/activity/exports/export-2/download'
  );

  const exportByIdResponse = await service.getActivityExportById('user-1', 'export-2');
  assert.equal(exportByIdResponse.data.exportId, 'export-2');
  assert.equal(exportByIdResponse.data.message, 'Activity export ready');

  const download = await service.getActivityExportDownload('user-1', 'export-2');
  assert.equal(download.fileName, 'activity-all-2026-04-04.json');
  assert.equal(download.contentType, 'application/json');
  assert.equal(download.filePath, rebuiltStoragePath);
  assert.deepEqual(markedReadyPayload, {
    exportedCount: 1,
    storagePath: rebuiltStoragePath,
    expiresAt: new Date('2026-04-11T10:00:00.000Z'),
  });
  const materialized = await readFile(download.filePath, 'utf8');
  assert.match(materialized, /"id": "activity-1"/);
}

async function runActivitySavedViewAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  const createdAt = new Date('2026-04-04T11:00:00.000Z');
  const updatedAt = new Date('2026-04-04T11:05:00.000Z');

  service.activitySavedViewRepository = {
    async listViews(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          id: 'view-1',
          userId,
          name: 'Risk review',
          description: 'Unread risk items',
          isDefault: true,
          view: 'grouped',
          groupBy: 'status',
          sortBy: 'status',
          sortOrder: 'asc',
          readState: 'unread',
          filters: { route: 'Risk' },
          createdAt,
          updatedAt,
        },
      ];
    },
    async createView(payload: Record<string, unknown>) {
      return {
        id: 'view-2',
        userId: payload.userId,
        name: payload.name,
        description: payload.description ?? null,
        isDefault: payload.isDefault,
        view: payload.view,
        groupBy: payload.groupBy ?? null,
        sortBy: payload.sortBy,
        sortOrder: payload.sortOrder,
        readState: payload.readState,
        filters: payload.filters ?? null,
        createdAt,
        updatedAt,
      };
    },
    async getViewById(userId: string, viewId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(viewId, 'view-1');
      return {
        id: 'view-1',
        userId,
        name: 'Risk review',
        description: 'Unread risk items',
        isDefault: true,
        view: 'grouped',
        groupBy: 'status',
        sortBy: 'status',
        sortOrder: 'asc',
        readState: 'unread',
        filters: { route: 'Risk' },
        createdAt,
        updatedAt,
      };
    },
    async updateView(_userId: string, _viewId: string, payload: Record<string, unknown>) {
      return {
        id: 'view-1',
        userId: 'user-1',
        name: payload.name,
        description: payload.description ?? null,
        isDefault: payload.isDefault,
        view: payload.view,
        groupBy: payload.groupBy ?? null,
        sortBy: payload.sortBy,
        sortOrder: payload.sortOrder,
        readState: payload.readState,
        filters: payload.filters ?? null,
        createdAt,
        updatedAt,
      };
    },
    async deleteView(userId: string, viewId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(viewId, 'view-1');
      return true;
    },
  };

  const listResponse = await service.listActivitySavedViews('user-1');
  assert.equal(listResponse.data.total, 1);
  assert.equal(listResponse.data.items[0]?.view, 'grouped');

  const createResponse = await service.createActivitySavedView('user-1', {
    name: 'Execution focus',
    view: 'clustered',
    groupBy: 'route',
    sortBy: 'time',
    sortOrder: 'desc',
    readState: 'all',
    stream: 'execution',
  });
  assert.equal(createResponse.data.name, 'Execution focus');
  assert.deepEqual(createResponse.data.filters, { stream: 'execution' });

  const updateResponse = await service.updateActivitySavedView('user-1', 'view-1', {
    name: 'Risk follow-up',
    sortOrder: 'desc',
    route: 'Risk review',
  });
  assert.equal(updateResponse.data.name, 'Risk follow-up');
  assert.deepEqual(updateResponse.data.filters, { route: 'Risk review' });

  const deleteResponse = await service.deleteActivitySavedView('user-1', 'view-1');
  assert.equal(deleteResponse.data.message, 'Activity saved view deleted');
}

async function runActivityReadStateAssertions(): Promise<void> {
  const service = new ActivityService() as any;
  let capturedMarkAllQuery: Record<string, unknown> | null = null;

  service.activitySavedViewRepository = {
    async listViews() {
      return [];
    },
  };
  service.activityRepository = {
    async markActivityRead(userId: string, activityId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(activityId, 'activity-1');
      return true;
    },
    async markActivityUnread(userId: string, activityId: string) {
      assert.equal(userId, 'user-1');
      assert.equal(activityId, 'activity-1');
      return true;
    },
    async markAllActivityRead(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedMarkAllQuery = { ...query };
      return 3;
    },
    async countUnread(userId: string) {
      assert.equal(userId, 'user-1');
      return 4;
    },
  };

  const readResponse = await service.markActivityRead('user-1', 'activity-1');
  assert.equal(readResponse.data.updatedCount, 1);
  assert.equal(readResponse.data.unreadCount, 4);

  const unreadResponse = await service.markActivityUnread('user-1', 'activity-1');
  assert.equal(unreadResponse.data.updatedCount, 1);
  assert.equal(unreadResponse.data.unreadCount, 4);

  const markAllResponse = await service.markAllActivityRead('user-1', {
    stream: 'controls',
    route: 'Risk',
    correlationId: 'corr-1',
    view: 'grouped',
  });
  assert.equal(markAllResponse.data.updatedCount, 3);
  assert.equal(markAllResponse.data.unreadCount, 4);
  assert.deepEqual(capturedMarkAllQuery, {
    type: undefined,
    status: undefined,
    search: undefined,
    stream: 'controls',
    route: 'Risk',
    referenceId: undefined,
    correlationId: 'corr-1',
    related: undefined,
    readState: 'all',
  });
}

function runActivityEntitySchemaAssertions(): void {
  const activityIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === ActivityLog)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_activity_logs_user_created_at',
    'idx_activity_logs_user_stream_created_at',
    'idx_activity_logs_user_status_created_at',
    'idx_activity_logs_user_read_created_at',
    'idx_activity_logs_user_type_created_at',
    'idx_activity_logs_user_symbol_created_at',
    'idx_activity_logs_user_correlation_created_at',
    'idx_activity_logs_user_route_created_at',
    'idx_activity_logs_user_reference_created_at',
    'idx_activity_logs_user_related_created_at',
  ]) {
    assert.ok(activityIndexes.includes(indexName), `ActivityLog should define ${indexName}`);
  }
}

function runActivityExportEntitySchemaAssertions(): void {
  const exportIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === ActivityExport)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_activity_exports_user_created_at',
    'idx_activity_exports_user_status_created_at',
    'idx_activity_exports_status_created_at',
    'idx_activity_exports_expires_at',
    'idx_activity_exports_user_status_signature',
  ]) {
    assert.ok(exportIndexes.includes(indexName), `ActivityExport should define ${indexName}`);
  }
}

function runActivitySavedViewEntitySchemaAssertions(): void {
  const savedViewIndexes = getMetadataArgsStorage().indices
    .filter((entry) => entry.target === ActivitySavedView)
    .map((entry) => entry.name);

  for (const indexName of [
    'idx_activity_saved_views_user_created_at',
    'idx_activity_saved_views_user_default_updated_at',
  ]) {
    assert.ok(savedViewIndexes.includes(indexName), `ActivitySavedView should define ${indexName}`);
  }
}

function runActivityScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:activity'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-activity.ts'
  );
  assert.equal(
    packageScripts['check:activity-health'],
    'node --import tsx scripts/checks/check-activity-health.ts'
  );
  assert.equal(
    packageScripts['release-gate:activity'],
    'node --import tsx scripts/release-gates/release-gate-activity.ts'
  );
  assert.equal(
    packageScripts['signoff:activity'],
    'node --import tsx scripts/signoffs/signoff-activity.ts'
  );
  assert.match(runPackageSuiteSource, /activity:\s*\['test:activity'\]/);
  assert.match(runPackageSuiteSource, /'release-baseline':\s*\[[\s\S]*'test:activity'/);
  assert.equal(
    smokeModulesSource.includes('/activity') && smokeModulesSource.includes('/activity/summary'),
    true,
    'activity smoke should exercise the list and summary surfaces'
  );
}

async function main(): Promise<void> {
  await runActivityControllerAssertions();
  runActivityValidationAssertions();
  await runActivityQueryFilterAssertions();
  await runScopedActivitySummaryAssertions();
  await runActivityGroupingWindowAssertions();
  await runActivityRepositoryNormalizationAssertions();
  await runActivityExportRepositorySignatureAssertions();
  await runLegacyActivityStreamNormalizationAssertions();
  await runActivityMaintenanceAssertions();
  await runActivityDetailAssertions();
  await runActivityStrategyLibraryLinkAssertions();
  await runActivityExportAssertions();
  await runActivitySavedViewAssertions();
  await runActivityReadStateAssertions();
  runActivityEntitySchemaAssertions();
  runActivityExportEntitySchemaAssertions();
  runActivitySavedViewEntitySchemaAssertions();
  runActivityScriptWiringAssertions();
  console.log('Activity module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
