import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { AutomationsController } from '../src/api/controllers/AutomationsController';
import { InternalAutomationsController } from '../src/api/controllers/InternalAutomationsController';
import { SignalsAutomationController } from '../src/api/controllers/SignalsAutomationController';
import { AutomationsService } from '../src/api/services/AutomationsService';
import { AutomationExecutionService } from '../src/api/services/AutomationExecutionService';
import { AutomationSignalEvaluatorService } from '../src/api/services/AutomationSignalEvaluatorService';
import {
  validateAutomationCreateBody,
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

async function runAutomationsControllerAssertions(): Promise<void> {
  const controller: any = new AutomationsController();

  controller.automationsService = {
    getAutomations: async (...args: unknown[]) => createSuccess({ args }),
    getAutomationsSummary: async () => createSuccess({ ok: true }),
    getAutomationById: async (...args: unknown[]) => createSuccess({ args }),
    runAutomationNow: async (...args: unknown[]) => createSuccess({ args }),
    pauseAutomation: async (...args: unknown[]) => createSuccess({ args }),
    resumeAutomation: async (...args: unknown[]) => createSuccess({ args }),
    reconcileAutomationState: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getAutomations(authReq, undefined, undefined, 'Running', 'BTC')
    ).data.args,
    ['user-1', { limit: undefined, offset: undefined, status: 'Running', search: 'BTC' }]
  );
  assert.deepEqual((await controller.getAutomationsSummary(authReq)).data, { ok: true });
  assert.deepEqual((await controller.getAutomationById(authReq, 'bot-1')).data.args, [
    'user-1',
    'bot-1',
  ]);
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
    (await controller.reconcileAutomationState(authReq, 'bot-3', { reason: 'repair' })).data
      .args,
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
        clause: '(automation.automationType IN (:...automationTypes) OR automation.automationType IS NULL)',
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
  assert.equal(events.some((event) => event.type === 'Run reconciled'), true);
  assert.equal(events.some((event) => event.type === 'State reconciled'), true);
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
  service.resolveAutomationTimeZone = async (
    _userId: string,
    automationTimeZone?: string | null
  ) => automationTimeZone || 'UTC';
  service.mapAutomation = (automation: Record<string, unknown>) => automation;
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
  assert.equal(savedAutomations[0].timeZone, 'America/New_York');
  assert.deepEqual(savedAutomations[0].schedule, {
    type: 'daily',
    scheduleMode: 'daily',
    runAt: '16:15',
    hour: 16,
    minute: 15,
    intervalDays: 1,
  });
  assert.ok(savedAutomations[0].nextRun instanceof Date);
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

      const syncResult = await service.syncBacktestRunnerLifecycleByBacktestId(
        'child-backtest-1'
      );

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
        ((runUpdates[0]?.payload.meta as Record<string, unknown> | undefined)
          ?.backtestLifecycle as string | undefined) ?? null,
        'finalized'
      );
      assert.equal(events.some((item) => item.type === 'Run completed'), true);
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

  await assert.rejects(
    async () => {
      await failingSvc.pauseAutomation('user-1', 'bot-1', { reason: 'maintenance' });
    },
    /db unavailable/
  );
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
  assert.ok(cutoffDeltaMs < 15_000, `expected stale cutoff near 20 minutes, got ${cutoffDeltaMs}ms drift`);

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
    proofSource.includes("scripts/smokes/smoke-automations-lifecycle.ts"),
    true,
    'automations live proof must run lifecycle smoke'
  );
  assert.equal(
    proofSource.includes("scripts/checks/check-automations-health.ts"),
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
    evaluatorSource.includes("path.resolve(process.cwd(), 'scripts', '_runtime', 'automation_signal_eval.py')"),
    true,
    'automation signal evaluator must use scripts/_runtime automation runner'
  );
  assert.equal(
    executionSource.includes('suggestedTradeId: context?.suggestedTradeId ?? null'),
    true,
    'live auto order placement must forward suggested-trade context into the order ledger'
  );
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
  runAutomationTimeZoneValidationAssertions();
  runAutomationScheduleAuditAssertions();
  await runAutomationSchedulePersistenceAssertions();
  await runAutomationExecutionHardeningAssertions();
  await runAutomationOperationalSnapshotAssertions();
  await runAutomationsOperationalAssertions();
  await runAutomationRuntimeStaleCandidateAssertions();
  runAutomationSignalEvaluatorAssertions();
  runTradeSuggestionExecutionPolicyValidationAssertions();
  runAutomationsScriptWiringAssertions();
  console.log('Automations module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
