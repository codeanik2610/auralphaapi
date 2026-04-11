import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { AlertsOverviewResponse } from '../contracts/AlertsOverview';
import { AlertsOverviewService } from '../services/AlertsOverviewService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/alerts')
@Service()
export class AlertsOverviewController {
  @Inject(() => AlertsOverviewService)
  private alertsOverviewService!: AlertsOverviewService;

  @Get('/overview')
  async getOverview(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('severity') severity?: string,
    @QueryParam('channel') channel?: string
  ): Promise<ApiSuccessResponse<AlertsOverviewResponse>> {
    return this.alertsOverviewService.getOverview(requireAuthUserId(request), {
      limit,
      offset,
      status,
      search,
      severity,
      channel,
    });
  }
}
