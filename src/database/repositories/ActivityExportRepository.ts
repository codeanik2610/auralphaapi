import { createHash } from 'node:crypto';
import { Service } from 'typedi';
import { Brackets, In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { ActivityExport } from '../entities/ActivityExport';

export interface ActivityExportListQuery {
  limit: number;
  offset: number;
}

export interface CreateActivityExportPayload {
  userId: string;
  scope: string;
  format: string;
  status?: string;
  fileName: string;
  contentType: string;
  exportedCount: number;
  filters?: Record<string, string> | null;
  storagePath?: string | null;
  content?: string | null;
  errorMessage?: string | null;
  expiresAt?: Date | null;
}

export interface CompleteActivityExportPayload {
  exportedCount: number;
  storagePath: string;
  expiresAt?: Date | null;
}

export interface ReadyActivityExportMatchOptions {
  filters?: Record<string, string> | null;
}

@Service()
export class ActivityExportRepository {
  private get exportRepository(): Repository<ActivityExport> {
    return coreDataSource.getRepository(ActivityExport);
  }

  async listExports(userId: string, query: ActivityExportListQuery) {
    const [items, total] = await this.exportRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: query.offset,
      take: query.limit,
    });
    return { items, total };
  }

  async getExportById(userId: string, exportId: string): Promise<ActivityExport | null> {
    return this.exportRepository.findOne({ where: { id: exportId, userId } });
  }

  async createExport(payload: CreateActivityExportPayload): Promise<ActivityExport> {
    const normalizedFilters = this.normalizeFilters(payload.filters ?? null);
    const created = this.exportRepository.create({
      userId: payload.userId,
      scope: payload.scope,
      format: payload.format,
      status: payload.status ?? 'Ready',
      fileName: payload.fileName,
      contentType: payload.contentType,
      exportedCount: payload.exportedCount,
      filters: Object.keys(normalizedFilters).length ? normalizedFilters : null,
      filterSignature: this.buildFilterSignature(normalizedFilters),
      storagePath: payload.storagePath ?? null,
      content: payload.content ?? null,
      errorMessage: payload.errorMessage ?? null,
      expiresAt: payload.expiresAt ?? null,
    });
    return this.exportRepository.save(created);
  }

  async listQueuedExports(limit = 10): Promise<ActivityExport[]> {
    return this.exportRepository.find({
      where: { status: In(['Queued']) },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markExportProcessing(exportId: string): Promise<ActivityExport | null> {
    const result = await this.exportRepository.update(
      { id: exportId, status: 'Queued' },
      { status: 'Processing', errorMessage: null }
    );
    if (Number(result.affected || 0) <= 0) {
      return null;
    }
    return this.exportRepository.findOne({ where: { id: exportId } });
  }

  async markExportReady(
    exportId: string,
    payload: CompleteActivityExportPayload
  ): Promise<ActivityExport | null> {
    await this.exportRepository.update(
      { id: exportId },
      {
        status: 'Ready',
        exportedCount: payload.exportedCount,
        storagePath: payload.storagePath,
        content: null,
        errorMessage: null,
        expiresAt: payload.expiresAt ?? null,
      }
    );
    return this.exportRepository.findOne({ where: { id: exportId } });
  }

  async markExportFailed(exportId: string, errorMessage: string): Promise<ActivityExport | null> {
    await this.exportRepository.update(
      { id: exportId },
      {
        status: 'Failed',
        errorMessage: errorMessage.slice(0, 255),
      }
    );
    return this.exportRepository.findOne({ where: { id: exportId } });
  }

  async updateExportStoragePath(
    exportId: string,
    storagePath: string
  ): Promise<ActivityExport | null> {
    await this.exportRepository.update(
      { id: exportId },
      {
        storagePath,
        content: null,
      }
    );
    return this.exportRepository.findOne({ where: { id: exportId } });
  }

  async countReadyExports(
    userId: string,
    options: ReadyActivityExportMatchOptions = {},
    now = new Date()
  ): Promise<number> {
    const filters = this.normalizeFilters(options.filters);
    if (!Object.keys(filters).length) {
      return this.exportRepository.count({
        where: [
          { userId, status: 'Ready', expiresAt: IsNull() },
          { userId, status: 'Ready', expiresAt: MoreThan(now) },
        ],
      });
    }

    const filterSignature = this.buildFilterSignature(filters);
    return this.exportRepository
      .createQueryBuilder('activityExport')
      .where('activityExport.userId = :userId', { userId })
      .andWhere('activityExport.status = :status', { status: 'Ready' })
      .andWhere('activityExport.filterSignature = :filterSignature', { filterSignature })
      .andWhere(
        new Brackets((qb) => {
          qb.where('activityExport.expiresAt IS NULL').orWhere('activityExport.expiresAt > :now', {
            now,
          });
        })
      )
      .getCount();
  }

  async listExpiredExports(now = new Date(), limit = 100): Promise<ActivityExport[]> {
    return this.exportRepository.find({
      where: { expiresAt: LessThan(now) },
      order: { expiresAt: 'ASC' },
      take: limit,
    });
  }

  async countExpiredExports(now = new Date()): Promise<number> {
    return this.exportRepository
      .createQueryBuilder('activityExport')
      .where('activityExport.expiresAt IS NOT NULL')
      .andWhere('activityExport.expiresAt < :now', { now })
      .getCount();
  }

  async deleteExportsByIds(ids: string[]): Promise<number> {
    if (!ids.length) {
      return 0;
    }

    const result = await this.exportRepository.delete(ids);
    return Number(result.affected || 0);
  }

  async deleteExpiredExports(now = new Date()): Promise<number> {
    const result = await this.exportRepository
      .createQueryBuilder()
      .delete()
      .from(ActivityExport)
      .where('expires_at IS NOT NULL')
      .andWhere('expires_at < :now', { now })
      .execute();

    return Number(result.affected || 0);
  }

  private normalizeFilters(filters?: Record<string, string> | null): Record<string, string> {
    if (!filters) {
      return {};
    }

    return Object.entries(filters).reduce<Record<string, string>>((acc, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      const normalizedValue = String(value || '').trim();
      if (!normalizedKey || !normalizedValue) {
        return acc;
      }
      acc[normalizedKey] = normalizedValue;
      return acc;
    }, {});
  }

  private buildFilterSignature(filters?: Record<string, string> | null): string | null {
    const normalizedFilters = this.normalizeFilters(filters);
    const entries = Object.entries(normalizedFilters).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    if (!entries.length) {
      return null;
    }

    const canonical = JSON.stringify(entries);
    return createHash('sha256').update(canonical).digest('hex');
  }
}
