import { Body, Get, JsonController, Param, Patch, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import type { ApiSuccessResponse } from '../contracts/ApiResponse';
import type {
  StrategyLabBacktestHandoffBody,
  StrategyLabBacktestHandoffResult,
  StrategyLabDraftBody,
  StrategyLabDraftResult,
  StrategyLabProjectItem,
  StrategyLabProjectsListResult,
  StrategyLabValidationResult,
} from '../contracts/StrategyLab';
import { StrategyLabService } from '../services/StrategyLabService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/strategy-lab')
@Service()
export class StrategyLabController {
  @Inject(() => StrategyLabService)
  private strategyLabService!: StrategyLabService;

  @Post('/projects')
  async saveStrategyLabDraft(
    @Req() request: unknown,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyLabDraftResult>> {
    return this.strategyLabService.saveStrategyLabDraft(
      requireAuthUserId(request),
      body as StrategyLabDraftBody
    );
  }

  @Get('/projects')
  async listStrategyLabProjects(
    @Req() request: unknown,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<StrategyLabProjectsListResult>> {
    return this.strategyLabService.listStrategyLabProjects(requireAuthUserId(request), {
      limit,
      offset,
      search
    });
  }

  @Get('/projects/:projectId')
  async getStrategyLabProjectById(
    @Req() request: unknown,
    @Param('projectId') projectId: string
  ): Promise<ApiSuccessResponse<StrategyLabProjectItem>> {
    return this.strategyLabService.getStrategyLabProjectById(requireAuthUserId(request), projectId);
  }

  @Patch('/projects/:projectId')
  async updateStrategyLabProject(
    @Req() request: unknown,
    @Param('projectId') projectId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyLabDraftResult>> {
    return this.strategyLabService.updateStrategyLabProject(
      requireAuthUserId(request),
      projectId,
      body as StrategyLabDraftBody
    );
  }

  @Post('/projects/:projectId/validate')
  async validateStrategyLabProject(
    @Req() request: unknown,
    @Param('projectId') projectId: string
  ): Promise<ApiSuccessResponse<StrategyLabValidationResult>> {
    return this.strategyLabService.validateStrategyLabProject(requireAuthUserId(request), projectId);
  }

  @Post('/projects/send-to-backtests')
  async sendStrategyLabToBacktests(
    @Req() request: unknown,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyLabBacktestHandoffResult>> {
    return this.strategyLabService.sendStrategyLabToBacktests(
      requireAuthUserId(request),
      body as StrategyLabBacktestHandoffBody
    );
  }
}
