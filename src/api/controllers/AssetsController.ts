import { Request } from 'express';
import { Get, JsonController, Param, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { ReferenceCatalogResponse } from '../contracts/Asset';
import { MarketPriceResult } from '../contracts/MarketPrice';
import { MudrexAsset, MudrexAssetDetail } from '../contracts/Mudrex';
import { BrokerReferenceDataService } from '../services/BrokerReferenceDataService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/assets')
@Service()
export class AssetsController {
  @Inject(() => BrokerReferenceDataService)
  private brokerReferenceDataService!: BrokerReferenceDataService;

  @Get('/catalog')
  async getReferenceCatalog(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<ReferenceCatalogResponse>> {
    return this.brokerReferenceDataService.getReferenceCatalog(requireAuthUserId(request));
  }

  @Get('/futures')
  async getFuturesAssets(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('sort') sort?: string,
    @QueryParam('order') order?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('limit') limit?: string
  ): Promise<ApiSuccessResponse<MudrexAsset[]>> {
    void requireAuthUserId(request);
    return this.brokerReferenceDataService.getFuturesAssets(brokerKey, {
      sort,
      order,
      offset,
      limit,
    });
  }

  @Get('/futures/:assetId')
  async getFuturesAsset(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey: string | undefined,
    @Param('assetId') assetId: string
  ): Promise<ApiSuccessResponse<MudrexAssetDetail>> {
    void requireAuthUserId(request);
    return this.brokerReferenceDataService.getFuturesAsset(brokerKey, assetId);
  }

  @Get('/futures/symbol/:symbol')
  async getFuturesAssetBySymbol(
    @Req() request: Request,
    @Param('symbol') symbol: string
  ): Promise<ApiSuccessResponse<MarketPriceResult>> {
    void requireAuthUserId(request);
    return this.brokerReferenceDataService.getFuturesAssetBySymbol(symbol);
  }
}
