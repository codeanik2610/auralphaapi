import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { RiskAlertsOverviewResponse } from '../contracts/RiskAlertsOverview';
import { successResponse } from '../utils/response';
import { RiskService } from './RiskService';

interface RiskAlertsOverviewQuery {
  limit?: string;
  offset?: string;
  status?: string;
  scope?: string;
}

const RISK_CENTER_CONTRACT_VERSION = 'risk-center-phase2-2026-04-09' as const;

@Service()
export class RiskAlertsOverviewService {
  @Inject(() => RiskService)
  private riskService!: RiskService;

  async getOverview(
    userId: string,
    query: RiskAlertsOverviewQuery
  ): Promise<ApiSuccessResponse<RiskAlertsOverviewResponse>> {
    const [alertsResponse, summaryResponse] = await Promise.all([
      this.riskService.getRiskAlerts(userId, query),
      this.riskService.getRiskAlertsSummary(userId, {
        status: query.status,
        scope: query.scope,
      }),
    ]);

    const alerts = alertsResponse.data ?? alertsResponse;
    const summary = summaryResponse.data ?? summaryResponse;

    return successResponse({
      meta: {
        contractVersion: RISK_CENTER_CONTRACT_VERSION,
        purpose: 'risk_alerts_digest_for_risk_center',
        generatedAt: new Date().toISOString(),
        query: {
          supported: ['limit', 'offset', 'status', 'scope'],
          resolved: {
            limit: alerts.limit,
            offset: alerts.offset,
            status: query.status?.trim() || null,
            scope: query.scope?.trim() || null,
          },
        },
        sources: {
          summary: 'risk_alerts_aggregate',
          alerts: 'risk_alerts',
        },
      },
      summary,
      alerts,
    });
  }
}
