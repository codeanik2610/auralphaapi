export interface ItemFreshness {
  observedAt: string;
  freshnessMs: number;
  staleAfterMs: number | null;
  isStale: boolean;
  source: string;
}

export interface LinkedEntityReference {
  entity: string;
  id: string;
  label?: string;
  url?: string;
  relation?: string;
  status?: string | null;
}
