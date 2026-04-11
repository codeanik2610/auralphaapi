import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { In, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { AutomationCursor } from '../entities/AutomationCursor';
import { Automation } from '../entities/Automation';

export interface AutomationCursorUpsertPayload {
  automationId: string;
  userId: string;
  symbol: string;
  timeframe: string;
  lastEvaluatedSignalTime?: Date | null;
  lastTriggeredSignalTime?: Date | null;
  lastRunId?: string | null;
  lastStatus?: string | null;
  meta?: Record<string, unknown> | null;
}

@Service()
export class AutomationCursorRepository {
  private get repository(): Repository<AutomationCursor> {
    return coreDataSource.getRepository(AutomationCursor);
  }

  async listByAutomationAndScope(
    automationId: string,
    userId: string,
    timeframe: string,
    symbols: string[]
  ): Promise<AutomationCursor[]> {
    const normalizedSymbols = Array.from(
      new Set(
        symbols
          .map((value) => String(value || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    if (!normalizedSymbols.length) {
      return [];
    }

    return this.repository.find({
      where: {
        automationId,
        userId,
        timeframe,
        symbol: In(normalizedSymbols),
      },
    });
  }

  async upsertCursor(payload: AutomationCursorUpsertPayload): Promise<AutomationCursor> {
    const symbol = String(payload.symbol || '').trim().toUpperCase();
    const timeframe = String(payload.timeframe || '').trim();

    let cursor = await this.repository.findOne({
      where: {
        automationId: payload.automationId,
        userId: payload.userId,
        symbol,
        timeframe,
      },
    });

    if (!cursor) {
      cursor = this.repository.create({
        id: randomUUID(),
        automationId: payload.automationId,
        userId: payload.userId,
        symbol,
        timeframe,
      });
    }

    cursor.lastEvaluatedSignalTime =
      payload.lastEvaluatedSignalTime === undefined
        ? cursor.lastEvaluatedSignalTime ?? null
        : payload.lastEvaluatedSignalTime;
    cursor.lastTriggeredSignalTime =
      payload.lastTriggeredSignalTime === undefined
        ? cursor.lastTriggeredSignalTime ?? null
        : payload.lastTriggeredSignalTime;
    cursor.lastRunId =
      payload.lastRunId === undefined ? cursor.lastRunId ?? null : payload.lastRunId;
    cursor.lastStatus =
      payload.lastStatus === undefined ? cursor.lastStatus ?? null : payload.lastStatus;
    cursor.meta = payload.meta === undefined ? cursor.meta ?? null : payload.meta;

    return this.repository.save(cursor);
  }

  async getUserCursorDiagnostics(
    userId: string,
    staleBefore: Date
  ): Promise<{
    totalCursorCount: number;
    staleCursorCount: number;
    lastCursorAt: string | null;
    lastTriggeredSignalAt: string | null;
  }> {
    return this.readCursorDiagnostics(userId, staleBefore);
  }

  async getOperationalCursorDiagnostics(staleBefore: Date): Promise<{
    totalCursorCount: number;
    staleCursorCount: number;
    lastCursorAt: string | null;
    lastTriggeredSignalAt: string | null;
  }> {
    return this.readCursorDiagnostics(null, staleBefore);
  }

  private async readCursorDiagnostics(
    userId: string | null,
    staleBefore: Date
  ): Promise<{
    totalCursorCount: number;
    staleCursorCount: number;
    lastCursorAt: string | null;
    lastTriggeredSignalAt: string | null;
  }> {
    const builder = this.repository
      .createQueryBuilder('cursor')
      .innerJoin(Automation, 'automation', 'automation.id = cursor.automationId')
      .select('COUNT(*)', 'totalCursorCount')
      .addSelect(
        'SUM(CASE WHEN cursor.updated_at < :staleBefore THEN 1 ELSE 0 END)',
        'staleCursorCount'
      )
      .addSelect('MAX(cursor.updated_at)', 'lastCursorAt')
      .addSelect('MAX(cursor.last_triggered_signal_time)', 'lastTriggeredSignalAt')
      .where('automation.status = :status', { status: 'Running' })
      .andWhere(
        '(automation.automationType = :canonicalType OR automation.automationType = :legacyType)',
        {
          canonicalType: 'trade-suggestion',
          legacyType: 'strategy',
        }
      )
      .setParameter('staleBefore', staleBefore);

    if (userId) {
      builder.andWhere('cursor.userId = :userId', { userId });
    }

    const raw = await builder
      .getRawOne<{
        totalCursorCount?: string | number | null;
        staleCursorCount?: string | number | null;
        lastCursorAt?: string | null;
        lastTriggeredSignalAt?: string | null;
      }>();

    return {
      totalCursorCount: Number(raw?.totalCursorCount ?? 0),
      staleCursorCount: Number(raw?.staleCursorCount ?? 0),
      lastCursorAt: raw?.lastCursorAt ?? null,
      lastTriggeredSignalAt: raw?.lastTriggeredSignalAt ?? null,
    };
  }
}
