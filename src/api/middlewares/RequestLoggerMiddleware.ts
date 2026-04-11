import { NextFunction, Request, Response } from 'express';
import { ExpressMiddlewareInterface, Middleware } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { Logger } from '../../lib/logger';
import { OperationalEventService } from '../services/OperationalEventService';
import { env } from '../../env';

const log = new Logger(__filename);

@Middleware({ type: 'before' })
@Service()
export class RequestLoggerMiddleware implements ExpressMiddlewareInterface {
  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = Date.now();

    response.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      log.info(`${request.method} ${request.originalUrl} ${response.statusCode} - ${durationMs}ms`);
      void this.captureOperationalEvents(request, response.statusCode, durationMs);
    });

    next();
  }

  private async captureOperationalEvents(
    request: Request,
    statusCode: number,
    durationMs: number
  ): Promise<void> {
    try {
      const method = request.method.toUpperCase();
      const originalUrl = request.originalUrl || request.url || '';
      const path = originalUrl.split('?')[0] || originalUrl;

      if (!env.observability.autoCaptureEnabled) {
        return;
      }

      if (!path.startsWith(env.app.routePrefix)) {
        return;
      }

      if (this.isExcludedPath(path, method)) {
        return;
      }

      const userId = request.authUser?.sub;
      if (!userId) {
        return;
      }

      const source = path
        .replace(/^\/+/, '')
        .replace(/[/:]/g, '.')
        .slice(0, 100);
      const status = statusCode >= 400 ? 'Failed' : 'Success';
      const route = this.resolveRoute(path);
      const stream = this.resolveStream(path, method);
      const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);

      if (!env.observability.captureReadRequests && isRead) {
        return;
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'API request',
        title: `${method} ${path}`,
        status,
        route,
        stream,
        related: source,
        description: `HTTP ${statusCode} in ${durationMs}ms`,
      });

      if (
        env.observability.emitFailureAlerts &&
        env.observability.emit5xxAlerts &&
        statusCode >= 500
      ) {
        await this.operationalEventService.emitFailureAlert(userId, {
          channel: 'API',
          source: source || 'api',
          message: `${method} ${path} failed with HTTP ${statusCode}`,
          route: 'Risk review',
          severity: 'High',
          symbol: 'SYSTEM',
          urgency: 'Immediate',
        });
      } else if (
        env.observability.emitFailureAlerts &&
        env.observability.emit4xxMutationAlerts &&
        statusCode >= 400 &&
        !isRead
      ) {
        await this.operationalEventService.emitFailureAlert(userId, {
          channel: 'API',
          source: source || 'api',
          message: `${method} ${path} failed with HTTP ${statusCode}`,
          route: 'Risk review',
          severity: 'Medium',
          symbol: 'SYSTEM',
          urgency: 'Soon',
        });
      }
    } catch {
      // Keep primary request flow non-blocking.
    }
  }

  private isExcludedPath(path: string, method: string): boolean {
    if (path.startsWith(`${env.app.routePrefix}/health`)) {
      return true;
    }
    if (path.startsWith(`${env.app.routePrefix}/auth/`)) {
      return true;
    }

    // Avoid noisy self-observability loops from alerts/activity list polling.
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(method) &&
      (path.startsWith(`${env.app.routePrefix}/alerts`) ||
        path.startsWith(`${env.app.routePrefix}/activity`))
    ) {
      return true;
    }

    return false;
  }

  private resolveRoute(path: string): string {
    if (path.includes('/scheduler')) return 'Schedulers';
    if (path.includes('/alert')) return 'Alerts';
    if (path.includes('/activity')) return 'Activity';
    if (path.includes('/broker') || path.includes('/connection')) return 'Brokers data';
    if (path.includes('/order')) return 'Orders';
    if (path.includes('/position')) return 'Positions';
    if (path.includes('/portfolio')) return 'Portfolio';
    if (path.includes('/watchlist')) return 'Watchlists';
    if (path.includes('/automation')) return 'Automations';
    if (path.includes('/backtest')) return 'Backtests';
    if (path.includes('/strategy-lab')) return 'Strategy Lab';
    if (path.includes('/strategy-library')) return 'Strategy Library';
    if (path.includes('/strategy-templates')) return 'Strategy Templates';
    if (path.includes('/strategy')) return 'Strategy';
    if (path.includes('/signal')) return 'Signals';
    if (path.includes('/asset') || path.includes('/market') || path.includes('/wallet')) return 'Market data';
    if (path.includes('/risk')) return 'Risk';
    if (path.includes('/settings')) return 'Settings';
    return 'API';
  }

  private resolveStream(path: string, method: string): string {
    if (path.includes('/scheduler') || path.includes('/automation')) {
      return 'Automation';
    }
    if (path.includes('/order') || path.includes('/position') || path.includes('/risk')) {
      return 'Execution';
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return 'Execution';
    }
    return 'Controls';
  }
}
