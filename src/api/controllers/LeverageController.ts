import { Request } from 'express';
import { Get, JsonController, Param, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { MudrexLeverage } from '../contracts/Mudrex';
import { BrokerReferenceDataService } from '../services/BrokerReferenceDataService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/leverage')
@Service()
export class LeverageController {
  @Inject(() => BrokerReferenceDataService)
  private brokerReferenceDataService!: BrokerReferenceDataService;

  @Get('/futures/:assetId')
  async getFuturesLeverageByAssetId(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey: string | undefined,
    @Param('assetId') assetId: string
  ): Promise<ApiSuccessResponse<MudrexLeverage>> {
    void requireAuthUserId(request);
    return this.brokerReferenceDataService.getLeverageByAssetId(brokerKey, assetId);
  }

  @Get('/futures/symbol/:symbol')
  async getFuturesLeverageBySymbol(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey: string | undefined,
    @Param('symbol') symbol: string
  ): Promise<ApiSuccessResponse<MudrexLeverage>> {
    void requireAuthUserId(request);
    return this.brokerReferenceDataService.getLeverageBySymbol(brokerKey, symbol);
  }
}
