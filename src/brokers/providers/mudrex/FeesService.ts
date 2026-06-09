import { Inject, Service } from 'typedi';
import { ApiSuccessResponse, BadGatewayAppError, MudrexFeeHistoryItem } from '../../../api';
import { successResponse } from '../../../api';
import { BadRequestAppError } from '../../../api/errors/AppError';
import { rethrowMudrexError } from './MudrexErrorMapper';
import { MudrexHttpClient } from './MudrexHttpClient';

export interface MudrexFeeHistoryQuery {
  limit?: string | number;
  offset?: string | number;
}

@Service()
export class FeesService {
  @Inject(() => MudrexHttpClient)
  private mudrexHttpClient!: MudrexHttpClient;

  async getFuturesFeeHistory(
    query: MudrexFeeHistoryQuery = {},
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexFeeHistoryItem[]>> {
    const params = this.validateFeeHistoryQuery(query);

    try {
      const data = await this.fetchFuturesFeeHistory(params, userId, accountId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex fee history service');
    }
  }

  async fetchFuturesFeeHistory(
    query: { limit: number; offset: number },
    userId?: string,
    accountId?: string
  ): Promise<MudrexFeeHistoryItem[]> {
    const payload = await this.mudrexHttpClient.authenticatedGet<MudrexFeeHistoryItem[]>(
      userId,
      accountId,
      '/fapi/v1/futures/fee/history',
      {
        limit: query.limit,
        offset: query.offset,
      }
    );

    if (!Array.isArray(payload)) {
      throw new BadGatewayAppError('Mudrex returned an invalid fee history payload');
    }

    return payload;
  }

  private validateFeeHistoryQuery(query: MudrexFeeHistoryQuery): { limit: number; offset: number } {
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);

    if (!Number.isInteger(limit) || limit <= 0 || limit > 50000) {
      throw new BadRequestAppError('limit must be an integer between 1 and 50000');
    }

    if (!Number.isInteger(offset) || offset < 0) {
      throw new BadRequestAppError('offset must be a non-negative integer');
    }

    return { limit, offset };
  }
}
