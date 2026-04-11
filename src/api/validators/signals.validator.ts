import { BadRequestAppError } from '../errors/AppError';
import { SignalPromoteTarget, SignalStatus, SignalViewMode } from '../contracts/Signal';

const VALID_STATUSES: SignalStatus[] = ['Triggered', 'Watching', 'Queued', 'Muted'];
const VALID_PROMOTE_TARGETS: SignalPromoteTarget[] = [
  'strategy',
  'execution_queue',
  'alerts',
  'automations',
];
const VALID_VIEW_MODES: SignalViewMode[] = ['inbox', 'clustered', 'muted'];
const LEGACY_PROMOTE_TARGET_ALIASES: Record<string, SignalPromoteTarget> = {
  orders: 'execution_queue',
};

export interface SignalsQuery {
  limit?: string;
  offset?: string;
  status?: string;
  symbol?: string;
  source?: string;
  timeframe?: string;
  search?: string;
  view?: string;
}

export interface AcknowledgeSignalBody {
  note?: string;
}

export interface MuteSignalBody {
  reason?: string;
}

export interface PromoteSignalBody {
  target?: string;
}

export interface RunSignalScanBody {
  includeStrategyLibrary?: boolean;
  includeStrategyLab?: boolean;
  maxSources?: number;
}

export interface ValidatedSignalsQuery {
  limit: number;
  offset: number;
  status?: SignalStatus;
  symbol?: string;
  source?: string;
  timeframe?: string;
  search?: string;
  view: SignalViewMode;
}

export interface ValidatedRunSignalScanBody {
  includeStrategyLibrary: boolean;
  includeStrategyLab: boolean;
  maxSources: number;
}

export const validateSignalsQuery = (query: SignalsQuery): ValidatedSignalsQuery => {
  const limit = query.limit !== undefined ? Number(query.limit) : 20;
  const offset = query.offset !== undefined ? Number(query.offset) : 0;

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new BadRequestAppError('limit must be an integer between 1 and 100');
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestAppError('offset must be an integer greater than or equal to 0');
  }

  const status = query.status?.trim();
  if (status && !VALID_STATUSES.includes(status as SignalStatus)) {
    throw new BadRequestAppError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const normalizedView = query.view?.trim().toLowerCase();
  if (normalizedView && !VALID_VIEW_MODES.includes(normalizedView as SignalViewMode)) {
    throw new BadRequestAppError(`view must be one of: ${VALID_VIEW_MODES.join(', ')}`);
  }

  return {
    limit,
    offset,
    status: status as SignalStatus | undefined,
    symbol: query.symbol?.trim() || undefined,
    source: query.source?.trim() || undefined,
    timeframe: query.timeframe?.trim() || undefined,
    search: query.search?.trim() || undefined,
    view: (normalizedView as SignalViewMode | undefined) ?? 'inbox',
  };
};

export const validateSignalId = (signalId: string): string => {
  const normalizedSignalId = signalId.trim();

  if (!normalizedSignalId) {
    throw new BadRequestAppError('signalId is required');
  }

  return normalizedSignalId;
};

export const validateAcknowledgeSignalBody = (
  body: AcknowledgeSignalBody
): AcknowledgeSignalBody => {
  if (body.note !== undefined && typeof body.note !== 'string') {
    throw new BadRequestAppError('note must be a string');
  }

  return {
    note: body.note?.trim() || undefined,
  };
};

export const validateMuteSignalBody = (body: MuteSignalBody): MuteSignalBody => {
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    throw new BadRequestAppError('reason must be a string');
  }

  return {
    reason: body.reason?.trim() || undefined,
  };
};

export const validatePromoteSignalBody = (
  body: PromoteSignalBody
): { target: SignalPromoteTarget } => {
  const target = body.target?.trim();

  if (!target) {
    throw new BadRequestAppError('target is required');
  }

  const normalizedTarget = LEGACY_PROMOTE_TARGET_ALIASES[target.toLowerCase()] ?? target;

  if (!VALID_PROMOTE_TARGETS.includes(normalizedTarget as SignalPromoteTarget)) {
    throw new BadRequestAppError(
      `target must be one of: ${VALID_PROMOTE_TARGETS.join(
        ', '
      )} (orders is accepted as a deprecated alias for execution_queue)`
    );
  }

  return {
    target: normalizedTarget as SignalPromoteTarget,
  };
};

export const validateRunSignalScanBody = (
  body: RunSignalScanBody | undefined
): ValidatedRunSignalScanBody => {
  const includeStrategyLibrary =
    body?.includeStrategyLibrary === undefined ? true : Boolean(body.includeStrategyLibrary);
  const includeStrategyLab =
    body?.includeStrategyLab === undefined ? false : Boolean(body.includeStrategyLab);
  const maxSources =
    body?.maxSources === undefined ? 12 : Number(body.maxSources);

  if (!includeStrategyLibrary && !includeStrategyLab) {
    throw new BadRequestAppError(
      'At least one source must be enabled for the signal scan'
    );
  }

  if (!Number.isInteger(maxSources) || maxSources <= 0 || maxSources > 50) {
    throw new BadRequestAppError('maxSources must be an integer between 1 and 50');
  }

  return {
    includeStrategyLibrary,
    includeStrategyLab,
    maxSources,
  };
};
