import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DiscoveryController } from '../src/api/controllers/DiscoveryController';
import { HealthController } from '../src/api/controllers/HealthController';
import { DiscoveryDependencyService } from '../src/api/services/DiscoveryDependencyService';
import { DiscoveryFeedService } from '../src/api/services/DiscoveryFeedService';
import { DiscoverySummaryService } from '../src/api/services/DiscoverySummaryService';
import { env } from '../src/env';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

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

async function runDiscoveryControllerAssertions(): Promise<void> {
  const controller: any = new DiscoveryController();

  controller.discoveryFeedService = {
    getFeed: async (...args: unknown[]) => ({ args }),
  };
  controller.discoverySummaryService = {
    getSummary: async (...args: unknown[]) => ({ args }),
  };

  const request = {
    authUser: { sub: 'user-1' },
    headers: {
      authorization: ['Bearer discovery-token', 'Bearer ignored-token'],
    },
  } as any;

  assert.deepEqual(
    (await controller.getFeed(request, '25', 'bot-1')).data.args,
    ['Bearer discovery-token', { limit: '25', botId: 'bot-1' }]
  );
  assert.deepEqual((await controller.getSummary(request)).data.args, ['Bearer discovery-token']);

  await assertAuthRequired(() => controller.getFeed({ headers: {} } as any, '25', 'bot-1'));
  await assertAuthRequired(() => controller.getSummary({ headers: {} } as any));
}

async function runDiscoveryHealthControllerAssertions(): Promise<void> {
  const controller: any = new HealthController();

  controller.discoveryDependencyService = {
    async getDependencyHealth(...args: unknown[]) {
      return {
        status: 'ok',
        checkedAt: '2026-04-06T06:00:00.000Z',
        baseUrl: 'http://localhost:8000/api/v1/discovery',
        service: {
          key: 'service',
          label: 'Discovery engine health',
          status: 'ok',
        },
        readiness: {
          key: 'readiness',
          label: 'Discovery engine readiness',
          status: 'ok',
        },
        auth: {
          key: 'auth',
          label: 'Auth bridge',
          status: 'ok',
        },
        contract: {
          key: 'contract',
          label: 'External API contract',
          status: 'ok',
          checkedEndpoints: ['bots', 'runs', 'preferences'],
        },
        endpoints: [],
        args,
      };
    },
  };

  const response = await controller.getDiscoveryDependencyHealth({
    authUser: { sub: 'user-1' },
    headers: {
      authorization: ['Bearer token-1', 'Bearer ignored-token'],
    },
  } as any);

  assert.equal(response.data.status, 'ok');
  assert.equal(response.data.baseUrl, 'http://localhost:8000/api/v1/discovery');
  assert.deepEqual(response.data.args, ['Bearer token-1']);

  await assertAuthRequired(() => controller.getDiscoveryDependencyHealth({ headers: {} } as any));
}

async function runDiscoveryDependencyServiceAssertions(): Promise<void> {
  const service = new DiscoveryDependencyService();
  const originalFetch = globalThis.fetch;
  const originalDiscoveryApiBaseUrl = env.discovery.apiBaseUrl;

  env.discovery.apiBaseUrl = 'http://localhost:8000/api/v1/discovery';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    const jsonResponse = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          'content-type': 'application/json',
        },
      });

    if (url === 'http://localhost:8000/health') {
      return jsonResponse(200, {
        status: 'ok',
        service: 'discovery-engine',
      });
    }

    if (url === 'http://localhost:8000/health/ready') {
      return jsonResponse(200, {
        status: 'ok',
        service: 'discovery-engine',
        dependencies: {
          postgres: { status: 'ok' },
          mysql: { status: 'ok' },
          redis: { status: 'ok' },
        },
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/bots?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [
          {
            id: 'bot-1',
            name: 'Discovery Bot 1',
            status: 'running',
          },
        ],
        total: 1,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/runs?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [
          {
            id: 'run-1',
            status: 'completed',
          },
        ],
        total: 1,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/strategies?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [
          {
            id: 'strategy-1',
            name: 'Discovery Strategy 1',
            status: 'approved',
          },
        ],
        total: 1,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/template-suggestions?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [],
        total: 0,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/preferences') {
      return jsonResponse(200, {
        id: 'pref-1',
        user_id: 'user-1',
        preferred_segments: [],
        preferred_assets: [],
        preferred_timeframes: ['1h', '4h'],
        preferred_strategy_types: [],
        preferred_ai_approach: 'algorithmic',
        risk_tolerance: 'medium',
        auto_backtest_approved: false,
        notification_settings: {},
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/bots/bot-1') {
      return jsonResponse(200, {
        id: 'bot-1',
        name: 'Discovery Bot 1',
        status: 'running',
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/runs/run-1') {
      return jsonResponse(200, {
        id: 'run-1',
        status: 'completed',
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/strategies/strategy-1') {
      return jsonResponse(200, {
        id: 'strategy-1',
        name: 'Discovery Strategy 1',
        status: 'approved',
      });
    }

    throw new Error(`Unexpected discovery dependency fetch: ${url}`);
  }) as typeof globalThis.fetch;

  try {
    const unauthenticated = await service.getDependencyHealth();
    assert.equal(unauthenticated.status, 'down');
    assert.equal(unauthenticated.auth.status, 'down');
    assert.equal(
      unauthenticated.auth.detail,
      'Authorization header is required to validate discovery dependency auth.'
    );

    const response = await service.getDependencyHealth('Bearer token-1');

    assert.equal(response.status, 'ok');
    assert.equal(response.baseUrl, 'http://localhost:8000/api/v1/discovery');
    assert.equal(response.service.status, 'ok');
    assert.equal(response.readiness.status, 'ok');
    assert.equal(response.auth.status, 'ok');
    assert.equal(response.contract.status, 'ok');
    assert.deepEqual(response.contract.checkedEndpoints, [
      'bots',
      'runs',
      'strategies',
      'template-suggestions',
      'preferences',
      'bot-detail',
      'run-detail',
      'strategy-detail',
    ]);
    assert.equal(response.endpoints.length, 8);
    assert.equal(response.endpoints.every((item) => item.status === 'ok'), true);
    assert.equal(response.readiness.dependencies?.postgres?.status, 'ok');
    assert.equal(response.readiness.dependencies?.mysql?.status, 'ok');
    assert.equal(response.readiness.dependencies?.redis?.status, 'ok');
    assert.equal(response.endpoints.find((item) => item.key === 'bot-detail')?.probeMode, 'sampled');
    assert.equal(response.endpoints.find((item) => item.key === 'bot-detail')?.sampledId, 'bot-1');
    assert.equal(response.endpoints.find((item) => item.key === 'run-detail')?.probeMode, 'sampled');
    assert.equal(response.endpoints.find((item) => item.key === 'run-detail')?.sampledId, 'run-1');
    assert.equal(
      response.endpoints.find((item) => item.key === 'strategy-detail')?.probeMode,
      'sampled'
    );
    assert.equal(
      response.endpoints.find((item) => item.key === 'strategy-detail')?.sampledId,
      'strategy-1'
    );
  } finally {
    globalThis.fetch = originalFetch;
    env.discovery.apiBaseUrl = originalDiscoveryApiBaseUrl;
  }
}

async function runDiscoverySummaryServiceAssertions(): Promise<void> {
  const service = new DiscoverySummaryService();
  const originalFetch = globalThis.fetch;
  const originalDiscoveryApiBaseUrl = env.discovery.apiBaseUrl;

  await assert.rejects(
    () => service.getSummary(),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Authorization header is required to load discovery summary'
  );

  env.discovery.apiBaseUrl = 'http://localhost:8000/api/v1/discovery';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    const jsonResponse = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          'content-type': 'application/json',
        },
      });

    if (url === 'http://localhost:8000/api/v1/discovery/bots?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [{ id: 'bot-3', status: 'running' }],
        total: 3,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/bots?limit=200&offset=0') {
      return jsonResponse(200, {
        items: [
          { id: 'bot-3', status: 'running' },
          { id: 'bot-2', status: 'stopped' },
          { id: 'bot-1', status: 'running' },
        ],
        total: 3,
      });
    }

    if (
      url ===
      'http://localhost:8000/api/v1/discovery/strategies?limit=1&offset=0&status=pending_review'
    ) {
      return jsonResponse(200, {
        items: [{ id: 'strat-2', score: 0.82 }],
        total: 2,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/strategies?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [{ id: 'strat-9', score: 0.91 }],
        total: 9,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/template-suggestions?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [{ id: 'suggestion-1' }],
        total: 4,
      });
    }

    if (url === 'http://localhost:8000/api/v1/discovery/runs?limit=1&offset=0') {
      return jsonResponse(200, {
        items: [{ id: 'run-1' }],
        total: 7,
      });
    }

    throw new Error(`Unexpected discovery summary fetch: ${url}`);
  }) as typeof globalThis.fetch;

  try {
    const response = await service.getSummary('Bearer token-1');

    assert.equal(response.bots.total, 3);
    assert.equal(response.bots.active, 2);
    assert.equal(response.strategies.total, 9);
    assert.equal(response.strategies.pendingReview, 2);
    assert.equal(response.strategies.bestScore, 0.91);
    assert.equal(response.suggestions.total, 4);
    assert.equal(response.runs.total, 7);
    assert.ok(response.checkedAt);
  } finally {
    globalThis.fetch = originalFetch;
    env.discovery.apiBaseUrl = originalDiscoveryApiBaseUrl;
  }
}

async function runDiscoveryFeedServiceAssertions(): Promise<void> {
  const service = new DiscoveryFeedService();
  const originalFetch = globalThis.fetch;
  const originalDiscoveryApiBaseUrl = env.discovery.apiBaseUrl;

  await assert.rejects(
    () => service.getFeed(),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Authorization header is required to load discovery feed history'
  );

  env.discovery.apiBaseUrl = 'http://localhost:8000/api/v1/discovery';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    const jsonResponse = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          'content-type': 'application/json',
        },
      });

    if (url === 'http://localhost:8000/api/v1/discovery/runs?limit=5&offset=0&bot_id=bot-1') {
      return jsonResponse(200, {
        items: [
          {
            id: 'run-2',
            bot_id: 'bot-1',
            status: 'running',
            started_at: '2026-04-06T05:00:00.000Z',
            completed_at: null,
            duration_seconds: null,
            assets_scanned: 8,
            strategies_discovered: 0,
            run_config: {
              assets: ['BTCUSDT', 'ETHUSDT'],
              timeframes: ['1h', '4h'],
            },
            error_message: null,
          },
          {
            id: 'run-1',
            bot_id: 'bot-1',
            status: 'completed',
            started_at: '2026-04-06T04:00:00.000Z',
            completed_at: '2026-04-06T04:10:00.000Z',
            duration_seconds: 600,
            assets_scanned: 12,
            strategies_discovered: 3,
            run_config: {
              assets: ['BTCUSDT'],
              timeframes: ['1h'],
            },
            error_message: null,
          },
        ],
        total: 2,
      });
    }

    throw new Error(`Unexpected discovery feed fetch: ${url}`);
  }) as typeof globalThis.fetch;

  try {
    const response = await service.getFeed('Bearer token-2', {
      limit: '5',
      botId: 'bot-1',
    });

    assert.equal(response.items.length, 2);
    assert.equal(response.items[0]?.type, 'run_progress');
    assert.equal(response.items[0]?.runId, 'run-2');
    assert.equal(response.items[0]?.botId, 'bot-1');
    assert.equal(response.items[0]?.status, 'running');
    assert.equal(response.items[0]?.assetsScanned, 8);
    assert.deepEqual(response.items[0]?.assets, ['BTCUSDT', 'ETHUSDT']);
    assert.deepEqual(response.items[0]?.timeframes, ['1h', '4h']);
    assert.equal(response.items[1]?.type, 'run_completed');
    assert.equal(response.items[1]?.runId, 'run-1');
    assert.equal(response.items[1]?.strategiesFound, 3);
    assert.equal(response.items[1]?.durationSeconds, 600);
    assert.ok(response.checkedAt);
  } finally {
    globalThis.fetch = originalFetch;
    env.discovery.apiBaseUrl = originalDiscoveryApiBaseUrl;
  }
}

function runDiscoveryScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const dependencySmokeSource = read('scripts/smokes/smoke-discovery-dependency.ts');
  const contractSmokeSource = read('scripts/smokes/smoke-discovery-contract.ts');
  const releaseGateSource = read('scripts/release-gates/release-gate-discovery.ts');

  assert.equal(
    packageScripts['test:discovery'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-discovery.ts'
  );
  assert.equal(
    packageScripts['smoke:discovery-dependency'],
    'node --import tsx scripts/smokes/smoke-discovery-dependency.ts'
  );
  assert.equal(
    packageScripts['smoke:discovery-contract'],
    'node --import tsx scripts/smokes/smoke-discovery-contract.ts'
  );
  assert.equal(
    packageScripts['release-gate:discovery'],
    'node --import tsx scripts/release-gates/release-gate-discovery.ts'
  );
  assert.equal(runPackageSuiteSource.includes("discovery: ['test:discovery']"), true);
  assert.equal(runPackageSuiteSource.includes("'test:discovery'"), true);

  assert.equal(
    dependencySmokeSource.includes('/auth/login') &&
      dependencySmokeSource.includes('/health/discovery') &&
      dependencySmokeSource.includes('strategy-detail'),
    true,
    'discovery dependency smoke must validate auth, health, and sampled detail endpoints'
  );
  assert.equal(
    contractSmokeSource.includes('/auth/login') &&
      contractSmokeSource.includes('/health/discovery') &&
      contractSmokeSource.includes('/discovery/summary') &&
      contractSmokeSource.includes('/discovery/feed'),
    true,
    'discovery contract smoke must exercise login, dependency health, summary, and feed APIs'
  );
  assert.equal(
    releaseGateSource.includes('/health/discovery'),
    true,
    'discovery release gate must read discovery dependency health'
  );
  assert.equal(
    releaseGateSource.includes('/discovery/summary'),
    true,
    'discovery release gate must read discovery summary'
  );
  assert.equal(
    releaseGateSource.includes('/discovery/feed'),
    true,
    'discovery release gate must read discovery feed'
  );
  assert.equal(
    releaseGateSource.includes('smokes/smoke-discovery-dependency.ts'),
    true,
    'discovery release gate must execute the dependency smoke from the current scripts layout'
  );
  assert.equal(
    releaseGateSource.includes('smokes/smoke-discovery-contract.ts'),
    true,
    'discovery release gate must execute the contract smoke from the current scripts layout'
  );
}

async function main(): Promise<void> {
  await runDiscoveryControllerAssertions();
  await runDiscoveryHealthControllerAssertions();
  await runDiscoveryDependencyServiceAssertions();
  await runDiscoverySummaryServiceAssertions();
  await runDiscoveryFeedServiceAssertions();
  runDiscoveryScriptWiringAssertions();
  console.log('Discovery module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
