import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { PortfolioOverviewResponse } from '../contracts/PortfolioOverview';
import { PortfolioOverviewService } from '../services/PortfolioOverviewService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/portfolio')
@Service()
export class PortfolioOverviewController {
  @Inject(() => PortfolioOverviewService)
  private portfolioOverviewService!: PortfolioOverviewService;

  @Get('/overview')
  async getOverview(
    @Req() request: Request,
    @QueryParam('timeframe') timeframe?: string,
    @QueryParam('snapshotsLimit') snapshotsLimit?: string,
    @QueryParam('snapshotsOffset') snapshotsOffset?: string,
    @QueryParam('holdingsLimit') holdingsLimit?: string
  ): Promise<ApiSuccessResponse<PortfolioOverviewResponse>> {
    return this.portfolioOverviewService.getOverview(requireAuthUserId(request), {
      timeframe,
      snapshotsLimit,
      snapshotsOffset,
      holdingsLimit,
    });
  }
}
