import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  BrokerReconciliationBatchBody,
  BrokerReconciliationBatchResponse,
  BrokerReconciliationMatchBody,
  BrokerReconciliationMatchResponse,
  BrokerReconciliationScheduledRunBody,
  BrokerReconciliationScheduledRunResponse,
} from '../contracts/BrokerReconciliation';
import { BrokerReconciliationBatchService } from '../services/BrokerReconciliationBatchService';
import { BrokerReconciliationMatchService } from '../services/BrokerReconciliationMatchService';
import { BrokerReconciliationSchedulerService } from '../services/BrokerReconciliationSchedulerService';
import {
  DeltaBrokerReconciliationSyncInput,
  DeltaBrokerReconciliationSyncResult,
  DeltaBrokerReconciliationSyncService,
} from '../services/DeltaBrokerReconciliationSyncService';
import {
  MudrexBrokerReconciliationSyncInput,
  MudrexBrokerReconciliationSyncResult,
  MudrexBrokerReconciliationSyncService,
} from '../services/MudrexBrokerReconciliationSyncService';
import { successResponse } from '../utils/response';

@JsonController('/internal/broker-reconciliation')
@Service()
export class InternalBrokerReconciliationController {
  @Inject(() => BrokerReconciliationBatchService)
  private brokerReconciliationBatchService!: BrokerReconciliationBatchService;

  @Inject(() => BrokerReconciliationSchedulerService)
  private brokerReconciliationSchedulerService!: BrokerReconciliationSchedulerService;

  @Inject(() => BrokerReconciliationMatchService)
  private brokerReconciliationMatchService!: BrokerReconciliationMatchService;

  @Inject(() => DeltaBrokerReconciliationSyncService)
  private deltaBrokerReconciliationSyncService!: DeltaBrokerReconciliationSyncService;

  @Inject(() => MudrexBrokerReconciliationSyncService)
  private mudrexBrokerReconciliationSyncService!: MudrexBrokerReconciliationSyncService;

  @Post('/match')
  async matchAndCompare(
    @Body() body: BrokerReconciliationMatchBody
  ): Promise<ApiSuccessResponse<BrokerReconciliationMatchResponse>> {
    const result = await this.brokerReconciliationMatchService.matchAndCompare(body);
    return successResponse(result);
  }

  @Post('/batch')
  async runBatch(
    @Body() body: BrokerReconciliationBatchBody
  ): Promise<ApiSuccessResponse<BrokerReconciliationBatchResponse>> {
    const result = await this.brokerReconciliationBatchService.runBatch(body);
    return successResponse(result);
  }

  @Post('/scheduler/run')
  async runScheduledBatch(
    @Body() body: BrokerReconciliationScheduledRunBody
  ): Promise<ApiSuccessResponse<BrokerReconciliationScheduledRunResponse>> {
    const result = await this.brokerReconciliationSchedulerService.runScheduledBatch(body);
    return successResponse(result);
  }

  @Post('/delta/sync')
  async syncDelta(
    @Body() body: DeltaBrokerReconciliationSyncInput
  ): Promise<ApiSuccessResponse<DeltaBrokerReconciliationSyncResult>> {
    const result = await this.deltaBrokerReconciliationSyncService.syncAccount(body);
    return successResponse(result);
  }

  @Post('/mudrex/sync')
  async syncMudrex(
    @Body() body: MudrexBrokerReconciliationSyncInput
  ): Promise<ApiSuccessResponse<MudrexBrokerReconciliationSyncResult>> {
    const result = await this.mudrexBrokerReconciliationSyncService.syncAccount(body);
    return successResponse(result);
  }
}
