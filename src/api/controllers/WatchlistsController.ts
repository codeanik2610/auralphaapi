import { Request } from 'express';
import { Body, Delete, Get, JsonController, Param, Patch, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  AddWatchlistItemsResponse,
  CreateWatchlistResponse,
  DeleteWatchlistResponse,
  RemoveWatchlistItemsResponse,
  UpdateWatchlistResponse,
  WatchlistItemsResponse,
  WatchlistMeta,
  WatchlistsListResponse,
  WatchlistSummary,
  WatchlistsOverviewResponse,
} from '../contracts/Watchlist';
import { WatchlistsService } from '../services/WatchlistsService';
import {
  AddWatchlistItemsPayload,
  CreateWatchlistPayload,
  RemoveWatchlistItemsPayload,
  UpdateWatchlistPayload,
} from '../validators/watchlists.validator';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/watchlists')
@Service()
export class WatchlistsController {
  @Inject(() => WatchlistsService)
  private watchlistsService!: WatchlistsService;

  @Get()
  async getWatchlists(@Req() request: Request): Promise<ApiSuccessResponse<WatchlistsListResponse>> {
    return this.watchlistsService.getWatchlists(requireAuthUserId(request));
  }

  @Get('/summary')
  async getWatchlistsSummary(@Req() request: Request): Promise<ApiSuccessResponse<WatchlistSummary>> {
    return this.watchlistsService.getWatchlistsSummary(requireAuthUserId(request));
  }

  @Get('/overview')
  async getWatchlistsOverview(
    @Req() request: Request,
    @QueryParam('watchlistId') watchlistId?: string,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<WatchlistsOverviewResponse>> {
    return this.watchlistsService.getWatchlistsOverview(requireAuthUserId(request), {
      watchlistId,
      limit,
      offset,
      search,
    });
  }

  @Post()
  async createWatchlist(
    @Req() request: Request,
    @Body() body: CreateWatchlistPayload
  ): Promise<ApiSuccessResponse<CreateWatchlistResponse>> {
    return this.watchlistsService.createWatchlist(requireAuthUserId(request), body);
  }

  @Patch('/:watchlistId')
  async updateWatchlist(
    @Req() request: Request,
    @Param('watchlistId') watchlistId: string,
    @Body() body: UpdateWatchlistPayload
  ): Promise<ApiSuccessResponse<UpdateWatchlistResponse>> {
    return this.watchlistsService.updateWatchlist(
      requireAuthUserId(request),
      watchlistId,
      body
    );
  }

  @Get('/:watchlistId')
  async getWatchlistById(
    @Req() request: Request,
    @Param('watchlistId') watchlistId: string
  ): Promise<ApiSuccessResponse<WatchlistMeta>> {
    return this.watchlistsService.getWatchlistById(requireAuthUserId(request), watchlistId);
  }

  @Delete('/:watchlistId')
  async deleteWatchlist(
    @Req() request: Request,
    @Param('watchlistId') watchlistId: string
  ): Promise<ApiSuccessResponse<DeleteWatchlistResponse>> {
    return this.watchlistsService.deleteWatchlist(requireAuthUserId(request), watchlistId);
  }

  @Get('/:watchlistId/items')
  async getWatchlistItems(
    @Req() request: Request,
    @Param('watchlistId') watchlistId: string,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<WatchlistItemsResponse>> {
    return this.watchlistsService.getWatchlistItems(requireAuthUserId(request), watchlistId, {
      limit,
      offset,
      search,
    });
  }

  @Post('/:watchlistId/items')
  async addWatchlistItems(
    @Req() request: Request,
    @Param('watchlistId') watchlistId: string,
    @Body() body: AddWatchlistItemsPayload
  ): Promise<ApiSuccessResponse<AddWatchlistItemsResponse>> {
    return this.watchlistsService.addWatchlistItems(
      requireAuthUserId(request),
      watchlistId,
      body
    );
  }

  @Delete('/:watchlistId/items')
  async removeWatchlistItems(
    @Req() request: Request,
    @Param('watchlistId') watchlistId: string,
    @Body() body: RemoveWatchlistItemsPayload
  ): Promise<ApiSuccessResponse<RemoveWatchlistItemsResponse>> {
    return this.watchlistsService.removeWatchlistItems(
      requireAuthUserId(request),
      watchlistId,
      body
    );
  }
}
