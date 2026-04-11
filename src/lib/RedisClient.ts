import IORedis from 'ioredis';
import { env } from '../env';

export class RedisClient {
  private static sharedConnection: IORedis | null = null;

  static getConnection(): IORedis {
    if (!RedisClient.sharedConnection) {
      RedisClient.sharedConnection = new IORedis({
        host: env.redis.host,
        port: env.redis.port,
        username: env.redis.username || undefined,
        password: env.redis.password || undefined,
        db: env.redis.db,
        tls: env.redis.tls ? {} : undefined,
        maxRetriesPerRequest: null,
      });
    }

    return RedisClient.sharedConnection;
  }
}
