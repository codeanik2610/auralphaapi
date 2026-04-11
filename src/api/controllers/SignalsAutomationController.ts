import { Body, Get, JsonController, Param, Post, Put, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunLogListResponse,
  SchedulerRunNowResponse,
  SchedulerRunProgressResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import { requireAuthUserId } from '../utils/auth';
import { SignalsSchedulerService } from '../services/SignalsSchedulerService';

@JsonController('/signals/automation')
@Service()
export class SignalsAutomationController {
  @Inject(() => SignalsSchedulerService)
  private signalsAutomationService!: SignalsSchedulerService;

  @Get('/config')
  async getConfig(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.signalsAutomationService.getSchedulerConfig(requireAuthUserId(request));
  }

  @Put('/config')
  async updateConfig(
    @Req() request: Request,
    @Body() body: UpdateSchedulerConfigBody
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.signalsAutomationService.updateSchedulerConfig(requireAuthUserId(request), body);
  }

  @Post('/run')
  async runNow(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    return this.signalsAutomationService.runNow(requireAuthUserId(request));
  }

  @Post('/pause')
  async pause(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.signalsAutomationService.pauseScheduler(requireAuthUserId(request));
  }

  @Post('/resume')
  async resume(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.signalsAutomationService.resumeScheduler(requireAuthUserId(request));
  }

  @Post('/stop')
  async stop(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.signalsAutomationService.stopScheduler(requireAuthUserId(request));
  }

  @Post('/restart')
  async restart(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.signalsAutomationService.restartScheduler(requireAuthUserId(request));
  }

  @Post('/purge-logs')
  async purgeLogs(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    return this.signalsAutomationService.purgeSchedulerLogs(requireAuthUserId(request));
  }

  @Get('/purge-logs/preview')
  async purgeLogsPreview(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerPurgePreviewResponse>> {
    return this.signalsAutomationService.getSchedulerPurgePreview(requireAuthUserId(request));
  }

  @Get('/runs')
  async listRuns(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    const userId = requireAuthUserId(request);
    return this.signalsAutomationService.listSchedulerRuns(userId, { limit, offset });
  }

  @Get('/runs/:runId/progress')
  async getRunProgress(
    @Req() request: Request,
    @Param('runId') runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    const userId = requireAuthUserId(request);
    return this.signalsAutomationService.getSchedulerRunProgress(userId, runId);
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
    const userId = requireAuthUserId(request);
    return this.signalsAutomationService.listSchedulerRunUpdates(userId, runId, {
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
    const userId = requireAuthUserId(request);
    return this.signalsAutomationService.exportSchedulerRunUpdates(userId, runId, {
      actionType,
      source,
      symbol,
      sortBy,
      sortOrder,
    });
  }
}
