import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { SchedulerUserConfig } from '../entities/SchedulerUserConfig';

@Service()
export class SchedulerUserConfigRepository {
  private get repository(): Repository<SchedulerUserConfig> {
    return coreDataSource.getRepository(SchedulerUserConfig);
  }

  async getBySchedulerKeyAndUserId(
    schedulerKey: string,
    userId: string
  ): Promise<SchedulerUserConfig | null> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedSchedulerKey || !normalizedUserId) {
      return null;
    }

    return this.repository.findOne({
      where: {
        schedulerKey: normalizedSchedulerKey,
        userId: normalizedUserId,
      },
    });
  }

  async listEnabledBySchedulerKey(schedulerKey: string): Promise<SchedulerUserConfig[]> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    if (!normalizedSchedulerKey) {
      return [];
    }

    return this.repository.find({
      where: {
        schedulerKey: normalizedSchedulerKey,
        enabled: true,
      },
      order: {
        updatedAt: 'DESC',
      },
    });
  }

  async listLockedBefore(olderThan: Date): Promise<SchedulerUserConfig[]> {
    return this.repository
      .createQueryBuilder('config')
      .where('config.running_lock_until IS NOT NULL')
      .andWhere('config.running_lock_until < :olderThan', { olderThan })
      .orderBy('config.running_lock_until', 'ASC')
      .getMany();
  }

  async createIfMissing(payload: Partial<SchedulerUserConfig>): Promise<SchedulerUserConfig> {
    const schedulerKey = String(payload.schedulerKey || '').trim();
    const userId = String(payload.userId || '').trim();
    const existing = await this.getBySchedulerKeyAndUserId(schedulerKey, userId);
    if (existing) {
      return existing;
    }

    const created = this.repository.create({
      ...payload,
      schedulerKey,
      userId,
    });
    return this.repository.save(created);
  }

  async updateBySchedulerKeyAndUserId(
    schedulerKey: string,
    userId: string,
    payload: Partial<SchedulerUserConfig>
  ): Promise<SchedulerUserConfig | null> {
    const existing = await this.getBySchedulerKeyAndUserId(schedulerKey, userId);
    if (!existing) {
      return null;
    }

    const merged = this.repository.merge(existing, payload);
    return this.repository.save(merged);
  }

  async tryAcquireRunLock(
    schedulerKey: string,
    userId: string,
    lockUntil: Date
  ): Promise<boolean> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedSchedulerKey || !normalizedUserId) {
      return false;
    }

    const result = await this.repository
      .createQueryBuilder()
      .update(SchedulerUserConfig)
      .set({ runningLockUntil: lockUntil })
      .where('scheduler_key = :schedulerKey', { schedulerKey: normalizedSchedulerKey })
      .andWhere('user_id = :userId', { userId: normalizedUserId })
      .andWhere('(running_lock_until IS NULL OR running_lock_until < NOW())')
      .execute();

    return Boolean(result.affected && result.affected > 0);
  }

  async releaseRunLock(schedulerKey: string, userId: string): Promise<void> {
    const normalizedSchedulerKey = String(schedulerKey || '').trim();
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedSchedulerKey || !normalizedUserId) {
      return;
    }

    await this.repository
      .createQueryBuilder()
      .update(SchedulerUserConfig)
      .set({ runningLockUntil: null })
      .where('scheduler_key = :schedulerKey', { schedulerKey: normalizedSchedulerKey })
      .andWhere('user_id = :userId', { userId: normalizedUserId })
      .execute();
  }
}
