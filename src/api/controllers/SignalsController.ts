import { Request } from 'express';
import { Body, Get, JsonController, Param, Post, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  SignalItem,
  SignalPromoteActionResult,
  SignalScanRunResult,
  SignalsListResponse,
  SignalStatusActionResult,
  SignalSummary,
} from '../contracts/Signal';
import { SignalsService } from '../services/SignalsService';
import { SignalScanService } from '../services/SignalScanService';
import {
  AcknowledgeSignalBody,
  MuteSignalBody,
  PromoteSignalBody,
  RunSignalScanBody,
} from '../validators/signals.validator';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/signals')
@Service()
export class SignalsController {
  @Inject(() => SignalsService)
  private signalsService!: SignalsService;

  @Inject(() => SignalScanService)
  private signalScanService!: SignalScanService;

  @Get()
  async getSignals(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('symbol') symbol?: string,
    @QueryParam('source') source?: string,
    @QueryParam('timeframe') timeframe?: string,
    @QueryParam('search') search?: string,
    @QueryParam('view') view?: string
  ): Promise<ApiSuccessResponse<SignalsListResponse>> {
    return this.signalsService.getSignals(requireAuthUserId(request), {
      limit,
      offset,
      status,
      symbol,
      source,
      timeframe,
      search,
      view,
    });
  }

  @Get('/summary')
  async getSignalsSummary(
    @Req() request: Request,
    @QueryParam('status') status?: string,
    @QueryParam('symbol') symbol?: string,
    @QueryParam('source') source?: string,
    @QueryParam('timeframe') timeframe?: string,
    @QueryParam('search') search?: string,
    @QueryParam('view') view?: string
  ): Promise<ApiSuccessResponse<SignalSummary>> {
    return this.signalsService.getSignalsSummary(requireAuthUserId(request), {
      status,
      symbol,
      source,
      timeframe,
      search,
      view,
    });
  }

  @Get('/:signalId')
  async getSignalById(
    @Req() request: Request,
    @Param('signalId') signalId: string
  ): Promise<ApiSuccessResponse<SignalItem>> {
    return this.signalsService.getSignalById(requireAuthUserId(request), signalId);
  }

  @Post('/scan/run')
  async runSignalScan(
    @Req() request: Request,
    @Body() body: RunSignalScanBody
  ): Promise<ApiSuccessResponse<SignalScanRunResult>> {
    return this.signalScanService.runSignalScan(requireAuthUserId(request), body || {});
  }

  @Post('/:signalId/acknowledge')
  async acknowledgeSignal(
    @Req() request: Request,
    @Param('signalId') signalId: string,
    @Body() body: AcknowledgeSignalBody
  ): Promise<ApiSuccessResponse<SignalStatusActionResult>> {
    return this.signalsService.acknowledgeSignal(requireAuthUserId(request), signalId, body);
  }

  @Post('/:signalId/mute')
  async muteSignal(
    @Req() request: Request,
    @Param('signalId') signalId: string,
    @Body() body: MuteSignalBody
  ): Promise<ApiSuccessResponse<SignalStatusActionResult>> {
    return this.signalsService.muteSignal(requireAuthUserId(request), signalId, body);
  }

  @Post('/:signalId/promote')
  async promoteSignal(
    @Req() request: Request,
    @Param('signalId') signalId: string,
    @Body() body: PromoteSignalBody
  ): Promise<ApiSuccessResponse<SignalPromoteActionResult>> {
    return this.signalsService.promoteSignal(requireAuthUserId(request), signalId, body);
  }
}
