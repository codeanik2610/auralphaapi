import { Service } from 'typedi';
import { EntityManager, In, Repository } from 'typeorm';
import type { StrategyTemplateVersionChangeType, StrategyTemplateStatus } from '../../api/contracts/StrategyTemplate';
import { strategyDataSource } from '../pg-data-source';
import { StrategyTemplate } from '../entities/StrategyTemplate';
import { StrategyTemplateVersion } from '../entities/StrategyTemplateVersion';

export interface StrategyTemplateListQuery {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
}

export interface StrategyTemplateCreatePayload {
  name: string;
  description?: string | null;
  status?: StrategyTemplateStatus;
  config?: Record<string, unknown> | null;
}

export interface StrategyTemplateUpdatePayload {
  name?: string;
  description?: string | null;
  status?: StrategyTemplateStatus;
  config?: Record<string, unknown> | null;
}

export interface StrategyTemplateStatusUpdatePayload {
  status: StrategyTemplateStatus;
}

export interface StrategyTemplateDuplicatePayload {
  name?: string;
  targetUserId?: string;
}

@Service()
export class StrategyTemplateRepository {
  private get strategyTemplateRepository(): Repository<StrategyTemplate> {
    return strategyDataSource.getRepository(StrategyTemplate);
  }

  private get strategyTemplateVersionRepository(): Repository<StrategyTemplateVersion> {
    return strategyDataSource.getRepository(StrategyTemplateVersion);
  }

  async listStrategyTemplates(userId: string, query: StrategyTemplateListQuery) {
    const normalizedSearch = this.buildEscapedSearchPattern(query.search);
    const builder = this.strategyTemplateRepository
      .createQueryBuilder('strategy')
      .where('strategy.userId = :userId', { userId })
      .orderBy('strategy.updatedAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    if (query.status) {
      builder.andWhere('strategy.status = :status', { status: query.status });
    }

    if (normalizedSearch) {
      builder.andWhere(
        "LOWER(COALESCE(strategy.name, '') || ' ' || COALESCE(strategy.description, '')) LIKE :search ESCAPE '\\'",
        { search: normalizedSearch }
      );
    }

    const [data, total] = await builder.getManyAndCount();
    return { data, total };
  }

  async getStrategyTemplateById(userId: string, strategyId: string): Promise<StrategyTemplate | null> {
    return this.strategyTemplateRepository.findOne({ where: { id: strategyId, userId } });
  }

  async listStrategyTemplatesByIds(
    userId: string,
    strategyIds: string[]
  ): Promise<StrategyTemplate[]> {
    const uniqueIds = Array.from(
      new Set(
        strategyIds
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );
    if (!uniqueIds.length) {
      return [];
    }
    return this.strategyTemplateRepository.find({
      where: {
        userId,
        id: In(uniqueIds),
      },
    });
  }

  async listStrategyTemplateVersions(
    userId: string,
    strategyId: string
  ): Promise<StrategyTemplateVersion[]> {
    return this.strategyTemplateVersionRepository.find({
      where: { strategyTemplateId: strategyId, userId },
      order: {
        templateVersion: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  async createStrategyTemplate(userId: string, payload: StrategyTemplateCreatePayload): Promise<StrategyTemplate> {
    return strategyDataSource.transaction(async (manager) => {
      const strategyRepository = manager.getRepository(StrategyTemplate);
      const strategy = strategyRepository.create({
        userId,
        name: payload.name,
        description: payload.description ?? null,
        status: payload.status || 'Draft',
        templateVersion: 1,
        config: payload.config ?? null,
      });

      const saved = await strategyRepository.save(strategy);
      await this.createVersionSnapshot(manager, saved, userId, 'created');
      return saved;
    });
  }

  async updateStrategyTemplate(
    userId: string,
    strategyId: string,
    payload: StrategyTemplateUpdatePayload
  ): Promise<StrategyTemplate | null> {
    return strategyDataSource.transaction(async (manager) => {
      const strategyRepository = manager.getRepository(StrategyTemplate);
      const strategy = await strategyRepository.findOne({
        where: { id: strategyId, userId },
      });
      if (!strategy) return null;

      const nextValues = {
        name: payload.name ?? strategy.name,
        description: payload.description === undefined ? strategy.description : payload.description,
        status: payload.status ?? strategy.status,
        config: payload.config === undefined ? strategy.config : payload.config,
      };
      const statusChangedOnly =
        nextValues.status !== strategy.status &&
        payload.name === undefined &&
        payload.description === undefined &&
        payload.config === undefined;

      if (!this.hasTemplateChanges(strategy, nextValues)) {
        return strategy;
      }

      strategy.name = nextValues.name;
      strategy.description = nextValues.description ?? null;
      strategy.status = nextValues.status;
      strategy.config = nextValues.config ?? null;
      strategy.templateVersion = Number(strategy.templateVersion || 1) + 1;

      const saved = await strategyRepository.save(strategy);
      const changeType = statusChangedOnly ? 'status_changed' : 'updated';
      await this.createVersionSnapshot(manager, saved, userId, changeType);
      return saved;
    });
  }

  async updateStrategyTemplateStatus(
    userId: string,
    strategyId: string,
    payload: StrategyTemplateStatusUpdatePayload
  ): Promise<StrategyTemplate | null> {
    return strategyDataSource.transaction(async (manager) => {
      const strategyRepository = manager.getRepository(StrategyTemplate);
      const strategy = await strategyRepository.findOne({
        where: { id: strategyId, userId },
      });
      if (!strategy) {
        return null;
      }

      if (strategy.status === payload.status) {
        return strategy;
      }

      strategy.status = payload.status;
      strategy.templateVersion = Number(strategy.templateVersion || 1) + 1;

      const saved = await strategyRepository.save(strategy);
      await this.createVersionSnapshot(manager, saved, userId, 'status_changed');
      return saved;
    });
  }

  async duplicateStrategyTemplate(
    userId: string,
    strategyId: string,
    payload: StrategyTemplateDuplicatePayload
  ): Promise<StrategyTemplate | null> {
    return strategyDataSource.transaction(async (manager) => {
      const strategyRepository = manager.getRepository(StrategyTemplate);
      const source = await strategyRepository.findOne({
        where: { id: strategyId, userId },
      });
      if (!source) {
        return null;
      }

      const targetUserId = payload.targetUserId && payload.targetUserId.trim() ? payload.targetUserId.trim() : userId;

      const duplicate = strategyRepository.create({
        userId: targetUserId,
        name: payload.name || `${source.name} Copy`,
        description: source.description ?? null,
        status: 'Draft',
        templateVersion: 1,
        config: source.config ?? null,
      });

      const saved = await strategyRepository.save(duplicate);
      await this.createVersionSnapshot(manager, saved, userId, 'duplicated');
      return saved;
    });
  }

  async deleteStrategyTemplate(userId: string, strategyId: string): Promise<boolean> {
    const result = await this.strategyTemplateRepository.delete({ id: strategyId, userId });
    return Boolean(result.affected && result.affected > 0);
  }

  private async createVersionSnapshot(
    manager: EntityManager,
    strategy: StrategyTemplate,
    actorUserId: string,
    changeType: StrategyTemplateVersionChangeType
  ): Promise<StrategyTemplateVersion> {
    const versionRepository = manager.getRepository(StrategyTemplateVersion);
    const snapshot = versionRepository.create({
      strategyTemplateId: strategy.id,
      userId: strategy.userId,
      actorUserId,
      templateVersion: Number(strategy.templateVersion || 1),
      changeType,
      name: strategy.name,
      description: strategy.description ?? null,
      status: strategy.status,
      config: strategy.config ?? null,
    });

    return versionRepository.save(snapshot);
  }

  private hasTemplateChanges(
    strategy: StrategyTemplate,
    nextValues: {
      name: string;
      description: string | null | undefined;
      status: string;
      config: Record<string, unknown> | null | undefined;
    }
  ): boolean {
    if (strategy.name !== nextValues.name) {
      return true;
    }
    if ((strategy.description ?? null) !== (nextValues.description ?? null)) {
      return true;
    }
    if (strategy.status !== nextValues.status) {
      return true;
    }
    return this.serializeConfig(strategy.config) !== this.serializeConfig(nextValues.config);
  }

  private serializeConfig(value: Record<string, unknown> | null | undefined): string {
    if (!value) {
      return 'null';
    }
    return JSON.stringify(value);
  }

  private buildEscapedSearchPattern(value: string | undefined): string | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const escaped = normalized.replace(/[\\%_]/g, '\\$&');
    return `%${escaped}%`;
  }
}
