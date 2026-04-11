import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse, InternalSyncBody } from '../contracts';
import { successResponse } from '../utils/response';
import { buildSystemOwnedOrdersSyncRequest } from '../utils/positionsOrdersSyncScopeContract';
import { InternalOrdersSyncService } from '../services/InternalOrdersSyncService';

@JsonController('/internal/orders')
@Service()
export class InternalOrdersSchedulerController {
  @Inject(() => InternalOrdersSyncService)
  private internalOrdersSyncService!: InternalOrdersSyncService;

  @Post('/sync')
  async sync(@Body() body: InternalSyncBody = {}): Promise<ApiSuccessResponse<unknown>> {
    const result = await this.internalOrdersSyncService.runBatch(
      buildSystemOwnedOrdersSyncRequest({
        targetUserIds: Array.isArray(body.targetUserIds) ? body.targetUserIds : [],
        brokerKeys: Array.isArray(body.brokerKeys) ? body.brokerKeys : [],
        accountIds: Array.isArray(body.accountIds) ? body.accountIds : [],
        startDate: typeof body.startDate === 'string' ? body.startDate.trim() : undefined,
        endDate: typeof body.endDate === 'string' ? body.endDate.trim() : undefined,
        lookbackDays: body.lookbackDays,
        historyWindowDays: body.historyWindowDays,
        backfill: body.backfill,
        runLogId: typeof body.runLogId === 'string' ? body.runLogId.trim() || undefined : undefined,
      })
    );
    return successResponse(result);
  }
}
