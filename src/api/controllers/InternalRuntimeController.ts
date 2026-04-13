import { Body, Get, JsonController, Param, Post, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  RuntimeOverviewResponse,
  RuntimeRepairResult,
  RuntimeStaleItemsResponse,
} from '../contracts/Runtime';
import { RuntimeDiagnosticsService } from '../services/RuntimeDiagnosticsService';
import { requireAdminAuthUserOrApiKey } from '../utils/auth';
import { successResponse } from '../utils/response';
import {
  RuntimeReleaseLockBody,
  RuntimeRequeueBody,
  RuntimeRepairBody,
  validateRuntimeListQuery,
  validateRuntimeReleaseLockBody,
  validateRuntimeRepairBody,
  validateRuntimeRequeueBody,
} from '../validators/runtime.validator';

@JsonController('/internal/runtime')
@Service()
export class InternalRuntimeController {
  @Inject(() => RuntimeDiagnosticsService)
  private runtimeDiagnosticsService!: RuntimeDiagnosticsService;

  @Get('/overview')
  async getOverview(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<RuntimeOverviewResponse>> {
    requireAdminAuthUserOrApiKey(request);
    return successResponse(await this.runtimeDiagnosticsService.getRuntimeOverview());
  }

  @Get('/stale-items')
  async listStaleItems(
    @Req() request: Request,
    @QueryParam('limit') limit?: string
  ): Promise<ApiSuccessResponse<RuntimeStaleItemsResponse>> {
    requireAdminAuthUserOrApiKey(request);
    const query = validateRuntimeListQuery({ limit });
    return successResponse(await this.runtimeDiagnosticsService.listStaleItems(query.limit));
  }

  @Post('/repair/scheduler-command/:commandId')
  async repairSchedulerCommand(
    @Req() request: Request,
    @Param('commandId') commandId: string,
    @Body() body: RuntimeRepairBody = {}
  ): Promise<ApiSuccessResponse<RuntimeRepairResult>> {
    const context = requireAdminAuthUserOrApiKey(request);
    const payload = validateRuntimeRepairBody({
      ...body,
      actorUserId: body.actorUserId ?? context?.userId,
    });
    return successResponse(
      await this.runtimeDiagnosticsService.repairSchedulerCommand(commandId, {
        actorUserId: payload.actorUserId,
        status:
          payload.status === 'Cancelled' || payload.status === 'Failed'
            ? payload.status
            : 'Failed',
        reason: payload.reason,
      })
    );
  }

  @Post('/repair/scheduler-run/:runId')
  async repairSchedulerRun(
    @Req() request: Request,
    @Param('runId') runId: string,
    @Body() body: RuntimeRepairBody = {}
  ): Promise<ApiSuccessResponse<RuntimeRepairResult>> {
    const context = requireAdminAuthUserOrApiKey(request);
    const payload = validateRuntimeRepairBody({
      ...body,
      actorUserId: body.actorUserId ?? context?.userId,
    });
    return successResponse(
      await this.runtimeDiagnosticsService.repairSchedulerRun(runId, {
        actorUserId: payload.actorUserId,
        status:
          payload.status === 'Cancelled' || payload.status === 'Failed'
            ? payload.status
            : 'Failed',
        reason: payload.reason,
      })
    );
  }

  @Post('/repair/automation-run/:runId')
  async repairAutomationRun(
    @Req() request: Request,
    @Param('runId') runId: string,
    @Body() body: RuntimeRepairBody = {}
  ): Promise<ApiSuccessResponse<RuntimeRepairResult>> {
    const context = requireAdminAuthUserOrApiKey(request);
    const payload = validateRuntimeRepairBody({
      ...body,
      actorUserId: body.actorUserId ?? context?.userId,
    });
    return successResponse(
      await this.runtimeDiagnosticsService.repairAutomationRun(runId, {
        actorUserId: payload.actorUserId,
        reason: payload.reason,
      })
    );
  }

  @Post('/repair/activity-export/:exportId')
  async repairActivityExport(
    @Req() request: Request,
    @Param('exportId') exportId: string,
    @Body() body: RuntimeRepairBody = {}
  ): Promise<ApiSuccessResponse<RuntimeRepairResult>> {
    const context = requireAdminAuthUserOrApiKey(request);
    const payload = validateRuntimeRepairBody({
      ...body,
      actorUserId: body.actorUserId ?? context?.userId,
    });
    return successResponse(
      await this.runtimeDiagnosticsService.repairActivityExport(exportId, {
        actorUserId: payload.actorUserId,
        status: payload.status === 'Failed' ? 'Failed' : 'Queued',
        reason: payload.reason,
      })
    );
  }

  @Post('/requeue/scheduler/:schedulerKey')
  async requeueScheduler(
    @Req() request: Request,
    @Param('schedulerKey') schedulerKey: string,
    @Body() body: RuntimeRequeueBody = {}
  ): Promise<ApiSuccessResponse<RuntimeRepairResult>> {
    const context = requireAdminAuthUserOrApiKey(request);
    const payload = validateRuntimeRequeueBody({
      ...body,
      actorUserId: body.actorUserId ?? context?.userId,
    });
    return successResponse(
      await this.runtimeDiagnosticsService.requeueScheduler(schedulerKey, {
        actorUserId: payload.actorUserId,
        schedulerUserId: payload.schedulerUserId,
      })
    );
  }

  @Post('/release-lock/:schedulerKey')
  async releaseLock(
    @Req() request: Request,
    @Param('schedulerKey') schedulerKey: string,
    @Body() body: RuntimeReleaseLockBody = {}
  ): Promise<ApiSuccessResponse<RuntimeRepairResult>> {
    const context = requireAdminAuthUserOrApiKey(request);
    const payload = validateRuntimeReleaseLockBody({
      ...body,
      actorUserId: body.actorUserId ?? context?.userId,
    });
    return successResponse(
      await this.runtimeDiagnosticsService.releaseSchedulerLock(schedulerKey, payload)
    );
  }
}
