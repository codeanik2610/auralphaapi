import { Service } from 'typedi';
import { In } from 'typeorm';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { SchedulerCommand } from '../entities/SchedulerCommand';

@Service()
export class SchedulerCommandRepository {
  private get repository(): Repository<SchedulerCommand> {
    return coreDataSource.getRepository(SchedulerCommand);
  }

  async createCommand(payload: Partial<SchedulerCommand>): Promise<SchedulerCommand> {
    const created = this.repository.create(payload);
    return this.repository.save(created);
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
      })
      .where('scheduler_key = :schedulerKey', { schedulerKey })
      .andWhere('actor_user_id = :actorUserId', { actorUserId: normalizedActorUserId })
      .andWhere('status = :status', { status: 'Pending' })
      .execute();
    return result.affected || 0;
  }
}
