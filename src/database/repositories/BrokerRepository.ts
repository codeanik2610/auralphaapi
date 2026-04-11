import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Broker } from '../entities/Broker';

type SaveBrokerDefinitionOptions = {
  expectedUpdatedAt?: string | null;
};

@Service()
export class BrokerRepository {
  private get repository(): Repository<Broker> {
    return coreDataSource.getRepository(Broker);
  }

  async getBrokerByKey(brokerKey: string): Promise<Broker | null> {
    return this.repository
      .createQueryBuilder('broker')
      .where('LOWER(broker.brokerKey) = LOWER(:brokerKey)', { brokerKey })
      .getOne();
  }

  async getBrokerByName(name: string): Promise<Broker | null> {
    return this.repository
      .createQueryBuilder('broker')
      .where('LOWER(broker.name) = LOWER(:name)', { name })
      .getOne();
  }

  async getActiveBrokerByKey(brokerKey: string): Promise<Broker | null> {
    return this.repository
      .createQueryBuilder('broker')
      .where('LOWER(broker.brokerKey) = LOWER(:brokerKey)', { brokerKey })
      .andWhere('LOWER(broker.status) = :status', { status: 'active' })
      .getOne();
  }

  async listActiveBrokers(): Promise<Broker[]> {
    return this.repository
      .createQueryBuilder('broker')
      .where('LOWER(broker.status) = :status', { status: 'active' })
      .orderBy('broker.name', 'ASC')
      .getMany();
  }

  async listBrokers(): Promise<Broker[]> {
    return this.repository
      .createQueryBuilder('broker')
      .orderBy('broker.name', 'ASC')
      .getMany();
  }

  async saveBrokerDefinition(
    payload: Partial<Broker>,
    options: SaveBrokerDefinitionOptions = {}
  ): Promise<Broker | null> {
    if (payload.id && typeof options.expectedUpdatedAt === 'string') {
      const { id, ...updatableFields } = payload;
      const result = await this.repository
        .createQueryBuilder()
        .update(Broker)
        .set({
          ...updatableFields,
          updatedAt: new Date(),
        } as any)
        .where('id = :id', { id })
        .andWhere('updated_at = :expectedUpdatedAt', {
          expectedUpdatedAt: new Date(options.expectedUpdatedAt),
        })
        .execute();

      if (!result.affected) {
        return null;
      }

      return this.repository.findOne({ where: { id } });
    }

    const entity = this.repository.create(payload);
    try {
      return await this.repository.save(entity);
    } catch (error) {
      if (options.expectedUpdatedAt === null && this.isDuplicateBrokerKeyError(error)) {
        return null;
      }
      throw error;
    }
  }

  isDuplicateBrokerKeyError(error: unknown): boolean {
    return this.isDuplicateBrokerConstraintError(error, [
      'uidx_brokers_broker_key',
      'broker_key',
    ]);
  }

  isDuplicateBrokerNameError(error: unknown): boolean {
    return this.isDuplicateBrokerConstraintError(error, [
      'uidx_brokers_name',
      "for key 'name'",
      ' brokers.name',
      '(name)',
    ]);
  }

  private isDuplicateBrokerConstraintError(
    error: unknown,
    markers: string[]
  ): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = String((error as { code?: string }).code || '').trim();
    const message = String((error as { message?: string }).message || '').toLowerCase();

    if (code !== 'ER_DUP_ENTRY' && code !== '23505') {
      return false;
    }

    return markers.some((marker) => message.includes(marker));
  }
}
