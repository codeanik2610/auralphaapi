export type EmailDeliveryStatus = 'Queued' | 'Sending' | 'Sent' | 'Failed';
export type EmailDeliveryBodyVisibility = 'metadata-only' | 'redacted-preview';

export interface EmailDeliveryGovernancePolicy {
  bodyVisibility: EmailDeliveryBodyVisibility;
  cleanupEligibleStatuses: EmailDeliveryStatus[];
  cleanupProtectedStatuses: EmailDeliveryStatus[];
  retentionField: 'updatedAt';
  bodyPreviewMaxChars: number;
  bodyPreviewMaxLines: number;
}

export interface EmailDeliveryItem {
  id: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  alertId?: string;
  recipientEmail: string;
  subject: string;
  channel: string;
  severity: string;
  route?: string;
  source?: string;
  status: EmailDeliveryStatus;
  attempts: number;
  lastError?: string;
  bodyPreview?: string;
  bodyPreviewTruncated?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmailDeliveriesListResponse {
  items: EmailDeliveryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface EmailDeliveriesSummary {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  active: number;
  latestSentAt?: string;
  oldestPendingAt?: string;
}

export interface EmailDeliveryFilterOptions {
  severities: string[];
  channels: string[];
  defaultRetentionDays: number;
  exportMaxRows: number;
  bodyVisibility: EmailDeliveryBodyVisibility;
  governance: EmailDeliveryGovernancePolicy;
}

export interface EmailDeliveryCleanupActivityItem {
  id: string;
  userId: string;
  title: string;
  status: string;
  actor?: string;
  stream?: string;
  route?: string;
  related?: string;
  description?: string;
  time: string;
}

export interface EmailDeliveryActionResult {
  message: string;
  delivery: EmailDeliveryItem;
}

export interface EmailDeliveryBulkActionResult {
  message: string;
  updatedCount: number;
}

export interface EmailDeliveryBulkPreviewResult {
  message: string;
  matchingCount: number;
}

export interface EmailDeliveryCleanupPreviewResult {
  message: string;
  retentionDays: number;
  matchingCount: number;
  sentCount: number;
  failedCount: number;
}

export interface EmailDeliveryMatchingCleanupPreviewResult {
  message: string;
  matchingCount: number;
  sentCount: number;
  failedCount: number;
}

export interface EmailDeliveryCleanupResult {
  message: string;
  retentionDays: number;
  deletedCount: number;
  deletedSentCount: number;
  deletedFailedCount: number;
}

export interface EmailDeliveryMatchingCleanupResult {
  message: string;
  deletedCount: number;
  deletedSentCount: number;
  deletedFailedCount: number;
}

export interface EmailDeliveryExportBody {
  format?: string;
  status?: string;
  search?: string;
  userId?: string;
  recipient?: string;
  severity?: string;
  channel?: string;
  source?: string;
}

export interface EmailDeliveryExportResult {
  message: string;
  exportId: string;
  status: string;
  fileName: string;
  csv: string;
  exportedCount: number;
}
