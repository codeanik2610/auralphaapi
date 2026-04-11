import { Request } from 'express';
import { Body, Get, JsonController, Param, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BacktestAutomationSyncResult,
  BacktestChartResponse,
  BacktestInputSnapshotResponse,
  BacktestItem,
  BacktestsListResponse,
  BacktestsSummary,
  BacktestsTopSetupsResponse,
  CreateBacktestBody,
  CreateBacktestResult,
  PromoteBacktestBody,
  PromoteBacktestResult,
  RecoverBacktestResult,
  UpdateBacktestResultBody,
} from '../contracts/Backtest';
import { BacktestsService } from '../services/BacktestsService';
import { requireAuthUserId } from '../utils/auth';
import { verifySignedSchedulerRequestFromExpress } from '../utils/schedulerRequestAuth';

@JsonController('/backtests')
@Service()
export class BacktestsController {
  @Inject(() => BacktestsService)
  private backtestsService!: BacktestsService;

  @Get()
  async getBacktests(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<BacktestsListResponse>> {
    return this.backtestsService.getBacktests(requireAuthUserId(request), { limit, offset, status, search });
  }

  @Get('/summary')
  async getBacktestsSummary(@Req() request: Request): Promise<ApiSuccessResponse<BacktestsSummary>> {
    return this.backtestsService.getBacktestsSummary(requireAuthUserId(request));
  }

  @Get('/top-setups')
  async getTopSetups(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('search') search?: string,
    @QueryParam('timeframe') timeframe?: string,
    @QueryParam('minScore') minScore?: string,
    @QueryParam('minTrades') minTrades?: string,
    @QueryParam('eligibleOnly') eligibleOnly?: string
  ): Promise<ApiSuccessResponse<BacktestsTopSetupsResponse>> {
    return this.backtestsService.getTopSetups(requireAuthUserId(request), {
      limit,
      offset,
      search,
      timeframe,
      minScore,
      minTrades,
      eligibleOnly,
    });
  }

  @Get('/:backtestId')
  async getBacktestById(
    @Req() request: Request,
    @Param('backtestId') backtestId: string
  ): Promise<ApiSuccessResponse<BacktestItem>> {
    return this.backtestsService.getBacktestById(requireAuthUserId(request), backtestId);
  }

  @Get('/:backtestId/input-snapshot')
  async getBacktestInputSnapshot(
    @Req() request: Request,
    @Param('backtestId') backtestId: string
  ): Promise<ApiSuccessResponse<BacktestInputSnapshotResponse>> {
    return this.backtestsService.getBacktestInputSnapshot(
      requireAuthUserId(request),
      backtestId
    );
  }

  @Get('/:backtestId/chart')
  async getBacktestChart(
    @Req() request: Request,
    @Param('backtestId') backtestId: string,
    @QueryParam('symbol') symbol?: string,
    @QueryParam('interval') interval?: string,
    @QueryParam('limit') limit?: string,
    @QueryParam('lookbackDays') lookbackDays?: string,
    @QueryParam('endTime') endTime?: string
  ): Promise<ApiSuccessResponse<BacktestChartResponse>> {
    return this.backtestsService.getBacktestChart(requireAuthUserId(request), backtestId, {
      symbol,
      interval,
      limit,
      lookbackDays,
      endTime,
    });
  }

  @Post()
  async createBacktest(
    @Req() request: Request,
    @Body() body: CreateBacktestBody
  ): Promise<ApiSuccessResponse<CreateBacktestResult>> {
    return this.backtestsService.createBacktest(requireAuthUserId(request), body);
  }

  @Post('/:backtestId/results')
  async updateBacktestResults(
    @Req() request: Request,
    @Param('backtestId') backtestId: string,
    @Body() body: UpdateBacktestResultBody
  ): Promise<ApiSuccessResponse<BacktestItem>> {
    return this.backtestsService.updateBacktestResults(requireAuthUserId(request), backtestId, body);
  }

  @Post('/:backtestId/recover')
  async recoverBacktestFromCheckpoint(
    @Req() request: Request,
    @Param('backtestId') backtestId: string
  ): Promise<ApiSuccessResponse<RecoverBacktestResult>> {
    return this.backtestsService.recoverBacktestFromCheckpoint(
      requireAuthUserId(request),
      backtestId
    );
  }

  @Post('/:backtestId/automation-sync')
  async syncBacktestAutomationLifecycle(
    @Req() request: Request,
    @Param('backtestId') backtestId: string
  ): Promise<ApiSuccessResponse<BacktestAutomationSyncResult>> {
    await verifySignedSchedulerRequestFromExpress(
      request,
      undefined,
      'backtest automation lifecycle sync'
    );
    return this.backtestsService.syncBacktestAutomationLifecycle(backtestId);
  }

  @Post('/:backtestId/automation')
  async promoteBacktestToAutomation(
    @Req() request: Request,
    @Param('backtestId') backtestId: string,
    @Body() body: PromoteBacktestBody
  ): Promise<ApiSuccessResponse<PromoteBacktestResult>> {
    return this.backtestsService.promoteBacktestToAutomation(
      requireAuthUserId(request),
      backtestId,
      body
    );
  }
}
