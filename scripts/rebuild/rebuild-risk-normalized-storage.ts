import 'reflect-metadata';
import { Container } from 'typedi';
import { env } from '../../src/env';
import { RiskService } from '../../src/api/services/RiskService';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { BrokerAccountRepository } from '../../src/database/repositories/BrokerAccountRepository';

function parseCsv(value: string): string[] {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function resolveTargetUserIds(limit: number): Promise<{
  requestedUserIds: string[];
  brokerKey?: string;
  ownerUserId?: string;
}> {
  const explicitUserIds = parseCsv(process.env.RISK_REBUILD_USER_IDS || '');
  const brokerKey = String(process.env.RISK_REBUILD_BROKER_KEY || '')
    .trim()
    .toLowerCase();
  const ownerUserId = String(process.env.RISK_REBUILD_OWNER_USER_ID || '').trim();

  let requestedUserIds = explicitUserIds;
  if (!requestedUserIds.length) {
    const brokerAccountRepository = Container.get(BrokerAccountRepository);
    const activeAccounts = await brokerAccountRepository.getAllActiveBrokerAccounts(
      brokerKey || undefined
    );
    requestedUserIds = Array.from(
      new Set(
        activeAccounts
          .map((account) => String(account.userId || '').trim())
          .filter(Boolean)
      )
    );
  }

  if (ownerUserId) {
    requestedUserIds = requestedUserIds.filter((userId) => userId === ownerUserId);
  }

  if (limit > 0) {
    requestedUserIds = requestedUserIds.slice(0, limit);
  }

  return {
    requestedUserIds,
    brokerKey: brokerKey || undefined,
    ownerUserId: ownerUserId || undefined,
  };
}

async function run(): Promise<void> {
  await initializeCoreDataSource();

  try {
    const actorUserId =
      String(process.env.RISK_REBUILD_ACTOR_USER_ID || '').trim() || env.scheduler.systemUserId;
    const batchSize = Math.max(1, Number(process.env.RISK_REBUILD_BATCH_SIZE || 25));
    const limit = Math.max(0, Number(process.env.RISK_REBUILD_LIMIT || 0));
    const riskService = Container.get(RiskService);
    const { requestedUserIds, brokerKey, ownerUserId } = await resolveTargetUserIds(limit);

    if (!requestedUserIds.length) {
      console.log(
        'risk-normalized-storage-rebuild:',
        JSON.stringify({
          actorUserId,
          batchSize,
          brokerKey: brokerKey || null,
          ownerUserId: ownerUserId || null,
          requestedUsers: 0,
          targetedUsers: 0,
          message: 'No user scopes matched the requested rebuild filters.',
        })
      );
      return;
    }

    const batches = chunk(requestedUserIds, batchSize);
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let snapshotsCreated = 0;
    let orderSnapshotsCreated = 0;
    let controlsCreated = 0;
    let alertsCreated = 0;
    let scenariosCreated = 0;
    const failures: Array<{ userId: string; error: string }> = [];

    for (const userIds of batches) {
      const response = await riskService.recomputeRiskSnapshotBatch(actorUserId, userIds);
      processed += Number(response.data.processed || 0);
      succeeded += Number(response.data.succeeded || 0);
      failed += Number(response.data.failed || 0);
      snapshotsCreated += Number(response.data.snapshotsCreated || 0);
      orderSnapshotsCreated += Number(response.data.orderSnapshotsCreated || 0);
      controlsCreated += Number(response.data.controlsCreated || 0);
      alertsCreated += Number(response.data.alertsCreated || 0);
      scenariosCreated += Number(response.data.scenariosCreated || 0);
      failures.push(
        ...((Array.isArray(response.data.failures) ? response.data.failures : []).map((item) => ({
          userId: String(item?.userId || '').trim(),
          error: String(item?.error || '').trim(),
        })) as Array<{ userId: string; error: string }>)
      );
    }

    console.log(
      'risk-normalized-storage-rebuild:',
      JSON.stringify({
        actorUserId,
        batchSize,
        brokerKey: brokerKey || null,
        ownerUserId: ownerUserId || null,
        requestedUsers: requestedUserIds.length,
        targetedUsers: requestedUserIds.length,
        processed,
        succeeded,
        failed,
        snapshotsCreated,
        orderSnapshotsCreated,
        controlsCreated,
        alertsCreated,
        scenariosCreated,
        failures,
      })
    );
  } finally {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  }
}

run().catch(async (error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }
  process.exit(1);
});
