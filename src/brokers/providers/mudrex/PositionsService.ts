import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../../../api';
import {
  MudrexPosition,
  MudrexPositionHistoryItem,
  MudrexPositionLiqPrice,
  MudrexPositionMarginUpdate,
  MudrexPositionRiskOrder,
} from '../../../api';
import { BadGatewayAppError } from '../../../api';
import { successResponse } from '../../../api';
import {
  AddMarginBody,
  ClosePartialPositionBody,
  CreateRiskOrderBody,
  PositionLiqPriceQuery,
  PositionsHistoryQuery,
  UpdateRiskOrderBody,
  validateAddMarginBody,
  validateClosePartialPositionBody,
  validateCreateRiskOrderBody,
  validatePositionId,
  validatePositionLiqPriceQuery,
  validatePositionsHistoryQuery,
  validateUpdateRiskOrderBody,
} from '../../../api/validators/positions.validator';
import { rethrowMudrexError } from './MudrexErrorMapper';
import { MudrexHttpClient } from './MudrexHttpClient';

@Service()
export class PositionsService {
  @Inject(() => MudrexHttpClient)
  private mudrexHttpClient!: MudrexHttpClient;

  async getFuturesPositions(
    query: { limit?: number } = {},
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexPosition[]>> {
    try {
      const data = await this.fetchFuturesPositions(userId, accountId, query.limit);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex positions service');
    }
  }

  async getPositionLiquidationPrice(
    positionId: string,
    query: PositionLiqPriceQuery,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<string>> {
    const validatedPositionId = validatePositionId(positionId);
    const validatedQuery = validatePositionLiqPriceQuery(query);

    try {
      const data = await this.fetchPositionLiquidationPrice(
        validatedPositionId,
        validatedQuery,
        userId,
        accountId
      );
      return successResponse(data.value);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex position liquidation price service');
    }
  }

  async addPositionMargin(
    positionId: string,
    body: AddMarginBody,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexPositionMarginUpdate>> {
    const validatedPositionId = validatePositionId(positionId);
    const validatedBody = validateAddMarginBody(body);

    try {
      const data = await this.postAddPositionMargin(
        validatedPositionId,
        validatedBody,
        userId,
        accountId
      );
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex position add margin service');
    }
  }

  async createPositionRiskOrder(
    positionId: string,
    body: CreateRiskOrderBody,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexPositionRiskOrder>> {
    const validatedPositionId = validatePositionId(positionId);
    const validatedBody = validateCreateRiskOrderBody(body);

    try {
      const data = await this.postCreatePositionRiskOrder(
        validatedPositionId,
        validatedBody,
        userId,
        accountId
      );
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex position risk order service');
    }
  }

  async updatePositionRiskOrder(
    positionId: string,
    body: UpdateRiskOrderBody,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexPositionRiskOrder>> {
    const validatedPositionId = validatePositionId(positionId);
    const validatedBody = validateUpdateRiskOrderBody(body);

    try {
      const data = await this.patchPositionRiskOrder(
        validatedPositionId,
        validatedBody,
        userId,
        accountId
      );
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex position risk order update service');
    }
  }

  async reversePosition(
    positionId: string,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexPositionRiskOrder>> {
    const validatedPositionId = validatePositionId(positionId);

    try {
      const data = await this.postReversePosition(validatedPositionId, userId, accountId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex position reverse service');
    }
  }

  async closePositionPartial(
    positionId: string,
    body: ClosePartialPositionBody,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<boolean>> {
    const validatedPositionId = validatePositionId(positionId);
    const validatedBody = validateClosePartialPositionBody(body);

    try {
      const data = await this.postClosePositionPartial(
        validatedPositionId,
        validatedBody,
        userId,
        accountId
      );
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex position partial close service');
    }
  }

  async closePosition(
    positionId: string,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexPositionRiskOrder>> {
    const validatedPositionId = validatePositionId(positionId);

    try {
      const data = await this.postClosePosition(validatedPositionId, userId, accountId);
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex position close service');
    }
  }

  async getPositionHistory(
    query: PositionsHistoryQuery,
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexPositionHistoryItem[]>> {
    const validatedQuery = validatePositionsHistoryQuery(query);

    try {
      const data = await this.fetchPositionHistory(
        validatedQuery.limit,
        validatedQuery.startDate,
        validatedQuery.endDate,
        userId,
        accountId
      );
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex position history service');
    }
  }

  private async fetchFuturesPositions(
    userId?: string,
    accountId?: string,
    limit?: number
  ): Promise<MudrexPosition[]> {
    const payload = await this.mudrexHttpClient.authenticatedGet<MudrexPosition[] | null>(
      userId,
      accountId,
      '/fapi/v1/futures/positions',
      {
        ...(Number.isFinite(limit) && (limit as number) > 0 ? { limit } : {}),
      }
    );

    if (payload === null) {
      return [];
    }

    if (!Array.isArray(payload)) {
      throw new BadGatewayAppError('Mudrex returned an invalid futures positions payload');
    }

    return payload;
  }

  private async fetchPositionLiquidationPrice(
    positionId: string,
    query: { ext_margin: number },
    userId?: string,
    accountId?: string
  ): Promise<MudrexPositionLiqPrice> {
    const payload = await this.mudrexHttpClient.authenticatedGet<string>(
      userId,
      accountId,
      `/fapi/v1/futures/positions/${encodeURIComponent(positionId)}/liq-price`,
      query
    );

    if (typeof payload !== 'string') {
      throw new BadGatewayAppError('Mudrex returned an invalid position liquidation price payload');
    }

    return { value: payload };
  }

  private async postAddPositionMargin(
    positionId: string,
    body: { margin: number },
    userId?: string,
    accountId?: string
  ): Promise<MudrexPositionMarginUpdate> {
    const payload = await this.mudrexHttpClient.authenticatedPost<MudrexPositionMarginUpdate>(
      userId,
      accountId,
      `/fapi/v1/futures/positions/${encodeURIComponent(positionId)}/add-margin`,
      body
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid add margin payload');
    }

    return payload;
  }

  private async postCreatePositionRiskOrder(
    positionId: string,
    body: Required<CreateRiskOrderBody>,
    userId?: string,
    accountId?: string
  ): Promise<MudrexPositionRiskOrder> {
    const payload = await this.mudrexHttpClient.authenticatedPost<MudrexPositionRiskOrder>(
      userId,
      accountId,
      `/fapi/v1/futures/positions/${encodeURIComponent(positionId)}/riskorder`,
      body
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid risk order payload');
    }

    return payload;
  }

  private async patchPositionRiskOrder(
    positionId: string,
    body: Required<UpdateRiskOrderBody>,
    userId?: string,
    accountId?: string
  ): Promise<MudrexPositionRiskOrder> {
    const payload = await this.mudrexHttpClient.authenticatedPatch<MudrexPositionRiskOrder>(
      userId,
      accountId,
      `/fapi/v1/futures/positions/${encodeURIComponent(positionId)}/riskorder`,
      body
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid risk order update payload');
    }

    return payload;
  }

  private async postReversePosition(
    positionId: string,
    userId?: string,
    accountId?: string
  ): Promise<MudrexPositionRiskOrder> {
    const payload = await this.mudrexHttpClient.authenticatedPost<MudrexPositionRiskOrder>(
      userId,
      accountId,
      `/fapi/v1/futures/positions/${encodeURIComponent(positionId)}/reverse`
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid reverse position payload');
    }

    return payload;
  }

  private async postClosePositionPartial(
    positionId: string,
    body: Required<ClosePartialPositionBody>,
    userId?: string,
    accountId?: string
  ): Promise<boolean> {
    const payload = await this.mudrexHttpClient.authenticatedPost<boolean>(
      userId,
      accountId,
      `/fapi/v1/futures/positions/${encodeURIComponent(positionId)}/close/partial`,
      body
    );

    if (typeof payload !== 'boolean') {
      throw new BadGatewayAppError('Mudrex returned an invalid partial close payload');
    }

    return payload;
  }

  private async postClosePosition(
    positionId: string,
    userId?: string,
    accountId?: string
  ): Promise<MudrexPositionRiskOrder> {
    const payload = await this.mudrexHttpClient.authenticatedPost<MudrexPositionRiskOrder>(
      userId,
      accountId,
      `/fapi/v1/futures/positions/${encodeURIComponent(positionId)}/close`
    );

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayAppError('Mudrex returned an invalid close position payload');
    }

    return payload;
  }

  private async fetchPositionHistory(
    limit: number,
    startDate?: string,
    endDate?: string,
    userId?: string,
    accountId?: string
  ): Promise<MudrexPositionHistoryItem[]> {
    const payload = await this.mudrexHttpClient.authenticatedGet<MudrexPositionHistoryItem[]>(
      userId,
      accountId,
      '/fapi/v1/futures/positions/history',
      {
        limit,
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {}),
      }
    );

    if (!Array.isArray(payload)) {
      throw new BadGatewayAppError('Mudrex returned an invalid position history payload');
    }

    return this.filterPositionHistoryByDateWindow(payload, startDate, endDate).slice(0, limit);
  }

  private filterPositionHistoryByDateWindow(
    items: MudrexPositionHistoryItem[],
    startDate?: string,
    endDate?: string
  ): MudrexPositionHistoryItem[] {
    const startMs = startDate ? Date.parse(`${startDate}T00:00:00.000Z`) : null;
    const endMs = endDate ? Date.parse(`${endDate}T23:59:59.999Z`) : null;
    if (startMs === null && endMs === null) {
      return items;
    }

    return items.filter((item) => {
      const positionMs = this.readPositionHistoryTimestampMs(item);
      if (!Number.isFinite(positionMs)) {
        return false;
      }
      if (startMs !== null && positionMs < startMs) {
        return false;
      }
      if (endMs !== null && positionMs > endMs) {
        return false;
      }
      return true;
    });
  }

  private readPositionHistoryTimestampMs(item: MudrexPositionHistoryItem): number {
    const payload = item as MudrexPositionHistoryItem & {
      closed_at?: string;
      closedAt?: string;
      updatedAt?: string;
      createdAt?: string;
    };
    for (const value of [
      payload.closed_at,
      payload.closedAt,
      payload.updated_at,
      payload.updatedAt,
      payload.created_at,
      payload.createdAt,
    ]) {
      const raw = String(value ?? '').trim();
      if (!raw) {
        continue;
      }
      const timestamp = Date.parse(raw);
      if (Number.isFinite(timestamp)) {
        return timestamp;
      }
    }
    return Number.NaN;
  }
}
