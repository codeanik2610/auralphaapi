import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Signal } from '../entities/Signal';
import { SignalAction } from '../entities/SignalAction';

export type SignalListView = 'inbox' | 'clustered' | 'muted';

export interface SignalListQuery {
  userId: string;
  limit: number;
  offset: number;
  status?: string;
  symbol?: string;
  source?: string;
  timeframe?: string;
  search?: string;
  view?: SignalListView;
}

export interface SignalSummaryQuery {
  userId: string;
  status?: string;
  symbol?: string;
  source?: string;
  timeframe?: string;
  search?: string;
  view?: SignalListView;
}

export interface SignalClusterRecord {
  signal: Signal;
  clusterCount: number;
  clusterTriggeredCount: number;
  clusterWatchingCount: number;
  clusterQueuedCount: number;
  clusterLatestSignalTime: Date | null;
  clusterStrongestConfidence: number;
}

export type SignalListRecord = Signal | SignalClusterRecord;

export interface SignalListResult {
  data: SignalListRecord[];
  total: number;
}

export interface LatestSignalBySymbol {
  signal: Signal;
  signalCount: number;
}

export interface CreateSignalActionPayload {
  signalId: string;
  actionType: string;
  target?: string;
  note?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export interface UpsertSignalPayload {
  userId: string;
  dedupeKey: string;
  symbol: string;
  source: string;
  confidence: number;
  direction?: string | null;
  timeframe?: string | null;
  status: string;
  market?: string | null;
  signalTime?: Date | string | number | null;
  entryPrice?: number | string | null;
  sourceRefType?: string | null;
  sourceRefId?: string | null;
  expiresAt?: Date | string | number | null;
  regime?: string | null;
  aiScore?: number | null;
  thesis?: string | null;
  route?: string | null;
  riskNote?: string | null;
  promotionState?: string | null;
  metadata?: Record<string, unknown> | null;
}

const normalizeDate = (value: Date | string | number): Date => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number') {
    return new Date(value > 1e12 ? value : value * 1000);
  }
  return new Date(value);
};

const normalizeNullableDate = (
  value: Date | string | number | null | undefined
): Date | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = normalizeDate(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
};

const normalizeDecimal = (value: number | string | null | undefined): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return String(numeric);
};

@Service()
export class SignalRepository {
  private get signalRepository(): Repository<Signal> {
    return coreDataSource.getRepository(Signal);
  }

  private get signalActionRepository(): Repository<SignalAction> {
    return coreDataSource.getRepository(SignalAction);
  }

  async listSignals(query: SignalListQuery): Promise<SignalListResult> {
    const view = query.view ?? 'inbox';

    if (view === 'clustered') {
      const builder = this.buildFilteredSignalsQuery(query);
      this.applyOrdering(builder, 'inbox');
      const signals = await builder.getMany();
      const clusters = this.buildSignalClusters(signals);
      return {
        data: clusters.slice(query.offset, query.offset + query.limit),
        total: clusters.length,
      };
    }

    const builder = this.buildFilteredSignalsQuery(query)
      .skip(query.offset)
      .take(query.limit);

    this.applyOrdering(builder, view);

    const [data, total] = await builder.getManyAndCount();

    return { data, total };
  }

  async getSignalById(userId: string, signalId: string): Promise<Signal | null> {
    return this.signalRepository.findOne({
      where: { id: signalId, userId },
      relations: {
        actions: true,
      },
      order: {
        actions: {
          createdAt: 'DESC',
        },
      },
    });
  }

  async getSignalSummary(
    userId: string,
    query: Omit<SignalSummaryQuery, 'userId'> = {}
  ): Promise<{
    liveSignals: number;
    triggered: number;
    watching: number;
    queued: number;
    muted: number;
    highConfidence: number;
    mutedOrQueued: number;
  }> {
    if ((query.view ?? 'inbox') === 'clustered') {
      const builder = this.buildFilteredSignalsQuery({ userId, ...query });
      this.applyOrdering(builder, 'inbox');
      const signals = await builder.getMany();
      const clusters = this.buildSignalClusters(signals);
      const muted = await this.buildFilteredSignalsQuery({
        userId,
        ...query,
        view: 'muted',
      }).getCount();
      const queued = clusters.filter((cluster) => cluster.clusterQueuedCount > 0).length;

      return {
        liveSignals: clusters.length,
        triggered: clusters.filter((cluster) => cluster.clusterTriggeredCount > 0).length,
        watching: clusters.filter((cluster) => cluster.clusterWatchingCount > 0).length,
        queued,
        muted,
        highConfidence: clusters.filter((cluster) => cluster.clusterStrongestConfidence >= 0.8).length,
        mutedOrQueued: queued + muted,
      };
    }

    const baseQuery = this.buildFilteredSignalsQuery({
      userId,
      ...query,
    });
    const mutedQuery = this.buildFilteredSignalsQuery({
      userId,
      ...query,
      view: 'muted',
    });

    const [liveSignals, triggered, watching, queued, muted, highConfidence] = await Promise.all([
      baseQuery.clone().getCount(),
      baseQuery
        .clone()
        .andWhere('signal.status = :triggeredStatus', { triggeredStatus: 'Triggered' })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('signal.status = :watchingStatus', { watchingStatus: 'Watching' })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('signal.status = :queuedStatus', { queuedStatus: 'Queued' })
        .getCount(),
      mutedQuery.getCount(),
      baseQuery
        .clone()
        .andWhere('signal.confidence >= :threshold', { threshold: 0.8 })
        .getCount(),
    ]);

    return {
      liveSignals,
      triggered,
      watching,
      queued,
      muted,
      highConfidence,
      mutedOrQueued: muted + queued,
    };
  }

  async getLatestSignalsBySymbols(
    userId: string,
    symbols: string[]
  ): Promise<Map<string, LatestSignalBySymbol>> {
    const normalizedSymbols = Array.from(
      new Set(
        (symbols || [])
          .map((symbol) => String(symbol || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    if (!normalizedSymbols.length) {
      return new Map();
    }

    const signals = await this.signalRepository
      .createQueryBuilder('signal')
      .where('signal.userId = :userId', { userId })
      .andWhere('signal.symbol IN (:...symbols)', { symbols: normalizedSymbols })
      .andWhere('signal.status != :mutedStatus', { mutedStatus: 'Muted' })
      .orderBy('signal.signalTime', 'DESC')
      .addOrderBy('signal.confidence', 'DESC')
      .addOrderBy('signal.createdAt', 'DESC')
      .getMany();

    const latestBySymbol = new Map<string, LatestSignalBySymbol>();

    signals.forEach((signal) => {
      const symbol = String(signal.symbol || '').trim().toUpperCase();
      if (!symbol) {
        return;
      }

      const existing = latestBySymbol.get(symbol);
      if (!existing) {
        latestBySymbol.set(symbol, {
          signal,
          signalCount: 1,
        });
        return;
      }

      existing.signalCount += 1;
    });

    return latestBySymbol;
  }

  async createSignalAction(payload: CreateSignalActionPayload): Promise<SignalAction> {
    const action = this.signalActionRepository.create({
      signalId: payload.signalId,
      actionType: payload.actionType,
      target: payload.target ?? null,
      note: payload.note ?? null,
      actor: payload.actor ?? null,
      metadata: payload.metadata ?? null,
    });

    return this.signalActionRepository.save(action);
  }

  async upsertSignals(
    payloads: UpsertSignalPayload[]
  ): Promise<{ inserted: number; updated: number; items: Signal[] }> {
    if (!payloads.length) {
      return { inserted: 0, updated: 0, items: [] };
    }

    let inserted = 0;
    let updated = 0;
    const items: Signal[] = [];

    for (const payload of payloads) {
      const dedupeKey = String(payload.dedupeKey || '').trim();
      const userId = String(payload.userId || '').trim();
      if (!dedupeKey || !userId) {
        continue;
      }

      const existing = await this.signalRepository.findOne({
        where: { dedupeKey },
      });

      if (existing) {
        if (existing.userId && existing.userId !== userId) {
          throw new Error(
            `Signal dedupe collision detected for ${dedupeKey} across users ${existing.userId} and ${userId}`
          );
        }

        existing.userId = existing.userId || userId;
        existing.symbol = payload.symbol.trim().toUpperCase();
        existing.source = payload.source.trim();
        existing.confidence = Number.isFinite(payload.confidence)
          ? Number(payload.confidence)
          : existing.confidence;
        existing.direction = payload.direction?.trim() || existing.direction || null;
        existing.timeframe = payload.timeframe?.trim() || existing.timeframe || null;
        existing.status = existing.status === 'Muted' ? existing.status : payload.status.trim();
        existing.market = payload.market?.trim() || existing.market || null;
        existing.signalTime =
          normalizeNullableDate(payload.signalTime) ?? existing.signalTime ?? null;
        existing.entryPrice =
          normalizeDecimal(payload.entryPrice) ?? existing.entryPrice ?? null;
        existing.sourceRefType =
          payload.sourceRefType?.trim() || existing.sourceRefType || null;
        existing.sourceRefId = payload.sourceRefId?.trim() || existing.sourceRefId || null;
        existing.expiresAt =
          normalizeNullableDate(payload.expiresAt) ?? existing.expiresAt ?? null;
        existing.regime = payload.regime?.trim() || existing.regime || null;
        existing.aiScore =
          payload.aiScore === undefined || payload.aiScore === null
            ? existing.aiScore ?? null
            : Math.max(0, Math.round(Number(payload.aiScore)));
        existing.thesis = payload.thesis ?? existing.thesis ?? null;
        existing.metadata = payload.metadata ?? existing.metadata ?? null;
        if (payload.route !== undefined) {
          existing.route = payload.route ?? null;
        }
        if (payload.riskNote !== undefined) {
          existing.riskNote = payload.riskNote ?? null;
        }
        if (payload.promotionState !== undefined) {
          existing.promotionState = payload.promotionState ?? null;
        }

        const saved = await this.signalRepository.save(existing);
        await this.demoteOlderTriggeredSignals(saved);
        items.push(saved);
        updated += 1;
        continue;
      }

      const entity = this.signalRepository.create({
        id: randomUUID(),
        userId,
        dedupeKey,
        symbol: payload.symbol.trim().toUpperCase(),
        source: payload.source.trim(),
        confidence: Number.isFinite(payload.confidence) ? Number(payload.confidence) : 0,
        direction: payload.direction?.trim() || null,
        timeframe: payload.timeframe?.trim() || null,
        status: payload.status.trim(),
        market: payload.market?.trim() || null,
        signalTime: normalizeNullableDate(payload.signalTime),
        entryPrice: normalizeDecimal(payload.entryPrice),
        sourceRefType: payload.sourceRefType?.trim() || null,
        sourceRefId: payload.sourceRefId?.trim() || null,
        expiresAt: normalizeNullableDate(payload.expiresAt),
        regime: payload.regime?.trim() || null,
        aiScore:
          payload.aiScore === undefined || payload.aiScore === null
            ? null
            : Math.max(0, Math.round(Number(payload.aiScore))),
        thesis: payload.thesis ?? null,
        route: payload.route ?? null,
        riskNote: payload.riskNote ?? null,
        promotionState: payload.promotionState ?? null,
        metadata: payload.metadata ?? null,
      });

      const saved = await this.signalRepository.save(entity);
      await this.demoteOlderTriggeredSignals(saved);
      items.push(saved);
      inserted += 1;
    }

    return { inserted, updated, items };
  }

  async updateSignal(
    userId: string,
    signalId: string,
    payload: Partial<Pick<Signal, 'status' | 'route' | 'promotionState' | 'riskNote'>>
  ): Promise<void> {
    await this.signalRepository.update({ id: signalId, userId }, payload);
  }


  private buildSignalClusters(signals: Signal[]): SignalClusterRecord[] {
    const clusters = new Map<string, SignalClusterRecord>();

    signals.forEach((signal) => {
      const key = [signal.symbol, signal.timeframe || '--', signal.source].join('|');
      const existing = clusters.get(key);
      const signalTime = signal.signalTime ?? signal.createdAt;
      const confidence = Number.isFinite(signal.confidence) ? Number(signal.confidence) : 0;

      if (!existing) {
        clusters.set(key, {
          signal,
          clusterCount: 1,
          clusterTriggeredCount: signal.status === 'Triggered' ? 1 : 0,
          clusterWatchingCount: signal.status === 'Watching' ? 1 : 0,
          clusterQueuedCount: signal.status === 'Queued' ? 1 : 0,
          clusterLatestSignalTime: signalTime,
          clusterStrongestConfidence: confidence,
        });
        return;
      }

      existing.clusterCount += 1;
      if (signal.status === 'Triggered') {
        existing.clusterTriggeredCount += 1;
      } else if (signal.status == 'Watching') {
        existing.clusterWatchingCount += 1;
      } else if (signal.status === 'Queued') {
        existing.clusterQueuedCount += 1;
      }

      const existingTime = existing.clusterLatestSignalTime?.getTime() ?? 0;
      const nextTime = signalTime?.getTime() ?? 0;
      const shouldReplaceHead =
        nextTime > existingTime ||
        (nextTime == existingTime && confidence > existing.clusterStrongestConfidence);

      if (shouldReplaceHead) {
        existing.signal = signal;
        existing.clusterLatestSignalTime = signalTime;
      }

      if (confidence > existing.clusterStrongestConfidence) {
        existing.clusterStrongestConfidence = confidence;
      }
    });

    return Array.from(clusters.values()).sort((left, right) => {
      const confidenceDelta = right.clusterStrongestConfidence - left.clusterStrongestConfidence;
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      const rightTime = right.clusterLatestSignalTime?.getTime() ?? 0;
      const leftTime = left.clusterLatestSignalTime?.getTime() ?? 0;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      if (right.clusterCount !== left.clusterCount) {
        return right.clusterCount - left.clusterCount;
      }

      return `${left.signal.symbol}|${left.signal.timeframe || ''}|${left.signal.source}`.localeCompare(
        `${right.signal.symbol}|${right.signal.timeframe || ''}|${right.signal.source}`
      );
    });
  }

  private buildFilteredSignalsQuery(
    query: SignalSummaryQuery
  ): SelectQueryBuilder<Signal> {
    const builder = this.signalRepository
      .createQueryBuilder('signal')
      .where('signal.userId = :userId', { userId: query.userId });

    this.applyFilters(builder, query);
    return builder;
  }

  private applyFilters(
    builder: SelectQueryBuilder<Signal>,
    query: SignalSummaryQuery
  ): void {
    const view = query.view ?? 'inbox';

    if (view === 'muted') {
      builder.andWhere('signal.status = :mutedStatus', { mutedStatus: 'Muted' });
    } else {
      builder.andWhere('signal.status != :mutedStatus', { mutedStatus: 'Muted' });
    }

    if (query.status) {
      builder.andWhere('signal.status = :status', { status: query.status });
    }

    if (query.symbol) {
      builder.andWhere('LOWER(signal.symbol) = LOWER(:symbol)', { symbol: query.symbol });
    }

    if (query.source) {
      builder.andWhere('LOWER(signal.source) = LOWER(:source)', { source: query.source });
    }

    if (query.timeframe) {
      builder.andWhere('LOWER(signal.timeframe) = LOWER(:timeframe)', {
        timeframe: query.timeframe,
      });
    }

    if (query.search) {
      builder.andWhere(
        '(signal.symbol LIKE :search OR signal.source LIKE :search OR signal.status LIKE :search OR signal.regime LIKE :search OR signal.thesis LIKE :search OR signal.sourceRefType LIKE :search OR signal.market LIKE :search)',
        {
          search: `%${query.search}%`,
        }
      );
    }
  }

  private applyOrdering(
    builder: SelectQueryBuilder<Signal>,
    view: SignalListView
  ): void {
    if (view === 'clustered') {
      builder
        .orderBy('signal.symbol', 'ASC')
        .addOrderBy('signal.timeframe', 'ASC')
        .addOrderBy('signal.source', 'ASC')
        .addOrderBy('signal.signalTime', 'DESC')
        .addOrderBy('signal.confidence', 'DESC')
        .addOrderBy('signal.createdAt', 'DESC');
      return;
    }

    if (view === 'muted') {
      builder
        .orderBy('signal.updatedAt', 'DESC')
        .addOrderBy('signal.signalTime', 'DESC')
        .addOrderBy('signal.createdAt', 'DESC');
      return;
    }

    builder
      .orderBy('signal.signalTime', 'DESC')
      .addOrderBy('signal.confidence', 'DESC')
      .addOrderBy('signal.createdAt', 'DESC');
  }

  private async demoteOlderTriggeredSignals(signal: Signal): Promise<void> {
    if (
      !signal.userId ||
      !signal.sourceRefType ||
      !signal.sourceRefId ||
      !signal.symbol ||
      !signal.timeframe ||
      !signal.direction ||
      !signal.signalTime
    ) {
      return;
    }

    await this.signalRepository
      .createQueryBuilder()
      .update(Signal)
      .set({ status: 'Watching' })
      .where('id != :id', { id: signal.id })
      .andWhere('user_id = :userId', { userId: signal.userId })
      .andWhere('sourceRefType = :sourceRefType', { sourceRefType: signal.sourceRefType })
      .andWhere('sourceRefId = :sourceRefId', { sourceRefId: signal.sourceRefId })
      .andWhere('symbol = :symbol', { symbol: signal.symbol })
      .andWhere('timeframe = :timeframe', { timeframe: signal.timeframe })
      .andWhere('direction = :direction', { direction: signal.direction })
      .andWhere('status = :status', { status: 'Triggered' })
      .andWhere('signalTime IS NOT NULL')
      .andWhere('signalTime < :signalTime', { signalTime: signal.signalTime })
      .execute();
  }
}
