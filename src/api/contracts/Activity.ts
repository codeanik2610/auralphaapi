export type ActivityStatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type ActivityExportFormat = 'csv' | 'json';
export type ActivityExportStatus = 'Queued' | 'Processing' | 'Ready' | 'Failed';
export type ActivityFeedView = 'feed' | 'grouped' | 'clustered';
export type ActivityGroupBy = 'day' | 'route' | 'stream' | 'status' | 'type';
export type ActivitySortBy = 'time' | 'status' | 'type' | 'route' | 'stream';
export type ActivitySortOrder = 'asc' | 'desc';
export type ActivityReadState = 'all' | 'read' | 'unread';

export interface ActivityFlag {
  id: string;
  message: string;
  channel: string;
  time: string;
  status: string;
}

export interface ActivityClusterSummary {
  key: string;
  label: string;
  count: number;
  unreadCount: number;
  firstTime: string;
  latestTime: string;
  itemIds: string[];
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  status: string;
  actor: string;
  time: string;
  symbol: string;
  route: string;
  description?: string;
  referenceId?: string;
  correlationId?: string;
  stream?: string;
  related?: string;
  flags?: ActivityFlag[];
  isRead?: boolean;
  readAt?: string;
  cluster?: ActivityClusterSummary;
}

export interface ActivityRouteTarget {
  id: string;
  label: string;
  kind: string;
  path: string;
}

export interface ActivityContextItem {
  label: string;
  value: string;
}

export interface ActivityLinkedEntity {
  kind: string;
  id: string;
  title: string;
  path?: string;
  status?: string;
  description?: string;
  updatedAt?: string;
}

export interface ActivityExportContext {
  formats: ActivityExportFormat[];
  scope: string;
  filters: Record<string, string>;
  historyPath: string;
}

export interface ActivityDetailItem extends ActivityItem {
  createdAt: string;
  updatedAt: string;
  streamKey?: string;
  statusTone: ActivityStatusTone;
  linkedEntity?: ActivityLinkedEntity;
  context: ActivityContextItem[];
  routeTargets: ActivityRouteTarget[];
  exportContext: ActivityExportContext;
}

export interface ActivityGroupSummary {
  key: string;
  label: string;
  count: number;
  unreadCount: number;
  itemIds: string[];
}

export interface ActivitySavedViewItem {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  view: ActivityFeedView;
  groupBy?: ActivityGroupBy;
  sortBy: ActivitySortBy;
  sortOrder: ActivitySortOrder;
  readState: ActivityReadState;
  filters: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityFeedMeta {
  timeZone: string;
  activeSavedViewId?: string;
  view: ActivityFeedView;
  groupBy?: ActivityGroupBy;
  sortBy: ActivitySortBy;
  sortOrder: ActivitySortOrder;
  readState: ActivityReadState;
  unreadCount: number;
  savedViews: ActivitySavedViewItem[];
  availableViews: ActivityFeedView[];
  availableSorts: ActivitySortBy[];
  availableGroups: ActivityGroupBy[];
  presentationWindowTruncated?: boolean;
}

export interface ActivityListResponse {
  items: ActivityItem[];
  total: number;
  limit: number;
  offset: number;
  unreadCount: number;
  groups?: ActivityGroupSummary[];
  meta: ActivityFeedMeta;
}

export interface ActivitySummary {
  eventsToday: number;
  successful: number;
  needsReview: number;
  exportsReady: number;
  recentEvents?: number;
  executionEvents?: number;
  automationEvents?: number;
  auditPosture?: string;
}

export interface ActivityActionFilterBody {
  readState?: ActivityReadState;
  type?: string;
  status?: string;
  search?: string;
  stream?: string;
  route?: string;
  referenceId?: string;
  correlationId?: string;
  related?: string;
  savedViewId?: string;
}

export interface ActivityExportBody extends ActivityActionFilterBody {
  scope?: string;
  format?: string;
}

export interface ActivityExportItem {
  exportId: string;
  scope: string;
  format: ActivityExportFormat;
  status: ActivityExportStatus;
  fileName: string;
  contentType: string;
  exportedCount: number;
  createdAt: string;
  expiresAt?: string;
  filters?: Record<string, string>;
  downloadPath?: string;
  errorMessage?: string;
}

export interface ActivityExportListResponse {
  items: ActivityExportItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ActivityExportResult extends ActivityExportItem {
  message: string;
}

export interface ActivitySaveViewBody extends Omit<ActivityActionFilterBody, 'savedViewId'> {
  name?: string;
  description?: string;
  isDefault?: boolean;
  view?: ActivityFeedView;
  groupBy?: ActivityGroupBy;
  sortBy?: ActivitySortBy;
  sortOrder?: ActivitySortOrder;
}

export interface ActivitySavedViewListResponse {
  items: ActivitySavedViewItem[];
  total: number;
}

export interface ActivityReadActionResult {
  message: string;
  updatedCount: number;
  unreadCount: number;
  readAt?: string;
}
