import { Request } from 'express';
import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { DiscoveryFeedResponse, DiscoverySummaryResponse } from '../contracts/Discovery';
import { DiscoveryFeedService } from '../services/DiscoveryFeedService';
import { DiscoverySummaryService } from '../services/DiscoverySummaryService';
import { successResponse } from '../utils/response';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/discovery')
@Service()
export class DiscoveryController {
  @Inject(() => DiscoveryFeedService)
  private discoveryFeedService!: DiscoveryFeedService;

  @Inject(() => DiscoverySummaryService)
  private discoverySummaryService!: DiscoverySummaryService;

  @Get('/feed')
  async getFeed(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('botId') botId?: string
  ): Promise<ApiSuccessResponse<DiscoveryFeedResponse>> {
    requireAuthUserId(request);

    const authorizationHeader = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;

    return successResponse(
      await this.discoveryFeedService.getFeed(authorizationHeader, { limit, botId })
    );
  }

  @Get('/summary')
  async getSummary(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<DiscoverySummaryResponse>> {
    requireAuthUserId(request);

    const authorizationHeader = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;

    return successResponse(
      await this.discoverySummaryService.getSummary(authorizationHeader)
    );
  }
}
