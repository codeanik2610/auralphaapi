import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { MicroframeworkLoader } from 'microframework-w3tec';
import { env } from '../env';
import { RedisClient } from '../lib/RedisClient';
import { Logger } from '../lib/logger';

const log = new Logger(__filename);

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const pingRedis = async (): Promise<boolean> => {
  try {
    const ping = RedisClient.getConnection().ping();
    const result = await Promise.race([
      ping,
      wait(1200).then(() => {
        throw new Error('Redis ping timeout');
      }),
    ]);
    return result === 'PONG';
  } catch {
    return false;
  }
};

const isRedisPortListening = (): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({
      host: env.redis.host,
      port: env.redis.port,
    });

    const done = (value: boolean): void => {
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        // no-op
      }
      resolve(value);
    };

    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(800, () => done(false));
  });

const tryStartRedis = (): boolean => {
  const args = ['--bind', env.redis.host, '--port', String(env.redis.port), '--daemonize', 'yes'];
  const result = spawnSync('redis-server', args, { stdio: 'ignore' });
  return result.status === 0;
};

export const redisBootstrapLoader: MicroframeworkLoader = async () => {
  const reachable = await pingRedis();
  if (reachable) {
    log.info(`Redis connected: redis://${env.redis.host}:${env.redis.port}/${env.redis.db}`);
    return;
  }

  const alreadyListening = await isRedisPortListening();
  if (alreadyListening) {
    log.warn(
      `Redis port ${env.redis.host}:${env.redis.port} is already in use; skipping auto-start`
    );
    return;
  }

  if (!env.redis.autoStart) {
    log.warn(
      `Redis unavailable at ${env.redis.host}:${env.redis.port} and REDIS_AUTO_START is disabled`
    );
    return;
  }

  log.warn(
    `Redis unavailable at ${env.redis.host}:${env.redis.port}; attempting auto-start`
  );
  const started = tryStartRedis();
  if (!started) {
    log.warn('Redis auto-start command failed; continuing API startup without Redis');
    return;
  }

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    if (await pingRedis()) {
      log.info(`Redis auto-started: redis://${env.redis.host}:${env.redis.port}/${env.redis.db}`);
      return;
    }
    await wait(300);
  }

  log.warn(
    `Redis did not become reachable after auto-start at ${env.redis.host}:${env.redis.port}`
  );
};
