import { RiskAlertsResponse, RiskAlertsSummary } from './Risk';

export interface RiskAlertsOverviewMeta {
  contractVersion: string;
  purpose: 'risk_alerts_digest_for_risk_center';
  generatedAt: string;
  query: {
    supported: string[];
    resolved: {
      limit: number;
      offset: number;
      status: string | null;
      scope: string | null;
    };
  };
  sources: {
    summary: string;
    alerts: string;
  };
}

export interface RiskAlertsOverviewResponse {
  meta: RiskAlertsOverviewMeta;
  summary: RiskAlertsSummary;
  alerts: RiskAlertsResponse;
}
