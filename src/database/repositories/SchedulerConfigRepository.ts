import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { SchedulerConfig } from '../entities/SchedulerConfig';

@Service()
export class SchedulerConfigRepository {
  private get repository(): Repository<SchedulerConfig> {
    return coreDataSource.getRepository(SchedulerConfig);
  }

  async getByKey(key: string): Promise<SchedulerConfig | null> {
    return this.repository.findOne({ where: { key } });
  }

  async listAll(): Promise<Array<Pick<SchedulerConfig, 'key' | 'timezone'>>> {
    return this.repository.find({
      select: {
        key: true,
        timezone: true,
      },
    });
  }

  async createIfMissing(payload: Partial<SchedulerConfig>): Promise<SchedulerConfig> {
    const existing = await this.getByKey(String(payload.key || ''));
    if (existing) {
      return existing;
    }

    const created = this.repository.create(payload);
    return this.repository.save(created);
  }

  async updateByKey(key: string, payload: Partial<SchedulerConfig>): Promise<SchedulerConfig | null> {
    const existing = await this.getByKey(key);
    if (!existing) {
      return null;
    }

    const merged = this.repository.merge(existing, payload);
    return this.repository.save(merged);
  }

  async tryAcquireRunLock(key: string, lockUntil: Date): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(SchedulerConfig)
      .set({ runningLockUntil: lockUntil })
      .where('`key` = :key', { key })
      .andWhere('(running_lock_until IS NULL OR running_lock_until < NOW())')
      .execute();

    return Boolean(result.affected && result.affected > 0);
  }

  async releaseRunLock(key: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(SchedulerConfig)
      .set({ runningLockUntil: null })
      .where('`key` = :key', { key })
      .execute();
  }
}
