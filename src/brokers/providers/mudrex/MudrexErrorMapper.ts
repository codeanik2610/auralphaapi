import {
  BadRequestAppError,
  BadGatewayAppError,
  NotFoundAppError,
  RateLimitAppError,
  ServiceUnavailableAppError,
  UnauthorizedAppError,
} from '../../../api';
import { MudrexApiError, MudrexConfigurationError } from './MudrexHttpClient';

const attachMudrexBrokerContext = <T extends Error>(
  target: T,
  error: MudrexApiError
): T => {
  Object.assign(target, {
    broker: error.broker,
    brokerStatusCode: error.brokerStatusCode,
    brokerRoutePath: error.brokerRoutePath,
    brokerErrorCode: error.brokerErrorCode,
    brokerErrorMessage: error.brokerErrorMessage ?? error.message,
    brokerErrorPayload: error.brokerErrorPayload,
  });
  return target;
};

export const rethrowMudrexError = (error: unknown, serviceName: string): never => {
  if (error instanceof MudrexConfigurationError) {
    throw new ServiceUnavailableAppError(`${serviceName} is not configured`);
  }

  if (error instanceof MudrexApiError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      throw attachMudrexBrokerContext(new UnauthorizedAppError(error.message), error);
    }

    if (error.statusCode === 400) {
      throw attachMudrexBrokerContext(new BadRequestAppError(error.message), error);
    }

    if (error.statusCode === 429) {
      throw attachMudrexBrokerContext(new RateLimitAppError(error.message), error);
    }

    if (error.statusCode === 404) {
      throw attachMudrexBrokerContext(new NotFoundAppError(error.message), error);
    }

    if (error.statusCode === 502) {
      throw attachMudrexBrokerContext(new BadGatewayAppError(error.message), error);
    }

    throw attachMudrexBrokerContext(new ServiceUnavailableAppError(error.message), error);
  }

  throw error;
};
