import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { User } from '../entities/User';

@Service()
export class UserRepository {
  private get repository(): Repository<User> {
    return coreDataSource.getRepository(User);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    const normalizedIds = Array.from(
      new Set(
        ids
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );

    if (!normalizedIds.length) {
      return [];
    }

    return this.repository
      .createQueryBuilder('user')
      .where('user.id IN (:...ids)', { ids: normalizedIds })
      .getMany();
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.repository.update({ id: userId }, { lastLoginAt: new Date() });
  }
}
