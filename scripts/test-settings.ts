import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { SettingsController } from '../src/api/controllers/SettingsController';
import { createDefaultBacktestPromotionRules } from '../src/api/utils/backtestPromotionRules';
import { SettingsService } from '../src/api/services/SettingsService';
import {
  validateSettingsAuditQuery,
  validateUpdateSettingsBody,
} from '../src/api/validators/settings.validator';
import { coreDataSource } from '../src/database/data-source';
import { ActivityLog, AppSetting, SettingsAuditLog } from '../src/database';
import { CreateAppSettingsTable1741474200000 } from './_fixtures/migrations/1741474200000-CreateAppSettingsTable';
import { NormalizeAppSettingsPrimaryKey1765401000000 } from './_fixtures/migrations/1765401000000-NormalizeAppSettingsPrimaryKey';
import { AddBacktestPromotionRulesToAppSettings1770715000000 } from './_fixtures/migrations/1770715000000-AddBacktestPromotionRulesToAppSettings';
import { AddWhatsappSuggestionSettingsAndQueue1770716000000 } from './_fixtures/migrations/1770716000000-AddWhatsappSuggestionSettingsAndQueue';

type MigrationColumn = {
  name: string;
  isGenerated?: boolean;
  generationStrategy?: string;
};

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

async function runSettingsControllerAssertions(): Promise<void> {
  const controller: any = new SettingsController();

  controller.settingsService = {
    getSettings: async (...args: unknown[]) => createSuccess({ args }),
    getSettingsAudit: async (...args: unknown[]) => createSuccess({ args }),
    updateSettings: async (...args: unknown[]) => createSuccess({ args }),
  };

  assert.deepEqual((await controller.getSettings(authReq)).data.args, ['user-1']);
  assert.deepEqual((await controller.getSettingsAudit(authReq, '10', '5')).data.args, [
    'user-1',
    { limit: '10', offset: '5' },
  ]);
  assert.deepEqual(
    (
      await controller.updateSettings(authReq, {
        timezone: 'Asia/Kolkata',
        notificationChannel: 'email',
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      })
    ).data.args,
    [
      'user-1',
      {
        timezone: 'Asia/Kolkata',
        notificationChannel: 'email',
        expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
      },
    ]
  );

  await assertAuthRequired(() => controller.getSettings(unauthReq));
  await assertAuthRequired(() => controller.getSettingsAudit(unauthReq));
  await assertAuthRequired(() => controller.updateSettings(unauthReq, {}));
}

function runSettingsValidationAssertions(): void {
  const defaultPromotionRules = createDefaultBacktestPromotionRules();
  const defaultSettings = {
    timezone: 'UTC',
    notifyEmail: true,
    notifyInApp: true,
    notifyWhatsapp: false,
    whatsappLiveTradeSuggestions: false,
    whatsappNumber: null,
    confirmDestructive: true,
    notificationChannel: 'both' as const,
    notificationSeverity: 'all' as const,
    escalationRoute: 'risk-review' as const,
    escalationSlaMinutes: 15,
    backtestPromotionRules: defaultPromotionRules,
  };

  assert.deepEqual(validateSettingsAuditQuery(), { limit: 20, offset: 0 });
  assert.deepEqual(validateSettingsAuditQuery({ limit: '5', offset: '2' }), {
    limit: 5,
    offset: 2,
  });
  assert.throws(
    () => validateSettingsAuditQuery({ limit: '0' }),
    /limit must be an integer between 1 and 100/
  );
  assert.throws(
    () => validateSettingsAuditQuery({ limit: '101' }),
    /limit must be an integer between 1 and 100/
  );
  assert.throws(
    () => validateSettingsAuditQuery({ offset: '-1' }),
    /offset must be an integer greater than or equal to 0/
  );

  assert.throws(
    () =>
      validateUpdateSettingsBody(
        {
          timezone: 'UTC',
          unknownField: true,
        } as any,
        defaultSettings
      ),
    /Unknown settings fields: unknownField/
  );

  assert.deepEqual(
    validateUpdateSettingsBody(
      {
        whatsappNumber: ' +14155550123 ',
        notifyWhatsapp: true,
        whatsappLiveTradeSuggestions: true,
        backtestPromotionRules: {
          minScore: 0.82,
          minTrades: 9,
          requireRobustness: false,
        },
      },
      defaultSettings
    ),
    {
      ...defaultSettings,
      whatsappNumber: '+14155550123',
      notifyWhatsapp: true,
      whatsappLiveTradeSuggestions: true,
      backtestPromotionRules: {
        ...defaultPromotionRules,
        minScore: 0.82,
        minTrades: 9,
        requireRobustness: false,
      },
    }
  );

  assert.throws(
    () =>
      validateUpdateSettingsBody(
        {
          backtestPromotionRules: {
            minScore: 1.2,
          },
        },
        defaultSettings
      ),
    /backtestPromotionRules.minScore must be a number between 0 and 1/
  );

  assert.throws(
    () =>
      validateUpdateSettingsBody(
        {
          notifyWhatsapp: true,
        },
        defaultSettings
      ),
    /whatsappNumber is required when WhatsApp notifications are enabled/
  );

  assert.throws(
    () =>
      validateUpdateSettingsBody(
        {
          whatsappNumber: '12345',
        },
        defaultSettings
      ),
    /whatsappNumber must be a valid E\.164 phone number/
  );

  assert.throws(
    () =>
      validateUpdateSettingsBody(
        {
          whatsappNumber: '+14155550123',
          whatsappLiveTradeSuggestions: true,
          notifyWhatsapp: false,
        },
        defaultSettings
      ),
    /notifyWhatsapp must be enabled when whatsappLiveTradeSuggestions is enabled/
  );

  assert.deepEqual(
    validateUpdateSettingsBody(
      {
        notifyWhatsapp: false,
      },
      {
        ...defaultSettings,
        notifyWhatsapp: true,
        whatsappLiveTradeSuggestions: true,
        whatsappNumber: '+14155550123',
      }
    ),
    {
      ...defaultSettings,
      notifyWhatsapp: false,
      whatsappLiveTradeSuggestions: false,
      whatsappNumber: '+14155550123',
    }
  );
}

async function runSettingsAtomicSaveAssertions(): Promise<void> {
  const service = new SettingsService() as any;
  const failureActivities: Array<Record<string, unknown>> = [];
  const failureAlerts: Array<Record<string, unknown>> = [];
  const committedSettings = new Map<string, Record<string, unknown>>();
  const committedAudits: Array<Record<string, unknown>> = [];
  const committedActivities: Array<Record<string, unknown>> = [];
  const originalTransaction = (coreDataSource as any).transaction;

  service.operationalEventService = {
    async logActivity(userId: string, payload: Record<string, unknown>) {
      failureActivities.push({ userId, ...payload });
    },
    async emitFailureAlert(userId: string, payload: Record<string, unknown>) {
      failureAlerts.push({ userId, ...payload });
    },
  };

  (coreDataSource as any).transaction = async (callback: (manager: any) => Promise<unknown>) => {
    const pendingSettings = new Map<string, Record<string, unknown>>(
      Array.from(committedSettings.entries()).map(([userId, value]) => [userId, { ...value }])
    );
    const pendingAudits = committedAudits.map((item) => ({ ...item }));
    const pendingActivities = committedActivities.map((item) => ({ ...item }));
    const manager = {
      getRepository(entity: unknown) {
        if (entity === AppSetting) {
          return {
            async findOne({ where: { userId } }: { where: { userId: string } }) {
              return pendingSettings.get(userId) ?? null;
            },
            create(payload: Record<string, unknown>) {
              return { ...payload };
            },
            merge(existing: Record<string, unknown>, payload: Record<string, unknown>) {
              return { ...existing, ...payload };
            },
            async save(payload: Record<string, unknown>) {
              const existing = pendingSettings.get(String(payload.userId));
              const saved = {
                id: existing?.id ?? pendingSettings.size + 1,
                createdAt: existing?.createdAt ?? new Date('2026-04-04T00:00:00.000Z'),
                updatedAt: new Date('2026-04-04T00:05:00.000Z'),
                ...payload,
              };
              pendingSettings.set(String(payload.userId), saved);
              return saved;
            },
          };
        }

        if (entity === SettingsAuditLog) {
          return {
            create(payload: Record<string, unknown>) {
              return { ...payload };
            },
            async save(payload: Array<Record<string, unknown>>) {
              if (payload.some((item) => item.userId === 'user-3')) {
                throw new Error('audit save failed');
              }

              for (const item of payload) {
                pendingAudits.push({
                  id: `audit-${pendingAudits.length + 1}`,
                  createdAt: new Date('2026-04-04T00:06:00.000Z'),
                  ...item,
                });
              }

              return payload;
            },
          };
        }

        if (entity === ActivityLog) {
          return {
            create(payload: Record<string, unknown>) {
              return { ...payload };
            },
            async save(payload: Record<string, unknown>) {
              if (payload.userId === 'user-2' && payload.title === 'User settings updated') {
                throw new Error('activity save failed');
              }

              const saved = {
                id: `activity-${pendingActivities.length + 1}`,
                createdAt: new Date('2026-04-04T00:07:00.000Z'),
                ...payload,
              };
              pendingActivities.push(saved);
              return saved;
            },
          };
        }

        throw new Error('Unexpected repository request');
      },
    };

    const result = await callback(manager);
    committedSettings.clear();
    for (const [userId, value] of pendingSettings.entries()) {
      committedSettings.set(userId, value);
    }
    committedAudits.splice(0, committedAudits.length, ...pendingAudits);
    committedActivities.splice(0, committedActivities.length, ...pendingActivities);
    return result;
  };

  try {
    const created = await service.updateSettings('user-1', {
      timezone: 'Asia/Kolkata',
      notifyEmail: false,
    });

    assert.equal(created.data.hasSavedSettings, true);
    assert.equal(created.data.versionToken, '2026-04-04T00:05:00.000Z');
    assert.equal(created.data.timezone, 'Asia/Kolkata');
    assert.equal(created.data.notifyEmail, false);
    assert.equal(created.data.notifyInApp, true);
    assert.equal(created.data.whatsappDeliveryRollout.status, 'disabled');
    assert.equal(created.data.whatsappDeliveryRollout.allowsLiveTradeSuggestions, false);
    assert.equal(created.data.whatsappDeliveryRollout.provider, 'twilio');
    assert.deepEqual(created.data.backtestPromotionRules, createDefaultBacktestPromotionRules());
    assert.deepEqual(
      committedSettings.get('user-1')?.backtestPromotionRules,
      createDefaultBacktestPromotionRules()
    );
    assert.deepEqual(
      committedAudits
        .filter((item) => item.userId === 'user-1')
        .map((item) => item.fieldName)
        .sort(),
      ['notifyEmail', 'timezone']
    );
    const createdTimezoneAudit = committedAudits.find((item) => item.fieldName === 'timezone');
    const createdNotifyEmailAudit = committedAudits.find(
      (item) => item.fieldName === 'notifyEmail'
    );
    assert.equal(createdTimezoneAudit?.oldValueType, 'null');
    assert.equal(createdTimezoneAudit?.newValueType, 'string');
    assert.equal(createdTimezoneAudit?.newValueJson, 'Asia/Kolkata');
    assert.equal(createdTimezoneAudit?.changeType, 'created');
    assert.equal(createdNotifyEmailAudit?.newValueType, 'boolean');
    assert.equal(createdNotifyEmailAudit?.newValueJson, false);
    assert.equal(createdNotifyEmailAudit?.changeType, 'created');
    assert.equal(
      committedActivities.filter(
        (item) => item.userId === 'user-1' && item.title === 'User settings updated'
      ).length,
      1
    );

    const noOpResponse = await service.updateSettings('user-1', {
      notifyEmail: false,
      expectedUpdatedAt: '2026-04-04T00:05:00.000Z',
    });
    assert.equal(noOpResponse.data.notifyEmail, false);
    assert.equal(noOpResponse.data.versionToken, '2026-04-04T00:05:00.000Z');
    assert.equal(committedAudits.filter((item) => item.userId === 'user-1').length, 2);
    assert.equal(
      committedActivities.filter(
        (item) => item.userId === 'user-1' && item.title === 'User settings updated'
      ).length,
      1
    );

    const customizedRules = await service.updateSettings('user-5', {
      backtestPromotionRules: {
        minScore: 0.82,
        minTrades: 9,
        requireRobustness: false,
      },
    });
    assert.equal(customizedRules.data.backtestPromotionRules.minScore, 0.82);
    assert.equal(customizedRules.data.backtestPromotionRules.minTrades, 9);
    assert.equal(customizedRules.data.backtestPromotionRules.requireRobustness, false);
    const customizedRulesAudits = committedAudits.filter((item) => item.userId === 'user-5');
    assert.deepEqual(customizedRulesAudits.map((item) => item.fieldName).sort(), [
      'backtestPromotionRules.minScore',
      'backtestPromotionRules.minTrades',
      'backtestPromotionRules.requireRobustness',
    ]);
    const customizedMinScoreAudit = customizedRulesAudits.find(
      (item) => item.fieldName === 'backtestPromotionRules.minScore'
    );
    const customizedRobustnessAudit = customizedRulesAudits.find(
      (item) => item.fieldName === 'backtestPromotionRules.requireRobustness'
    );
    assert.equal(customizedMinScoreAudit?.newValueType, 'number');
    assert.equal(customizedMinScoreAudit?.newValueJson, 0.82);
    assert.equal(customizedRobustnessAudit?.newValueType, 'boolean');
    assert.equal(customizedRobustnessAudit?.newValueJson, false);

    const whatsappSettings = await service.updateSettings('user-6', {
      whatsappNumber: '+14155550123',
      notifyWhatsapp: true,
      whatsappLiveTradeSuggestions: true,
    });
    assert.equal(whatsappSettings.data.whatsappNumber, '+14155550123');
    assert.equal(whatsappSettings.data.notifyWhatsapp, true);
    assert.equal(whatsappSettings.data.whatsappLiveTradeSuggestions, false);
    assert.equal(whatsappSettings.data.whatsappVerifiedAt, null);
    const whatsappAudits = committedAudits.filter((item) => item.userId === 'user-6');
    assert.deepEqual(whatsappAudits.map((item) => item.fieldName).sort(), [
      'notifyWhatsapp',
      'whatsappLiveTradeSuggestions',
      'whatsappNumber',
    ]);
    assert.equal(committedSettings.get('user-6')?.whatsappVerifiedAt ?? null, null);

    committedSettings.set('user-7', {
      userId: 'user-7',
      timezone: 'UTC',
      notifyEmail: true,
      notifyInApp: true,
      notifyWhatsapp: true,
      whatsappLiveTradeSuggestions: true,
      whatsappNumber: '+14155550123',
      whatsappVerifiedAt: new Date('2026-04-05T09:00:00.000Z'),
      confirmDestructive: true,
      notificationChannel: 'both',
      notificationSeverity: 'all',
      escalationRoute: 'risk-review',
      escalationSlaMinutes: 15,
      backtestPromotionRules: createDefaultBacktestPromotionRules(),
      updatedAt: new Date('2026-04-05T09:05:00.000Z'),
    });

    const disabledWhatsappSettings = await service.updateSettings('user-7', {
      notifyWhatsapp: false,
    });
    assert.equal(disabledWhatsappSettings.data.notifyWhatsapp, false);
    assert.equal(disabledWhatsappSettings.data.whatsappLiveTradeSuggestions, false);
    assert.equal(disabledWhatsappSettings.data.whatsappVerifiedAt, '2026-04-05T09:00:00.000Z');

    const rotatedWhatsappSettings = await service.updateSettings('user-7', {
      notifyWhatsapp: true,
      whatsappNumber: '+14155550124',
      whatsappLiveTradeSuggestions: true,
    });
    assert.equal(rotatedWhatsappSettings.data.notifyWhatsapp, true);
    assert.equal(rotatedWhatsappSettings.data.whatsappNumber, '+14155550124');
    assert.equal(rotatedWhatsappSettings.data.whatsappLiveTradeSuggestions, false);
    assert.equal(rotatedWhatsappSettings.data.whatsappVerifiedAt, null);

    await assert.rejects(
      service.updateSettings('user-1', {
        notifyInApp: false,
        expectedUpdatedAt: '2026-04-04T00:00:00.000Z',
      }),
      /Settings were updated elsewhere/
    );
    assert.equal(committedSettings.get('user-1')?.notifyInApp, true);
    assert.equal(
      committedActivities.filter(
        (item) => item.userId === 'user-1' && item.title === 'User settings updated'
      ).length,
      1
    );
    assert.equal(failureActivities.length, 1);
    assert.equal(failureActivities[0].userId, 'user-1');
    assert.equal(failureActivities[0].title, 'User settings update failed');
    assert.equal(failureAlerts.length, 0);

    await assert.rejects(
      service.updateSettings('user-2', { notificationSeverity: 'high' }),
      /activity save failed/
    );

    assert.equal(committedSettings.has('user-2'), false);
    assert.equal(
      committedAudits.some((item) => item.userId === 'user-2'),
      false
    );
    assert.equal(
      committedActivities.some(
        (item) => item.userId === 'user-2' && item.title === 'User settings updated'
      ),
      false
    );
    assert.equal(failureActivities.length, 2);
    assert.equal(failureActivities[1].userId, 'user-2');
    assert.equal(failureActivities[1].title, 'User settings update failed');
    assert.equal(failureAlerts.length, 1);
    assert.equal(failureAlerts[0].userId, 'user-2');

    await assert.rejects(
      service.updateSettings('user-3', { confirmDestructive: false }),
      /audit save failed/
    );

    assert.equal(committedSettings.has('user-3'), false);
    assert.equal(
      committedAudits.some((item) => item.userId === 'user-3'),
      false
    );
    assert.equal(
      committedActivities.some(
        (item) => item.userId === 'user-3' && item.title === 'User settings updated'
      ),
      false
    );
    assert.equal(failureActivities.length, 3);
    assert.equal(failureActivities[2].userId, 'user-3');
    assert.equal(failureActivities[2].title, 'User settings update failed');
    assert.equal(failureAlerts.length, 2);
    assert.equal(failureAlerts[1].userId, 'user-3');

    await assert.rejects(
      service.updateSettings('user-4', { expectedUpdatedAt: 'not-a-timestamp' }),
      /expectedUpdatedAt must be an ISO timestamp/
    );

    assert.equal(committedSettings.has('user-4'), false);
    assert.equal(
      committedAudits.some((item) => item.userId === 'user-4'),
      false
    );
    assert.equal(
      committedActivities.some(
        (item) => item.userId === 'user-4' && item.title === 'User settings updated'
      ),
      false
    );
    assert.equal(failureActivities.length, 4);
    assert.equal(failureActivities[3].userId, 'user-4');
    assert.equal(failureActivities[3].title, 'User settings update failed');
    assert.equal(failureAlerts.length, 2);
  } finally {
    (coreDataSource as any).transaction = originalTransaction;
  }
}

async function runSettingsAuditContractAssertions(): Promise<void> {
  const service = new SettingsService() as any;
  const auditQueries: Array<Record<string, unknown>> = [];

  service.appSettingsRepository = {
    async getSettings() {
      return null;
    },
  };
  service.settingsAuditRepository = {
    async listAuditLogs(_userId: string, query: Record<string, unknown>) {
      auditQueries.push(query);
      return {
        items: [
          {
            id: 'audit-1',
            fieldName: 'notifyEmail',
            oldValue: 'true',
            oldValueType: null,
            oldValueJson: null,
            newValue: 'false',
            newValueType: null,
            newValueJson: null,
            changeType: null,
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:08:00.000Z'),
          },
          {
            id: 'audit-2',
            fieldName: 'notificationChannel',
            oldValue: 'both',
            oldValueType: 'string',
            oldValueJson: 'both',
            newValue: 'disabled',
            newValueType: 'string',
            newValueJson: 'disabled',
            changeType: 'updated',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:09:00.000Z'),
          },
          {
            id: 'audit-3',
            fieldName: 'escalationSlaMinutes',
            oldValue: null,
            oldValueType: 'null',
            oldValueJson: null,
            newValue: '30',
            newValueType: 'number',
            newValueJson: 30,
            changeType: 'created',
            actor: null,
            createdAt: new Date('2026-04-04T00:10:00.000Z'),
          },
          {
            id: 'audit-4',
            fieldName: 'backtestPromotionRules.minScore',
            oldValue: '0.6',
            oldValueType: 'number',
            oldValueJson: 0.6,
            newValue: '0.8',
            newValueType: 'number',
            newValueJson: 0.8,
            changeType: 'updated',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:11:00.000Z'),
          },
          {
            id: 'audit-5',
            fieldName: 'backtestPromotionRules.requireRobustness',
            oldValue: 'true',
            oldValueType: 'boolean',
            oldValueJson: true,
            newValue: 'false',
            newValueType: 'boolean',
            newValueJson: false,
            changeType: 'updated',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:12:00.000Z'),
          },
          {
            id: 'audit-6',
            fieldName: 'backtestPromotionRules',
            oldValue: JSON.stringify(createDefaultBacktestPromotionRules()),
            oldValueType: 'json',
            oldValueJson: createDefaultBacktestPromotionRules(),
            newValue: JSON.stringify({
              ...createDefaultBacktestPromotionRules(),
              minScore: 0.8,
            }),
            newValueType: 'json',
            newValueJson: {
              ...createDefaultBacktestPromotionRules(),
              minScore: 0.8,
            },
            changeType: 'updated',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:13:00.000Z'),
          },
          {
            id: 'audit-7',
            fieldName: 'whatsappNumber',
            oldValue: null,
            oldValueType: 'null',
            oldValueJson: null,
            newValue: '+14155550123',
            newValueType: 'string',
            newValueJson: '+14155550123',
            changeType: 'created',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:14:00.000Z'),
          },
          {
            id: 'audit-8',
            fieldName: 'notifyWhatsapp',
            oldValue: null,
            oldValueType: 'null',
            oldValueJson: null,
            newValue: 'true',
            newValueType: 'boolean',
            newValueJson: true,
            changeType: 'created',
            actor: 'user-1',
            createdAt: new Date('2026-04-04T00:15:00.000Z'),
          },
        ],
        total: 8,
      };
    },
  };

  const settingsResponse = await service.getSettings('user-1');
  assert.equal(settingsResponse.data.hasSavedSettings, false);
  assert.equal(settingsResponse.data.versionToken, undefined);
  assert.equal(settingsResponse.data.backtestPromotionRules.minScore, 0.6);
  assert.equal(settingsResponse.data.notifyWhatsapp, false);
  assert.equal(settingsResponse.data.whatsappLiveTradeSuggestions, false);
  assert.equal(settingsResponse.data.whatsappNumber, null);
  assert.equal(settingsResponse.data.whatsappVerifiedAt, null);
  assert.equal(settingsResponse.data.whatsappDeliveryRollout.status, 'disabled');
  assert.equal(
    settingsResponse.data.whatsappDeliveryRollout.allowsLiveTradeSuggestions,
    false
  );
  assert.equal(settingsResponse.data.whatsappDeliveryRollout.provider, 'twilio');

  const defaultAuditResponse = await service.getSettingsAudit('user-1', {});
  assert.equal(defaultAuditResponse.data.limit, 20);
  assert.equal(defaultAuditResponse.data.offset, 0);

  const auditResponse = await service.getSettingsAudit('user-1', {
    limit: '10',
    offset: '0',
  });

  assert.deepEqual(auditQueries, [
    { limit: 20, offset: 0 },
    { limit: 10, offset: 0 },
  ]);
  assert.equal(auditResponse.data.total, 8);
  assert.equal(auditResponse.data.items[0]?.fieldLabel, 'Email notifications');
  assert.equal(auditResponse.data.items[0]?.fieldKey, 'notifyEmail');
  assert.equal(auditResponse.data.items[0]?.oldValue, true);
  assert.equal(auditResponse.data.items[0]?.newValue, false);
  assert.equal(auditResponse.data.items[0]?.oldValueType, 'boolean');
  assert.equal(auditResponse.data.items[0]?.newValueDisplay, 'Disabled');
  assert.equal(auditResponse.data.items[0]?.changeType, 'updated');
  assert.equal(auditResponse.data.items[1]?.oldValueDisplay, 'In-app + Email');
  assert.equal(auditResponse.data.items[1]?.newValueDisplay, 'Disabled');
  assert.equal(auditResponse.data.items[2]?.fieldLabel, 'Escalation SLA (minutes)');
  assert.equal(auditResponse.data.items[2]?.oldValue, null);
  assert.equal(auditResponse.data.items[2]?.newValue, 30);
  assert.equal(auditResponse.data.items[2]?.newValueType, 'number');
  assert.equal(auditResponse.data.items[2]?.changeType, 'created');
  assert.equal(auditResponse.data.items[3]?.fieldLabel, 'Promotion rule: Minimum score');
  assert.equal(auditResponse.data.items[3]?.oldValueType, 'number');
  assert.equal(auditResponse.data.items[3]?.newValueType, 'number');
  assert.equal(auditResponse.data.items[3]?.oldValueDisplay, '0.60');
  assert.equal(auditResponse.data.items[3]?.newValueDisplay, '0.80');
  assert.equal(
    auditResponse.data.items[4]?.fieldLabel,
    'Promotion rule: Robustness validation gate'
  );
  assert.equal(auditResponse.data.items[4]?.oldValueDisplay, 'Required');
  assert.equal(auditResponse.data.items[4]?.newValueDisplay, 'Optional');
  assert.equal(auditResponse.data.items[5]?.fieldLabel, 'Backtests promotion rules');
  assert.equal(auditResponse.data.items[5]?.newValueType, 'json');
  assert.equal((auditResponse.data.items[5]?.newValue as Record<string, unknown>)?.minScore, 0.8);
  assert.match(auditResponse.data.items[5]?.newValueDisplay || '', /score >= 0\.80/);
  assert.equal(auditResponse.data.items[6]?.fieldLabel, 'WhatsApp number');
  assert.equal(auditResponse.data.items[6]?.newValue, '+14155550123');
  assert.match(auditResponse.data.items[6]?.newValueDisplay || '', /\*+/);
  assert.equal(auditResponse.data.items[7]?.fieldLabel, 'WhatsApp notifications');
  assert.equal(auditResponse.data.items[7]?.newValueDisplay, 'Enabled');
}

async function runSettingsSchemaNormalizationAssertions(): Promise<void> {
  const createMigration = new CreateAppSettingsTable1741474200000();
  let createdColumns: MigrationColumn[] = [];

  await createMigration.up({
    async hasTable() {
      return false;
    },
    async createTable(table: { columns?: MigrationColumn[] }) {
      createdColumns = table.columns ?? [];
    },
  } as any);

  const idColumn = createdColumns.find((column: MigrationColumn) => column.name === 'id');
  assert.equal(idColumn?.isGenerated, true);
  assert.equal(idColumn?.generationStrategy, 'increment');

  const normalizationMigration = new NormalizeAppSettingsPrimaryKey1765401000000();
  const driftRepairQueries: string[] = [];

  await normalizationMigration.up({
    async hasTable() {
      return true;
    },
    async query(sql: string) {
      driftRepairQueries.push(sql);
      if (sql.includes('FROM information_schema.columns')) {
        return [{ extraValue: '' }];
      }

      return [];
    },
  } as any);

  assert.equal(
    driftRepairQueries.some((sql) =>
      sql.includes('ALTER TABLE app_settings MODIFY id int NOT NULL AUTO_INCREMENT')
    ),
    true
  );

  const alreadyNormalizedQueries: string[] = [];
  await normalizationMigration.up({
    async hasTable() {
      return true;
    },
    async query(sql: string) {
      alreadyNormalizedQueries.push(sql);
      if (sql.includes('FROM information_schema.columns')) {
        return [{ extraValue: 'auto_increment' }];
      }

      return [];
    },
  } as any);

  assert.equal(
    alreadyNormalizedQueries.some((sql) =>
      sql.includes('ALTER TABLE app_settings MODIFY id int NOT NULL AUTO_INCREMENT')
    ),
    false
  );

  const promotionRulesMigration = new AddBacktestPromotionRulesToAppSettings1770715000000();
  const addedColumns: string[] = [];
  await promotionRulesMigration.up({
    async hasTable() {
      return true;
    },
    async hasColumn() {
      return false;
    },
    async addColumn(_tableName: string, column: { name: string }) {
      addedColumns.push(column.name);
    },
  } as any);
  assert.deepEqual(addedColumns, ['backtestPromotionRules']);

  const droppedColumns: string[] = [];
  await promotionRulesMigration.down({
    async hasTable() {
      return true;
    },
    async hasColumn() {
      return true;
    },
    async dropColumn(_tableName: string, columnName: string) {
      droppedColumns.push(columnName);
    },
  } as any);
  assert.deepEqual(droppedColumns, ['backtestPromotionRules']);

  const whatsappMigration = new AddWhatsappSuggestionSettingsAndQueue1770716000000();
  const addedWhatsappColumns: string[] = [];
  let createdWhatsappTableName: string | null = null;
  let createdWhatsappTableColumns: string[] = [];
  let createdWhatsappIndices: string[] = [];

  await whatsappMigration.up({
    async hasTable(tableName: string) {
      return tableName === 'app_settings';
    },
    async hasColumn() {
      return false;
    },
    async addColumn(_tableName: string, column: { name: string }) {
      addedWhatsappColumns.push(column.name);
    },
    async createTable(table: { name: string; columns?: Array<{ name: string }> }) {
      createdWhatsappTableName = table.name;
      createdWhatsappTableColumns = (table.columns || []).map((column) => column.name);
    },
    async createIndices(_tableName: string, indices: Array<{ name: string }>) {
      createdWhatsappIndices = indices.map((index) => index.name);
    },
  } as any);

  assert.deepEqual(addedWhatsappColumns, [
    'notifyWhatsapp',
    'whatsappLiveTradeSuggestions',
    'whatsappNumber',
    'whatsappVerifiedAt',
  ]);
  assert.equal(createdWhatsappTableName, 'whatsapp_deliveries');
  assert.equal(createdWhatsappTableColumns.includes('recipient_phone'), true);
  assert.equal(createdWhatsappTableColumns.includes('dedupe_key'), true);
  assert.deepEqual(createdWhatsappIndices, [
    'idx_whatsapp_deliveries_status_created_at',
    'idx_whatsapp_deliveries_user_created_at',
    'idx_whatsapp_deliveries_status_updated_at',
    'uidx_whatsapp_deliveries_dedupe_key',
  ]);

  const droppedWhatsappColumns: string[] = [];
  let droppedWhatsappTable = false;
  await whatsappMigration.down({
    async hasTable(tableName: string) {
      return tableName === 'app_settings' || tableName === 'whatsapp_deliveries';
    },
    async hasColumn() {
      return true;
    },
    async dropColumn(_tableName: string, columnName: string) {
      droppedWhatsappColumns.push(columnName);
    },
    async dropTable(tableName: string) {
      droppedWhatsappTable = tableName === 'whatsapp_deliveries';
    },
  } as any);

  assert.equal(droppedWhatsappTable, true);
  assert.deepEqual(droppedWhatsappColumns, [
    'whatsappVerifiedAt',
    'whatsappNumber',
    'whatsappLiveTradeSuggestions',
    'notifyWhatsapp',
  ]);
}

function runSettingsScriptWiringAssertions(): void {
  const packageSource = read('package.json');
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const runPackageSuiteSource = read('scripts/_support/run-package-suite.ts');
  const smokeModulesSource = read('scripts/smokes/smoke-modules.sh');

  assert.equal(
    packageScripts['test:settings'],
    'node --import tsx scripts/_support/run-doc-aware-test.ts scripts/test-settings.ts'
  );
  assert.equal(runPackageSuiteSource.includes("settings: ['test:settings']"), true);
  assert.equal(runPackageSuiteSource.includes("'test:settings'"), true);
  assert.equal(
    smokeModulesSource.includes('/settings') && smokeModulesSource.includes('/settings/audit'),
    true,
    'settings smoke should exercise the main and audit APIs'
  );
  assert.equal(
    packageScripts['check:settings-health'],
    'node --import tsx scripts/checks/check-settings-health.ts'
  );
  assert.equal(
    packageScripts['release-gate:settings'],
    'node --import tsx scripts/release-gates/release-gate-settings.ts'
  );
  assert.equal(
    packageScripts['signoff:settings'],
    'node --import tsx scripts/signoffs/signoff-settings.ts'
  );
}

async function main(): Promise<void> {
  await runSettingsControllerAssertions();
  runSettingsValidationAssertions();
  await runSettingsAtomicSaveAssertions();
  await runSettingsAuditContractAssertions();
  await runSettingsSchemaNormalizationAssertions();
  runSettingsScriptWiringAssertions();
  console.log('Settings module assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
