import { Body, JsonController, Post } from 'routing-controllers';
import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { SignalScanRunResult } from '../contracts/Signal';
import { BadRequestAppError } from '../errors/AppError';
import { SignalScanService } from '../services/SignalScanService';

interface InternalSignalsScanBody {
  actorUserId?: string;
  includeStrategyLibrary?: boolean;
  includeStrategyLab?: boolean;
  maxSources?: number;
}

@JsonController('/internal/signals')
@Service()
export class InternalSignalsSchedulerController {
  @Inject(() => SignalScanService)
  private signalScanService!: SignalScanService;

  @Post('/scan')
  async scan(
    @Body() body: InternalSignalsScanBody = {}
  ): Promise<ApiSuccessResponse<SignalScanRunResult>> {
    const actorUserId = String(body.actorUserId || '').trim();
    if (!actorUserId) {
      throw new BadRequestAppError('actorUserId is required');
    }
    return this.signalScanService.runSignalScan(actorUserId, {
      includeStrategyLibrary: body.includeStrategyLibrary,
      includeStrategyLab: body.includeStrategyLab,
      maxSources: body.maxSources,
    });
  }
}
