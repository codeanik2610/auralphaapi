import {
  Body,
  Delete,
  Get,
  JsonController,
  Param,
  Patch,
  Post,
  QueryParam,
  Req,
  Res,
} from 'routing-controllers';
import { Inject, Service } from 'typedi';
import type { Response } from 'express';
import type { ApiSuccessResponse } from '../contracts';
import type {
  ActivityActionFilterBody,
  ActivityDetailItem,
  ActivityExportBody,
  ActivityExportListResponse,
  ActivityExportResult,
  ActivityListResponse,
  ActivityReadActionResult,
  ActivitySavedViewItem,
  ActivitySavedViewListResponse,
  ActivitySaveViewBody,
  ActivitySummary,
} from '../contracts';
import { ActivityService } from '../services/ActivityService';
import type { ActivityQuery } from '../validators/activity.validator';
import { requireAuthUserId } from '../utils';

interface ActivityQueryInput {
  limit?: string;
  offset?: string;
  sortBy?: string;
  sortOrder?: string;
  view?: string;
  groupBy?: string;
  readState?: string;
  type?: string;
  status?: string;
  search?: string;
  stream?: string;
  route?: string;
  referenceId?: string;
  correlationId?: string;
  related?: string;
  savedViewId?: string;
}

const mergeActivityActionFilters = (
  body: ActivityActionFilterBody = {},
  query: ActivityQuery = {}
): ActivityActionFilterBody => ({
  type: body.type ?? query.type,
  status: body.status ?? query.status,
  search: body.search ?? query.search,
  stream: body.stream ?? query.stream,
  route: body.route ?? query.route,
  referenceId: body.referenceId ?? query.referenceId,
  correlationId: body.correlationId ?? query.correlationId,
  related: body.related ?? query.related,
  readState: body.readState ?? query.readState,
  savedViewId: body.savedViewId ?? query.savedViewId,
});

const buildActivityQuery = (query: ActivityQueryInput): ActivityQuery =>
  Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined)
  ) as ActivityQuery;

@JsonController('/activity')
@Service()
export class ActivityController {
  @Inject(() => ActivityService)
  private activityService!: ActivityService;

  @Get()
  async getActivity(
    @Req() request: unknown,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('sortBy') sortBy?: string,
    @QueryParam('sortOrder') sortOrder?: string,
    @QueryParam('view') view?: string,
    @QueryParam('groupBy') groupBy?: string,
    @QueryParam('readState') readState?: string,
    @QueryParam('type') type?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('stream') stream?: string,
    @QueryParam('route') route?: string,
    @QueryParam('referenceId') referenceId?: string,
    @QueryParam('correlationId') correlationId?: string,
    @QueryParam('related') related?: string,
    @QueryParam('savedViewId') savedViewId?: string
  ): Promise<ApiSuccessResponse<ActivityListResponse>> {
    const query = buildActivityQuery({
      limit,
      offset,
      sortBy,
      sortOrder,
      view,
      groupBy,
      readState,
      type,
      status,
      search,
      stream,
      route,
      referenceId,
      correlationId,
      related,
      savedViewId,
    });
    return this.activityService.getActivity(requireAuthUserId(request), query);
  }

  @Get('/summary')
  async getActivitySummary(
    @Req() request: unknown,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('sortBy') sortBy?: string,
    @QueryParam('sortOrder') sortOrder?: string,
    @QueryParam('view') view?: string,
    @QueryParam('groupBy') groupBy?: string,
    @QueryParam('readState') readState?: string,
    @QueryParam('type') type?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('stream') stream?: string,
    @QueryParam('route') route?: string,
    @QueryParam('referenceId') referenceId?: string,
    @QueryParam('correlationId') correlationId?: string,
    @QueryParam('related') related?: string,
    @QueryParam('savedViewId') savedViewId?: string
  ): Promise<ApiSuccessResponse<ActivitySummary>> {
    const query = buildActivityQuery({
      limit,
      offset,
      sortBy,
      sortOrder,
      view,
      groupBy,
      readState,
      type,
      status,
      search,
      stream,
      route,
      referenceId,
      correlationId,
      related,
      savedViewId,
    });
    const userId = requireAuthUserId(request);
    return Object.keys(query).length
      ? this.activityService.getScopedActivitySummary(userId, query)
      : this.activityService.getActivitySummary(userId);
  }

  @Get('/views')
  async getActivitySavedViews(
    @Req() request: unknown
  ): Promise<ApiSuccessResponse<ActivitySavedViewListResponse>> {
    return this.activityService.listActivitySavedViews(requireAuthUserId(request));
  }

  @Post('/views')
  async createActivitySavedView(
    @Req() request: unknown,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<ActivitySavedViewItem>> {
    return this.activityService.createActivitySavedView(
      requireAuthUserId(request),
      body as ActivitySaveViewBody
    );
  }

  @Patch('/views/:viewId')
  async updateActivitySavedView(
    @Req() request: unknown,
    @Param('viewId') viewId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<ActivitySavedViewItem>> {
    return this.activityService.updateActivitySavedView(
      requireAuthUserId(request),
      viewId,
      body as ActivitySaveViewBody
    );
  }

  @Delete('/views/:viewId')
  async deleteActivitySavedView(
    @Req() request: unknown,
    @Param('viewId') viewId: string
  ): Promise<ApiSuccessResponse<{ message: string }>> {
    return this.activityService.deleteActivitySavedView(requireAuthUserId(request), viewId);
  }

  @Post('/read-all')
  async markAllActivityRead(
    @Req() request: unknown,
    @Body() body: unknown = {},
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('sortBy') sortBy?: string,
    @QueryParam('sortOrder') sortOrder?: string,
    @QueryParam('view') view?: string,
    @QueryParam('groupBy') groupBy?: string,
    @QueryParam('readState') readState?: string,
    @QueryParam('type') type?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('stream') stream?: string,
    @QueryParam('route') route?: string,
    @QueryParam('referenceId') referenceId?: string,
    @QueryParam('correlationId') correlationId?: string,
    @QueryParam('related') related?: string,
    @QueryParam('savedViewId') savedViewId?: string
  ): Promise<ApiSuccessResponse<ActivityReadActionResult>> {
    const query = buildActivityQuery({
      limit,
      offset,
      sortBy,
      sortOrder,
      view,
      groupBy,
      readState,
      type,
      status,
      search,
      stream,
      route,
      referenceId,
      correlationId,
      related,
      savedViewId,
    });
    return this.activityService.markAllActivityRead(
      requireAuthUserId(request),
      mergeActivityActionFilters(body as ActivityActionFilterBody, query)
    );
  }

  @Get('/exports')
  async getActivityExports(
    @Req() request: unknown,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<ActivityExportListResponse>> {
    return this.activityService.listActivityExports(requireAuthUserId(request), buildActivityQuery({ limit, offset }));
  }

  @Get('/exports/:exportId')
  async getActivityExportById(
    @Req() request: unknown,
    @Param('exportId') exportId: string
  ): Promise<ApiSuccessResponse<ActivityExportResult>> {
    return this.activityService.getActivityExportById(requireAuthUserId(request), exportId);
  }

  @Get('/exports/:exportId/download')
  async downloadActivityExport(
    @Req() request: unknown,
    @Param('exportId') exportId: string,
    @Res() response: Response
  ): Promise<Response> {
    const file = await this.activityService.getActivityExportDownload(
      requireAuthUserId(request),
      exportId
    );
    response.type(file.contentType);
    response.download(file.filePath, file.fileName);
    return response;
  }

  @Get('/:activityId')
  async getActivityById(
    @Req() request: unknown,
    @Param('activityId') activityId: string
  ): Promise<ApiSuccessResponse<ActivityDetailItem>> {
    return this.activityService.getActivityById(requireAuthUserId(request), activityId);
  }

  @Post('/:activityId/read')
  async markActivityRead(
    @Req() request: unknown,
    @Param('activityId') activityId: string
  ): Promise<ApiSuccessResponse<ActivityReadActionResult>> {
    return this.activityService.markActivityRead(requireAuthUserId(request), activityId);
  }

  @Post('/:activityId/unread')
  async markActivityUnread(
    @Req() request: unknown,
    @Param('activityId') activityId: string
  ): Promise<ApiSuccessResponse<ActivityReadActionResult>> {
    return this.activityService.markActivityUnread(requireAuthUserId(request), activityId);
  }

  @Post('/export')
  async exportActivity(
    @Req() request: unknown,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<ActivityExportResult>> {
    return this.activityService.exportActivity(
      requireAuthUserId(request),
      body as ActivityExportBody
    );
  }
}
