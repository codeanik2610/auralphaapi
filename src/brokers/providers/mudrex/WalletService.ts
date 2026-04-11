import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../../../api';
import { MudrexFuturesFunds, MudrexWalletFunds } from '../../../api';
import { successResponse } from '../../../api';
import { rethrowMudrexError } from './MudrexErrorMapper';
import { MudrexHttpClient } from './MudrexHttpClient';

@Service()
export class WalletService {
  @Inject(() => MudrexHttpClient)
  private mudrexHttpClient!: MudrexHttpClient;

  async getWalletFunds(
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexWalletFunds>> {
    try {
      const data = await this.mudrexHttpClient.authenticatedGet<MudrexWalletFunds>(
        userId,
        accountId,
        '/fapi/v1/wallet/funds'
      );
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex wallet service');
    }
  }

  async getFuturesFunds(
    userId?: string,
    accountId?: string
  ): Promise<ApiSuccessResponse<MudrexFuturesFunds>> {
    try {
      const data = await this.mudrexHttpClient.authenticatedGet<MudrexFuturesFunds>(
        userId,
        accountId,
        '/fapi/v1/futures/funds'
      );
      return successResponse(data);
    } catch (error) {
      return rethrowMudrexError(error, 'Mudrex futures funds service');
    }
  }
}
