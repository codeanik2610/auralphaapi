import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { coreDataSource } from '../data-source';
import { SchedulerRunLog } from '../entities/SchedulerRunLog';

@Service()
export class SchedulerRunLogRepository {
  private get repository(): Repository<SchedulerRunLog> {
    return coreDataSource.getRepository(SchedulerRunLog);
  }

  async createRun(payload: Partial<SchedulerRunLog>): Promise<SchedulerRunLog> {
    const created = this.repository.create(payload);
    return this.repository.save(created);
  }

  async updateRun(runId: string, payload: QueryDeepPartialEntity<SchedulerRunLog>): Promise<void> {
    await this.repository.update({ id: runId }, payload);
  }

  async listRunsBySchedulerKey(
    schedulerKey: string,
    limit: number,
    offset: number
  ): Promise<{ items: SchedulerRunLog[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { schedulerKey },
      order: { startedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async listRunsBySchedulerKeyAndActor(
    schedulerKey: string,
    actorUserId: string,
    limit: number,
    offset: number
  ): Promise<{ items: SchedulerRunLog[]; total: number }> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      return { items: [], total: 0 };
    }

    const [items, total] = await this.repository.findAndCount({
      where: {
        schedulerKey,
        actorUserId: normalizedActorUserId,
      },
      order: { startedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async deleteOlderThanDays(schedulerKey: string, retentionDays: number): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(SchedulerRunLog)
      .where('scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('created_at < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', { retentionDays })
      .execute();
    return result.affected || 0;
  }

  async deleteOlderThanDaysBySchedulerKeyAndActor(
    schedulerKey: string,
    actorUserId: string,
    retentionDays: number
  ): Promise<number> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      return 0;
    }

    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(SchedulerRunLog)
      .where('scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('actor_user_id = :actorUserId', { actorUserId: normalizedActorUserId })
      .andWhere('created_at < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', { retentionDays })
      .execute();
    return result.affected || 0;
  }

  async countOlderThanDays(schedulerKey: string, retentionDays: number): Promise<number> {
    return this.repository
      .createQueryBuilder('run')
      .where('run.schedulerKey = :schedulerKey', { schedulerKey })
      .andWhere('run.createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', { retentionDays })
      .getCount();
  }

  async countOlderThanDaysBySchedulerKeyAndActor(
    schedulerKey: string,
    actorUserId: string,
    retentionDays: number
  ): Promise<number> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      return 0;
    }

    return this.repository
      .createQueryBuilder('run')
      .where('run.schedulerKey = :schedulerKey', { schedulerKey })
      .andWhere('run.actorUserId = :actorUserId', { actorUserId: normalizedActorUserId })
      .andWhere('run.createdAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', { retentionDays })
      .getCount();
  }

  async hasRunningRun(schedulerKey: string): Promise<boolean> {
    const count = await this.repository.count({
      where: {
        schedulerKey,
        status: 'Running',
      },
    });
    return count > 0;
  }

  async hasRunningRunBySchedulerKeyAndActor(
    schedulerKey: string,
    actorUserId: string
  ): Promise<boolean> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      return false;
    }

    const count = await this.repository
      .createQueryBuilder('run')
      .where('run.scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('run.status = :status', { status: 'Running' })
      .andWhere('run.actor_user_id = :actorUserId', { actorUserId: normalizedActorUserId })
      .getCount();

    return count > 0;
  }

  async findByIdAndSchedulerKey(
    runId: string,
    schedulerKey: string
  ): Promise<SchedulerRunLog | null> {
    return this.repository.findOne({
      where: {
        id: runId,
        schedulerKey,
      },
    });
  }

  async findByIdAndSchedulerKeyAndActor(
    runId: string,
    schedulerKey: string,
    actorUserId: string
  ): Promise<SchedulerRunLog | null> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      return null;
    }

    return this.repository.findOne({
      where: {
        id: runId,
        schedulerKey,
        actorUserId: normalizedActorUserId,
      },
    });
  }

  async cancelQueuedRunsBySchedulerKeyAndActor(
    schedulerKey: string,
    actorUserId: string,
    reason: string
  ): Promise<number> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      return 0;
    }

    const result = await this.repository
      .createQueryBuilder()
      .update(SchedulerRunLog)
      .set({
        status: 'Cancelled',
        finishedAt: () => 'NOW()',
        durationMs: 0,
        errorMessage: reason,
      })
      .where('scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('actor_user_id = :actorUserId', { actorUserId: normalizedActorUserId })
      .andWhere('status = :status', { status: 'Queued' })
      .execute();

    return result.affected || 0;
  }

  async findLatestBySchedulerKeyAndStatuses(
    schedulerKey: string,
    statuses: string[]
  ): Promise<SchedulerRunLog | null> {
    if (!Array.isArray(statuses) || statuses.length === 0) {
      return null;
    }
    return this.repository
      .createQueryBuilder('run')
      .where('run.schedulerKey = :schedulerKey', { schedulerKey })
      .andWhere('run.status IN (:...statuses)', { statuses })
      .orderBy('run.startedAt', 'DESC')
      .addOrderBy('run.createdAt', 'DESC')
      .getOne();
  }
}
