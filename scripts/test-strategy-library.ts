import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { StrategyLabController } from '../src/api/controllers/StrategyLabController';
import { StrategyLibraryController } from '../src/api/controllers/StrategyLibraryController';
import { StrategyTemplatesController } from '../src/api/controllers/StrategyTemplatesController';
import { StrategyLabService } from '../src/api/services/StrategyLabService';
import { StrategyLibraryService } from '../src/api/services/StrategyLibraryService';
import { StrategyTemplatesService } from '../src/api/services/StrategyTemplatesService';
import { validateStrategyLabDraftBody } from '../src/api/validators/strategyLab.validator';
import { strategyDataSource } from '../src/database/pg-data-source';
import { StrategyLibraryRepository } from '../src/database/repositories/StrategyLibraryRepository';
import { StrategyTemplateRepository } from '../src/database/repositories/StrategyTemplateRepository';

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

async function runStrategyLabControllerAssertions(): Promise<void> {
  const controller: any = new StrategyLabController();

  controller.strategyLabService = {
    saveStrategyLabDraft: async (...args: unknown[]) => createSuccess({ args }),
    listStrategyLabProjects: async (...args: unknown[]) => createSuccess({ args }),
    getStrategyLabProjectById: async (...args: unknown[]) => createSuccess({ args }),
    updateStrategyLabProject: async (...args: unknown[]) => createSuccess({ args }),
    validateStrategyLabProject: async (...args: unknown[]) => createSuccess({ args }),
    sendStrategyLabToBacktests: async (...args: unknown[]) => createSuccess({ args }),
    moveStrategyLabProjectToTemplate: async (...args: unknown[]) => createSuccess({ args }),
  };

  const createBody = {
    name: 'Draft',
    market: 'crypto-futures',
    timeframe: '1h',
    objective: 'probability-alpha',
    universe: 'top-25-liquidity',
    authoringMode: 'no_code',
    codeTarget: null,
    visualDefinition: { identity: { name: 'Draft', objective: 'probability-alpha' } },
    codeDefinition: null,
    parameters: {},
    riskConfig: {},
  };

  assert.deepEqual((await controller.saveStrategyLabDraft(authReq, createBody)).data.args, [
    'user-1',
    createBody,
  ]);
  assert.deepEqual(
    (await controller.listStrategyLabProjects(authReq, '25', '10', 'breakout')).data.args,
    ['user-1', { limit: '25', offset: '10', search: 'breakout' }]
  );
  assert.deepEqual((await controller.getStrategyLabProjectById(authReq, 'proj-1')).data.args, [
    'user-1',
    'proj-1',
  ]);

  const updateBody = {
    ...createBody,
    authoringMode: 'code',
    codeTarget: 'dsl',
    visualDefinition: null,
    codeDefinition:
      'STRATEGY Draft\nMARKET crypto-futures\nTIMEFRAME 1h\nUNIVERSE top-25-liquidity\nENTRY breakout\nEXIT reversal\nRISK max_per_trade 1.5%',
  };
  assert.deepEqual(
    (await controller.updateStrategyLabProject(authReq, 'proj-1', updateBody)).data.args,
    ['user-1', 'proj-1', updateBody]
  );
  assert.deepEqual((await controller.validateStrategyLabProject(authReq, 'proj-1')).data.args, [
    'user-1',
    'proj-1',
  ]);

  const handoffBody = { projectId: 'proj-1' };
  assert.deepEqual((await controller.sendStrategyLabToBacktests(authReq, handoffBody)).data.args, [
    'user-1',
    handoffBody,
  ]);
  assert.deepEqual((await controller.moveStrategyLabProjectToTemplate(authReq, 'proj-1')).data.args, [
    'user-1',
    'proj-1',
  ]);

  await assertAuthRequired(() => controller.listStrategyLabProjects(unauthReq));
  await assertAuthRequired(() => controller.getStrategyLabProjectById(unauthReq, 'proj-1'));
  await assertAuthRequired(() => controller.moveStrategyLabProjectToTemplate(unauthReq, 'proj-1'));
}

async function runStrategyLibraryControllerAssertions(): Promise<void> {
  const controller: any = new StrategyLibraryController();

  controller.strategyLibraryService = {
    listLibrary: async (...args: unknown[]) => createSuccess({ args }),
    getLibraryById: async (...args: unknown[]) => createSuccess({ args }),
    getLibraryRuns: async (...args: unknown[]) => createSuccess({ args }),
    importTemplate: async (...args: unknown[]) => createSuccess({ args }),
    updateLibrary: async (...args: unknown[]) => createSuccess({ args }),
    updateLibraryStatus: async (...args: unknown[]) => createSuccess({ args }),
    deleteLibrary: async (...args: unknown[]) => createSuccess({ args }),
    runLibraryStrategy: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.listLibrary(
        authReq,
        '10',
        '20',
        'Active',
        'momentum',
        'name_asc',
        'true',
        'false',
        'true',
        'false',
        'true'
      )
    ).data.args,
    [
      'user-1',
      {
        limit: '10',
        offset: '20',
        status: 'Active',
        search: 'momentum',
        sort: 'name_asc',
        hasAssets: 'true',
        hasTimeframes: 'false',
        scopeReady: 'true',
        automationReady: 'false',
        lastRunFailed: 'true',
      },
    ]
  );
  assert.deepEqual((await controller.getLibraryById(authReq, 'lib-1')).data.args, [
    'user-1',
    'lib-1',
  ]);
  assert.deepEqual((await controller.getLibraryRuns(authReq, 'lib-1', '5')).data.args, [
    'user-1',
    'lib-1',
    { limit: '5' },
  ]);
  assert.deepEqual(
    (await controller.importTemplate(authReq, { templateId: 'tpl-1', name: 'Runner' })).data.args,
    ['user-1', { templateId: 'tpl-1', name: 'Runner' }]
  );
  assert.deepEqual(
    (
      await controller.updateLibrary(authReq, 'lib-1', {
        name: 'Runner v2',
        assets: [{ symbol: 'BTCUSDT' }],
      })
    ).data.args,
    ['user-1', 'lib-1', { name: 'Runner v2', assets: [{ symbol: 'BTCUSDT' }] }]
  );
  assert.deepEqual(
    (await controller.updateLibraryStatus(authReq, 'lib-1', { status: 'Paused' })).data.args,
    ['user-1', 'lib-1', { status: 'Paused' }]
  );
  assert.deepEqual((await controller.deleteLibrary(authReq, 'lib-1')).data.args, [
    'user-1',
    'lib-1',
  ]);
  assert.deepEqual(
    (await controller.runLibraryStrategy(authReq, 'lib-1', { assets: [{ symbol: 'BTCUSDT' }] }))
      .data.args,
    ['user-1', 'lib-1', { assets: [{ symbol: 'BTCUSDT' }] }]
  );

  await assertAuthRequired(() => controller.listLibrary(unauthReq));
  await assertAuthRequired(() => controller.getLibraryById(unauthReq, 'lib-1'));
}

async function runStrategyTemplatesControllerAssertions(): Promise<void> {
  const controller: any = new StrategyTemplatesController();

  controller.strategyTemplatesService = {
    listStrategyTemplates: async (...args: unknown[]) => createSuccess({ args }),
    getStrategyTemplateById: async (...args: unknown[]) => createSuccess({ args }),
    listStrategyTemplateVersions: async (...args: unknown[]) => createSuccess({ args }),
    createStrategyTemplate: async (...args: unknown[]) => createSuccess({ args }),
    updateStrategyTemplate: async (...args: unknown[]) => createSuccess({ args }),
    updateStrategyTemplateStatus: async (...args: unknown[]) => createSuccess({ args }),
    duplicateStrategyTemplate: async (...args: unknown[]) => createSuccess({ args }),
    deleteStrategyTemplate: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (await controller.listStrategyTemplates(authReq, '25', '10', 'Active', 'momentum')).data.args,
    ['user-1', { limit: '25', offset: '10', status: 'Active', search: 'momentum' }]
  );
  assert.deepEqual((await controller.getStrategyTemplateById(authReq, 'template-1')).data.args, [
    'user-1',
    'template-1',
  ]);
  assert.deepEqual(
    (await controller.listStrategyTemplateVersions(authReq, 'template-1')).data.args,
    ['user-1', 'template-1']
  );

  const createBody = { name: 'Momentum Core', status: 'Draft' };
  assert.deepEqual((await controller.createStrategyTemplate(authReq, createBody)).data.args, [
    'user-1',
    createBody,
  ]);

  const updateBody = { name: 'Momentum Core v2' };
  assert.deepEqual(
    (await controller.updateStrategyTemplate(authReq, 'template-1', updateBody)).data.args,
    ['user-1', 'template-1', updateBody]
  );

  const statusBody = { status: 'Paused' };
  assert.deepEqual(
    (await controller.updateStrategyTemplateStatus(authReq, 'template-1', statusBody)).data.args,
    ['user-1', 'template-1', statusBody]
  );

  const duplicateBody = { name: 'Momentum Core Copy' };
  assert.deepEqual(
    (await controller.duplicateStrategyTemplate(authReq, 'template-1', duplicateBody)).data.args,
    ['user-1', 'template-1', duplicateBody]
  );

  assert.deepEqual((await controller.deleteStrategyTemplate(authReq, 'template-1')).data.args, [
    'user-1',
    'template-1',
  ]);

  await assertAuthRequired(() => controller.listStrategyTemplates(unauthReq));
  await assertAuthRequired(() => controller.getStrategyTemplateById(unauthReq, 'template-1'));
}

function runStrategyLabValidationAssertions(): void {
  const validated = validateStrategyLabDraftBody({
    name: 'Breakout Draft',
    description: 'Saved description',
    authoringMode: 'code',
    market: 'crypto-futures',
    timeframe: '15m',
    timeframes: ['15m', '1h'],
    codeTarget: 'python',
    codeDefinition: `from auralpha import Strategy

class StrategyDraft(Strategy):
    name = "Breakout Draft"
    market = "crypto-futures"

    def entry(self, ctx):
        return True

    def exit(self, ctx):
        return False

    risk = {
        "max_per_trade": 2.0,
        "signal_threshold": 0.9,
    }`,
    parameters: {
      signal_threshold: '0.91',
    },
    riskConfig: {
      max_per_trade: '2.25',
      sizingNotes: 'Scale in after confirmation',
    },
  });

  assert.equal(validated.description, 'Saved description');
  assert.equal(validated.maxRisk, '2.25');
  assert.equal(validated.signalThreshold, '0.91');
  assert.equal(validated.riskConfig?.maxRisk, '2.25');
  assert.equal(validated.parameters?.signalThreshold, '0.91');
  assert.equal(validated.sourceTemplateId, null);
  assert.equal(validated.sourceTemplateVersion, null);
  assert.equal(validated.sourceTemplateName, null);
  assert.equal(validated.shortEnabled, false);
  assert.equal(validated.entryShortLogic, '');
  assert.equal(validated.exitShortLogic, '');
}

async function runStrategyLabListServiceAssertions(): Promise<void> {
  const service = new StrategyLabService() as any;
  const repositoryCalls: Array<Record<string, unknown>> = [];

  service.strategyLabRepository = {
    async listProjects(userId: string, params: Record<string, unknown>) {
      repositoryCalls.push({ userId, ...params });
      return {
        items: [
          {
            id: 'proj-1',
            userId,
            name: 'Breakout Draft',
            description: null,
            status: 'Draft',
            projectVersion: 2,
            sourceTemplateId: 'template-1',
            sourceTemplateVersion: 7,
            authoringMode: 'code',
            codeTarget: 'python',
            visualDefinition: null,
            codeDefinition: 'class StrategyDraft(Strategy):\n    pass',
            parameters: { signalThreshold: '0.8' },
            riskConfig: { maxRisk: '1.5' },
            validationState: 'valid',
            validationErrors: [],
            validationWarnings: [],
            objective: 'probability-alpha',
            market: 'crypto-futures',
            timeframe: '15m',
            universe: 'top-25-liquidity',
            config: {
              assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
              timeframes: ['15m', '1h'],
              start: '2026-02-01',
              end: '2026-04-01',
              sourceTemplateName: 'Momentum Template',
            },
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
            updatedAt: new Date('2026-04-02T00:00:00.000Z'),
            lastValidatedAt: new Date('2026-04-02T12:00:00.000Z'),
          },
        ],
        total: 1,
      };
    },
  };

  const response = await service.listStrategyLabProjects('user-1', {
    limit: '25',
    offset: '3',
    search: ' breakout ',
  });

  assert.deepEqual(repositoryCalls, [
    { userId: 'user-1', limit: 25, offset: 3, search: 'breakout' },
  ]);
  assert.equal(response.data.total, 1);
  assert.equal(response.data.items[0]?.id, 'proj-1');
  assert.equal(response.data.items[0]?.sourceTemplateId, 'template-1');
  assert.equal(response.data.items[0]?.sourceTemplateVersion, 7);
  assert.equal(response.data.items[0]?.sourceTemplateName, 'Momentum Template');
  assert.deepEqual(response.data.items[0]?.assets, [{ symbol: 'BTCUSDT', brokerKey: 'paper' }]);
  assert.deepEqual(response.data.items[0]?.timeframes, ['15m', '1h']);
  assert.equal(response.data.items[0]?.start, '2026-02-01');
  assert.equal(response.data.items[0]?.end, '2026-04-01');
  assert.equal(response.data.items[0]?.lastValidatedAt, '2026-04-02T12:00:00.000Z');
}

function runStrategyTemplateNormalizationAssertions(): void {
  const service = new StrategyTemplatesService() as any;

  const normalizedDsl = service.coerceTemplateConfigToPython(
    {
      codeTarget: 'dsl',
      codeDefinition: `STRATEGY Mean Reversion
MARKET crypto-futures
ENTRY ema(20) > ema(50)
EXIT ema(20) < ema(50)
RISK max_per_trade=1.5 signal_threshold=0.82`,
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      risk: {
        maxRisk: '1.5',
      },
      parameters: {
        signalThreshold: '0.82',
      },
    },
    'Mean Reversion'
  );

  assert.equal(normalizedDsl.codeTarget, 'python');
  assert.equal(normalizedDsl.compiledCodeTarget, 'python');
  assert.equal(normalizedDsl.authoredCodeTarget, 'dsl');
  assert.match(String(normalizedDsl.authoredCodeDefinition || ''), /^STRATEGY Mean Reversion/m);
  assert.match(String(normalizedDsl.compiledCodeDefinition || ''), /def entry\(self, ctx\):/);
  assert.match(
    String(normalizedDsl.compiledCodeDefinition || ''),
    /def entry_short\(self, ctx\):\n {8}return False/
  );
  assert.equal(normalizedDsl.shortEnabled, false);
  assert.equal(normalizedDsl.entryShortLogic, '');
  assert.equal(normalizedDsl.exitShortLogic, '');

  const normalizedPythonRisk = service.coerceTemplateConfigToPython(
    {
      codeTarget: 'python',
      codeDefinition: `from auralpha import Strategy

class BreakoutRisk(Strategy):
    name = "Breakout Risk"
    market = "crypto-futures"

    def entry(self, ctx):
        return True

    def exit(self, ctx):
        return False

    risk = {
        "stop_loss_pct": 1.2,
        "take_profit_pct": 2.6,
    }`,
      risk: {
        maxRisk: '1.5',
        sizingNotes: 'Preserve execution risk',
      },
    },
    'Breakout Risk'
  );

  assert.equal(normalizedPythonRisk.risk.stop_loss_pct, 1.2);
  assert.equal(normalizedPythonRisk.risk.take_profit_pct, 2.6);
  assert.equal(normalizedPythonRisk.risk.maxRisk, '1.5');

  const mappedTemplate = service.mapTemplate({
    id: 'template-1',
    userId: 'user-1',
    name: 'Mapped Template',
    description: 'Versioned',
    status: 'Draft',
    templateVersion: 4,
    config: { market: 'crypto-futures' },
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-15T00:00:00.000Z'),
  });

  assert.equal(mappedTemplate.templateVersion, 4);
}

async function runStrategyTemplateSuggestionImportAssertions(): Promise<void> {
  const service = new StrategyTemplatesService() as any;
  const createdPayloads: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];

  Object.defineProperty(service, 'strategyTemplateRepository', {
    value: {
      async createStrategyTemplate(userId: string, payload: Record<string, unknown>) {
        createdPayloads.push({ userId, ...payload });
        return {
          id: 'imported-template-1',
          userId,
          name: String(payload.name || ''),
          description: payload.description ?? null,
          status: String(payload.status || 'Draft'),
          templateVersion: 1,
          config: payload.config ?? null,
          createdAt: new Date('2026-04-03T00:00:00.000Z'),
          updatedAt: new Date('2026-04-03T00:00:00.000Z'),
        };
      },
    },
  });

  Object.defineProperty(service, 'operationalEventService', {
    value: {
      async logActivity(userId: string, payload: Record<string, unknown>) {
        activities.push({ userId, ...payload });
      },
      async emitFailureAlert() {
        throw new Error('emitFailureAlert should not run for successful imports');
      },
    },
  });

  const result = await service.importStrategyTemplateSuggestion({
    userId: 'user-42',
    suggestionId: 'suggestion-7',
    templateId: 'template-9',
    templateName: 'Momentum Core',
    suggestedName: 'Momentum Core (Improved)',
    diffSummary: 'Risk tweak: Tighter stop, higher target',
    reasoning: 'Avg score improved across multi-asset evaluation.',
    suggestedConfig: {
      codeTarget: 'dsl',
      codeDefinition: `STRATEGY Momentum Core\nENTRY ema(9) > ema(21)\nEXIT ema(9) < ema(21)`,
      entryLogic: 'ema(9) > ema(21)',
      exitLogic: 'ema(9) < ema(21)',
    },
  });

  assert.equal(createdPayloads.length, 1);
  assert.equal(createdPayloads[0].userId, 'user-42');
  assert.equal(createdPayloads[0].name, 'Momentum Core (Improved)');
  assert.equal(createdPayloads[0].status, 'Draft');
  assert.match(
    String(createdPayloads[0].description || ''),
    /Imported from AI Discovery suggestion suggestion-7/
  );
  assert.match(String(createdPayloads[0].description || ''), /Momentum Core/);
  assert.match(String(createdPayloads[0].description || ''), /Risk tweak/);
  assert.match(
    String((createdPayloads[0].config as Record<string, unknown>)?.codeDefinition || ''),
    /class StrategyDraft\(Strategy\):/
  );
  assert.equal(result.data.id, 'imported-template-1');
  assert.equal(result.data.templateVersion, 1);
  assert.equal(activities.length, 1);
}

async function runStrategyTemplateVersionLifecycleAssertions(): Promise<void> {
  const service = new StrategyTemplatesService() as any;
  const activities: Array<Record<string, unknown>> = [];
  const statusPayloads: Array<Record<string, unknown>> = [];
  const duplicatePayloads: Array<Record<string, unknown>> = [];

  Object.defineProperty(service, 'strategyTemplateRepository', {
    value: {
      async getStrategyTemplateById(userId: string, strategyId: string) {
        if (userId !== 'user-1' || strategyId !== 'template-1') {
          return null;
        }
        return {
          id: strategyId,
          userId,
          name: 'Momentum Core',
          description: 'Reusable momentum baseline',
          status: 'Active',
          templateVersion: 4,
          config: { market: 'crypto-futures' },
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-03T00:00:00.000Z'),
        };
      },
      async listStrategyTemplateVersions(userId: string, strategyId: string) {
        assert.equal(userId, 'user-1');
        assert.equal(strategyId, 'template-1');
        return [
          {
            id: 'version-4',
            strategyTemplateId: strategyId,
            userId,
            actorUserId: userId,
            templateVersion: 4,
            changeType: 'status_changed',
            name: 'Momentum Core',
            description: 'Reusable momentum baseline',
            status: 'Active',
            config: { market: 'crypto-futures' },
            createdAt: new Date('2026-04-03T00:00:00.000Z'),
          },
          {
            id: 'version-1',
            strategyTemplateId: strategyId,
            userId,
            actorUserId: userId,
            templateVersion: 1,
            changeType: 'created',
            name: 'Momentum Core',
            description: 'Reusable momentum baseline',
            status: 'Draft',
            config: { market: 'crypto-futures' },
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
          },
        ];
      },
      async updateStrategyTemplateStatus(
        userId: string,
        strategyId: string,
        payload: Record<string, unknown>
      ) {
        statusPayloads.push({ userId, strategyId, ...payload });
        return {
          id: strategyId,
          userId,
          name: 'Momentum Core',
          description: 'Reusable momentum baseline',
          status: String(payload.status || 'Draft'),
          templateVersion: 5,
          config: { market: 'crypto-futures' },
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-04T00:00:00.000Z'),
        };
      },
      async duplicateStrategyTemplate(
        userId: string,
        strategyId: string,
        payload: Record<string, unknown>
      ) {
        duplicatePayloads.push({ userId, strategyId, ...payload });
        return {
          id: 'template-2',
          userId,
          name: String(payload.name || 'Momentum Core Copy'),
          description: 'Reusable momentum baseline',
          status: 'Draft',
          templateVersion: 1,
          config: { market: 'crypto-futures' },
          createdAt: new Date('2026-04-05T00:00:00.000Z'),
          updatedAt: new Date('2026-04-05T00:00:00.000Z'),
        };
      },
    },
  });

  Object.defineProperty(service, 'operationalEventService', {
    value: {
      async logActivity(userId: string, payload: Record<string, unknown>) {
        activities.push({ userId, ...payload });
      },
      async emitFailureAlert() {
        throw new Error('emitFailureAlert should not run for successful version actions');
      },
    },
  });

  const versionsResult = await service.listStrategyTemplateVersions('user-1', 'template-1');
  assert.equal(versionsResult.data.total, 2);
  assert.equal(versionsResult.data.items[0].changeType, 'status_changed');
  assert.equal(versionsResult.data.items[0].templateVersion, 4);
  assert.equal(versionsResult.data.items[1].changeType, 'created');

  const statusResult = await service.updateStrategyTemplateStatus('user-1', 'template-1', {
    status: 'Paused',
  });
  assert.equal(statusPayloads.length, 1);
  assert.deepEqual(statusPayloads[0], {
    userId: 'user-1',
    strategyId: 'template-1',
    status: 'Paused',
  });
  assert.equal(statusResult.data.status, 'Paused');
  assert.equal(statusResult.data.templateVersion, 5);

  const duplicateResult = await service.duplicateStrategyTemplate('user-1', 'template-1', {
    name: 'Momentum Core Copy',
  });
  assert.equal(duplicatePayloads.length, 1);
  assert.deepEqual(duplicatePayloads[0], {
    userId: 'user-1',
    strategyId: 'template-1',
    name: 'Momentum Core Copy',
    targetUserId: undefined,
  });
  assert.equal(duplicateResult.data.name, 'Momentum Core Copy');
  assert.equal(duplicateResult.data.status, 'Draft');
  assert.equal(duplicateResult.data.templateVersion, 1);
  assert.equal(activities.length >= 2, true);
}

async function runStrategyTemplateSearchQueryAssertions(): Promise<void> {
  const repository = new StrategyTemplateRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
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
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    async getManyAndCount() {
      return [[], 0] as const;
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listStrategyTemplates('user-1', {
      limit: 20,
      offset: 0,
      status: 'Active',
      search: ' Momentum_100% ',
    });

    assert.equal(response.total, 0);
    assert.equal(capturedWhereClauses.length, 3);
    assert.equal(capturedWhereClauses[0].clause, 'strategy.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'strategy.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Active' });
    assert.equal(
      capturedWhereClauses[2].clause,
      "LOWER(COALESCE(strategy.name, '') || ' ' || COALESCE(strategy.description, '')) LIKE :search ESCAPE '\\'"
    );
    assert.deepEqual(capturedWhereClauses[2].params, {
      search: '%momentum\\_100\\%%',
    });
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runStrategyLibrarySearchQueryAssertions(): Promise<void> {
  const repository = new StrategyLibraryRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
  const capturedWhereClauses: Array<{ clause: string; params?: Record<string, unknown> }> = [];
  const capturedJoins: Array<{ table: string; alias: string; condition?: string }> = [];
  const builder = {
    where(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    leftJoin(table: string, alias: string, condition?: string) {
      capturedJoins.push({ table, alias, condition });
      return this;
    },
    orderBy() {
      return this;
    },
    addOrderBy() {
      return this;
    },
    skip() {
      return this;
    },
    take() {
      return this;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      capturedWhereClauses.push({ clause, params });
      return this;
    },
    async getManyAndCount() {
      return [[], 0] as const;
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    const response = await repository.listLibrary('user-1', {
      limit: 20,
      offset: 0,
      status: 'Draft',
      search: ' Runner_100% ',
      hasAssets: true,
      hasTimeframes: false,
    });

    assert.equal(response.total, 0);
    assert.equal(capturedJoins.length, 1);
    assert.deepEqual(capturedJoins[0], {
      table: 'strategy_templates',
      alias: 'template',
      condition: 'template.id = library.templateId AND template.userId = library.userId',
    });
    assert.equal(capturedWhereClauses.length, 5);
    assert.equal(capturedWhereClauses[0].clause, 'library.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'library.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Draft' });
    assert.equal(
      capturedWhereClauses[2].clause,
      "CASE WHEN library.assets IS NULL THEN 0 ELSE jsonb_array_length(library.assets) END > 0"
    );
    assert.equal(
      capturedWhereClauses[3].clause,
      "CASE WHEN library.timeframes IS NULL THEN 0 ELSE jsonb_array_length(library.timeframes) END = 0"
    );
    assert.equal(
      capturedWhereClauses[4].clause,
      "(LOWER(COALESCE(library.name, '')) LIKE :search ESCAPE '\\' OR LOWER(COALESCE(template.name, '') || ' ' || COALESCE(template.description, '')) LIKE :search ESCAPE '\\')"
    );
    assert.deepEqual(capturedWhereClauses[4].params, {
      search: '%runner\\_100\\%%',
    });
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runStrategyLibrarySignalScanStatusAssertions(): Promise<void> {
  const repository = new StrategyLibraryRepository();
  const originalGetRepository = strategyDataSource.getRepository.bind(strategyDataSource);
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
    take() {
      return this;
    },
    async getMany() {
      return [];
    },
  };

  (strategyDataSource as any).getRepository = () => ({
    createQueryBuilder: () => builder,
  });

  try {
    await repository.listForSignalScan('user-1', 5);

    assert.equal(capturedWhereClauses.length, 2);
    assert.equal(capturedWhereClauses[0].clause, 'library.userId = :userId');
    assert.deepEqual(capturedWhereClauses[0].params, { userId: 'user-1' });
    assert.equal(capturedWhereClauses[1].clause, 'library.status = :status');
    assert.deepEqual(capturedWhereClauses[1].params, { status: 'Active' });
  } finally {
    (strategyDataSource as any).getRepository = originalGetRepository;
  }
}

async function runStrategyLabBacktestHandoffAssertions(): Promise<void> {
  const service = new StrategyLabService() as any;
  const queuedPayloads: Array<Record<string, unknown>> = [];
  const validationUpdates: Array<Record<string, unknown>> = [];
  const project = {
    id: 'proj-1',
    userId: 'user-1',
    name: 'Validated Draft',
    description: 'Ready for handoff',
    status: 'Draft',
    authoringMode: 'code',
    codeTarget: 'python',
    visualDefinition: null,
    codeDefinition: `from auralpha import Strategy

class StrategyDraft(Strategy):
    name = "Validated Draft"
    market = "crypto-futures"

    def entry(self, ctx):
        return ema(ctx, 20) > ema(ctx, 50)

    def exit(self, ctx):
        return ema(ctx, 20) < ema(ctx, 50)

    risk = {
        "max_per_trade": 1.5,
        "signal_threshold": 0.82,
        "stop_loss_pct": 1.2,
        "take_profit_pct": 2.6,
    }`,
    parameters: {
      signalThreshold: '0.88',
      signal_threshold: '0.88',
    },
    riskConfig: {
      maxRisk: '1.75',
      max_per_trade: '1.75',
      sizingNotes: 'Keep risk fixed',
    },
    validationState: 'idle',
    validationErrors: [],
    validationWarnings: [],
    lastValidatedAt: null,
    objective: 'probability-alpha',
    market: 'crypto-futures',
    timeframe: '15m',
    universe: 'top-25-liquidity',
    projectVersion: 3,
    sourceTemplateId: 'template-1',
    sourceTemplateVersion: 6,
    config: {
      codeDefinition: `from auralpha import Strategy

class StrategyDraft(Strategy):
    name = "Validated Draft"
    market = "crypto-futures"

    def entry(self, ctx):
        return ema(ctx, 20) > ema(ctx, 50)

    def exit(self, ctx):
        return ema(ctx, 20) < ema(ctx, 50)

    risk = {
        "max_per_trade": 1.5,
        "signal_threshold": 0.82,
        "stop_loss_pct": 1.2,
        "take_profit_pct": 2.6,
    }`,
      codeTarget: 'python',
      market: 'crypto-futures',
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      shortEnabled: true,
      entryShortLogic: 'ema(20) < ema(50)',
      exitShortLogic: 'ema(20) > ema(50)',
      risk: {
        maxRisk: '1.75',
        max_per_trade: '1.75',
        sizingNotes: 'Keep risk fixed',
      },
      parameters: {
        signalThreshold: '0.88',
        signal_threshold: '0.88',
      },
      filters: {
        useAiFilter: true,
        useRegimeFilter: true,
        paperTradeFirst: true,
      },
      assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
      timeframes: ['15m', '1h'],
      start: '2026-02-01',
      end: '2026-04-01',
      projectVersion: 3,
      sourceTemplateId: 'template-1',
      sourceTemplateVersion: 6,
      sourceTemplateName: 'Momentum Template',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  service.strategyLabRepository = {
    getProjectById: async () => project,
    updateValidation: async (
      userId: string,
      projectId: string,
      validationState: string,
      validationErrors: unknown[],
      validationWarnings: unknown[],
      validatedAt: Date
    ) => {
      validationUpdates.push({
        userId,
        projectId,
        validationState,
        validationErrors,
        validationWarnings,
        validatedAt,
      });
      return project;
    },
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => ({
      id: 'template-1',
      userId: 'user-1',
      name: 'Momentum Template',
      description: 'Template baseline',
      status: 'Draft',
      templateVersion: 6,
      config: {
        codeTarget: 'python',
        market: 'crypto-futures',
        entryLogic: 'ema(10) > ema(30)',
        exitLogic: 'ema(10) < ema(30)',
        shortEnabled: false,
        risk: {
          maxRisk: '1.25',
          sizingNotes: 'Baseline sizing',
        },
        parameters: {
          signalThreshold: '0.75',
        },
        filters: {
          useAiFilter: false,
          useRegimeFilter: true,
          paperTradeFirst: true,
        },
        notes: 'Template notes',
      },
    }),
  };
  service.backtestRepository = {
    createQueuedBacktest: async (_userId: string, payload: Record<string, unknown>) => {
      queuedPayloads.push(payload);
      return {
        id: 'backtest-1',
        name: payload.name,
        strategy: payload.strategy,
        symbol: payload.symbol,
        parameter: payload.parameter,
        status: payload.status,
      };
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  const response = await service.sendStrategyLabToBacktests('user-1', {
    projectId: 'proj-1',
  });

  assert.equal(response.data.backtestId, 'backtest-1');
  assert.equal(validationUpdates.length, 1);
  assert.equal(validationUpdates[0]?.validationState, 'valid');
  assert.equal(queuedPayloads.length, 1);
  const config = queuedPayloads[0]?.config as Record<string, unknown>;
  assert.equal(config?.source, 'strategy_lab');
  assert.equal(config?.sourceType, 'strategy_lab');
  assert.equal(config?.sourceId, 'proj-1');
  assert.equal(config?.projectId, 'proj-1');
  assert.equal(config?.projectVersion, 3);
  assert.equal(config?.sourceTemplateId, 'template-1');
  assert.equal(config?.sourceTemplateVersion, 6);
  assert.equal(config?.sourceTemplateName, 'Momentum Template');
  assert.equal(config?.market, 'crypto-futures');
  const template = config?.template as Record<string, unknown>;
  assert.equal(template?.templateVersion, 3);
  assert.equal(template?.sourceTemplateId, 'template-1');
  assert.equal(template?.sourceTemplateVersion, 6);
  const templateConfig = template?.config as Record<string, unknown>;
  const risk = templateConfig?.risk as Record<string, unknown>;
  const parameters = templateConfig?.parameters as Record<string, unknown>;
  assert.equal(risk?.maxRisk, '1.75');
  assert.equal(risk?.stop_loss_pct, 1.2);
  assert.equal(risk?.take_profit_pct, 2.6);
  assert.equal(parameters?.signalThreshold, '0.88');
  assert.equal(templateConfig?.shortEnabled, true);
  assert.equal(templateConfig?.entryShortLogic, 'ema(20) < ema(50)');
  assert.equal(templateConfig?.exitShortLogic, 'ema(20) > ema(50)');
}

async function runStrategyLibraryBacktestSnapshotAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const queuedPayloads: Array<Record<string, unknown>> = [];
  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Library-ready template',
    status: 'Active',
    templateVersion: 8,
    config: {
      market: 'crypto-futures',
      codeTarget: 'python',
      codeDefinition: 'class MomentumTemplate(Strategy):\n    pass',
    },
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-15T00:00:00.000Z'),
  };
  const record = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Active',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['15m', '1h'],
    overrides: {
      maxPositions: 2,
      start: '2026-01-01',
      end: '2026-01-31',
    },
    createdAt: new Date('2026-03-20T00:00:00.000Z'),
    updatedAt: new Date('2026-03-21T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => record,
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  service.backtestRepository = {
    createQueuedBacktest: async (_userId: string, payload: Record<string, unknown>) => {
      queuedPayloads.push(payload);
      return {
        id: 'backtest-library-1',
        name: payload.name,
        strategy: payload.strategy,
        symbol: payload.symbol,
        parameter: payload.parameter,
        status: payload.status,
      };
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  const response = await service.runLibraryStrategy('user-1', 'library-1', {
    assets: [
      { symbol: 'ETHUSDT', brokerKey: 'paper' },
      { symbol: 'SOLUSDT', brokerKey: 'paper' },
    ],
    timeframes: ['4h'],
    overrides: { maxPositions: 5, market: 'crypto-spot' },
    start: '2026-02-01',
    end: '2026-04-01',
  });

  assert.equal(response.data.backtestId, 'backtest-library-1');
  assert.equal(response.data.id, 'library-1');
  assert.equal(response.data.status, 'queued');
  assert.equal(response.data.message, 'Backtest queued with current configuration');
  assert.equal(queuedPayloads.length, 1);
  const config = queuedPayloads[0]?.config as Record<string, unknown>;
  assert.equal(config?.source, 'strategy_library');
  assert.equal(config?.sourceType, 'strategy_library');
  assert.equal(config?.sourceId, 'library-1');
  assert.equal(config?.libraryId, 'library-1');
  assert.equal(config?.templateId, 'template-1');
  assert.equal(config?.templateVersion, 8);
  assert.equal(config?.market, 'crypto-spot');
  assert.deepEqual(config?.assets, [
    { symbol: 'ETHUSDT', brokerKey: 'paper' },
    { symbol: 'SOLUSDT', brokerKey: 'paper' },
  ]);
  assert.deepEqual(config?.timeframes, ['4h']);
  assert.deepEqual(config?.overrides, { maxPositions: 5, market: 'crypto-spot' });
  assert.equal(config?.start, '2026-02-01T00:00:00.000Z');
  assert.equal(config?.end, '2026-04-01T23:59:59.999Z');
}

async function runStrategyLibraryLifecycleGuardAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const archivedRecord = {
    id: 'library-archived',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Archived Runner',
    status: 'Archived',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => archivedRecord,
    updateLibrary: async () => {
      throw new Error('updateLibrary should not be called for archived entries');
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      service.updateLibrary('user-1', 'library-archived', {
        name: 'Archived Runner v2',
      }),
    /read-only/
  );

  await assert.rejects(
    () => service.runLibraryStrategy('user-1', 'library-archived', {}),
    /cannot be run/
  );
}

async function runStrategyLibraryStatusUpdateAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const events: Array<Record<string, unknown>> = [];
  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Trend-following template',
    status: 'Active',
    templateVersion: 5,
    config: {
      editorMode: 'rule-based',
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      market: 'crypto-futures',
    },
  };
  const draftRecord = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Draft',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => draftRecord,
    updateLibraryStatus: async (_userId: string, _id: string, payload: Record<string, unknown>) => ({
      ...draftRecord,
      status: payload.status,
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
    }),
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  service.backtestRepository = {
    getLatestStrategyLibraryBacktests: async () =>
      new Map([
        [
          'library-1',
          {
            libraryId: 'library-1',
            backtestId: 'backtest-9',
            status: 'Completed',
            createdAt: new Date('2026-04-02T10:00:00.000Z'),
            updatedAt: new Date('2026-04-02T10:05:00.000Z'),
          },
        ],
      ]),
  };
  service.operationalEventService = {
    logActivity: async (_userId: string, payload: Record<string, unknown>) => {
      events.push(payload);
    },
    emitFailureAlert: async () => undefined,
  };

  const response = await service.updateLibraryStatus('user-1', 'library-1', {
    status: 'Active',
  });

  assert.equal(response.data.status, 'Active');
  assert.equal(response.data.lifecycle.canEdit, true);
  assert.equal(response.data.lifecycle.canRunManually, true);
  assert.equal(response.data.lifecycle.scheduledSignalsEnabled, true);
  assert.deepEqual(response.data.lifecycle.allowedTransitions, ['Paused', 'Archived']);
  assert.equal(response.data.latestRun?.backtestId, 'backtest-9');
  assert.equal(events.length, 1);

  await assert.rejects(
    () =>
      service.updateLibraryStatus('user-1', 'library-1', {
        status: 'Paused',
      }),
    /cannot move from Draft to Paused/
  );
}

async function runStrategyLibraryImportConflictAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const duplicateRecord = {
    id: 'library-duplicate',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Draft',
    assets: null,
    timeframes: null,
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };
  const existingRecord = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Alpha Runner',
    status: 'Draft',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => existingRecord,
    findByTemplateAndNormalizedName: async (
      _userId: string,
      templateId: string,
      name: string,
      excludeId?: string
    ) => {
      assert.equal(templateId, 'template-1');
      assert.equal(String(name).trim().toLowerCase(), 'momentum runner');
      if (excludeId) {
        assert.equal(excludeId, 'library-1');
      }
      return duplicateRecord;
    },
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => ({
      id: 'template-1',
      userId: 'user-1',
      name: 'Momentum Template',
      description: 'Trend-following template',
      status: 'Active',
      templateVersion: 5,
      config: {
        market: 'crypto-futures',
      },
    }),
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      service.importTemplate('user-1', {
        templateId: 'template-1',
        name: '  Momentum Runner  ',
      }),
    /already exists/
  );

  await assert.rejects(
    () =>
      service.updateLibrary('user-1', 'library-1', {
        name: ' Momentum Runner ',
      }),
    /already exists/
  );
}

async function runStrategyLibraryRunDateValidationAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const recordWithInvalidSavedDate = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Active',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: {
      start: 'not-a-real-date',
    },
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  service.strategyLibraryRepository = {
    getById: async () => recordWithInvalidSavedDate,
  };
  service.strategyTemplateRepository = {
    getStrategyTemplateById: async () => ({
      id: 'template-1',
      userId: 'user-1',
      name: 'Momentum Template',
      description: 'Trend-following template',
      status: 'Active',
      templateVersion: 5,
      config: {
        market: 'crypto-futures',
      },
    }),
  };
  service.backtestRepository = {
    createQueuedBacktest: async () => {
      throw new Error('createQueuedBacktest should not be called for invalid dates');
    },
  };
  service.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      service.runLibraryStrategy('user-1', 'library-1', {
        start: 'not-a-real-date',
      }),
    /start must be a valid date or datetime string/
  );

  await assert.rejects(
    () => service.runLibraryStrategy('user-1', 'library-1', {}),
    /start must be a valid date or datetime string/
  );
}

async function runStrategyLibraryPersistenceConstraintAssertions(): Promise<void> {
  const duplicateError = new Error(
    'duplicate key value violates unique constraint "uidx_strategy_library_user_template_name_ci"'
  ) as Error & {
    code?: string;
    constraint?: string;
  };
  duplicateError.code = '23505';
  duplicateError.constraint = 'uidx_strategy_library_user_template_name_ci';

  const foreignKeyError = new Error(
    'insert or update on table "strategy_library" violates foreign key constraint "fk_strategy_library_user_template_owner"'
  ) as Error & {
    code?: string;
    constraint?: string;
  };
  foreignKeyError.code = '23503';
  foreignKeyError.constraint = 'fk_strategy_library_user_template_owner';

  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Trend-following template',
    status: 'Active',
    templateVersion: 5,
    config: {
      market: 'crypto-futures',
    },
  };
  const existingRecord = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Alpha Runner',
    status: 'Draft',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };

  const duplicateImportService = new StrategyLibraryService() as any;
  duplicateImportService.strategyLibraryRepository = {
    findByTemplateAndNormalizedName: async () => null,
    createLibrary: async () => {
      throw duplicateError;
    },
  };
  duplicateImportService.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  duplicateImportService.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      duplicateImportService.importTemplate('user-1', {
        templateId: 'template-1',
        name: ' Momentum Runner ',
      }),
    /already exists/
  );

  const duplicateUpdateService = new StrategyLibraryService() as any;
  duplicateUpdateService.strategyLibraryRepository = {
    getById: async () => existingRecord,
    findByTemplateAndNormalizedName: async () => null,
    updateLibrary: async () => {
      throw duplicateError;
    },
  };
  duplicateUpdateService.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  duplicateUpdateService.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      duplicateUpdateService.updateLibrary('user-1', 'library-1', {
        name: ' Momentum Runner ',
      }),
    /already exists/
  );

  const missingTemplateService = new StrategyLibraryService() as any;
  missingTemplateService.strategyLibraryRepository = {
    findByTemplateAndNormalizedName: async () => null,
    createLibrary: async () => {
      throw foreignKeyError;
    },
  };
  missingTemplateService.strategyTemplateRepository = {
    getStrategyTemplateById: async () => template,
  };
  missingTemplateService.operationalEventService = {
    logActivity: async () => undefined,
    emitFailureAlert: async () => undefined,
  };

  await assert.rejects(
    () =>
      missingTemplateService.importTemplate('user-1', {
        templateId: 'template-1',
        name: 'Recovered Runner',
      }),
    /Strategy template not found/
  );
}

async function runStrategyLibraryTemplateMappingAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const record = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Active',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: { required: true, maxPositions: 2 },
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };
  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Trend-following template',
    status: 'Active',
    templateVersion: 5,
    config: {
      editorMode: 'rule-based',
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      market: 'crypto-futures',
    },
  };

  service.strategyLibraryRepository = {
    async listLibrary() {
      return {
        data: [record],
        total: 1,
      };
    },
  };
  service.strategyTemplateRepository = {
    async listStrategyTemplatesByIds(_userId: string, templateIds: string[]) {
      assert.deepEqual(templateIds, ['template-1']);
      return [template];
    },
  };
  service.backtestRepository = {
    async getLatestStrategyLibraryBacktests(_userId: string, libraryIds: string[]) {
      assert.deepEqual(libraryIds, ['library-1']);
      return new Map([
        [
          'library-1',
          {
            libraryId: 'library-1',
            backtestId: 'backtest-42',
            status: 'Failed',
            createdAt: new Date('2026-04-03T08:00:00.000Z'),
            updatedAt: new Date('2026-04-03T08:12:00.000Z'),
          },
        ],
      ]);
    },
  };

  const response = await service.listLibrary('user-1', { limit: '10', offset: '0' });
  const item = response.data.items[0];

  assert.equal(item.templateName, 'Momentum Template');
  assert.equal(item.templateVersion, 5);
  assert.equal(item.templateType, 'Rule-based');
  assert.equal(item.templateAutomationReady, true);
  assert.equal(Array.isArray(item.templateAutomationReasons), true);
  assert.equal(Object.prototype.hasOwnProperty.call(item.overrides ?? {}, 'required'), false);
  assert.equal(item.lifecycle.canEdit, true);
  assert.equal(item.lifecycle.canRunManually, true);
  assert.equal(item.lifecycle.scheduledSignalsEnabled, true);
  assert.equal(
    item.lifecycle.summary,
    'Active entries stay editable, can be run manually, and are included in scheduled strategy-library signal scans.'
  );
  assert.equal(item.latestRun?.backtestId, 'backtest-42');
  assert.equal(item.latestRun?.status, 'Failed');
  assert.equal(item.recentRuns, undefined);
}

async function runStrategyLibraryDerivedListFilteringAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const records = [
    {
      id: 'library-1',
      userId: 'user-1',
      templateId: 'template-1',
      name: 'Alpha Runner',
      status: 'Active',
      assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
      timeframes: ['1h'],
      overrides: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-05T00:00:00.000Z'),
    },
    {
      id: 'library-2',
      userId: 'user-1',
      templateId: 'template-2',
      name: 'Breakout Runner',
      status: 'Active',
      assets: [{ symbol: 'ETHUSDT', brokerKey: 'paper' }],
      timeframes: ['4h'],
      overrides: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-04T00:00:00.000Z'),
    },
    {
      id: 'library-3',
      userId: 'user-1',
      templateId: 'template-3',
      name: 'Needs Scope',
      status: 'Draft',
      assets: [],
      timeframes: [],
      overrides: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
    },
  ];
  let capturedPaginate: boolean | undefined;

  service.strategyLibraryRepository = {
    async listLibrary(
      _userId: string,
      _params: Record<string, unknown>,
      options?: { paginate?: boolean }
    ) {
      capturedPaginate = options?.paginate;
      return {
        data: records,
        total: records.length,
      };
    },
  };
  service.strategyTemplateRepository = {
    async listStrategyTemplatesByIds(_userId: string, templateIds: string[]) {
      assert.deepEqual(templateIds, ['template-1', 'template-2', 'template-3']);
      return [
        {
          id: 'template-1',
          userId: 'user-1',
          name: 'Alpha Template',
          description: 'Automation-ready template',
          status: 'Active',
          templateVersion: 2,
          config: {
            editorMode: 'rule-based',
            entryLogic: 'ema(20) > ema(50)',
            exitLogic: 'ema(20) < ema(50)',
          },
        },
        {
          id: 'template-2',
          userId: 'user-1',
          name: 'Breakout Template',
          description: 'Missing automation contract',
          status: 'Active',
          templateVersion: 1,
          config: {
            editorMode: 'rule-based',
            entryLogic: '',
            exitLogic: '',
          },
        },
        {
          id: 'template-3',
          userId: 'user-1',
          name: 'Scope Template',
          description: 'Needs scope',
          status: 'Draft',
          templateVersion: 1,
          config: {
            editorMode: 'rule-based',
            entryLogic: 'rsi(14) < 30',
            exitLogic: 'rsi(14) > 50',
          },
        },
      ];
    },
  };
  service.backtestRepository = {
    async getLatestStrategyLibraryBacktests(_userId: string, libraryIds: string[]) {
      assert.deepEqual(libraryIds, ['library-1', 'library-2', 'library-3']);
      return new Map([
        [
          'library-1',
          {
            libraryId: 'library-1',
            backtestId: 'backtest-11',
            status: 'Completed',
            createdAt: new Date('2026-04-04T10:00:00.000Z'),
            updatedAt: new Date('2026-04-04T10:05:00.000Z'),
          },
        ],
        [
          'library-2',
          {
            libraryId: 'library-2',
            backtestId: 'backtest-12',
            status: 'Failed',
            createdAt: new Date('2026-04-05T11:00:00.000Z'),
            updatedAt: new Date('2026-04-05T11:10:00.000Z'),
          },
        ],
      ]);
    },
  };

  const automationReadyResponse = await service.listLibrary('user-1', {
    limit: '10',
    offset: '0',
    automationReady: 'true',
    sort: 'name_asc',
  });

  assert.equal(capturedPaginate, false);
  assert.equal(automationReadyResponse.data.total, 1);
  assert.deepEqual(
    automationReadyResponse.data.items.map((item: { id: string }) => item.id),
    ['library-1']
  );

  const failedRunsResponse = await service.listLibrary('user-1', {
    limit: '10',
    offset: '0',
    lastRunFailed: 'true',
    sort: 'latest_run_desc',
  });

  assert.equal(failedRunsResponse.data.total, 1);
  assert.deepEqual(
    failedRunsResponse.data.items.map((item: { id: string }) => item.id),
    ['library-2']
  );

  const needsScopeResponse = await service.listLibrary('user-1', {
    limit: '10',
    offset: '0',
    scopeReady: 'false',
  });

  assert.equal(needsScopeResponse.data.total, 1);
  assert.deepEqual(
    needsScopeResponse.data.items.map((item: { id: string }) => item.id),
    ['library-3']
  );
}

async function runStrategyLibraryRecentRunHistoryAssertions(): Promise<void> {
  const service = new StrategyLibraryService() as any;
  const record = {
    id: 'library-1',
    userId: 'user-1',
    templateId: 'template-1',
    name: 'Momentum Runner',
    status: 'Active',
    assets: [{ symbol: 'BTCUSDT', brokerKey: 'paper' }],
    timeframes: ['1h'],
    overrides: null,
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: new Date('2026-04-02T00:00:00.000Z'),
  };
  const template = {
    id: 'template-1',
    userId: 'user-1',
    name: 'Momentum Template',
    description: 'Trend-following template',
    status: 'Active',
    templateVersion: 5,
    config: {
      editorMode: 'rule-based',
      entryLogic: 'ema(20) > ema(50)',
      exitLogic: 'ema(20) < ema(50)',
      market: 'crypto-futures',
    },
  };

  service.strategyLibraryRepository = {
    async getById(_userId: string, libraryId: string) {
      assert.equal(libraryId, 'library-1');
      return record;
    },
  };
  service.strategyTemplateRepository = {
    async getStrategyTemplateById(_userId: string, templateId: string) {
      assert.equal(templateId, 'template-1');
      return template;
    },
  };
  service.backtestRepository = {
    async getLatestStrategyLibraryBacktests(_userId: string, libraryIds: string[]) {
      assert.deepEqual(libraryIds, ['library-1']);
      return new Map([
        [
          'library-1',
          {
            libraryId: 'library-1',
            backtestId: 'backtest-50',
            status: 'Queued',
            createdAt: new Date('2026-04-05T09:00:00.000Z'),
            updatedAt: new Date('2026-04-05T09:00:00.000Z'),
          },
        ],
      ]);
    },
    async getRecentStrategyLibraryBacktests(_userId: string, libraryIds: string[]) {
      assert.deepEqual(libraryIds, ['library-1']);
      return new Map([
        [
          'library-1',
          [
            {
              libraryId: 'library-1',
              backtestId: 'backtest-50',
              status: 'Queued',
              parameter: 'Momentum Runner | BTCUSDT | 1h',
              createdAt: new Date('2026-04-05T09:00:00.000Z'),
              updatedAt: new Date('2026-04-05T09:00:00.000Z'),
            },
            {
              libraryId: 'library-1',
              backtestId: 'backtest-42',
              status: 'Completed',
              parameter: 'Momentum Runner | ETHUSDT | 4h',
              createdAt: new Date('2026-04-03T08:00:00.000Z'),
              updatedAt: new Date('2026-04-03T08:12:00.000Z'),
            },
          ],
        ],
      ]);
    },
  };

  const detailResponse = await service.getLibraryById('user-1', 'library-1');

  assert.equal(detailResponse.data.latestRun?.backtestId, 'backtest-50');
  assert.equal(Object.prototype.hasOwnProperty.call(detailResponse.data, 'recentRuns'), false);

  const runsResponse = await service.getLibraryRuns('user-1', 'library-1', { limit: '5' });

  assert.equal(runsResponse.data.limit, 5);
  assert.equal(runsResponse.data.items.length, 2);
  assert.equal(runsResponse.data.items[0]?.backtestId, 'backtest-50');
  assert.equal(runsResponse.data.items[0]?.status, 'Queued');
  assert.equal(runsResponse.data.items[0]?.queuedAt, '2026-04-05T09:00:00.000Z');
  assert.equal(runsResponse.data.items[0]?.completedAt, null);
  assert.equal(runsResponse.data.items[1]?.backtestId, 'backtest-42');
  assert.equal(runsResponse.data.items[1]?.status, 'Completed');
  assert.equal(runsResponse.data.items[1]?.completedAt, '2026-04-03T08:12:00.000Z');
}

function runStrategyLibraryScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeSource = read('scripts/smokes/smoke-strategy-library-lineage.ts');
  const releaseGateSource = read('scripts/release-gates/release-gate-strategy-library.ts');

  assert.equal(
    packageScripts['test:strategy-library'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-strategy-library.ts'
  );
  assert.equal(
    packageScripts['smoke:strategy-library-lineage'],
    'node --import tsx scripts/smokes/smoke-strategy-library-lineage.ts'
  );
  assert.equal(
    packageScripts['release-gate:strategy-library'],
    'node --import tsx scripts/release-gates/release-gate-strategy-library.ts'
  );
  assert.equal(
    runPackageSuiteSource.includes("'strategy-library': ['test:strategy-library']"),
    true
  );
  assert.equal(runPackageSuiteSource.includes("'test:strategy-library'"), true);

  assert.equal(
    smokeSource.includes('/strategy-library/import') &&
      smokeSource.includes('/strategy-library/${encodeURIComponent(libraryId)}/run') &&
      smokeSource.includes('/top-setups'),
    true,
    'strategy-library smoke must exercise import, run, and promotion/top-setup flows'
  );
  assert.equal(
    releaseGateSource.includes('smoke-strategy-library-lineage.ts'),
    true,
    'strategy-library release gate must execute lineage smoke'
  );
  assert.equal(
    releaseGateSource.includes('/health/ops') &&
      releaseGateSource.includes('/activity') &&
      releaseGateSource.includes('/alerts'),
    true,
    'strategy-library release gate must validate observability, activity, and alerts'
  );
}

async function main(): Promise<void> {
  await runStrategyLabControllerAssertions();
  await runStrategyLibraryControllerAssertions();
  await runStrategyTemplatesControllerAssertions();
  runStrategyLabValidationAssertions();
  await runStrategyLabListServiceAssertions();
  runStrategyTemplateNormalizationAssertions();
  await runStrategyTemplateSuggestionImportAssertions();
  await runStrategyTemplateVersionLifecycleAssertions();
  await runStrategyTemplateSearchQueryAssertions();
  await runStrategyLibrarySearchQueryAssertions();
  await runStrategyLibrarySignalScanStatusAssertions();
  await runStrategyLabBacktestHandoffAssertions();
  await runStrategyLibraryBacktestSnapshotAssertions();
  await runStrategyLibraryLifecycleGuardAssertions();
  await runStrategyLibraryStatusUpdateAssertions();
  await runStrategyLibraryImportConflictAssertions();
  await runStrategyLibraryRunDateValidationAssertions();
  await runStrategyLibraryPersistenceConstraintAssertions();
  await runStrategyLibraryTemplateMappingAssertions();
  await runStrategyLibraryDerivedListFilteringAssertions();
  await runStrategyLibraryRecentRunHistoryAssertions();
  runStrategyLibraryScriptWiringAssertions();
  console.log('Strategy library module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
