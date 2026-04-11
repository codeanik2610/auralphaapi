export type AlertSeverity = 'High' | 'Medium' | 'Low';
export type AlertStatus = 'Open' | 'Acknowledged' | 'Muted' | 'Resolved';
export type AlertRouteTarget = 'signals' | 'risk' | 'automations' | 'orders';

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  channel: string;
  symbol: string;
  message: string;
  route: string;
  time: string;
  status: AlertStatus;
  source: string;
  urgency: string;
  updatedAt?: string;
}

export interface AlertHistoryItem {
  id: string;
  actionType: 'created' | 'acknowledge' | 'mute' | 'route';
  title: string;
  description: string;
  actor: string;
  createdAt: string;
  note?: string;
  target?: AlertRouteTarget;
  targetLabel?: string;
}

export interface AlertDetailItem extends AlertItem {
  createdAt: string;
  history: AlertHistoryItem[];
}

export interface AlertsListResponse {
  items: AlertItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AlertsSummary {
  openAlerts: number;
  acknowledged: number;
  highSeverityAlerts: number;
  criticalSeverity?: number;
  watchlistCapable: string;
}

export interface AlertStatusActionResult {
  message: string;
  alert: {
    id: string;
    status: AlertStatus;
    updatedAt: string;
  };
}

export interface AlertRouteActionResult {
  message: string;
  alert: {
    id: string;
    route: string;
    updatedAt: string;
  };
  target: AlertRouteTarget;
  targetLabel: string;
  note?: string;
}
