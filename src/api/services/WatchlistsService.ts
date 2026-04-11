import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  AddWatchlistItemsResponse,
  CreateWatchlistResponse,
  DeleteWatchlistResponse,
  RemoveWatchlistItemsResponse,
  UpdateWatchlistResponse,
  WatchlistItem,
  WatchlistItemsResponse,
  WatchlistMeta,
  WatchlistsListResponse,
  WatchlistSummary,
  WatchlistsOverviewResponse,
} from '../contracts/Watchlist';
import { BadRequestAppError, ConflictAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  AddWatchlistItemsPayload,
  CreateWatchlistPayload,
  validateWatchlistId,
  validateAddWatchlistItemsPayload,
  validateCreateWatchlistPayload,
  validateUpdateWatchlistPayload,
  validateRemoveWatchlistItemsPayload,
  validateWatchlistItemsQuery,
  RemoveWatchlistItemsPayload,
  UpdateWatchlistPayload,
  WatchlistItemsQuery,
} from '../validators/watchlists.validator';
import { Watchlist, WatchlistItem as WatchlistItemEntity } from '../../database';
import { WatchlistRepository } from '../../database';
import { OperationalEventService } from './OperationalEventService';
import { MarketMetric, MarketMetricsService } from './MarketMetricsService';

@Service()
export class WatchlistsService {
  @Inject(() => WatchlistRepository)
  private watchlistRepository!: WatchlistRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  @Inject(() => MarketMetricsService)
  private marketMetricsService!: MarketMetricsService;

  async getWatchlists(userId: string): Promise<ApiSuccessResponse<WatchlistsListResponse>> {
    const watchlists = await this.watchlistRepository.listWatchlists(userId);

    return successResponse({
      items: watchlists.map((watchlist) => this.mapWatchlistMeta(watchlist)),
    });
  }

  async getWatchlistsSummary(userId: string): Promise<ApiSuccessResponse<WatchlistSummary>> {
    const summary = await this.watchlistRepository.getWatchlistsSummary(userId);
    return successResponse(summary);
  }

  async getWatchlistsOverview(
    userId: string,
    query: WatchlistItemsQuery & { watchlistId?: string }
  ): Promise<ApiSuccessResponse<WatchlistsOverviewResponse>> {
    const [watchlists, summary] = await Promise.all([
      this.watchlistRepository.listWatchlists(userId),
      this.watchlistRepository.getWatchlistsSummary(userId),
    ]);

    const params = validateWatchlistItemsQuery(query);

    let activeWatchlistId: string | null = null;
    if (query.watchlistId) {
      const normalized = query.watchlistId.trim();
      if (normalized && watchlists.some((item) => item.id === normalized)) {
        activeWatchlistId = normalized;
      }
    }

    if (!activeWatchlistId && watchlists.length) {
      activeWatchlistId = watchlists[0].id;
    }

    const activeWatchlist = activeWatchlistId
      ? this.mapWatchlistMeta(
          watchlists.find((item) => item.id === activeWatchlistId) as Watchlist
        )
      : null;

    let itemsResponse: WatchlistItemsResponse = {
      items: [],
      total: 0,
      limit: params.limit,
      offset: params.offset,
    };

    if (activeWatchlistId) {
      const { items, total } = await this.watchlistRepository.listWatchlistItems(
        userId,
        activeWatchlistId,
        params
      );
      const metricsBySymbol = await this.marketMetricsService.getMetricsForSymbols(
        items.map((item) => item.symbol)
      );
      itemsResponse = {
        items: items.map((item) =>
          this.mapWatchlistItem(
            item,
            metricsBySymbol.get(String(item.symbol || '').toUpperCase())
          )
        ),
        total,
        limit: params.limit,
        offset: params.offset,
      };
    }

    return successResponse({
      watchlists: { items: watchlists.map((watchlist) => this.mapWatchlistMeta(watchlist)) },
      summary,
      activeWatchlistId,
      activeWatchlist,
      items: itemsResponse,
    });
  }

  async createWatchlist(
    userId: string,
    payload: CreateWatchlistPayload
  ): Promise<ApiSuccessResponse<CreateWatchlistResponse>> {
    const validated = validateCreateWatchlistPayload(payload);
    try {
      const created = await this.watchlistRepository.createWatchlist(userId, validated);
      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist created: ' + created.name,
        status: 'Success',
        route: 'Watchlists',
        stream: 'Definitions',
        referenceId: created.id,
        description: 'Watchlist created',
      });
      return successResponse({
        watchlist: this.mapWatchlistMeta(created),
        message: 'Watchlist created',
      });
    } catch (error) {
      const mappedError = this.mapPersistenceError(error, validated.name);
      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist creation failed',
        status: 'Failed',
        route: 'Watchlists',
        stream: 'Definitions',
        description: mappedError.message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Watchlists',
        source: 'watchlists',
        message: `Watchlist create failed (${validated.name}): ${mappedError.message}`,
        route: 'Watchlists',
      });
      throw mappedError;
    }
  }

  async updateWatchlist(
    userId: string,
    watchlistId: string,
    payload: UpdateWatchlistPayload
  ): Promise<ApiSuccessResponse<UpdateWatchlistResponse>> {
    const validatedWatchlistId = validateWatchlistId(watchlistId);
    const validated = validateUpdateWatchlistPayload(payload);
    try {
      await this.requireEditableWatchlist(userId, validatedWatchlistId);
      const updated = await this.watchlistRepository.updateWatchlist(
        userId,
        validatedWatchlistId,
        validated
      );

      if (!updated) {
        throw new NotFoundAppError('Watchlist not found');
      }

      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist updated: ' + updated.name,
        status: 'Success',
        route: 'Watchlists',
        stream: 'Definitions',
        referenceId: updated.id,
        description: 'Watchlist metadata updated',
      });

      return successResponse({
        watchlist: this.mapWatchlistMeta(updated),
        message: 'Watchlist updated',
      });
    } catch (error) {
      const mappedError = this.mapPersistenceError(error, validated.name);
      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist update failed',
        status: 'Failed',
        route: 'Watchlists',
        stream: 'Definitions',
        referenceId: validatedWatchlistId,
        description: mappedError.message,
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Watchlists',
        source: 'watchlists',
        message: `Watchlist update failed (${validatedWatchlistId}): ${mappedError.message}`,
        route: 'Watchlists',
      });
      throw mappedError;
    }
  }

  async getWatchlistById(userId: string, watchlistId: string): Promise<ApiSuccessResponse<WatchlistMeta>> {
    const watchlist = await this.requireWatchlist(userId, watchlistId);
    return successResponse(this.mapWatchlistMeta(watchlist));
  }

  async deleteWatchlist(
    userId: string,
    watchlistId: string
  ): Promise<ApiSuccessResponse<DeleteWatchlistResponse>> {
    const validatedWatchlistId = validateWatchlistId(watchlistId);
    try {
      await this.requireEditableWatchlist(userId, validatedWatchlistId);
      await this.watchlistRepository.deleteWatchlist(userId, validatedWatchlistId);
      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist deleted',
        status: 'Success',
        route: 'Watchlists',
        stream: 'Definitions',
        referenceId: validatedWatchlistId,
        description: 'Watchlist deleted',
      });
      return successResponse({
        watchlistId: validatedWatchlistId,
        message: 'Watchlist deleted',
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist delete failed',
        status: 'Failed',
        route: 'Watchlists',
        stream: 'Definitions',
        referenceId: validatedWatchlistId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Watchlists',
        source: 'watchlists',
        message: `Watchlist delete failed (${validatedWatchlistId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Watchlists',
      });
      throw error;
    }
  }

  async getWatchlistItems(
    userId: string,
    watchlistId: string,
    query: WatchlistItemsQuery
  ): Promise<ApiSuccessResponse<WatchlistItemsResponse>> {
    const validatedWatchlistId = validateWatchlistId(watchlistId);
    const params = validateWatchlistItemsQuery(query);
    await this.requireWatchlist(userId, validatedWatchlistId);

    const { items, total } = await this.watchlistRepository.listWatchlistItems(
      userId,
      validatedWatchlistId,
      params
    );
    const metricsBySymbol = await this.marketMetricsService.getMetricsForSymbols(
      items.map((item) => item.symbol)
    );

    return successResponse({
      items: items.map((item) =>
        this.mapWatchlistItem(
          item,
          metricsBySymbol.get(String(item.symbol || '').toUpperCase())
        )
      ),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async addWatchlistItems(
    userId: string,
    watchlistId: string,
    payload: AddWatchlistItemsPayload
  ): Promise<ApiSuccessResponse<AddWatchlistItemsResponse>> {
    const validatedWatchlistId = validateWatchlistId(watchlistId);
    const validated = validateAddWatchlistItemsPayload(payload);
    try {
      await this.requireEditableWatchlist(userId, validatedWatchlistId);

      const { added, skipped } = await this.watchlistRepository.addWatchlistItems(
        userId,
        validatedWatchlistId,
        validated.symbols
      );

      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist items added',
        status: 'Success',
        route: 'Watchlists',
        stream: 'Items',
        referenceId: validatedWatchlistId,
        description: `Added ${added.length} symbols`,
      });

      return successResponse({
        added,
        skipped,
        message: added.length ? 'Watchlist updated' : 'No new symbols added',
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist add items failed',
        status: 'Failed',
        route: 'Watchlists',
        stream: 'Items',
        referenceId: validatedWatchlistId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Watchlists',
        source: 'watchlists',
        message: `Watchlist add items failed (${validatedWatchlistId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Watchlists',
      });
      throw error;
    }
  }

  async removeWatchlistItems(
    userId: string,
    watchlistId: string,
    payload: RemoveWatchlistItemsPayload
  ): Promise<ApiSuccessResponse<RemoveWatchlistItemsResponse>> {
    const validatedWatchlistId = validateWatchlistId(watchlistId);
    const validated = validateRemoveWatchlistItemsPayload(payload);
    try {
      await this.requireEditableWatchlist(userId, validatedWatchlistId);

      const { removed, skipped } = await this.watchlistRepository.removeWatchlistItems(
        userId,
        validatedWatchlistId,
        validated.symbols
      );

      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist items removed',
        status: 'Success',
        route: 'Watchlists',
        stream: 'Items',
        referenceId: validatedWatchlistId,
        description: `Removed ${removed.length} symbols`,
      });

      return successResponse({
        removed,
        skipped,
        message: removed.length ? 'Watchlist items removed' : 'No matching symbols found',
      });
    } catch (error) {
      await this.operationalEventService.logActivity(userId, {
        type: 'Watchlist',
        title: 'Watchlist remove items failed',
        status: 'Failed',
        route: 'Watchlists',
        stream: 'Items',
        referenceId: validatedWatchlistId,
        description: error instanceof Error ? error.message : String(error),
      });
      await this.operationalEventService.emitFailureAlert(userId, {
        channel: 'Watchlists',
        source: 'watchlists',
        message: `Watchlist remove items failed (${validatedWatchlistId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Watchlists',
      });
      throw error;
    }
  }

  private async requireWatchlist(userId: string, watchlistId: string): Promise<Watchlist> {
    const validatedWatchlistId = validateWatchlistId(watchlistId);
    const watchlist = await this.watchlistRepository.getWatchlistById(userId, validatedWatchlistId);

    if (!watchlist) {
      throw new NotFoundAppError('Watchlist not found');
    }

    return watchlist;
  }

  private async requireEditableWatchlist(userId: string, watchlistId: string): Promise<Watchlist> {
    const watchlist = await this.requireWatchlist(userId, watchlistId);

    if (!this.isEditableWatchlist(watchlist)) {
      throw new BadRequestAppError(
        'This watchlist is system-managed and cannot be edited from the watchlists workspace'
      );
    }

    return watchlist;
  }

  private mapWatchlistMeta(watchlist: Watchlist): WatchlistMeta {
    return {
      id: watchlist.id,
      name: watchlist.name,
      type: watchlist.type,
      editable: this.isEditableWatchlist(watchlist),
      itemsCount: Number(watchlist.itemsCount ?? watchlist.items?.length ?? 0),
      updatedAt: watchlist.updatedAt.toISOString(),
      description: watchlist.description ?? '',
    };
  }

  private isEditableWatchlist(watchlist: Watchlist): boolean {
    return String(watchlist.type || '').trim().toLowerCase() === 'manual';
  }

  private mapPersistenceError(error: unknown, watchlistName?: string): Error {
    if (
      error instanceof ConflictAppError ||
      error instanceof BadRequestAppError ||
      error instanceof NotFoundAppError
    ) {
      return error;
    }

    if (this.watchlistRepository.isDuplicateWatchlistNameError(error)) {
      return new ConflictAppError(this.buildDuplicateWatchlistNameMessage(watchlistName));
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private buildDuplicateWatchlistNameMessage(name?: string): string {
    const attemptedName = String(name || '').trim() || 'the requested name';
    return `A watchlist named "${attemptedName}" already exists for this workspace. Choose a different name or update the existing list.`;
  }

  private mapWatchlistItem(item: WatchlistItemEntity, metrics?: MarketMetric): WatchlistItem {
    const volume24h =
      metrics?.volume24h ??
      (item.volume24h === undefined || item.volume24h === null ? 0 : item.volume24h);
    const change24h =
      metrics?.changePerc ??
      (item.change24h === undefined || item.change24h === null ? 0 : item.change24h);
    const lastPrice = metrics?.lastPrice ?? 0;
    const high24h = metrics?.high24h ?? 0;
    const low24h = metrics?.low24h ?? 0;
    const liquidity =
      item.liquidity ??
      (volume24h >= 1_000_000_000
        ? 'Deep'
        : volume24h >= 100_000_000
          ? 'Core'
          : volume24h >= 10_000_000
            ? 'Active'
            : volume24h > 0
              ? 'Thin'
              : '--');

    return {
      id: item.id,
      symbol: item.symbol,
      regime: item.regime ?? '--',
      signal: item.signal ?? '--',
      aiScore: item.aiScore ?? 0,
      lastPrice,
      change24h,
      volume24h,
      high24h,
      low24h,
      setup: item.setup ?? '--',
      status: item.status ?? '--',
      alerts: item.alerts,
      liquidity,
      priceSource: metrics?.priceSource ?? '--',
      snapshotAt: metrics?.snapshotAt ? metrics.snapshotAt.toISOString() : '',
    };
  }
}
