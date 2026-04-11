import {
  PortfolioWorkspaceHoldingsFocus,
  PortfolioWorkspaceReportBody,
  PortfolioWorkspaceReportFormat,
  RebalanceReviewBody,
} from '../contracts/Portfolio';
import { BadRequestAppError } from '../errors/AppError';

export interface PortfolioHoldingsQuery {
  limit?: string;
  offset?: string;
  search?: string;
  sleeve?: string;
  side?: string;
}

export interface PortfolioSnapshotsQuery {
  limit?: string;
  offset?: string;
}

export interface PortfolioOverviewQuery {
  timeframe?: string;
  snapshotsLimit?: string;
  snapshotsOffset?: string;
  holdingsLimit?: string;
}

export type PortfolioTimeframe = 'daily' | 'weekly' | 'monthly';

export interface ValidatedPortfolioHoldingsQuery {
  limit: number;
  offset: number;
  search?: string;
  sleeve?: string;
  side?: string;
}

export interface ValidatedPortfolioSnapshotsQuery {
  limit: number;
  offset: number;
}

export interface ValidatedPortfolioOverviewQuery {
  timeframe: PortfolioTimeframe;
  snapshotsLimit: number;
  snapshotsOffset: number;
  holdingsLimit: number;
}

export interface ValidatedPortfolioWorkspaceState {
  timeframe: PortfolioTimeframe;
  holdingsFocus: PortfolioWorkspaceHoldingsFocus;
  holdingsSearch?: string;
  selectedHoldingId?: string;
}

export interface ValidatedRebalanceReviewBody
  extends Required<Pick<RebalanceReviewBody, 'scope' | 'mode'>>,
    ValidatedPortfolioWorkspaceState {}

export interface ValidatedPortfolioWorkspaceReportBody
  extends ValidatedPortfolioWorkspaceState {
  format: PortfolioWorkspaceReportFormat;
}

export const validatePortfolioHoldingsQuery = (
  query: PortfolioHoldingsQuery
): ValidatedPortfolioHoldingsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 50;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  return {
    limit,
    offset,
    search: query.search?.trim() || undefined,
    sleeve: query.sleeve?.trim() || undefined,
    side: query.side?.trim() || undefined,
  };
};

export const validateHoldingId = (holdingId: string): string => {
  const normalizedHoldingId = holdingId.trim();

  if (!normalizedHoldingId) {
    throw new BadRequestAppError('holdingId is required');
  }

  return normalizedHoldingId;
};

export const validatePortfolioSnapshotsQuery = (
  query: PortfolioSnapshotsQuery
): ValidatedPortfolioSnapshotsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new BadRequestAppError('limit must be an integer between 1 and 200');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  return {
    limit,
    offset,
  };
};

export const validatePortfolioTimeframe = (timeframe?: string): PortfolioTimeframe => {
  const normalized = String(timeframe || 'daily').trim().toLowerCase();

  if (normalized === 'daily' || normalized === 'weekly' || normalized === 'monthly') {
    return normalized;
  }

  throw new BadRequestAppError('timeframe must be one of daily, weekly, or monthly');
};

export const validatePortfolioOverviewQuery = (
  query: PortfolioOverviewQuery
): ValidatedPortfolioOverviewQuery => {
  const timeframe = validatePortfolioTimeframe(query.timeframe);
  const snapshots = validatePortfolioSnapshotsQuery({
    limit: query.snapshotsLimit,
    offset: query.snapshotsOffset,
  });
  const holdings = validatePortfolioHoldingsQuery({
    limit: query.holdingsLimit ?? '100',
    offset: '0',
  });

  return {
    timeframe,
    snapshotsLimit: snapshots.limit,
    snapshotsOffset: snapshots.offset,
    holdingsLimit: holdings.limit,
  };
};

export const validatePortfolioHoldingsFocus = (
  value?: string
): PortfolioWorkspaceHoldingsFocus => {
  const normalized = String(value || 'all').trim().toLowerCase();

  if (
    normalized === 'all' ||
    normalized === 'watch' ||
    normalized === 'long' ||
    normalized === 'short'
  ) {
    return normalized;
  }

  throw new BadRequestAppError('holdingsFocus must be one of all, watch, long, or short');
};

const validatePortfolioWorkspaceState = (
  input: Pick<
    RebalanceReviewBody,
    'timeframe' | 'holdingsFocus' | 'holdingsSearch' | 'selectedHoldingId'
  >
): ValidatedPortfolioWorkspaceState => {
  const holdingsSearch = input.holdingsSearch?.trim() || undefined;
  if (holdingsSearch && holdingsSearch.length > 120) {
    throw new BadRequestAppError('holdingsSearch must be 120 characters or fewer');
  }

  const selectedHoldingId = input.selectedHoldingId?.trim() || undefined;
  if (selectedHoldingId && selectedHoldingId.length > 64) {
    throw new BadRequestAppError('selectedHoldingId must be 64 characters or fewer');
  }

  return {
    timeframe: validatePortfolioTimeframe(input.timeframe),
    holdingsFocus: validatePortfolioHoldingsFocus(input.holdingsFocus),
    holdingsSearch,
    selectedHoldingId,
  };
};

export const validateRebalanceReviewBody = (
  body: RebalanceReviewBody = {}
): ValidatedRebalanceReviewBody => {
  const scope = body.scope?.trim() || 'workspace';
  const mode = body.mode?.trim() || 'review';

  if (scope !== 'workspace') {
    throw new BadRequestAppError('scope must be workspace');
  }

  if (mode !== 'review') {
    throw new BadRequestAppError('mode must be review');
  }

  return {
    scope,
    mode,
    ...validatePortfolioWorkspaceState(body),
  };
};

export const validatePortfolioWorkspaceReportBody = (
  body: PortfolioWorkspaceReportBody = {}
): ValidatedPortfolioWorkspaceReportBody => {
  const format = String(body.format || 'markdown').trim().toLowerCase();

  if (format !== 'markdown' && format !== 'json') {
    throw new BadRequestAppError('format must be markdown or json');
  }

  return {
    format,
    ...validatePortfolioWorkspaceState(body),
  };
};
