import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { AutomationsController } from '../src/api/controllers/AutomationsController';
import { InternalAutomationsController } from '../src/api/controllers/InternalAutomationsController';
import { SignalsAutomationController } from '../src/api/controllers/SignalsAutomationController';
import { AutomationsService } from '../src/api/services/AutomationsService';
import { AutomationExecutionService } from '../src/api/services/AutomationExecutionService';
import { AutomationSignalEvaluatorService } from '../src/api/services/AutomationSignalEvaluatorService';
import { WhatsappNotificationsService } from '../src/api/services/WhatsappNotificationsService';
import { env } from '../src/env';
import {
  validateAutomationCreateBody,
  validateAutomationDeleteBody,
  validateAutomationUpdateBody,
} from '../src/api/validators/automations.validator';
import {
  computeNextRun,
  normalizeAutomationScheduleRecord,
  resolveAutomationSchedule,
} from '../src/api/utils/automationSchedule';
import { AutomationRepository } from '../src/database/repositories/AutomationRepository';
import { coreDataSource } from '../src/database/data-source';

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

async function assertTradeSuggestionRuntimeContract(
  config: Record<string, unknown>,
  expectations: { templateId: string; symbols: string[]; timeframe: string }
): Promise<void> {
  const executionService = new AutomationExecutionService() as any;
  executionService.strategyTemplateRepository = {
    getStrategyTemplateById: async (_userId: string, templateId: string) => {
      assert.equal(templateId, expectations.templateId);
      return {
        id: templateId,
        config: {
          market: 'crypto-futures',
          entryLogic: 'ema(20) > ema(50)',
          exitLogic: 'ema(20) < ema(50)',
          risk: {
            stopLossPct: 2,
            takeProfitTargetsPct: [4],
          },
          parameters: {
            signalThreshold: '0.81',
          },
        },
      };
    },
  };

  const resolved = await executionService.resolveTradeSuggestionProfile('user-1', config);
  assert.equal(resolved.sourceTemplateId, expectations.templateId);
  assert.equal(resolved.profile.automationReady, true);
  assert.deepEqual(executionService.resolveTradeSuggestionSymbols(config), expectations.symbols);
  assert.equal(executionService.resolveTradeSuggestionTimeframe(config), expectations.timeframe);
}

async function runAutomationsControllerAssertions(): Promise<void> {
  const controller: any = new AutomationsController();

  controller.automationsService = {
    getAutomations: async (...args: unknown[]) => createSuccess({ args }),
    getAutomationsSummary: async () => createSuccess({ ok: true }),
    getAutomationById: async (...args: unknown[]) => createSuccess({ args }),
    getAutomationDeletePreview: async (...args: unknown[]) => createSuccess({ args }),
    hardDeleteAutomation: async (...args: unknown[]) => createSuccess({ args }),
    runAutomationNow: async (...args: unknown[]) => createSuccess({ args }),
    pauseAutomation: async (...args: unknown[]) => createSuccess({ args }),
    resumeAutomation: async (...args: unknown[]) => createSuccess({ args }),
    reconcileAutomationState: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.getAutomations(authReq, undefined, undefined, 'Running', 'BTC')).data.args,
    ['user-1', { limit: undefined, offset: undefined, status: 'Running', search: 'BTC' }]
  );
  assert.deepEqual((await controller.getAutomationsSummary(authReq)).data, { ok: true });
  assert.deepEqual((await controller.getAutomationById(authReq, 'bot-1')).data.args, [
    'user-1',
    'bot-1',
  ]);
  assert.deepEqual((await controller.getAutomationDeletePreview(authReq, 'bot-1')).data.args, [
    'user-1',
    'bot-1',
  ]);
  assert.deepEqual(
    (
      await controller.hardDeleteAutomation(authReq, 'bot-1', {
        confirmName: 'Momentum',
        confirmPhrase: 'DELETE AUTOMATION',
        reason: 'cleanup retired automation',
        previewToken: 'token',
      })
    ).data.args,
    [
      'user-1',
      'bot-1',
      {
        confirmName: 'Momentum',
        confirmPhrase: 'DELETE AUTOMATION',
        reason: 'cleanup retired automation',
        previewToken: 'token',
      },
    ]
  );
  assert.deepEqual((await controller.runAutomationNow(authReq, 'bot-1')).data.args, [
    'user-1',
    'bot-1',
  ]);
  assert.deepEqual(
    (await controller.pauseAutomation(authReq, 'bot-1', { reason: 'pause' })).data.args,
    ['user-1', 'bot-1', { reason: 'pause' }]
  );
  assert.deepEqual(
    (await controller.resumeAutomation(authReq, 'bot-2', { reason: 'resume' })).data.args,
    ['user-1', 'bot-2', { reason: 'resume' }]
  );
  assert.deepEqual(
    (await controller.reconcileAutomationState(authReq, 'bot-3', { reason: 'repair' })).data.args,
    ['user-1', 'bot-3', { reason: 'repair' }]
  );
}

async function runInternalAutomationsControllerAssertions(): Promise<void> {
  const controller: any = new InternalAutomationsController();
  const calls: unknown[][] = [];

  controller.automationExecutionService = {
    execute: async (...args: unknown[]) => {
      calls.push(args);
      return { status: 'started', runId: 'run-1' };
    },
  };

  const body = {
    automationId: 'automation-1',
    actorUserId: 'user-1',
    trigger: 'manual',
  };

  const response = await controller.execute(body);
  assert.deepEqual(response.data, { status: 'started', runId: 'run-1' });
  assert.deepEqual(calls, [[body]]);
}

async function runSignalsAutomationControllerAssertions(): Promise<void> {
  const controller: any = new SignalsAutomationController();
  const calls: unknown[][] = [];

  controller.signalsAutomationService = {
    getSchedulerConfig: async (...args: unknown[]) => {
      calls.push(args);
      return createSuccess({ args });
    },
  };

  await assertAuthRequired(() => controller.getConfig(unauthReq));

  const response = await controller.getConfig(authReq);
  assert.deepEqual(response.data.args, ['user-1']);
  assert.deepEqual(calls, [['user-1']]);
}

async function runAutomationScopeLookupAssertions(): Promise<void> {
  const repository = new AutomationRepository();
  const originalGetRepository = coreDataSource.getRepository.bind(coreDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    async getOne() {
      return {
        id: 'automation-match-1',
        sourceBacktestId: 'backtest-1',
        scopeSymbol: 'ETHUSDT',
        scopeTimeframe: '4h',
      };
    },
  };

  (coreDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const automation = await repository.findTradeSuggestionAutomationByScope({
      userId: 'user-1',
      backtestId: 'backtest-1',
      symbol: 'ethusdt',
      timeframe: '4H',
    });

    assert.equal(automation?.id, 'automation-match-1');
    assert.deepEqual(capturedWhereClauses, [
      { clause: 'automation.userId = :userId', params: { userId: 'user-1' } },
      {
        clause:
          '(automation.automationType IN (:...automationTypes) OR automation.automationType IS NULL)',
        params: { automationTypes: ['trade-suggestion', 'strategy'] },
      },
      {
        clause: 'automation.sourceBacktestId = :backtestId',
        params: { backtestId: 'backtest-1' },
      },
      { clause: 'automation.scopeSymbol = :scopeSymbol', params: { scopeSymbol: 'ETHUSDT' } },
      { clause: 'automation.scopeTimeframe = :scopeTimeframe', params: { scopeTimeframe: '4h' } },
    ]);
  } finally {
    (coreDataSource as any).getRepository = originalGetRepository;
  }
}

async function runAutomationRepositorySearchAssertions(): Promise<void> {
  const repository = new AutomationRepository();
  const originalGetRepository = coreDataSource.getRepository.bind(coreDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    orderBy() {
      return this;
    },
    skip() {
      return this;
    },
    take() {
      return this;
    },
    async getManyAndCount() {
      return [[], 0] as const;
    },
  };

  (coreDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listAutomations({
      userId: 'user-1',
      limit: 20,
      offset: 5,
      status: 'Running',
      search: ' BTCUSDT_100% ',
    });

    assert.equal(response.total, 0);
    assert.equal(capturedWhereClauses.length, 3);
    assert.equal(capturedWhereClauses[0].clause, 'automation.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'automation.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Running' });
    assert.equal(
      capturedWhereClauses[2].clause,
      "(MATCH(automation.searchText) AGAINST (:search IN BOOLEAN MODE) OR LOWER(automation.searchText) LIKE :searchLike ESCAPE '\\' OR automation.scopeSymbol = :scopeSymbol OR automation.scopeTimeframe = :scopeTimeframe OR automation.sourceBacktestId = :scopeReference OR automation.sourceTemplateId = :scopeReference)"
    );
    assert.deepEqual(capturedWhereClauses[2].params, {
      search: '+btcusdt_100*',
      searchLike: '%btcusdt\\_100\\%%',
      scopeSymbol: 'BTCUSDT_100%',
      scopeTimeframe: 'btcusdt_100%',
      scopeReference: 'btcusdt_100%',
    });
  } finally {
    (coreDataSource as any).getRepository = originalGetRepository;
  }
}

async function runAutomationRepositoryIndexingAssertions(): Promise<void> {
  const repository = new AutomationRepository();
  const originalGetRepository = coreDataSource.getRepository.bind(coreDataSource);
  const createdPayloads: Array<Record<string, unknown>> = [];
  const savedPayloads: Array<Record<string, unknown>> = [];

  (coreDataSource as any).getRepository = () => ({
    create: (payload: Record<string, unknown>) => {
      createdPayloads.push({ ...payload });
      return { ...payload };
    },
    save: async (payload: Record<string, unknown>) => {
      savedPayloads.push({ ...payload });
      return payload;
    },
    find: async () => [
      {
        id: 'automation-legacy-1',
        userId: 'user-1',
        name: 'Legacy Alert Confirm',
        strategy: 'Alert Confirm',
        broker: 'paper',
        market: 'crypto-futures',
        trigger: 'every 15m',
        status: 'Running',
        automationType: 'strategy',
        timeZone: 'UTC',
        config: {
          backtestId: 'backtest-legacy',
          symbol: 'ldousdt',
          timeframe: '15M',
          config: {
            templateId: 'template-legacy',
            sourceTemplateId: 'template-legacy',
          },
        },
        searchText: null,
        sourceBacktestId: null,
        scopeSymbol: null,
        scopeTimeframe: null,
        sourceTemplateId: null,
      },
    ],
  });

  try {
    await repository.createAutomation({
      userId: 'user-1',
      name: 'Momentum BTC Runner',
      strategy: 'Momentum Base',
      broker: 'paper',
      market: 'crypto-futures',
      trigger: 'every 15m',
      status: 'Running',
      automationType: 'trade-suggestion',
      timeZone: 'Asia/Kolkata',
      schedule: { type: 'interval', scheduleMode: 'every_n_minutes', intervalMinutes: 15 },
      config: {
        backtestId: 'backtest-77',
        symbol: 'btcusdt',
        timeframe: '1H',
        sourceTemplateId: 'template-9',
        tradeSuggestion: {
          backtestId: 'backtest-77',
          symbol: 'BTCUSDT',
          timeframe: '1h',
          sourceTemplateId: 'template-9',
        },
      },
    });

    assert.equal(createdPayloads.length, 1);
    assert.equal(createdPayloads[0].sourceBacktestId, 'backtest-77');
    assert.equal(createdPayloads[0].scopeSymbol, 'BTCUSDT');
    assert.equal(createdPayloads[0].scopeTimeframe, '1h');
    assert.equal(createdPayloads[0].sourceTemplateId, 'template-9');
    assert.match(String(createdPayloads[0].searchText || ''), /Momentum BTC Runner/);
    assert.match(String(createdPayloads[0].searchText || ''), /BTCUSDT/);

    const automation = {
      id: 'automation-1',
      name: 'ETH Breakout Guard',
      strategy: 'Expansion Watch',
      broker: 'paper',
      market: 'crypto-futures',
      trigger: 'daily 09:30',
      status: 'Paused',
      automationType: 'trade-suggestion',
      timeZone: 'UTC',
      config: {
        tradeSuggestion: {
          backtestId: 'backtest-88',
          symbol: 'ethusdt',
          timeframe: '4H',
          sourceTemplateId: 'template-44',
        },
      },
    } as any;

    await repository.saveAutomation(automation);
    assert.equal(savedPayloads.length, 2);
    assert.equal(automation.sourceBacktestId, 'backtest-88');
    assert.equal(automation.scopeSymbol, 'ETHUSDT');
    assert.equal(automation.scopeTimeframe, '4h');
    assert.equal(automation.sourceTemplateId, 'template-44');
    assert.match(String(automation.searchText || ''), /ETHUSDT/);

    const backfill = await repository.backfillTradeSuggestionAutomationContracts();
    assert.deepEqual(backfill, { inspected: 1, updated: 1 });
    assert.equal(savedPayloads.length, 3);
    assert.equal(savedPayloads[2].automationType, 'trade-suggestion');
    assert.equal(savedPayloads[2].sourceBacktestId, 'backtest-legacy');
    assert.equal(savedPayloads[2].scopeSymbol, 'LDOUSDT');
    assert.equal(savedPayloads[2].scopeTimeframe, '15m');
    assert.equal(savedPayloads[2].sourceTemplateId, 'template-legacy');
    assert.equal(
      ((savedPayloads[2].config as Record<string, unknown>)?.templateId as string | undefined) ??
        null,
      'template-legacy'
    );
  } finally {
    (coreDataSource as any).getRepository = originalGetRepository;
  }
}

function runAutomationLineageMappingAssertions(): void {
  const service = new AutomationsService() as any;
  const mappedAutomation = service.mapAutomation({
    id: 'automation-1',
    automationType: 'strategy',
    name: 'Momentum Deployment',
    strategy: 'Momentum Template',
    broker: 'paper',
    market: 'crypto-futures',
    trigger: 'timeframe:15m,1h',
    status: 'Running',
    lastRun: new Date('2026-04-02T10:00:00.000Z'),
    nextRun: new Date('2026-04-02T10:15:00.000Z'),
    timeZone: 'UTC',
    schedule: { type: 'interval', intervalMinutes: 15 },
    accounts: 1,
    riskMode: 'Guarded',
    config: {
      source: 'backtest',
      backtestId: 'backtest-9',
      config: {
        sourceType: 'strategy_lab',
        projectId: 'lab-3',
        projectVersion: 3,
        sourceTemplateId: 'template-1',
        sourceTemplateName: 'Momentum Template',
        sourceTemplateVersion: 8,
        templateDiffSummary: {
          changedCount: 3,
          inheritedCount: 13,
          changedFields: ['Long entry logic', 'Max risk', 'AI filter'],
        },
        inputSnapshot: {
          template: {
            id: 'lab-3',
            name: 'Momentum Draft',
            templateVersion: 3,
          },
        },
      },
    },
    updatedAt: new Date('2026-04-02T10:05:00.000Z'),
    events: [
      {
        id: 'event-1',
        type: 'Run completed',
        entity: 'Backtest',
        outcome: 'Success',
        meta: {
          lineage: {
            sourceType: 'strategy_lab',
            projectId: 'lab-3',
            projectVersion: 3,
            sourceTemplateId: 'template-1',
            sourceTemplateName: 'Momentum Template',
            sourceTemplateVersion: 8,
            templateDiffSummary: {
              changedCount: 3,
              inheritedCount: 13,
              changedFields: ['Long entry logic', 'Max risk', 'AI filter'],
            },
          },
        },
        createdAt: new Date('2026-04-02T10:05:00.000Z'),
      },
    ],
    alerts: [
      {
        id: 'alert-1',
        message: 'Latency spike detected',
        severity: 'Medium',
        status: 'Open',
        meta: {
          lineage: {
            sourceType: 'strategy_library',
            libraryId: 'library-2',
            templateId: 'template-4',
            templateName: 'Breakout Template',
            templateVersion: 5,
            templateDiffSummary: {
              changedCount: 1,
              inheritedCount: 15,
              changedFields: ['Signal threshold'],
            },
          },
        },
        createdAt: new Date('2026-04-02T10:06:00.000Z'),
      },
    ],
  });

  assert.equal(mappedAutomation.lineage?.source, 'backtest');
  assert.equal(mappedAutomation.lineage?.backtestId, 'backtest-9');
  assert.equal(mappedAutomation.lineage?.sourceType, 'strategy_lab');
  assert.equal(mappedAutomation.lineage?.projectId, 'lab-3');
  assert.equal(mappedAutomation.lineage?.projectVersion, 3);
  assert.equal(mappedAutomation.lineage?.templateName, 'Momentum Draft');
  assert.equal(mappedAutomation.lineage?.templateVersion, 3);
  assert.equal(mappedAutomation.lineage?.sourceTemplateName, 'Momentum Template');
  assert.equal(mappedAutomation.lineage?.sourceTemplateVersion, 8);
  assert.equal(mappedAutomation.lineage?.templateDiffSummary?.changedCount, 3);
  assert.equal(mappedAutomation.events?.[0]?.lineage?.projectId, 'lab-3');
  assert.equal(mappedAutomation.alerts?.[0]?.lineage?.libraryId, 'library-2');

  const mappedRun = service.mapAutomationRun(
    {
      id: 'run-1',
      status: 'Success',
      scheduledFor: new Date('2026-04-02T10:00:00.000Z'),
      startedAt: new Date('2026-04-02T10:00:03.000Z'),
      finishedAt: new Date('2026-04-02T10:00:08.000Z'),
      durationMs: 5000,
      errorMessage: null,
      meta: {
        trigger: 'manual',
        lineage: {
          sourceType: 'strategy_library',
          libraryId: 'library-2',
          templateId: 'template-4',
          templateName: 'Breakout Template',
          templateVersion: 5,
          backtestId: 'backtest-7',
          templateDiffSummary: {
            changedCount: 1,
            inheritedCount: 15,
            changedFields: ['Signal threshold'],
          },
        },
      },
    },
    'UTC'
  );

  assert.equal(mappedRun.trigger, 'manual');
  assert.equal(mappedRun.backtestId, null);
  assert.equal(mappedRun.lineage?.sourceType, 'strategy_library');
  assert.equal(mappedRun.recovery?.canRetry, false);

  const staleRun = service.mapAutomationRun(
    {
      id: 'run-2',
      status: 'Running',
      scheduledFor: new Date('2026-04-02T05:00:00.000Z'),
      startedAt: new Date('2026-04-02T05:00:00.000Z'),
      finishedAt: null,
      durationMs: null,
      errorMessage: null,
      meta: { trigger: 'scheduled' },
    },
    'UTC'
  );

  assert.equal(staleRun.recovery?.active, true);
  assert.equal(staleRun.recovery?.canReconcile, true);
}

async function runAutomationReconcileAssertions(): Promise<void> {
  const service = new AutomationsService() as any;
  const runUpdateCalls: Array<{ runId: string; payload: Record<string, unknown> }> = [];
  const statusUpdates: Array<{
    userId: string;
    automationId: string;
    status: string;
    nextRun: Date | null | undefined;
  }> = [];
  const events: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const backtestSyncCalls: string[] = [];
  const automation = {
    id: 'automation-1',
    name: 'Momentum Deployment',
    strategy: 'Momentum Template',
    userId: 'user-1',
    status: 'Running',
    trigger: 'every 15m',
    schedule: { type: 'interval', scheduleMode: 'every_n_minutes', intervalMinutes: 15 },
    timeZone: 'UTC',
    updatedAt: new Date('2026-04-02T10:05:00.000Z'),
  };
  const staleRun = {
    id: 'run-stale',
    automationId: 'automation-1',
    userId: 'user-1',
    status: 'Running',
    scheduledFor: new Date('2026-04-02T05:00:00.000Z'),
    startedAt: new Date('2026-04-02T05:00:00.000Z'),
    finishedAt: null,
    durationMs: null,
    errorMessage: null,
    meta: {
      trigger: 'scheduled',
      lineage: {
        source: 'backtest',
        backtestId: 'source-backtest-1',
      },
    },
  };

  service.requireAutomation = async () => automation;
  service.automationExecutionService = {
    syncBacktestRunnerLifecycle: async () => undefined,
    syncBacktestRunnerLifecycleByBacktestId: async (backtestId: string) => {
      backtestSyncCalls.push(backtestId);
      return { synced: false };
    },
  };
  service.automationRunRepository = {
    listRunsByAutomationStatuses: async () => [staleRun],
    updateRun: async (runId: string, payload: Record<string, unknown>) => {
      runUpdateCalls.push({ runId, payload });
    },
    findById: async () => staleRun,
  };
  service.automationRepository = {
    updateAutomationStatus: async (
      userId: string,
      automationId: string,
      status: string,
      nextRun: Date | null | undefined
    ) => {
      statusUpdates.push({ userId, automationId, status, nextRun });
    },
    createAutomationEvent: async (payload: Record<string, unknown>) => {
      events.push(payload);
      return payload;
    },
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      activities.push(payload);
    },
    emitFailureAlert: async () => undefined,
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };

  const response = await service.reconcileAutomationState('user-1', 'automation-1', {
    reason: 'Operator requested stale-run recovery',
  });

  assert.match(response.data.message, /Cleared stale automation run/i);
  assert.equal(runUpdateCalls.length, 1);
  assert.equal(runUpdateCalls[0].runId, 'run-stale');
  assert.equal(runUpdateCalls[0].payload.status, 'Failed');
  assert.match(
    String(runUpdateCalls[0].payload.errorMessage || ''),
    /Operator requested stale-run recovery/
  );
  assert.equal(statusUpdates.length, 1);
  assert.equal(statusUpdates[0].automationId, 'automation-1');
  assert.equal(statusUpdates[0].status, 'Running');
  assert.ok(statusUpdates[0].nextRun instanceof Date);
  assert.equal(
    events.some((event) => event.type === 'Run reconciled'),
    true
  );
  assert.equal(
    events.some((event) => event.type === 'State reconciled'),
    true
  );
  assert.equal(activities.length > 0, true);
  assert.deepEqual(backtestSyncCalls, []);
}

async function runAutomationControlHardeningAssertions(): Promise<void> {
  const service = new AutomationsService() as any;
  const statusUpdates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const executePayloads: Array<Record<string, unknown>> = [];

  service.automationRepository = {
    updateAutomationStatus: async (
      userId: string,
      automationId: string,
      status: string,
      nextRun: Date | null | undefined
    ) => {
      statusUpdates.push({ userId, automationId, status, nextRun });
    },
    createAutomationEvent: async (payload: Record<string, unknown>) => {
      events.push(payload);
      return payload;
    },
  };
  service.automationExecutionService = {
    execute: async (payload: Record<string, unknown>) => {
      executePayloads.push(payload);
      return { status: 'started', runId: 'run-1', nextRun: '2026-04-02T10:15:00.000Z' };
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };
  service.userTimeZoneService = {
    resolveUserTimeZone: async () => 'UTC',
  };

  service.requireAutomation = async () => ({
    id: 'automation-paused',
    status: 'Paused',
    updatedAt: new Date('2026-04-02T10:05:00.000Z'),
  });

  const pausedResponse = await service.pauseAutomation('user-1', 'automation-paused', {
    reason: 'duplicate-click',
  });

  assert.equal(pausedResponse.data.message, 'Automation already paused');
  assert.equal(statusUpdates.length, 0);
  assert.equal(events.length, 0);

  await assert.rejects(
    async () => service.runAutomationNow('user-1', 'automation-paused'),
    /Automation is paused\. Resume it before running now\./
  );
  assert.equal(executePayloads.length, 0);

  service.requireAutomation = async () => ({
    id: 'automation-running',
    status: 'Running',
    updatedAt: new Date('2026-04-02T10:10:00.000Z'),
    nextRun: new Date('2026-04-02T10:30:00.000Z'),
    schedule: { type: 'interval', scheduleMode: 'every_n_minutes', intervalMinutes: 15 },
    trigger: 'every 15m',
    timeZone: 'UTC',
  });

  const resumeResponse = await service.resumeAutomation('user-1', 'automation-running', {
    reason: 'duplicate-click',
  });

  assert.equal(resumeResponse.data.message, 'Automation already running');
  assert.equal(statusUpdates.length, 0);
  assert.equal(events.length, 0);

  service.requireAutomation = async () => ({
    id: 'automation-failed',
    status: 'Failed',
    updatedAt: new Date('2026-04-02T10:12:00.000Z'),
  });

  await assert.rejects(
    async () => service.runAutomationNow('user-1', 'automation-failed'),
    /Automation must be running before manual execution\./
  );
  assert.equal(executePayloads.length, 0);
}

async function runAutomationHardDeleteAssertions(): Promise<void> {
  const service = new AutomationsService() as any;
  const deletedRecords: string[] = [];
  const stamps: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const originalTransaction = coreDataSource.transaction.bind(coreDataSource);
  const automation = {
    id: 'automation-delete-1',
    userId: 'user-1',
    name: 'Retired Momentum Runner',
    strategy: 'Momentum',
    broker: 'paper',
    market: 'crypto-futures',
    trigger: 'every 15m',
    status: 'Paused',
    automationType: 'trade-suggestion',
    updatedAt: new Date('2026-04-02T10:12:00.000Z'),
    config: {
      tradeSuggestion: {
        execution: {
          executionMode: 'paper_trade_auto',
        },
      },
    },
  };
  const impact = {
    automationEvents: 4,
    automationAlerts: 1,
    automationRuns: 3,
    activeRuns: 0,
    automationRunOutputs: 5,
    automationCursors: 2,
    suggestedTrades: 7,
    openSuggestedTrades: 2,
    acceptedSuggestedTrades: 1,
    activeSuggestedTradeExecutions: 0,
  };

  service.requireAutomation = async () => automation;
  service.loadAutomationDeleteImpact = async () => impact;
  service.getAutomationForDeleteLock = async () => automation;
  service.stampSuggestedTradesForDeletedAutomation = async (
    _manager: unknown,
    userId: string,
    lockedAutomation: Record<string, unknown>,
    options: Record<string, unknown>
  ) => {
    stamps.push({ userId, automationId: lockedAutomation.id, ...options });
    return impact.suggestedTrades;
  };
  service.deleteAutomationRuntimeRecords = async (
    _manager: unknown,
    userId: string,
    automationId: string
  ) => {
    deletedRecords.push(`${userId}:${automationId}`);
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      activities.push(payload);
    },
  };
  (coreDataSource as any).transaction = async (callback: (manager: unknown) => unknown) =>
    callback({});

  try {
    const previewResponse = await service.getAutomationDeletePreview(
      'user-1',
      'automation-delete-1'
    );

    assert.equal(previewResponse.data.canDelete, true);
    assert.equal(previewResponse.data.requiredConfirmName, 'Retired Momentum Runner');
    assert.equal(previewResponse.data.requiredConfirmPhrase, 'DELETE AUTOMATION');
    assert.equal(previewResponse.data.impact.suggestedTrades, 7);
    assert.equal(
      previewResponse.data.warnings.some(
        (warning: { code?: string }) => warning.code === 'suggested_trades_retained'
      ),
      true
    );

    const deleteResponse = await service.hardDeleteAutomation('user-1', 'automation-delete-1', {
      confirmName: 'Retired Momentum Runner',
      confirmPhrase: 'DELETE AUTOMATION',
      reason: 'retired strategy cleanup',
      previewToken: previewResponse.data.previewToken,
    });

    assert.equal(deleteResponse.data.message, 'Automation hard deleted');
    assert.equal(deleteResponse.data.deletedAutomationId, 'automation-delete-1');
    assert.equal(deleteResponse.data.retainedSuggestedTrades, 7);
    assert.deepEqual(deletedRecords, ['user-1:automation-delete-1']);
    assert.equal(stamps.length, 1);
    assert.equal(stamps[0].reason, 'retired strategy cleanup');
    assert.equal(activities.length, 1);

    await assert.rejects(
      () =>
        service.hardDeleteAutomation('user-1', 'automation-delete-1', {
          confirmName: 'Wrong name',
          confirmPhrase: 'DELETE AUTOMATION',
          reason: 'retired strategy cleanup',
          previewToken: previewResponse.data.previewToken,
        }),
      /confirmName must exactly match/
    );

    const runningPreview = await service.buildAutomationDeletePreview('user-1', {
      ...automation,
      status: 'Running',
    });
    assert.equal(runningPreview.canDelete, false);
    assert.equal(runningPreview.blockers[0].code, 'automation_running');
  } finally {
    (coreDataSource as any).transaction = originalTransaction;
  }

  const deletePayload = validateAutomationDeleteBody({
    confirmName: 'Retired Momentum Runner',
    confirmPhrase: 'DELETE AUTOMATION',
    reason: 'retired strategy cleanup',
    previewToken: 'preview.token',
  });
  assert.equal(deletePayload.confirmPhrase, 'DELETE AUTOMATION');
  assert.throws(
    () =>
      validateAutomationDeleteBody({
        confirmName: 'Retired Momentum Runner',
        confirmPhrase: 'delete automation',
        reason: 'retired strategy cleanup',
        previewToken: 'preview.token',
      }),
    /confirmPhrase must be DELETE AUTOMATION/
  );
}

function runAutomationTimeZoneValidationAssertions(): void {
  const validBacktestRunner = validateAutomationCreateBody({
    name: 'Runner',
    status: 'Running',
    automationType: 'backtest-runner',
    timeZone: 'UTC',
    schedule: {
      type: 'interval',
      intervalMinutes: 60,
    },
    config: {
      backtestRunner: {
        runBody: {
          universe: 'Phase 6 Smoke',
          benchmark: 'BTCUSDT',
        },
      },
    },
  });

  assert.equal(validBacktestRunner.automationType, 'backtest-runner');

  assert.throws(
    () =>
      validateAutomationCreateBody({
        name: 'Bad TZ',
        status: 'Draft',
        automationType: 'trade-suggestion',
        timeZone: 'Mars/Olympus',
        config: {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          sourceTemplateId: 'template-1',
        },
      }),
    /timeZone must be a valid IANA timezone/
  );

  assert.throws(
    () =>
      validateAutomationUpdateBody({
        timeZone: 'Moon/Base',
      }),
    /timeZone must be a valid IANA timezone/
  );
}

function runTradeSuggestionExecutionPolicyValidationAssertions(): void {
  const paperDraft = validateAutomationCreateBody({
    name: 'Paper Momentum',
    status: 'Draft',
    automationType: 'trade-suggestion',
    config: {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      sourceTemplateId: 'template-1',
      tradeSuggestion: {
        execution: {
          executionMode: 'paper_trade_auto',
          approvalMode: 'auto_if_safe',
        },
      },
    },
  });

  assert.equal(paperDraft.automationType, 'trade-suggestion');

  assert.throws(
    () =>
      validateAutomationCreateBody({
        name: 'Unsafe Live',
        status: 'Draft',
        automationType: 'trade-suggestion',
        config: {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          sourceTemplateId: 'template-1',
          tradeSuggestion: {
            execution: {
              executionMode: 'live_trade_auto',
            },
          },
        },
      }),
    /liveConsent\.enabled must be true/
  );

  assert.throws(
    () =>
      validateAutomationCreateBody({
        name: 'Missing Fixed Broker',
        status: 'Draft',
        automationType: 'trade-suggestion',
        config: {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          sourceTemplateId: 'template-1',
          tradeSuggestion: {
            execution: {
              executionMode: 'paper_trade_auto',
              routing: {
                routeMode: 'fixed',
              },
            },
          },
        },
      }),
    /routing\.brokerKey is required when routeMode is fixed/
  );
}

function runAutomationScheduleAuditAssertions(): void {
  const normalizedDaily = normalizeAutomationScheduleRecord(
    { runAt: '09:30', intervalDays: 2 },
    'daily 09:30'
  );
  assert.deepEqual(normalizedDaily, {
    type: 'daily',
    scheduleMode: 'daily',
    runAt: '09:30',
    hour: 9,
    minute: 30,
    intervalDays: 2,
  });

  const normalizedWeekly = normalizeAutomationScheduleRecord(
    { type: 'weekly', runAt: '18:45', weekdays: [1, 3, 5] },
    'weekly Mon, Wed, Fri 18:45'
  );
  assert.deepEqual(normalizedWeekly, {
    type: 'weekly',
    scheduleMode: 'weekly',
    runAt: '18:45',
    hour: 18,
    minute: 45,
    weekdays: [1, 3, 5],
  });

  const resolvedWeekly = resolveAutomationSchedule(
    { type: 'weekly', runAt: '09:30', weekdays: [1] },
    'weekly Mon 09:30'
  );
  assert.deepEqual(resolvedWeekly, {
    type: 'weekly',
    hour: 9,
    minute: 30,
    weekdays: [1],
  });

  const nextRun = computeNextRun(
    {
      type: 'weekly',
      hour: 9,
      minute: 30,
      weekdays: [1],
    },
    'Asia/Kolkata',
    new Date('2026-03-08T12:00:00.000Z')
  );
  assert.equal(nextRun?.toISOString(), '2026-03-09T04:00:00.000Z');
}

async function runAutomationSchedulePersistenceAssertions(): Promise<void> {
  const service = new AutomationsService() as any;
  const createdPayloads: Array<Record<string, unknown>> = [];
  const savedAutomations: Array<Record<string, unknown>> = [];
  const requestedTimeZones: Array<string | null> = [];

  service.prepareAutomationConfig = async (
    _userId: string,
    _automationType: string,
    config: Record<string, unknown>
  ) => config;
  service.deriveAutomationCoreFields = (
    _automationType: string,
    _config: Record<string, unknown>,
    fields: Record<string, unknown>
  ) => fields;
  service.resolveAutomationTimeZone = async (_userId: string, automationTimeZone?: string | null) => {
    requestedTimeZones.push(automationTimeZone ?? null);
    return 'Asia/Kolkata';
  };
  service.mapAutomation = (automation: Record<string, unknown>) => automation;
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async (_userId: string, templateId: string) => ({
      id: templateId,
      config: {
        market: 'crypto-futures',
        entryLogic: 'ema(20) > ema(50)',
        exitLogic: 'ema(20) < ema(50)',
        risk: {
          stopLossPct: 2,
          takeProfitTargetsPct: [4],
        },
        parameters: {
          signalThreshold: '0.81',
        },
      },
    }),
  };
  service.requireAutomation = async () => ({
    id: 'automation-1',
    userId: 'user-1',
    name: 'Momentum Bot',
    strategy: 'Momentum',
    broker: 'paper',
    market: 'crypto',
    trigger: 'daily 09:30',
    status: 'Paused',
    automationType: 'trade-suggestion',
    timeZone: 'UTC',
    schedule: {
      type: 'daily',
      scheduleMode: 'daily',
      runAt: '09:30',
      hour: 9,
      minute: 30,
      intervalDays: 1,
    },
    riskMode: null,
    config: {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      sourceTemplateId: 'template-1',
    },
    updatedAt: new Date('2026-03-08T00:00:00.000Z'),
  });
  service.automationRepository = {
    createAutomation: async (payload: Record<string, unknown>) => {
      createdPayloads.push(payload);
      return {
        id: 'automation-new',
        ...payload,
        accounts: 0,
        events: [],
        alerts: [],
        lastRun: null,
        nextRun: null,
        updatedAt: new Date('2026-03-08T00:00:00.000Z'),
      };
    },
    saveAutomation: async (automation: Record<string, unknown>) => {
      savedAutomations.push({ ...automation });
      return automation;
    },
    createAutomationEvent: async () => undefined,
  };

  const createResponse = await service.createAutomation('user-1', {
    name: 'Weekly Momentum',
    status: 'Running',
    automationType: 'trade-suggestion',
    timeZone: 'Asia/Kolkata',
    schedule: {
      runAt: '09:30',
      weekdays: [1, 3, 5],
    },
    trigger: 'weekly Mon, Wed, Fri 09:30',
    config: {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      sourceTemplateId: 'template-1',
    },
  });

  assert.equal(createdPayloads.length, 1);
  assert.deepEqual(createdPayloads[0].schedule, {
    type: 'weekly',
    scheduleMode: 'weekly',
    runAt: '09:30',
    hour: 9,
    minute: 30,
    weekdays: [1, 3, 5],
  });
  assert.equal(createdPayloads[0].timeZone, 'Asia/Kolkata');
  assert.equal(createResponse.data.timeZone, 'Asia/Kolkata');
  assert.equal(savedAutomations.length, 1);
  assert.ok(savedAutomations[0].nextRun instanceof Date);

  const fallbackCreateResponse = await service.createAutomation('user-1', {
    name: 'Fallback Timezone Momentum',
    status: 'Draft',
    automationType: 'trade-suggestion',
    schedule: {
      runAt: '09:30',
      weekdays: [1],
    },
    trigger: 'weekly Mon 09:30',
    config: {
      symbol: 'ETHUSDT',
      timeframe: '15m',
      sourceTemplateId: 'template-2',
    },
  });

  assert.equal(createdPayloads.length, 2);
  assert.equal(createdPayloads[1].timeZone, 'Asia/Kolkata');
  assert.equal(fallbackCreateResponse.data.timeZone, 'Asia/Kolkata');

  savedAutomations.length = 0;
  await service.updateAutomation('user-1', 'automation-1', {
    status: 'Running',
    timeZone: 'America/New_York',
    schedule: {
      type: 'daily',
      runAt: '16:15',
    },
    trigger: 'daily 16:15',
  });

  assert.equal(savedAutomations.length, 1);
  assert.equal(savedAutomations[0].timeZone, 'Asia/Kolkata');
  assert.deepEqual(savedAutomations[0].schedule, {
    type: 'daily',
    scheduleMode: 'daily',
    runAt: '16:15',
    hour: 16,
    minute: 15,
    intervalDays: 1,
  });
  assert.ok(savedAutomations[0].nextRun instanceof Date);
  assert.deepEqual(requestedTimeZones, ['Asia/Kolkata', null, 'America/New_York']);
}

async function runTradeSuggestionExecutabilityValidationAssertions(): Promise<void> {
  const createService = () => {
    const service = new AutomationsService() as any;
    service.resolveAutomationTimeZone = async () => 'UTC';
    service.mapAutomation = (automation: Record<string, unknown>) => automation;
    service.deriveAutomationCoreFields = (
      _automationType: string,
      _config: Record<string, unknown>,
      fields: Record<string, unknown>
    ) => fields;
    service.automationRepository = {
      createAutomation: async (payload: Record<string, unknown>) => ({
        id: 'automation-new',
        ...payload,
        accounts: 0,
        events: [],
        alerts: [],
        lastRun: null,
        nextRun: null,
        updatedAt: new Date('2026-03-08T00:00:00.000Z'),
      }),
      saveAutomation: async (automation: Record<string, unknown>) => automation,
      createAutomationEvent: async () => undefined,
    };
    return service;
  };

  {
    const service = createService();
    service.backtestRepository = {
      getBacktestById: async () => ({
        id: 'backtest-1',
        strategy: 'Alert Confirm',
        result: {
          config: {
            market: 'crypto-futures',
          },
        },
      }),
    };
    service.strategyTemplateRepository = {
      getStrategyTemplateById: async () => null,
    };

    await assert.rejects(
      () =>
        service.createAutomation('user-1', {
          name: 'Broken top setup',
          status: 'Draft',
          automationType: 'trade-suggestion',
          config: {
            symbol: 'BTCUSDT',
            timeframe: '1h',
            backtestId: 'backtest-1',
          },
        }),
      /must resolve a source template before it can be saved/i
    );
  }

  {
    const service = createService();
    service.backtestRepository = {
      getBacktestById: async () => null,
    };
    service.strategyTemplateRepository = {
      getStrategyTemplateById: async () => null,
    };
    service.requireAutomation = async () => ({
      id: 'automation-1',
      userId: 'user-1',
      name: 'Momentum Bot',
      strategy: 'Momentum',
      broker: 'paper',
      market: 'crypto-futures',
      trigger: 'every 15m',
      status: 'Draft',
      automationType: 'trade-suggestion',
      timeZone: 'UTC',
      schedule: null,
      riskMode: null,
      config: {
        symbol: 'BTCUSDT',
        timeframe: '1h',
        sourceTemplateId: 'template-existing',
      },
      updatedAt: new Date('2026-03-08T00:00:00.000Z'),
    });

    await assert.rejects(
      () =>
        service.updateAutomation('user-1', 'automation-1', {
          config: {
            symbol: 'BTCUSDT',
            timeframe: '1h',
            sourceTemplateId: 'template-missing',
          },
        }),
      /Strategy template not found for trade-suggestion automation/i
    );
  }

  {
    const service = createService();
    service.backtestRepository = {
      getBacktestById: async () => null,
    };
    service.strategyTemplateRepository = {
      getStrategyTemplateById: async (_userId: string, templateId: string) => ({
        id: templateId,
        config: {
          market: 'crypto-futures',
          parameters: {
            signalThreshold: '0.81',
          },
        },
      }),
    };

    await assert.rejects(
      () =>
        service.createAutomation('user-1', {
          name: 'Not ready template',
          status: 'Draft',
          automationType: 'trade-suggestion',
          config: {
            symbol: 'BTCUSDT',
            timeframe: '1h',
            sourceTemplateId: 'template-not-ready',
          },
        }),
      /Template is not automation-ready/i
    );
  }
}

async function runTradeSuggestionTemplateContractAssertions(): Promise<void> {
  const automationsService = new AutomationsService() as any;
  automationsService.backtestRepository = {
    getBacktestById: async (userId: string, backtestId: string) => {
      assert.equal(userId, 'user-1');
      assert.equal(backtestId, 'backtest-1');
      return {
        id: backtestId,
        strategy: 'Alert Confirm',
        name: 'Alert Confirm Backtest',
        result: {
          config: {
            market: 'crypto-futures',
            config: {
              templateId: 'template-legacy',
              sourceTemplateId: 'template-legacy',
              sourceTemplateName: 'Alert Confirm Template',
              sourceTemplateVersion: 7,
              inputSnapshot: {
                template: {
                  id: 'template-legacy',
                  name: 'Alert Confirm Template',
                  sourceTemplateVersion: 7,
                },
              },
            },
          },
        },
      };
    },
  };

  const prepared = await automationsService.prepareTradeSuggestionConfig('user-1', {
    source: 'top-setup',
    backtestId: 'backtest-1',
    config: {
      config: {
        templateId: 'template-legacy',
      },
    },
    tradeSuggestion: {
      execution: {
        executionMode: 'suggestion_only',
      },
    },
  });

  assert.equal(prepared?.templateId, 'template-legacy');
  assert.equal(prepared?.sourceTemplateId, 'template-legacy');
  assert.equal(
    ((prepared?.tradeSuggestion as Record<string, unknown> | undefined)?.sourceTemplateId as
      | string
      | undefined) ?? null,
    'template-legacy'
  );

  const executionService = new AutomationExecutionService() as any;
  executionService.strategyTemplateRepository = {
    getStrategyTemplateById: async (userId: string, templateId: string) => {
      assert.equal(userId, 'user-1');
      return {
        id: templateId,
        config: {
          market: 'crypto-futures',
          entryLogic: 'ema(20) > ema(50)',
          exitLogic: 'ema(20) < ema(50)',
          risk: {
            stopLossPct: 2,
            takeProfitTargetsPct: [4],
          },
          parameters: {
            signalThreshold: '0.81',
          },
        },
      };
    },
  };

  const resolved = await executionService.resolveTradeSuggestionProfile('user-1', {
    config: {
      config: {
        templateId: 'template-legacy',
      },
    },
  });

  assert.equal(resolved.sourceTemplateId, 'template-legacy');
  assert.equal(resolved.profile.automationReady, true);
  assert.equal(resolved.profile.tradePlan.long?.enabled, true);

  const embeddedFallbackResolved = await executionService.resolveTradeSuggestionProfile('user-1', {
    sourceTemplateId: 'template-legacy',
    inputSnapshot: {
      template: {
        id: 'template-legacy',
        config: {
          market: 'crypto-futures',
        },
      },
    },
  });

  assert.equal(embeddedFallbackResolved.sourceTemplateId, 'template-legacy');
  assert.equal(embeddedFallbackResolved.profile.automationReady, true);
  assert.equal(embeddedFallbackResolved.profile.tradePlan.long?.enabled, true);
}

async function runTradeSuggestionCreationWorkflowContractAssertions(): Promise<void> {
  const service = new AutomationsService() as any;
  const createdPayloads: Array<Record<string, unknown>> = [];

  service.resolveAutomationTimeZone = async () => 'Asia/Kolkata';
  service.mapAutomation = (automation: Record<string, unknown>) => automation;
  service.deriveAutomationCoreFields = (
    _automationType: string,
    _config: Record<string, unknown>,
    fields: Record<string, unknown>
  ) => fields;
  service.backtestRepository = {
    getBacktestById: async () => null,
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async (_userId: string, templateId: string) => ({
      id: templateId,
      config: {
        market: 'crypto-futures',
        entryLogic: 'ema(20) > ema(50)',
        exitLogic: 'ema(20) < ema(50)',
        risk: {
          stopLossPct: 2,
          takeProfitTargetsPct: [4],
        },
        parameters: {
          signalThreshold: '0.81',
        },
      },
    }),
  };
  service.automationRepository = {
    createAutomation: async (payload: Record<string, unknown>) => {
      createdPayloads.push(payload);
      return {
        id: 'automation-created-1',
        ...payload,
        accounts: 0,
        events: [],
        alerts: [],
        lastRun: null,
        nextRun: null,
        updatedAt: new Date('2026-04-06T00:00:00.000Z'),
      };
    },
    saveAutomation: async (automation: Record<string, unknown>) => automation,
    createAutomationEvent: async () => undefined,
  };

  const response = await service.createAutomation('user-1', {
    name: 'Legacy nested template contract',
    status: 'Draft',
    automationType: 'trade-suggestion',
    config: {
      source: 'manual',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      market: 'crypto-futures',
      templateId: 'template-legacy',
      sourceTemplateId: 'template-legacy',
      config: {
        templateId: 'template-legacy',
        sourceTemplateId: 'template-legacy',
        inputSnapshot: {
          template: {
            id: 'template-legacy',
            name: 'Alert Confirm Template',
            sourceTemplateVersion: 7,
          },
        },
      },
      tradeSuggestion: {
        execution: {
          executionMode: 'suggestion_only',
        },
      },
    },
  });

  assert.equal(response.data.automationType, 'trade-suggestion');
  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].timeZone, 'Asia/Kolkata');

  const persistedConfig = createdPayloads[0].config as Record<string, unknown>;
  assert.equal(persistedConfig.templateId, 'template-legacy');
  assert.equal(persistedConfig.sourceTemplateId, 'template-legacy');

  const tradeSuggestion = persistedConfig.tradeSuggestion as Record<string, unknown>;
  assert.equal(tradeSuggestion.templateId, 'template-legacy');
  assert.equal(tradeSuggestion.sourceTemplateId, 'template-legacy');

  await assertTradeSuggestionRuntimeContract(persistedConfig, {
    templateId: 'template-legacy',
    symbols: ['BTCUSDT'],
    timeframe: '1h',
  });
}

async function runAutomationExecutionHardeningAssertions(): Promise<void> {
  const originalCreateQueryRunner = coreDataSource.createQueryRunner.bind(coreDataSource);
  const automation = {
    id: 'automation-1',
    userId: 'user-1',
    name: 'Momentum Deployment',
    status: 'Running',
    schedule: { type: 'interval', scheduleMode: 'every_n_minutes', intervalMinutes: 15 },
    trigger: 'every 15m',
    timeZone: 'UTC',
    automationType: null,
    config: null,
    strategy: 'Momentum',
  };

  const createService = () => {
    const service = new AutomationExecutionService() as any;
    const events: Array<Record<string, unknown>> = [];

    service.automationRepository = {
      createAutomationEvent: async (payload: Record<string, unknown>) => {
        events.push(payload);
        return payload;
      },
      createAutomationAlert: async () => undefined,
      getAutomationCoreById: async () => null,
      updateAutomationStatus: async () => undefined,
    };
    service.automationRunRepository = {
      updateRun: async () => undefined,
      findById: async () => null,
      listRunsByAutomationStatuses: async () => [],
    };
    service.automationRunOutputRepository = {
      createOutput: async () => undefined,
    };
    service.backtestRepository = {
      getBacktestByIdAny: async () => null,
      createQueuedBacktest: async () => null,
    };
    service.suggestedTradeRepository = {};
    service.strategyTemplateRepository = {};
    service.strategyLibraryService = {};
    service.operationalEventService = {
      logActivity: async () => undefined,
      emitFailureAlert: async () => undefined,
    };
    service.userTimeZoneService = {
      resolveUserTimeZone: async () => 'UTC',
    };
    service.automationCursorRepository = {
      listByAutomationAndScope: async () => [],
      upsertCursor: async () => undefined,
    };
    service.automationSignalEvaluatorService = {
      evaluateLatestSignals: async () => ({ items: [] }),
    };
    service.whatsappNotificationsService = {
      queueLiveTradeSuggestionReadyNotification: async () => ({
        outcome: 'skipped',
        reason: 'whatsapp-disabled',
      }),
    };

    return { service, events };
  };

  {
    const { service } = createService();
    const symbols = service.resolveTradeSuggestionSymbols({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT', 'ETHUSDT'],
      tradeSuggestion: {
        symbol: 'SOLUSDT',
      },
      config: {
        assets: [{ symbol: 'ADAUSDT' }],
      },
    });

    assert.deepEqual(symbols, ['BTCUSDT', 'ETHUSDT']);
  }

  {
    const { service } = createService();
    const symbols = service.resolveTradeSuggestionSymbols({
      symbol: 'USDCUSDT',
      symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      inputSnapshot: {
        symbols: ['ADAUSDT', 'LINKUSDT'],
      },
      setupScope: {
        symbol: 'USDCUSDT',
        timeframe: '5m',
      },
      tradeSuggestion: {
        symbol: 'USDCUSDT',
        setupScope: {
          symbol: 'USDCUSDT',
          timeframe: '5m',
        },
      },
    });

    assert.deepEqual(symbols, ['USDCUSDT']);
  }

  try {
    {
      const { service, events } = createService();
      let commits = 0;
      let rollbacks = 0;
      let releases = 0;

      coreDataSource.createQueryRunner = () =>
        ({
          connect: async () => undefined,
          startTransaction: async () => undefined,
          commitTransaction: async () => {
            commits += 1;
          },
          rollbackTransaction: async () => {
            rollbacks += 1;
          },
          release: async () => {
            releases += 1;
          },
          manager: {
            findOne: async () => automation,
            createQueryBuilder: () => ({
              setLock() {
                return this;
              },
              where() {
                return this;
              },
              andWhere() {
                return this;
              },
              orderBy() {
                return this;
              },
              getOne: async () => ({
                id: 'run-active',
                status: 'Running',
              }),
            }),
            insert: async () => undefined,
            save: async () => undefined,
          },
        }) as any;

      const result = await service.execute({
        automationId: automation.id,
        actorUserId: automation.userId,
        trigger: 'manual',
      });

      assert.equal(result.status, 'skipped');
      assert.match(result.message || '', /already has an active run/i);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'Run skipped');
      assert.equal(
        ((events[0].meta as Record<string, unknown> | undefined)?.reason as string | undefined) ??
          null,
        'overlap-protected'
      );
      assert.equal(commits, 1);
      assert.equal(rollbacks, 0);
      assert.equal(releases, 1);
    }

    {
      const { service, events } = createService();
      let commits = 0;
      let rollbacks = 0;
      let releases = 0;

      coreDataSource.createQueryRunner = () =>
        ({
          connect: async () => undefined,
          startTransaction: async () => undefined,
          commitTransaction: async () => {
            commits += 1;
          },
          rollbackTransaction: async () => {
            rollbacks += 1;
          },
          release: async () => {
            releases += 1;
          },
          manager: {
            findOne: async () => automation,
            createQueryBuilder: () => ({
              setLock() {
                return this;
              },
              where() {
                return this;
              },
              andWhere() {
                return this;
              },
              orderBy() {
                return this;
              },
              getOne: async () => null,
            }),
            insert: async () => {
              const error = new Error('duplicate schedule') as Error & { code?: string };
              error.code = '23505';
              throw error;
            },
            save: async () => undefined,
          },
        }) as any;

      const result = await service.execute({
        automationId: automation.id,
        actorUserId: automation.userId,
        trigger: 'scheduled',
        scheduledFor: '2026-04-02T10:00:00.000Z',
      });

      assert.equal(result.status, 'skipped');
      assert.match(result.message || '', /already queued for this schedule/i);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'Run skipped');
      assert.equal(
        ((events[0].meta as Record<string, unknown> | undefined)?.reason as string | undefined) ??
          null,
        'duplicate-schedule'
      );
      assert.equal(commits, 0);
      assert.equal(rollbacks, 1);
      assert.equal(releases, 1);
    }

    {
      const { service } = createService();
      const outputs: Array<Record<string, unknown>> = [];
      const whatsappCalls: Array<Record<string, unknown>> = [];
      const notificationCalls: Array<Record<string, unknown>> = [];
      const evaluatorCalls: Array<Record<string, unknown>> = [];
      const automationTradeSuggestion = {
        ...automation,
        automationType: 'trade-suggestion',
      };

      service.resolveTradeSuggestionProfile = async () => ({
        sourceTemplateId: 'template-1',
        templateConfig: {},
        profile: {
          automationReady: true,
          readinessReasons: [],
          contractVersion: 'v1',
          market: 'crypto-futures',
          signalThreshold: 0.81,
          tradePlan: {
            long: {
              enabled: true,
              side: 'long',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Trend continuation',
              entryRule: 'Break above range high',
              exitRule: 'Stop at invalidation',
            },
            short: {
              enabled: false,
              side: 'short',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Disabled',
              entryRule: 'Disabled',
              exitRule: 'Disabled',
            },
          },
        },
      });
      service.automationCursorRepository = {
        listByAutomationAndScope: async () => [],
        upsertCursor: async () => undefined,
      };
      service.automationSignalEvaluatorService = {
        evaluateLatestSignals: async (payload: Record<string, unknown>) => {
          evaluatorCalls.push(payload);
          return {
            evaluatedSymbols: 1,
            items: [
              {
                symbol: 'BTCUSDT',
                status: 'ok',
                latestClosedSignalTime: '2026-04-04T10:00:00.000Z',
                signals: [
                  {
                    side: 'long',
                    signalTime: '2026-04-04T10:00:00.000Z',
                    entryPrice: 100,
                  },
                ],
              },
            ],
          };
        },
      };
      service.suggestedTradeRepository = {
        createSuggestedTrade: async () => ({
          duplicate: false,
          item: { id: 'st-1' },
        }),
      };
      service.suggestedTradesService = {
        attemptAutoLiveExecutionForAutomation: async () => ({
          outcome: 'ready',
          message: 'Ready for live handling',
          brokerKey: 'mudrex',
          accountId: 'account-1',
          preTradeCheckId: 'check-1',
        }),
      };
      service.automationRunOutputRepository = {
        createOutput: async (payload: Record<string, unknown>) => {
          outputs.push(payload);
          return payload;
        },
      };
      service.whatsappNotificationsService = {
        queueLiveTradeSuggestionReadyNotification: async (payload: Record<string, unknown>) => {
          whatsappCalls.push(payload);
          return {
            outcome: 'queued',
            reason: 'queued',
            deliveryId: 'wa-1',
          };
        },
      };
      service.operationalEventService = {
        logActivity: async () => undefined,
        emitNotificationAlert: async (_userId: string, payload: Record<string, unknown>) => {
          notificationCalls.push(payload);
          return null;
        },
      };

      const result = await service.generateTradeSuggestions(
        automationTradeSuggestion,
        'run-trade-1',
        {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          tradeSuggestion: {
            execution: {
              executionMode: 'live_trade_auto',
              approvalMode: 'auto_if_safe',
            },
          },
        },
        new Date('2026-04-04T10:05:00.000Z')
      );

      assert.equal(result.inserted, 1);
      assert.equal(evaluatorCalls[0]?.signalSelectionMode, 'latest_closed_only');
      assert.equal(result.autoLiveReady, 1);
      assert.equal(outputs.length, 2);
      assert.equal(outputs[1]?.outputType, 'trade-suggestion.live-auto');
      assert.equal(whatsappCalls.length, 1);
      assert.equal(notificationCalls.length, 2);
      assert.equal(notificationCalls[0]?.source, 'trade-suggestion.created:st-1');
      assert.equal(notificationCalls[0]?.message, 'New trade idea created for BTCUSDT 1h LONG.');
      assert.equal(notificationCalls[1]?.source, 'trade-suggestion.live-auto.ready:st-1');
      assert.equal(whatsappCalls[0]?.suggestedTradeId, 'st-1');
      assert.equal(whatsappCalls[0]?.brokerKey, 'mudrex');
      assert.equal(whatsappCalls[0]?.accountId, 'account-1');
      assert.equal(whatsappCalls[0]?.automationName, 'Momentum Deployment');
    }

    {
      const { service } = createService();
      const createdSuggestions: Array<Record<string, unknown>> = [];
      const outputs: Array<Record<string, unknown>> = [];
      const automationTradeSuggestion = {
        ...automation,
        automationType: 'trade-suggestion',
      };

      service.resolveTradeSuggestionProfile = async () => ({
        sourceTemplateId: 'template-1',
        templateConfig: {},
        profile: {
          automationReady: true,
          readinessReasons: [],
          contractVersion: 'v1',
          market: 'crypto-futures',
          signalThreshold: 0.81,
          tradePlan: {
            long: {
              enabled: true,
              side: 'long',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Trend continuation',
              entryRule: 'Break above range high',
              exitRule: 'Stop at invalidation',
            },
            short: {
              enabled: false,
              side: 'short',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Disabled',
              entryRule: 'Disabled',
              exitRule: 'Disabled',
            },
          },
        },
      });
      service.automationCursorRepository = {
        listByAutomationAndScope: async () => [],
        upsertCursor: async () => undefined,
      };
      service.automationSignalEvaluatorService = {
        evaluateLatestSignals: async () => ({
          evaluatedSymbols: 2,
          items: [
            {
              symbol: 'BTCUSDT',
              status: 'ok',
              latestClosedSignalTime: '2026-04-04T10:00:00.000Z',
              signals: [
                {
                  side: 'long',
                  signalTime: '2026-04-04T10:00:00.000Z',
                  entryPrice: 100,
                },
              ],
            },
            {
              symbol: 'ETHUSDT',
              status: 'ok',
              latestClosedSignalTime: '2026-04-04T10:00:00.000Z',
              signals: [
                {
                  side: 'long',
                  signalTime: '2026-04-04T10:00:00.000Z',
                  entryPrice: 200,
                },
              ],
            },
          ],
        }),
      };
      service.suggestedTradeRepository = {
        createSuggestedTrade: async (payload: Record<string, unknown>) => {
          createdSuggestions.push(payload);
          return {
            duplicate: false,
            item: { id: `st-batch-${createdSuggestions.length}` },
          };
        },
      };
      service.suggestedTradesService = {};
      service.automationRunOutputRepository = {
        createOutput: async (payload: Record<string, unknown>) => {
          outputs.push(payload);
          return payload;
        },
      };
      service.operationalEventService = {
        logActivity: async () => undefined,
        emitNotificationAlert: async () => null,
      };

      const result = await service.generateTradeSuggestions(
        automationTradeSuggestion,
        'run-trade-batch-setups',
        {
          symbols: ['BTCUSDT', 'ETHUSDT'],
          timeframe: '1h',
          setupScope: {
            setups: [
              {
                symbol: 'BTCUSDT',
                timeframe: '1h',
                score: 0.91,
                dedupeKey: 'setup-btc',
                backtestId: 'backtest-btc',
              },
              {
                symbol: 'ETHUSDT',
                timeframe: '1h',
                score: 0.72,
                dedupeKey: 'setup-eth',
                backtestId: 'backtest-eth',
              },
            ],
          },
          tradeSuggestion: {
            execution: {
              executionMode: 'suggestion_only',
            },
          },
        },
        new Date('2026-04-04T10:05:00.000Z')
      );

      assert.equal(result.inserted, 2);
      assert.equal(createdSuggestions.length, 2);
      assert.equal(createdSuggestions[0]?.score, 0.91);
      assert.equal(createdSuggestions[0]?.sourceSetupKey, 'setup-btc');
      assert.equal(createdSuggestions[0]?.sourceBacktestId, 'backtest-btc');
      assert.equal((createdSuggestions[0]?.meta as Record<string, unknown>)?.setupScore, 0.91);
      assert.equal(createdSuggestions[1]?.score, 0.72);
      assert.equal(createdSuggestions[1]?.sourceSetupKey, 'setup-eth');
      assert.equal(createdSuggestions[1]?.sourceBacktestId, 'backtest-eth');
      assert.equal((createdSuggestions[1]?.meta as Record<string, unknown>)?.setupScore, 0.72);
      assert.equal((outputs[0]?.payload as Record<string, unknown>)?.score, 0.91);
      assert.equal((outputs[1]?.payload as Record<string, unknown>)?.score, 0.72);
    }

    {
      const { service } = createService();
      const createdSuggestions: Array<Record<string, unknown>> = [];
      const cursorUpdates: Array<Record<string, unknown>> = [];
      const automationTradeSuggestion = {
        ...automation,
        automationType: 'trade-suggestion',
      };

      service.resolveTradeSuggestionProfile = async () => ({
        sourceTemplateId: 'template-1',
        templateConfig: {},
        profile: {
          automationReady: true,
          readinessReasons: [],
          contractVersion: 'v1',
          market: 'crypto-futures',
          signalThreshold: 0.81,
          tradePlan: {
            long: {
              enabled: true,
              side: 'long',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Trend continuation',
              entryRule: 'Break above range high',
              exitRule: 'Stop at invalidation',
            },
            short: {
              enabled: false,
              side: 'short',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Disabled',
              entryRule: 'Disabled',
              exitRule: 'Disabled',
            },
          },
        },
      });
      service.automationCursorRepository = {
        listByAutomationAndScope: async () => [
          {
            symbol: 'BTCUSDT',
            lastEvaluatedSignalTime: new Date('2026-04-04T09:00:00.000Z'),
            lastTriggeredSignalTime: null,
          },
        ],
        upsertCursor: async (payload: Record<string, unknown>) => {
          cursorUpdates.push(payload);
          return payload;
        },
      };
      service.automationSignalEvaluatorService = {
        evaluateLatestSignals: async (payload: Record<string, unknown>) => {
          assert.equal(payload.signalSelectionMode, 'latest_closed_only');
          return {
            evaluatedSymbols: 1,
            items: [
              {
                symbol: 'BTCUSDT',
                status: 'ok',
                latestClosedSignalTime: '2026-04-04T11:00:00.000Z',
                signals: [
                  {
                    side: 'long',
                    signalTime: '2026-04-04T10:00:00.000Z',
                    entryPrice: 100,
                  },
                  {
                    side: 'long',
                    signalTime: '2026-04-04T11:00:00.000Z',
                    entryPrice: 110,
                  },
                ],
              },
            ],
          };
        },
      };
      service.suggestedTradeRepository = {
        createSuggestedTrade: async (payload: Record<string, unknown>) => {
          createdSuggestions.push(payload);
          return {
            duplicate: false,
            item: { id: `st-${createdSuggestions.length}` },
          };
        },
      };
      service.suggestedTradesService = {};
      service.automationRunOutputRepository = {
        createOutput: async () => undefined,
      };
      service.operationalEventService = {
        logActivity: async () => undefined,
        emitNotificationAlert: async () => null,
      };

      const result = await service.generateTradeSuggestions(
        automationTradeSuggestion,
        'run-trade-latest-only',
        {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          tradeSuggestion: {
            execution: {
              executionMode: 'suggestion_only',
            },
          },
        },
        new Date('2026-04-04T11:05:00.000Z')
      );

      assert.equal(result.signalsDetected, 1);
      assert.equal(result.inserted, 1);
      assert.equal(createdSuggestions.length, 1);
      assert.equal(
        (createdSuggestions[0]?.signalTime as Date).toISOString(),
        '2026-04-04T11:00:00.000Z'
      );
      assert.equal(createdSuggestions[0]?.entryPrice, 110);
      assert.equal(cursorUpdates.at(-1)?.lastStatus, 'signal');
      assert.deepEqual(cursorUpdates.at(-1)?.meta, {
        latestClosedSignalTime: '2026-04-04T11:00:00.000Z',
        evaluationMode: 'latest-closed-candle',
        signalSelectionMode: 'latest_closed_only',
        signalCount: 1,
        skippedHistoricalSignalCount: 1,
      });
    }

    {
      const { service } = createService();
      const createdSuggestions: Array<Record<string, unknown>> = [];
      const cursorUpdates: Array<Record<string, unknown>> = [];
      const automationTradeSuggestion = {
        ...automation,
        automationType: 'trade-suggestion',
      };

      service.resolveTradeSuggestionProfile = async () => ({
        sourceTemplateId: 'template-1',
        templateConfig: {},
        profile: {
          automationReady: true,
          readinessReasons: [],
          contractVersion: 'v1',
          market: 'crypto-futures',
          signalThreshold: 0.81,
          tradePlan: {
            long: {
              enabled: true,
              side: 'long',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Trend continuation',
              entryRule: 'Break above range high',
              exitRule: 'Stop at invalidation',
            },
            short: {
              enabled: false,
              side: 'short',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Disabled',
              entryRule: 'Disabled',
              exitRule: 'Disabled',
            },
          },
        },
      });
      service.automationCursorRepository = {
        listByAutomationAndScope: async () => [
          {
            symbol: 'BTCUSDT',
            lastEvaluatedSignalTime: new Date('2026-04-04T09:00:00.000Z'),
            lastTriggeredSignalTime: null,
          },
        ],
        upsertCursor: async (payload: Record<string, unknown>) => {
          cursorUpdates.push(payload);
          return payload;
        },
      };
      service.automationSignalEvaluatorService = {
        evaluateLatestSignals: async (payload: Record<string, unknown>) => {
          assert.equal(payload.signalSelectionMode, 'cursor_gap');
          return {
            evaluatedSymbols: 1,
            items: [
              {
                symbol: 'BTCUSDT',
                status: 'ok',
                latestClosedSignalTime: '2026-04-04T11:00:00.000Z',
                signals: [
                  {
                    side: 'long',
                    signalTime: '2026-04-04T10:00:00.000Z',
                    entryPrice: 100,
                  },
                  {
                    side: 'long',
                    signalTime: '2026-04-04T11:00:00.000Z',
                    entryPrice: 110,
                  },
                ],
              },
            ],
          };
        },
      };
      service.suggestedTradeRepository = {
        createSuggestedTrade: async (payload: Record<string, unknown>) => {
          createdSuggestions.push(payload);
          return {
            duplicate: false,
            item: { id: `st-gap-${createdSuggestions.length}` },
          };
        },
      };
      service.suggestedTradesService = {};
      service.automationRunOutputRepository = {
        createOutput: async () => undefined,
      };
      service.operationalEventService = {
        logActivity: async () => undefined,
        emitNotificationAlert: async () => null,
      };

      const result = await service.generateTradeSuggestions(
        automationTradeSuggestion,
        'run-trade-cursor-gap',
        {
          symbol: 'BTCUSDT',
          timeframe: '1h',
          signalSelectionMode: 'cursor_gap',
          tradeSuggestion: {
            execution: {
              executionMode: 'suggestion_only',
            },
          },
        },
        new Date('2026-04-04T11:05:00.000Z')
      );

      assert.equal(result.signalsDetected, 2);
      assert.equal(result.inserted, 2);
      assert.equal(createdSuggestions.length, 2);
      assert.equal(
        (createdSuggestions[0]?.signalTime as Date).toISOString(),
        '2026-04-04T10:00:00.000Z'
      );
      assert.equal(
        (createdSuggestions[1]?.signalTime as Date).toISOString(),
        '2026-04-04T11:00:00.000Z'
      );
      assert.equal(cursorUpdates.at(-1)?.lastStatus, 'signal');
      assert.deepEqual(cursorUpdates.at(-1)?.meta, {
        latestClosedSignalTime: '2026-04-04T11:00:00.000Z',
        evaluationMode: 'latest-closed-candle',
        signalSelectionMode: 'cursor_gap',
        signalCount: 2,
        skippedHistoricalSignalCount: 0,
      });
    }

    {
      const { service } = createService();
      const whatsappCalls: Array<Record<string, unknown>> = [];
      const notificationCalls: Array<Record<string, unknown>> = [];

      service.resolveTradeSuggestionProfile = async () => ({
        sourceTemplateId: 'template-1',
        templateConfig: {},
        profile: {
          automationReady: true,
          readinessReasons: [],
          contractVersion: 'v1',
          market: 'crypto-futures',
          signalThreshold: 0.81,
          tradePlan: {
            long: {
              enabled: true,
              side: 'long',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Trend continuation',
              entryRule: 'Break above range high',
              exitRule: 'Stop at invalidation',
            },
            short: {
              enabled: false,
              side: 'short',
              stopLossPct: 2,
              takeProfitTargetsPct: [4],
              rationale: 'Disabled',
              entryRule: 'Disabled',
              exitRule: 'Disabled',
            },
          },
        },
      });
      service.automationCursorRepository = {
        listByAutomationAndScope: async () => [],
        upsertCursor: async () => undefined,
      };
      service.automationSignalEvaluatorService = {
        evaluateLatestSignals: async () => ({
          evaluatedSymbols: 1,
          items: [
            {
              symbol: 'ETHUSDT',
              status: 'ok',
              latestClosedSignalTime: '2026-04-04T11:00:00.000Z',
              signals: [
                {
                  side: 'long',
                  signalTime: '2026-04-04T11:00:00.000Z',
                  entryPrice: 200,
                },
              ],
            },
          ],
        }),
      };
      service.suggestedTradeRepository = {
        createSuggestedTrade: async () => ({
          duplicate: false,
          item: { id: 'st-2' },
        }),
      };
      service.suggestedTradesService = {
        attemptAutoLiveExecutionForAutomation: async () => ({
          outcome: 'placed',
          message: 'Order placed',
          brokerKey: 'mudrex',
          accountId: 'account-1',
          preTradeCheckId: 'check-2',
          orderId: 'order-1',
        }),
      };
      service.automationRunOutputRepository = {
        createOutput: async () => undefined,
      };
      service.whatsappNotificationsService = {
        queueLiveTradeSuggestionReadyNotification: async (payload: Record<string, unknown>) => {
          whatsappCalls.push(payload);
          return {
            outcome: 'queued',
            reason: 'queued',
          };
        },
      };
      service.operationalEventService = {
        logActivity: async () => undefined,
        emitNotificationAlert: async (_userId: string, payload: Record<string, unknown>) => {
          notificationCalls.push(payload);
          return null;
        },
      };

      await service.generateTradeSuggestions(
        automation,
        'run-trade-2',
        {
          symbol: 'ETHUSDT',
          timeframe: '15m',
          tradeSuggestion: {
            execution: {
              executionMode: 'live_trade_auto',
              approvalMode: 'auto_if_safe',
            },
          },
        },
        new Date('2026-04-04T11:05:00.000Z')
      );

      assert.equal(whatsappCalls.length, 0);
      assert.equal(notificationCalls.length, 1);
      assert.equal(notificationCalls[0]?.source, 'trade-suggestion.created:st-2');
      assert.equal(notificationCalls[0]?.message, 'New trade idea created for ETHUSDT 15m LONG.');
    }

    {
      const { service } = createService();
      const statusUpdates: Array<Record<string, unknown>> = [];
      const automationTradeSuggestion = {
        ...automation,
        automationType: 'trade-suggestion',
      };

      service.automationRepository = {
        createAutomationEvent: async () => undefined,
        createAutomationAlert: async () => undefined,
        getAutomationCoreById: async () => null,
        updateAutomationStatus: async (
          userId: string,
          automationId: string,
          status: string,
          nextRun: Date | null | undefined
        ) => {
          statusUpdates.push({ userId, automationId, status, nextRun });
        },
      };
      service.generateTradeSuggestions = async () => {
        throw new Error('trade-suggestion automation is missing a source template');
      };

      coreDataSource.createQueryRunner = () =>
        ({
          connect: async () => undefined,
          startTransaction: async () => undefined,
          commitTransaction: async () => undefined,
          rollbackTransaction: async () => undefined,
          release: async () => undefined,
          manager: {
            findOne: async () => automationTradeSuggestion,
            createQueryBuilder: () => ({
              setLock() {
                return this;
              },
              where() {
                return this;
              },
              andWhere() {
                return this;
              },
              orderBy() {
                return this;
              },
              getOne: async () => null,
            }),
            insert: async () => undefined,
            save: async () => undefined,
          },
        }) as any;

      const result = await service.execute({
        automationId: automationTradeSuggestion.id,
        actorUserId: automationTradeSuggestion.userId,
        trigger: 'manual',
      });

      assert.equal(result.status, 'failed');
      assert.equal(statusUpdates.length, 1);
      assert.deepEqual(statusUpdates[0], {
        userId: 'user-1',
        automationId: 'automation-1',
        status: 'Failed',
        nextRun: null,
      });
    }

    {
      const { service, events } = createService();
      const runUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
      const outputs: Array<Record<string, unknown>> = [];
      const automationRunner = {
        ...automation,
        automationType: 'backtest-runner',
        config: {
          backtestRunner: {
            kind: 'backtest-runner',
            source: 'backtest',
            backtestId: 'source-backtest-1',
          },
        },
      };
      const childFinishedAt = new Date('2026-04-02T10:05:00.000Z');

      service.automationRepository = {
        ...service.automationRepository,
        getAutomationById: async () => automationRunner,
        getAutomationCoreById: async () => automationRunner,
        createAutomationEvent: async (payload: Record<string, unknown>) => {
          events.push(payload);
          return payload;
        },
      };
      service.automationRunRepository = {
        ...service.automationRunRepository,
        findById: async () => ({
          id: 'run-backtest-1',
          automationId: automationRunner.id,
          userId: automationRunner.userId,
          status: 'Running',
          startedAt: new Date('2026-04-02T10:00:00.000Z'),
          meta: {
            backtestId: 'child-backtest-1',
            lineage: {
              backtestId: 'child-backtest-1',
            },
          },
        }),
        updateRun: async (id: string, payload: Record<string, unknown>) => {
          runUpdates.push({ id, payload });
        },
      };
      service.automationRunOutputRepository = {
        createOutput: async (payload: Record<string, unknown>) => {
          outputs.push(payload);
          return payload;
        },
      };
      service.backtestRepository = {
        ...service.backtestRepository,
        getBacktestByIdAny: async () => ({
          id: 'child-backtest-1',
          userId: automationRunner.userId,
          status: 'Review',
          stability: 'Review',
          updatedAt: childFinishedAt,
          trades: 12,
          result: {
            cagr: 5.2,
            sharpe: 1.18,
            drawdown: 2.1,
            winRate: 61,
            profitFactor: 1.44,
            config: {
              automationId: automationRunner.id,
              automationRunId: 'run-backtest-1',
              inputSnapshot: {
                automationId: automationRunner.id,
                automationRunId: 'run-backtest-1',
              },
              progress: {
                state: 'completed',
                processed: 9,
                total: 9,
                percent: 100,
              },
            },
          },
        }),
        getBacktestById: async () => ({
          id: 'child-backtest-1',
          userId: automationRunner.userId,
          status: 'Review',
          stability: 'Review',
          updatedAt: childFinishedAt,
          trades: 12,
          result: {
            cagr: 5.2,
            sharpe: 1.18,
            drawdown: 2.1,
            winRate: 61,
            profitFactor: 1.44,
            config: {
              automationId: automationRunner.id,
              automationRunId: 'run-backtest-1',
              inputSnapshot: {
                automationId: automationRunner.id,
                automationRunId: 'run-backtest-1',
              },
              progress: {
                state: 'completed',
                processed: 9,
                total: 9,
                percent: 100,
              },
            },
          },
        }),
      };

      const syncResult = await service.syncBacktestRunnerLifecycleByBacktestId('child-backtest-1');

      assert.equal(syncResult.synced, true);
      assert.equal(runUpdates.length, 1);
      assert.equal(runUpdates[0]?.id, 'run-backtest-1');
      assert.equal(runUpdates[0]?.payload.status, 'Success');
      assert.equal(
        (runUpdates[0]?.payload.finishedAt as Date | undefined)?.toISOString(),
        childFinishedAt.toISOString()
      );
      assert.equal(
        ((runUpdates[0]?.payload.meta as Record<string, unknown> | undefined)
          ?.childBacktestStatus as string | undefined) ?? null,
        'Completed'
      );
      assert.equal(
        ((runUpdates[0]?.payload.meta as Record<string, unknown> | undefined)?.backtestLifecycle as
          | string
          | undefined) ?? null,
        'finalized'
      );
      assert.equal(
        events.some((item) => item.type === 'Run completed'),
        true
      );
      assert.equal(outputs.length, 1);
      assert.equal(outputs[0]?.outputType, 'backtest-runner.summary');
      assert.equal(outputs[0]?.status, 'Created');
    }
  } finally {
    coreDataSource.createQueryRunner =
      originalCreateQueryRunner as typeof coreDataSource.createQueryRunner;
  }
}

async function runAutomationOperationalSnapshotAssertions(): Promise<void> {
  const service = new AutomationsService() as any;

  service.automationRepository = {
    getAutomationsSummary: async (userId?: string | null) => {
      assert.equal(userId ?? null, null);
      return {
        total: 7,
        running: 3,
        paused: 2,
        failed: 1,
        draft: 1,
        connectedAccounts: 5,
      };
    },
    getAutomationEventDiagnostics: async (userId: string | null, since: Date) => {
      assert.equal(userId, null);
      assert.ok(since instanceof Date);
      return {
        overlapSkips24h: 2,
      };
    },
  };
  service.automationRunRepository = {
    getOperationalRunDiagnostics: async (since: Date) => {
      assert.ok(since instanceof Date);
      return {
        activeRuns: 2,
        failedRuns24h: 1,
      };
    },
  };
  service.automationCursorRepository = {
    getOperationalCursorDiagnostics: async (staleBefore: Date) => {
      assert.ok(staleBefore instanceof Date);
      return {
        totalCursorCount: 4,
        staleCursorCount: 1,
        lastCursorAt: '2026-04-04T11:00:00.000Z',
        lastTriggeredSignalAt: '2026-04-04T10:45:00.000Z',
      };
    },
  };
  service.readQueueHealth = async () => ({
    status: 'ok',
    latencyMs: 12,
  });
  service.readWorkerHealth = async () => ({
    status: 'ok',
    workerHttpStatus: 'ok',
    heartbeatStatus: 'ok',
    heartbeatAgeMs: 2000,
    commandPollLagMs: 1500,
  });

  const snapshot = await service.getAutomationOperationalSnapshot();

  assert.equal(snapshot.total, 7);
  assert.equal(snapshot.running, 3);
  assert.equal(snapshot.paused, 2);
  assert.equal(snapshot.failed, 1);
  assert.equal(snapshot.draft, 1);
  assert.equal(snapshot.connectedAccounts, 5);
  assert.equal(snapshot.healthStatus, 'degraded');
  assert.equal(snapshot.health, 'Degraded');
  assert.match(String(snapshot.detail || ''), /stale cursor/i);
  assert.equal(snapshot.summary.activeRuns, 2);
  assert.equal(snapshot.summary.failedRuns24h, 1);
  assert.equal(snapshot.summary.overlapSkips24h, 2);
  assert.equal(snapshot.summary.staleCursorCount, 1);
  assert.equal(snapshot.summary.totalCursorCount, 4);
  assert.equal(snapshot.summary.queueStatus, 'ok');
  assert.equal(snapshot.summary.workerStatus, 'ok');
}

async function runAutomationsOperationalAssertions(): Promise<void> {
  const createOperationalMock = () => {
    const activityCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];
    const alertCalls: Array<{ userId: string; payload: Record<string, unknown> }> = [];

    return {
      activityCalls,
      alertCalls,
      service: {
        async logActivity(userId: string, payload: Record<string, unknown>) {
          activityCalls.push({ userId, payload });
        },
        async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
          alertCalls.push({ userId, payload });
        },
      },
    };
  };

  const svc = new AutomationsService() as any;
  const operational = createOperationalMock();
  const now = new Date();
  let getAutomationCallCount = 0;

  svc.operationalEventService = operational.service;
  svc.automationRepository = {
    async getAutomationById() {
      getAutomationCallCount += 1;
      return {
        id: 'bot-1',
        name: 'Momentum Bot',
        strategy: 'momentum',
        status: getAutomationCallCount === 1 ? 'Running' : 'Paused',
        updatedAt: now,
      };
    },
    async updateAutomationStatus() {
      return;
    },
    async createAutomationEvent() {
      return;
    },
  };

  await svc.pauseAutomation('user-1', 'bot-1', { reason: 'maintenance' });
  assert.equal(operational.activityCalls.length, 1);
  assert.equal(operational.alertCalls.length, 0);
  assert.equal(operational.activityCalls[0].payload.title, 'Automation paused: Momentum Bot');
  assert.deepEqual(
    ((operational.activityCalls[0].payload.flags as Array<Record<string, unknown>>) || []).map(
      (flag) => flag.id
    ),
    ['automation-paused']
  );

  const failingSvc = new AutomationsService() as any;
  const failingOperational = createOperationalMock();
  failingSvc.operationalEventService = failingOperational.service;
  failingSvc.automationRepository = {
    async getAutomationById() {
      return {
        id: 'bot-1',
        name: 'Momentum Bot',
        strategy: 'momentum',
        status: 'Running',
        updatedAt: now,
      };
    },
    async updateAutomationStatus() {
      throw new Error('db unavailable');
    },
    async createAutomationEvent() {
      return;
    },
  };

  await assert.rejects(async () => {
    await failingSvc.pauseAutomation('user-1', 'bot-1', { reason: 'maintenance' });
  }, /db unavailable/);
  assert.equal(failingOperational.activityCalls.length, 1);
  assert.equal(failingOperational.alertCalls.length, 1);
  assert.equal(failingOperational.activityCalls[0].payload.title, 'Automation pause failed');
  assert.deepEqual(
    (
      (failingOperational.activityCalls[0].payload.flags as Array<Record<string, unknown>>) || []
    ).map((flag) => flag.id),
    ['automation-pause-review']
  );
}

function runAutomationSignalEvaluatorAssertions(): void {
  const service = new AutomationSignalEvaluatorService() as any;

  const mapped = service.mapEvaluatedSignalItem({
    symbol: 'btcusdt',
    timeframe: '15m',
    status: 'OK',
    reason: 'fresh',
    signalTime: '2026-04-13T00:15:00.000Z',
    latestClosedSignalTime: '2026-04-13T00:00:00.000Z',
    entryPrice: '123.45',
    longEntry: true,
    longEntryPrevious: false,
    longExit: false,
    shortEntry: false,
    shortEntryPrevious: false,
    shortExit: true,
    signals: [
      { side: 'long', signalTime: '2026-04-13T00:15:00.000Z', entryPrice: '123.45' },
      { side: 'flat', signalTime: '' },
    ],
  });

  assert.deepEqual(mapped, {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    status: 'ok',
    reason: 'fresh',
    signalTime: '2026-04-13T00:15:00.000Z',
    latestClosedSignalTime: '2026-04-13T00:00:00.000Z',
    entryPrice: 123.45,
    longEntry: true,
    longEntryPrevious: false,
    longExit: false,
    shortEntry: false,
    shortEntryPrevious: false,
    shortExit: true,
    signals: [
      {
        side: 'long',
        signalTime: '2026-04-13T00:15:00.000Z',
        entryPrice: 123.45,
        tradePlan: null,
      },
    ],
  });

  assert.equal(
    service.mapEvaluatedSignalItem({ symbol: '', timeframe: '15m', status: 'ok' }),
    null
  );

  const fallback = service.mapEvaluatedSignalItem({
    symbol: 'ethusdt',
    timeframe: '1h',
    status: 'weird',
  });
  assert.equal(fallback.status, 'failed');
}

async function runAutomationRuntimeStaleCandidateAssertions(): Promise<void> {
  const { AutomationsService } = await import('../src/api/services/AutomationsService');

  const service = new AutomationsService() as any;
  const now = Date.now();
  const captured: { olderThan?: Date; statuses?: string[]; limit?: number } = {};

  service.automationRunRepository = {
    async findStaleRuns(query: { olderThan: Date; statuses: string[]; limit: number }) {
      captured.olderThan = query.olderThan;
      captured.statuses = query.statuses;
      captured.limit = query.limit;
      return [
        {
          id: 'run-stale',
          automationId: 'automation-1',
          userId: 'user-1',
          status: 'Running',
          startedAt: new Date(now - 30 * 60 * 1000),
          lastProgressAt: new Date(now - 25 * 60 * 1000),
          workerId: 'worker-1',
          errorMessage: null,
          meta: {},
        },
        {
          id: 'run-fresh-progress',
          automationId: 'automation-2',
          userId: 'user-1',
          status: 'Running',
          startedAt: new Date(now - 40 * 60 * 1000),
          lastProgressAt: new Date(now - 5 * 60 * 1000),
          workerId: 'worker-1',
          errorMessage: null,
          meta: {},
        },
      ];
    },
  };
  service.automationRepository = {
    async getAutomationByIdAny(automationId: string) {
      return {
        id: automationId,
        name: automationId === 'automation-1' ? 'Trade Suggestion Alpha' : 'Fresh Progress Beta',
        userId: 'user-1',
      };
    },
  };
  service.backtestRepository = {
    async getBacktestById() {
      return null;
    },
  };

  const items = await service.getRuntimeStaleRunCandidates(7);
  const staleThresholdMs = 20 * 60 * 1000;

  assert.ok(captured.olderThan instanceof Date);
  assert.equal(captured.limit, 7);
  assert.deepEqual(captured.statuses, ['Queued', 'Running']);

  const cutoffDeltaMs = Math.abs(captured.olderThan!.getTime() - (now - staleThresholdMs));
  assert.ok(
    cutoffDeltaMs < 15_000,
    `expected stale cutoff near 20 minutes, got ${cutoffDeltaMs}ms drift`
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'run-stale');
  assert.equal(items[0].staleThresholdMs, staleThresholdMs);
  assert.equal(items[0].repairAction, 'reconcile');
}

function runAutomationsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const proofSource = read('scripts/proofs/proof-automations-live.ts');
  const smokeSource = read('scripts/smokes/smoke-automations-lifecycle.ts');
  const releaseGateSource = read('scripts/release-gates/release-gate-automations.ts');
  const signoffSource = read('scripts/signoffs/signoff-automations.ts');
  const evaluatorSource = read('src/api/services/AutomationSignalEvaluatorService.ts');
  const executionSource = read('src/api/services/AutomationExecutionService.ts');

  assert.equal(
    packageScripts['test:automations'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-automations.ts'
  );
  assert.equal(runPackageSuiteSource.includes("automations: ['test:automations']"), true);
  assert.equal(runPackageSuiteSource.includes("'test:automations'"), true);

  assert.equal(
    proofSource.includes('scripts/smokes/smoke-automations-lifecycle.ts'),
    true,
    'automations live proof must run lifecycle smoke'
  );
  assert.equal(
    proofSource.includes('scripts/checks/check-automations-health.ts'),
    true,
    'automations live proof must run health check'
  );
  assert.equal(
    smokeSource.includes('/automations') && smokeSource.includes('/auth/login'),
    true,
    'automations smoke must exercise login and automations APIs'
  );
  assert.equal(
    releaseGateSource.includes('/health/automations'),
    true,
    'automations release gate must read automations health endpoint'
  );
  assert.equal(
    releaseGateSource.includes('smoke-automations-lifecycle.ts'),
    true,
    'automations release gate must execute lifecycle smoke'
  );
  assert.equal(
    signoffSource.includes('AUTOMATIONS_SIGNOFF_OPERATOR_RECOVERY_VERIFIED'),
    true,
    'automations signoff must require operator recovery verification'
  );
  assert.equal(
    signoffSource.includes('AUTOMATIONS_SIGNOFF_SCHEDULE_AUDIT_VERIFIED'),
    true,
    'automations signoff must require schedule audit verification'
  );
  assert.equal(
    evaluatorSource.includes('path.resolve(') &&
      evaluatorSource.includes("'scripts'") &&
      evaluatorSource.includes("'_runtime'") &&
      evaluatorSource.includes("'automation_signal_eval.py'"),
    true,
    'automation signal evaluator must use scripts/_runtime automation runner'
  );
  assert.equal(
    executionSource.includes('suggestedTradeId: context?.suggestedTradeId ?? null'),
    true,
    'live auto order placement must forward suggested-trade context into the order ledger'
  );
  assert.equal(
    executionSource.includes('queueLiveTradeSuggestionReadyNotification'),
    true,
    'live auto ready outputs must queue WhatsApp notifications through the notification service'
  );
}

async function runWhatsappNotificationQueueAssertions(): Promise<void> {
  const service = new WhatsappNotificationsService() as any;
  const deliveries: Array<Record<string, unknown>> = [];
  const originalWhatsappEnv = {
    enabled: env.whatsapp.enabled,
    provider: env.whatsapp.provider,
    twilio: {
      accountSid: env.whatsapp.twilio.accountSid,
      authToken: env.whatsapp.twilio.authToken,
      from: env.whatsapp.twilio.from,
    },
  };

  try {
    service.appSettingsRepository = {
      getSettings: async (userId: string) => {
        if (userId === 'user-disabled') {
          return {
            notifyWhatsapp: false,
            whatsappLiveTradeSuggestions: false,
            whatsappNumber: null,
            whatsappVerifiedAt: null,
          };
        }

        if (userId === 'user-unverified') {
          return {
            notifyWhatsapp: true,
            whatsappLiveTradeSuggestions: true,
            whatsappNumber: '+14155550123',
            whatsappVerifiedAt: null,
          };
        }

        return {
          notifyWhatsapp: true,
          whatsappLiveTradeSuggestions: true,
          whatsappNumber: '+14155550123',
          whatsappVerifiedAt: new Date('2026-04-04T09:00:00.000Z'),
        };
      },
    };
    service.suggestedTradeRepository = {
      getSuggestedTradeById: async (_userId: string, suggestedTradeId: string) => {
        if (suggestedTradeId === 'missing') {
          return null;
        }

        return {
          id: suggestedTradeId,
          symbol: 'BTCUSDT',
          timeframe: '1h',
          side: 'BUY',
          entryPrice: '101.25',
          stopLossPrice: '98.75',
          takeProfitTargets: ['109.5'],
        };
      },
    };
    service.brokerAccountRepository = {
      getBrokerAccountById: async (_userId: string, accountId: string) =>
        accountId === 'account-1'
          ? {
              accountName: 'Mudrex Prod',
              accountKey: 'mudrex_prod',
              brokerKey: 'mudrex',
            }
          : null,
    };
    service.whatsappDeliveryRepository = {
      findByDedupeKey: async (dedupeKey: string) =>
        dedupeKey.includes(':duplicate:')
          ? {
              id: 'wa-existing',
            }
          : null,
      queueDelivery: async (payload: Record<string, unknown>) => {
        deliveries.push(payload);
        return {
          id: 'wa-1',
        };
      },
    };

    env.whatsapp.enabled = false;
    const runtimeDisabled = await service.queueLiveTradeSuggestionReadyNotification({
      userId: 'user-1',
      suggestedTradeId: 'trade-disabled-by-env',
      automationId: 'automation-1',
      automationRunId: 'run-1',
    });
    assert.equal(runtimeDisabled.outcome, 'skipped');
    assert.equal(runtimeDisabled.reason, 'runtime-disabled');
    assert.equal(deliveries.length, 0);

    env.whatsapp.enabled = true;
    env.whatsapp.twilio.accountSid = '';
    env.whatsapp.twilio.authToken = '';
    env.whatsapp.twilio.from = '';
    const providerUnconfigured = await service.queueLiveTradeSuggestionReadyNotification({
      userId: 'user-1',
      suggestedTradeId: 'trade-unconfigured',
      automationId: 'automation-1',
      automationRunId: 'run-1',
    });
    assert.equal(providerUnconfigured.outcome, 'skipped');
    assert.equal(providerUnconfigured.reason, 'provider-unconfigured');
    assert.equal(deliveries.length, 0);

    env.whatsapp.twilio.accountSid = 'AC123';
    env.whatsapp.twilio.authToken = 'secret';
    env.whatsapp.twilio.from = 'whatsapp:+14155238886';

    const queued = await service.queueLiveTradeSuggestionReadyNotification({
      userId: 'user-1',
      suggestedTradeId: 'trade-1',
      automationId: 'automation-1',
      automationRunId: 'run-1',
      automationName: 'Momentum Deployment',
      brokerKey: 'mudrex',
      accountId: 'account-1',
    });

    assert.equal(queued.outcome, 'queued');
    assert.equal(queued.reason, 'queued');
    assert.equal(queued.deliveryId, 'wa-1');
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.recipientPhone, '+14155550123');
    assert.equal(deliveries[0]?.dedupeKey, 'live-suggestion:user-1:trade-1:ready');
    assert.equal(deliveries[0]?.templateKey, 'live_trade_suggestion_ready_v1');
    assert.equal(deliveries[0]?.source, 'trade-suggestion.live-auto');
    assert.match(String(deliveries[0]?.body || ''), /BTCUSDT \| 1h \| Long/);
    assert.match(String(deliveries[0]?.body || ''), /Route: mudrex \/ Mudrex Prod/);

    const disabled = await service.queueLiveTradeSuggestionReadyNotification({
      userId: 'user-disabled',
      suggestedTradeId: 'trade-2',
      automationId: 'automation-1',
      automationRunId: 'run-1',
    });
    assert.equal(disabled.outcome, 'skipped');
    assert.equal(disabled.reason, 'whatsapp-disabled');

    const unverified = await service.queueLiveTradeSuggestionReadyNotification({
      userId: 'user-unverified',
      suggestedTradeId: 'trade-3',
      automationId: 'automation-1',
      automationRunId: 'run-1',
    });
    assert.equal(unverified.outcome, 'skipped');
    assert.equal(unverified.reason, 'unverified-number');

    const duplicate = await service.queueLiveTradeSuggestionReadyNotification({
      userId: 'user-1',
      suggestedTradeId: 'duplicate',
      automationId: 'automation-1',
      automationRunId: 'run-1',
    });
    assert.equal(duplicate.outcome, 'skipped');
    assert.equal(duplicate.reason, 'duplicate');

    const missingTrade = await service.queueLiveTradeSuggestionReadyNotification({
      userId: 'user-1',
      suggestedTradeId: 'missing',
      automationId: 'automation-1',
      automationRunId: 'run-1',
    });
    assert.equal(missingTrade.outcome, 'skipped');
    assert.equal(missingTrade.reason, 'suggested-trade-missing');
  } finally {
    env.whatsapp.enabled = originalWhatsappEnv.enabled;
    env.whatsapp.provider = originalWhatsappEnv.provider;
    env.whatsapp.twilio.accountSid = originalWhatsappEnv.twilio.accountSid;
    env.whatsapp.twilio.authToken = originalWhatsappEnv.twilio.authToken;
    env.whatsapp.twilio.from = originalWhatsappEnv.twilio.from;
  }
}

async function main(): Promise<void> {
  await runAutomationsControllerAssertions();
  await runInternalAutomationsControllerAssertions();
  await runSignalsAutomationControllerAssertions();
  await runAutomationScopeLookupAssertions();
  await runAutomationRepositorySearchAssertions();
  await runAutomationRepositoryIndexingAssertions();
  runAutomationLineageMappingAssertions();
  await runAutomationReconcileAssertions();
  await runAutomationControlHardeningAssertions();
  await runAutomationHardDeleteAssertions();
  runAutomationTimeZoneValidationAssertions();
  runAutomationScheduleAuditAssertions();
  await runAutomationSchedulePersistenceAssertions();
  await runTradeSuggestionExecutabilityValidationAssertions();
  await runTradeSuggestionTemplateContractAssertions();
  await runTradeSuggestionCreationWorkflowContractAssertions();
  await runAutomationExecutionHardeningAssertions();
  await runAutomationOperationalSnapshotAssertions();
  await runAutomationsOperationalAssertions();
  await runAutomationRuntimeStaleCandidateAssertions();
  await runWhatsappNotificationQueueAssertions();
  runAutomationSignalEvaluatorAssertions();
  runTradeSuggestionExecutionPolicyValidationAssertions();
  runAutomationsScriptWiringAssertions();
  console.log('Automations module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
