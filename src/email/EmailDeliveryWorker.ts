import os from 'node:os';
import { EmailDeliveryRepository } from '../database/repositories/EmailDeliveryRepository';
import { env } from '../env';
import { Logger } from '../lib/logger';
import { RedisClient } from '../lib/RedisClient';
import { createEmailTransport } from './createEmailTransport';
import { EmailTransport } from './EmailTransport';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class EmailDeliveryWorker {
  private readonly log = new Logger(__filename);
  private readonly emailDeliveryRepository: EmailDeliveryRepository;
  private readonly transport: EmailTransport;
  private readonly workerId = `${os.hostname()}:${process.pid}`;
  private stopRequested = false;
  private running = false;
  private processingPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private heartbeatState: {
    workerId: string;
    timestamp?: string;
    status?: 'idle' | 'sending' | 'degraded';
    lastBatchStartedAt?: string;
    lastBatchCompletedAt?: string;
    lastBatchDeliveryCount?: number;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastError?: string | null;
    pollIntervalMs: number;
  } = {
    workerId: this.workerId,
    pollIntervalMs: env.email.pollIntervalMs,
  };

  constructor(
    emailDeliveryRepository = new EmailDeliveryRepository(),
    transport: EmailTransport = createEmailTransport()
  ) {
    this.emailDeliveryRepository = emailDeliveryRepository;
    this.transport = transport;
  }

  async start(): Promise<void> {
    if (!env.email.enabled) {
      this.log.warn(
        'Email delivery worker is disabled. Set EMAIL_DELIVERY_ENABLED=true to start sending.'
      );
      return;
    }

    this.stopRequested = false;
    this.stopPromise = null;
    this.transport.validateConfiguration();
    await this.transport.verify();
    await this.writeHeartbeat({
      status: 'idle',
      lastError: null,
    });
    this.log.info('SMTP transport verified; email delivery worker is polling.');

    while (!this.stopRequested) {
      const batchPromise = (async () => {
        this.running = true;
        try {
          await this.processBatch();
        } catch (error) {
          this.log.error(
            `Email delivery batch failed: ${
              error instanceof Error ? error.stack || error.message : String(error)
            }`
          );
        } finally {
          this.running = false;
        }
      })();

      this.processingPromise = batchPromise;
      try {
        await batchPromise;
      } finally {
        if (this.processingPromise === batchPromise) {
          this.processingPromise = null;
        }
      }

      if (!this.stopRequested) {
        await sleep(env.email.pollIntervalMs);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopRequested = true;
    this.stopPromise = (async () => {
      await this.processingPromise;
      while (this.running) {
        await sleep(100);
      }
      await this.clearHeartbeat();
    })();

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async processBatch(): Promise<void> {
    await this.writeHeartbeat({
      status: 'idle',
      lastBatchStartedAt: new Date().toISOString(),
    });

    const deliveries = await this.emailDeliveryRepository.claimPendingDeliveries(
      env.email.batchSize,
      env.email.maxAttempts,
      env.email.staleMinutes
    );

    if (!deliveries.length) {
      await this.writeHeartbeat({
        status: 'idle',
        lastBatchCompletedAt: new Date().toISOString(),
        lastBatchDeliveryCount: 0,
      });
      return;
    }

    let hadFailure = false;
    await this.writeHeartbeat({
      status: 'sending',
      lastBatchDeliveryCount: deliveries.length,
      lastError: null,
    });

    for (let index = 0; index < deliveries.length; index += 1) {
      const delivery = deliveries[index];
      if (this.stopRequested) {
        await this.releaseClaimedDeliveries(
          deliveries.slice(index),
          'Email worker shutdown released an in-flight delivery claim before send.'
        );
        return;
      }

      try {
        await this.transport.send(delivery);
        await this.emailDeliveryRepository.markSent(delivery.id);
        await this.writeHeartbeat({
          status: hadFailure ? 'degraded' : 'sending',
          lastSuccessAt: new Date().toISOString(),
        });
        this.log.info(`Email delivery sent to ${delivery.recipientEmail} (${delivery.id})`);
      } catch (error) {
        const detail =
          error instanceof Error ? error.stack || error.message : String(error);
        await this.emailDeliveryRepository.markFailed(delivery.id, detail);
        hadFailure = true;
        await this.writeHeartbeat({
          status: 'degraded',
          lastFailureAt: new Date().toISOString(),
          lastError: detail.slice(0, 500),
        });
        this.log.error(`Email delivery failed (${delivery.id}): ${detail}`);
      }
    }

    await this.writeHeartbeat({
      status: hadFailure ? 'degraded' : 'idle',
      lastBatchCompletedAt: new Date().toISOString(),
    });
  }

  private async writeHeartbeat(
    updates: Partial<{
      workerId: string;
      timestamp?: string;
      status?: 'idle' | 'sending' | 'degraded';
      lastBatchStartedAt?: string;
      lastBatchCompletedAt?: string;
      lastBatchDeliveryCount?: number;
      lastSuccessAt?: string;
      lastFailureAt?: string;
      lastError?: string | null;
      pollIntervalMs: number;
    }>
  ): Promise<void> {
    this.heartbeatState = {
      ...this.heartbeatState,
      ...updates,
      timestamp: new Date().toISOString(),
    };

    try {
      await RedisClient.getConnection().set(
        env.redis.emailWorkerHeartbeatKey,
        JSON.stringify(this.heartbeatState),
        'EX',
        this.getHeartbeatTtlSeconds()
      );
    } catch (error) {
      this.log.warn(
        `Unable to write email worker heartbeat: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async clearHeartbeat(): Promise<void> {
    try {
      await RedisClient.getConnection().del(env.redis.emailWorkerHeartbeatKey);
    } catch (error) {
      this.log.warn(
        `Unable to clear email worker heartbeat: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private getHeartbeatTtlSeconds(): number {
    return Math.max(30, Math.ceil((env.email.pollIntervalMs * 3) / 1000));
  }

  private async releaseClaimedDeliveries(
    deliveries: Array<{ id: string; recipientEmail?: string | null }>,
    reason: string
  ): Promise<void> {
    for (const delivery of deliveries) {
      await this.emailDeliveryRepository.releaseClaimedDelivery(delivery.id, reason);
      this.log.info(
        `Released claimed email delivery ${delivery.id}${
          delivery.recipientEmail ? ` (${delivery.recipientEmail})` : ''
        } during shutdown`
      );
    }
  }
}
