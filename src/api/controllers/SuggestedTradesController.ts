import { Request } from 'express';
import { Body, Get, JsonController, Param, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { ServiceUnavailableAppError } from '../errors/AppError';
import {
  SuggestedTradeItem,
  SuggestedTradeReconcileActionResult,
  SuggestedTradeOrderLinkResult,
  SuggestedTradesListResponse,
  SuggestedTradesExecutionSyncResult,
  SuggestedTradeStatusActionResult,
  SuggestedTradesSummary,
} from '../contracts/SuggestedTrade';
import { SuggestedTradesService } from '../services/SuggestedTradesService';
import {
  SuggestedTradeActionBody,
  SuggestedTradesExecutionSyncBody,
  SuggestedTradeOrderLinkBody,
} from '../validators/suggestedTrades.validator';
import { requireAuthUserId } from '../utils/auth';
import { env } from '../../env';

@JsonController('/suggested-trades')
@Service()
export class SuggestedTradesController {
  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  @Get()
  async getSuggestedTrades(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('executionState') executionState?: string,
    @QueryParam('symbol') symbol?: string,
    @QueryParam('timeframe') timeframe?: string,
    @QueryParam('automationId') automationId?: string,
    @QueryParam('automationRunId') automationRunId?: string,
    @QueryParam('side') side?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<SuggestedTradesListResponse>> {
    return this.suggestedTradesService.getSuggestedTrades(requireAuthUserId(request), {
      limit,
      offset,
      status,
      executionState,
      symbol,
      timeframe,
      automationId,
      automationRunId,
      side,
      search,
    });
  }

  @Get('/summary')
  async getSuggestedTradesSummary(
    @Req() request: Request,
    @QueryParam('status') status?: string,
    @QueryParam('executionState') executionState?: string,
    @QueryParam('symbol') symbol?: string,
    @QueryParam('timeframe') timeframe?: string,
    @QueryParam('automationId') automationId?: string,
    @QueryParam('automationRunId') automationRunId?: string,
    @QueryParam('side') side?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<SuggestedTradesSummary>> {
    return this.suggestedTradesService.getSuggestedTradesSummary(requireAuthUserId(request), {
      status,
      executionState,
      symbol,
      timeframe,
      automationId,
      automationRunId,
      side,
      search,
    });
  }

  @Post('/reconcile-execution')
  async reconcileSuggestedTradesExecution(
    @Req() request: Request,
    @Body() body: SuggestedTradesExecutionSyncBody
  ): Promise<ApiSuccessResponse<SuggestedTradesExecutionSyncResult>> {
    if (!env.suggestedTrades.rolloutEnabled) {
      throw new ServiceUnavailableAppError('Suggested trades rollout controls are disabled');
    }

    return this.suggestedTradesService.reconcileSuggestedTradesExecution(
      requireAuthUserId(request),
      body
    );
  }

  @Get('/:suggestedTradeId')
  async getSuggestedTradeById(
    @Req() request: Request,
    @Param('suggestedTradeId') suggestedTradeId: string
  ): Promise<ApiSuccessResponse<SuggestedTradeItem>> {
    return this.suggestedTradesService.getSuggestedTradeById(
      requireAuthUserId(request),
      suggestedTradeId
    );
  }

  @Post('/:suggestedTradeId/review')
  async reviewSuggestedTrade(
    @Req() request: Request,
    @Param('suggestedTradeId') suggestedTradeId: string,
    @Body() body: SuggestedTradeActionBody
  ): Promise<ApiSuccessResponse<SuggestedTradeStatusActionResult>> {
    return this.suggestedTradesService.reviewSuggestedTrade(
      requireAuthUserId(request),
      suggestedTradeId,
      body
    );
  }

  @Post('/:suggestedTradeId/accept')
  async acceptSuggestedTrade(
    @Req() request: Request,
    @Param('suggestedTradeId') suggestedTradeId: string,
    @Body() body: SuggestedTradeActionBody
  ): Promise<ApiSuccessResponse<SuggestedTradeStatusActionResult>> {
    return this.suggestedTradesService.acceptSuggestedTrade(
      requireAuthUserId(request),
      suggestedTradeId,
      body
    );
  }

  @Post('/:suggestedTradeId/dismiss')
  async dismissSuggestedTrade(
    @Req() request: Request,
    @Param('suggestedTradeId') suggestedTradeId: string,
    @Body() body: SuggestedTradeActionBody
  ): Promise<ApiSuccessResponse<SuggestedTradeStatusActionResult>> {
    return this.suggestedTradesService.dismissSuggestedTrade(
      requireAuthUserId(request),
      suggestedTradeId,
      body
    );
  }

  @Post('/:suggestedTradeId/link-order')
  async linkSuggestedTradeOrder(
    @Req() request: Request,
    @Param('suggestedTradeId') suggestedTradeId: string,
    @Body() body: SuggestedTradeOrderLinkBody
  ): Promise<ApiSuccessResponse<SuggestedTradeOrderLinkResult>> {
    return this.suggestedTradesService.linkSuggestedTradeOrder(
      requireAuthUserId(request),
      suggestedTradeId,
      body
    );
  }

  @Post('/:suggestedTradeId/reconcile-execution')
  async reconcileSuggestedTradeExecution(
    @Req() request: Request,
    @Param('suggestedTradeId') suggestedTradeId: string
  ): Promise<ApiSuccessResponse<SuggestedTradeReconcileActionResult>> {
    return this.suggestedTradesService.reconcileSuggestedTradeExecution(
      requireAuthUserId(request),
      suggestedTradeId
    );
  }
}
