const ROUTE_ALIASES: Record<string, string> = {
  alerts: 'Alerts',
  automations: 'Automations',
  'automation desk': 'Automations',
  backtests: 'Backtests',
  'broker definitions': 'Broker Definitions',
  'brokers data': 'Brokers data',
  'email deliveries': 'Email Deliveries',
  'email delivery monitor': 'Email Deliveries',
  market: 'Market data',
  'market data': 'Market data',
  orders: 'Orders',
  portfolio: 'Portfolio',
  positions: 'Positions',
  risk: 'Risk',
  'risk review': 'Risk review',
  scheduler: 'Schedulers',
  schedulers: 'Schedulers',
  settings: 'Settings',
  'signal review': 'Signal review',
  signals: 'Signals',
  strategy: 'Strategy',
  'strategy lab': 'Strategy Lab',
  'strategy library': 'Strategy Library',
  'strategy template': 'Strategy Templates',
  'strategy templates': 'Strategy Templates',
  'suggested trades': 'Suggested Trades',
  watchlists: 'Watchlists',
};

const TYPE_ALIASES: Record<string, string> = {
  'api request': 'API Request',
  automation: 'Automation',
  backtest: 'Backtest',
  'broker account': 'Broker Account',
  'broker account diagnostics': 'Broker Account Diagnostics',
  'broker definition': 'Broker Definition',
  connection: 'Connection',
  'connection diagnostics': 'Connection Diagnostics',
  'email deliveries': 'Email Delivery',
  'exchange assets': 'Exchange Assets',
  market: 'Market',
  order: 'Order',
  'paper order': 'Paper Order',
  position: 'Position',
  'risk control': 'Risk Control',
  'risk policy': 'Risk Policy',
  scheduler: 'Scheduler',
  'scheduler run': 'Scheduler Run',
  settings: 'Settings',
  signal: 'Signal',
  'strategy lab': 'Strategy Lab',
  'strategy library': 'Strategy Library',
  'strategy template': 'Strategy Template',
  'suggested trade': 'Suggested Trade',
  watchlist: 'Watchlist',
};

const STREAM_ALIASES: Record<string, 'Controls' | 'Execution' | 'Automation'> = {
  automation: 'Automation',
  backtests: 'Execution',
  controls: 'Controls',
  definitions: 'Controls',
  deployments: 'Automation',
  drafts: 'Controls',
  execution: 'Execution',
  items: 'Controls',
  policies: 'Controls',
  prices: 'Automation',
  'paper execution': 'Execution',
  review: 'Controls',
  runs: 'Automation',
  scan: 'Automation',
  suggestions: 'Execution',
  sync: 'Automation',
  validation: 'Controls',
};

const STATUS_ALIASES: Record<string, string> = {
  completed: 'Success',
  connected: 'Success',
  created: 'Success',
  down: 'Failed',
  draft: 'Draft',
  error: 'Failed',
  failed: 'Failed',
  'in progress': 'Running',
  muted: 'Muted',
  'needs review': 'Needs review',
  ok: 'Success',
  open: 'Open',
  pending: 'Queued',
  queued: 'Queued',
  ready: 'Success',
  rejected: 'Failed',
  review: 'Needs review',
  running: 'Running',
  skipped: 'Success',
  stable: 'Success',
  started: 'Running',
  succeeded: 'Success',
  success: 'Success',
  warning: 'Needs review',
  watch: 'Needs review',
  watching: 'Needs review',
};

const SUCCESS_STATUS_ALIASES = [
  'completed',
  'connected',
  'created',
  'ok',
  'ready',
  'skipped',
  'stable',
  'succeeded',
  'success',
];

const FAILURE_STATUS_ALIASES = ['down', 'error', 'failed', 'rejected'];
const REVIEW_STATUS_ALIASES = ['needs review', 'review', 'warning', 'watch', 'watching'];
const QUEUED_STATUS_ALIASES = ['pending', 'queued'];
const RUNNING_STATUS_ALIASES = ['in progress', 'running', 'started'];

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const titleCase = (value: string): string =>
  collapseWhitespace(value)
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === 'api') {
        return 'API';
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');

export const normalizeActivityRoute = (value: string | null | undefined): string | null => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return null;
  }
  const key = normalized.toLowerCase();
  return ROUTE_ALIASES[key] ?? titleCase(normalized);
};

export const normalizeActivityType = (value: string | null | undefined): string => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return 'Activity';
  }
  const key = normalized.toLowerCase();
  return TYPE_ALIASES[key] ?? titleCase(normalized);
};

export const normalizeActivityStream = (value: string | null | undefined): string | null => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return null;
  }
  const key = normalized.toLowerCase();
  return STREAM_ALIASES[key] ?? titleCase(normalized);
};

export const expandActivityRouteAliases = (value: string | null | undefined): string[] => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return [];
  }
  const canonical = normalizeActivityRoute(normalized);
  if (!canonical) {
    return [];
  }
  const canonicalKey = canonical.toLowerCase();
  const aliases = Object.entries(ROUTE_ALIASES)
    .filter(([, route]) => route.toLowerCase() === canonicalKey)
    .map(([alias]) => alias);
  return aliases.length ? aliases : [canonicalKey];
};

export const expandActivityStreamAliases = (value: string | null | undefined): string[] => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return [];
  }
  const key = normalized.toLowerCase();
  const canonical = STREAM_ALIASES[key];
  if (!canonical) {
    return [key];
  }
  return Object.entries(STREAM_ALIASES)
    .filter(([, stream]) => stream === canonical)
    .map(([alias]) => alias);
};

export const normalizeActivityStatus = (value: string | null | undefined): string => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return 'Open';
  }
  const key = normalized.toLowerCase();
  return STATUS_ALIASES[key] ?? titleCase(normalized);
};

export const expandActivityTypeAliases = (value: string | null | undefined): string[] => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return [];
  }
  const canonical = normalizeActivityType(normalized);
  const canonicalKey = canonical.toLowerCase();
  const aliases = Object.entries(TYPE_ALIASES)
    .filter(([, type]) => type.toLowerCase() === canonicalKey)
    .map(([alias]) => alias);
  return aliases.length ? aliases : [canonicalKey];
};

export const expandActivityStatusAliases = (value: string | null | undefined): string[] => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return [];
  }
  const key = normalized.toLowerCase();
  const canonical = STATUS_ALIASES[key] ?? titleCase(normalized);
  if (canonical === 'Success') {
    return SUCCESS_STATUS_ALIASES;
  }
  if (canonical === 'Failed') {
    return FAILURE_STATUS_ALIASES;
  }
  if (canonical === 'Needs review') {
    return REVIEW_STATUS_ALIASES;
  }
  if (canonical === 'Queued') {
    return QUEUED_STATUS_ALIASES;
  }
  if (canonical === 'Running') {
    return RUNNING_STATUS_ALIASES;
  }
  return [key];
};

export const normalizeActivityTitle = (value: string | null | undefined, fallback: string): string => {
  const normalized = collapseWhitespace(String(value || ''));
  return (normalized || fallback).slice(0, 255);
};

export const normalizeActivityText = (
  value: string | null | undefined,
  maxLength?: number
): string | null => {
  const normalized = collapseWhitespace(String(value || ''));
  if (!normalized) {
    return null;
  }
  return maxLength ? normalized.slice(0, maxLength) : normalized;
};

export const normalizeActivityFlags = (
  flags: Array<{
    id: string;
    message: string;
    channel: string;
    time: string;
    status: string;
  }> | null | undefined
) => {
  if (!Array.isArray(flags) || !flags.length) {
    return null;
  }

  const normalized = flags
    .map((flag) => {
      const id = normalizeActivityText(flag?.id, 100);
      const message = normalizeActivityText(flag?.message, 255);
      const channel = normalizeActivityText(flag?.channel, 100);
      const time = normalizeActivityText(flag?.time, 100);

      if (!id || !message || !channel || !time) {
        return null;
      }

      return {
        id,
        message,
        channel,
        time,
        status: normalizeActivityStatus(flag?.status),
      };
    })
    .filter(
      (
        flag
      ): flag is {
        id: string;
        message: string;
        channel: string;
        time: string;
        status: string;
      } => Boolean(flag)
    );

  return normalized.length ? normalized : null;
};

export const tokenizeActivitySearch = (value: string | null | undefined): string[] =>
  Array.from(
    new Set(
      collapseWhitespace(String(value || ''))
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );

export const ACTIVITY_SUCCESS_STATUSES = [...SUCCESS_STATUS_ALIASES];
export const ACTIVITY_REVIEW_STATUSES = [...FAILURE_STATUS_ALIASES, ...REVIEW_STATUS_ALIASES];
export const ACTIVITY_EXECUTION_STREAMS = expandActivityStreamAliases('Execution');
export const ACTIVITY_AUTOMATION_STREAMS = expandActivityStreamAliases('Automation');
