import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse, InternalSyncBody } from '../contracts';
import { successResponse } from '../utils/response';
import {
  buildProductOwnedOrdersSyncRequest,
  buildSystemOwnedOrdersSyncRequest,
  POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE,
  POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE,
} from '../utils/positionsOrdersSyncScopeContract';
import { InternalOrdersSyncService } from '../services/InternalOrdersSyncService';

@JsonController('/internal/orders')
@Service()
export class InternalOrdersSchedulerController {
  @Inject(() => InternalOrdersSyncService)
  private internalOrdersSyncService!: InternalOrdersSyncService;

  @Post('/sync')
  async sync(@Body() body: InternalSyncBody = {}): Promise<ApiSuccessResponse<unknown>> {
    const request = {
      targetUserIds: Array.isArray(body.targetUserIds) ? body.targetUserIds : [],
      brokerKeys: Array.isArray(body.brokerKeys) ? body.brokerKeys : [],
      accountIds: Array.isArray(body.accountIds) ? body.accountIds : [],
      startDate: typeof body.startDate === 'string' ? body.startDate.trim() : undefined,
      endDate: typeof body.endDate === 'string' ? body.endDate.trim() : undefined,
      lookbackDays: body.lookbackDays,
      historyWindowDays: body.historyWindowDays,
      backfill: body.backfill,
      runLogId: typeof body.runLogId === 'string' ? body.runLogId.trim() || undefined : undefined,
    };
    const executionScope = typeof body.executionScope === 'string' ? body.executionScope.trim() : '';
    const requestUserId = typeof body.requestUserId === 'string' ? body.requestUserId.trim() : '';

    const result = await this.internalOrdersSyncService.runBatch(
      executionScope === POSITIONS_ORDERS_PRODUCT_SYNC_SCOPE && requestUserId
        ? buildProductOwnedOrdersSyncRequest(requestUserId, request)
        : executionScope === POSITIONS_ORDERS_SYSTEM_SYNC_SCOPE
          ? buildSystemOwnedOrdersSyncRequest(request)
          : {
              ...request,
              ...(executionScope ? { executionScope: body.executionScope } : {}),
              ...(requestUserId ? { requestUserId } : {}),
            }
    );
    return successResponse(result);
  }
}
