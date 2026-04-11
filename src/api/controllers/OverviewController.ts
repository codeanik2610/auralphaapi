import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { OverviewResponse } from '../contracts/Overview';
import { OverviewService } from '../services/OverviewService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/overview')
@Service()
export class OverviewController {
  @Inject(() => OverviewService)
  private overviewService!: OverviewService;

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
