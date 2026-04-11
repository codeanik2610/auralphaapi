import { Body, Get, JsonController, Put, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { SettingsAuditResponse, SettingsResponse, UpdateSettingsRequestBody } from '../contracts/Settings';
import { SettingsService } from '../services/SettingsService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/settings')
@Service()
export class SettingsController {
  @Inject(() => SettingsService)
  private settingsService!: SettingsService;

  @Get()
  async getSettings(@Req() request: Request): Promise<ApiSuccessResponse<SettingsResponse>> {
    return this.settingsService.getSettings(requireAuthUserId(request));
  }

  @Get('/audit')
  async getSettingsAudit(@Req() request: Request, @QueryParam('limit') limit?: string, @QueryParam('offset') offset?: string): Promise<ApiSuccessResponse<SettingsAuditResponse>> {
    return this.settingsService.getSettingsAudit(requireAuthUserId(request), { limit, offset });
  }

  @Put()
  async updateSettings(@Req() request: Request, @Body() body: UpdateSettingsRequestBody): Promise<ApiSuccessResponse<SettingsResponse>> {
    return this.settingsService.updateSettings(requireAuthUserId(request), body);
  }
}
