import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  MarketSnapshotRefreshResult,
  MarketSnapshotRefreshService,
} from '../services/MarketSnapshotRefreshService';

interface InternalMarketSnapshotRefreshBody {
  symbols?: string[];
}

@JsonController('/internal/markets')
@Service()
export class InternalMarketsSnapshotController {
  @Inject(() => MarketSnapshotRefreshService)
  private marketSnapshotRefreshService!: MarketSnapshotRefreshService;

  @Post('/snapshots/refresh')
  async refreshSnapshots(
    @Body() body: InternalMarketSnapshotRefreshBody = {}
  ): Promise<ApiSuccessResponse<MarketSnapshotRefreshResult>> {
    return this.marketSnapshotRefreshService.refreshSnapshots({
      symbols: Array.isArray(body.symbols) ? body.symbols : [],
    });
  }
}
