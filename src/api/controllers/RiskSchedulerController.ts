import { Body, Get, JsonController, Param, Post, Put, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerRiskDiagnosticsSummaryResponse,
  SchedulerRunLogListResponse,
  SchedulerRunProgressResponse,
  SchedulerRunNowResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import { requireAdminAuthUser } from '../utils/auth';
import { RiskSchedulerService } from '../services/RiskSchedulerService';

@JsonController('/scheduler/risk')
@Service()
export class RiskSchedulerController {
  @Inject(() => RiskSchedulerService)
  private riskSchedulerService!: RiskSchedulerService;

  @Get('/config')
  async getConfig(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.riskSchedulerService.getSchedulerConfig(userId);
  }

  @Put('/config')
  async updateConfig(
    @Req() request: Request,
    @Body() body: UpdateSchedulerConfigBody
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.riskSchedulerService.updateSchedulerConfig(requireAdminAuthUser(request).userId, body);
  }

  @Post('/run')
  async runNow(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    return this.riskSchedulerService.runNow(requireAdminAuthUser(request).userId);
  }

  @Post('/pause')
  async pause(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.riskSchedulerService.pauseScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/resume')
  async resume(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.riskSchedulerService.resumeScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/stop')
  async stop(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.riskSchedulerService.stopScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/restart')
  async restart(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.riskSchedulerService.restartScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/purge-logs')
  async purgeLogs(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    return this.riskSchedulerService.purgeSchedulerLogs(requireAdminAuthUser(request).userId);
  }

  @Get('/purge-logs/preview')
  async purgeLogsPreview(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerPurgePreviewResponse>> {
    return this.riskSchedulerService.getSchedulerPurgePreview(requireAdminAuthUser(request).userId);
  }

  @Get('/summary')
  async getSummary(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerRiskDiagnosticsSummaryResponse>> {
    return this.riskSchedulerService.getSchedulerDiagnosticsSummary(requireAdminAuthUser(request).userId);
  }

  @Get('/runs')
  async listRuns(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.riskSchedulerService.listSchedulerRuns(userId, { limit, offset });
  }

  @Get('/runs/:runId/progress')
  async getRunProgress(
    @Req() request: Request,
    @Param('runId') runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.riskSchedulerService.getSchedulerRunProgress(userId, runId);
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
    return this.riskSchedulerService.listSchedulerRunUpdates(userId, runId, {
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
    return this.riskSchedulerService.exportSchedulerRunUpdates(userId, runId, {
      actionType,
      source,
      symbol,
      sortBy,
      sortOrder,
    });
  }
}
