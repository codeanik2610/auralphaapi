import assert from 'node:assert/strict';

import { configureMySqlDataSourceUtcSessions } from '../src/database/initializeCoreDataSource';

type FakeConnection = {
  queries: string[];
  query: (sql: string, callback: (error: unknown) => void) => void;
};

function createConnection(): FakeConnection {
  return {
    queries: [],
    query(sql: string, callback: (error: unknown) => void) {
      this.queries.push(sql);
      callback(null);
    },
  };
}

async function testRequiresInitializedDataSource(): Promise<void> {
  await assert.rejects(
    () =>
      configureMySqlDataSourceUtcSessions({
        isInitialized: false,
      } as never),
    /must be initialized/i
  );
}

async function testWrapsMySqlConnectionsAndCachesUtcSessionSetup(): Promise<void> {
  const masterConnection = createConnection();
  const slaveConnection = createConnection();
  const driver = {
    options: { type: 'mysql' },
    obtainMasterConnection: async () => masterConnection,
    obtainSlaveConnection: async () => slaveConnection,
  };

  await configureMySqlDataSourceUtcSessions({
    isInitialized: true,
    driver,
  } as never);

  const firstMaster = await driver.obtainMasterConnection();
  const secondMaster = await driver.obtainMasterConnection();
  const firstSlave = await driver.obtainSlaveConnection();
  const secondSlave = await driver.obtainSlaveConnection();

  assert.equal(firstMaster, masterConnection);
  assert.equal(secondMaster, masterConnection);
  assert.equal(firstSlave, slaveConnection);
  assert.equal(secondSlave, slaveConnection);
  assert.deepEqual(masterConnection.queries, ["SET time_zone = '+00:00'"]);
  assert.deepEqual(slaveConnection.queries, ["SET time_zone = '+00:00'"]);
}

async function testConfigurationIsIdempotent(): Promise<void> {
  const connection = createConnection();
  const driver = {
    options: { type: 'mysql' },
    obtainMasterConnection: async () => connection,
  };

  const dataSource = {
    isInitialized: true,
    driver,
  } as never;

  await configureMySqlDataSourceUtcSessions(dataSource);
  await configureMySqlDataSourceUtcSessions(dataSource);
  await driver.obtainMasterConnection();

  assert.deepEqual(connection.queries, ["SET time_zone = '+00:00'"]);
}

async function testSkipsNonMySqlDrivers(): Promise<void> {
  const driver = {
    options: { type: 'postgres' },
    obtainMasterConnection: async () => {
      throw new Error('should not wrap postgres');
    },
  };

  await configureMySqlDataSourceUtcSessions({
    isInitialized: true,
    driver,
  } as never);

  assert.equal(typeof driver.obtainMasterConnection, 'function');
}

async function run(): Promise<void> {
  await testRequiresInitializedDataSource();
  await testWrapsMySqlConnectionsAndCachesUtcSessionSetup();
  await testConfigurationIsIdempotent();
  await testSkipsNonMySqlDrivers();
  console.log('MySQL session timezone initialization assertions passed.');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
