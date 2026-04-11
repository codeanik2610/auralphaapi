import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ExpressMiddlewareInterface, Middleware } from 'routing-controllers';
import { Service } from 'typedi';
import { UnauthorizedAppError } from '../errors/AppError';
import { env } from '../../env';

@Middleware({ type: 'before' })
@Service()
export class ApiKeyMiddleware implements ExpressMiddlewareInterface {
  use(request: Request, _response: Response, next: NextFunction): void {
    const healthPrefix = `${env.app.routePrefix}/health`;
    const publicHealthPaths = new Set([
      '/health',
      '/health/queue',
      '/health/worker',
      '/health/ops',
      healthPrefix,
      `${healthPrefix}/queue`,
      `${healthPrefix}/worker`,
      `${healthPrefix}/ops`,
    ]);
    const isPublicHealthRoute = publicHealthPaths.has(request.path);
    const publicPaths = new Set([
      `${env.app.routePrefix}/auth/login`,
      '/auth/login',
      `${env.app.routePrefix}/auth/refresh`,
      '/auth/refresh',
    ]);

    if (isPublicHealthRoute || publicPaths.has(request.path)) {
      next();
      return;
    }

    const authorization = request.header('authorization') || '';
    const bearerToken = authorization.replace(/^Bearer\s+/i, '').trim();
    const headerApiKey = request.header('x-api-key');
    const providedKey = headerApiKey || bearerToken;
    const requestWithApiKey = request as Request & { apiKeyAuthenticated?: boolean };

    if (bearerToken && bearerToken !== env.app.apiKey) {
      try {
        request.authUser = jwt.verify(bearerToken, env.auth.accessTokenSecret) as Request['authUser'];
        next();
        return;
      } catch {
        next(new UnauthorizedAppError('Access token is invalid or expired'));
        return;
      }
    }

    if (env.app.apiKey && providedKey === env.app.apiKey) {
      requestWithApiKey.apiKeyAuthenticated = true;
      next();
      return;
    }

    if (!env.app.requireApiKey) {
      next();
      return;
    }

    if (!env.app.apiKey || providedKey !== env.app.apiKey) {
      next(new UnauthorizedAppError());
      return;
    }

    next();
  }
}
