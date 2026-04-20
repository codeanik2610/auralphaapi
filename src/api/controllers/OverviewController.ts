import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { OverviewResponse } from '../contracts/Overview';
import { OverviewCommandCenterResponse } from '../contracts/OverviewCommandCenter';
import { OverviewCommandCenterService } from '../services/OverviewCommandCenterService';
import { OverviewService } from '../services/OverviewService';
import { requireAuthUser, requireAuthUserId } from '../utils/auth';

@JsonController('/overview')
@Service()
export class OverviewController {
  @Inject(() => OverviewService)
  private overviewService!: OverviewService;

  @Inject(() => OverviewCommandCenterService)
  private overviewCommandCenterService!: OverviewCommandCenterService;

  @Get('/command-center')
  async getCommandCenter(
    @Req() request: Request,
    @QueryParam('selectedSymbol') selectedSymbol?: string
  ): Promise<ApiSuccessResponse<OverviewCommandCenterResponse>> {
    const authUser = requireAuthUser(request);
    return this.overviewCommandCenterService.getCommandCenter(authUser.userId, {
      role: authUser.role,
      selectedSymbol,
    });
  }

  @Get()
  async getOverview(
    @Req() request: Request,
    @QueryParam('selectedSymbol') selectedSymbol?: string,
    @QueryParam('sort') sort?: string,
    @QueryParam('order') order?: string
  ): Promise<ApiSuccessResponse<OverviewResponse>> {
    return this.overviewService.getOverview(requireAuthUserId(request), {
      selectedSymbol,
      sort,
      order,
    });
  }
}
