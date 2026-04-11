import { Request } from 'express';
import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { SignalsOverviewResponse } from '../contracts/SignalsOverview';
import { SignalsOverviewService } from '../services/SignalsOverviewService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/signals')
@Service()
export class SignalsOverviewController {
  @Inject(() => SignalsOverviewService)
  private signalsOverviewService!: SignalsOverviewService;

  @Get('/overview')
  async getOverview(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('symbol') symbol?: string,
    @QueryParam('source') source?: string,
    @QueryParam('timeframe') timeframe?: string,
    @QueryParam('search') search?: string,
    @QueryParam('view') view?: string
  ): Promise<ApiSuccessResponse<SignalsOverviewResponse>> {
    return this.signalsOverviewService.getOverview(requireAuthUserId(request), {
      limit,
      offset,
      status,
      symbol,
      source,
      timeframe,
      search,
      view,
    });
  }
}
