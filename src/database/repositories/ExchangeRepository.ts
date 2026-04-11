import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Exchange } from '../entities/Exchange';

@Service()
export class ExchangeRepository {
  private get repository(): Repository<Exchange> {
    return coreDataSource.getRepository(Exchange);
  }

  async getExchangeByKey(exchangeKey: string): Promise<Exchange | null> {
    return this.repository
      .createQueryBuilder('exchange')
      .where('LOWER(exchange.exchangeKey) = LOWER(:exchangeKey)', { exchangeKey })
      .getOne();
  }

  async listActiveExchanges(): Promise<Exchange[]> {
    return this.repository
      .createQueryBuilder('exchange')
      .where('LOWER(exchange.status) = :status', { status: 'active' })
      .orderBy('exchange.name', 'ASC')
      .getMany();
  }
}
