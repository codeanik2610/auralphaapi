import { Body, Get, JsonController, Param, Patch, Post, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { MudrexPositionMarginUpdate, MudrexPositionRiskOrder } from '../contracts/Mudrex';
import {
  PositionLifecycleResponse,
  PositionRecord,
  PositionsGroupedResponse,
  PositionsRefreshRequestResponse,
  PositionsSyncStatusResponse,
} from '../contracts/Positions';
import {
  AddMarginBody,
  ClosePartialPositionBody,
  CreateRiskOrderBody,
  PositionLiqPriceQuery,
  PositionsHistoryQuery,
  PositionsQuery,
  PositionsRefreshBody,
  UpdateRiskOrderBody,
} from '../validators/positions.validator';
import { BrokerPositionsFacadeService } from '../services/BrokerPositionsFacadeService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/positions')
@Service()
export class PositionsController {
  @Inject(() => BrokerPositionsFacadeService)
  private positionsService!: BrokerPositionsFacadeService;

  @Get('/futures')
  async getFuturesPositions(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string
  ): Promise<ApiSuccessResponse<PositionRecord[]>> {
    const query: PositionsQuery = { limit, brokerKey, accountId };
    return this.positionsService.getFuturesPositions(requireAuthUserId(request), brokerKey, accountId, query) as unknown as Promise<ApiSuccessResponse<PositionRecord[]>>;
  }

  @Get('/futures/active')
  async getFuturesPositionsForActiveAccounts(@Req() request: Request, @QueryParam('brokerKey') brokerKey?: string): Promise<ApiSuccessResponse<PositionsGroupedResponse>> {
    return this.positionsService.getFuturesPositionsForActiveAccounts(requireAuthUserId(request), brokerKey) as unknown as Promise<ApiSuccessResponse<PositionsGroupedResponse>>;
  }

  @Post('/futures/refresh')
  async requestFuturesPositionsRefresh(
    @Req() request: Request,
    @Body() body: PositionsRefreshBody = {}
  ): Promise<ApiSuccessResponse<PositionsRefreshRequestResponse>> {
    return this.positionsService.requestPositionsRefresh(
      requireAuthUserId(request),
      body
    ) as unknown as Promise<ApiSuccessResponse<PositionsRefreshRequestResponse>>;
  }

  @Get('/futures/sync-status')
  async getFuturesPositionsSyncStatus(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string
  ): Promise<ApiSuccessResponse<PositionsSyncStatusResponse>> {
    return this.positionsService.getPositionsSyncStatus(
      requireAuthUserId(request),
      { brokerKey, accountId }
    ) as unknown as Promise<ApiSuccessResponse<PositionsSyncStatusResponse>>;
  }

  @Get('/futures/:positionId/lifecycle')
  async getPositionLifecycle(
    @Req() request: Request,
    @Param('positionId') positionId: string,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string
  ): Promise<ApiSuccessResponse<PositionLifecycleResponse>> {
    return this.positionsService.getPositionLifecycle(
      requireAuthUserId(request),
      positionId,
      brokerKey,
      accountId
    ) as unknown as Promise<ApiSuccessResponse<PositionLifecycleResponse>>;
  }

  @Get('/futures/:positionId/liq-price')
  async getPositionLiquidationPrice(@Req() request: Request, @Param('positionId') positionId: string, @QueryParam('ext_margin') ext_margin?: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string): Promise<ApiSuccessResponse<string>> {
    const query: PositionLiqPriceQuery = { ext_margin, brokerKey, accountId };
    return this.positionsService.getPositionLiquidationPrice(positionId, query, requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<string>>;
  }

  @Post('/futures/:positionId/add-margin')
  async addPositionMargin(@Req() request: Request, @Param('positionId') positionId: string, @QueryParam('brokerKey') brokerKey: string | undefined, @QueryParam('accountId') accountId: string | undefined, @Body() body: AddMarginBody): Promise<ApiSuccessResponse<MudrexPositionMarginUpdate>> {
    return this.positionsService.addPositionMargin(positionId, body, requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<MudrexPositionMarginUpdate>>;
  }

  @Post('/futures/:positionId/riskorder')
  async createPositionRiskOrder(@Req() request: Request, @Param('positionId') positionId: string, @QueryParam('brokerKey') brokerKey: string | undefined, @QueryParam('accountId') accountId: string | undefined, @Body() body: CreateRiskOrderBody): Promise<ApiSuccessResponse<MudrexPositionRiskOrder>> {
    return this.positionsService.createPositionRiskOrder(positionId, body, requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<MudrexPositionRiskOrder>>;
  }

  @Patch('/futures/:positionId/riskorder')
  async updatePositionRiskOrder(@Req() request: Request, @Param('positionId') positionId: string, @QueryParam('brokerKey') brokerKey: string | undefined, @QueryParam('accountId') accountId: string | undefined, @Body() body: UpdateRiskOrderBody): Promise<ApiSuccessResponse<MudrexPositionRiskOrder>> {
    return this.positionsService.updatePositionRiskOrder(positionId, body, requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<MudrexPositionRiskOrder>>;
  }

  @Post('/futures/:positionId/reverse')
  async reversePosition(@Req() request: Request, @Param('positionId') positionId: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string): Promise<ApiSuccessResponse<MudrexPositionRiskOrder>> {
    return this.positionsService.reversePosition(positionId, requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<MudrexPositionRiskOrder>>;
  }

  @Post('/futures/:positionId/close/partial')
  async closePositionPartial(@Req() request: Request, @Param('positionId') positionId: string, @QueryParam('brokerKey') brokerKey: string | undefined, @QueryParam('accountId') accountId: string | undefined, @Body() body: ClosePartialPositionBody): Promise<ApiSuccessResponse<boolean>> {
    return this.positionsService.closePositionPartial(positionId, body, requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<boolean>>;
  }

  @Post('/futures/:positionId/close')
  async closePosition(@Req() request: Request, @Param('positionId') positionId: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string): Promise<ApiSuccessResponse<MudrexPositionRiskOrder>> {
    return this.positionsService.closePosition(positionId, requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<MudrexPositionRiskOrder>>;
  }

  @Get('/futures/history')
  async getPositionHistory(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string, @QueryParam('startDate') startDate?: string, @QueryParam('endDate') endDate?: string): Promise<ApiSuccessResponse<PositionRecord[]>> {
    const query: PositionsHistoryQuery = { limit, brokerKey, accountId, startDate, endDate };
    return this.positionsService.getPositionHistory(query, requireAuthUserId(request), brokerKey, accountId) as unknown as Promise<ApiSuccessResponse<PositionRecord[]>>;
  }

  @Get('/futures/history/active')
  async getPositionHistoryForActiveAccounts(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('startDate') startDate?: string, @QueryParam('endDate') endDate?: string): Promise<ApiSuccessResponse<PositionsGroupedResponse>> {
    const query: PositionsHistoryQuery = { limit, brokerKey, startDate, endDate };
    return this.positionsService.getPositionHistoryForActiveAccounts(query, requireAuthUserId(request), brokerKey) as unknown as Promise<ApiSuccessResponse<PositionsGroupedResponse>>;
  }
}
