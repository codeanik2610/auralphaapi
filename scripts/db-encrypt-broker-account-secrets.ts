import 'reflect-metadata';
import { coreDataSource } from '../src/database/data-source';
import { initializeCoreDataSource } from '../src/database/initializeCoreDataSource';
import { encryptBrokerAccountSettings } from '../src/lib/brokerAccountSecrets';

interface BrokerAccountRow {
  id: string;
  settings: unknown;
}

const parseSettings = (raw: unknown): Record<string, unknown> | undefined => {
  if (!raw) {
    return undefined;
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }

  return undefined;
};

const run = async (): Promise<void> => {
  await initializeCoreDataSource();

  try {
    const rows = (await coreDataSource.query(
      'SELECT id, settings FROM broker_accounts'
    )) as BrokerAccountRow[];

    let updated = 0;

    for (const row of rows) {
      const settings = parseSettings(row.settings);
      if (!settings) {
        continue;
      }

      const encryptedSettings = encryptBrokerAccountSettings(settings);
      const currentJson = JSON.stringify(settings);
      const encryptedJson = JSON.stringify(encryptedSettings ?? {});

      if (!encryptedSettings || encryptedJson === currentJson) {
        continue;
      }

      await coreDataSource.query(
        'UPDATE broker_accounts SET settings = ?, updatedAt = NOW() WHERE id = ?',
        [encryptedJson, row.id]
      );
      updated += 1;
    }

    console.log(`Encrypted broker account settings for ${updated} row(s).`);
  } finally {
    await coreDataSource.destroy();
  }
};

run().catch(async (error) => {
  console.error('Failed to encrypt broker account settings.');
  console.error(error);

  if (coreDataSource.isInitialized) {
    await coreDataSource.destroy();
  }

  process.exit(1);
});
