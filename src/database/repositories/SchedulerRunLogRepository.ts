import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { coreDataSource } from '../data-source';
import { SchedulerRunLog } from '../entities/SchedulerRunLog';

export interface SchedulerRunStaleQuery {
  olderThan: Date;
  limit?: number;
  schedulerKey?: string;
  actorUserId?: string | null;
  workerId?: string | null;
  statuses?: string[];
}

export interface SchedulerRunRepairPayload {
  status: string;
  reason: string;
  finishedAt?: Date;
  repairedAt?: Date;
  workerId?: string | null;
}

@Service()
export class SchedulerRunLogRepository {
  private get repository(): Repository<SchedulerRunLog> {
    return coreDataSource.getRepository(SchedulerRunLog);
  }

  async createRun(payload: Partial<SchedulerRunLog>): Promise<SchedulerRunLog> {
    const created = this.repository.create(payload);
    if (!created.lastProgressAt && created.status === 'Running') {
      created.lastProgressAt = created.startedAt ?? new Date();
    }
    return this.repository.save(created);
  }

  async findById(runId: string): Promise<SchedulerRunLog | null> {
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedRunId) {
      return null;
    }

    return this.repository.findOne({
      where: {
        id: normalizedRunId,
      },
    });
  }

  async updateRun(runId: string, payload: QueryDeepPartialEntity<SchedulerRunLog>): Promise<void> {
    await this.repository.update({ id: runId }, payload);
  }

  async assignRunOwnership(
    runId: string,
    ownership: {
      commandId?: string | null;
      workerId?: string | null;
      lastProgressAt?: Date | null;
    }
  ): Promise<void> {
    const updatePayload: QueryDeepPartialEntity<SchedulerRunLog> = {};

    if (ownership.commandId !== undefined) {
      updatePayload.commandId = ownership.commandId;
    }
    if (ownership.workerId !== undefined) {
      updatePayload.workerId = ownership.workerId;
    }
    if (ownership.lastProgressAt !== undefined) {
      updatePayload.lastProgressAt = ownership.lastProgressAt;
    }

    if (!Object.keys(updatePayload).length) {
      return;
    }

    await this.updateRun(runId, updatePayload);
  }

  async touchRunProgress(
    runId: string,
    lastProgressAt = new Date(),
    workerId?: string | null
  ): Promise<void> {
    const payload: QueryDeepPartialEntity<SchedulerRunLog> = {
      lastProgressAt,
    };

    if (workerId !== undefined) {
      payload.workerId = workerId;
    }

    await this.updateRun(runId, payload);
  }

  async findStaleRuns(query: SchedulerRunStaleQuery): Promise<SchedulerRunLog[]> {
    const statuses = Array.isArray(query.statuses) && query.statuses.length
      ? query.statuses
      : ['Running'];

    const builder = this.repository
      .createQueryBuilder('run')
      .where('run.status IN (:...statuses)', { statuses })
      .andWhere('(run.last_progress_at IS NULL OR run.last_progress_at < :olderThan)', {
        olderThan: query.olderThan,
      });

    if (query.schedulerKey) {
      builder.andWhere('run.scheduler_key = :schedulerKey', {
        schedulerKey: query.schedulerKey,
      });
    }

    const normalizedActorUserId = String(query.actorUserId || '').trim();
    if (normalizedActorUserId) {
      builder.andWhere('run.actor_user_id = :actorUserId', {
        actorUserId: normalizedActorUserId,
      });
    }

    if (query.workerId === null) {
      builder.andWhere('run.worker_id IS NULL');
    } else if (typeof query.workerId === 'string' && query.workerId.trim()) {
      builder.andWhere('run.worker_id = :workerId', {
        workerId: query.workerId.trim(),
      });
    }

    return builder
      .orderBy('run.last_progress_at', 'ASC')
      .addOrderBy('run.started_at', 'ASC')
      .take(query.limit ?? 100)
      .getMany();
  }

  async markRunRepaired(
    runId: string,
    payload: SchedulerRunRepairPayload
  ): Promise<SchedulerRunLog | null> {
    const existing = await this.findById(runId);
    if (!existing) {
      return null;
    }

    const repairedAt = payload.repairedAt ?? new Date();
    const finishedAt = payload.finishedAt ?? repairedAt;
    const durationMs = Math.max(0, finishedAt.getTime() - existing.startedAt.getTime());

    await this.repository.update(
      { id: runId },
      {
        status: payload.status,
        finishedAt,
        durationMs,
        errorMessage: payload.reason,
        repairedAt,
        repairReason: payload.reason,
        workerId: payload.workerId ?? null,
        lastProgressAt: finishedAt,
      }
    );

    return this.findById(runId);
  }

  async findLatestActiveByCommandId(commandId: string): Promise<SchedulerRunLog | null> {
    const normalizedCommandId = String(commandId || '').trim();
    if (!normalizedCommandId) {
      return null;
    }

    return this.repository.findOne({
      where: [
        {
          commandId: normalizedCommandId,
          status: 'Queued',
        },
        {
          commandId: normalizedCommandId,
          status: 'Running',
        },
      ],
      order: {
        startedAt: 'DESC',
      },
    });
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
        repairedAt: () => 'NOW()',
        repairReason: reason,
        lastProgressAt: () => 'NOW()',
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
