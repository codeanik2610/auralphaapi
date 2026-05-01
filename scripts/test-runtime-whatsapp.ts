import assert from 'node:assert/strict';

import { RuntimeDiagnosticsService } from '../src/api/services/RuntimeDiagnosticsService';
import { env } from '../src/env';
import { RedisClient } from '../src/lib/RedisClient';

async function runWhatsappWorkerHealthAssertions(): Promise<void> {
  const service: any = new RuntimeDiagnosticsService();
  const originalGetConnection = RedisClient.getConnection;
  const originalWhatsappEnabled = env.whatsapp.enabled;
  const originalWhatsappAccountSid = env.whatsapp.twilio.accountSid;
  const originalWhatsappAuthToken = env.whatsapp.twilio.authToken;
  const originalWhatsappFrom = env.whatsapp.twilio.from;
  const originalDateNow = Date.now;

  service.whatsappDeliveryRepository = {
    async getOperationalSnapshot() {
      return {
        queued: 3,
        sending: 1,
        failed: 2,
        active: 6,
        oldestPendingAt: new Date('2026-04-24T11:59:00.000Z'),
        oldestPendingAgeMs: 60_000,
      };
    },
  };

  env.whatsapp.enabled = true;
  env.whatsapp.twilio.accountSid = 'AC_runtime_whatsapp';
  env.whatsapp.twilio.authToken = 'runtime_token';
  env.whatsapp.twilio.from = 'whatsapp:+14155238886';
  Date.now = () => new Date('2026-04-24T12:00:00.000Z').getTime();
  (RedisClient as any).getConnection = () => ({
    async get(key: string) {
      assert.equal(key, env.redis.whatsappWorkerHeartbeatKey);
      return JSON.stringify({
        workerId: 'runtime-whatsapp-worker',
        timestamp: '2026-04-24T11:59:45.000Z',
        status: 'idle',
        pollIntervalMs: 5000,
      });
    },
  });

  try {
    const health = await service.getWhatsappWorkerHealth();
    assert.equal(health.status, 'ok');
    assert.equal(health.enabled, true);
    assert.equal(health.provider, 'twilio');
    assert.equal(health.providerConfigured, true);
    assert.equal(health.workerId, 'runtime-whatsapp-worker');
    assert.equal(health.queuedCount, 3);
    assert.equal(health.sendingCount, 1);
    assert.equal(health.failedCount, 2);
    assert.equal(health.activeCount, 6);
    assert.equal(health.lastHeartbeatAt, '2026-04-24T11:59:45.000Z');
    assert.equal(health.heartbeatAgeMs, 15_000);
  } finally {
    (RedisClient as any).getConnection = originalGetConnection;
    env.whatsapp.enabled = originalWhatsappEnabled;
    env.whatsapp.twilio.accountSid = originalWhatsappAccountSid;
    env.whatsapp.twilio.authToken = originalWhatsappAuthToken;
    env.whatsapp.twilio.from = originalWhatsappFrom;
    Date.now = originalDateNow;
  }
}

async function runRuntimeOverviewAssertions(): Promise<void> {
  const service: any = new RuntimeDiagnosticsService();

  service.getWorkerHealth = async () => ({
    status: 'ok',
    endpoint: 'http://scheduler-worker.local',
  });
  service.getEmailWorkerHealth = async () => ({
    status: 'ok',
    enabled: true,
    smtpConfigured: true,
    queuedCount: 0,
    sendingCount: 0,
    failedCount: 0,
    activeCount: 0,
  });
  service.getWhatsappWorkerHealth = async () => ({
    status: 'ok',
    enabled: true,
    provider: 'twilio',
    providerConfigured: true,
    queuedCount: 1,
    sendingCount: 0,
    failedCount: 0,
    activeCount: 1,
  });
  service.automationsService = {
    async getAutomationOperationalSnapshot() {
      return {
        total: 3,
        running: 1,
        paused: 1,
        failed: 0,
        draft: 1,
        healthStatus: 'ok',
        detail: null,
        summary: {
          activeRuns: 1,
          failedRuns24h: 0,
          overlapSkips24h: 0,
          staleCursorCount: 0,
          totalCursorCount: 1,
          workerStatus: 'ok',
          heartbeatStatus: 'ok',
          workerHeartbeatAgeMs: 1000,
        },
      };
    },
  };
  service.collectStaleItems = async () => [];
  service.getDiscoveryRuntimeSummary = async () => ({
    status: 'ok',
    endpoint: 'http://discovery.local',
  });
  service.getApiLoopSnapshots = () => [];

  const healthyOverview = await service.getRuntimeOverview(5);
  assert.equal(healthyOverview.status, 'ok');
  assert.equal(healthyOverview.whatsappWorker.status, 'ok');
  assert.equal(healthyOverview.whatsappWorker.provider, 'twilio');
  assert.equal(healthyOverview.staleCounts.total, 0);

  service.getWhatsappWorkerHealth = async () => ({
    status: 'down',
    enabled: true,
    provider: 'twilio',
    providerConfigured: true,
    detail: 'No active WhatsApp worker heartbeat found.',
  });

  const degradedOverview = await service.getRuntimeOverview(5);
  assert.equal(degradedOverview.status, 'down');
  assert.equal(degradedOverview.whatsappWorker.status, 'down');
  assert.match(
    String(degradedOverview.whatsappWorker.detail || ''),
    /No active WhatsApp worker heartbeat/
  );
}

async function main(): Promise<void> {
  await runWhatsappWorkerHealthAssertions();
  await runRuntimeOverviewAssertions();
  console.log('Phase 4 runtime WhatsApp assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
