import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { MudrexFuturesFunds, MudrexWalletFunds } from '../contracts/Mudrex';
import { BrokerWalletFacadeService } from '../services/BrokerWalletFacadeService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/wallet')
@Service()
export class WalletController {
  @Inject(() => BrokerWalletFacadeService)
  private walletService!: BrokerWalletFacadeService;

  @Get('/funds')
  async getWalletFunds(@Req() request: Request, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string): Promise<ApiSuccessResponse<MudrexWalletFunds>> {
    return this.walletService.getWalletFunds(requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<MudrexWalletFunds>>;
  }

  @Get('/funds/active')
  async getActiveWalletFunds(@Req() request: Request, @QueryParam('brokerKey') brokerKey?: string): Promise<ApiSuccessResponse<unknown>> {
    return this.walletService.getWalletFundsForActiveAccounts(requireAuthUserId(request), brokerKey) as Promise<ApiSuccessResponse<unknown>>;
  }

  @Get('/futures/funds')
  async getFuturesFunds(@Req() request: Request, @QueryParam('brokerKey') brokerKey?: string, @QueryParam('accountId') accountId?: string): Promise<ApiSuccessResponse<MudrexFuturesFunds>> {
    return this.walletService.getFuturesFunds(requireAuthUserId(request), brokerKey, accountId) as Promise<ApiSuccessResponse<MudrexFuturesFunds>>;
  }

  @Get('/futures/funds/active')
  async getActiveFuturesFunds(@Req() request: Request, @QueryParam('brokerKey') brokerKey?: string): Promise<ApiSuccessResponse<unknown>> {
    return this.walletService.getFuturesFundsForActiveAccounts(requireAuthUserId(request), brokerKey) as Promise<ApiSuccessResponse<unknown>>;
  }
}
