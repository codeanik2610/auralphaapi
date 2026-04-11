import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { strategyDataSource } from '../pg-data-source';
import { StrategyLibrary } from '../entities/StrategyLibrary';
import type { StrategyLibraryStatus } from '../../api/contracts/StrategyLibrary';
import type { StrategyLibrarySort } from '../../api/validators/strategy-library.validator';

export interface StrategyLibraryListQuery {
  limit: number;
  offset: number;
  status?: StrategyLibraryStatus;
  search?: string;
  sort?: StrategyLibrarySort;
  hasAssets?: boolean;
  hasTimeframes?: boolean;
}

export interface StrategyLibraryCreatePayload {
  templateId: string;
  name: string;
  status?: StrategyLibraryStatus;
  assets?: Record<string, unknown>[] | null;
  timeframes?: string[] | null;
  overrides?: Record<string, unknown> | null;
}

export interface StrategyLibraryUpdatePayload {
  name?: string;
  assets?: Record<string, unknown>[] | null;
  timeframes?: string[] | null;
  overrides?: Record<string, unknown> | null;
}

export interface StrategyLibraryStatusUpdatePayload {
  status: StrategyLibraryStatus;
}

@Service()
export class StrategyLibraryRepository {
  private get libraryRepository(): Repository<StrategyLibrary> {
    return strategyDataSource.getRepository(StrategyLibrary);
  }

  async listLibrary(
    userId: string,
    query: StrategyLibraryListQuery,
    options: { paginate?: boolean } = {}
  ) {
    const normalizedSearch = this.buildEscapedSearchPattern(query.search);
    const builder = this.libraryRepository
      .createQueryBuilder('library')
      .where('library.userId = :userId', { userId })
      .orderBy('library.updatedAt', 'DESC')
      .addOrderBy('library.id', 'DESC');

    if (query.status) {
      builder.andWhere('library.status = :status', { status: query.status });
    }

    if (query.hasAssets !== undefined) {
      builder.andWhere(
        `${this.buildJsonArrayCountClause('library.assets')} ${
          query.hasAssets ? '>' : '='
        } 0`
      );
    }

    if (query.hasTimeframes !== undefined) {
      builder.andWhere(
        `${this.buildJsonArrayCountClause('library.timeframes')} ${
          query.hasTimeframes ? '>' : '='
        } 0`
      );
    }

    if (normalizedSearch) {
      builder.leftJoin(
        'strategy_templates',
        'template',
        'template.id = library.templateId AND template.userId = library.userId'
      );
      builder.andWhere(
        "(" +
          "LOWER(COALESCE(library.name, '')) LIKE :search ESCAPE '\\' " +
          "OR LOWER(COALESCE(template.name, '') || ' ' || COALESCE(template.description, '')) LIKE :search ESCAPE '\\'" +
        ")",
        {
          search: normalizedSearch
        }
      );
    }

    if (options.paginate !== false) {
      builder.skip(query.offset).take(query.limit);
    }

    const [data, total] = await builder.getManyAndCount();
    return { data, total };
  }

  async listForSignalScan(userId: string, limit: number): Promise<StrategyLibrary[]> {
    return this.libraryRepository
      .createQueryBuilder('library')
      .where('library.userId = :userId', { userId })
      .andWhere('library.status = :status', { status: 'Active' })
      .orderBy('library.updatedAt', 'DESC')
      .take(limit)
      .getMany();
  }

  async getById(userId: string, id: string): Promise<StrategyLibrary | null> {
    return this.libraryRepository.findOne({ where: { id, userId } });
  }

  async findByTemplateAndNormalizedName(
    userId: string,
    templateId: string,
    name: string,
    excludeId?: string
  ): Promise<StrategyLibrary | null> {
    const normalizedName = String(name || '').trim().toLowerCase();
    if (!normalizedName) {
      return null;
    }

    const builder = this.libraryRepository
      .createQueryBuilder('library')
      .where('library.userId = :userId', { userId })
      .andWhere('library.templateId = :templateId', { templateId })
      .andWhere('LOWER(TRIM(library.name)) = :normalizedName', {
        normalizedName,
      });

    if (excludeId) {
      builder.andWhere('library.id != :excludeId', { excludeId });
    }

    return builder.getOne();
  }

  async createLibrary(userId: string, payload: StrategyLibraryCreatePayload): Promise<StrategyLibrary> {
    const record = this.libraryRepository.create({
      userId,
      templateId: payload.templateId,
      name: payload.name,
      status: payload.status || 'Draft',
      assets: payload.assets ?? null,
      timeframes: payload.timeframes ?? null,
      overrides: payload.overrides ?? null,
    });

    return this.libraryRepository.save(record);
  }

  async updateLibrary(
    userId: string,
    id: string,
    payload: StrategyLibraryUpdatePayload
  ): Promise<StrategyLibrary | null> {
    const record = await this.getById(userId, id);
    if (!record) return null;

    Object.assign(record, {
      name: payload.name ?? record.name,
      assets: payload.assets === undefined ? record.assets : payload.assets,
      timeframes: payload.timeframes === undefined ? record.timeframes : payload.timeframes,
      overrides: payload.overrides === undefined ? record.overrides : payload.overrides,
    });

    return this.libraryRepository.save(record);
  }

  async updateLibraryStatus(
    userId: string,
    id: string,
    payload: StrategyLibraryStatusUpdatePayload
  ): Promise<StrategyLibrary | null> {
    const record = await this.getById(userId, id);
    if (!record) return null;

    record.status = payload.status;
    return this.libraryRepository.save(record);
  }

  async deleteLibrary(userId: string, id: string): Promise<boolean> {
    const result = await this.libraryRepository.delete({ id, userId });
    return Boolean(result.affected && result.affected > 0);
  }

  private buildEscapedSearchPattern(value: string | undefined): string | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const escaped = normalized.replace(/[\\%_]/g, '\\$&');
    return `%${escaped}%`;
  }

  private buildJsonArrayCountClause(columnName: string): string {
    return `CASE WHEN ${columnName} IS NULL THEN 0 ELSE jsonb_array_length(${columnName}) END`;
  }
}
