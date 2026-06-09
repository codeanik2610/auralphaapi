import { Get, JsonController, Param, QueryParam, Req } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BrokerReconciliationRunDetailResponse,
  BrokerReconciliationRunListResponse,
  BrokerReconciliationUnmatchedEvidenceResponse,
} from '../contracts/BrokerReconciliation';
import { BrokerReconciliationReadService } from '../services/BrokerReconciliationReadService';
import { requireAuthUserId } from '../utils/auth';

@JsonController('/broker-reconciliation')
@Service()
export class BrokerReconciliationController {
  @Inject(() => BrokerReconciliationReadService)
  private brokerReconciliationReadService!: BrokerReconciliationReadService;

  @Get('/runs')
  async listRuns(
    @Req() request: unknown,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string,
    @QueryParam('status') status?: string,
    @QueryParam('runType') runType?: string
  ): Promise<ApiSuccessResponse<BrokerReconciliationRunListResponse>> {
    return this.brokerReconciliationReadService.listRuns(requireAuthUserId(request), {
      limit,
      offset,
      brokerKey,
      accountId,
      status,
      runType,
    });
  }

  @Get('/runs/:runId')
  async getRunDetail(
    @Req() request: unknown,
    @Param('runId') runId: string
  ): Promise<ApiSuccessResponse<BrokerReconciliationRunDetailResponse>> {
    return this.brokerReconciliationReadService.getRunDetail(requireAuthUserId(request), runId);
  }

  @Get('/runs/:runId/unmatched')
  async listRunUnmatchedEvidence(
    @Req() request: unknown,
    @Param('runId') runId: string,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string,
    @QueryParam('kind') kind?: string
  ): Promise<ApiSuccessResponse<BrokerReconciliationUnmatchedEvidenceResponse>> {
    return this.brokerReconciliationReadService.listRunUnmatchedEvidence(
      requireAuthUserId(request),
      runId,
      {
        limit,
        offset,
        kind,
      }
    );
  }
}
