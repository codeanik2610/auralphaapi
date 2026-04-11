import { Body, Get, JsonController, Param, Post, Put, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts';
import {
  SchedulerAssetListResponse,
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerRunLogListResponse,
  SchedulerRunProgressResponse,
  SchedulerRunNowResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts';
import { requireAdminAuthUser } from '../utils/auth';
import { SchedulerService } from '../services/SchedulerService';

@JsonController('/scheduler/exchange-assets')
@Service()
export class SchedulerController {
  @Inject(() => SchedulerService)
  private schedulerService!: SchedulerService;

  @Get('/config')
  async getConfig(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.schedulerService.getSchedulerConfig(requireAdminAuthUser(request).userId);
  }

  @Put('/config')
  async updateConfig(
    @Req() request: Request,
    @Body() body: UpdateSchedulerConfigBody
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.schedulerService.updateSchedulerConfig(requireAdminAuthUser(request).userId, body);
  }

  @Post('/run')
  async runNow(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    return this.schedulerService.runNow(requireAdminAuthUser(request).userId);
  }

  @Post('/pause')
  async pause(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.schedulerService.pauseScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/resume')
  async resume(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.schedulerService.resumeScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/stop')
  async stop(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.schedulerService.stopScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/restart')
  async restart(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.schedulerService.restartScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/purge-logs')
  async purgeLogs(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    return this.schedulerService.purgeSchedulerLogs(requireAdminAuthUser(request).userId);
  }

  @Get('/purge-logs/preview')
  async purgeLogsPreview(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerPurgePreviewResponse>> {
    return this.schedulerService.getSchedulerPurgePreview(requireAdminAuthUser(request).userId);
  }

  @Get('/runs')
  async listRuns(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    return this.schedulerService.listSchedulerRuns(requireAdminAuthUser(request).userId, { limit, offset });
  }

  @Get('/assets')
  async listAssets(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('search') search?: string,
    @QueryParam('assetId') assetId?: string
  ): Promise<ApiSuccessResponse<SchedulerAssetListResponse>> {
    requireAdminAuthUser(request);
    return this.schedulerService.listSchedulerAssets({ limit, offset, search, assetId });
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
    return this.schedulerService.listSchedulerRunUpdates(requireAdminAuthUser(request).userId, runId, {
      limit,
      offset,
      actionType,
      source,
      symbol,
      sortBy,
      sortOrder,
    });
  }

  @Get('/runs/:runId/progress')
  async getRunProgress(
    @Req() request: Request,
    @Param('runId') runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    return this.schedulerService.getSchedulerRunProgress(requireAdminAuthUser(request).userId, runId);
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
    return this.schedulerService.exportSchedulerRunUpdates(requireAdminAuthUser(request).userId, runId, {
      actionType,
      source,
      symbol,
      sortBy,
      sortOrder,
    });
  }
}
