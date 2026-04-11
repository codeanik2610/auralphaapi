import { AlertsListResponse, AlertsSummary } from './Alert';

export interface AlertsOverviewResponse {
  summary: AlertsSummary;
  alerts: AlertsListResponse;
}
