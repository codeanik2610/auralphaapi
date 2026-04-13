import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { EmailDeliveriesController } from '../src/api/controllers/EmailDeliveriesController';
import { EmailDeliveriesService } from '../src/api/services/EmailDeliveriesService';
import {
  validateEmailDeliveriesFilters,
  validateEmailDeliveriesQuery,
  validateEmailDeliveryExportBody,
  validateEmailDeliveryId,
  validateEmailDeliveryRetentionDays,
} from '../src/api/validators/emailDeliveries.validator';

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const adminAuthReq = { authUser: { sub: 'admin-1', role: 'admin' } } as any;
const authReq = { authUser: { sub: 'user-1' } } as any;
const unauthReq = {} as any;

async function assertAdminRoleRequired(
  run: () => Promise<unknown>,
  message = 'Admin role is required'
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      error.message === message &&
      (error as { httpCode?: number }).httpCode === 403
  );
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

async function runEmailDeliveriesControllerAssertions(): Promise<void> {
  const controller: any = new EmailDeliveriesController();

  controller.emailDeliveriesService = {
    getEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    getEmailDeliveriesSummary: async (...args: unknown[]) => createSuccess({ args }),
    getEmailDeliveryFilterOptions: async (...args: unknown[]) => createSuccess({ args }),
    exportEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    previewMatchingFailedEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    retryAllFailedEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    retryMatchingFailedEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    previewCleanupEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    previewMatchingCleanupEmailDeliveries: async (...args: unknown[]) =>
      createSuccess({ args }),
    getLatestCleanupActivity: async (...args: unknown[]) => createSuccess({ args }),
    getEmailDeliveryById: async (...args: unknown[]) => createSuccess({ args }),
    cleanupEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    cleanupMatchingEmailDeliveries: async (...args: unknown[]) => createSuccess({ args }),
    sendTestEmailDelivery: async (...args: unknown[]) => createSuccess({ args }),
    retryEmailDelivery: async (...args: unknown[]) => createSuccess({ args }),
    resendEmailDelivery: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual(
    (
      await controller.getEmailDeliveries(
        adminAuthReq,
        '10',
        '5',
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'admin-1', role: 'admin' },
      {
        limit: '10',
        offset: '5',
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.getEmailDeliveriesSummary(adminAuthReq)).data.args, [
    { userId: 'admin-1', role: 'admin' },
  ]);
  assert.deepEqual((await controller.getEmailDeliveryFilterOptions(adminAuthReq)).data.args, [
    { userId: 'admin-1', role: 'admin' },
  ]);
  assert.deepEqual((await controller.getLatestCleanupActivity(adminAuthReq)).data.args, [
    { userId: 'admin-1', role: 'admin' },
  ]);
  assert.deepEqual(
    (
      await controller.exportEmailDeliveries(adminAuthReq, {
        format: 'csv',
        status: 'Failed',
      })
    ).data.args,
    [
      { userId: 'admin-1', role: 'admin' },
      { format: 'csv', status: 'Failed' },
    ]
  );
  assert.deepEqual(
    (
      await controller.previewMatchingFailedEmailDeliveries(
        adminAuthReq,
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'admin-1', role: 'admin' },
      {
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.retryAllFailedEmailDeliveries(adminAuthReq)).data.args, [
    { userId: 'admin-1', role: 'admin' },
  ]);
  assert.deepEqual(
    (
      await controller.retryMatchingFailedEmailDeliveries(
        adminAuthReq,
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'admin-1', role: 'admin' },
      {
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual(
    (await controller.previewCleanupEmailDeliveries(adminAuthReq, '30')).data.args,
    [{ userId: 'admin-1', role: 'admin' }, '30']
  );
  assert.deepEqual(
    (
      await controller.previewMatchingCleanupEmailDeliveries(
        adminAuthReq,
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'admin-1', role: 'admin' },
      {
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.getEmailDeliveryById(adminAuthReq, 'delivery-1')).data.args, [
    { userId: 'admin-1', role: 'admin' },
    'delivery-1',
  ]);
  assert.deepEqual((await controller.cleanupEmailDeliveries(adminAuthReq, '30')).data.args, [
    { userId: 'admin-1', role: 'admin' },
    '30',
  ]);
  assert.deepEqual(
    (
      await controller.cleanupMatchingEmailDeliveries(
        adminAuthReq,
        'Failed',
        'smtp',
        'user-2',
        'ops@auralpha.com',
        'High',
        'Scheduler',
        'email-worker'
      )
    ).data.args,
    [
      { userId: 'admin-1', role: 'admin' },
      {
        status: 'Failed',
        search: 'smtp',
        userId: 'user-2',
        recipient: 'ops@auralpha.com',
        severity: 'High',
        channel: 'Scheduler',
        source: 'email-worker',
      },
    ]
  );
  assert.deepEqual((await controller.sendTestEmailDelivery(adminAuthReq)).data.args, [
    { userId: 'admin-1', role: 'admin' },
  ]);
  assert.deepEqual((await controller.retryEmailDelivery(adminAuthReq, 'delivery-1')).data.args, [
    { userId: 'admin-1', role: 'admin' },
    'delivery-1',
  ]);
  assert.deepEqual((await controller.resendEmailDelivery(adminAuthReq, 'delivery-1')).data.args, [
    { userId: 'admin-1', role: 'admin' },
    'delivery-1',
  ]);

  await assertAuthRequired(() => controller.getEmailDeliveries(unauthReq));
  await assertAdminRoleRequired(() => controller.getEmailDeliveries(authReq));
  await assertAdminRoleRequired(() => controller.sendTestEmailDelivery(authReq));
}

function runEmailDeliveriesValidationAssertions(): void {
  assert.deepEqual(validateEmailDeliveriesQuery(), {
    limit: 50,
    offset: 0,
    status: undefined,
    search: undefined,
    userId: undefined,
    recipient: undefined,
    severity: undefined,
    channel: undefined,
    source: undefined,
  });
  assert.deepEqual(
    validateEmailDeliveriesQuery({
      limit: '25',
      offset: '5',
      status: ' Failed ',
      search: ' smtp ',
      userId: ' user-2 ',
      recipient: ' ops@auralpha.com ',
      severity: ' High ',
      channel: ' Scheduler ',
      source: ' email-worker ',
    }),
    {
      limit: 25,
      offset: 5,
      status: 'Failed',
      search: 'smtp',
      userId: 'user-2',
      recipient: 'ops@auralpha.com',
      severity: 'High',
      channel: 'Scheduler',
      source: 'email-worker',
    }
  );
  assert.deepEqual(
    validateEmailDeliveriesFilters({
      status: ' Failed ',
      search: ' smtp ',
      source: ' worker ',
    }),
    {
      status: 'Failed',
      search: 'smtp',
      userId: undefined,
      recipient: undefined,
      severity: undefined,
      channel: undefined,
      source: 'worker',
    }
  );
  assert.deepEqual(validateEmailDeliveryExportBody({ status: 'Failed' }), {
    format: 'csv',
    status: 'Failed',
    search: undefined,
    userId: undefined,
    recipient: undefined,
    severity: undefined,
    channel: undefined,
    source: undefined,
  });
  assert.equal(validateEmailDeliveryId(' delivery-1 '), 'delivery-1');
  assert.equal(validateEmailDeliveryRetentionDays(), 30);
  assert.equal(validateEmailDeliveryRetentionDays('45'), 45);

  assert.throws(
    () => validateEmailDeliveriesQuery({ limit: '0' }),
    /limit must be an integer between 1 and 100/
  );
  assert.throws(
    () => validateEmailDeliveriesQuery({ status: 'Unknown' }),
    /status must be one of:/
  );
  assert.throws(
    () => validateEmailDeliveryExportBody({ format: 'json' as any }),
    /Only csv export is supported/
  );
  assert.throws(() => validateEmailDeliveryId(' '), /deliveryId is required/);
  assert.throws(
    () => validateEmailDeliveryRetentionDays('366'),
    /retentionDays must be an integer between 1 and/
  );
}

async function runEmailDeliveriesServiceAssertions(): Promise<void> {
  const service = new EmailDeliveriesService() as any;
  const adminAuth = { userId: 'admin-1', role: 'admin' };
  const cleanupActivities: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];
  const listQueries: Array<Record<string, unknown>> = [];

  service.operationalEventService = {
    async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
      failureAlerts.push({ userId, ...payload });
    },
  };

  await assert.rejects(
    () => service.getEmailDeliveries({ userId: 'user-1', role: 'user' }, {}),
    /Admin role is required to monitor email deliveries/
  );

  service.emailDeliveryRepository = {
    async listDeliveries(query: Record<string, unknown>) {
      listQueries.push(query);
      return {
        items: [
          {
            id: 'delivery-1',
            userId: 'user-2',
            alertId: 'alert-1',
            recipientEmail: 'ops@example.com',
            subject: 'SMTP failure',
            body: 'Hello ops@example.com',
            channel: 'Alerts',
            severity: 'High',
            route: 'Email Deliveries',
            source: 'worker:alert',
            status: 'Failed',
            attempts: 2,
            lastError: 'SMTP timeout',
            createdAt: new Date('2026-04-04T09:10:00.000Z'),
            updatedAt: new Date('2026-04-04T09:11:00.000Z'),
          },
        ],
        total: 1,
      };
    },
    async getSummary() {
      return {
        queued: 1,
        sending: 2,
        sent: 10,
        failed: 3,
        active: 6,
        latestSentAt: new Date('2026-04-04T12:00:00.000Z'),
        oldestPendingAt: new Date('2026-04-04T08:00:00.000Z'),
      };
    },
    async getFilterOptions() {
      return {
        severities: ['High', 'Medium'],
        channels: ['Alerts', 'Scheduler'],
      };
    },
    async getDeliveryById(deliveryId: string) {
      if (deliveryId === 'missing') {
        return null;
      }
      return {
        id: deliveryId,
        userId: 'admin-1',
        alertId: 'alert-1',
        recipientEmail: 'ops@example.com',
        subject: 'SMTP failure',
        body: [
          'Hello ops@example.com,',
          'Reset link: https://example.com/reset/token-ABC12345678901234567890',
          'Reference 123456 should not leak.',
        ].join('\n'),
        channel: 'Alerts',
        severity: 'High',
        route: 'Email Deliveries',
        source: 'worker:alert',
        status: deliveryId === 'delivery-2' ? 'Sent' : 'Failed',
        attempts: 2,
        lastError: deliveryId === 'delivery-2' ? null : 'SMTP timeout',
        createdAt: new Date('2026-04-04T09:10:00.000Z'),
        updatedAt: new Date('2026-04-04T09:11:00.000Z'),
      };
    },
    async cloneDeliveryForResend(delivery: Record<string, unknown>) {
      assert.equal(delivery.id, 'delivery-2');
      return {
        ...delivery,
        id: 'delivery-3',
        status: 'Queued',
        attempts: 0,
        lastError: null,
        createdAt: new Date('2026-04-04T11:02:00.000Z'),
        updatedAt: new Date('2026-04-04T11:02:00.000Z'),
      };
    },
    async retryFailedDelivery(deliveryId: string) {
      if (deliveryId === 'delivery-4') {
        return null;
      }
      return {
        id: deliveryId,
        userId: 'admin-1',
        alertId: 'alert-4',
        recipientEmail: 'ops@example.com',
        subject: 'SMTP failed',
        body: 'Failure body',
        channel: 'Alerts',
        severity: 'High',
        route: 'Signals',
        source: 'worker:failed',
        status: 'Queued',
        attempts: 0,
        lastError: null,
        createdAt: new Date('2026-04-04T12:00:00.000Z'),
        updatedAt: new Date('2026-04-04T12:01:00.000Z'),
      };
    },
    async countMatchingTerminalDeliveries(filters: Record<string, unknown>) {
      assert.equal(filters.source, 'worker');
      return {
        total: 2,
        sent: 1,
        failed: 1,
      };
    },
    async deleteMatchingTerminalDeliveries(filters: Record<string, unknown>) {
      assert.equal(filters.source, 'worker');
      return 2;
    },
    async countTerminalDeliveriesOlderThanDays(retentionDays: number) {
      assert.equal(retentionDays, 30);
      return {
        total: 4,
        sent: 3,
        failed: 1,
      };
    },
    async queueDelivery(payload: Record<string, unknown>) {
      return {
        id: 'delivery-test-1',
        userId: payload.userId,
        alertId: payload.alertId ?? null,
        recipientEmail: payload.recipientEmail,
        subject: payload.subject,
        body: payload.body,
        channel: payload.channel,
        severity: payload.severity,
        route: payload.route ?? null,
        source: payload.source ?? null,
        status: payload.status ?? 'Queued',
        attempts: payload.attempts ?? 0,
        lastError: payload.lastError ?? null,
        createdAt: new Date('2026-04-04T13:00:00.000Z'),
        updatedAt: new Date('2026-04-04T13:00:00.000Z'),
      };
    },
  };
  service.activityRepository = {
    async getLatestEmailDeliveryCleanupActivity() {
      return {
        id: 'activity-1',
        userId: 'admin-2',
        title: 'Retention email cleanup removed 4 deliveries',
        status: 'Success',
        actor: 'admin-2',
        stream: 'Controls',
        route: 'Email Deliveries',
        related: 'retention-cleanup',
        description: 'Deleted 4 terminal delivery rows.',
        createdAt: new Date('2026-04-04T09:00:00.000Z'),
      };
    },
    async createActivityLog(payload: Record<string, unknown>) {
      cleanupActivities.push(payload);
      return {
        id: `activity-${cleanupActivities.length}`,
        createdAt: new Date('2026-04-04T10:00:00.000Z'),
        ...payload,
      };
    },
  };
  service.userRepository = {
    async findByIds(userIds: string[]) {
      return userIds.map((userId) => ({
        id: userId,
        email: `${userId}@example.com`,
        fullName: `${userId} user`,
      }));
    },
    async findById(userId: string) {
      if (userId === 'missing-admin') {
        return null;
      }
      return {
        id: userId,
        email: `${userId}@example.com`,
        fullName: 'Admin User',
      };
    },
  };

  const listResponse = await service.getEmailDeliveries(adminAuth, {
    limit: '25',
    offset: '5',
    status: 'Failed',
  });
  assert.equal(listQueries[0]?.limit, 25);
  assert.equal(listQueries[0]?.offset, 5);
  assert.equal(listResponse.data.total, 1);
  assert.equal(listResponse.data.limit, 25);
  assert.equal(listResponse.data.offset, 5);
  assert.equal(listResponse.data.items[0].userEmail, 'user-2@example.com');

  const summaryResponse = await service.getEmailDeliveriesSummary(adminAuth);
  assert.equal(summaryResponse.data.active, 6);
  assert.equal(summaryResponse.data.latestSentAt, '2026-04-04T12:00:00.000Z');
  assert.equal(summaryResponse.data.oldestPendingAt, '2026-04-04T08:00:00.000Z');

  const filterResponse = await service.getEmailDeliveryFilterOptions(adminAuth);
  assert.deepEqual(filterResponse.data, {
    severities: ['High', 'Medium'],
    channels: ['Alerts', 'Scheduler'],
    defaultRetentionDays: 30,
    exportMaxRows: 5000,
    bodyVisibility: 'redacted-preview',
    governance: {
      bodyVisibility: 'redacted-preview',
      cleanupEligibleStatuses: ['Sent', 'Failed'],
      cleanupProtectedStatuses: ['Queued', 'Sending'],
      retentionField: 'updatedAt',
      bodyPreviewMaxChars: 600,
      bodyPreviewMaxLines: 8,
    },
  });

  const cleanupResponse = await service.getLatestCleanupActivity(adminAuth);
  assert.deepEqual(cleanupResponse.data, {
    id: 'activity-1',
    userId: 'admin-2',
    title: 'Retention email cleanup removed 4 deliveries',
    status: 'Success',
    actor: 'admin-2',
    stream: 'Controls',
    route: 'Email Deliveries',
    related: 'retention-cleanup',
    description: 'Deleted 4 terminal delivery rows.',
    time: '2026-04-04T09:00:00.000Z',
  });

  const detailResponse = await service.getEmailDeliveryById(adminAuth, 'delivery-1');
  assert.equal(detailResponse.data.bodyPreview?.includes('[redacted-email]'), true);
  assert.equal(detailResponse.data.bodyPreview?.includes('[redacted-link]'), true);
  assert.equal(detailResponse.data.bodyPreview?.includes('[redacted-token]'), true);
  assert.equal(detailResponse.data.bodyPreviewTruncated, undefined);

  const exportResponse = await service.exportEmailDeliveries(adminAuth, {
    format: 'csv',
    status: 'Failed',
  });
  assert.equal(listQueries[1]?.limit, 5000);
  assert.equal(listQueries[1]?.offset, 0);
  assert.equal(exportResponse.data.status, 'Ready');
  assert.equal(exportResponse.data.exportedCount, 1);
  assert.match(exportResponse.data.fileName, /^email-deliveries-filtered-/);
  assert.match(exportResponse.data.csv, /recipientEmail/);
  assert.match(exportResponse.data.csv, /ops@example.com/);

  const resendResponse = await service.resendEmailDelivery(adminAuth, 'delivery-2');
  assert.equal(
    resendResponse.data.message,
    'A new delivery copy has been queued. The original record remains unchanged for history.'
  );
  assert.equal(resendResponse.data.delivery.id, 'delivery-3');
  assert.equal(resendResponse.data.delivery.status, 'Queued');

  await assert.rejects(
    () => service.retryEmailDelivery(adminAuth, 'delivery-4'),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'This email delivery is no longer failed and cannot be retried again'
  );

  const cleanupMatchingResponse = await service.cleanupMatchingEmailDeliveries(adminAuth, {
    source: 'worker',
  });
  assert.equal(cleanupMatchingResponse.data.deletedCount, 2);
  assert.equal(cleanupMatchingResponse.data.deletedSentCount, 1);
  assert.equal(cleanupMatchingResponse.data.deletedFailedCount, 1);
  assert.equal(cleanupActivities.length, 1);
  assert.equal(cleanupActivities[0]?.route, 'Email Deliveries');
  assert.equal(cleanupActivities[0]?.related, 'filtered-cleanup');

  await assert.rejects(
    () => service.previewMatchingCleanupEmailDeliveries(adminAuth, {}),
    /At least one filter is required to preview filtered email cleanup/
  );

  const retentionPreview = await service.previewCleanupEmailDeliveries(adminAuth, '30');
  assert.equal(retentionPreview.data.retentionDays, 30);
  assert.equal(retentionPreview.data.matchingCount, 4);

  const testSendResponse = await service.sendTestEmailDelivery(adminAuth);
  assert.match(testSendResponse.data.message, /Test email queued/);
  assert.equal(testSendResponse.data.delivery.status, 'Queued');
  assert.equal(testSendResponse.data.delivery.bodyPreview?.includes('[redacted-email]'), true);

  await assert.rejects(
    () => service.sendTestEmailDelivery({ userId: 'missing-admin', role: 'admin' }),
    /Admin user was not found/
  );
  assert.equal(failureAlerts.length, 1);
  assert.equal(failureAlerts[0].source, 'email-deliveries:test');
}

function runEmailDeliveriesScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');

  assert.equal(
    packageScripts['test:email-deliveries'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-email-deliveries.ts'
  );
  assert.match(runPackageSuiteSource, /'test:email-deliveries'/);
  assert.match(runPackageSuiteSource, /'email-deliveries':\s*\['test:email-deliveries'\]/);
}

async function main(): Promise<void> {
  await runEmailDeliveriesControllerAssertions();
  runEmailDeliveriesValidationAssertions();
  await runEmailDeliveriesServiceAssertions();
  runEmailDeliveriesScriptWiringAssertions();
  console.log('Email deliveries module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
