import { Request } from 'express';
import { Body, Get, JsonController, Param, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  PortfolioHolding,
  PortfolioHoldingsResponse,
  PortfolioPerformanceResponse,
  PortfolioPnLResponse,
  PortfolioSnapshotsResponse,
  PortfolioSummary,
  PortfolioWorkspaceReportBody,
  PortfolioWorkspaceReportResult,
  RebalanceReviewBody,
  RebalanceReviewResult,
} from '../contracts/Portfolio';
import { PortfolioService } from '../services/PortfolioService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/portfolio')
@Service()
export class PortfolioController {
  @Inject(() => PortfolioService)
  private portfolioService!: PortfolioService;

  @Get('/holdings')
  async getPortfolioHoldings(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('search') search?: string,
    @QueryParam('sleeve') sleeve?: string,
    @QueryParam('side') side?: string
  ): Promise<ApiSuccessResponse<PortfolioHoldingsResponse>> {
    return this.portfolioService.getPortfolioHoldings(requireAuthUserId(request), {
      limit,
      offset,
      search,
      sleeve,
      side,
    });
  }

  @Get('/summary')
  async getPortfolioSummary(@Req() request: Request): Promise<ApiSuccessResponse<PortfolioSummary>> {
    return this.portfolioService.getPortfolioSummary(requireAuthUserId(request));
  }

  @Get('/pnl')
  async getPortfolioPnL(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<PortfolioPnLResponse>> {
    return this.portfolioService.getPortfolioPnL(requireAuthUserId(request));
  }

  @Get('/performance')
  async getPortfolioPerformance(
    @Req() request: Request,
    @QueryParam('timeframe') timeframe?: string
  ): Promise<ApiSuccessResponse<PortfolioPerformanceResponse>> {
    return this.portfolioService.getPortfolioPerformance(
      requireAuthUserId(request),
      timeframe || 'daily'
    );
  }

  @Get('/holdings/:holdingId')
  async getPortfolioHoldingById(
    @Req() request: Request,
    @Param('holdingId') holdingId: string
  ): Promise<ApiSuccessResponse<PortfolioHolding>> {
    return this.portfolioService.getPortfolioHoldingById(requireAuthUserId(request), holdingId);
  }

  @Get('/snapshots')
  async getPortfolioSnapshots(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<PortfolioSnapshotsResponse>> {
    return this.portfolioService.getPortfolioSnapshots(requireAuthUserId(request), {
      limit,
      offset,
    });
  }

  @Post('/rebalance-review')
  async rebalancePortfolio(
    @Req() request: Request,
    @Body() body: RebalanceReviewBody
  ): Promise<ApiSuccessResponse<RebalanceReviewResult>> {
    return this.portfolioService.rebalancePortfolio(requireAuthUserId(request), body);
  }

  @Post('/workspace-report')
  async generateWorkspaceReport(
    @Req() request: Request,
    @Body() body: PortfolioWorkspaceReportBody
  ): Promise<ApiSuccessResponse<PortfolioWorkspaceReportResult>> {
    return this.portfolioService.generateWorkspaceReport(requireAuthUserId(request), body);
  }
}
