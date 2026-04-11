import { Get, JsonController, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { SchedulerOverviewResponse } from '../contracts/Scheduler';
import { requireAdminAuthUser } from '../utils/auth';
import { SchedulerOverviewService } from '../services/SchedulerOverviewService';

@JsonController('/scheduler/overview')
@Service()
export class SchedulerOverviewController {
  @Inject(() => SchedulerOverviewService)
  private schedulerOverviewService!: SchedulerOverviewService;

  @Get()
  async getOverview(@Req() request: Request): Promise<ApiSuccessResponse<SchedulerOverviewResponse>> {
    const userId = requireAdminAuthUser(request).userId;
    return this.schedulerOverviewService.getOverview(userId);
  }
}
