export interface OverviewCard {
  id: string;
  label: string;
  value: number;
  description?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

export interface OverviewTab {
  id: string;
  label: string;
  count: number;
  selected: boolean;
  description?: string;
  group?: string;
}

export interface OverviewQuickAction {
  id: string;
  label: string;
  description?: string;
  intent?: 'primary' | 'secondary';
  method?: 'GET' | 'POST';
  target?: string;
}

export interface OperatorJourneyStep {
  id: string;
  label: string;
  description: string;
  state: 'completed' | 'current' | 'upcoming';
}

export interface OperatorJourney {
  id: string;
  label: string;
  description: string;
  steps: OperatorJourneyStep[];
}
