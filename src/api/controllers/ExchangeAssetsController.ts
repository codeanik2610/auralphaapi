import { Get, JsonController, Post, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { ExchangeAssetListResponse, ExchangeAssetSyncSummary } from '../contracts/ExchangeAsset';
import { ExchangeAssetsService } from '../services/ExchangeAssetsService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/exchange-assets')
@Service()
export class ExchangeAssetsController {
  @Inject(() => ExchangeAssetsService)
  private exchangeAssetsService!: ExchangeAssetsService;

  @Post('/sync')
  async syncExchangeAssets(@Req() request: Request, @QueryParam('source') source?: string): Promise<ApiSuccessResponse<ExchangeAssetSyncSummary>> {
    return this.exchangeAssetsService.syncExchangeAssets(requireAuthUserId(request), source && source.trim() ? source.trim() : 'mudrex');
  }

  @Get()
  async getStoredExchangeAssets(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('offset') offset?: string, @QueryParam('search') search?: string, @QueryParam('source') source?: string): Promise<ApiSuccessResponse<ExchangeAssetListResponse>> {
    return this.exchangeAssetsService.getStoredExchangeAssets(requireAuthUserId(request), { limit, offset, search, source });
  }
}
