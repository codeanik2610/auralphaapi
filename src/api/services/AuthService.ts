import { createHash, randomBytes } from 'crypto';
import { compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { env } from '../../env';
import { UnauthorizedAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  AuthSessionResponse,
  AuthTokensResponse,
  AuthUserResponse,
  LogoutAllSessionsResponse
} from '../contracts/Auth';
import { validateLoginBody, validateLogoutBody, validateRefreshBody } from '../validators/auth.validator';
import { UserRepository } from '../../database';
import { RefreshTokenRepository } from '../../database';
import { AuthLoginProtectionService } from './AuthLoginProtectionService';

type JwtClaims = {
  sub: string;
  sid: string;
  email: string;
  role: string;
  tokenType: 'access';
};

@Service()
export class AuthService {
  @Inject(() => UserRepository)
  private userRepository!: UserRepository;

  @Inject(() => RefreshTokenRepository)
  private refreshTokenRepository!: RefreshTokenRepository;

  @Inject(() => AuthLoginProtectionService)
  private authLoginProtectionService!: AuthLoginProtectionService;

  private mapUser(user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    status: string;
    lastLoginAt: Date | null;
  }): AuthUserResponse {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    };
  }

  private mapSession(
    session: {
    id: string;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: Date;
    expiresAt: Date;
    },
    currentSessionId = ''
  ): AuthSessionResponse {
    return {
      id: session.id,
      isCurrent: session.id === currentSessionId,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString()
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signAccessToken(user: AuthUserResponse, sessionId: string): string {
    return jwt.sign(
      {
        sub: user.id,
        sid: sessionId,
        email: user.email,
        role: user.role,
        tokenType: 'access',
      } satisfies JwtClaims,
      env.auth.accessTokenSecret,
      {
        expiresIn: env.auth.accessTokenTtl as jwt.SignOptions['expiresIn'],
      }
    );
  }

  private async issueSession(
    user: AuthUserResponse,
    request?: Pick<Request, 'headers' | 'ip'>
  ): Promise<AuthTokensResponse> {
    const refreshToken = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + env.auth.refreshTokenDays * 24 * 60 * 60 * 1000);
    const createdSession = await this.refreshTokenRepository.createToken({
      userId: user.id,
      tokenHash: this.hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: request?.headers['user-agent'] || null,
      ipAddress: request?.ip || null,
    });
    const accessToken = this.signAccessToken(user, createdSession.id);

    return {
      accessToken,
      refreshToken,
      user,
    };
  }

  async login(body: { email?: string; password?: string }, request: Request): Promise<ApiSuccessResponse<AuthTokensResponse>> {
    const attemptContext = {
      email: body?.email,
      ipAddress: request.ip
    };

    this.authLoginProtectionService.assertLoginAllowed(attemptContext);

    let normalizedEmail = attemptContext.email;

    try {
      const { email, password } = validateLoginBody(body);
      normalizedEmail = email;
      const user = await this.userRepository.findByEmail(email);

      if (!user || user.status !== 'active') {
        throw new UnauthorizedAppError('Invalid email or password');
      }

      const matches = await compare(password, user.passwordHash);
      if (!matches) {
        throw new UnauthorizedAppError('Invalid email or password');
      }

      await this.userRepository.touchLastLogin(user.id);
      const refreshedUser = (await this.userRepository.findById(user.id)) || user;
      this.authLoginProtectionService.recordLoginSuccess({
        email: normalizedEmail,
        ipAddress: request.ip
      });
      return successResponse(await this.issueSession(this.mapUser(refreshedUser), request));
    } catch (error) {
      const statusCode = Number((error as { httpCode?: number } | undefined)?.httpCode);
      if (statusCode === 400 || statusCode === 401) {
        this.authLoginProtectionService.recordLoginFailure({
          email: normalizedEmail,
          ipAddress: request.ip
        });
      }

      throw error;
    }
  }

  async refresh(body: { refreshToken?: string }, request: Request): Promise<ApiSuccessResponse<AuthTokensResponse>> {
    const refreshToken = validateRefreshBody(body);
    const tokenHash = this.hashRefreshToken(refreshToken);
    const storedToken = await this.refreshTokenRepository.findActiveByHash(tokenHash);

    if (!storedToken || storedToken.expiresAt.getTime() <= Date.now()) {
      if (storedToken) {
        await this.refreshTokenRepository.revokeById(storedToken.id);
      }
      throw new UnauthorizedAppError('Refresh token is invalid or expired');
    }

    const user = await this.userRepository.findById(storedToken.userId);
    if (!user || user.status !== 'active') {
      await this.refreshTokenRepository.revokeById(storedToken.id);
      throw new UnauthorizedAppError('Refresh token is invalid or expired');
    }

    await this.refreshTokenRepository.revokeById(storedToken.id);
    return successResponse(await this.issueSession(this.mapUser(user), request));
  }

  async logout(body: { refreshToken?: string }): Promise<ApiSuccessResponse<{ revoked: true }>> {
    const refreshToken = validateLogoutBody(body);
    await this.refreshTokenRepository.revokeByHash(this.hashRefreshToken(refreshToken));
    return successResponse({ revoked: true });
  }

  async listSessions(request: Request): Promise<ApiSuccessResponse<AuthSessionResponse[]>> {
    const authUser = request.authUser;
    if (!authUser?.sub) {
      throw new UnauthorizedAppError();
    }

    const sessions = await this.refreshTokenRepository.listActiveByUserId(authUser.sub);
    return successResponse(
      sessions.map((session) => this.mapSession(session, authUser.sid || ''))
    );
  }

  async logoutAll(request: Request): Promise<ApiSuccessResponse<LogoutAllSessionsResponse>> {
    const authUser = request.authUser;
    if (!authUser?.sub) {
      throw new UnauthorizedAppError();
    }

    const count = await this.refreshTokenRepository.revokeActiveByUserId(authUser.sub);
    return successResponse({ revoked: true, count });
  }

  async me(request: Request): Promise<ApiSuccessResponse<AuthUserResponse>> {
    const authUser = request.authUser;
    if (!authUser?.sub) {
      throw new UnauthorizedAppError();
    }

    const user = await this.userRepository.findById(authUser.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedAppError();
    }

    return successResponse(this.mapUser(user));
  }
}
