import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { RiskOverviewResponse } from '../contracts/RiskOverview';
import { RiskOverviewService } from '../services/RiskOverviewService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/risk')
@Service()
export class RiskOverviewController {
  @Inject(() => RiskOverviewService)
  private riskOverviewService!: RiskOverviewService;

  @Get('/overview')
  async getOverview(
    @Req() request: Request,
    @QueryParam('controlsLimit') controlsLimit?: string,
    @QueryParam('controlsOffset') controlsOffset?: string,
    @QueryParam('alertsLimit') alertsLimit?: string,
    @QueryParam('alertsOffset') alertsOffset?: string,
    @QueryParam('scenariosLimit') scenariosLimit?: string,
    @QueryParam('scenariosOffset') scenariosOffset?: string
  ): Promise<ApiSuccessResponse<RiskOverviewResponse>> {
    return this.riskOverviewService.getOverview(requireAuthUserId(request), {
      controlsLimit,
      controlsOffset,
      alertsLimit,
      alertsOffset,
      scenariosLimit,
      scenariosOffset,
    });
  }
}
