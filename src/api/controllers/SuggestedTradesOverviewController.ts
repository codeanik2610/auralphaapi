import { Request } from 'express';
import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { ServiceUnavailableAppError } from '../errors/AppError';
import { SuggestedTradesOverviewResponse } from '../contracts/SuggestedTradesOverview';
import { SuggestedTradesOverviewService } from '../services/SuggestedTradesOverviewService';
import { requireAuthUserId } from '../utils/auth';
import { env } from '../../env';

@JsonController('/suggested-trades')
@Service()
export class SuggestedTradesOverviewController {
  @Inject(() => SuggestedTradesOverviewService)
  private suggestedTradesOverviewService!: SuggestedTradesOverviewService;

  @Get('/overview')
  async getOverview(
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
  ): Promise<ApiSuccessResponse<SuggestedTradesOverviewResponse>> {
    if (!env.suggestedTrades.rolloutEnabled) {
      throw new ServiceUnavailableAppError('Suggested trades overview rollout is disabled');
    }

    return this.suggestedTradesOverviewService.getOverview(requireAuthUserId(request), {
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
}
