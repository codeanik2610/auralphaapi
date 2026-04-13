import { Service } from 'typedi';
import { In } from 'typeorm';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { SchedulerCommand } from '../entities/SchedulerCommand';

export interface SchedulerCommandStaleQuery {
  olderThan: Date;
  limit?: number;
  schedulerKey?: string;
  actorUserId?: string | null;
  workerId?: string | null;
  statuses?: string[];
}

export interface SchedulerCommandRepairPayload {
  status: string;
  reason: string;
  processedAt?: Date;
  repairedAt?: Date;
  workerId?: string | null;
}

@Service()
export class SchedulerCommandRepository {
  private get repository(): Repository<SchedulerCommand> {
    return coreDataSource.getRepository(SchedulerCommand);
  }

  async createCommand(payload: Partial<SchedulerCommand>): Promise<SchedulerCommand> {
    const created = this.repository.create(payload);
    return this.repository.save(created);
  }

  async findById(commandId: string): Promise<SchedulerCommand | null> {
    const normalizedCommandId = String(commandId || '').trim();
    if (!normalizedCommandId) {
      return null;
    }

    return this.repository.findOne({
      where: {
        id: normalizedCommandId,
      },
    });
  }

  async markCommandClaimed(
    commandId: string,
    workerId: string,
    claimedAt = new Date()
  ): Promise<boolean> {
    const result = await this.repository.update(
      { id: commandId },
      {
        workerId,
        claimedAt,
      }
    );
    return Number(result.affected || 0) === 1;
  }

  async findStaleCommands(query: SchedulerCommandStaleQuery): Promise<SchedulerCommand[]> {
    const statuses = Array.isArray(query.statuses) && query.statuses.length
      ? query.statuses
      : ['Processing'];

    const builder = this.repository
      .createQueryBuilder('command')
      .where('command.status IN (:...statuses)', { statuses })
      .andWhere('(command.claimed_at IS NULL OR command.claimed_at < :olderThan)', {
        olderThan: query.olderThan,
      });

    if (query.schedulerKey) {
      builder.andWhere('command.scheduler_key = :schedulerKey', {
        schedulerKey: query.schedulerKey,
      });
    }

    const normalizedActorUserId = String(query.actorUserId || '').trim();
    if (normalizedActorUserId) {
      builder.andWhere('command.actor_user_id = :actorUserId', {
        actorUserId: normalizedActorUserId,
      });
    }

    if (query.workerId === null) {
      builder.andWhere('command.worker_id IS NULL');
    } else if (typeof query.workerId === 'string' && query.workerId.trim()) {
      builder.andWhere('command.worker_id = :workerId', {
        workerId: query.workerId.trim(),
      });
    }

    return builder
      .orderBy('command.claimed_at', 'ASC')
      .addOrderBy('command.created_at', 'ASC')
      .take(query.limit ?? 100)
      .getMany();
  }

  async markCommandRepaired(
    commandId: string,
    payload: SchedulerCommandRepairPayload
  ): Promise<SchedulerCommand | null> {
    const repairedAt = payload.repairedAt ?? new Date();
    const processedAt = payload.processedAt ?? repairedAt;

    await this.repository.update(
      { id: commandId },
      {
        status: payload.status,
        processedAt,
        errorMessage: payload.reason,
        repairedAt,
        repairReason: payload.reason,
        workerId: payload.workerId ?? null,
      }
    );

    return this.repository.findOne({
      where: { id: commandId },
    });
  }

  async findLatestBySchedulerKeyAndTypeInStatuses(
    schedulerKey: string,
    commandType: string,
    statuses: string[]
  ): Promise<SchedulerCommand | null> {
    if (!statuses.length) {
      return null;
    }
    return this.repository.findOne({
      where: {
        schedulerKey,
        commandType,
        status: In(statuses),
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findLatestBySchedulerKeyAndTypeAndActorInStatuses(
    schedulerKey: string,
    commandType: string,
    actorUserId: string,
    statuses: string[]
  ): Promise<SchedulerCommand | null> {
    if (!statuses.length) {
      return null;
    }
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      return null;
    }

    return this.repository
      .createQueryBuilder('command')
      .where('command.scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('command.command_type = :commandType', { commandType })
      .andWhere('command.status IN (:...statuses)', { statuses })
      .andWhere('command.actor_user_id = :actorUserId', { actorUserId: normalizedActorUserId })
      .orderBy('command.created_at', 'DESC')
      .getOne();
  }

  async cancelPendingBySchedulerKeyAndTypeAndActor(
    schedulerKey: string,
    commandType: string,
    actorUserId: string,
    reason: string
  ): Promise<number> {
    const normalizedActorUserId = String(actorUserId || '').trim();
    if (!normalizedActorUserId) {
      return 0;
    }

    const result = await this.repository
      .createQueryBuilder()
      .update(SchedulerCommand)
      .set({
        status: 'Cancelled',
        processedAt: () => 'NOW()',
        errorMessage: reason,
        repairedAt: () => 'NOW()',
        repairReason: reason,
      })
      .where('scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('command_type = :commandType', { commandType })
      .andWhere('actor_user_id = :actorUserId', { actorUserId: normalizedActorUserId })
      .andWhere('status = :status', { status: 'Pending' })
      .execute();
    return result.affected || 0;
  }

  async cancelPendingBySchedulerKeyAndType(
    schedulerKey: string,
    commandType: string,
    reason: string
  ): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(SchedulerCommand)
      .set({
        status: 'Cancelled',
        processedAt: () => 'NOW()',
        errorMessage: reason,
        repairedAt: () => 'NOW()',
        repairReason: reason,
      })
      .where('scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('command_type = :commandType', { commandType })
      .andWhere('status = :status', { status: 'Pending' })
      .execute();
    return result.affected || 0;
  }

  async cancelPendingBySchedulerKey(
    schedulerKey: string,
    reason: string
  ): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(SchedulerCommand)
      .set({
        status: 'Cancelled',
        processedAt: () => 'NOW()',
        errorMessage: reason,
        repairedAt: () => 'NOW()',
        repairReason: reason,
      })
      .where('scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('status = :status', { status: 'Pending' })
      .execute();
    return result.affected || 0;
  }

  async cancelPendingBySchedulerKeyAndActor(
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
      .update(SchedulerCommand)
      .set({
        status: 'Cancelled',
        processedAt: () => 'NOW()',
        errorMessage: reason,
        repairedAt: () => 'NOW()',
        repairReason: reason,
      })
      .where('scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('actor_user_id = :actorUserId', { actorUserId: normalizedActorUserId })
      .andWhere('status = :status', { status: 'Pending' })
      .execute();
    return result.affected || 0;
  }
}
