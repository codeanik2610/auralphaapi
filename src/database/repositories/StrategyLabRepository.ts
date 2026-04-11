import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { strategyDataSource } from '../pg-data-source';
import { StrategyLabProject } from '../entities/StrategyLabProject';
import { ValidatedStrategyLabDraftBody } from '../../api/validators/strategyLab.validator';

@Service()
export class StrategyLabRepository {
  private get projectRepository(): Repository<StrategyLabProject> {
    return strategyDataSource.getRepository(StrategyLabProject);
  }

  private buildConfig(
    payload: ValidatedStrategyLabDraftBody,
    options: {
      projectVersion: number;
      sourceTemplateId: string | null;
      sourceTemplateVersion: number | null;
      sourceTemplateName: string | null;
    }
  ): Record<string, unknown> {
    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    const timeframes = Array.isArray(payload.timeframes)
      ? payload.timeframes
      : payload.timeframe
        ? [payload.timeframe]
        : [];
    const baseConfig = {
      assets,
      timeframes,
      start: payload.start,
      end: payload.end,
      description: payload.description,
      projectVersion: options.projectVersion,
      sourceTemplateId: options.sourceTemplateId,
      sourceTemplateVersion: options.sourceTemplateVersion,
      sourceTemplateName: options.sourceTemplateName,
    };

    if (payload.authoringMode === 'no_code') {
      return {
        ...(payload.visualDefinition || {}),
        ...baseConfig,
      };
    }

    return {
      ...baseConfig,
      codeDefinition: payload.codeDefinition,
      codeTarget: payload.codeTarget,
      market: payload.market,
      entryLogic: payload.entryLogic,
      exitLogic: payload.exitLogic,
      shortEnabled: payload.shortEnabled,
      entryShortLogic: payload.entryShortLogic,
      exitShortLogic: payload.exitShortLogic,
      risk: payload.riskConfig,
      parameters: payload.parameters,
      notes: payload.notes,
      filters: {
        useAiFilter: payload.useAiFilter,
        useRegimeFilter: payload.useRegimeFilter,
        paperTradeFirst: payload.paperTradeFirst,
      },
    };
  }

  async listProjects(
    userId: string,
    options: {
      limit: number;
      offset: number;
      search?: string;
    }
  ): Promise<{ items: StrategyLabProject[]; total: number }> {
    const query = this.projectRepository
      .createQueryBuilder('project')
      .where('project.userId = :userId', { userId });

    if (options.search) {
      query.andWhere(
        '(project.name ILIKE :search OR COALESCE(project.description, \'\') ILIKE :search)',
        {
          search: `%${options.search}%`
        }
      );
    }

    const [items, total] = await query
      .orderBy('project.updatedAt', 'DESC')
      .skip(options.offset)
      .take(options.limit)
      .getManyAndCount();

    return { items, total };
  }

  async listProjectsForSignalScan(userId: string, limit: number): Promise<StrategyLabProject[]> {
    return this.projectRepository
      .createQueryBuilder('project')
      .where('project.userId = :userId', { userId })
      .orderBy('project.updatedAt', 'DESC')
      .take(limit)
      .getMany();
  }

  async getProjectById(userId: string, projectId: string): Promise<StrategyLabProject | null> {
    return this.projectRepository.findOne({ where: { id: projectId, userId } });
  }

  async saveDraft(userId: string, payload: ValidatedStrategyLabDraftBody): Promise<StrategyLabProject> {
    const projectVersion = 1;
    const config = this.buildConfig(payload, {
      projectVersion,
      sourceTemplateId: payload.sourceTemplateId,
      sourceTemplateVersion: payload.sourceTemplateVersion,
      sourceTemplateName: payload.sourceTemplateName,
    });

    const project = this.projectRepository.create({
      userId,
      name: payload.name,
      description: payload.description,
      status: 'Draft',
      projectVersion,
      sourceTemplateId: payload.sourceTemplateId,
      sourceTemplateVersion: payload.sourceTemplateVersion,
      authoringMode: payload.authoringMode,
      codeTarget: payload.codeTarget,
      visualDefinition: payload.visualDefinition,
      codeDefinition: payload.codeDefinition,
      parameters: payload.parameters,
      riskConfig: payload.riskConfig,
      validationState: 'idle',
      validationErrors: [],
      validationWarnings: [],
      objective: payload.objective,
      market: payload.market,
      timeframe: payload.timeframe,
      universe: payload.universe,
      config,
    });
    return this.projectRepository.save(project);
  }

  async updateProject(
    userId: string,
    projectId: string,
    payload: ValidatedStrategyLabDraftBody
  ): Promise<StrategyLabProject | null> {
    const project = await this.getProjectById(userId, projectId);
    if (!project) return null;
    const nextProjectVersion = Number(project.projectVersion || 1) + 1;
    const sourceTemplateId = payload.sourceTemplateId ?? project.sourceTemplateId ?? null;
    const sourceTemplateVersion =
      payload.sourceTemplateVersion ?? project.sourceTemplateVersion ?? null;
    const previousConfig =
      project.config && typeof project.config === 'object' && !Array.isArray(project.config)
        ? (project.config as Record<string, unknown>)
        : {};
    const sourceTemplateName =
      payload.sourceTemplateName ??
      (typeof previousConfig.sourceTemplateName === 'string'
        ? previousConfig.sourceTemplateName
        : null);
    const config = this.buildConfig(payload, {
      projectVersion: nextProjectVersion,
      sourceTemplateId,
      sourceTemplateVersion,
      sourceTemplateName,
    });

    Object.assign(project, {
      name: payload.name,
      description: payload.description,
      projectVersion: nextProjectVersion,
      sourceTemplateId,
      sourceTemplateVersion,
      authoringMode: payload.authoringMode,
      codeTarget: payload.codeTarget,
      visualDefinition: payload.visualDefinition,
      codeDefinition: payload.codeDefinition,
      parameters: payload.parameters,
      riskConfig: payload.riskConfig,
      validationState: 'idle',
      validationErrors: [],
      validationWarnings: [],
      objective: payload.objective,
      market: payload.market,
      timeframe: payload.timeframe,
      universe: payload.universe,
      config,
    });
    return this.projectRepository.save(project);
  }

  async updateValidation(
    userId: string,
    projectId: string,
    validationState: string,
    validationErrors: Array<{ field?: string; message: string }>,
    validationWarnings: Array<{ field?: string; message: string }>,
    validatedAt: Date
  ): Promise<StrategyLabProject | null> {
    const project = await this.getProjectById(userId, projectId);
    if (!project) return null;
    project.validationState = validationState;
    project.validationErrors = validationErrors;
    project.validationWarnings = validationWarnings;
    project.lastValidatedAt = validatedAt;
    return this.projectRepository.save(project);
  }
}
