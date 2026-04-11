import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { RiskBatchRecomputeResult } from '../contracts/Risk';
import { RiskService } from '../services/RiskService';
import { env } from '../../env';

interface RiskBatchRecomputeBody {
  actorUserId?: string;
  targetUserIds?: string[];
}

@JsonController('/internal/risk')
@Service()
export class InternalRiskSchedulerController {
  @Inject(() => RiskService)
  private riskService!: RiskService;

  @Post('/recompute')
  async recomputeBatch(
    @Body() body: RiskBatchRecomputeBody = {}
  ): Promise<ApiSuccessResponse<RiskBatchRecomputeResult>> {
    const actorUserId =
      String(body.actorUserId || '').trim() || env.scheduler.systemUserId;
    const targetUserIds = Array.isArray(body.targetUserIds)
      ? Array.from(
          new Set(
            body.targetUserIds
              .map((item) => String(item || '').trim())
              .filter(Boolean)
          )
        )
      : undefined;

    return this.riskService.recomputeRiskSnapshotBatch(
      actorUserId,
      targetUserIds?.length ? targetUserIds : undefined
    );
  }
}
