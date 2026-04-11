import { Body, Delete, Get, JsonController, Param, Patch, Post, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BrokerAccountDeleteResult,
  BrokerAccountItem,
  BrokerAccountTestConfigResult,
  BrokerAccountsListResponse,
  BrokerAccountUpsertBody,
} from '../contracts/BrokerAccount';
import { BrokerAccountsService } from '../services/BrokerAccountsService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/broker-accounts')
@Service()
export class BrokerAccountsController {
  @Inject(() => BrokerAccountsService)
  private brokerAccountsService!: BrokerAccountsService;

  @Get()
  async getBrokerAccounts(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('connectionId') connectionId?: string,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<BrokerAccountsListResponse>> {
    return this.brokerAccountsService.getBrokerAccounts(requireAuthUserId(request), {
      limit,
      offset,
      connectionId,
      brokerKey,
      status,
      search,
    });
  }

  @Post()
  async createBrokerAccount(
    @Req() request: Request,
    @Body() body: BrokerAccountUpsertBody
  ): Promise<ApiSuccessResponse<BrokerAccountItem>> {
    return this.brokerAccountsService.createBrokerAccount(requireAuthUserId(request), body);
  }

  @Post('/test-config')
  async testBrokerAccountConfiguration(
    @Req() request: Request,
    @Body() body: BrokerAccountUpsertBody
  ): Promise<ApiSuccessResponse<BrokerAccountTestConfigResult>> {
    return this.brokerAccountsService.testBrokerAccountConfiguration(requireAuthUserId(request), body);
  }

  @Patch('/:accountId')
  async updateBrokerAccount(
    @Req() request: Request,
    @Param('accountId') accountId: string,
    @Body() body: BrokerAccountUpsertBody
  ): Promise<ApiSuccessResponse<BrokerAccountItem>> {
    return this.brokerAccountsService.updateBrokerAccount(requireAuthUserId(request), accountId, body);
  }

  @Delete('/:accountId')
  async deleteBrokerAccount(
    @Req() request: Request,
    @Param('accountId') accountId: string
  ): Promise<ApiSuccessResponse<BrokerAccountDeleteResult>> {
    return this.brokerAccountsService.deleteBrokerAccount(requireAuthUserId(request), accountId);
  }
}
