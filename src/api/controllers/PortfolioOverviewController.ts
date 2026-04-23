import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { PortfolioOverviewResponse } from '../contracts/PortfolioOverview';
import { PortfolioOverviewService } from '../services/PortfolioOverviewService';
import { PaperTradingWorkspaceService } from '../services/PaperTradingWorkspaceService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/portfolio')
@Service()
export class PortfolioOverviewController {
  @Inject(() => PortfolioOverviewService)
  private portfolioOverviewService!: PortfolioOverviewService;

  @Inject(() => PaperTradingWorkspaceService)
  private paperTradingWorkspaceService!: PaperTradingWorkspaceService;

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

  @Get('/paper/overview')
  async getPaperOverview(
    @Req() request: Request,
    @QueryParam('timeframe') timeframe?: string,
    @QueryParam('holdingsLimit') holdingsLimit?: string
  ): Promise<ApiSuccessResponse<PortfolioOverviewResponse>> {
    return this.paperTradingWorkspaceService.getPaperPortfolioOverview(
      requireAuthUserId(request),
      {
        timeframe,
        holdingsLimit,
      }
    ) as Promise<ApiSuccessResponse<PortfolioOverviewResponse>>;
  }
}
