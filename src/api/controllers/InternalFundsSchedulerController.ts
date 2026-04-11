import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse, InternalSyncBody } from '../contracts';
import { successResponse } from '../utils/response';
import { FundsSchedulerService } from '../services/FundsSchedulerService';

@JsonController('/internal/funds')
@Service()
export class InternalFundsSchedulerController {
  @Inject(() => FundsSchedulerService)
  private fundsSchedulerService!: FundsSchedulerService;

  @Post('/snapshot')
  async snapshot(@Body() body: InternalSyncBody = {}): Promise<ApiSuccessResponse<unknown>> {
    const result = await this.fundsSchedulerService.runSnapshotBatch({
      targetUserIds: Array.isArray(body.targetUserIds) ? body.targetUserIds : [],
      brokerKeys: Array.isArray(body.brokerKeys) ? body.brokerKeys : [],
      accountIds: Array.isArray(body.accountIds) ? body.accountIds : [],
      runLogId: typeof body.runLogId === 'string' ? body.runLogId.trim() || undefined : undefined,
    });
    return successResponse(result);
  }
}
