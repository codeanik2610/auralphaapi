import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { hashSync } from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { AuthController } from '../src/api/controllers/AuthController';
import { ApiKeyMiddleware } from '../src/api/middlewares/ApiKeyMiddleware';
import { AuthService } from '../src/api/services/AuthService';
import {
  validateLoginBody,
  validateLogoutBody,
  validateRefreshBody,
} from '../src/api/validators/auth.validator';
import { env } from '../src/env';

function createAuthTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createSuccess<T>(data: T) {
  return { success: true as const, data };
}

function attachNoopLoginProtection(service: any): any {
  service.authLoginProtectionService = {
    assertLoginAllowed() {},
    recordLoginFailure() {},
    recordLoginSuccess() {}
  };

  return service;
}

async function expectUnauthorized(
  run: () => Promise<unknown>,
  message: string
): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 401 &&
      error.message === message
  );
}

function expectBadRequestSync(run: () => unknown, message: string): void {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 400 &&
      error.message === message
  );
}

async function runValidatorAssertions(): Promise<void> {
  assert.deepEqual(validateLoginBody({ email: ' Admin@AurAlpha.com ', password: 'secret-1' }), {
    email: 'admin@auralpha.com',
    password: 'secret-1',
  });
  assert.equal(validateRefreshBody({ refreshToken: ' refresh-me ' }), 'refresh-me');
  assert.equal(validateLogoutBody({ refreshToken: ' logout-me ' }), 'logout-me');

  expectBadRequestSync(
    () => validateLoginBody({ email: '', password: 'secret-1' }),
    'A valid email is required'
  );
  expectBadRequestSync(
    () => validateLoginBody({ email: 'user@example.com', password: '' }),
    'Password is required'
  );
  expectBadRequestSync(
    () => validateRefreshBody({ refreshToken: '' }),
    'refreshToken is required'
  );
  expectBadRequestSync(
    () => validateLogoutBody({ refreshToken: '' }),
    'refreshToken is required'
  );
}

async function runLoginContractAssertions(): Promise<void> {
  const service = attachNoopLoginProtection(new AuthService() as any);
  const initialUser = {
    id: 'user-1',
    email: 'admin@auralpha.com',
    passwordHash: hashSync('Admin@123', 10),
    fullName: 'AurAlpha Admin',
    role: 'Admin',
    status: 'active',
    lastLoginAt: null,
  };
  const refreshedUser = {
    ...initialUser,
    lastLoginAt: new Date('2026-04-09T09:30:00.000Z'),
  };

  let touchedUserId = '';
  let createdRefreshTokenPayload: Record<string, unknown> | null = null;
  const allowedAttempts: Array<Record<string, unknown>> = [];
  const successfulAttempts: Array<Record<string, unknown>> = [];

  service.authLoginProtectionService = {
    assertLoginAllowed(context: Record<string, unknown>) {
      allowedAttempts.push(context);
    },
    recordLoginFailure() {
      assert.fail('login failure should not be recorded for a successful sign-in');
    },
    recordLoginSuccess(context: Record<string, unknown>) {
      successfulAttempts.push(context);
    }
  };

  service.userRepository = {
    async findByEmail(email: string) {
      assert.equal(email, 'admin@auralpha.com');
      return initialUser;
    },
    async touchLastLogin(userId: string) {
      touchedUserId = userId;
    },
    async findById(userId: string) {
      assert.equal(userId, 'user-1');
      return refreshedUser;
    },
  };
  service.refreshTokenRepository = {
    async createToken(payload: Record<string, unknown>) {
      createdRefreshTokenPayload = payload;
      return { id: 'refresh-1', ...payload };
    },
  };

  const response = await service.login(
    { email: ' Admin@AurAlpha.com ', password: 'Admin@123' },
    {
      headers: { 'user-agent': 'auth-contract-test' },
      ip: '127.0.0.1',
    }
  );

  assert.equal(touchedUserId, 'user-1');
  assert.equal(response.success, true);
  assert.equal(response.data.user.email, 'admin@auralpha.com');
  assert.equal(response.data.user.lastLoginAt, '2026-04-09T09:30:00.000Z');
  assert.match(response.data.refreshToken, /^[0-9a-f]{96}$/);
  assert.ok(createdRefreshTokenPayload, 'refresh token should be persisted');
  assert.equal(
    createdRefreshTokenPayload?.['tokenHash'],
    createAuthTokenHash(response.data.refreshToken)
  );
  assert.equal(createdRefreshTokenPayload?.['userAgent'], 'auth-contract-test');
  assert.equal(createdRefreshTokenPayload?.['ipAddress'], '127.0.0.1');

  const claims = jwt.verify(response.data.accessToken, env.auth.accessTokenSecret) as jwt.JwtPayload;
  assert.equal(claims.sub, 'user-1');
  assert.equal(typeof claims.sid, 'string');
  assert.equal(claims.email, 'admin@auralpha.com');
  assert.equal(claims.role, 'Admin');
  assert.equal(claims.tokenType, 'access');
  assert.deepEqual(allowedAttempts, [
    {
      email: ' Admin@AurAlpha.com ',
      ipAddress: '127.0.0.1'
    }
  ]);
  assert.deepEqual(successfulAttempts, [
    {
      email: 'admin@auralpha.com',
      ipAddress: '127.0.0.1'
    }
  ]);
}

async function runLoginFailureAssertions(): Promise<void> {
  const inactiveService = attachNoopLoginProtection(new AuthService() as any);
  const inactiveFailures: Array<Record<string, unknown>> = [];
  inactiveService.authLoginProtectionService = {
    assertLoginAllowed() {},
    recordLoginSuccess() {
      assert.fail('login success should not be recorded for an inactive user');
    },
    recordLoginFailure(context: Record<string, unknown>) {
      inactiveFailures.push(context);
    }
  };
  inactiveService.userRepository = {
    async findByEmail() {
      return {
        id: 'user-1',
        email: 'admin@auralpha.com',
        passwordHash: hashSync('Admin@123', 10),
        fullName: 'AurAlpha Admin',
        role: 'Admin',
        status: 'disabled',
        lastLoginAt: null,
      };
    },
  };
  inactiveService.refreshTokenRepository = {};

  await expectUnauthorized(
    async () =>
      inactiveService.login(
        { email: 'admin@auralpha.com', password: 'Admin@123' },
        { headers: {}, ip: '127.0.0.1' }
      ),
    'Invalid email or password'
  );
  assert.deepEqual(inactiveFailures, [
    {
      email: 'admin@auralpha.com',
      ipAddress: '127.0.0.1'
    }
  ]);

  const wrongPasswordService = attachNoopLoginProtection(new AuthService() as any);
  const wrongPasswordFailures: Array<Record<string, unknown>> = [];
  wrongPasswordService.authLoginProtectionService = {
    assertLoginAllowed() {},
    recordLoginSuccess() {
      assert.fail('login success should not be recorded for a wrong password');
    },
    recordLoginFailure(context: Record<string, unknown>) {
      wrongPasswordFailures.push(context);
    }
  };
  wrongPasswordService.userRepository = {
    async findByEmail() {
      return {
        id: 'user-1',
        email: 'admin@auralpha.com',
        passwordHash: hashSync('DifferentPassword', 10),
        fullName: 'AurAlpha Admin',
        role: 'Admin',
        status: 'active',
        lastLoginAt: null,
      };
    },
  };
  wrongPasswordService.refreshTokenRepository = {};

  await expectUnauthorized(
    async () =>
      wrongPasswordService.login(
        { email: 'admin@auralpha.com', password: 'Admin@123' },
        { headers: {}, ip: '127.0.0.1' }
      ),
    'Invalid email or password'
  );
  assert.deepEqual(wrongPasswordFailures, [
    {
      email: 'admin@auralpha.com',
      ipAddress: '127.0.0.1'
    }
  ]);
}

async function runLoginProtectionAssertion(): Promise<void> {
  const service = attachNoopLoginProtection(new AuthService() as any);
  let lookedUpUser = false;

  service.authLoginProtectionService = {
    assertLoginAllowed() {
      const error = new Error('Too many login attempts');
      (error as { httpCode?: number }).httpCode = 429;
      throw error;
    },
    recordLoginFailure() {
      assert.fail('controller should not record a failure when the limiter blocks first');
    },
    recordLoginSuccess() {
      assert.fail('controller should not record success when the limiter blocks first');
    }
  };
  service.userRepository = {
    async findByEmail() {
      lookedUpUser = true;
      return null;
    }
  };

  await assert.rejects(
    async () =>
      service.login(
        { email: 'admin@auralpha.com', password: 'Admin@123' },
        { headers: {}, ip: '127.0.0.1' }
      ),
    (error: unknown) =>
      error instanceof Error &&
      (error as { httpCode?: number }).httpCode === 429 &&
      error.message === 'Too many login attempts'
  );

  assert.equal(lookedUpUser, false);
}

async function runRefreshContractAssertions(): Promise<void> {
  const service = attachNoopLoginProtection(new AuthService() as any);
  const existingRefreshToken = 'existing-refresh-token';
  const storedUser = {
    id: 'user-1',
    email: 'admin@auralpha.com',
    fullName: 'AurAlpha Admin',
    role: 'Admin',
    status: 'active',
    lastLoginAt: new Date('2026-04-09T09:30:00.000Z'),
  };

  const revokedIds: string[] = [];
  let createdRefreshTokenPayload: Record<string, unknown> | null = null;

  service.refreshTokenRepository = {
    async findActiveByHash(tokenHash: string) {
      assert.equal(tokenHash, createAuthTokenHash(existingRefreshToken));
      return {
        id: 'refresh-row-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      };
    },
    async revokeById(id: string) {
      revokedIds.push(id);
    },
    async createToken(payload: Record<string, unknown>) {
      createdRefreshTokenPayload = payload;
      return { id: 'refresh-row-2', ...payload };
    },
  };
  service.userRepository = {
    async findById(userId: string) {
      assert.equal(userId, 'user-1');
      return storedUser;
    },
  };

  const response = await service.refresh(
    { refreshToken: existingRefreshToken },
    {
      headers: { 'user-agent': 'refresh-contract-test' },
      ip: '10.0.0.5',
    }
  );

  assert.equal(response.success, true);
  assert.deepEqual(revokedIds, ['refresh-row-1']);
  assert.ok(createdRefreshTokenPayload, 'refresh should rotate the token');
  assert.equal(
    createdRefreshTokenPayload?.['tokenHash'],
    createAuthTokenHash(response.data.refreshToken)
  );
  assert.equal(createdRefreshTokenPayload?.['userAgent'], 'refresh-contract-test');
  assert.equal(createdRefreshTokenPayload?.['ipAddress'], '10.0.0.5');
  assert.notEqual(response.data.refreshToken, existingRefreshToken);
}

async function runRefreshFailureAssertions(): Promise<void> {
  const expiredService = attachNoopLoginProtection(new AuthService() as any);
  const revokedIds: string[] = [];

  expiredService.refreshTokenRepository = {
    async findActiveByHash() {
      return {
        id: 'expired-refresh-row',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 60_000),
      };
    },
    async revokeById(id: string) {
      revokedIds.push(id);
    },
  };
  expiredService.userRepository = {};

  await expectUnauthorized(
    async () =>
      expiredService.refresh(
        { refreshToken: 'expired-token' },
        { headers: {}, ip: '127.0.0.1' }
      ),
    'Refresh token is invalid or expired'
  );
  assert.deepEqual(revokedIds, ['expired-refresh-row']);
}

async function runLogoutAndMeAssertions(): Promise<void> {
  const service = attachNoopLoginProtection(new AuthService() as any);
  let revokedHash = '';
  let revokedCount = 0;

  service.refreshTokenRepository = {
    async revokeByHash(tokenHash: string) {
      revokedHash = tokenHash;
    },
    async listActiveByUserId(userId: string) {
      assert.equal(userId, 'user-1');
      return [
        {
          id: 'session-2',
          userAgent: 'Browser B',
          ipAddress: '10.0.0.7',
          createdAt: new Date('2026-04-11T09:30:00.000Z'),
          expiresAt: new Date('2026-04-18T09:30:00.000Z')
        },
        {
          id: 'session-1',
          userAgent: 'Browser A',
          ipAddress: '10.0.0.5',
          createdAt: new Date('2026-04-10T09:30:00.000Z'),
          expiresAt: new Date('2026-04-17T09:30:00.000Z')
        }
      ];
    },
    async revokeActiveByUserId(userId: string) {
      assert.equal(userId, 'user-1');
      revokedCount = 2;
      return revokedCount;
    }
  };
  service.userRepository = {
    async findById(userId: string) {
      assert.equal(userId, 'user-1');
      return {
        id: 'user-1',
        email: 'admin@auralpha.com',
        fullName: 'AurAlpha Admin',
        role: 'Admin',
        status: 'active',
        lastLoginAt: new Date('2026-04-09T09:30:00.000Z'),
      };
    },
  };

  const logoutResponse = await service.logout({ refreshToken: 'logout-token' });
  assert.deepEqual(logoutResponse, createSuccess({ revoked: true }));
  assert.equal(revokedHash, createAuthTokenHash('logout-token'));

  const meResponse = await service.me({
    authUser: { sub: 'user-1' },
  });
  assert.equal(meResponse.success, true);
  assert.equal(meResponse.data.email, 'admin@auralpha.com');

  const sessionsResponse = await service.listSessions({
    authUser: { sub: 'user-1', sid: 'session-1' }
  });
  assert.deepEqual(sessionsResponse, createSuccess([
    {
      id: 'session-2',
      isCurrent: false,
      userAgent: 'Browser B',
      ipAddress: '10.0.0.7',
      createdAt: '2026-04-11T09:30:00.000Z',
      expiresAt: '2026-04-18T09:30:00.000Z'
    },
    {
      id: 'session-1',
      isCurrent: true,
      userAgent: 'Browser A',
      ipAddress: '10.0.0.5',
      createdAt: '2026-04-10T09:30:00.000Z',
      expiresAt: '2026-04-17T09:30:00.000Z'
    }
  ]));

  const logoutAllResponse = await service.logoutAll({
    authUser: { sub: 'user-1' }
  });
  assert.deepEqual(logoutAllResponse, createSuccess({ revoked: true, count: revokedCount }));

  await expectUnauthorized(async () => service.me({ authUser: undefined }), 'Unauthorized');
  await expectUnauthorized(
    async () => service.listSessions({ authUser: undefined }),
    'Unauthorized'
  );
  await expectUnauthorized(
    async () => service.logoutAll({ authUser: undefined }),
    'Unauthorized'
  );
}

async function runControllerDelegationAssertions(): Promise<void> {
  const controller = new AuthController() as any;

  controller.authService = {
    async login(...args: unknown[]) {
      return createSuccess({ method: 'login', args });
    },
    async refresh(...args: unknown[]) {
      return createSuccess({ method: 'refresh', args });
    },
    async logout(...args: unknown[]) {
      return createSuccess({ method: 'logout', args });
    },
    async listSessions(...args: unknown[]) {
      return createSuccess({ method: 'sessions', args });
    },
    async logoutAll(...args: unknown[]) {
      return createSuccess({ method: 'logout-all', args });
    },
    async me(...args: unknown[]) {
      return createSuccess({ method: 'me', args });
    },
  };

  const request = { authUser: { sub: 'user-1' } };

  assert.deepEqual(
    await controller.login({ email: 'admin@auralpha.com', password: 'Admin@123' }, request),
    createSuccess({
      method: 'login',
      args: [{ email: 'admin@auralpha.com', password: 'Admin@123' }, request],
    })
  );
  assert.deepEqual(
    await controller.refresh({ refreshToken: 'refresh-token' }, request),
    createSuccess({
      method: 'refresh',
      args: [{ refreshToken: 'refresh-token' }, request],
    })
  );
  assert.deepEqual(
    await controller.logout({ refreshToken: 'refresh-token' }),
    createSuccess({
      method: 'logout',
      args: [{ refreshToken: 'refresh-token' }],
    })
  );
  assert.deepEqual(
    await controller.me(request),
    createSuccess({
      method: 'me',
      args: [request],
    })
  );
  assert.deepEqual(
    await controller.sessions(request),
    createSuccess({
      method: 'sessions',
      args: [request]
    })
  );
  assert.deepEqual(
    await controller.logoutAll(request),
    createSuccess({
      method: 'logout-all',
      args: [request]
    })
  );
}

async function runApiKeyMiddlewareAssertions(): Promise<void> {
  const middleware = new ApiKeyMiddleware();
  const originalRequireApiKey = env.app.requireApiKey;

  const callMiddleware = async (request: any) => {
    let nextError: unknown = undefined;

    middleware.use(
      request,
      {} as any,
      (error?: unknown) => {
        nextError = error;
      }
    );

    return nextError;
  };

  const validJwt = jwt.sign(
    {
      sub: 'user-1',
      sid: 'session-1',
      email: 'admin@auralpha.com',
      role: 'Admin',
      tokenType: 'access',
    },
    env.auth.accessTokenSecret,
    { expiresIn: '15m' }
  );

  try {
    const publicRouteError = await callMiddleware({
      path: '/api/v1/auth/login',
      header() {
        return '';
      },
    });
    assert.equal(publicRouteError, undefined);

    const bearerRequest: any = {
      path: '/api/v1/overview',
      header(name: string) {
        return name === 'authorization' ? `Bearer ${validJwt}` : '';
      },
    };
    const bearerError = await callMiddleware(bearerRequest);
    assert.equal(bearerError, undefined);
    assert.equal(bearerRequest.authUser?.sub, 'user-1');
    assert.equal(bearerRequest.authUser?.sid, 'session-1');
    assert.equal(bearerRequest.authUser?.role, 'Admin');

    const apiKeyRequest: any = {
      path: '/api/v1/overview',
      header(name: string) {
        return name === 'x-api-key' ? env.app.apiKey : '';
      },
    };
    const apiKeyError = await callMiddleware(apiKeyRequest);
    assert.equal(apiKeyError, undefined);
    assert.equal(apiKeyRequest.apiKeyAuthenticated, true);

    const invalidBearerError = await callMiddleware({
      path: '/api/v1/overview',
      header(name: string) {
        return name === 'authorization' ? 'Bearer definitely-not-a-valid-token' : '';
      },
    });
    assert.equal((invalidBearerError as { httpCode?: number } | undefined)?.httpCode, 401);
    assert.equal(
      (invalidBearerError as { message?: string } | undefined)?.message,
      'Access token is invalid or expired'
    );

    env.app.requireApiKey = false;
    const anonymousAllowedError = await callMiddleware({
      path: '/api/v1/overview',
      header() {
        return '';
      },
    });
    assert.equal(anonymousAllowedError, undefined);
  } finally {
    env.app.requireApiKey = originalRequireApiKey;
  }
}

async function main(): Promise<void> {
  await runValidatorAssertions();
  await runLoginContractAssertions();
  await runLoginFailureAssertions();
  await runLoginProtectionAssertion();
  await runRefreshContractAssertions();
  await runRefreshFailureAssertions();
  await runLogoutAndMeAssertions();
  await runControllerDelegationAssertions();
  await runApiKeyMiddlewareAssertions();

  console.log('Auth contract assertions passed.');
}

main().catch((error) => {
  console.error('Auth contract assertion failure:', error);
  process.exit(1);
});
