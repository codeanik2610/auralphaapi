import { Body, Get, JsonController, Param, Post, Put, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  FundsSchedulerRunNowBody,
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerFundsCoverageListResponse,
  SchedulerFundsDiagnosticsSummaryResponse,
  SchedulerRunLogListResponse,
  SchedulerRunProgressResponse,
  SchedulerRunNowResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import { requireAdminAuthUser } from '../utils/auth';
import { FundsSchedulerService } from '../services/FundsSchedulerService';

@JsonController('/scheduler/funds')
@Service()
export class FundsSchedulerController {
  @Inject(() => FundsSchedulerService)
  private fundsSchedulerService!: FundsSchedulerService;

  @Get('/config')
  async getConfig(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.fundsSchedulerService.getSchedulerConfig(userId);
  }

  @Put('/config')
  async updateConfig(
    @Req() request: Request,
    @Body() body: UpdateSchedulerConfigBody
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.fundsSchedulerService.updateSchedulerConfig(requireAdminAuthUser(request).userId, body);
  }

  @Post('/run')
  async runNow(
    @Req() request: Request,
    @Body() body: Partial<FundsSchedulerRunNowBody>
  ): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    return this.fundsSchedulerService.runNow(requireAdminAuthUser(request).userId, body);
  }

  @Post('/pause')
  async pause(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.fundsSchedulerService.pauseScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/resume')
  async resume(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.fundsSchedulerService.resumeScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/stop')
  async stop(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.fundsSchedulerService.stopScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/restart')
  async restart(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.fundsSchedulerService.restartScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/purge-logs')
  async purgeLogs(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    return this.fundsSchedulerService.purgeSchedulerLogs(requireAdminAuthUser(request).userId);
  }

  @Get('/purge-logs/preview')
  async purgeLogsPreview(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerPurgePreviewResponse>> {
    return this.fundsSchedulerService.getSchedulerPurgePreview(requireAdminAuthUser(request).userId);
  }

  @Get('/summary')
  async getSummary(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerFundsDiagnosticsSummaryResponse>> {
    return this.fundsSchedulerService.getSchedulerDiagnosticsSummary(
      requireAdminAuthUser(request).userId
    );
  }

  @Get('/coverage')
  async listCoverage(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('accountId') accountId?: string,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('freshnessState') freshnessState?: string,
    @QueryParam('latestFetchStatus') latestFetchStatus?: string
  ): Promise<ApiSuccessResponse<SchedulerFundsCoverageListResponse>> {
    return this.fundsSchedulerService.listSchedulerCoverage(requireAdminAuthUser(request).userId, {
      limit,
      offset,
      accountId,
      brokerKey,
      freshnessState,
      latestFetchStatus,
    });
  }

  @Get('/runs')
  async listRuns(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.fundsSchedulerService.listSchedulerRuns(userId, { limit, offset });
  }

  @Get('/runs/:runId/progress')
  async getRunProgress(
    @Req() request: Request,
    @Param('runId') runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.fundsSchedulerService.getSchedulerRunProgress(userId, runId);
  }

  @Get('/runs/:runId/updates')
  async listRunUpdates(
    @Req() request: Request,
    @Param('runId') runId: string,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('actionType') actionType?: string,
    @QueryParam('source') source?: string,
    @QueryParam('symbol') symbol?: string,
    @QueryParam('sortBy') sortBy?: string,
    @QueryParam('sortOrder') sortOrder?: string
  ): Promise<ApiSuccessResponse<SchedulerAssetUpdateLogListResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.fundsSchedulerService.listSchedulerRunUpdates(userId, runId, {
      limit,
      offset,
      actionType,
      source,
      symbol,
      sortBy,
      sortOrder,
    });
  }

  @Get('/runs/:runId/updates/export')
  async exportRunUpdates(
    @Req() request: Request,
    @Param('runId') runId: string,
    @QueryParam('actionType') actionType?: string,
    @QueryParam('source') source?: string,
    @QueryParam('symbol') symbol?: string,
    @QueryParam('sortBy') sortBy?: string,
    @QueryParam('sortOrder') sortOrder?: string
  ): Promise<ApiSuccessResponse<SchedulerRunUpdatesExportResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.fundsSchedulerService.exportSchedulerRunUpdates(userId, runId, {
      actionType,
      source,
      symbol,
      sortBy,
      sortOrder,
    });
  }
}
