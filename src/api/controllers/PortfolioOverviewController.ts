import { Body, Get, JsonController, Param, Patch, Post, QueryParam, Req } from 'routing-controllers';
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

  @Get('/paper/accounts')
  async getPaperAccounts(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string
  ): Promise<ApiSuccessResponse<Record<string, unknown>>> {
    return this.paperTradingWorkspaceService.getPaperAccounts(
      requireAuthUserId(request),
      {
        brokerKey,
        accountId,
      }
    ) as Promise<ApiSuccessResponse<Record<string, unknown>>>;
  }

  @Patch('/paper/accounts/:accountId')
  async updatePaperAccount(
    @Req() request: Request,
    @Param('accountId') accountId: string,
    @Body() body: Record<string, unknown> = {}
  ): Promise<ApiSuccessResponse<Record<string, unknown>>> {
    return this.paperTradingWorkspaceService.updatePaperAccount(
      requireAuthUserId(request),
      accountId,
      body
    ) as Promise<ApiSuccessResponse<Record<string, unknown>>>;
  }

  @Post('/paper/accounts/:accountId/reset')
  async resetPaperAccount(
    @Req() request: Request,
    @Param('accountId') accountId: string,
    @Body() body: Record<string, unknown> = {}
  ): Promise<ApiSuccessResponse<Record<string, unknown>>> {
    return this.paperTradingWorkspaceService.resetPaperAccount(
      requireAuthUserId(request),
      accountId,
      body
    ) as Promise<ApiSuccessResponse<Record<string, unknown>>>;
  }
}
