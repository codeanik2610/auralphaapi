import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { InternalSignalsSchedulerController } from '../src/api/controllers/InternalSignalsSchedulerController';
import { SignalsAutomationController } from '../src/api/controllers/SignalsAutomationController';
import { SignalsController } from '../src/api/controllers/SignalsController';
import { SignalsOverviewController } from '../src/api/controllers/SignalsOverviewController';
import { SignalScanService } from '../src/api/services/SignalScanService';
import { SignalsOverviewService } from '../src/api/services/SignalsOverviewService';
import { SignalsSchedulerService } from '../src/api/services/SignalsSchedulerService';
import { SignalsService } from '../src/api/services/SignalsService';
import {
  validatePromoteSignalBody,
  validateRunSignalScanBody,
} from '../src/api/validators/signals.validator';
import { strategyDataSource } from '../src/database/pg-data-source';
import { env } from '../src/env';

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

async function assertBadRequest(run: () => Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 400
  );
}

async function runSignalsControllerAssertions(): Promise<void> {
  const controller: any = new SignalsController();

  controller.signalsService = {
    getSignals: async (...args: unknown[]) => createSuccess({ args }),
    getSignalsSummary: async (...args: unknown[]) => createSuccess({ args }),
    getSignalById: async (...args: unknown[]) => createSuccess({ args }),
    acknowledgeSignal: async (...args: unknown[]) => createSuccess({ args }),
    muteSignal: async (...args: unknown[]) => createSuccess({ args }),
    promoteSignal: async (...args: unknown[]) => createSuccess({ args }),
  };
  controller.signalScanService = {
    runSignalScan: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getSignals(
        authReq,
        '25',
        '5',
        'Triggered',
        'BTCUSDT',
        'Momentum Engine',
        '1h',
        'breakout',
        'clustered'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '25',
        offset: '5',
        status: 'Triggered',
        symbol: 'BTCUSDT',
        source: 'Momentum Engine',
        timeframe: '1h',
        search: 'breakout',
        view: 'clustered',
      },
    ]
  );
  assert.deepEqual(
    (
      await controller.getSignalsSummary(
        authReq,
        'Watching',
        'ETHUSDT',
        'Trend Engine',
        '15m',
        'pullback',
        'inbox'
      )
    ).data.args,
    [
      'user-1',
      {
        status: 'Watching',
        symbol: 'ETHUSDT',
        source: 'Trend Engine',
        timeframe: '15m',
        search: 'pullback',
        view: 'inbox',
      },
    ]
  );
  assert.deepEqual((await controller.getSignalById(authReq, 'sig-1')).data.args, [
    'user-1',
    'sig-1',
  ]);
  assert.deepEqual(
    (
      await controller.runSignalScan(authReq, {
        includeStrategyLibrary: true,
        includeStrategyLab: true,
        maxSources: 4,
      })
    ).data.args,
    [
      'user-1',
      {
        includeStrategyLibrary: true,
        includeStrategyLab: true,
        maxSources: 4,
      },
    ]
  );
  assert.deepEqual(
    (await controller.runSignalScan(authReq, undefined as any)).data.args,
    ['user-1', {}]
  );
  assert.deepEqual(
    (await controller.acknowledgeSignal(authReq, 'sig-1', { note: 'reviewed' })).data.args,
    ['user-1', 'sig-1', { note: 'reviewed' }]
  );
  assert.deepEqual((await controller.muteSignal(authReq, 'sig-2', { reason: 'noise' })).data.args, [
    'user-1',
    'sig-2',
    { reason: 'noise' },
  ]);
  assert.deepEqual(
    (await controller.promoteSignal(authReq, 'sig-3', { target: 'execution_queue' })).data.args,
    ['user-1', 'sig-3', { target: 'execution_queue' }]
  );

  await assertAuthRequired(() => controller.getSignals(unauthReq));
  await assertAuthRequired(() => controller.getSignalsSummary(unauthReq));
  await assertAuthRequired(() => controller.getSignalById(unauthReq, 'sig-1'));
  await assertAuthRequired(() => controller.runSignalScan(unauthReq, {}));
  await assertAuthRequired(() => controller.promoteSignal(unauthReq, 'sig-3', { target: 'alerts' }));
}

async function runSignalsOverviewControllerAssertions(): Promise<void> {
  const controller: any = new SignalsOverviewController();

  controller.signalsOverviewService = {
    getOverview: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getOverview(
        authReq,
        '25',
        '10',
        'Triggered',
        'BTCUSDT',
        'Momentum Engine',
        '1h',
        'breakout',
        'muted'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '25',
        offset: '10',
        status: 'Triggered',
        symbol: 'BTCUSDT',
        source: 'Momentum Engine',
        timeframe: '1h',
        search: 'breakout',
        view: 'muted',
      },
    ]
  );

  await assertAuthRequired(() => controller.getOverview(unauthReq));
}

async function runInternalSignalsSchedulerControllerAssertions(): Promise<void> {
  const controller: any = new InternalSignalsSchedulerController();
  const calls: unknown[][] = [];

  controller.signalScanService = {
    runSignalScan: async (...args: unknown[]) => {
      calls.push(args);
      return createSuccess({ args });
    },
  };

  await assertBadRequest(() => controller.scan({}), 'actorUserId is required');
  assert.equal(calls.length, 0);

  const response = await controller.scan({
    actorUserId: 'user-1',
    includeStrategyLibrary: true,
    includeStrategyLab: false,
    maxSources: 5,
  });
  assert.deepEqual(response.data.args, [
    'user-1',
    {
      includeStrategyLibrary: true,
      includeStrategyLab: false,
      maxSources: 5,
    },
  ]);
  assert.equal(calls.length, 1);
}

async function runSignalsAutomationControllerAssertions(): Promise<void> {
  const controller: any = new SignalsAutomationController();
  const calls: Array<{ method: string; args: unknown[] }> = [];

  controller.signalsAutomationService = {
    getSchedulerConfig: async (...args: unknown[]) => {
      calls.push({ method: 'getSchedulerConfig', args });
      return createSuccess({ args });
    },
    updateSchedulerConfig: async (...args: unknown[]) => {
      calls.push({ method: 'updateSchedulerConfig', args });
      return createSuccess({ args });
    },
    runNow: async (...args: unknown[]) => {
      calls.push({ method: 'runNow', args });
      return createSuccess({ args });
    },
    pauseScheduler: async (...args: unknown[]) => {
      calls.push({ method: 'pauseScheduler', args });
      return createSuccess({ args });
    },
    resumeScheduler: async (...args: unknown[]) => {
      calls.push({ method: 'resumeScheduler', args });
      return createSuccess({ args });
    },
    stopScheduler: async (...args: unknown[]) => {
      calls.push({ method: 'stopScheduler', args });
      return createSuccess({ args });
    },
    restartScheduler: async (...args: unknown[]) => {
      calls.push({ method: 'restartScheduler', args });
      return createSuccess({ args });
    },
    purgeSchedulerLogs: async (...args: unknown[]) => {
      calls.push({ method: 'purgeSchedulerLogs', args });
      return createSuccess({ args });
    },
    getSchedulerPurgePreview: async (...args: unknown[]) => {
      calls.push({ method: 'getSchedulerPurgePreview', args });
      return createSuccess({ args });
    },
    listSchedulerRuns: async (...args: unknown[]) => {
      calls.push({ method: 'listSchedulerRuns', args });
      return createSuccess({ args });
    },
    getSchedulerRunProgress: async (...args: unknown[]) => {
      calls.push({ method: 'getSchedulerRunProgress', args });
      return createSuccess({ args });
    },
    listSchedulerRunUpdates: async (...args: unknown[]) => {
      calls.push({ method: 'listSchedulerRunUpdates', args });
      return createSuccess({ args });
    },
    exportSchedulerRunUpdates: async (...args: unknown[]) => {
      calls.push({ method: 'exportSchedulerRunUpdates', args });
      return createSuccess({ args });
    },
  };

  const cases: Array<{
    label: string;
    method: string;
    args?: unknown[];
    expectedArgs: unknown[];
  }> = [
    {
      label: 'config',
      method: 'getConfig',
      expectedArgs: ['user-1'],
    },
    {
      label: 'update',
      method: 'updateConfig',
      args: [{ enabled: true, sources: ['strategy_library'] }],
      expectedArgs: ['user-1', { enabled: true, sources: ['strategy_library'] }],
    },
    {
      label: 'run',
      method: 'runNow',
      expectedArgs: ['user-1'],
    },
    {
      label: 'pause',
      method: 'pause',
      expectedArgs: ['user-1'],
    },
    {
      label: 'resume',
      method: 'resume',
      expectedArgs: ['user-1'],
    },
    {
      label: 'stop',
      method: 'stop',
      expectedArgs: ['user-1'],
    },
    {
      label: 'restart',
      method: 'restart',
      expectedArgs: ['user-1'],
    },
    {
      label: 'purge logs',
      method: 'purgeLogs',
      expectedArgs: ['user-1'],
    },
    {
      label: 'purge preview',
      method: 'purgeLogsPreview',
      expectedArgs: ['user-1'],
    },
    {
      label: 'runs',
      method: 'listRuns',
      args: ['10', '5'],
      expectedArgs: ['user-1', { limit: '10', offset: '5' }],
    },
    {
      label: 'run progress',
      method: 'getRunProgress',
      args: ['run-1'],
      expectedArgs: ['user-1', 'run-1'],
    },
    {
      label: 'run updates',
      method: 'listRunUpdates',
      args: ['run-1', '25', '0', 'upsert', 'signals-scan', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          limit: '25',
          offset: '0',
          actionType: 'upsert',
          source: 'signals-scan',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
    {
      label: 'run updates export',
      method: 'exportRunUpdates',
      args: ['run-1', 'upsert', 'signals-scan', 'BTCUSDT', 'symbol', 'desc'],
      expectedArgs: [
        'user-1',
        'run-1',
        {
          actionType: 'upsert',
          source: 'signals-scan',
          symbol: 'BTCUSDT',
          sortBy: 'symbol',
          sortOrder: 'desc',
        },
      ],
    },
  ];

  for (const testCase of cases) {
    const beforeCalls = calls.length;
    await assertAuthRequired(() =>
      controller[testCase.method](unauthReq, ...(testCase.args || []))
    );
    assert.equal(calls.length, beforeCalls, `${testCase.label} should reject unauthenticated access`);

    const response = await controller[testCase.method](authReq, ...(testCase.args || []));
    assert.deepEqual(response.data.args, testCase.expectedArgs);
    assert.equal(calls.length, beforeCalls + 1, `${testCase.label} should call the service once`);
  }
}

function runSignalsValidationAssertions(): void {
  assert.deepEqual(validatePromoteSignalBody({ target: 'execution_queue' }), {
    target: 'execution_queue',
  });
  assert.deepEqual(validatePromoteSignalBody({ target: 'orders' }), {
    target: 'execution_queue',
  });
  assert.deepEqual(validateRunSignalScanBody(undefined), {
    includeStrategyLibrary: true,
    includeStrategyLab: false,
    maxSources: 12,
  });
  assert.deepEqual(
    validateRunSignalScanBody({
      includeStrategyLibrary: false,
      includeStrategyLab: true,
      maxSources: 6,
    }),
    {
      includeStrategyLibrary: false,
      includeStrategyLab: true,
      maxSources: 6,
    }
  );
  assert.throws(
    () =>
      validateRunSignalScanBody({
        includeStrategyLibrary: false,
        includeStrategyLab: false,
      }),
    /At least one source must be enabled/
  );
}

async function runSignalsOverviewServiceAssertions(): Promise<void> {
  const service = new SignalsOverviewService() as any;
  let capturedListQuery: Record<string, unknown> | null = null;
  const capturedSummaryQueries: Array<Record<string, unknown>> = [];
  let capturedSchedulerRunsQuery: Record<string, unknown> | null = null;

  service.signalsService = {
    async getSignals(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedListQuery = { ...query };
      return createSuccess({
        items: [{ id: 'sig-1' }],
        total: 1,
        limit: 25,
        offset: 0,
      });
    },
    async getSignalsSummary(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedSummaryQueries.push({ ...query });

      const view = String(query.view || 'inbox');
      if (view === 'clustered') {
        return createSuccess({
          liveSignals: 3,
          triggered: 2,
          watching: 1,
          queued: 1,
          muted: 0,
          highConfidence: 2,
          mutedOrQueued: 1,
        });
      }
      if (view === 'muted') {
        return createSuccess({
          liveSignals: 2,
          triggered: 0,
          watching: 0,
          queued: 0,
          muted: 2,
          highConfidence: 0,
          mutedOrQueued: 2,
        });
      }
      return createSuccess({
        liveSignals: 5,
        triggered: 3,
        watching: 1,
        queued: 1,
        muted: 0,
        highConfidence: 2,
        mutedOrQueued: 1,
      });
    },
  };
  service.signalsSchedulerService = {
    async getSchedulerConfig(userId: string) {
      assert.equal(userId, 'user-1');
      return createSuccess({
        enabled: true,
        sources: ['strategy-library'],
        lastStartedAt: '2026-04-04T09:00:00.000Z',
        lastFinishedAt: '2026-04-04T09:03:00.000Z',
        lastStatus: 'Completed',
        lastError: null,
      });
    },
    async listSchedulerRuns(userId: string, query: Record<string, unknown>) {
      assert.equal(userId, 'user-1');
      capturedSchedulerRunsQuery = { ...query };
      return createSuccess({
        items: [
          {
            id: 'run-1',
            status: 'Running',
            startedAt: '2026-04-04T10:00:00.000Z',
            finishedAt: undefined,
          },
        ],
        total: 1,
        limit: 1,
        offset: 0,
      });
    },
  };

  const response = await service.getOverview('user-1', {
    limit: '25',
    offset: '0',
    status: 'Triggered',
    symbol: 'BTCUSDT',
    source: 'Momentum Engine',
    timeframe: '1h',
    search: 'breakout',
    view: 'muted',
  });

  assert.deepEqual(capturedListQuery, {
    limit: '25',
    offset: '0',
    status: 'Triggered',
    symbol: 'BTCUSDT',
    source: 'Momentum Engine',
    timeframe: '1h',
    search: 'breakout',
    view: 'muted',
  });
  assert.deepEqual(capturedSummaryQueries, [
    {
      limit: '25',
      offset: '0',
      status: 'Triggered',
      symbol: 'BTCUSDT',
      source: 'Momentum Engine',
      timeframe: '1h',
      search: 'breakout',
      view: 'muted',
    },
    {
      limit: '25',
      offset: '0',
      status: 'Triggered',
      symbol: 'BTCUSDT',
      source: 'Momentum Engine',
      timeframe: '1h',
      search: 'breakout',
      view: 'inbox',
    },
    {
      limit: '25',
      offset: '0',
      status: 'Triggered',
      symbol: 'BTCUSDT',
      source: 'Momentum Engine',
      timeframe: '1h',
      search: 'breakout',
      view: 'clustered',
    },
    {
      limit: '25',
      offset: '0',
      status: 'Triggered',
      symbol: 'BTCUSDT',
      source: 'Momentum Engine',
      timeframe: '1h',
      search: 'breakout',
      view: 'muted',
    },
  ]);
  assert.deepEqual(capturedSchedulerRunsQuery, {
    limit: '1',
    offset: '0',
  });
  assert.equal(response.data.summary.muted, 2);
  assert.equal(
    response.data.cards.find((card: { id: string; value: number }) => card.id === 'clusters')
      ?.value,
    3
  );
  assert.equal(
    response.data.tabs.find((tab: { id: string; selected: boolean }) => tab.id === 'muted')
      ?.selected,
    true
  );
  assert.equal(response.data.quickActions[2]?.id, 'pause_scan');
  assert.equal(
    response.data.quickActions.find((action: { id: string }) => action.id === 'scan_settings')
      ?.target,
    '/suggested-trades?tab=signals'
  );
  assert.equal(response.data.scanStatus.state, 'running');
  assert.equal(response.data.scanStatus.schedulerKey, 'signals-scan-sync');
  assert.equal(response.data.scanStatus.activeRunId, 'run-1');
  assert.equal(
    response.data.journey.steps.find(
      (step: { id: string; state: string }) => step.id === 'signal_muted'
    )?.state,
    'current'
  );
}

async function runSignalPresentationAssertions(): Promise<void> {
  const service = new SignalsService() as any;

  const listSignal = {
    id: 'sig-1',
    symbol: 'BTCUSDT',
    source: 'Momentum Engine',
    confidence: 0.91,
    direction: 'Long',
    timeframe: '1h',
    status: 'Triggered',
    regime: 'Trending',
    aiScore: 88,
    thesis: 'Breakout continuation',
    route: 'signals',
    createdAt: new Date('2026-04-04T10:00:00.000Z'),
    updatedAt: new Date('2026-04-04T10:02:00.000Z'),
    market: 'crypto-futures',
    signalTime: new Date('2026-04-04T09:59:00.000Z'),
    entryPrice: '100',
    sourceRefType: 'strategy_library',
    sourceRefId: 'template-1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    riskNote: 'Keep size controlled',
    promotionState: null,
    metadata: null,
    actions: [],
  };

  const detailSignal = {
    ...listSignal,
    status: 'Watching',
    actions: [
      {
        actionType: 'promote',
        target: 'execution_queue',
        metadata: {
          targetId: 'st-1',
          targetName: 'BTCUSDT 1h BUY',
          targetUrl: '/suggested-trades?selected=st-1',
          targetEntity: 'suggested-trade',
          promotionState: 'Execution queue item created',
        },
      },
    ],
  };

  service.signalRepository = {
    async listSignals() {
      return {
        data: [listSignal],
        total: 1,
      };
    },
    async getSignalById() {
      return detailSignal;
    },
    async getSignalSummary() {
      return {
        liveSignals: 1,
        triggered: 1,
        watching: 0,
        queued: 0,
        muted: 0,
        highConfidence: 1,
        mutedOrQueued: 0,
      };
    },
  };
  service.signalAlertLinkRepository = {
    async listLinkedAlertIds(userId: string, signalId: string, limit: number) {
      assert.equal(userId, 'user-1');
      assert.equal(signalId, 'sig-1');
      assert.equal(limit, 6);
      return ['alert-1'];
    },
  };
  service.alertRepository = {
    async getAlertsByIds(userId: string, alertIds: string[]) {
      assert.equal(userId, 'user-1');
      assert.deepEqual(alertIds, ['alert-1', 'st-1']);
      return [
        {
          id: 'alert-1',
          severity: 'High',
          channel: 'Signals',
          symbol: 'BTCUSDT',
          message: 'Review breakout',
          route: 'Signal review',
          status: 'Open',
          source: 'signals',
          urgency: 'Immediate review',
          createdAt: new Date('2026-04-04T10:03:00.000Z'),
          updatedAt: new Date('2026-04-04T10:04:00.000Z'),
        },
      ];
    },
  };

  const listResponse = await service.getSignals('user-1', {});
  assert.deepEqual(listResponse.data.items[0]?.allowedActions, [
    'acknowledge',
    'mute',
    'promote_strategy',
    'promote_execution_queue',
    'promote_alerts',
    'promote_automations',
  ]);
  assert.equal(listResponse.data.items[0]?.statusReason, 'Fresh signal awaiting review');
  assert.equal(listResponse.data.items[0]?.statusDisplay, 'Needs Review');
  assert.equal(listResponse.data.items[0]?.freshness?.source, 'signal');
  assert.equal(listResponse.data.items[0]?.queueStage, 'inbox');
  assert.equal(listResponse.data.items[0]?.journeyStage, 'signal_detected');

  const detailResponse = await service.getSignalById('user-1', 'sig-1');
  assert.equal(detailResponse.data.statusDisplay, 'Watching');
  assert.equal(detailResponse.data.journeyStage, 'signal_review');
  assert.ok(
    detailResponse.data.linkedEntities?.some(
      (entity: { entity: string }) => entity.entity === 'alert'
    )
  );
  assert.ok(
    detailResponse.data.linkedEntities?.some(
      (entity: { entity: string }) => entity.entity === 'suggested-trade'
    )
  );
}

async function runSignalsSchedulerConfigAssertions(): Promise<void> {
  const service = new SignalsSchedulerService() as any;
  const updateCalls: Array<Record<string, unknown>> = [];
  let storedConfig: Record<string, any> = {
    id: 'signals-user-config-1',
    schedulerKey: 'signals-scan-sync',
    userId: 'user-1',
    name: 'Signals Scan',
    description: 'Scans active strategy library entries to refresh the Signals inbox.',
    enabled: false,
    cronExpression: '0 1 * * *',
    timezone: 'UTC',
    runAt: '01:00',
    intervalDays: 1,
    batchSize: 12,
    schedulerType: 'user',
    config: {
      sources: ['strategy_library'],
      retentionDays: 30,
      scheduleMode: 'every_n_minutes',
      intervalMinutes: 15,
    },
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    runningLockUntil: null,
    createdAt: new Date('2026-04-06T00:00:00.000Z'),
    updatedAt: new Date('2026-04-06T00:00:00.000Z'),
  };

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'Asia/Kolkata';
    },
  };
  service.ensureSchedulerConfig = async (userId: string, timeZone: string) => {
    assert.equal(userId, 'user-1');
    assert.equal(timeZone, 'Asia/Kolkata');
    return storedConfig;
  };
  service.schedulerUserConfigRepository = {
    async updateBySchedulerKeyAndUserId(
      schedulerKey: string,
      userId: string,
      payload: Record<string, unknown>
    ) {
      assert.equal(schedulerKey, 'signals-scan-sync');
      assert.equal(userId, 'user-1');
      updateCalls.push(payload);
      storedConfig = {
        ...storedConfig,
        ...payload,
        config: payload.config
          ? { ...(payload.config as Record<string, unknown>) }
          : storedConfig.config,
      };
      return storedConfig;
    },
  };
  service.schedulerCommandRepository = {
    async cancelPendingBySchedulerKeyAndActor() {
      return 0;
    },
  };
  service.schedulerRunLogRepository = {
    async cancelQueuedRunsBySchedulerKeyAndActor() {
      return 0;
    },
  };
  service.logSchedulerActivity = async () => {};

  const getResponse = await service.getSchedulerConfig('user-1');
  assert.equal(getResponse.data.key, 'signals-scan-sync');
  assert.equal(getResponse.data.timezone, 'Asia/Kolkata');
  assert.equal(getResponse.data.scheduleMode, 'every_n_minutes');
  assert.equal(getResponse.data.intervalMinutes, 15);
  assert.deepEqual(getResponse.data.sources, ['strategy_library']);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].schedulerType, 'user');
  assert.equal(updateCalls[0].timezone, 'Asia/Kolkata');

  const updateResponse = await service.updateSchedulerConfig('user-1', {
    enabled: true,
    batchSize: 20,
    sources: ['strategy_library', 'strategy_library', 'ignored-source'],
    scheduleMode: 'every_n_minutes',
    intervalMinutes: 15,
    retentionDays: 21,
  });
  assert.equal(updateCalls.length, 2);
  assert.equal(updateCalls[1].enabled, true);
  assert.equal(updateCalls[1].batchSize, 20);
  assert.equal(updateCalls[1].schedulerType, 'user');
  assert.deepEqual(updateCalls[1].config, {
    sources: ['strategy_library'],
    retentionDays: 21,
    scheduleMode: 'every_n_minutes',
    intervalMinutes: 15,
  });
  assert.equal(updateResponse.data.enabled, true);
  assert.equal(updateResponse.data.batchSize, 20);
  assert.equal(updateResponse.data.retentionDays, 21);
  assert.deepEqual(updateResponse.data.sources, ['strategy_library']);
}

async function runSignalsSchedulerRunNowAssertions(): Promise<void> {
  const service = new SignalsSchedulerService() as any;
  const originalExecutionMode = env.scheduler.executionMode;
  let createdRun: Record<string, any> | null = null;
  let createdCommand: Record<string, any> | null = null;

  env.scheduler.executionMode = 'queue';

  service.userTimeZoneService = {
    async resolveUserTimeZone(userId: string) {
      assert.equal(userId, 'user-1');
      return 'UTC';
    },
  };
  service.ensureSchedulerConfig = async (userId: string, timeZone: string) => {
    assert.equal(userId, 'user-1');
    assert.equal(timeZone, 'UTC');
    return {
      schedulerKey: 'signals-scan-sync',
      userId: 'user-1',
      name: 'Signals Scan',
      description: 'Scans active strategy library entries to refresh the Signals inbox.',
      enabled: true,
      cronExpression: '0 1 * * *',
      timezone: 'UTC',
      runAt: '01:00',
      intervalDays: 1,
      batchSize: 7,
      schedulerType: 'user',
      config: {
        sources: ['strategy_library'],
        retentionDays: 30,
      },
      lastStartedAt: null,
      lastFinishedAt: null,
      lastStatus: null,
      lastError: null,
      runningLockUntil: null,
      createdAt: new Date('2026-04-06T00:00:00.000Z'),
      updatedAt: new Date('2026-04-06T00:00:00.000Z'),
    };
  };
  service.schedulerCommandRepository = {
    async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
      schedulerKey: string,
      commandType: string,
      actorUserId: string,
      statuses: string[]
    ) {
      assert.equal(schedulerKey, 'signals-scan-sync');
      assert.equal(commandType, 'run_now');
      assert.equal(actorUserId, 'user-1');
      assert.deepEqual(statuses, ['Pending', 'Processing']);
      return null;
    },
    async createCommand(payload: Record<string, unknown>) {
      createdCommand = payload;
      return { id: 'cmd-1', ...payload };
    },
  };
  service.schedulerRunLogRepository = {
    async hasRunningRunBySchedulerKeyAndActor(schedulerKey: string, actorUserId: string) {
      assert.equal(schedulerKey, 'signals-scan-sync');
      assert.equal(actorUserId, 'user-1');
      return false;
    },
    async createRun(payload: Record<string, unknown>) {
      createdRun = payload;
      return payload;
    },
  };
  service.logSchedulerActivity = async () => {};
  service.emitSchedulerFailureAlert = async () => {};

  try {
    const response = await service.runNow('user-1');
    assert.equal(response.data.queued, true);
    assert.equal(response.data.executionMode, 'queue');
    assert.equal(response.data.started, false);
    assert.equal(response.data.jobId, 'cmd-1');
    assert.equal(response.data.message, 'Signals scheduler command queued for 1 source(s)');
    assert.ok(createdRun);
    assert.ok(createdCommand);
    const queuedRun = createdRun as Record<string, any>;
    const queuedCommand = createdCommand as Record<string, any>;
    assert.equal(queuedRun.schedulerKey, 'signals-scan-sync');
    assert.equal(queuedRun.actorUserId, 'user-1');
    assert.deepEqual(queuedRun.meta.signals, {
      sources: ['strategy_library'],
      maxSources: 7,
    });
    assert.equal(queuedCommand.schedulerKey, 'signals-scan-sync');
    assert.equal(queuedCommand.commandType, 'run_now');
    assert.equal(queuedCommand.actorUserId, 'user-1');
    assert.deepEqual(queuedCommand.payload.sources, ['strategy_library']);
    assert.equal(queuedCommand.payload.maxSources, 7);
  } finally {
    env.scheduler.executionMode = originalExecutionMode;
  }
}

async function runSignalScanServiceSuccessAssertions(): Promise<void> {
  const service = new SignalScanService() as any;
  const originalIsInitialized = (strategyDataSource as any).isInitialized;
  const originalInitialize = (strategyDataSource as any).initialize;
  const upsertPayloads: Array<Record<string, unknown>> = [];
  const activityCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];
  const alertCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];

  (strategyDataSource as any).isInitialized = true;
  (strategyDataSource as any).initialize = async () => strategyDataSource;

  service.loadCandidates = async (userId: string, options: Record<string, unknown>) => {
    assert.equal(userId, 'user-1');
    assert.deepEqual(options, {
      includeStrategyLibrary: true,
      includeStrategyLab: false,
      maxSources: 5,
    });
    return [
      {
        userId: 'user-1',
        sourceRefType: 'strategy_library',
        sourceRefId: 'lib-1',
        sourceName: 'Momentum Runner',
        templateId: 'tpl-1',
        templateName: 'Momentum Template',
        templateVersion: 2,
        templateConfig: {
          parameters: {
            signalThreshold: 0.87,
          },
        },
        symbols: ['BTCUSDT'],
        timeframes: ['1h'],
        market: 'crypto-futures',
        updatedAt: new Date('2026-04-06T08:00:00.000Z'),
        metadata: {
          scope: 'library',
        },
      },
    ];
  };
  service.automationSignalEvaluatorService = {
    async evaluateLatestSignals(payload: Record<string, unknown>) {
      assert.equal(payload.templateId, 'tpl-1');
      assert.equal(payload.templateName, 'Momentum Template');
      assert.deepEqual(payload.symbols, ['BTCUSDT']);
      assert.equal(payload.timeframe, '1h');
      return {
        items: [
          {
            symbol: 'BTCUSDT',
            timeframe: '1h',
            status: 'ok',
            signalTime: '2026-04-06T09:00:00.000Z',
            entryPrice: 102.5,
            longEntry: true,
            longEntryPrevious: false,
            longExit: false,
          },
        ],
        evaluatedSymbols: 1,
        skippedSymbols: 0,
      };
    },
  };
  service.signalRepository = {
    async upsertSignals(payloads: Array<Record<string, unknown>>) {
      upsertPayloads.push(...payloads);
      return {
        inserted: 1,
        updated: 0,
      };
    },
  };
  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      activityCalls.push({ userId, payload });
    },
    async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
      alertCalls.push({ userId, payload });
    },
  };

  try {
    const response = await service.runSignalScan('user-1', {
      includeStrategyLibrary: true,
      includeStrategyLab: false,
      maxSources: 5,
    });

    assert.equal(response.data.scannedSources, 1);
    assert.equal(response.data.skippedSources, 0);
    assert.equal(response.data.evaluationsRun, 1);
    assert.equal(response.data.evaluatedSymbols, 1);
    assert.equal(response.data.detectedSignals, 1);
    assert.equal(response.data.insertedSignals, 1);
    assert.equal(response.data.updatedSignals, 0);
    assert.equal(response.data.sources[0]?.status, 'completed');
    assert.equal(upsertPayloads.length, 1);
    assert.equal(upsertPayloads[0].symbol, 'BTCUSDT');
    assert.equal(upsertPayloads[0].source, 'Momentum Runner');
    assert.equal(upsertPayloads[0].timeframe, '1h');
    assert.equal(upsertPayloads[0].direction, 'Long');
    assert.equal(upsertPayloads[0].status, 'Triggered');
    assert.equal(upsertPayloads[0].aiScore, 87);
    assert.equal(upsertPayloads[0].sourceRefType, 'strategy_library');
    assert.equal(activityCalls.length, 1);
    assert.equal(activityCalls[0].userId, 'user-1');
    assert.equal(activityCalls[0].payload.title, 'Signal scan completed');
    assert.equal(alertCalls.length, 0);
  } finally {
    (strategyDataSource as any).isInitialized = originalIsInitialized;
    (strategyDataSource as any).initialize = originalInitialize;
  }
}

async function runSignalScanServiceFailureAssertions(): Promise<void> {
  const service = new SignalScanService() as any;
  const originalIsInitialized = (strategyDataSource as any).isInitialized;
  const originalInitialize = (strategyDataSource as any).initialize;
  const activityCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];
  const alertCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];

  (strategyDataSource as any).isInitialized = true;
  (strategyDataSource as any).initialize = async () => strategyDataSource;

  service.loadCandidates = async () => {
    throw new Error('scan exploded');
  };
  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      activityCalls.push({ userId, payload });
    },
    async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
      alertCalls.push({ userId, payload });
    },
  };

  try {
    await assert.rejects(() => service.runSignalScan('user-1', {}), /scan exploded/);
    assert.equal(activityCalls.length, 1);
    assert.equal(activityCalls[0].payload.status, 'Failed');
    assert.equal(activityCalls[0].payload.title, 'Signal scan failed');
    assert.equal(alertCalls.length, 1);
    assert.equal(alertCalls[0].payload.source, 'signals-scan');
  } finally {
    (strategyDataSource as any).isInitialized = originalIsInitialized;
    (strategyDataSource as any).initialize = originalInitialize;
  }
}

function runSignalScanFallbackTradePlanAssertions(): void {
  const service = new SignalScanService() as any;
  const events = service.buildFallbackEvents({
    symbol: 'BTCUSDT',
    timeframe: '1h',
    status: 'ok',
    signalTime: '2026-04-06T09:00:00.000Z',
    entryPrice: 102.5,
    longEntry: true,
    longEntryPrevious: false,
    longExit: false,
    shortEntry: true,
    shortEntryPrevious: false,
    shortExit: false,
  });

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event: Record<string, unknown>) => event.tradePlan),
    [null, null]
  );
}

function runSignalsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:signals'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-signals.ts'
  );
  assert.equal(
    smokeModulesSource.includes('/signals') && smokeModulesSource.includes('/signals/summary'),
    true,
    'signals module smoke should exercise the list and summary surfaces'
  );
  assert.equal(
    packageScripts['check:signals-health'],
    'node --import tsx scripts/checks/check-signals-health.ts'
  );
  assert.equal(
    packageScripts['release-gate:signals'],
    'node --import tsx scripts/release-gates/release-gate-signals.ts'
  );
  assert.equal(
    packageScripts['signoff:signals'],
    'node --import tsx scripts/signoffs/signoff-signals.ts'
  );
}

async function main(): Promise<void> {
  await runSignalsControllerAssertions();
  await runSignalsOverviewControllerAssertions();
  await runInternalSignalsSchedulerControllerAssertions();
  await runSignalsAutomationControllerAssertions();
  runSignalsValidationAssertions();
  await runSignalsOverviewServiceAssertions();
  await runSignalPresentationAssertions();
  await runSignalsSchedulerConfigAssertions();
  await runSignalsSchedulerRunNowAssertions();
  await runSignalScanServiceSuccessAssertions();
  await runSignalScanServiceFailureAssertions();
  runSignalScanFallbackTradePlanAssertions();
  runSignalsScriptWiringAssertions();
  console.log('Signals module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
