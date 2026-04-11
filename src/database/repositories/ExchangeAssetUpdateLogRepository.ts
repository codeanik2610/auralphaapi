import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { coreDataSource } from '../data-source';
import { ExchangeAssetUpdateLog } from '../entities/ExchangeAssetUpdateLog';

@Service()
export class ExchangeAssetUpdateLogRepository {
  private get repository(): Repository<ExchangeAssetUpdateLog> {
    return coreDataSource.getRepository(ExchangeAssetUpdateLog);
  }

  async createMany(payload: QueryDeepPartialEntity<ExchangeAssetUpdateLog>[]): Promise<void> {
    if (!payload.length) {
      return;
    }

    await this.repository.insert(payload);
  }

  async listByRunLogId(
    runLogId: string,
    limit: number,
    offset: number,
    filters?: {
      actionType?: string;
      source?: string;
      symbol?: string;
      sortBy?: 'createdAt' | 'actionType' | 'source' | 'symbol';
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<{ items: ExchangeAssetUpdateLog[]; total: number }> {
    const sortByMap: Record<string, string> = {
      createdAt: 'log.createdAt',
      actionType: 'log.actionType',
      source: 'log.source',
      symbol: 'log.symbol',
    };
    const sortByColumn = sortByMap[filters?.sortBy || 'createdAt'] || 'log.createdAt';
    const sortOrder = (filters?.sortOrder || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const builder = this.repository
      .createQueryBuilder('log')
      .where('log.runLogId = :runLogId', { runLogId })
      .orderBy(sortByColumn, sortOrder as 'ASC' | 'DESC')
      .take(limit)
      .skip(offset);

    if (filters?.actionType) {
      builder.andWhere('LOWER(log.actionType) = LOWER(:actionType)', {
        actionType: filters.actionType,
      });
    }

    if (filters?.source) {
      builder.andWhere('LOWER(log.source) = LOWER(:source)', {
        source: filters.source,
      });
    }

    if (filters?.symbol) {
      builder.andWhere('LOWER(log.symbol) LIKE LOWER(:symbol)', {
        symbol: `%${filters.symbol}%`,
      });
    }

    const [items, total] = await builder.getManyAndCount();

    return { items, total };
  }

  async deleteOlderThanDays(retentionDays: number): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(ExchangeAssetUpdateLog)
      .where('created_at < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', { retentionDays })
      .execute();
    return result.affected || 0;
  }

  async deleteOlderThanDaysBySchedulerKey(
    schedulerKey: string,
    retentionDays: number
  ): Promise<number> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    if (!normalizedSchedulerKey) {
      return 0;
    }

    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(ExchangeAssetUpdateLog)
      .where(
        `run_log_id IN (
          SELECT id
          FROM scheduler_run_logs
          WHERE scheduler_key = :schedulerKey
        )`,
        {
          schedulerKey: normalizedSchedulerKey,
        }
      )
      .andWhere('created_at < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
        retentionDays,
      })
      .execute();
    return result.affected || 0;
  }

  async deleteOlderThanDaysBySchedulerKeyAndActor(
    schedulerKey: string,
    actorUserId: string,
    retentionDays: number
  ): Promise<number> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedSchedulerKey || !normalizedActorUserId) {
      return 0;
    }

    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(ExchangeAssetUpdateLog)
      .where(
        `run_log_id IN (
          SELECT id
          FROM scheduler_run_logs
          WHERE scheduler_key = :schedulerKey
            AND actor_user_id = :actorUserId
        )`,
        {
          schedulerKey: normalizedSchedulerKey,
          actorUserId: normalizedActorUserId,
        }
      )
      .andWhere('created_at < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
        retentionDays,
      })
      .execute();
    return result.affected || 0;
  }

  async countOlderThanDays(retentionDays: number): Promise<number> {
    return this.repository
      .createQueryBuilder('log')
      .where('log.createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', { retentionDays })
      .getCount();
  }

  async countOlderThanDaysBySchedulerKey(
    schedulerKey: string,
    retentionDays: number
  ): Promise<number> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    if (!normalizedSchedulerKey) {
      return 0;
    }

    return this.repository
      .createQueryBuilder('log')
      .where(
        `log.runLogId IN (
          SELECT run.id
          FROM scheduler_run_logs run
          WHERE run.scheduler_key = :schedulerKey
        )`,
        {
          schedulerKey: normalizedSchedulerKey,
        }
      )
      .andWhere('log.createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
        retentionDays,
      })
      .getCount();
  }

  async countOlderThanDaysBySchedulerKeyAndActor(
    schedulerKey: string,
    actorUserId: string,
    retentionDays: number
  ): Promise<number> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedSchedulerKey || !normalizedActorUserId) {
      return 0;
    }

    return this.repository
      .createQueryBuilder('log')
      .where(
        `log.runLogId IN (
          SELECT run.id
          FROM scheduler_run_logs run
          WHERE run.scheduler_key = :schedulerKey
            AND run.actor_user_id = :actorUserId
        )`,
        {
          schedulerKey: normalizedSchedulerKey,
          actorUserId: normalizedActorUserId,
        }
      )
      .andWhere('log.createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
        retentionDays,
      })
      .getCount();
  }

  async getLatestBySymbols(
    source: string,
    symbols: string[]
  ): Promise<Map<string, Date>> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))
    );
    if (!normalizedSymbols.length) {
      return new Map<string, Date>();
    }

    const rows = await this.repository
      .createQueryBuilder('log')
      .select('UPPER(log.symbol)', 'symbol')
      .addSelect('MAX(log.createdAt)', 'lastSyncedAt')
      .where('LOWER(log.source) = LOWER(:source)', { source })
      .andWhere('log.symbol IS NOT NULL')
      .andWhere('UPPER(log.symbol) IN (:...symbols)', { symbols: normalizedSymbols })
      .groupBy('UPPER(log.symbol)')
      .getRawMany<{ symbol?: string; lastSyncedAt?: string | Date }>();

    const result = new Map<string, Date>();
    rows.forEach((row) => {
      const symbol = String(row.symbol || '').trim().toUpperCase();
      if (!symbol) {
        return;
      }
      const parsed = new Date(String(row.lastSyncedAt || ''));
      if (!Number.isNaN(parsed.getTime())) {
        result.set(symbol, parsed);
      }
    });
    return result;
  }
}
