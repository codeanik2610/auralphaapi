import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import {
  buildDisplacementPullbackContinuationTemplatePayload,
  DISPLACEMENT_PULLBACK_CONTINUATION_TEMPLATE_NAME,
} from '../../src/api/strategies/templates/DisplacementPullbackContinuationTemplate';
import { StrategyTemplate, StrategyTemplateVersion } from '../../src/database';
import { strategyDataSource } from '../../src/database/pg-data-source';

type InstallResult = {
  action: 'created' | 'updated' | 'unchanged';
  id: string;
  userId: string;
  name: string;
  templateVersion: number;
};

const readArgValue = (flag: string): string | null => {
  const prefix = `${flag}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim() || null;
    }
  }
  return null;
};

const serializeConfig = (value: Record<string, unknown> | null | undefined): string =>
  JSON.stringify(value ?? null);

const inferUserId = async (): Promise<string> => {
  const explicit =
    readArgValue('--user-id') || String(process.env.STRATEGY_TEMPLATE_USER_ID || '').trim();
  if (explicit) {
    return explicit;
  }

  const rows = (await strategyDataSource.query(
    `SELECT user_id AS "userId"
       FROM strategy_templates
      GROUP BY user_id
      ORDER BY MAX(updated_at) DESC
      LIMIT 1`
  )) as Array<{ userId?: string }>;
  const userId = String(rows[0]?.userId || '').trim();
  if (!userId) {
    throw new Error(
      'Unable to infer a strategy template user. Pass --user-id=<id> or set STRATEGY_TEMPLATE_USER_ID.'
    );
  }
  return userId;
};

const createVersionSnapshot = async (
  manager: EntityManager,
  strategy: StrategyTemplate,
  actorUserId: string,
  changeType: 'created' | 'updated'
): Promise<void> => {
  const versionRepository = manager.getRepository(StrategyTemplateVersion);
  await versionRepository.save(
    versionRepository.create({
      strategyTemplateId: strategy.id,
      userId: strategy.userId,
      actorUserId,
      templateVersion: Number(strategy.templateVersion || 1),
      changeType,
      name: strategy.name,
      description: strategy.description ?? null,
      status: strategy.status,
      config: strategy.config ?? null,
    })
  );
};

const installTemplate = async (): Promise<InstallResult> => {
  if (!strategyDataSource.isInitialized) {
    await strategyDataSource.initialize();
  }

  const userId = await inferUserId();
  const payload = buildDisplacementPullbackContinuationTemplatePayload();

  return strategyDataSource.transaction(async (manager) => {
    const templateRepository = manager.getRepository(StrategyTemplate);
    const existing =
      (await templateRepository
        .createQueryBuilder('template')
        .where('template.user_id = :userId', { userId })
        .andWhere('template.name = :name', {
          name: DISPLACEMENT_PULLBACK_CONTINUATION_TEMPLATE_NAME,
        })
        .getOne()) ?? null;

    if (!existing) {
      const created = await templateRepository.save(
        templateRepository.create({
          userId,
          name: payload.name,
          description: payload.description,
          status: payload.status,
          templateVersion: 1,
          config: payload.config,
        })
      );
      await createVersionSnapshot(manager, created, userId, 'created');
      return {
        action: 'created',
        id: created.id,
        userId: created.userId,
        name: created.name,
        templateVersion: Number(created.templateVersion || 1),
      };
    }

    const nextDescription = payload.description ?? null;
    const nextStatus = payload.status;
    const nextConfig = payload.config;
    const nextName = payload.name;
    const hasChanges =
      existing.name !== nextName ||
      existing.description !== nextDescription ||
      existing.status !== nextStatus ||
      serializeConfig(existing.config) !== serializeConfig(nextConfig);

    if (!hasChanges) {
      return {
        action: 'unchanged',
        id: existing.id,
        userId: existing.userId,
        name: existing.name,
        templateVersion: Number(existing.templateVersion || 1),
      };
    }

    existing.name = nextName;
    existing.description = nextDescription;
    existing.status = nextStatus;
    existing.config = nextConfig;
    existing.templateVersion = Number(existing.templateVersion || 1) + 1;

    const updated = await templateRepository.save(existing);
    await createVersionSnapshot(manager, updated, userId, 'updated');
    return {
      action: 'updated',
      id: updated.id,
      userId: updated.userId,
      name: updated.name,
      templateVersion: Number(updated.templateVersion || 1),
    };
  });
};

installTemplate()
  .then((result) => {
    console.log(
      `${result.action}: ${result.name} (${result.id}) user=${result.userId} version=${result.templateVersion}`
    );
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (strategyDataSource.isInitialized) {
      await strategyDataSource.destroy();
    }
  });
