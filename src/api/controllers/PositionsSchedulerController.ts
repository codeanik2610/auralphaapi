import { Body, Get, JsonController, Param, Post, Put, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SchedulerAssetUpdateLogListResponse,
  SchedulerControlResponse,
  SchedulerConfigResponse,
  PositionsSchedulerReadModelRebuildBody,
  PositionsSchedulerReadModelRecoveryHistoryResponse,
  PositionsSchedulerReadModelRebuildResponse,
  SchedulerRecordSyncSummaryResponse,
  SchedulerRecordSyncStateListResponse,
  SchedulerRunLogListResponse,
  SchedulerRunProgressResponse,
  SchedulerRunNowResponse,
  SchedulerPurgeLogsResponse,
  SchedulerPurgePreviewResponse,
  SchedulerRunUpdatesExportResponse,
  UpdateSchedulerConfigBody,
} from '../contracts/Scheduler';
import { requireAdminAuthUser } from '../utils/auth';
import { PositionsSchedulerService } from '../services/PositionsSchedulerService';

@JsonController('/scheduler/positions')
@Service()
export class PositionsSchedulerController {
  @Inject(() => PositionsSchedulerService)
  private positionsSchedulerService!: PositionsSchedulerService;

  @Get('/config')
  async getConfig(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.positionsSchedulerService.getSchedulerConfig(userId);
  }

  @Put('/config')
  async updateConfig(
    @Req() request: Request,
    @Body() body: UpdateSchedulerConfigBody
  ): Promise<ApiSuccessResponse<SchedulerConfigResponse>> {
    return this.positionsSchedulerService.updateSchedulerConfig(requireAdminAuthUser(request).userId, body);
  }

  @Post('/run')
  async runNow(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerRunNowResponse>> {
    return this.positionsSchedulerService.runNow(requireAdminAuthUser(request).userId);
  }

  @Post('/read-model/rebuild')
  async rebuildReadModel(
    @Req() request: Request,
    @Body() body: PositionsSchedulerReadModelRebuildBody
  ): Promise<ApiSuccessResponse<PositionsSchedulerReadModelRebuildResponse>> {
    return this.positionsSchedulerService.rebuildReadModel(
      requireAdminAuthUser(request).userId,
      body
    );
  }

  @Get('/read-model/recovery-history')
  async listReadModelRecoveryHistory(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string
  ): Promise<ApiSuccessResponse<PositionsSchedulerReadModelRecoveryHistoryResponse>> {
    return this.positionsSchedulerService.listReadModelRecoveryHistory(
      requireAdminAuthUser(request).userId,
      {
        limit,
        offset,
        status,
      }
    );
  }

  @Post('/pause')
  async pause(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.positionsSchedulerService.pauseScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/resume')
  async resume(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.positionsSchedulerService.resumeScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/stop')
  async stop(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.positionsSchedulerService.stopScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/restart')
  async restart(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerControlResponse>> {
    return this.positionsSchedulerService.restartScheduler(requireAdminAuthUser(request).userId);
  }

  @Post('/purge-logs')
  async purgeLogs(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerPurgeLogsResponse>> {
    return this.positionsSchedulerService.purgeSchedulerLogs(requireAdminAuthUser(request).userId);
  }

  @Get('/purge-logs/preview')
  async purgeLogsPreview(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerPurgePreviewResponse>> {
    return this.positionsSchedulerService.getSchedulerPurgePreview(requireAdminAuthUser(request).userId);
  }

  @Get('/runs')
  async listRuns(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<SchedulerRunLogListResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.positionsSchedulerService.listSchedulerRuns(userId, { limit, offset });
  }

  @Get('/sync-state')
  async listSyncState(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('accountId') accountId?: string,
    @QueryParam('ownerUserId') ownerUserId?: string,
    @QueryParam('brokerKey') brokerKey?: string
  ): Promise<ApiSuccessResponse<SchedulerRecordSyncStateListResponse>> {
    const actorUserId = requireAdminAuthUser(request).userId;
    return this.positionsSchedulerService.listSchedulerSyncState(actorUserId, {
      limit,
      offset,
      accountId,
      ownerUserId,
      brokerKey,
    });
  }

  @Get('/sync-state/summary')
  async getSyncStateSummary(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<SchedulerRecordSyncSummaryResponse>> {
    return this.positionsSchedulerService.getSchedulerSyncStateSummary(requireAdminAuthUser(request).userId);
  }

  @Get('/runs/:runId/progress')
  async getRunProgress(
    @Req() request: Request,
    @Param('runId') runId: string
  ): Promise<ApiSuccessResponse<SchedulerRunProgressResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.positionsSchedulerService.getSchedulerRunProgress(userId, runId);
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
    return this.positionsSchedulerService.listSchedulerRunUpdates(userId, runId, {
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
    return this.positionsSchedulerService.exportSchedulerRunUpdates(userId, runId, {
      actionType,
      source,
      symbol,
      sortBy,
      sortOrder,
    });
  }
}
