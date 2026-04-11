import { HttpError } from 'routing-controllers';

export class AppError extends HttpError {
  code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(statusCode, message);
    this.code = code;
  }
}

export class BadRequestAppError extends AppError {
  constructor(message: string, code?: string) {
    super(400, message, code);
  }
}

export class UnauthorizedAppError extends AppError {
  constructor(message = 'Unauthorized', code?: string) {
    super(401, message, code);
  }
}

export class ForbiddenAppError extends AppError {
  constructor(message = 'Forbidden', code?: string) {
    super(403, message, code);
  }
}

export class ConflictAppError extends AppError {
  constructor(message: string, code?: string) {
    super(409, message, code);
  }
}

export class RateLimitAppError extends AppError {
  constructor(message: string, code?: string) {
    super(429, message, code);
  }
}

export class BadGatewayAppError extends AppError {
  constructor(message: string, code?: string) {
    super(502, message, code);
  }
}

export class NotFoundAppError extends AppError {
  constructor(message: string, code?: string) {
    super(404, message, code);
  }
}

export class ServiceUnavailableAppError extends AppError {
  constructor(message: string, code?: string) {
    super(503, message, code);
  }
}
