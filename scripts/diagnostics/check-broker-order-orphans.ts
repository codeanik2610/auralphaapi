import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { coreDataSource } from '../../src/database/data-source';
import { initializeCoreDataSource } from '../../src/database/initializeCoreDataSource';
import { loadBrokerOrderOrphans } from './broker-order-orphans-lib';

const OUTPUT_FILE = String(
  process.env.BROKER_ORDER_ORPHANS_OUTPUT_FILE || 'artifacts/broker-order-orphans-dry-run.json'
).trim();

async function main(): Promise<void> {
  await initializeCoreDataSource();
  const items = await loadBrokerOrderOrphans();
  const summary = items.reduce<Record<string, number>>((acc, item) => {
    const key = `${item.brokerKey}:${item.kind}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const output = {
    generatedAt: new Date().toISOString(),
    summary,
    items,
  };

  const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output, null, 2));

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (coreDataSource.isInitialized) {
      await coreDataSource.destroy();
    }
  });
