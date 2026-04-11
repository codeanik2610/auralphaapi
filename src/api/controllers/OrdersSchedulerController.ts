import { Body, Get, JsonController, Param, Post, Put, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  OrdersSchedulerRunNowBody,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  SchedulerRecordSyncSummaryResponse,
  SchedulerRecordSyncStateListResponse,
  SchedulerRunLogListResponse,
  SchedulerRunProgressResponse,
  SchedulerRunUpdateLogListResponse,
  SchedulerRunNowResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import { requireAdminAuthUser } from '../utils/auth';
import { OrdersSchedulerService } from '../services/OrdersSchedulerService';

@JsonController('/scheduler/orders')
@Service()
export class OrdersSchedulerController {
  @Inject(() => OrdersSchedulerService)
  private ordersSchedulerService!: OrdersSchedulerService;

  @Get('/config')
  async getConfig(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.ordersSchedulerService.getSchedulerConfig(requireAdminAuthUser(request).userId);
  }

  @Put('/config')
  async updateConfig(
    @Req() request: Request,
    @Body() body: UpdateSchedulerConfigBody
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.ordersSchedulerService.updateSchedulerConfig(requireAdminAuthUser(request).userId, body);
  }

  @Post('/run')
  async runNow(
    @Req() request: Request,
    @Body() body: OrdersSchedulerRunNowBody = {}
  ): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    return this.ordersSchedulerService.runNow(requireAdminAuthUser(request).userId, body);
  }

  @Post('/pause')
  async pause(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.ordersSchedulerService.pauseScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/resume')
  async resume(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.ordersSchedulerService.resumeScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/stop')
  async stop(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.ordersSchedulerService.stopScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/restart')
  async restart(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.ordersSchedulerService.restartScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/purge-logs')
  async purgeLogs(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    return this.ordersSchedulerService.purgeSchedulerLogs(requireAdminAuthUser(request).userId);
  }

  @Get('/purge-logs/preview')
  async purgeLogsPreview(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerPurgePreviewResponse>> {
    return this.ordersSchedulerService.getSchedulerPurgePreview(requireAdminAuthUser(request).userId);
  }

  @Get('/runs')
  async listRuns(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    return this.ordersSchedulerService.listSchedulerRuns(requireAdminAuthUser(request).userId, {
      limit,
      offset,
    });
  }

  @Get('/sync-state')
  async listSyncState(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('accountId') accountId?: string,
    @QueryParam('ownerUserId') ownerUserId?: string,
    @QueryParam('userId') userId?: string,
    @QueryParam('brokerKey') brokerKey?: string
  ): Promise<ApiSuccessResponse<SchedulerRecordSyncStateListResponse>> {
    return this.ordersSchedulerService.listSchedulerSyncState(requireAdminAuthUser(request).userId, {
      limit,
      offset,
      accountId,
      ownerUserId,
      userId,
      brokerKey,
    });
  }

  @Get('/sync-state/summary')
  async getSyncStateSummary(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerRecordSyncSummaryResponse>> {
    return this.ordersSchedulerService.getSchedulerSyncStateSummary(requireAdminAuthUser(request).userId);
  }

  @Get('/runs/:runId/progress')
  async getRunProgress(
    @Req() request: Request,
    @Param('runId') runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    return this.ordersSchedulerService.getSchedulerRunProgress(requireAdminAuthUser(request).userId, runId);
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
  ): Promise<ApiSuccessResponse<SchedulerRunUpdateLogListResponse>> {
    return this.ordersSchedulerService.listSchedulerRunUpdates(
      requireAdminAuthUser(request).userId,
      runId,
      {
        limit,
        offset,
        actionType,
        source,
        symbol,
        sortBy,
        sortOrder,
      }
    );
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
    return this.ordersSchedulerService.exportSchedulerRunUpdates(userId, runId, {
      actionType,
      source,
      symbol,
      sortBy,
      sortOrder,
    });
  }
}
