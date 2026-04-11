import { DataSource } from 'typeorm';
import { coreDataSource } from './data-source';

const MYSQL_SESSION_UTC_SQL = "SET time_zone = '+00:00'";
const UTC_SESSION_READY = Symbol('aurAlpha.mysqlUtcSessionReady');
const UTC_DRIVER_WRAPPED = Symbol('aurAlpha.mysqlUtcDriverWrapped');

type MySqlSessionConnection = {
  query(sql: string, callback: (error: unknown) => void): void;
  [UTC_SESSION_READY]?: boolean;
};

type MySqlDriverLike = {
  options?: { type?: string };
  obtainMasterConnection?: () => Promise<MySqlSessionConnection>;
  obtainSlaveConnection?: () => Promise<MySqlSessionConnection>;
  [UTC_DRIVER_WRAPPED]?: boolean;
};

function isMySqlDriver(driver: unknown): driver is MySqlDriverLike {
  const type = String((driver as { options?: { type?: unknown } })?.options?.type || '')
    .trim()
    .toLowerCase();
  return type === 'mysql' || type === 'mariadb';
}

async function ensureUtcSession(
  connection: MySqlSessionConnection
): Promise<MySqlSessionConnection> {
  if (!connection || connection[UTC_SESSION_READY]) {
    return connection;
  }

  await new Promise<void>((resolve, reject) => {
    connection.query(MYSQL_SESSION_UTC_SQL, (error: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  connection[UTC_SESSION_READY] = true;
  return connection;
}

function wrapConnectionFactory(
  driver: MySqlDriverLike,
  key: 'obtainMasterConnection' | 'obtainSlaveConnection'
): void {
  const original = driver[key];
  if (typeof original !== 'function') {
    return;
  }

  driver[key] = (async function wrapped(this: MySqlDriverLike, ...args: unknown[]) {
    const connection = await original.apply(this, args as []);
    return ensureUtcSession(connection);
  }) as typeof original;
}

export async function configureMySqlDataSourceUtcSessions(
  dataSource: DataSource
): Promise<void> {
  if (!dataSource.isInitialized) {
    throw new Error('Data source must be initialized before configuring MySQL UTC sessions.');
  }

  const driver = dataSource.driver as unknown;
  if (!isMySqlDriver(driver)) {
    return;
  }

  if (!driver[UTC_DRIVER_WRAPPED]) {
    wrapConnectionFactory(driver, 'obtainMasterConnection');
    wrapConnectionFactory(driver, 'obtainSlaveConnection');
    driver[UTC_DRIVER_WRAPPED] = true;
  }
}

export async function initializeCoreDataSource(): Promise<DataSource> {
  if (!coreDataSource.isInitialized) {
    await coreDataSource.initialize();
  }

  await configureMySqlDataSourceUtcSessions(coreDataSource);
  return coreDataSource;
}
