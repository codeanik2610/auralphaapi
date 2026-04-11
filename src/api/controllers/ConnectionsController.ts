import { Body, Delete, Get, JsonController, Param, Patch, Post, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { BrokerCatalogResponse, ConnectionActionBody, ConnectionDeleteResult, ConnectionItem, ConnectionsListResponse, ConnectionsSummary, ConnectionReconnectResult, ConnectionTestResult, ConnectionUpsertBody, ConnectionWorkspaceResponse } from '../contracts/Connection';
import { ConnectionsService } from '../services/ConnectionsService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/connections')
@Service()
export class ConnectionsController {
  @Inject(() => ConnectionsService)
  private connectionsService!: ConnectionsService;

  @Get()
  async getConnections(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('offset') offset?: string, @QueryParam('type') type?: string, @QueryParam('search') search?: string): Promise<ApiSuccessResponse<ConnectionsListResponse>> {
    return this.connectionsService.getConnections(requireAuthUserId(request), { limit, offset, type, search });
  }

  @Get('/summary')
  async getConnectionsSummary(@Req() request: Request): Promise<ApiSuccessResponse<ConnectionsSummary>> {
    return this.connectionsService.getConnectionsSummary(requireAuthUserId(request));
  }

  @Get('/catalog')
  async getBrokerCatalog(@Req() request: Request): Promise<ApiSuccessResponse<BrokerCatalogResponse>> {
    return this.connectionsService.getBrokerCatalog(requireAuthUserId(request));
  }

  @Get('/:connectionId/workspace')
  async getConnectionWorkspace(
    @Req() request: Request,
    @Param('connectionId') connectionId: string,
    @QueryParam('accountLimit') accountLimit?: string,
    @QueryParam('accountOffset') accountOffset?: string,
    @QueryParam('accountSearch') accountSearch?: string,
    @QueryParam('activityLimit') activityLimit?: string,
    @QueryParam('selectedAccountId') selectedAccountId?: string
  ): Promise<ApiSuccessResponse<ConnectionWorkspaceResponse>> {
    return this.connectionsService.getConnectionWorkspace(requireAuthUserId(request), connectionId, {
      accountLimit,
      accountOffset,
      accountSearch,
      activityLimit,
      selectedAccountId,
    });
  }

  @Post()
  async createConnection(@Req() request: Request, @Body() body: ConnectionUpsertBody): Promise<ApiSuccessResponse<ConnectionItem>> {
    return this.connectionsService.createConnection(requireAuthUserId(request), body);
  }

  @Patch('/:connectionId')
  async updateConnectionDetails(@Req() request: Request, @Param('connectionId') connectionId: string, @Body() body: ConnectionUpsertBody): Promise<ApiSuccessResponse<ConnectionItem>> {
    return this.connectionsService.updateConnectionDetails(requireAuthUserId(request), connectionId, body);
  }

  @Get('/:connectionId')
  async getConnectionById(@Req() request: Request, @Param('connectionId') connectionId: string): Promise<ApiSuccessResponse<ConnectionItem>> {
    return this.connectionsService.getConnectionById(requireAuthUserId(request), connectionId);
  }

  @Post('/:connectionId/reconnect')
  async reconnectConnection(@Req() request: Request, @Param('connectionId') connectionId: string, @Body() body: ConnectionActionBody): Promise<ApiSuccessResponse<ConnectionReconnectResult>> {
    return this.connectionsService.reconnectConnection(requireAuthUserId(request), connectionId, body);
  }

  @Post('/:connectionId/test')
  async testConnection(@Req() request: Request, @Param('connectionId') connectionId: string, @Body() body: ConnectionActionBody): Promise<ApiSuccessResponse<ConnectionTestResult>> {
    return this.connectionsService.testConnection(requireAuthUserId(request), connectionId, body);
  }

  @Delete('/:connectionId')
  async deleteConnection(
    @Req() request: Request,
    @Param('connectionId') connectionId: string
  ): Promise<ApiSuccessResponse<ConnectionDeleteResult>> {
    return this.connectionsService.deleteConnection(requireAuthUserId(request), connectionId);
  }
}
