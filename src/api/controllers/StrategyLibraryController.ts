import { Body, Delete, Get, JsonController, Param, Patch, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import type { ApiSuccessResponse } from '../contracts/ApiResponse';
import type {
  StrategyLibraryImportBody,
  StrategyLibraryItem,
  StrategyLibraryListResponse,
  StrategyLibraryRunBody,
  StrategyLibraryRunResult,
  StrategyLibraryRunsResponse,
  StrategyLibraryStatusUpdateBody,
  StrategyLibraryUpdateBody,
} from '../contracts/StrategyLibrary';
import { StrategyLibraryService } from '../services/StrategyLibraryService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/strategy-library')
@Service()
export class StrategyLibraryController {
  @Inject(() => StrategyLibraryService)
  private strategyLibraryService!: StrategyLibraryService;

  @Get()
  async listLibrary(
    @Req() request: unknown,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('sort') sort?: string,
    @QueryParam('hasAssets') hasAssets?: string,
    @QueryParam('hasTimeframes') hasTimeframes?: string,
    @QueryParam('scopeReady') scopeReady?: string,
    @QueryParam('automationReady') automationReady?: string,
    @QueryParam('lastRunFailed') lastRunFailed?: string
  ): Promise<ApiSuccessResponse<StrategyLibraryListResponse>> {
    return this.strategyLibraryService.listLibrary(
      requireAuthUserId(request),
      {
        limit,
        offset,
        status,
        search,
        sort,
        hasAssets,
        hasTimeframes,
        scopeReady,
        automationReady,
        lastRunFailed,
      }
    );
  }

  @Get('/:libraryId')
  async getLibraryById(
    @Req() request: unknown,
    @Param('libraryId') libraryId: string
  ): Promise<ApiSuccessResponse<StrategyLibraryItem>> {
    return this.strategyLibraryService.getLibraryById(requireAuthUserId(request), libraryId);
  }

  @Get('/:libraryId/runs')
  async getLibraryRuns(
    @Req() request: unknown,
    @Param('libraryId') libraryId: string,
    @QueryParam('limit') limit?: string
  ): Promise<ApiSuccessResponse<StrategyLibraryRunsResponse>> {
    return this.strategyLibraryService.getLibraryRuns(
      requireAuthUserId(request),
      libraryId,
      { limit }
    );
  }

  @Post('/import')
  async importTemplate(
    @Req() request: unknown,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyLibraryItem>> {
    return this.strategyLibraryService.importTemplate(
      requireAuthUserId(request),
      body as StrategyLibraryImportBody
    );
  }

  @Patch('/:libraryId')
  async updateLibrary(
    @Req() request: unknown,
    @Param('libraryId') libraryId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyLibraryItem>> {
    return this.strategyLibraryService.updateLibrary(
      requireAuthUserId(request),
      libraryId,
      body as StrategyLibraryUpdateBody
    );
  }

  @Post('/:libraryId/status')
  async updateLibraryStatus(
    @Req() request: unknown,
    @Param('libraryId') libraryId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyLibraryItem>> {
    return this.strategyLibraryService.updateLibraryStatus(
      requireAuthUserId(request),
      libraryId,
      body as StrategyLibraryStatusUpdateBody
    );
  }

  @Delete('/:libraryId')
  async deleteLibrary(
    @Req() request: unknown,
    @Param('libraryId') libraryId: string
  ): Promise<ApiSuccessResponse<{ id: string }>> {
    return this.strategyLibraryService.deleteLibrary(requireAuthUserId(request), libraryId);
  }

  @Post('/:libraryId/run')
  async runLibraryStrategy(
    @Req() request: unknown,
    @Param('libraryId') libraryId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StrategyLibraryRunResult>> {
    return this.strategyLibraryService.runLibraryStrategy(
      requireAuthUserId(request),
      libraryId,
      body as StrategyLibraryRunBody
    );
  }
}
