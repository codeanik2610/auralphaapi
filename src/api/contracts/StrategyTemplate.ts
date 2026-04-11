import type { StrategyTemplateAutomationProfile } from '../utils/strategyTemplateAutomation';

export type StrategyTemplateStatus = 'Draft' | 'Active' | 'Paused' | 'Archived';
export type StrategyTemplateVersionChangeType =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'duplicated';

export interface StrategyTemplateItem {
  id: string;
  name: string;
  description?: string | null;
  status: StrategyTemplateStatus;
  templateVersion: number;
  config?: Record<string, unknown> | null;
  automationReady: boolean;
  automationProfile: StrategyTemplateAutomationProfile;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyTemplateVersionItem {
  id: string;
  strategyId: string;
  name: string;
  description?: string | null;
  status: StrategyTemplateStatus;
  templateVersion: number;
  changeType: StrategyTemplateVersionChangeType;
  config?: Record<string, unknown> | null;
  actorUserId: string;
  createdAt: string;
}

export interface StrategyTemplateVersionListResponse {
  items: StrategyTemplateVersionItem[];
  total: number;
}

export interface StrategyTemplateListResponse {
  items: StrategyTemplateItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface StrategyTemplateCreateBody {
  name?: string;
  description?: string | null;
  status?: StrategyTemplateStatus;
  config?: Record<string, unknown> | null;
}

export interface StrategyTemplateUpdateBody {
  name?: string;
  description?: string | null;
  status?: StrategyTemplateStatus;
  config?: Record<string, unknown> | null;
}

export interface StrategyTemplateStatusUpdateBody {
  status?: StrategyTemplateStatus;
}

export interface StrategyTemplateDuplicateBody {
  name?: string;
  targetUserId?: string;
}

export interface ImportStrategyTemplateSuggestionBody {
  userId?: string;
  suggestionId?: string;
  templateId?: string | null;
  templateName?: string | null;
  suggestedName?: string | null;
  diffSummary?: string | null;
  reasoning?: string | null;
  suggestedConfig?: Record<string, unknown> | null;
}
