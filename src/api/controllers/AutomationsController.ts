import { Request } from 'express';
import {
  Body,
  Delete,
  Get,
  JsonController,
  Param,
  Patch,
  Post,
  QueryParam,
  Req,
} from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  AutomationActionResult,
  AutomationDeletePreview,
  AutomationHardDeleteResult,
  AutomationItem,
  AutomationsListResponse,
  AutomationsSummary,
  AutomationRunListResponse,
} from '../contracts/Automation';
import { ExecuteAutomationResult } from '../services/AutomationExecutionService';
import { AutomationsService } from '../services/AutomationsService';
import {
  AutomationActionBody,
  AutomationDeleteBody,
  CreateAutomationBody,
  UpdateAutomationBody,
} from '../validators/automations.validator';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/automations')
@Service()
export class AutomationsController {
  @Inject(() => AutomationsService)
  private automationsService!: AutomationsService;

  @Get()
  async getAutomations(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('status') status?: string,
    @QueryParam('search') search?: string
  ): Promise<ApiSuccessResponse<AutomationsListResponse>> {
    return this.automationsService.getAutomations(requireAuthUserId(request), {
      limit,
      offset,
      status,
      search,
    });
  }

  @Get('/summary')
  async getAutomationsSummary(
    @Req() request: Request
  ): Promise<ApiSuccessResponse<AutomationsSummary>> {
    return this.automationsService.getAutomationsSummary(requireAuthUserId(request));
  }

  @Get('/:automationId/delete-preview')
  async getAutomationDeletePreview(
    @Req() request: Request,
    @Param('automationId') automationId: string
  ): Promise<ApiSuccessResponse<AutomationDeletePreview>> {
    return this.automationsService.getAutomationDeletePreview(
      requireAuthUserId(request),
      automationId
    );
  }

  @Get('/:automationId')
  async getAutomationById(
    @Req() request: Request,
    @Param('automationId') automationId: string
  ): Promise<ApiSuccessResponse<AutomationItem>> {
    return this.automationsService.getAutomationById(requireAuthUserId(request), automationId);
  }

  @Get('/:automationId/runs')
  async getAutomationRuns(
    @Req() request: Request,
    @Param('automationId') automationId: string,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<AutomationRunListResponse>> {
    return this.automationsService.getAutomationRuns(requireAuthUserId(request), automationId, {
      limit,
      offset,
    });
  }

  @Post()
  async createAutomation(
    @Req() request: Request,
    @Body() body: CreateAutomationBody
  ): Promise<ApiSuccessResponse<AutomationItem>> {
    return this.automationsService.createAutomation(requireAuthUserId(request), body);
  }

  @Patch('/:automationId')
  async updateAutomation(
    @Req() request: Request,
    @Param('automationId') automationId: string,
    @Body() body: UpdateAutomationBody
  ): Promise<ApiSuccessResponse<AutomationItem>> {
    return this.automationsService.updateAutomation(requireAuthUserId(request), automationId, body);
  }

  @Delete('/:automationId')
  async hardDeleteAutomation(
    @Req() request: Request,
    @Param('automationId') automationId: string,
    @Body() body: AutomationDeleteBody
  ): Promise<ApiSuccessResponse<AutomationHardDeleteResult>> {
    return this.automationsService.hardDeleteAutomation(
      requireAuthUserId(request),
      automationId,
      body
    );
  }

  @Post('/:automationId/pause')
  async pauseAutomation(
    @Req() request: Request,
    @Param('automationId') automationId: string,
    @Body() body: AutomationActionBody
  ): Promise<ApiSuccessResponse<AutomationActionResult>> {
    return this.automationsService.pauseAutomation(requireAuthUserId(request), automationId, body);
  }

  @Post('/:automationId/resume')
  async resumeAutomation(
    @Req() request: Request,
    @Param('automationId') automationId: string,
    @Body() body: AutomationActionBody
  ): Promise<ApiSuccessResponse<AutomationActionResult>> {
    return this.automationsService.resumeAutomation(requireAuthUserId(request), automationId, body);
  }

  @Post('/:automationId/run')
  async runAutomationNow(
    @Req() request: Request,
    @Param('automationId') automationId: string
  ): Promise<ApiSuccessResponse<ExecuteAutomationResult>> {
    return this.automationsService.runAutomationNow(requireAuthUserId(request), automationId);
  }

  @Post('/:automationId/reconcile')
  async reconcileAutomationState(
    @Req() request: Request,
    @Param('automationId') automationId: string,
    @Body() body: AutomationActionBody
  ): Promise<ApiSuccessResponse<AutomationActionResult>> {
    return this.automationsService.reconcileAutomationState(
      requireAuthUserId(request),
      automationId,
      body
    );
  }
}
