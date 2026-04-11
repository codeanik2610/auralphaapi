import { Request, Response } from 'express';
import { ExpressErrorMiddlewareInterface, HttpError, Middleware } from 'routing-controllers';
import { Service } from 'typedi';
import { ApiErrorResponse } from '../contracts/ApiResponse';
import { Logger } from '../../lib/logger';

const log = new Logger(__filename);

interface HttpErrorLike {
  httpCode: number;
  message: string;
  code?: string;
}

const isHttpErrorLike = (error: unknown): error is HttpErrorLike => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const value = error as Record<string, unknown>;
  return typeof value.httpCode === 'number' && typeof value.message === 'string';
};

@Middleware({ type: 'after' })
@Service()
export class ErrorHandlerMiddleware implements ExpressErrorMiddlewareInterface {
  error(error: unknown, request: Request, response: Response): void {
    if (response.headersSent) {
      return;
    }

    const statusCode =
      error instanceof HttpError ? error.httpCode : isHttpErrorLike(error) ? error.httpCode : 500;
    const message =
      (error instanceof HttpError || isHttpErrorLike(error)) && statusCode < 500
        ? error.message
        : 'Internal server error';

    if (statusCode >= 500) {
      log.error(
        `Unhandled error on ${request.method} ${request.originalUrl}: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }`
      );
    } else {
      log.warn(`Request failed ${request.method} ${request.originalUrl}: ${message}`);
    }

    const payload: ApiErrorResponse = {
      statusCode,
      ...(typeof (error as { code?: unknown })?.code === 'string'
        ? { code: String((error as { code?: string }).code) }
        : {}),
      message,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    response.status(statusCode).json(payload);
  }
}
