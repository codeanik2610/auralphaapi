import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { SchedulerRunLogItem } from '../contracts/Scheduler';
import { SignalsOverviewResponse } from '../contracts/SignalsOverview';
import { successResponse } from '../utils/response';
import { SignalsService } from './SignalsService';
import { SignalsSchedulerService } from './SignalsSchedulerService';

interface SignalsOverviewQuery {
  limit?: string;
  offset?: string;
  status?: string;
  symbol?: string;
  source?: string;
  timeframe?: string;
  search?: string;
  view?: string;
}

@Service()
export class SignalsOverviewService {
  @Inject(() => SignalsService)
  private signalsService!: SignalsService;

  @Inject(() => SignalsSchedulerService)
  private signalsSchedulerService!: SignalsSchedulerService;

  async getOverview(
    userId: string,
    query: SignalsOverviewQuery
  ): Promise<ApiSuccessResponse<SignalsOverviewResponse>> {
    const baseTabQuery = {
      ...query,
      status: query.status,
      symbol: query.symbol,
      source: query.source,
      timeframe: query.timeframe,
      search: query.search,
    };

    const [
      signalsResponse,
      summaryResponse,
      inboxSummaryResponse,
      clusteredSummaryResponse,
      mutedSummaryResponse,
      schedulerConfigResponse,
      schedulerRunsResponse,
    ] = await Promise.all([
      this.signalsService.getSignals(userId, query),
      this.signalsService.getSignalsSummary(userId, query),
      this.signalsService.getSignalsSummary(userId, {
        ...baseTabQuery,
        view: 'inbox',
      }),
      this.signalsService.getSignalsSummary(userId, {
        ...baseTabQuery,
        view: 'clustered',
      }),
      this.signalsService.getSignalsSummary(userId, {
        ...baseTabQuery,
        view: 'muted',
      }),
      this.signalsSchedulerService.getSchedulerConfig(userId),
      this.signalsSchedulerService.listSchedulerRuns(userId, {
        limit: '1',
        offset: '0',
      }),
    ]);

    const summary = summaryResponse.data ?? summaryResponse;
    const inboxSummary = inboxSummaryResponse.data ?? inboxSummaryResponse;
    const clusteredSummary = clusteredSummaryResponse.data ?? clusteredSummaryResponse;
    const mutedSummary = mutedSummaryResponse.data ?? mutedSummaryResponse;
    const schedulerConfig = schedulerConfigResponse.data ?? schedulerConfigResponse;
    const latestRun = (schedulerRunsResponse.data?.items ?? [])[0];

    return successResponse({
      summary,
      signals: signalsResponse.data ?? signalsResponse,
      cards: [
        {
          id: 'inbox',
          label: 'Inbox Signals',
          value: inboxSummary.liveSignals,
          description: 'Signals currently visible in the active review queue.',
          tone: 'info',
        },
        {
          id: 'new',
          label: 'Needs Review',
          value: inboxSummary.triggered,
          description: 'Fresh signals that still need an operator decision.',
          tone: 'warning',
        },
        {
          id: 'watching',
          label: 'Watching',
          value: inboxSummary.watching,
          description: 'Signals already acknowledged and still being monitored.',
          tone: 'neutral',
        },
        {
          id: 'clusters',
          label: 'Clustered Setups',
          value: clusteredSummary.liveSignals,
          description: 'Grouped symbol and timeframe setups for faster triage.',
          tone: 'success',
        },
        {
          id: 'muted',
          label: 'Muted',
          value: mutedSummary.liveSignals,
          description: 'Signals removed from active review queues.',
          tone: 'neutral',
        },
      ],
      tabs: [
        {
          id: 'inbox',
          label: 'Inbox',
          count: inboxSummary.liveSignals,
          selected: (query.view ?? 'inbox') === 'inbox',
          description: 'Latest signals ready for review and promotion.',
          group: 'review',
        },
        {
          id: 'clustered',
          label: 'Clustered',
          count: clusteredSummary.liveSignals,
          selected: query.view === 'clustered',
          description: 'Grouped setups by symbol, timeframe, and source.',
          group: 'review',
        },
        {
          id: 'muted',
          label: 'Muted',
          count: mutedSummary.liveSignals,
          selected: query.view === 'muted',
          description: 'Muted signals kept for audit but excluded from triage.',
          group: 'review',
        },
      ],
      quickActions: this.buildQuickActions(Boolean(schedulerConfig.enabled)),
      journey: this.buildJourney((query.view ?? 'inbox') === 'muted' ? 'signal_muted' : 'signal_review'),
      scanStatus: this.buildScanStatus(
        schedulerConfig,
        latestRun
      ),
    });
  }

  private buildQuickActions(enabled: boolean): SignalsOverviewResponse['quickActions'] {
    return [
      {
        id: 'run_scan',
        label: 'Run My Scan',
        description: 'Trigger a fresh scan across your included strategy sources.',
        intent: 'primary',
        method: 'POST',
        target: '/signals/scan/run',
      },
      {
        id: 'scan_settings',
        label: 'Manage Scan',
        description: 'Review your cadence, retention, and recent scan history from Signals.',
        intent: 'secondary',
        method: 'GET',
        target: '/suggested-trades?tab=signals',
      },
      enabled
        ? {
            id: 'pause_scan',
            label: 'Pause My Scan',
            description: 'Pause your scheduled scans while keeping the current inbox intact.',
            intent: 'secondary',
            method: 'POST',
            target: '/signals/automation/pause',
          }
        : {
            id: 'resume_scan',
            label: 'Resume My Scan',
            description: 'Resume your scheduled scans and refill the review queue.',
            intent: 'primary',
            method: 'POST',
            target: '/signals/automation/resume',
          },
    ];
  }

  private buildJourney(
    currentStepId: 'signal_review' | 'signal_muted'
  ): SignalsOverviewResponse['journey'] {
    const order = [
      'signal_detected',
      'signal_review',
      'signal_muted',
      'signal_queued',
      'accept_trade',
      'link_order',
      'track_execution',
    ];
    const currentIndex = order.indexOf(currentStepId);

    const steps = [
      {
        id: 'signal_detected',
        label: 'Signal Detected',
        description: 'A strategy source generated a fresh signal for operator review.',
      },
      {
        id: 'signal_review',
        label: 'Review Signal',
        description: 'Triage the inbox, acknowledge, mute, or promote the signal.',
      },
      {
        id: 'signal_muted',
        label: 'Mute Signal',
        description: 'Remove noisy signals from the active queue while keeping an audit trail.',
      },
      {
        id: 'signal_queued',
        label: 'Queue Handoff',
        description: 'Promote the signal into strategy, automation, alerts, or execution review.',
      },
      {
        id: 'accept_trade',
        label: 'Accept Trade',
        description: 'Review the suggested trade and decide whether to accept it.',
      },
      {
        id: 'link_order',
        label: 'Link Order',
        description: 'Attach the accepted trade to a live or paper order.',
      },
      {
        id: 'track_execution',
        label: 'Track Execution',
        description: 'Monitor linked orders through working, filled, and closed states.',
      },
    ].map((step, index) => {
      const state: 'completed' | 'current' | 'upcoming' =
        index < currentIndex
          ? 'completed'
          : index === currentIndex
            ? 'current'
            : 'upcoming';

      return {
        ...step,
        state,
      };
    });

    return {
      id: 'signals-operator-flow',
      label: 'Operator Journey',
      description: 'Signals is the front door of the review workflow and hands accepted setups into the execution queue.',
      steps,
    };
  }

  private buildScanStatus(
    config: {
      enabled: boolean;
      sources: string[];
      lastStartedAt?: string;
      lastFinishedAt?: string;
      lastStatus?: string;
      lastError?: string;
    },
    latestRun?: SchedulerRunLogItem
  ): SignalsOverviewResponse['scanStatus'] {
    const latestStatus = String(latestRun?.status || config.lastStatus || '').trim();
    const normalizedLatestStatus = latestStatus.toLowerCase();

    if (normalizedLatestStatus === 'running' || normalizedLatestStatus === 'queued') {
      return {
        schedulerKey: 'signals-scan-sync',
        state: 'running',
        label: normalizedLatestStatus === 'queued' ? 'Queued' : 'Running',
        summary: normalizedLatestStatus === 'queued'
          ? 'Your next signal scan is queued and will refresh the inbox shortly.'
          : 'Your signal scan is currently running and refreshing the inbox.',
        enabled: config.enabled,
        sources: config.sources,
        lastStartedAt: latestRun?.startedAt ?? config.lastStartedAt,
        lastFinishedAt: latestRun?.finishedAt ?? config.lastFinishedAt,
        lastStatus: latestRun?.status ?? config.lastStatus,
        lastError: config.lastError,
        activeRunId: latestRun?.id,
      };
    }

    if (!config.enabled) {
      return {
        schedulerKey: 'signals-scan-sync',
        state: 'paused',
        label: 'Paused',
        summary: 'Your scheduled signal scans are paused. The inbox will not refresh automatically.',
        enabled: config.enabled,
        sources: config.sources,
        lastStartedAt: config.lastStartedAt,
        lastFinishedAt: config.lastFinishedAt,
        lastStatus: config.lastStatus,
        lastError: config.lastError,
      };
    }

    if (normalizedLatestStatus === 'failed' || config.lastError) {
      return {
        schedulerKey: 'signals-scan-sync',
        state: 'attention',
        label: 'Needs Attention',
        summary: 'Your most recent scan did not complete cleanly and should be reviewed before relying on the inbox.',
        enabled: config.enabled,
        sources: config.sources,
        lastStartedAt: config.lastStartedAt,
        lastFinishedAt: config.lastFinishedAt,
        lastStatus: config.lastStatus,
        lastError: config.lastError,
      };
    }

    return {
      schedulerKey: 'signals-scan-sync',
      state: 'healthy',
      label: 'Ready',
      summary: 'Your scheduled scans are enabled and the inbox is ready for operator review.',
      enabled: config.enabled,
      sources: config.sources,
      lastStartedAt: config.lastStartedAt,
      lastFinishedAt: config.lastFinishedAt,
      lastStatus: config.lastStatus,
      lastError: config.lastError,
    };
  }
}
