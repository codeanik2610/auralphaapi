import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { successResponse } from '../utils/response';
import {
  AutomationExecutionService,
  ExecuteAutomationPayload,
  ExecuteAutomationResult,
} from '../services/AutomationExecutionService';

@JsonController('/internal/automations')
@Service()
export class InternalAutomationsController {
  @Inject(() => AutomationExecutionService)
  private automationExecutionService!: AutomationExecutionService;

  @Post('/execute')
  async execute(
    @Body() body: ExecuteAutomationPayload = {}
  ): Promise<ApiSuccessResponse<ExecuteAutomationResult>> {
    const result = await this.automationExecutionService.execute(body);
    return successResponse(result);
  }
}
