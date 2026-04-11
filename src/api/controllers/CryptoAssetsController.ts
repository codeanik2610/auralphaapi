import { Get, JsonController, Post, QueryParam } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { AssetListResponse, AssetSyncSummary } from '../contracts/Asset';
import { CryptoAssetsService } from '../../brokers';

@JsonController('/crypto-assets')
@Service()
export class CryptoAssetsController {
  @Inject(() => CryptoAssetsService)
  private cryptoAssetsService!: CryptoAssetsService;

  @Post('/sync')
  async syncAssets(): Promise<ApiSuccessResponse<AssetSyncSummary>> {
    return this.cryptoAssetsService.syncAssets();
  }

  @Get()
  async getStoredAssets(
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<AssetListResponse>> {
    return this.cryptoAssetsService.getStoredAssets({
      limit,
      offset,
      search,
    });
  }
}
