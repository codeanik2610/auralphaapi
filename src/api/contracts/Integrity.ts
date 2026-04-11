export type IntegrityStatus = 'ok' | 'warning' | 'error';

export interface IntegrityCheckItem {
  id: string;
  status: IntegrityStatus;
  message: string;
}

export interface IntegritySummary {
  status: IntegrityStatus;
  label: string;
  summary: string;
  checks: IntegrityCheckItem[];
}
