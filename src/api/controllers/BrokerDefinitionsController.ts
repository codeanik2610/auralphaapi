import { Body, Get, JsonController, Param, Put, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BrokerDefinitionItem,
  BrokerDefinitionsResponse,
  BrokerDefinitionUpsertBody,
} from '../contracts/BrokerDefinition';
import { BrokerDefinitionsService } from '../services/BrokerDefinitionsService';
import { requireAuthUser } from '../utils/auth';

@JsonController('/broker-definitions')
@Service()
export class BrokerDefinitionsController {
  @Inject(() => BrokerDefinitionsService)
  private brokerDefinitionsService!: BrokerDefinitionsService;

  @Get()
  async listDefinitions(@Req() request: Request): Promise<ApiSuccessResponse<BrokerDefinitionsResponse>> {
    return this.brokerDefinitionsService.listDefinitions(requireAuthUser(request));
  }

  @Get('/:brokerKey')
  async getDefinition(
    @Req() request: Request,
    @Param('brokerKey') brokerKey: string
  ): Promise<ApiSuccessResponse<BrokerDefinitionItem>> {
    return this.brokerDefinitionsService.getDefinition(requireAuthUser(request), brokerKey);
  }

  @Put('/:brokerKey')
  async upsertDefinition(
    @Req() request: Request,
    @Param('brokerKey') brokerKey: string,
    @Body() body: BrokerDefinitionUpsertBody
  ): Promise<ApiSuccessResponse<BrokerDefinitionItem>> {
    return this.brokerDefinitionsService.upsertDefinition(requireAuthUser(request), {
      ...body,
      brokerKey,
    });
  }
}
