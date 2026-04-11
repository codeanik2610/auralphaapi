import type { StrategyLibraryStatus } from '../contracts/StrategyLibrary';

export const STRATEGY_LIBRARY_STATUSES: StrategyLibraryStatus[] = [
  'Draft',
  'Active',
  'Paused',
  'Archived',
];
const STRATEGY_LIBRARY_STATUS_SET = new Set<StrategyLibraryStatus>(STRATEGY_LIBRARY_STATUSES);

const STRATEGY_LIBRARY_TRANSITIONS: Record<StrategyLibraryStatus, StrategyLibraryStatus[]> = {
  Draft: ['Active', 'Archived'],
  Active: ['Paused', 'Archived'],
  Paused: ['Active', 'Archived'],
  Archived: ['Draft', 'Active'],
};

export interface StrategyLibraryLifecycleModel {
  canEdit: boolean;
  canRunManually: boolean;
  isReadOnly: boolean;
  scheduledSignalsEnabled: boolean;
  summary: string;
  allowedTransitions: StrategyLibraryStatus[];
}

export function normalizeStrategyLibraryStatus(
  value: unknown,
  fallback: StrategyLibraryStatus = 'Draft'
): StrategyLibraryStatus {
  const normalized = String(value || '').trim() as StrategyLibraryStatus;
  return STRATEGY_LIBRARY_STATUS_SET.has(normalized) ? normalized : fallback;
}

export function getStrategyLibraryAllowedTransitions(
  status: StrategyLibraryStatus
): StrategyLibraryStatus[] {
  return [...STRATEGY_LIBRARY_TRANSITIONS[status]];
}

export function isStrategyLibraryStatusTransitionAllowed(
  currentStatus: StrategyLibraryStatus,
  nextStatus: StrategyLibraryStatus
): boolean {
  return (
    currentStatus === nextStatus ||
    STRATEGY_LIBRARY_TRANSITIONS[currentStatus].includes(nextStatus)
  );
}

export function canStrategyLibraryBeEdited(status: StrategyLibraryStatus): boolean {
  return status !== 'Archived';
}

export function canStrategyLibraryRunManually(status: StrategyLibraryStatus): boolean {
  return status !== 'Archived';
}

export function isStrategyLibraryIncludedInSignalScan(
  status: StrategyLibraryStatus
): boolean {
  return status === 'Active';
}

export function getStrategyLibraryLifecycleSummary(
  status: StrategyLibraryStatus
): string {
  if (status === 'Active') {
    return 'Active entries stay editable, can be run manually, and are included in scheduled strategy-library signal scans.';
  }
  if (status === 'Paused') {
    return 'Paused entries stay editable and can still be run manually, but are excluded from scheduled strategy-library signal scans.';
  }
  if (status === 'Archived') {
    return 'Archived entries remain visible for lineage, but edits and manual runs are blocked until the entry is restored.';
  }
  return 'Draft entries are editable and can be run manually, but are excluded from scheduled strategy-library signal scans until activated.';
}

export function buildStrategyLibraryLifecycle(
  status: StrategyLibraryStatus
): StrategyLibraryLifecycleModel {
  const canEdit = canStrategyLibraryBeEdited(status);
  const canRun = canStrategyLibraryRunManually(status);

  return {
    canEdit,
    canRunManually: canRun,
    isReadOnly: !canEdit,
    scheduledSignalsEnabled: isStrategyLibraryIncludedInSignalScan(status),
    summary: getStrategyLibraryLifecycleSummary(status),
    allowedTransitions: getStrategyLibraryAllowedTransitions(status),
  };
}
