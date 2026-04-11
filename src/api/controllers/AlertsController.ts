import { Request } from 'express';
import { Body, Get, JsonController, Param, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  AlertDetailItem,
  AlertRouteActionResult,
  AlertsListResponse,
  AlertsSummary,
  AlertStatusActionResult,
} from '../contracts/Alert';
import { AlertsService } from '../services/AlertsService';
import {
  AlertAcknowledgeBody,
  AlertMuteBody,
  AlertRouteBody,
} from '../validators/alerts.validator';

@JsonController('/alerts')
@Service()
export class AlertsController {
  @Inject(() => AlertsService)
  private alertsService!: AlertsService;

  @Get()
  async getAlerts(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string,
    @QueryParam('severity') severity?: string,
    @QueryParam('channel') channel?: string
  ): Promise<ApiSuccessResponse<AlertsListResponse>> {
    return this.alertsService.getAlerts(requireAuthUserId(request), {
      limit,
      offset,
      status,
      search,
      severity,
      channel,
    });
  }

  @Get('/summary')
  async getAlertsSummary(@Req() request: Request): Promise<ApiSuccessResponse<AlertsSummary>> {
    return this.alertsService.getAlertsSummary(requireAuthUserId(request));
  }

  @Get('/:alertId')
  async getAlertById(
    @Req() request: Request,
    @Param('alertId') alertId: string
  ): Promise<ApiSuccessResponse<AlertDetailItem>> {
    return this.alertsService.getAlertById(requireAuthUserId(request), alertId);
  }

  @Post('/:alertId/acknowledge')
  async acknowledgeAlert(
    @Req() request: Request,
    @Param('alertId') alertId: string,
    @Body() body: AlertAcknowledgeBody
  ): Promise<ApiSuccessResponse<AlertStatusActionResult>> {
    return this.alertsService.acknowledgeAlert(requireAuthUserId(request), alertId, body);
  }

  @Post('/:alertId/mute')
  async muteAlert(
    @Req() request: Request,
    @Param('alertId') alertId: string,
    @Body() body: AlertMuteBody
  ): Promise<ApiSuccessResponse<AlertStatusActionResult>> {
    return this.alertsService.muteAlert(requireAuthUserId(request), alertId, body);
  }

  @Post('/:alertId/route')
  async routeAlert(
    @Req() request: Request,
    @Param('alertId') alertId: string,
    @Body() body: AlertRouteBody
  ): Promise<ApiSuccessResponse<AlertRouteActionResult>> {
    return this.alertsService.routeAlert(requireAuthUserId(request), alertId, body);
  }
}

import { requireAuthUserId } from '../utils/auth';
