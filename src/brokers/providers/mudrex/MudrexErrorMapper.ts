import {
  BadRequestAppError,
  BadGatewayAppError,
  NotFoundAppError,
  RateLimitAppError,
  ServiceUnavailableAppError,
  UnauthorizedAppError,
} from '../../../api';
import { MudrexApiError, MudrexConfigurationError } from './MudrexHttpClient';

export const rethrowMudrexError = (error: unknown, serviceName: string): never => {
  if (error instanceof MudrexConfigurationError) {
    throw new ServiceUnavailableAppError(`${serviceName} is not configured`);
  }

  if (error instanceof MudrexApiError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      throw new UnauthorizedAppError(error.message);
    }

    if (error.statusCode === 400) {
      throw new BadRequestAppError(error.message);
    }

    if (error.statusCode === 429) {
      throw new RateLimitAppError(error.message);
    }

    if (error.statusCode === 404) {
      throw new NotFoundAppError(error.message);
    }

    if (error.statusCode === 502) {
      throw new BadGatewayAppError(error.message);
    }

    throw new ServiceUnavailableAppError(error.message);
  }

  throw error;
};
