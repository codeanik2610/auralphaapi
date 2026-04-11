import { Get, JsonController, QueryParam, Req } from 'routing-controllers';
import { Request } from 'express';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { requireAuthUserId } from '../utils/auth';
import { FundsSnapshotRepository } from '../../database/repositories/FundsSnapshotRepository';

@JsonController('/funds-snapshots')
@Service()
export class FundsSnapshotsController {
  @Inject(() => FundsSnapshotRepository)
  private fundsSnapshotRepository!: FundsSnapshotRepository;

  @Get('')
  async listSnapshots(
    @Req() request: Request,
    @QueryParam('limit') limit?: string,
    @QueryParam('offset') offset?: string
  ): Promise<ApiSuccessResponse<unknown>> {
    const resolvedLimit = limit ? Number(limit) : 20;
    const resolvedOffset = offset ? Number(offset) : 0;
    const result = await this.fundsSnapshotRepository.listSnapshots(requireAuthUserId(request), {
      limit: resolvedLimit,
      offset: resolvedOffset
    });

    return {
      success: true,
      data: {
        items: result.items,
        total: result.total,
        limit: resolvedLimit,
        offset: resolvedOffset
      }
    };
  }

  @Get('/latest')
  async getLatest(
    @Req() request: Request,
    @QueryParam('brokerKey') brokerKey?: string,
    @QueryParam('accountId') accountId?: string
  ): Promise<ApiSuccessResponse<unknown>> {
    const row = await this.fundsSnapshotRepository.getLatestSnapshot(
      requireAuthUserId(request),
      brokerKey,
      accountId
    );

    return {
      success: true,
      data: row || null
    };
  }
}
