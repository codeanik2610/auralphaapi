import { Inject, Service } from 'typedi';
import {
  BrokerAccountRepository,
  PaperOrderRepository,
  PaperTradingReadModelRepository,
  PaperAccountReadModelRow,
  PaperPositionEventRow,
  PaperPositionReadModelRow,
  SuggestedTradeRepository,
} from '../../database';
import { PaperOrder } from '../../database/entities/PaperOrder';
import { BrokerAccount } from '../../database/entities/BrokerAccount';
import {
  PositionLifecycleResponse,
  PositionRecord,
  PositionsAccountFreshness,
  PositionsAccountItem,
  PositionsFreshnessIndicator,
  PositionsFreshnessState,
  PositionsGroupedFreshnessSummary,
  PositionsGroupedResponse,
} from '../contracts/Positions';
import {
  buildApiTimeContract,
  formatApiDisplayTime,
  formatApiRawIso,
} from '../utils/apiTimeContract';
import { successResponse } from '../utils/response';
import { UserTimeZoneService } from './UserTimeZoneService';
import { PaperOrderExecutionService } from './PaperOrderExecutionService';
import { SuggestedTradesService } from './SuggestedTradesService';
import {
  PositionsHistoryQuery,
  PositionsQuery,
  validatePositionId,
  validatePositionsHistoryQuery,
  validatePositionsQuery,
  validatePositionsRefreshBody,
} from '../validators/positions.validator';
import {
  PortfolioOverviewQuery,
  validatePaperPortfolioAccountResetBody,
  validatePaperPortfolioAccountsQuery,
  validatePaperPortfolioAccountUpdateBody,
  validatePortfolioOverviewQuery,
  validatePortfolioTimeframe,
} from '../validators/portfolio.validator';
import { BadRequestAppError, NotFoundAppError } from '../errors/AppError';
import { getUtcDateRangeFromLocalDates } from '../utils/timezone';
import { env } from '../../env';

type PaperSimulationState = {
  executionState?: string | null;
  lastPrice?: string | null;
  lastPriceSeenAt?: string | null;
  filledAt?: string | null;
  filledPrice?: string | null;
  filledQuantity?: number | string | null;
  remainingQuantity?: number | string | null;
  positionId?: string | null;
  positionStatus?: string | null;
  positionOpenedAt?: string | null;
  positionClosedAt?: string | null;
  closedAt?: string | null;
  exitPrice?: string | null;
  realizedPnl?: string | null;
  outcome?: string | null;
  closeReason?: string | null;
  lastObservationSource?: string | null;
};

type PaperAccountCatalog = {
  id: string;
  brokerKey: string;
  accountName: string | null;
  accountKey: string | null;
  accountStatus: string | null;
  label: string | null;
  startingBalance: number;
  resetAt: Date | null;
};

const DEFAULT_PAPER_STARTING_BALANCE = 100_000;

@Service()
export class PaperTradingWorkspaceService {
  @Inject(() => PaperOrderRepository)
  private paperOrderRepository!: PaperOrderRepository;

  @Inject(() => PaperOrderExecutionService)
  private paperOrderExecutionService!: PaperOrderExecutionService;

  @Inject(() => PaperTradingReadModelRepository)
  private paperTradingReadModelRepository!: PaperTradingReadModelRepository;

  @Inject(() => BrokerAccountRepository)
  private brokerAccountRepository!: BrokerAccountRepository;

  @Inject(() => SuggestedTradesService)
  private suggestedTradesService!: SuggestedTradesService;

  @Inject(() => SuggestedTradeRepository)
  private suggestedTradeRepository!: SuggestedTradeRepository;

  @Inject(() => UserTimeZoneService)
  private userTimeZoneService!: UserTimeZoneService;

  async syncUserReadModel(
    userId: string,
    options: {
      brokerKey?: string;
      accountId?: string;
      skipSimulation?: boolean;
    } = {}
  ): Promise<void> {
    const simulation = options.skipSimulation
      ? {
          updatedOrderIds: [],
        }
      : await this.paperOrderExecutionService.simulateUserPaperOrders(
          userId,
          {
            brokerKey: options.brokerKey,
            accountId: options.accountId,
          }
        );

    if (simulation.updatedOrderIds.length) {
      await this.suggestedTradesService.syncExecutionForPaperOrderUpdates(
        userId,
        simulation.updatedOrderIds
      );
    }

    const [paperOrders, activeAccounts, existingAccounts] = await Promise.all([
      this.paperOrderRepository.listAllPaperOrders(userId),
      this.brokerAccountRepository.getActiveBrokerAccounts(userId),
      this.paperTradingReadModelRepository.listAccounts(userId),
    ]);

    const previousStartingBalanceByAccountId = new Map(
      existingAccounts.map((item) => [
        String(item.linkedAccountId || '').trim(),
        this.toNumber(item.startingBalance) ?? DEFAULT_PAPER_STARTING_BALANCE,
      ])
    );
    const previousResetAtByAccountId = new Map(
      existingAccounts.map((item) => [
        String(item.linkedAccountId || '').trim(),
        this.toDate(item.resetAt),
      ])
    );

    const accountCatalog = this.buildAccountCatalog(
      paperOrders,
      activeAccounts,
      previousStartingBalanceByAccountId,
      previousResetAtByAccountId
    );
    const positions = this.buildPaperPositionRows(paperOrders, accountCatalog);
    const accounts = this.buildPaperAccountRows(
      userId,
      accountCatalog,
      positions
    );
    const events = this.buildPaperPositionEvents(positions);

    await this.paperTradingReadModelRepository.replaceUserReadModel(userId, {
      accounts,
      positions,
      events,
    });
  }

  async syncUsers(
    userIds: string[],
    options: {
      skipSimulation?: boolean;
    } = {}
  ): Promise<void> {
    const normalized = Array.from(
      new Set(userIds.map((item) => String(item || '').trim()).filter(Boolean))
    );

    for (const userId of normalized) {
      await this.syncUserReadModel(userId, {
        skipSimulation: options.skipSimulation,
      });
    }
  }

  async getPaperPositionsForActiveAccounts(
    userId: string,
    brokerKey?: string,
    query: PositionsQuery = {}
  ): Promise<unknown> {
    const params = validatePositionsQuery({ ...query, brokerKey });
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    await this.syncUserReadModel(userId, {
      brokerKey: params.brokerKey,
      accountId: params.accountId,
    });

    const [accountRows, positionRows] = await Promise.all([
      this.paperTradingReadModelRepository.listAccounts(userId),
      this.paperTradingReadModelRepository.listPositions(userId, {
        brokerKey: params.brokerKey,
        accountId: params.accountId,
        statusKey: 'open',
        limit: params.limit,
      }),
    ]);

    return successResponse(
      this.buildGroupedPositionsResponse({
        userId,
        timeZone,
        accountRows,
        positionRows,
        preferredKey: 'positions',
        definition: 'Open paper positions grouped by broker route from the paper position read model.',
      })
    );
  }

  async getPaperPositionHistoryForActiveAccounts(
    userId: string,
    query: PositionsHistoryQuery = {}
  ): Promise<unknown> {
    const params = validatePositionsHistoryQuery(query);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);
    const { startUtc, endUtc } = getUtcDateRangeFromLocalDates(
      params.startDate,
      params.endDate,
      timeZone
    );

    await this.syncUserReadModel(userId, {
      brokerKey: params.brokerKey,
      accountId: params.accountId,
    });

    const [accountRows, positionRows] = await Promise.all([
      this.paperTradingReadModelRepository.listAccounts(userId),
      this.paperTradingReadModelRepository.listPositions(userId, {
        brokerKey: params.brokerKey,
        accountId: params.accountId,
        statusKey: 'closed',
        startDate: startUtc,
        endDate: endUtc,
        limit: params.limit,
      }),
    ]);

    return successResponse(
      this.buildGroupedPositionsResponse({
        userId,
        timeZone,
        accountRows,
        positionRows,
        preferredKey: 'history',
        definition: 'Closed paper positions grouped by broker route from the paper position read model.',
      })
    );
  }

  async getPaperPositionLifecycle(
    userId: string,
    positionId: string
  ): Promise<unknown> {
    const validatedPositionId = validatePositionId(positionId);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    await this.syncUserReadModel(userId);

    const position = await this.paperTradingReadModelRepository.getPositionById(
      userId,
      validatedPositionId
    );
    if (!position) {
      throw new NotFoundAppError('Paper position not found');
    }

    const [account, events, paperOrder, suggestedTrade] = await Promise.all([
      this.paperTradingReadModelRepository.getAccountByLinkedAccountId(
        userId,
        position.linkedAccountId
      ),
      this.paperTradingReadModelRepository.listEventsByPositionId(
        userId,
        validatedPositionId
      ),
      this.paperOrderRepository.getPaperOrderById(userId, position.paperOrderId),
      position.suggestedTradeId
        ? this.suggestedTradeRepository.getSuggestedTradeById(
            userId,
            position.suggestedTradeId
          )
        : Promise.resolve(null),
    ]);

    const positionRecord = this.mapPositionRowToRecord(position, timeZone);
    const freshness = this.buildAccountFreshness(
      account,
      position.lastSeenAt || position.updatedAt || position.createdAt
    );
    const positionFreshness = this.buildFreshnessIndicator(
      position.lastSeenAt || position.updatedAt || position.createdAt,
      'paper_position_read_models'
    );

    const relatedOrders = paperOrder
      ? [
          {
            id: paperOrder.id,
            kind: 'paper' as const,
            relation: 'position' as const,
            symbol: paperOrder.symbol || position.symbol,
            status: paperOrder.status,
            side: paperOrder.side,
            orderType: paperOrder.orderType,
            triggerType: paperOrder.triggerType,
            quantity: this.toNumber(paperOrder.quantity),
            orderPrice: this.toNumber(paperOrder.orderPrice),
            stopLossPrice: this.toNumber(paperOrder.stoplossPrice),
            takeProfitPrice: this.toNumber(paperOrder.takeprofitPrice),
            reduceOnly: paperOrder.reduceOnly,
            linkedPositionId: position.id,
            createdAt: formatApiRawIso(paperOrder.createdAt) || null,
            updatedAt: formatApiRawIso(paperOrder.updatedAt) || null,
            detailUrl: `/orders?tab=paper&detail=${encodeURIComponent(paperOrder.id)}`,
          },
        ]
      : [];

    const relatedSuggestedTrades =
      suggestedTrade && position.suggestedTradeId
        ? [
            {
              id: suggestedTrade.id,
              symbol: suggestedTrade.symbol,
              timeframe: suggestedTrade.timeframe,
              side: suggestedTrade.side,
              status: suggestedTrade.status,
              signalTime:
                formatApiRawIso(suggestedTrade.signalTime) ||
                String(suggestedTrade.signalTime),
              confidence: this.toNumber(suggestedTrade.confidence),
              score: this.toNumber(suggestedTrade.score),
              executionMode: 'paper' as const,
              executionState: position.executionState,
              linkedPositionId: position.id,
              linkedPaperOrderId: position.paperOrderId,
              sourceTemplateId: suggestedTrade.sourceTemplateId,
              sourceBacktestId: suggestedTrade.sourceBacktestId,
              detailUrl: `/trade-ideas?selected=${encodeURIComponent(suggestedTrade.id)}`,
              linkedEntities: [],
            },
          ]
        : [];

    const recentActivity = events.map((item) => ({
      id: item.id,
      type: 'Paper position',
      title: this.humanizeEventType(item.eventType),
      status:
        item.eventType === 'closed'
          ? 'Success'
          : item.eventType === 'cancelled'
            ? 'Warning'
            : 'Info',
      actor: 'Simulation engine',
      symbol: item.symbol || null,
      stream: 'Paper execution',
      route: 'Positions',
      related: [item.brokerKey, item.linkedAccountId].filter(Boolean).join(' · ') || null,
      referenceId: item.paperOrderId,
      correlationId: item.paperPositionId || item.paperOrderId,
      description: this.buildEventDescription(item),
      flags: null,
      createdAt: formatApiRawIso(item.occurredAt) || item.occurredAt.toISOString(),
    }));

    const response: PositionLifecycleResponse = {
      position: positionRecord,
      account: account
        ? {
            id: account.linkedAccountId,
            accountName: account.accountName || account.label || account.linkedAccountId,
            accountKey: account.accountKey || account.linkedAccountId,
            brokerKey: account.brokerKey,
            status: account.accountStatus || 'Paper',
            mode: 'paper',
            purpose: 'simulation',
            capabilities: 'paper_positions,paper_portfolio',
            isDefault: false,
            lastSyncAt: formatApiDisplayTime(account.observedAt, timeZone) || null,
          }
        : null,
      summary: {
        relatedOrders: relatedOrders.length,
        openAlerts: 0,
        linkedSuggestedTrades: relatedSuggestedTrades.length,
        recentActivity: recentActivity.length,
      },
      freshness: {
        account: freshness?.account || null,
        checkpoint: null,
        warning: freshness?.warning || null,
        position: positionFreshness,
      },
      relatedOrders,
      relatedAlerts: [],
      relatedSuggestedTrades,
      recentActivity,
      relatedLinks: [],
    };

    return successResponse(response);
  }

  async getPaperAccounts(
    userId: string,
    query: {
      brokerKey?: string;
      accountId?: string;
    } = {}
  ): Promise<unknown> {
    const params = validatePaperPortfolioAccountsQuery(query);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    await this.syncUserReadModel(userId, {
      brokerKey: params.brokerKey,
      accountId: params.accountId,
    });

    const items = (await this.paperTradingReadModelRepository.listAccounts(userId))
      .filter((item) =>
        params.brokerKey
          ? String(item.brokerKey || '').trim().toLowerCase() ===
            String(params.brokerKey || '').trim().toLowerCase()
          : true
      )
      .filter((item) =>
        params.accountId
          ? String(item.linkedAccountId || '').trim() ===
            String(params.accountId || '').trim()
          : true
      )
      .map((item) => this.mapPaperAccountWorkspaceItem(item, timeZone));

    const observedAtIso = this.pickLatestTimestamp(
      items.map((item) => item.observedAtIso)
    );

    return successResponse({
      source: 'paper_accounts',
      definition:
        'Paper account workspace state derived from paper-account balances, margin, and reset metadata.',
      observedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
      observedAtIso,
      total: items.length,
      items,
      time: buildApiTimeContract(timeZone),
    });
  }

  async updatePaperAccount(
    userId: string,
    accountId: string,
    body: {
      startingBalance?: number | string;
    } = {}
  ): Promise<unknown> {
    const validatedAccountId = String(accountId || '').trim();
    if (!validatedAccountId) {
      throw new BadRequestAppError('accountId is required');
    }

    const payload = validatePaperPortfolioAccountUpdateBody(body);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    await this.syncUserReadModel(userId, {
      accountId: validatedAccountId,
      skipSimulation: true,
    });

    const existing = await this.paperTradingReadModelRepository.getAccountByLinkedAccountId(
      userId,
      validatedAccountId
    );
    if (!existing) {
      throw new NotFoundAppError('Paper account not found');
    }

    await this.paperTradingReadModelRepository.updateAccountSettings(
      userId,
      validatedAccountId,
      {
        startingBalance: payload.startingBalance,
      }
    );

    await this.syncUserReadModel(userId, {
      brokerKey: existing.brokerKey,
      accountId: validatedAccountId,
      skipSimulation: true,
    });

    const updated = await this.paperTradingReadModelRepository.getAccountByLinkedAccountId(
      userId,
      validatedAccountId
    );
    if (!updated) {
      throw new NotFoundAppError('Paper account not found after update');
    }

    return successResponse({
      message: 'Paper account updated',
      account: this.mapPaperAccountWorkspaceItem(updated, timeZone),
    });
  }

  async resetPaperAccount(
    userId: string,
    accountId: string,
    body: {
      startingBalance?: number | string;
    } = {}
  ): Promise<unknown> {
    const validatedAccountId = String(accountId || '').trim();
    if (!validatedAccountId) {
      throw new BadRequestAppError('accountId is required');
    }

    const payload = validatePaperPortfolioAccountResetBody(body);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    await this.syncUserReadModel(userId, {
      accountId: validatedAccountId,
      skipSimulation: true,
    });

    const existing = await this.paperTradingReadModelRepository.getAccountByLinkedAccountId(
      userId,
      validatedAccountId
    );
    if (!existing) {
      throw new NotFoundAppError('Paper account not found');
    }

    await this.paperTradingReadModelRepository.updateAccountSettings(
      userId,
      validatedAccountId,
      {
        startingBalance:
          payload.startingBalance ??
          this.toNumber(existing.startingBalance) ??
          DEFAULT_PAPER_STARTING_BALANCE,
        resetAt: new Date(),
      }
    );

    await this.syncUserReadModel(userId, {
      brokerKey: existing.brokerKey,
      accountId: validatedAccountId,
      skipSimulation: true,
    });

    const updated = await this.paperTradingReadModelRepository.getAccountByLinkedAccountId(
      userId,
      validatedAccountId
    );
    if (!updated) {
      throw new NotFoundAppError('Paper account not found after reset');
    }

    return successResponse({
      message: 'Paper account reset',
      account: this.mapPaperAccountWorkspaceItem(updated, timeZone),
    });
  }

  async runPaperSimulation(
    userId: string,
    body: {
      brokerKey?: string;
      accountId?: string;
    } = {}
  ): Promise<unknown> {
    const params = validatePositionsRefreshBody(body);
    const simulation = await this.paperOrderExecutionService.simulateUserPaperOrders(
      userId,
      {
        brokerKey: params.brokerKey,
        accountId: params.accountId,
      }
    );

    if (simulation.updatedOrderIds.length) {
      await this.suggestedTradesService.syncExecutionForPaperOrderUpdates(
        userId,
        simulation.updatedOrderIds
      );
    }

    await this.syncUserReadModel(userId, {
      brokerKey: params.brokerKey,
      accountId: params.accountId,
      skipSimulation: true,
    });

    return successResponse({
      message:
        simulation.updatedOrderIds.length > 0
          ? 'Paper simulation refreshed'
          : 'Paper simulation already current',
      brokerKey: params.brokerKey || null,
      accountId: params.accountId || null,
      processedOrders: simulation.processedOrders,
      updatedOrders: simulation.updatedOrderIds.length,
      updatedOrderIds: simulation.updatedOrderIds,
      refreshedAt: new Date().toISOString(),
    });
  }

  async closePaperPosition(
    userId: string,
    positionId: string
  ): Promise<unknown> {
    const validatedPositionId = validatePositionId(positionId);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    await this.syncUserReadModel(userId, {
      skipSimulation: true,
    });

    const position = await this.paperTradingReadModelRepository.getPositionById(
      userId,
      validatedPositionId
    );
    if (!position) {
      throw new NotFoundAppError('Paper position not found');
    }
    if (position.statusKey !== 'open') {
      throw new BadRequestAppError('Only open paper positions can be closed');
    }

    await this.paperOrderExecutionService.closePaperOrderAtMarket(
      userId,
      position.paperOrderId
    );
    await this.suggestedTradesService.syncExecutionForPaperOrderUpdates(userId, [
      position.paperOrderId,
    ]);

    await this.syncUserReadModel(userId, {
      brokerKey: position.brokerKey,
      accountId: position.linkedAccountId,
      skipSimulation: true,
    });

    const updated = await this.paperTradingReadModelRepository.getPositionById(
      userId,
      validatedPositionId
    );
    if (!updated) {
      throw new NotFoundAppError('Paper position not found after close');
    }

    return successResponse({
      message: 'Paper position closed',
      position: this.mapPositionRowToRecord(updated, timeZone),
    });
  }

  async getPaperPortfolioOverview(
    userId: string,
    query: PortfolioOverviewQuery = {}
  ): Promise<unknown> {
    const params = validatePortfolioOverviewQuery(query);
    const timeZone = await this.userTimeZoneService.resolveUserTimeZone(userId);

    await this.syncUserReadModel(userId);

    const [accountRows, openPositions, closedPositions] = await Promise.all([
      this.paperTradingReadModelRepository.listAccounts(userId),
      this.paperTradingReadModelRepository.listPositions(userId, {
        statusKey: 'open',
        limit: params.holdingsLimit,
      }),
      this.paperTradingReadModelRepository.listPositions(userId, {
        statusKey: 'closed',
      }),
    ]);

    const futuresSummary = this.buildPortfolioFuturesSummary(
      accountRows,
      openPositions,
      timeZone
    );
    const positions = this.buildPortfolioPositionsSlice(
      openPositions,
      params.holdingsLimit,
      timeZone
    );
    const capital = this.buildPortfolioCapitalOverview(accountRows, timeZone);
    const activity = this.buildPortfolioActivityOverview(
      accountRows,
      closedPositions,
      params.timeframe,
      timeZone
    );
    const summary = this.buildPortfolioSummaryAlias(
      futuresSummary,
      positions,
      activity,
      timeZone
    );

    const generatedAtIso = new Date().toISOString();
    const observedAtIso = this.pickLatestTimestamp([
      futuresSummary.observedAtIso,
      positions.observedAtIso,
      capital.latestObservedAtIso,
      activity.observedAtIso,
    ]);

    return successResponse({
      meta: {
        contractVersion: 'paper-portfolio-overview-release1-2026-04-23',
        purpose: 'operator_paper_portfolio_workspace',
        generatedAt: formatApiDisplayTime(generatedAtIso, timeZone) || generatedAtIso,
        generatedAtIso,
        summary:
          'Paper portfolio overview is simulation-first: capital comes from paper accounts, positions come from the paper position read model, and activity comes from closed paper positions.',
        primaryPageRoute: '/portfolio',
        primaryEndpoint: '/portfolio/paper/overview',
        pageHydration: 'single-request',
        query: {
          supported: ['timeframe', 'holdingsLimit'],
          unsupported: ['brokerKey', 'accountId', 'snapshotsLimit', 'snapshotsOffset'],
          resolved: {
            timeframe: params.timeframe,
            snapshots: { limit: 0, offset: 0 },
            holdings: {
              limit: params.holdingsLimit,
              offset: 0,
              filterMode: 'loaded_overview_slice_client_side',
            },
          },
        },
        sections: {
          summary: this.buildOverviewSectionMeta(
            'paper_accounts_plus_paper_position_read_models',
            'Paper futures summary',
            observedAtIso,
            'mixed_futures_state',
            'Simulated paper equity, exposure, and margin posture.',
            'Paper summary updates when the paper simulator or a read-model rebuild runs.'
          ),
          positions: this.buildOverviewSectionMeta(
            'paper_position_read_models',
            'Paper positions',
            positions.observedAtIso,
            'position_read_model_timestamp',
            'Open simulated paper positions for the current workspace.',
            'This positions slice is simulation-backed and separate from live broker exposure.'
          ),
          capital: this.buildOverviewSectionMeta(
            'paper_accounts',
            'Paper capital',
            capital.latestObservedAtIso,
            'funds_snapshot_timestamp',
            'Virtual paper capital per route derived from paper accounts.',
            'Paper capital is virtual and should never be confused with live broker balances.'
          ),
          activity: this.buildOverviewSectionMeta(
            'paper_position_read_models',
            'Paper activity',
            activity.observedAtIso,
            'windowed_activity',
            'Closed paper-position realized activity for the selected timeframe.',
            'Activity reflects simulated outcomes only.'
          ),
        },
        warnings: [],
        time: buildApiTimeContract(timeZone),
      },
      pnl: activity.pnl,
      performance: activity.performance,
      summary,
      holdings: positions,
      snapshots: {
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
        source: 'portfolio_overview_futures_legacy_alias',
        observedAt: null,
        observedAtIso: null,
        definition: 'Paper portfolio overview does not use legacy snapshots.',
        time: buildApiTimeContract(timeZone),
      },
      activeFunds: capital,
      futuresSummary,
      positions,
      capital,
      activity,
      time: buildApiTimeContract(timeZone),
    });
  }

  private buildAccountCatalog(
    paperOrders: PaperOrder[],
    activeAccounts: BrokerAccount[],
    previousStartingBalanceByAccountId: Map<string, number>,
    previousResetAtByAccountId: Map<string, Date | null>
  ): Map<string, PaperAccountCatalog> {
    const catalog = new Map<string, PaperAccountCatalog>();

    activeAccounts.forEach((account) => {
      const accountId = String(account.id || '').trim();
      if (!accountId) {
        return;
      }

      catalog.set(accountId, {
        id: accountId,
        brokerKey: String(account.brokerKey || '').trim(),
        accountName: account.accountName || null,
        accountKey: account.accountKey || null,
        accountStatus: account.status || null,
        label: account.accountName
          ? `${account.accountName} Paper`
          : `${account.accountKey || accountId} Paper`,
        startingBalance:
          previousStartingBalanceByAccountId.get(accountId) ??
          DEFAULT_PAPER_STARTING_BALANCE,
        resetAt: previousResetAtByAccountId.get(accountId) ?? null,
      });
    });

    paperOrders.forEach((order) => {
      const accountId = String(order.accountId || '').trim();
      if (!accountId || catalog.has(accountId)) {
        return;
      }

      catalog.set(accountId, {
        id: accountId,
        brokerKey: String(order.brokerKey || '').trim(),
        accountName: null,
        accountKey: accountId,
        accountStatus: 'Disconnected',
        label: `${accountId} Paper`,
        startingBalance:
          previousStartingBalanceByAccountId.get(accountId) ??
          DEFAULT_PAPER_STARTING_BALANCE,
        resetAt: previousResetAtByAccountId.get(accountId) ?? null,
      });
    });

    return catalog;
  }

  private buildPaperPositionRows(
    paperOrders: PaperOrder[],
    accountCatalog: Map<string, PaperAccountCatalog>
  ): PaperPositionReadModelRow[] {
    return paperOrders
      .filter((order) => {
        const account = accountCatalog.get(String(order.accountId || '').trim());
        const resetAt = account?.resetAt;
        if (!resetAt) {
          return true;
        }

        const orderCreatedAt = this.toDate(order.createdAt);
        if (!orderCreatedAt) {
          return true;
        }

        return orderCreatedAt.getTime() >= resetAt.getTime();
      })
      .map((order) => this.mapPaperOrderToPositionRow(order, accountCatalog))
      .filter((item): item is PaperPositionReadModelRow => Boolean(item));
  }

  private mapPaperOrderToPositionRow(
    order: PaperOrder,
    accountCatalog: Map<string, PaperAccountCatalog>
  ): PaperPositionReadModelRow | null {
    const simulation = this.readSimulation(order.payload);
    const executionState = this.readString(simulation.executionState).toLowerCase() || null;
    const lifecycleStage = this.deriveLifecycleStage(order.status, executionState);

    if (lifecycleStage !== 'open_position' && lifecycleStage !== 'closed_position') {
      return null;
    }

    const account = accountCatalog.get(String(order.accountId || '').trim());
    const side = this.normalizeSide(order.side);
    const quantity = this.toNumber(order.quantity) ?? 0;
    const entryPrice =
      this.toNumber(simulation.filledPrice) ??
      this.toNumber(order.orderPrice);
    const currentPrice =
      lifecycleStage === 'open_position'
        ? this.toNumber(simulation.lastPrice) ?? entryPrice
        : null;
    const exitPrice =
      lifecycleStage === 'closed_position'
        ? this.toNumber(simulation.exitPrice)
        : null;
    const leverage = this.toNumber(order.leverage);
    const exposure = this.computeExposure(
      quantity,
      lifecycleStage === 'open_position'
        ? currentPrice ?? entryPrice
        : exitPrice ?? entryPrice
    );
    const unrealizedPnl =
      lifecycleStage === 'open_position'
        ? this.computeUnrealizedPnl(side.key, entryPrice, currentPrice, quantity)
        : null;
    const realizedPnl =
      lifecycleStage === 'closed_position'
        ? this.toNumber(simulation.realizedPnl)
        : null;
    const createdAt = this.toDate(order.createdAt) || new Date();
    const openedAt =
      this.toDate(simulation.positionOpenedAt) ||
      this.toDate(simulation.filledAt) ||
      createdAt;
    const updatedAt =
      this.toDate(order.updatedAt) ||
      this.toDate(simulation.lastPriceSeenAt) ||
      openedAt;
    const closedAt =
      this.toDate(simulation.positionClosedAt) ||
      this.toDate(simulation.closedAt);
    const lastSeenAt =
      this.toDate(simulation.lastPriceSeenAt) ||
      updatedAt ||
      openedAt;

    return {
      id: order.id,
      userId: order.userId,
      paperAccountId: account?.id || String(order.accountId || '').trim(),
      paperOrderId: order.id,
      suggestedTradeId: order.suggestedTradeId || null,
      brokerKey: account?.brokerKey || String(order.brokerKey || '').trim(),
      linkedAccountId: String(order.accountId || '').trim(),
      accountName: account?.accountName || null,
      accountKey: account?.accountKey || String(order.accountId || '').trim(),
      accountStatus: account?.accountStatus || 'Paper',
      symbol: String(order.symbol || order.assetId || '').trim().toUpperCase(),
      side: side.label,
      sideKey: side.key,
      status: lifecycleStage === 'open_position' ? 'Open' : 'Closed',
      statusKey: lifecycleStage === 'open_position' ? 'open' : 'closed',
      executionState,
      quantity,
      entryPrice,
      currentPrice,
      exitPrice,
      stopLossPrice: this.toNumber(order.stoplossPrice),
      takeProfitPrice: this.toNumber(order.takeprofitPrice),
      leverage,
      liquidationPrice: null,
      exposure,
      unrealizedPnl,
      realizedPnl,
      outcome: this.readString(simulation.outcome) || null,
      closeReason: this.readString(simulation.closeReason) || null,
      observationSource: this.readString(simulation.lastObservationSource) || null,
      payload: order.payload,
      createdAt,
      openedAt,
      updatedAt,
      closedAt,
      firstSeenAt: createdAt,
      lastSeenAt,
    };
  }

  private buildPaperAccountRows(
    userId: string,
    accountCatalog: Map<string, PaperAccountCatalog>,
    positions: PaperPositionReadModelRow[]
  ): PaperAccountReadModelRow[] {
    const positionsByAccountId = new Map<string, PaperPositionReadModelRow[]>();
    positions.forEach((position) => {
      const key = String(position.linkedAccountId || '').trim();
      if (!positionsByAccountId.has(key)) {
        positionsByAccountId.set(key, []);
      }
      positionsByAccountId.get(key)?.push(position);
    });

    return Array.from(accountCatalog.values()).map((account) => {
      const accountPositions = positionsByAccountId.get(account.id) || [];
      const openPositions = accountPositions.filter(
        (item) => item.statusKey === 'open'
      );
      const closedPositions = accountPositions.filter(
        (item) => item.statusKey === 'closed'
      );
      const realizedPnl = closedPositions.reduce(
        (sum, item) => sum + (this.toNumber(item.realizedPnl) ?? 0),
        0
      );
      const unrealizedPnl = openPositions.reduce(
        (sum, item) => sum + (this.toNumber(item.unrealizedPnl) ?? 0),
        0
      );
      const usedMargin = openPositions.reduce((sum, item) => {
        const exposure = this.toNumber(item.exposure) ?? 0;
        const leverage = this.toNumber(item.leverage);
        if (leverage && leverage > 0) {
          return sum + exposure / leverage;
        }
        return sum + exposure;
      }, 0);
      const cashBalance = account.startingBalance + realizedPnl;
      const equity = cashBalance + unrealizedPnl;
      const availableMargin = equity - usedMargin;
      const observedAt = this.pickLatestDate(
        accountPositions.map((item) => item.lastSeenAt || item.updatedAt || item.createdAt)
      );

      return {
        id: account.id,
        userId,
        brokerKey: account.brokerKey,
        linkedAccountId: account.id,
        accountName: account.accountName,
        accountKey: account.accountKey,
        accountStatus: account.accountStatus,
        label: account.label,
        baseCurrency: 'USD',
        startingBalance: account.startingBalance,
        cashBalance,
        equity,
        usedMargin,
        availableMargin,
        openPositions: openPositions.length,
        closedPositions: closedPositions.length,
        realizedPnl,
        unrealizedPnl,
        observedAt,
        resetAt: account.resetAt,
      };
    });
  }

  private buildPaperPositionEvents(
    positions: PaperPositionReadModelRow[]
  ): PaperPositionEventRow[] {
    const events: PaperPositionEventRow[] = [];

    positions.forEach((position) => {
      if (position.createdAt) {
        events.push({
          id: `${position.paperOrderId}:created`,
          userId: position.userId,
          paperAccountId: position.paperAccountId,
          paperPositionId: position.id,
          paperOrderId: position.paperOrderId,
          brokerKey: position.brokerKey,
          linkedAccountId: position.linkedAccountId,
          symbol: position.symbol,
          side: position.side,
          eventType: 'created',
          price: position.entryPrice,
          quantity: position.quantity,
          realizedPnlDelta: null,
          equityAfter: null,
          occurredAt: position.createdAt,
          payload: {
            status: position.status,
          },
        });
      }

      if (position.openedAt) {
        events.push({
          id: `${position.paperOrderId}:opened`,
          userId: position.userId,
          paperAccountId: position.paperAccountId,
          paperPositionId: position.id,
          paperOrderId: position.paperOrderId,
          brokerKey: position.brokerKey,
          linkedAccountId: position.linkedAccountId,
          symbol: position.symbol,
          side: position.side,
          eventType: 'opened',
          price: position.entryPrice,
          quantity: position.quantity,
          realizedPnlDelta: null,
          equityAfter: null,
          occurredAt: position.openedAt,
          payload: {
            executionState: position.executionState,
          },
        });
      }

      if (position.statusKey === 'closed' && position.closedAt) {
        events.push({
          id: `${position.paperOrderId}:closed`,
          userId: position.userId,
          paperAccountId: position.paperAccountId,
          paperPositionId: position.id,
          paperOrderId: position.paperOrderId,
          brokerKey: position.brokerKey,
          linkedAccountId: position.linkedAccountId,
          symbol: position.symbol,
          side: position.side,
          eventType: 'closed',
          price: position.exitPrice,
          quantity: position.quantity,
          realizedPnlDelta: position.realizedPnl,
          equityAfter: null,
          occurredAt: position.closedAt,
          payload: {
            outcome: position.outcome,
            closeReason: position.closeReason,
          },
        });
      }
    });

    return events;
  }

  private buildGroupedPositionsResponse(input: {
    userId: string;
    timeZone: string;
    accountRows: PaperAccountReadModelRow[];
    positionRows: PaperPositionReadModelRow[];
    preferredKey: 'positions' | 'history';
    definition: string;
  }): PositionsGroupedResponse {
    const accountById = new Map(
      input.accountRows.map((item) => [item.linkedAccountId, item] as const)
    );
    const groupedByAccountId = new Map<string, PositionRecord[]>();

    input.positionRows.forEach((row) => {
      const accountId = String(row.linkedAccountId || '').trim();
      if (!groupedByAccountId.has(accountId)) {
        groupedByAccountId.set(accountId, []);
      }
      groupedByAccountId.get(accountId)?.push(
        this.mapPositionRowToRecord(row, input.timeZone)
      );
    });

    const accountIds = Array.from(
      new Set([
        ...input.accountRows.map((item) => item.linkedAccountId),
        ...groupedByAccountId.keys(),
      ])
    ).filter(Boolean);

    const items: PositionsAccountItem[] = accountIds.map((accountId) => {
      const account = accountById.get(accountId) || null;
      const rows = groupedByAccountId.get(accountId) || [];
      const freshness = this.buildAccountFreshness(
        account,
        account?.observedAt || this.pickLatestDate(rows.map((item) => item.last_seen_at)) || null
      );

      return {
        accountId,
        accountName:
          account?.accountName ||
          account?.label ||
          account?.accountKey ||
          accountId,
        accountKey: account?.accountKey || accountId,
        brokerKey: account?.brokerKey || rows[0]?.brokerKey || '',
        status: account?.accountStatus || 'Paper',
        totalPositions: input.preferredKey === 'positions' ? rows.length : 0,
        totalHistory: input.preferredKey === 'history' ? rows.length : 0,
        data: rows,
        positions: input.preferredKey === 'positions' ? rows : [],
        history: input.preferredKey === 'history' ? rows : [],
        freshness,
        openOrders: [],
        closedOrders: [],
        error: null,
      };
    });

    return {
      totalActiveAccounts: items.length,
      successCount: items.length,
      failureCount: 0,
      items,
      freshness: this.summarizeGroupedFreshness(items),
      openOrders: [],
      closedOrders: [],
      definition: input.definition,
      source: 'paper_position_read_models',
    } as PositionsGroupedResponse & Record<string, unknown>;
  }

  private buildAccountFreshness(
    account: PaperAccountReadModelRow | null,
    observedAt: Date | string | null
  ): PositionsAccountFreshness | null {
    const indicator = this.buildFreshnessIndicator(
      observedAt,
      'paper_position_read_models'
    );
    return {
      account: indicator,
      checkpoint: null,
      warning:
        indicator.state === 'critical'
          ? 'Paper simulation has not refreshed recently for this account.'
          : indicator.state === 'stale'
            ? 'Paper simulation is lagging for this account.'
            : null,
    };
  }

  private summarizeGroupedFreshness(
    items: PositionsAccountItem[]
  ): PositionsGroupedFreshnessSummary | null {
    if (!items.length) {
      return null;
    }

    let observedAt: string | null = null;
    let freshAccounts = 0;
    let staleAccounts = 0;
    let criticalAccounts = 0;
    let unknownAccounts = 0;

    items.forEach((item) => {
      const state = item.freshness?.account?.state || 'unknown';
      if (state === 'fresh') freshAccounts += 1;
      else if (state === 'stale') staleAccounts += 1;
      else if (state === 'critical') criticalAccounts += 1;
      else unknownAccounts += 1;

      const candidate = item.freshness?.account?.observedAt || null;
      if (!candidate) {
        return;
      }
      if (!observedAt || new Date(candidate).getTime() > new Date(observedAt).getTime()) {
        observedAt = candidate;
      }
    });

    return {
      observedAt,
      attentionObservedAt: observedAt,
      freshAccounts,
      staleAccounts,
      criticalAccounts,
      unknownAccounts,
      warning:
        criticalAccounts > 0
          ? 'Some paper routes are critically stale.'
          : staleAccounts > 0
            ? 'Some paper routes are lagging.'
            : null,
    };
  }

  private mapPositionRowToRecord(
    row: PaperPositionReadModelRow,
    timeZone: string
  ): PositionRecord {
    return {
      id: row.id,
      external_id: row.paperOrderId,
      externalId: row.paperOrderId,
      symbol: row.symbol,
      side: row.side,
      side_raw: row.side,
      sideKey: row.sideKey,
      status: row.status,
      status_raw: row.status,
      statusKey: row.statusKey,
      quantity: this.toNumber(row.quantity),
      quantity_raw: row.quantity,
      entry_price: this.toNumber(row.entryPrice),
      current_price: this.toNumber(row.currentPrice),
      closed_price: this.toNumber(row.exitPrice),
      unrealized_pnl: this.toNumber(row.unrealizedPnl),
      realized_pnl: this.toNumber(row.realizedPnl),
      realized: this.toNumber(row.realizedPnl),
      leverage: this.toNumber(row.leverage),
      liquidation_price: this.toNumber(row.liquidationPrice),
      exposure: this.toNumber(row.exposure),
      created_at: formatApiRawIso(row.createdAt),
      updated_at: formatApiRawIso(row.updatedAt),
      closed_at: formatApiRawIso(row.closedAt),
      first_seen_at: formatApiRawIso(row.firstSeenAt),
      last_seen_at: formatApiRawIso(row.lastSeenAt),
      accountId: row.linkedAccountId,
      accountName: row.accountName || undefined,
      accountKey: row.accountKey || undefined,
      brokerKey: row.brokerKey,
      mode: 'paper',
      execution_state: row.executionState || undefined,
      last_price: this.toNumber(row.currentPrice),
      last_price_seen_at: formatApiRawIso(row.lastSeenAt),
      stoploss_price: this.toNumber(row.stopLossPrice),
      takeprofit_price: this.toNumber(row.takeProfitPrice),
      position_id: row.id,
      position_status: row.status,
      position_opened_at: formatApiRawIso(row.openedAt),
      position_closed_at: formatApiRawIso(row.closedAt),
      exit_price: this.toNumber(row.exitPrice),
      outcome: row.outcome || undefined,
      close_reason: row.closeReason || undefined,
      detailMeta: {
        sourceKind: 'paper_simulation',
        sourceLabel: 'Paper position simulation',
        freshnessModel: 'paper_position_read_model',
        fetchedAt: formatApiDisplayTime(new Date(), timeZone),
        fetchedAtIso: new Date().toISOString(),
        canLagAfterBrokerWrite: false,
      },
      freshness: this.buildFreshnessIndicator(
        row.lastSeenAt || row.updatedAt || row.createdAt,
        'paper_position_read_models'
      ),
    };
  }

  private mapPaperAccountWorkspaceItem(
    item: PaperAccountReadModelRow,
    timeZone: string
  ) {
    return {
      accountId: item.linkedAccountId,
      accountName: item.accountName || item.label || item.linkedAccountId,
      accountKey: item.accountKey || item.linkedAccountId,
      brokerKey: item.brokerKey,
      status: item.accountStatus || 'Paper',
      mode: 'paper',
      label: item.label || null,
      observedAt: formatApiDisplayTime(item.observedAt, timeZone) || null,
      observedAtIso: formatApiRawIso(item.observedAt) || null,
      resetAt: formatApiDisplayTime(item.resetAt, timeZone) || null,
      resetAtIso: formatApiRawIso(item.resetAt) || null,
      error: null,
      startingBalance: this.toNumber(item.startingBalance),
      cashBalance: this.toNumber(item.cashBalance),
      equity: this.toNumber(item.equity),
      usedMargin: this.toNumber(item.usedMargin),
      availableMargin: this.toNumber(item.availableMargin),
      openPositions: item.openPositions,
      closedPositions: item.closedPositions,
      realizedPnl: this.toNumber(item.realizedPnl),
      unrealizedPnl: this.toNumber(item.unrealizedPnl),
      funds: {
        balance: this.toNumber(item.equity),
        available: this.toNumber(item.availableMargin),
        invested: this.toNumber(item.usedMargin),
      },
    };
  }

  private buildPortfolioFuturesSummary(
    accounts: PaperAccountReadModelRow[],
    openPositions: PaperPositionReadModelRow[],
    timeZone: string
  ) {
    const futuresEquity = accounts.reduce(
      (sum, item) => sum + (this.toNumber(item.equity) ?? 0),
      0
    );
    const availableCollateral = accounts.reduce(
      (sum, item) => sum + (this.toNumber(item.availableMargin) ?? 0),
      0
    );
    const usedMargin = accounts.reduce(
      (sum, item) => sum + (this.toNumber(item.usedMargin) ?? 0),
      0
    );
    const grossExposure = openPositions.reduce(
      (sum, item) => sum + Math.abs(this.toNumber(item.exposure) ?? 0),
      0
    );
    const longExposure = openPositions.reduce(
      (sum, item) =>
        sum + (item.sideKey === 'long' ? Math.abs(this.toNumber(item.exposure) ?? 0) : 0),
      0
    );
    const shortExposure = openPositions.reduce(
      (sum, item) =>
        sum + (item.sideKey === 'short' ? Math.abs(this.toNumber(item.exposure) ?? 0) : 0),
      0
    );
    const unrealizedPnl = openPositions.reduce(
      (sum, item) => sum + (this.toNumber(item.unrealizedPnl) ?? 0),
      0
    );
    const observedAtIso = this.pickLatestTimestamp(
      accounts.map((item) => formatApiRawIso(item.observedAt))
    );

    return {
      source: 'paper_accounts_plus_paper_position_read_models',
      definition:
        'Paper futures summary built from virtual paper accounts plus the paper position read model.',
      freshnessModel: 'mixed_futures_state',
      observedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
      observedAtIso,
      positionsObservedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
      positionsObservedAtIso: observedAtIso,
      capitalObservedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
      capitalObservedAtIso: observedAtIso,
      futuresEquity,
      availableCollateral,
      usedMargin,
      walletCollateral: 0,
      openPositions: openPositions.length,
      grossExposure,
      longExposure,
      shortExposure,
      unrealizedPnl,
      time: buildApiTimeContract(timeZone),
    };
  }

  private buildPortfolioPositionsSlice(
    openPositions: PaperPositionReadModelRow[],
    limit: number,
    timeZone: string
  ) {
    const items = openPositions.slice(0, limit).map((item) => ({
      id: item.id,
      externalId: item.paperOrderId,
      symbol: item.symbol,
      side: item.side,
      sideKey: item.sideKey,
      status: item.status,
      statusKey: item.statusKey,
      quantity: this.toNumber(item.quantity),
      entryPrice: this.toNumber(item.entryPrice),
      currentPrice: this.toNumber(item.currentPrice),
      closedPrice: this.toNumber(item.exitPrice),
      unrealizedPnl: this.toNumber(item.unrealizedPnl),
      realizedPnl: this.toNumber(item.realizedPnl),
      leverage: this.toNumber(item.leverage),
      liquidationPrice: this.toNumber(item.liquidationPrice),
      exposure: this.toNumber(item.exposure),
      createdAt: formatApiRawIso(item.createdAt),
      updatedAt: formatApiRawIso(item.updatedAt),
      closedAt: formatApiRawIso(item.closedAt),
      accountId: item.linkedAccountId,
      accountName: item.accountName,
      accountKey: item.accountKey,
      brokerKey: item.brokerKey,
      observedAt: formatApiDisplayTime(item.lastSeenAt, timeZone) || null,
      observedAtIso: formatApiRawIso(item.lastSeenAt) || null,
      freshness: this.buildFreshnessIndicator(
        item.lastSeenAt || item.updatedAt || item.createdAt,
        'paper_position_read_models'
      ),
    }));
    const observedAtIso = this.pickLatestTimestamp(
      openPositions.map((item) => formatApiRawIso(item.lastSeenAt))
    );

    return {
      items,
      total: openPositions.length,
      limit,
      offset: 0,
      source: 'paper_position_read_models',
      freshnessModel: 'position_read_model_timestamp',
      observedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
      observedAtIso,
      latestObservedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
      latestObservedAtIso: observedAtIso,
      oldestObservedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
      oldestObservedAtIso: observedAtIso,
      definition:
        'Open simulated paper positions normalized from the paper position read model.',
      time: buildApiTimeContract(timeZone),
    };
  }

  private buildPortfolioCapitalOverview(
    accounts: PaperAccountReadModelRow[],
    timeZone: string
  ) {
    const items = accounts.map((item) =>
      this.mapPaperAccountWorkspaceItem(item, timeZone)
    );
    const totalVisibleCapital = items.reduce(
      (sum, item) => sum + (this.toNumber(item.funds.balance) ?? 0),
      0
    );
    const latestObservedAtIso = this.pickLatestTimestamp(
      accounts.map((item) => formatApiRawIso(item.observedAt))
    );

    return {
      source: 'paper_accounts',
      definition:
        'Virtual paper capital per route derived from paper-account balances and simulated realized/unrealized PnL.',
      freshnessModel: 'funds_snapshot_timestamp',
      latestObservedAt: formatApiDisplayTime(latestObservedAtIso, timeZone) || null,
      latestObservedAtIso,
      oldestObservedAt: formatApiDisplayTime(latestObservedAtIso, timeZone) || null,
      oldestObservedAtIso: latestObservedAtIso,
      walletItems: [],
      futuresItems: items,
      walletTotal: 0,
      futuresTotal: totalVisibleCapital,
      totalVisibleCapital,
      walletSharePct: 0,
      futuresSharePct: totalVisibleCapital > 0 ? 100 : 0,
      driftPct: 0,
      time: buildApiTimeContract(timeZone),
    };
  }

  private buildPortfolioActivityOverview(
    accounts: PaperAccountReadModelRow[],
    closedPositions: PaperPositionReadModelRow[],
    timeframe: string,
    timeZone: string
  ) {
    const resolvedTimeframe = validatePortfolioTimeframe(timeframe);
    const now = new Date();
    const nowInTz = this.toDateKeyInTimeZone(now, timeZone);
    let startDateKey: string;
    let endDateKey: string;
    let bucketLabel: 'hour' | 'day';
    let windowLabel: string;

    if (resolvedTimeframe === 'daily') {
      startDateKey = nowInTz;
      endDateKey = nowInTz;
      bucketLabel = 'hour';
      windowLabel = `Today (${timeZone})`;
    } else if (resolvedTimeframe === 'weekly') {
      startDateKey = this.shiftDateKey(nowInTz, -6);
      endDateKey = nowInTz;
      bucketLabel = 'day';
      windowLabel = `Trailing 7 days (${timeZone})`;
    } else {
      startDateKey = this.shiftDateKey(nowInTz, -29);
      endDateKey = nowInTz;
      bucketLabel = 'day';
      windowLabel = `Trailing 30 days (${timeZone})`;
    }

    const { startUtc, endUtc } = this.getUtcWindowForLocalDateRange(
      startDateKey,
      endDateKey,
      timeZone
    );

    const filtered = closedPositions.filter((item) => {
      const closedAt = this.toDate(item.closedAt);
      if (!closedAt) {
        return false;
      }
      return closedAt >= startUtc && closedAt < endUtc;
    });

    const totalPnl = filtered.reduce(
      (sum, item) => sum + (this.toNumber(item.realizedPnl) ?? 0),
      0
    );
    const totalProfit = filtered.reduce((sum, item) => {
      const pnl = this.toNumber(item.realizedPnl) ?? 0;
      return pnl > 0 ? sum + pnl : sum;
    }, 0);
    const totalLoss = filtered.reduce((sum, item) => {
      const pnl = this.toNumber(item.realizedPnl) ?? 0;
      return pnl < 0 ? sum + Math.abs(pnl) : sum;
    }, 0);
    const totalTrades = filtered.length;

    const bucketTotals = new Map<
      string,
      {
        pnl: number;
        totalProfit: number;
        totalLoss: number;
        totalTrades: number;
      }
    >();

    filtered.forEach((item) => {
      const closedAt = this.toDate(item.closedAt);
      if (!closedAt) {
        return;
      }
      const bucket = this.formatBucketInTimeZone(closedAt, timeZone, bucketLabel);
      const current = bucketTotals.get(bucket) || {
        pnl: 0,
        totalProfit: 0,
        totalLoss: 0,
        totalTrades: 0,
      };
      const pnl = this.toNumber(item.realizedPnl) ?? 0;
      current.pnl += pnl;
      if (pnl > 0) {
        current.totalProfit += pnl;
      } else if (pnl < 0) {
        current.totalLoss += Math.abs(pnl);
      }
      current.totalTrades += 1;
      bucketTotals.set(bucket, current);
    });

    const allBuckets = this.generateBucketKeys(bucketLabel, startDateKey, endDateKey);
    const startingEquity =
      accounts.reduce(
        (sum, item) => sum + (this.toNumber(item.startingBalance) ?? 0),
        0
      ) || DEFAULT_PAPER_STARTING_BALANCE;
    let rollingEquity = startingEquity;
    const points = allBuckets.map((bucket) => {
      const totals = bucketTotals.get(bucket) || {
        pnl: 0,
        totalProfit: 0,
        totalLoss: 0,
        totalTrades: 0,
      };
      rollingEquity += totals.pnl;
      return {
        date: bucket,
        equity: rollingEquity,
        pnl: totals.pnl,
        totalProfit: totals.totalProfit,
        totalLoss: totals.totalLoss,
        totalTrades: totals.totalTrades,
      };
    });

    const observedAtIso = this.pickLatestTimestamp(
      filtered.map((item) => formatApiRawIso(item.closedAt))
    );

    return {
      source: 'paper_position_read_models',
      definition:
        'Paper activity combines realized PnL windows and performance buckets from closed paper positions.',
      freshnessModel: 'windowed_activity',
      observedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
      observedAtIso,
      pnl: {
        dailyPnL: this.sumClosedPositionWindow(closedPositions, timeZone, 1),
        weeklyPnL: this.sumClosedPositionWindow(closedPositions, timeZone, 7),
        monthlyPnL: this.sumClosedPositionWindow(closedPositions, timeZone, 30),
        source: 'paper_position_read_models',
        measurement: 'realized_pnl',
        freshnessModel: 'windowed_activity',
        observedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
        observedAtIso,
        definition: 'Realized paper PnL from closed paper positions.',
        windows: {
          timezone: timeZone,
          daily: `Today (${timeZone})`,
          weekly: `Trailing 7 days (${timeZone})`,
          monthly: `Trailing 30 days (${timeZone})`,
        },
        connections: [],
        time: buildApiTimeContract(timeZone),
      },
      performance: {
        timeframe: resolvedTimeframe,
        mode: 'closed-position-activity',
        source: 'paper_position_read_models',
        measurement: 'realized_pnl',
        freshnessModel: 'windowed_activity',
        observedAt: formatApiDisplayTime(observedAtIso, timeZone) || null,
        observedAtIso,
        definition: 'Closed paper-position activity for the selected timeframe.',
        windowLabel,
        bucketLabel,
        points,
        summary: {
          totalEquity: points.length
            ? points[points.length - 1].equity
            : startingEquity,
          totalPnl,
          totalProfit,
          totalLoss,
          totalTrades,
          brokers: {},
        },
        time: buildApiTimeContract(timeZone),
      },
      time: buildApiTimeContract(timeZone),
    };
  }

  private buildPortfolioSummaryAlias(
    futuresSummary: Record<string, unknown>,
    positions: Record<string, unknown>,
    activity: Record<string, unknown>,
    timeZone: string
  ) {
    const pnl =
      activity?.pnl && typeof activity.pnl === 'object' && !Array.isArray(activity.pnl)
        ? (activity.pnl as Record<string, unknown>)
        : {};
    const futuresEquity = this.toNumber(futuresSummary.futuresEquity) ?? 0;
    const totalPnl = this.toNumber(pnl.dailyPnL) ?? 0;
    const totalPositions = Number(positions.total || 0);

    return {
      equity: futuresEquity,
      dayPnL: totalPnl,
      netExposure:
        this.toNumber(futuresSummary.grossExposure) !== null
          ? this.formatCurrency(this.toNumber(futuresSummary.grossExposure) ?? 0)
          : '--',
      diversification:
        totalPositions > 0
          ? `${totalPositions} open paper position${totalPositions === 1 ? '' : 's'}`
          : 'No open paper positions',
      source: 'portfolio_overview_futures_legacy_alias',
      observedAt: futuresSummary.observedAt || null,
      observedAtIso: futuresSummary.observedAtIso || null,
      definition:
        'Paper summary alias synthesized from paper capital, open paper positions, and simulated realized activity.',
      portfolioValue: this.formatCurrency(futuresEquity),
      netPnl: this.formatSignedCurrency(totalPnl),
      holdings: totalPositions,
      largestWeight: '--',
      largestWeightLabel: '--',
      assetAllocation: 'Paper capital routes',
      strategyMix: 'Paper positions',
      riskPosture: 'Simulation-only posture',
      accountCurve: 'Use paper activity series',
      monthlyPace: this.formatSignedCurrency(this.toNumber(pnl.monthlyPnL) ?? 0),
      time: buildApiTimeContract(timeZone),
    };
  }

  private buildOverviewSectionMeta(
    source: string,
    sourceLabel: string,
    observedAtIso: string | null | undefined,
    freshnessModel:
      | 'snapshot_timestamp'
      | 'funds_snapshot_timestamp'
      | 'windowed_activity'
      | 'position_read_model_timestamp'
      | 'mixed_futures_state',
    definition: string,
    note: string
  ) {
    const freshness = this.buildFreshnessIndicator(
      observedAtIso || null,
      source
    );
    return {
      source,
      sourceLabel,
      availability: observedAtIso ? 'available' : 'missing',
      observedAt: observedAtIso || null,
      observedAtIso: observedAtIso || null,
      freshnessModel,
      freshness: {
        state: freshness.state,
        freshnessMs: freshness.freshnessMs,
        staleAfterMs: freshness.staleAfterMs,
        criticalAfterMs: freshness.criticalAfterMs,
      },
      definition,
      note,
    };
  }

  private buildFreshnessIndicator(
    observedAt: Date | string | null | undefined,
    source: string
  ): PositionsFreshnessIndicator {
    const observedAtIso = formatApiRawIso(observedAt) || null;
    const observedMs = observedAtIso ? new Date(observedAtIso).getTime() : null;
    const freshnessMs =
      observedMs !== null ? Math.max(0, Date.now() - observedMs) : null;
    const staleAfterMs = Math.max(60_000, env.paperOrders.pollIntervalMs * 2);
    const criticalAfterMs = Math.max(5 * 60_000, env.paperOrders.pollIntervalMs * 10);
    let state: PositionsFreshnessState = 'unknown';

    if (freshnessMs !== null) {
      if (freshnessMs > criticalAfterMs) {
        state = 'critical';
      } else if (freshnessMs > staleAfterMs) {
        state = 'stale';
      } else {
        state = 'fresh';
      }
    }

    return {
      state,
      observedAt: observedAtIso,
      freshnessMs,
      staleAfterMs,
      criticalAfterMs,
      isStale: state === 'stale' || state === 'critical',
      isCritical: state === 'critical',
      source,
    };
  }

  private sumClosedPositionWindow(
    positions: PaperPositionReadModelRow[],
    timeZone: string,
    days: number
  ): number {
    const endKey = this.toDateKeyInTimeZone(new Date(), timeZone);
    const startKey = this.shiftDateKey(endKey, -(days - 1));
    const { startUtc, endUtc } = this.getUtcWindowForLocalDateRange(
      startKey,
      endKey,
      timeZone
    );

    return positions.reduce((sum, item) => {
      const closedAt = this.toDate(item.closedAt);
      if (!closedAt || closedAt < startUtc || closedAt >= endUtc) {
        return sum;
      }
      return sum + (this.toNumber(item.realizedPnl) ?? 0);
    }, 0);
  }

  private deriveLifecycleStage(
    status: string,
    executionState: string | null
  ): 'open_order' | 'open_position' | 'closed_position' | 'cancelled_order' {
    const normalizedStatus = String(status || '').trim().toUpperCase();
    const normalizedExecutionState = String(executionState || '')
      .trim()
      .toLowerCase();

    if (normalizedStatus === 'CANCELLED') {
      return 'cancelled_order';
    }
    if (normalizedStatus === 'CLOSED' || normalizedExecutionState === 'closed') {
      return 'closed_position';
    }
    if (normalizedStatus === 'FILLED' || normalizedExecutionState === 'filled') {
      return 'open_position';
    }
    return 'open_order';
  }

  private readSimulation(payload: Record<string, unknown> | null): PaperSimulationState {
    const simulation = payload?.simulation;
    if (!simulation || typeof simulation !== 'object' || Array.isArray(simulation)) {
      return {};
    }
    return simulation as PaperSimulationState;
  }

  private normalizeSide(side: string | null | undefined): {
    key: 'long' | 'short';
    label: 'Long' | 'Short';
  } {
    const normalized = String(side || '').trim().toUpperCase();
    return normalized === 'SELL' || normalized === 'SHORT'
      ? { key: 'short', label: 'Short' }
      : { key: 'long', label: 'Long' };
  }

  private computeUnrealizedPnl(
    sideKey: 'long' | 'short',
    entryPrice: number | null,
    currentPrice: number | null,
    quantity: number
  ): number | null {
    if (!entryPrice || !currentPrice || !quantity) {
      return null;
    }
    if (sideKey === 'short') {
      return (entryPrice - currentPrice) * quantity;
    }
    return (currentPrice - entryPrice) * quantity;
  }

  private computeExposure(quantity: number, price: number | null): number | null {
    if (!quantity || !price) {
      return null;
    }
    return Math.abs(quantity * price);
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private readString(value: unknown): string {
    return String(value || '').trim();
  }

  private pickLatestDate(values: Array<Date | string | null | undefined>): Date | null {
    let latest: Date | null = null;
    values.forEach((value) => {
      const date = this.toDate(value);
      if (!date) {
        return;
      }
      if (!latest || date.getTime() > latest.getTime()) {
        latest = date;
      }
    });
    return latest;
  }

  private pickLatestTimestamp(values: Array<string | null | undefined>): string | null {
    let latest: string | null = null;
    values.forEach((value) => {
      const normalized = String(value || '').trim();
      if (!normalized) {
        return;
      }
      if (!latest || new Date(normalized).getTime() > new Date(latest).getTime()) {
        latest = normalized;
      }
    });
    return latest;
  }

  private humanizeEventType(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return 'Paper event';
    }
    return normalized
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private buildEventDescription(item: PaperPositionEventRow): string {
    const parts = [
      item.symbol ? `${item.symbol}` : '',
      item.price !== null ? `@ ${this.formatCurrency(item.price)}` : '',
      item.realizedPnlDelta !== null
        ? `PnL ${this.formatSignedCurrency(item.realizedPnlDelta)}`
        : '',
    ].filter(Boolean);
    return parts.join(' · ');
  }

  private formatCurrency(value: number): string {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: Math.abs(value) >= 100 ? 2 : 4,
      maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 4,
    });
  }

  private formatSignedCurrency(value: number): string {
    if (value > 0) {
      return `+${this.formatCurrency(value)}`;
    }
    if (value < 0) {
      return `-${this.formatCurrency(Math.abs(value))}`;
    }
    return this.formatCurrency(0);
  }

  private toDateKeyInTimeZone(value: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  private shiftDateKey(dateKey: string, dayOffset: number): string {
    const base = new Date(`${dateKey}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + dayOffset);
    return base.toISOString().slice(0, 10);
  }

  private getUtcWindowForLocalDate(dateKey: string, timezone: string): {
    startUtc: Date;
    endUtc: Date;
  } {
    const [year, month, day] = dateKey.split('-').map((value) => Number(value));
    const utcBase = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 0, 0, 0));
    const offsetMinutes = this.getTimeZoneOffsetMinutes(utcBase, timezone);
    const startUtc = new Date(utcBase.getTime() - offsetMinutes * 60 * 1000);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
    return { startUtc, endUtc };
  }

  private getUtcWindowForLocalDateRange(
    startDateKey: string,
    endDateKey: string,
    timezone: string
  ): { startUtc: Date; endUtc: Date } {
    const startWindow = this.getUtcWindowForLocalDate(startDateKey, timezone);
    const dayAfterEnd = this.shiftDateKey(endDateKey, 1);
    const endWindow = this.getUtcWindowForLocalDate(dayAfterEnd, timezone);
    return {
      startUtc: startWindow.startUtc,
      endUtc: endWindow.startUtc,
    };
  }

  private getTimeZoneOffsetMinutes(date: Date, timezone: string): number {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date);
      const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
      const year = Number(map.year);
      const month = Number(map.month);
      const day = Number(map.day);
      const hour = Number(map.hour);
      const minute = Number(map.minute);
      const second = Number(map.second);
      const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
      return (asUtc - date.getTime()) / (60 * 1000);
    } catch {
      return 0;
    }
  }

  private formatBucketInTimeZone(
    value: Date,
    timezone: string,
    bucketType: 'hour' | 'day'
  ): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value);
    const map = Object.fromEntries(parts.map((item) => [item.type, item.value]));
    const dateKey = `${map.year}-${map.month}-${map.day}`;
    return bucketType === 'hour' ? `${dateKey} ${map.hour}` : dateKey;
  }

  private generateBucketKeys(
    bucketType: 'hour' | 'day',
    startDateKey: string,
    endDateKey: string
  ): string[] {
    if (bucketType === 'hour') {
      return Array.from({ length: 24 }, (_, index) => {
        const hour = String(index).padStart(2, '0');
        return `${startDateKey} ${hour}`;
      });
    }

    const keys: string[] = [];
    let current = startDateKey;
    while (current <= endDateKey) {
      keys.push(current);
      current = this.shiftDateKey(current, 1);
    }
    return keys;
  }
}
