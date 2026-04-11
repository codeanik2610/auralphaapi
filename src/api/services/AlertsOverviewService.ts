import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { AlertsOverviewResponse } from '../contracts/AlertsOverview';
import { successResponse } from '../utils/response';
import { AlertsService } from './AlertsService';

interface AlertsOverviewQuery {
  limit?: string;
  offset?: string;
  status?: string;
  search?: string;
  severity?: string;
  channel?: string;
}

@Service()
export class AlertsOverviewService {
  @Inject(() => AlertsService)
  private alertsService!: AlertsService;

  async getOverview(
    userId: string,
    query: AlertsOverviewQuery
  ): Promise<ApiSuccessResponse<AlertsOverviewResponse>> {
    const [alertsResponse, summaryResponse] = await Promise.all([
      this.alertsService.getAlerts(userId, query),
      this.alertsService.getScopedAlertsSummary(userId, query),
    ]);

    return successResponse({
      summary: summaryResponse.data ?? summaryResponse,
      alerts: alertsResponse.data ?? alertsResponse,
    });
  }
}
