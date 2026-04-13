import { env } from '../../src/env';

type JsonValue = Record<string, unknown>;

const resolvedHost = env.app.host === '0.0.0.0' ? '127.0.0.1' : env.app.host;
const BASE_URL =
  process.env.SMOKE_BASE_URL || `http://${resolvedHost}:${env.app.port}${env.app.routePrefix}`;
const SCHEDULER_TYPE = process.env.SMOKE_SCHEDULER_TYPE || 'exchange-assets';
const ACCESS_TOKEN = process.env.SMOKE_ACCESS_TOKEN || '';
const ASSERT_SAME_USER_DEDUPE =
  String(process.env.SMOKE_ASSERT_SAME_USER_DEDUPE || '').trim().toLowerCase() === 'true';

async function requestJson(path: string, init: RequestInit = {}): Promise<JsonValue> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const text = await response.text();
  let data: JsonValue = {};
  try {
    data = text ? (JSON.parse(text) as JsonValue) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function run(): Promise<void> {
  const health = await requestJson('/health');
  const queue = await requestJson('/health/queue');
  const worker = await requestJson('/health/worker');
  const ops = await requestJson('/health/ops');

  console.log('health:', JSON.stringify(health));
  console.log('queue:', JSON.stringify(queue));
  console.log('worker:', JSON.stringify(worker));
  console.log('ops:', JSON.stringify(ops));

  const workerData = (worker.data || {}) as Record<string, unknown>;
  if (workerData.status === 'ok') {
    const commandConcurrency = workerData.commandConcurrency;
    const activeCommandCount = workerData.activeCommandCount;
    const activeScopeCount = workerData.activeScopeCount;
    const hasNumericDiagnostics =
      typeof commandConcurrency === 'number' &&
      typeof activeCommandCount === 'number' &&
      typeof activeScopeCount === 'number';
    if (!hasNumericDiagnostics) {
      console.log(
        'worker diagnostics warning: commandConcurrency/activeCommandCount/activeScopeCount not fully available yet'
      );
    }
  }

  if (!ACCESS_TOKEN) {
    console.log(
      'Skipping scheduler run smoke because SMOKE_ACCESS_TOKEN is not set. Health checks passed.'
    );
    return;
  }

  const runResponse = await requestJson(`/scheduler/${encodeURIComponent(SCHEDULER_TYPE)}/run`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
  });
  console.log('run:', JSON.stringify(runResponse));

  if (ASSERT_SAME_USER_DEDUPE) {
    const secondRunResponse = await requestJson(
      `/scheduler/${encodeURIComponent(SCHEDULER_TYPE)}/run`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          'content-type': 'application/json',
        },
      }
    );
    console.log('run-second:', JSON.stringify(secondRunResponse));
    const secondData = (secondRunResponse.data || {}) as Record<string, unknown>;
    const secondMessage = String(secondData.message || '').toLowerCase();
    const looksDeduped =
      secondMessage.includes('already queued') || secondMessage.includes('already in progress');
    if (!looksDeduped) {
      throw new Error(`expected same-user dedupe signal on second run, got: ${secondMessage}`);
    }
  }

  const runData = (runResponse.data || {}) as Record<string, unknown>;
  const runJobId = String(runData.jobId || '').trim();
  if (!runJobId) {
    console.log('No jobId returned by run endpoint; skipping progress/runs assertions.');
    return;
  }

  const runs = await requestJson(
    `/scheduler/${encodeURIComponent(SCHEDULER_TYPE)}/runs?limit=10&offset=0`,
    {
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    }
  );
  const items = ((runs.data as Record<string, unknown>)?.items || []) as Array<Record<string, unknown>>;
  const matched = items.find((item) => String(item.id || '').trim().length > 0);
  if (!matched?.id) {
    throw new Error('scheduler runs returned no rows after run trigger');
  }

  const progress = await requestJson(
    `/scheduler/${encodeURIComponent(SCHEDULER_TYPE)}/runs/${encodeURIComponent(String(matched.id))}/progress`,
    {
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    }
  );
  console.log('progress:', JSON.stringify(progress));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
