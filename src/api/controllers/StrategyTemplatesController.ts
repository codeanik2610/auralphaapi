import { Body, Delete, Get, JsonController, Param, Patch, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import type { ApiSuccessResponse } from '../contracts/ApiResponse';
import type {
  StrategyTemplateDuplicateBody,
  StrategyTemplateCreateBody,
  StrategyTemplateListResponse,
  StrategyTemplateItem,
  StrategyTemplateStatusUpdateBody,
  StrategyTemplateUpdateBody,
  StrategyTemplateVersionListResponse,
} from '../contracts/StrategyTemplate';
import { StrategyTemplatesService } from '../services/StrategyTemplatesService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/strategy-templates')
@Service()
export class StrategyTemplatesController {
  @Inject(() => StrategyTemplatesService)
  private strategyTemplatesService!: StrategyTemplatesService;

  @Get()
  async listStrategyTemplates(
    @Req() request: unknown,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<StrategyTemplateListResponse>> {
    return this.strategyTemplatesService.listStrategyTemplates(
      requireAuthUserId(request),
      { limit, offset, status, search }
    );
  }

  @Get('/:strategyId')
  async getStrategyTemplateById(
    @Req() request: unknown,
    @Param('strategyId') strategyId: string
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    return this.strategyTemplatesService.getStrategyTemplateById(requireAuthUserId(request), strategyId);
  }

  @Get('/:strategyId/versions')
  async listStrategyTemplateVersions(
    @Req() request: unknown,
    @Param('strategyId') strategyId: string
  ): Promise<ApiSuccessResponse<StrategyTemplateVersionListResponse>> {
    return this.strategyTemplatesService.listStrategyTemplateVersions(
      requireAuthUserId(request),
      strategyId
    );
  }

  @Post()
  async createStrategyTemplate(
    @Req() request: unknown,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    return this.strategyTemplatesService.createStrategyTemplate(
      requireAuthUserId(request),
      body as StrategyTemplateCreateBody
    );
  }

  @Patch('/:strategyId')
  async updateStrategyTemplate(
    @Req() request: unknown,
    @Param('strategyId') strategyId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    return this.strategyTemplatesService.updateStrategyTemplate(
      requireAuthUserId(request),
      strategyId,
      body as StrategyTemplateUpdateBody
    );
  }

  @Post('/:strategyId/status')
  async updateStrategyTemplateStatus(
    @Req() request: unknown,
    @Param('strategyId') strategyId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    return this.strategyTemplatesService.updateStrategyTemplateStatus(
      requireAuthUserId(request),
      strategyId,
      body as StrategyTemplateStatusUpdateBody
    );
  }

  @Post('/:strategyId/duplicate')
  async duplicateStrategyTemplate(
    @Req() request: unknown,
    @Param('strategyId') strategyId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyTemplateItem>> {
    return this.strategyTemplatesService.duplicateStrategyTemplate(
      requireAuthUserId(request),
      strategyId,
      body as StrategyTemplateDuplicateBody
    );
  }

  @Delete('/:strategyId')
  async deleteStrategyTemplate(
    @Req() request: unknown,
    @Param('strategyId') strategyId: string
  ): Promise<ApiSuccessResponse<{ id: string }>> {
    return this.strategyTemplatesService.deleteStrategyTemplate(requireAuthUserId(request), strategyId);
  }
}
