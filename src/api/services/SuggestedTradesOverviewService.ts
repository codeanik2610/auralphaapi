import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import { SuggestedTradesOverviewResponse } from '../contracts/SuggestedTradesOverview';
import { successResponse } from '../utils/response';
import { SuggestedTradeExecutionSyncService } from './SuggestedTradeExecutionSyncService';
import { SuggestedTradesService } from './SuggestedTradesService';

interface SuggestedTradesOverviewQuery {
  limit?: string;
  offset?: string;
  status?: string;
  executionState?: string;
  symbol?: string;
  timeframe?: string;
  automationId?: string;
  automationRunId?: string;
  side?: string;
  search?: string;
}

@Service()
export class SuggestedTradesOverviewService {
  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  @Inject(() => SuggestedTradeExecutionSyncService)
  private suggestedTradeExecutionSyncService!: SuggestedTradeExecutionSyncService;

  async getOverview(
    userId: string,
    query: SuggestedTradesOverviewQuery
  ): Promise<ApiSuccessResponse<SuggestedTradesOverviewResponse>> {
    const [
      listResponse,
      summaryResponse,
      baseSummaryResponse,
      syncStatus,
    ] = await Promise.all([
      this.suggestedTradesService.getSuggestedTrades(userId, query),
      this.suggestedTradesService.getSuggestedTradesSummary(userId, query),
      this.suggestedTradesService.getSuggestedTradesSummary(userId, {
        ...query,
        status: undefined,
        executionState: undefined,
      }),
      this.suggestedTradeExecutionSyncService.getSyncStatus(userId, {
        automationId: query.automationId,
        automationRunId: query.automationRunId,
        status: query.status,
        executionState: query.executionState,
        symbol: query.symbol,
        timeframe: query.timeframe,
        side: query.side,
        search: query.search,
      }),
    ]);

    const summary = summaryResponse.data ?? summaryResponse;
    const baseSummary = baseSummaryResponse.data ?? baseSummaryResponse;

    return successResponse({
      summary,
      suggestedTrades: listResponse.data ?? listResponse,
      cards: [
        {
          id: 'open',
          label: 'Needs Review',
          value: baseSummary.open,
          description: 'Suggestions that still need an accept or dismiss decision.',
          tone: 'warning',
        },
        {
          id: 'accepted',
          label: 'Accepted',
          value: baseSummary.accepted,
          description: 'Suggestions approved for order handoff.',
          tone: 'info',
        },
        {
          id: 'working',
          label: 'Working',
          value: baseSummary.working,
          description: 'Linked orders currently working in the market.',
          tone: 'info',
        },
        {
          id: 'filled',
          label: 'Position Open',
          value: baseSummary.filled,
          description: 'Accepted suggestions that have opened a position.',
          tone: 'success',
        },
        {
          id: 'closed',
          label: 'Closed',
          value: baseSummary.closed,
          description: 'Suggestions whose execution lifecycle has completed.',
          tone: 'neutral',
        },
      ],
      tabs: this.buildTabs(baseSummary, query),
      quickActions: [
        {
          id: 'review_open',
          label: 'Review Open Trades',
          description: 'Jump straight into suggestions still awaiting review.',
          intent: 'primary',
          method: 'GET',
          target: '/suggested-trades?status=Open',
        },
        {
          id: 'reconcile_stale',
          label: 'Reconcile Stale Trades',
          description: 'Refresh tracked trades whose execution state is older than the sync threshold.',
          intent: 'primary',
          method: 'POST',
          target: '/suggested-trades/reconcile-execution',
        },
        {
          id: 'accepted_queue',
          label: 'Open Accepted Queue',
          description: 'See accepted suggestions that are ready to link to orders.',
          intent: 'secondary',
          method: 'GET',
          target: '/suggested-trades?status=Accepted',
        },
        {
          id: 'track_working',
          label: 'Track Working Orders',
          description: 'Follow linked trades that are currently working in the market.',
          intent: 'secondary',
          method: 'GET',
          target: '/suggested-trades?executionState=working',
        },
      ],
      journey: this.buildJourney(
        query.executionState
          ? 'track_execution'
          : query.status === 'Accepted'
            ? 'link_order'
            : 'accept_trade'
      ),
      syncStatus,
    });
  }

  private buildTabs(
    summary: SuggestedTradesOverviewResponse['summary'],
    query: SuggestedTradesOverviewQuery
  ): SuggestedTradesOverviewResponse['tabs'] {
    const selectedStatus = String(query.status || '').trim();
    const selectedExecutionState = String(query.executionState || '').trim().toLowerCase();

    return [
      {
        id: 'open',
        label: 'Open',
        count: summary.open,
        selected: selectedStatus === 'Open',
        description: 'New suggestions waiting for first review.',
        group: 'review',
      },
      {
        id: 'reviewed',
        label: 'Reviewed',
        count: summary.reviewed,
        selected: selectedStatus === 'Reviewed',
        description: 'Reviewed suggestions waiting for accept or dismiss.',
        group: 'review',
      },
      {
        id: 'accepted',
        label: 'Accepted',
        count: summary.accepted,
        selected: selectedStatus === 'Accepted' && !selectedExecutionState,
        description: 'Accepted suggestions ready for order linkage.',
        group: 'review',
      },
      {
        id: 'dismissed',
        label: 'Dismissed',
        count: summary.dismissed,
        selected: selectedStatus === 'Dismissed',
        description: 'Suggestions intentionally removed from execution consideration.',
        group: 'review',
      },
      {
        id: 'queued',
        label: 'Queued',
        count: summary.queued,
        selected: selectedExecutionState === 'queued',
        description: 'Execution requests waiting to start submission.',
        group: 'execution',
      },
      {
        id: 'submitting',
        label: 'Submitting',
        count: summary.submitting,
        selected: selectedExecutionState === 'submitting',
        description: 'Execution requests currently being submitted.',
        group: 'execution',
      },
      {
        id: 'linked',
        label: 'Linked',
        count: summary.linked,
        selected: selectedExecutionState === 'linked',
        description: 'Accepted suggestions already linked to an order ticket.',
        group: 'execution',
      },
      {
        id: 'working',
        label: 'Working',
        count: summary.working,
        selected: selectedExecutionState === 'working',
        description: 'Orders actively working in the market.',
        group: 'execution',
      },
      {
        id: 'filled',
        label: 'Filled',
        count: summary.filled,
        selected: selectedExecutionState === 'filled',
        description: 'Orders filled and positions now open.',
        group: 'execution',
      },
      {
        id: 'closed',
        label: 'Closed',
        count: summary.closed,
        selected: selectedExecutionState === 'closed',
        description: 'Execution lifecycle finished and positions closed.',
        group: 'execution',
      },
    ];
  }

  private buildJourney(
    currentStepId: 'accept_trade' | 'link_order' | 'track_execution'
  ): SuggestedTradesOverviewResponse['journey'] {
    const order = [
      'signal_detected',
      'signal_review',
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
        description: 'A qualifying strategy source created a new signal.',
      },
      {
        id: 'signal_review',
        label: 'Review Signal',
        description: 'The signal was triaged and promoted into the execution review path.',
      },
      {
        id: 'signal_queued',
        label: 'Queue Trade',
        description: 'The signal was converted into a suggested trade for operator review.',
      },
      {
        id: 'accept_trade',
        label: 'Accept Trade',
        description: 'Review the suggestion and decide whether it is executable.',
      },
      {
        id: 'link_order',
        label: 'Link Order',
        description: 'Attach the accepted suggestion to a live or paper order.',
      },
      {
        id: 'track_execution',
        label: 'Track Execution',
        description: 'Follow the order through working, filled, and closed states.',
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
      id: 'suggested-trades-operator-flow',
      label: 'Operator Journey',
      description: 'Suggested Trades is the bridge between signal review and real execution tracking.',
      steps,
    };
  }
}
