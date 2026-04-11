import assert from 'node:assert/strict';

import { AutomationsService } from '../src/api/services/AutomationsService';
import { BacktestsService } from '../src/api/services/BacktestsService';
import { SignalsService } from '../src/api/services/SignalsService';

function createOperationalMock() {
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
}

async function runAutomationsOperationalAssertions(): Promise<void> {
  const svc = new AutomationsService() as any;
  const operational = createOperationalMock();
  const now = new Date();

  svc.operationalEventService = operational.service;
  svc.automationRepository = {
    async getAutomationById() {
      return {
        id: 'bot-1',
        name: 'Momentum Bot',
        strategy: 'momentum',
        status: 'Paused',
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

async function runSignalsOperationalAssertions(): Promise<void> {
  const svc = new SignalsService() as any;
  const operational = createOperationalMock();
  svc.operationalEventService = operational.service;
  svc.alertRepository = {
    async createManualAlert() {
      return { id: 'alert-1' };
    },
  };
  svc.signalAlertLinkRepository = {
    async createLink() {
      return;
    },
  };
  svc.signalRepository = {
    async getSignalById() {
      return {
        id: 'sig-1',
        symbol: 'BTCUSDT',
        source: 'scanner',
        status: 'Triggered',
        updatedAt: new Date(),
      };
    },
    async updateSignal() {
      throw new Error('write failed');
    },
    async createSignalAction() {
      return;
    },
  };

  await assert.rejects(
    async () => {
      await svc.promoteSignal('user-1', 'sig-1', { target: 'alerts' });
    },
    /write failed/
  );
  assert.equal(operational.activityCalls.length, 1);
  assert.equal(operational.alertCalls.length, 1);
  assert.equal(operational.activityCalls[0].payload.title, 'Signal promote failed');
  assert.deepEqual(
    ((operational.activityCalls[0].payload.flags as Array<Record<string, unknown>>) || []).map(
      (flag) => flag.id
    ),
    ['signal-promote-review']
  );
}

async function runBacktestsOperationalAssertions(): Promise<void> {
  const svc = new BacktestsService() as any;
  const operational = createOperationalMock();

  svc.operationalEventService = operational.service;
  svc.backtestRepository = {
    async createQueuedBacktest() {
      return {
        id: 'bt-1',
        name: 'Momentum 1h',
        status: 'Queued',
        createdAt: new Date(),
      };
    },
  };

  await svc.createBacktest('user-1', {
    universe: 'Momentum',
    interval: '1h',
    capital: '10000',
    fees: '0.02',
    slippage: '0.05',
    dateRange: '90d',
    benchmark: 'BTCUSDT',
    includeExtended: true,
    usePaperGate: false,
  });

  assert.equal(operational.activityCalls.length, 1);
  assert.equal(operational.alertCalls.length, 0);
  assert.equal(operational.activityCalls[0].payload.title, 'Backtest created: Momentum 1h');
}

async function main(): Promise<void> {
  await runAutomationsOperationalAssertions();
  await runSignalsOperationalAssertions();
  await runBacktestsOperationalAssertions();
  console.log('Operational event assertions passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
