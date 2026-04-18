import assert from 'node:assert/strict';

import {
  assertSecureEnvironmentConfig,
  env,
  resolveAuthSeedConfig
} from '../src/env';
import { AuthLoginProtectionService } from '../src/api/services/AuthLoginProtectionService';

function runAuthSeedResolutionAssertions(): void {
  assert.deepEqual(
    resolveAuthSeedConfig(
      {
        APP_ENV: 'localhost'
      },
      'localhost'
    ),
    {
      enabled: true,
      email: 'admin@auralpha.com',
      password: 'Admin@123',
      fullName: 'AurAlpha Admin'
    }
  );

  assert.deepEqual(
    resolveAuthSeedConfig(
      {
        APP_ENV: 'qa'
      },
      'qa'
    ),
    {
      enabled: false,
      email: '',
      password: '',
      fullName: ''
    }
  );
}

function runEnvironmentValidationAssertions(): void {
  assert.doesNotThrow(() =>
    assertSecureEnvironmentConfig({
      node: 'production',
      appEnvironment: 'qa',
      appRequireApiKey: true,
      appApiKey: 'strong-api-key',
      authAccessTokenSecret: 'strong-access-secret',
      discoverySchedulerSecret: 'strong-scheduler-secret',
      brokerAccountSecretsKey: 'strong-broker-secret',
      authSeedEnabled: false,
      authSeedEmail: '',
      authSeedPassword: '',
      authSeedFullName: '',
      schedulerExecutionMode: 'queue',
      schedulerWorkerBaseUrl: 'http://scheduler.internal:3001',
      redisHost: 'redis.internal',
      redisAutoStart: false,
      dbHost: 'mysql.internal',
      dbUsername: 'auralpha',
      dbPassword: 'strong-db-password',
      dbDatabase: 'auralpha',
      dbSynchronize: false,
      pgEnabled: true,
      pgHost: 'postgres.internal',
      pgUsername: 'auralpha_pg',
      pgPassword: 'strong-pg-password',
      pgDatabase: 'auralpha',
      activityExportStorageMode: 'filesystem',
      activityExportStorageDir: '/srv/auralpha/activity-exports'
    })
  );

  assert.throws(
    () =>
      assertSecureEnvironmentConfig({
        node: 'production',
        appEnvironment: 'qa',
        appRequireApiKey: true,
        appApiKey: 'strong-api-key',
        authAccessTokenSecret: 'auralpha-local-access-secret',
        discoverySchedulerSecret: 'strong-scheduler-secret',
        brokerAccountSecretsKey: 'strong-broker-secret',
        authSeedEnabled: false,
        authSeedEmail: '',
        authSeedPassword: '',
        authSeedFullName: '',
        schedulerExecutionMode: 'queue',
        schedulerWorkerBaseUrl: 'http://scheduler.internal:3001',
        redisHost: 'redis.internal',
        redisAutoStart: false,
        dbHost: 'mysql.internal',
        dbUsername: 'auralpha',
        dbPassword: 'strong-db-password',
        dbDatabase: 'auralpha',
        dbSynchronize: false,
        pgEnabled: true,
        pgHost: 'postgres.internal',
        pgUsername: 'auralpha_pg',
        pgPassword: 'strong-pg-password',
        pgDatabase: 'auralpha',
        activityExportStorageMode: 'filesystem',
        activityExportStorageDir: '/srv/auralpha/activity-exports'
      }),
    /AUTH_ACCESS_TOKEN_SECRET/
  );

  assert.throws(
    () =>
      assertSecureEnvironmentConfig({
        node: 'production',
        appEnvironment: 'qa',
        appRequireApiKey: true,
        appApiKey: '',
        authAccessTokenSecret: 'strong-access-secret',
        discoverySchedulerSecret: 'strong-scheduler-secret',
        brokerAccountSecretsKey: 'strong-broker-secret',
        authSeedEnabled: false,
        authSeedEmail: '',
        authSeedPassword: '',
        authSeedFullName: '',
        schedulerExecutionMode: 'queue',
        schedulerWorkerBaseUrl: 'http://scheduler.internal:3001',
        redisHost: 'redis.internal',
        redisAutoStart: false,
        dbHost: 'mysql.internal',
        dbUsername: 'auralpha',
        dbPassword: 'strong-db-password',
        dbDatabase: 'auralpha',
        dbSynchronize: false,
        pgEnabled: true,
        pgHost: 'postgres.internal',
        pgUsername: 'auralpha_pg',
        pgPassword: 'strong-pg-password',
        pgDatabase: 'auralpha',
        activityExportStorageMode: 'filesystem',
        activityExportStorageDir: '/srv/auralpha/activity-exports'
      }),
    /APP_API_KEY/
  );

  assert.throws(
    () =>
      assertSecureEnvironmentConfig({
        node: 'production',
        appEnvironment: 'qa',
        appRequireApiKey: true,
        appApiKey: 'strong-api-key',
        authAccessTokenSecret: 'strong-access-secret',
        discoverySchedulerSecret: 'strong-scheduler-secret',
        brokerAccountSecretsKey: 'strong-broker-secret',
        authSeedEnabled: true,
        authSeedEmail: 'admin@auralpha.com',
        authSeedPassword: 'Admin@123',
        authSeedFullName: 'AurAlpha Admin',
        schedulerExecutionMode: 'queue',
        schedulerWorkerBaseUrl: 'http://scheduler.internal:3001',
        redisHost: 'redis.internal',
        redisAutoStart: false,
        dbHost: 'mysql.internal',
        dbUsername: 'auralpha',
        dbPassword: 'strong-db-password',
        dbDatabase: 'auralpha',
        dbSynchronize: false,
        pgEnabled: true,
        pgHost: 'postgres.internal',
        pgUsername: 'auralpha_pg',
        pgPassword: 'strong-pg-password',
        pgDatabase: 'auralpha',
        activityExportStorageMode: 'filesystem',
        activityExportStorageDir: '/srv/auralpha/activity-exports'
      }),
    /AUTH_SEED_EMAIL, AUTH_SEED_PASSWORD, and AUTH_SEED_FULL_NAME/
  );

  assert.throws(
    () =>
      assertSecureEnvironmentConfig({
        node: 'production',
        appEnvironment: 'qa',
        appRequireApiKey: true,
        appApiKey: 'strong-api-key',
        authAccessTokenSecret: 'strong-access-secret',
        discoverySchedulerSecret: 'strong-scheduler-secret',
        brokerAccountSecretsKey: 'strong-broker-secret',
        authSeedEnabled: false,
        authSeedEmail: '',
        authSeedPassword: '',
        authSeedFullName: '',
        schedulerExecutionMode: 'queue',
        schedulerWorkerBaseUrl: '',
        redisHost: 'redis.internal',
        redisAutoStart: false,
        dbHost: 'mysql.internal',
        dbUsername: 'auralpha',
        dbPassword: 'strong-db-password',
        dbDatabase: 'auralpha',
        dbSynchronize: false,
        pgEnabled: true,
        pgHost: 'postgres.internal',
        pgUsername: 'auralpha_pg',
        pgPassword: 'strong-pg-password',
        pgDatabase: 'auralpha',
        activityExportStorageMode: 'filesystem',
        activityExportStorageDir: '/srv/auralpha/activity-exports'
      }),
    /SCHEDULER_WORKER_BASE_URL/
  );

  assert.throws(
    () =>
      assertSecureEnvironmentConfig({
        node: 'production',
        appEnvironment: 'qa',
        appRequireApiKey: true,
        appApiKey: 'strong-api-key',
        authAccessTokenSecret: 'strong-access-secret',
        discoverySchedulerSecret: 'strong-scheduler-secret',
        brokerAccountSecretsKey: 'strong-broker-secret',
        authSeedEnabled: false,
        authSeedEmail: '',
        authSeedPassword: '',
        authSeedFullName: '',
        schedulerExecutionMode: 'queue',
        schedulerWorkerBaseUrl: 'http://scheduler.internal:3001',
        redisHost: 'redis.internal',
        redisAutoStart: true,
        dbHost: 'mysql.internal',
        dbUsername: 'auralpha',
        dbPassword: 'strong-db-password',
        dbDatabase: 'auralpha',
        dbSynchronize: false,
        pgEnabled: true,
        pgHost: 'postgres.internal',
        pgUsername: 'auralpha_pg',
        pgPassword: 'strong-pg-password',
        pgDatabase: 'auralpha',
        activityExportStorageMode: 'filesystem',
        activityExportStorageDir: '/srv/auralpha/activity-exports'
      }),
    /REDIS_AUTO_START/
  );

  assert.throws(
    () =>
      assertSecureEnvironmentConfig({
        node: 'production',
        appEnvironment: 'qa',
        appRequireApiKey: true,
        appApiKey: 'strong-api-key',
        authAccessTokenSecret: 'strong-access-secret',
        discoverySchedulerSecret: 'strong-scheduler-secret',
        brokerAccountSecretsKey: 'strong-broker-secret',
        authSeedEnabled: false,
        authSeedEmail: '',
        authSeedPassword: '',
        authSeedFullName: '',
        schedulerExecutionMode: 'queue',
        schedulerWorkerBaseUrl: 'http://scheduler.internal:3001',
        redisHost: 'redis.internal',
        redisAutoStart: false,
        dbHost: 'mysql.internal',
        dbUsername: 'auralpha',
        dbPassword: 'strong-db-password',
        dbDatabase: 'auralpha',
        dbSynchronize: true,
        pgEnabled: true,
        pgHost: 'postgres.internal',
        pgUsername: 'auralpha_pg',
        pgPassword: 'strong-pg-password',
        pgDatabase: 'auralpha',
        activityExportStorageMode: 'filesystem',
        activityExportStorageDir: '/srv/auralpha/activity-exports'
      }),
    /DB_SYNCHRONIZE/
  );

  assert.throws(
    () =>
      assertSecureEnvironmentConfig({
        node: 'production',
        appEnvironment: 'qa',
        appRequireApiKey: true,
        appApiKey: 'strong-api-key',
        authAccessTokenSecret: 'strong-access-secret',
        discoverySchedulerSecret: 'strong-scheduler-secret',
        brokerAccountSecretsKey: 'strong-broker-secret',
        authSeedEnabled: false,
        authSeedEmail: '',
        authSeedPassword: '',
        authSeedFullName: '',
        schedulerExecutionMode: 'queue',
        schedulerWorkerBaseUrl: 'http://scheduler.internal:3001',
        redisHost: 'redis.internal',
        redisAutoStart: false,
        dbHost: '',
        dbUsername: 'auralpha',
        dbPassword: 'strong-db-password',
        dbDatabase: 'auralpha',
        dbSynchronize: false,
        pgEnabled: true,
        pgHost: 'postgres.internal',
        pgUsername: 'auralpha_pg',
        pgPassword: 'strong-pg-password',
        pgDatabase: 'auralpha',
        activityExportStorageMode: 'filesystem',
        activityExportStorageDir: '/srv/auralpha/activity-exports'
      }),
    /DB_HOST/
  );

  assert.throws(
    () =>
      assertSecureEnvironmentConfig({
        node: 'production',
        appEnvironment: 'qa',
        appRequireApiKey: true,
        appApiKey: 'strong-api-key',
        authAccessTokenSecret: 'strong-access-secret',
        discoverySchedulerSecret: 'strong-scheduler-secret',
        brokerAccountSecretsKey: 'strong-broker-secret',
        authSeedEnabled: false,
        authSeedEmail: '',
        authSeedPassword: '',
        authSeedFullName: '',
        schedulerExecutionMode: 'queue',
        schedulerWorkerBaseUrl: 'http://scheduler.internal:3001',
        redisHost: 'redis.internal',
        redisAutoStart: false,
        dbHost: 'mysql.internal',
        dbUsername: 'auralpha',
        dbPassword: 'strong-db-password',
        dbDatabase: 'auralpha',
        dbSynchronize: false,
        pgEnabled: true,
        pgHost: 'postgres.internal',
        pgUsername: 'auralpha_pg',
        pgPassword: 'strong-pg-password',
        pgDatabase: 'auralpha',
        activityExportStorageMode: 'filesystem',
        activityExportStorageDir: ''
      }),
    /ACTIVITY_EXPORT_STORAGE_DIR/
  );
}

function runLoginProtectionAssertions(): void {
  const originalConfig = {
    loginProtectionEnabled: env.auth.loginProtectionEnabled,
    loginMaxAttempts: env.auth.loginMaxAttempts,
    loginIpMaxAttempts: env.auth.loginIpMaxAttempts,
    loginWindowMinutes: env.auth.loginWindowMinutes,
    loginLockoutMinutes: env.auth.loginLockoutMinutes
  };

  try {
    env.auth.loginProtectionEnabled = true;
    env.auth.loginMaxAttempts = 2;
    env.auth.loginIpMaxAttempts = 3;
    env.auth.loginWindowMinutes = 15;
    env.auth.loginLockoutMinutes = 10;

    const service = new AuthLoginProtectionService();
    const attempt = {
      email: 'admin@auralpha.com',
      ipAddress: '127.0.0.1'
    };

    assert.doesNotThrow(() => service.assertLoginAllowed(attempt));

    service.recordLoginFailure(attempt);
    assert.doesNotThrow(() => service.assertLoginAllowed(attempt));

    service.recordLoginFailure(attempt);
    assert.throws(
      () => service.assertLoginAllowed(attempt),
      (error: unknown) =>
        error instanceof Error &&
        (error as { httpCode?: number }).httpCode === 429 &&
        error.message.includes('Too many login attempts')
    );
    const lockedSnapshot = service.getSnapshot();
    assert.equal(lockedSnapshot.trackedBuckets, 2);
    assert.equal(lockedSnapshot.activePairLockouts, 1);
    assert.equal(lockedSnapshot.activeIpLockouts, 0);
    assert.equal(lockedSnapshot.pairFailuresInWindow, 2);
    assert.equal(lockedSnapshot.ipFailuresInWindow, 2);
    assert.ok(lockedSnapshot.nextLockoutExpiresAt);
    assert.ok(Date.parse(lockedSnapshot.nextLockoutExpiresAt) > Date.now());

    const resetService = new AuthLoginProtectionService();
    resetService.recordLoginFailure(attempt);
    resetService.recordLoginSuccess(attempt);
    assert.doesNotThrow(() => resetService.assertLoginAllowed(attempt));
    assert.deepEqual(resetService.getSnapshot(), {
      trackedBuckets: 0,
      activePairLockouts: 0,
      activeIpLockouts: 0,
      pairFailuresInWindow: 0,
      ipFailuresInWindow: 0,
      nextLockoutExpiresAt: null
    });
  } finally {
    env.auth.loginProtectionEnabled = originalConfig.loginProtectionEnabled;
    env.auth.loginMaxAttempts = originalConfig.loginMaxAttempts;
    env.auth.loginIpMaxAttempts = originalConfig.loginIpMaxAttempts;
    env.auth.loginWindowMinutes = originalConfig.loginWindowMinutes;
    env.auth.loginLockoutMinutes = originalConfig.loginLockoutMinutes;
  }
}

function main(): void {
  runAuthSeedResolutionAssertions();
  runEnvironmentValidationAssertions();
  runLoginProtectionAssertions();

  console.log('Auth security assertions passed.');
}

try {
  main();
} catch (error) {
  console.error('Auth security assertion failure:', error);
  process.exit(1);
}
