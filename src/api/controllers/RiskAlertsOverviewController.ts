import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { RiskAlertsOverviewResponse } from '../contracts/RiskAlertsOverview';
import { RiskAlertsOverviewService } from '../services/RiskAlertsOverviewService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/risk/alerts')
@Service()
export class RiskAlertsOverviewController {
  @Inject(() => RiskAlertsOverviewService)
  private riskAlertsOverviewService!: RiskAlertsOverviewService;

  @Get('/overview')
  async getOverview(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('scope') scope?: string
  ): Promise<ApiSuccessResponse<RiskAlertsOverviewResponse>> {
    return this.riskAlertsOverviewService.getOverview(requireAuthUserId(request), {
      limit,
      offset,
      status,
      scope,
    });
  }
}
