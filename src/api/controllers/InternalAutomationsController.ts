import { setTimeout as sleep } from 'node:timers/promises';
import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { successResponse } from '../utils/response';
import {
  AutomationExecutionService,
  ExecuteAutomationPayload,
  ExecuteAutomationResult,
} from '../services/AutomationExecutionService';
import { Logger } from '../../lib/logger';

const log = new Logger('InternalAutomationsController');

@JsonController('/internal/automations')
@Service()
export class InternalAutomationsController {
  @Inject(() => AutomationExecutionService)
  private automationExecutionService!: AutomationExecutionService;

  @Post('/execute')
  async execute(
    @Body() body: ExecuteAutomationPayload = {}
  ): Promise<ApiSuccessResponse<ExecuteAutomationResult>> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await this.automationExecutionService.execute(body);
        return successResponse(result);
      } catch (error) {
        lastError = error;
        if (!this.isRetryableMysqlDeadlock(error) || attempt === 3) {
          throw error;
        }

        log.warn(
          `Retrying internal automation execute for ${String(body.automationId || '').trim() || 'unknown-automation'} after MySQL deadlock (attempt ${attempt}/3)`
        );
        await sleep(attempt * 150);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Unknown error'));
  }

  private isRetryableMysqlDeadlock(error: unknown): boolean {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' || normalized.includes('deadlock');
  }
}
