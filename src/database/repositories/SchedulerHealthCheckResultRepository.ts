import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { coreDataSource } from '../data-source';
import { SchedulerHealthCheckResult } from '../entities/SchedulerHealthCheckResult';

@Service()
export class SchedulerHealthCheckResultRepository {
  private get repository(): Repository<SchedulerHealthCheckResult> {
    return coreDataSource.getRepository(SchedulerHealthCheckResult);
  }

  async hasResultsForRunLogId(runLogId: string): Promise<boolean> {
    const normalizedRunLogId = String(runLogId || '').trim();
    if (!normalizedRunLogId) {
      return false;
    }

    const count = await this.repository
      .createQueryBuilder('result')
      .where('result.runLogId = :runLogId', { runLogId: normalizedRunLogId })
      .limit(1)
      .getCount();

    return count > 0;
  }

  async createMany(
    payload: QueryDeepPartialEntity<SchedulerHealthCheckResult>[]
  ): Promise<void> {
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
      status?: string;
      checkId?: string;
      sortBy?: 'createdAt' | 'status' | 'checkId';
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<{ items: SchedulerHealthCheckResult[]; total: number }> {
    const sortByMap: Record<string, string> = {
      createdAt: 'result.createdAt',
      status: 'result.status',
      checkId: 'result.checkId',
    };
    const sortByColumn = sortByMap[filters?.sortBy || 'createdAt'] || 'result.createdAt';
    const sortOrder = (filters?.sortOrder || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const builder = this.repository
      .createQueryBuilder('result')
      .where('result.runLogId = :runLogId', { runLogId })
      .orderBy(sortByColumn, sortOrder as 'ASC' | 'DESC')
      .take(limit)
      .skip(offset);

    if (filters?.status) {
      builder.andWhere('LOWER(result.status) = LOWER(:status)', {
        status: filters.status,
      });
    }

    if (filters?.checkId) {
      builder.andWhere('LOWER(result.checkId) LIKE LOWER(:checkId)', {
        checkId: `%${filters.checkId}%`,
      });
    }

    const [items, total] = await builder.getManyAndCount();

    return { items, total };
  }

  async deleteOlderThanDays(retentionDays: number): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(SchedulerHealthCheckResult)
      .where('created_at < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', { retentionDays })
      .execute();
    return result.affected || 0;
  }

  async countOlderThanDays(retentionDays: number): Promise<number> {
    return this.repository
      .createQueryBuilder('result')
      .where('result.createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', { retentionDays })
      .getCount();
  }
}
