import os from 'node:os';
import { WhatsappDeliveryRepository } from '../database/repositories/WhatsappDeliveryRepository';
import { env } from '../env';
import { Logger } from '../lib/logger';
import { RedisClient } from '../lib/RedisClient';
import { TwilioWhatsappTransport, WhatsappTransportSendResult } from './TwilioWhatsappTransport';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class WhatsappDeliveryWorker {
  private readonly log = new Logger(__filename);
  private readonly whatsappDeliveryRepository: WhatsappDeliveryRepository;
  private readonly transport: TwilioWhatsappTransport;
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
    pollIntervalMs: env.whatsapp.pollIntervalMs,
  };

  constructor(
    whatsappDeliveryRepository = new WhatsappDeliveryRepository(),
    transport = new TwilioWhatsappTransport()
  ) {
    this.whatsappDeliveryRepository = whatsappDeliveryRepository;
    this.transport = transport;
  }

  async start(): Promise<void> {
    if (!env.whatsapp.enabled) {
      this.log.warn(
        'WhatsApp delivery worker is disabled. Set WHATSAPP_DELIVERY_ENABLED=true to start sending.'
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
    this.log.info('WhatsApp transport verified; WhatsApp delivery worker is polling.');

    while (!this.stopRequested) {
      const batchPromise = (async () => {
        this.running = true;
        try {
          await this.processBatch();
        } catch (error) {
          this.log.error(
            `WhatsApp delivery batch failed: ${
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
        await sleep(env.whatsapp.pollIntervalMs);
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

    const deliveries = await this.whatsappDeliveryRepository.claimPendingDeliveries(
      env.whatsapp.batchSize,
      env.whatsapp.maxAttempts,
      env.whatsapp.staleMinutes
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
          'WhatsApp worker shutdown released an in-flight delivery claim before send.'
        );
        return;
      }

      try {
        const result = await this.transport.send(delivery);
        await this.whatsappDeliveryRepository.markSent(
          delivery.id,
          this.resolveProviderMessageId(result)
        );
        await this.writeHeartbeat({
          status: hadFailure ? 'degraded' : 'sending',
          lastSuccessAt: new Date().toISOString(),
        });
        this.log.info(`WhatsApp delivery sent to ${delivery.recipientPhone} (${delivery.id})`);
      } catch (error) {
        const detail = error instanceof Error ? error.stack || error.message : String(error);
        await this.whatsappDeliveryRepository.markFailed(delivery.id, detail);
        hadFailure = true;
        await this.writeHeartbeat({
          status: 'degraded',
          lastFailureAt: new Date().toISOString(),
          lastError: detail.slice(0, 500),
        });
        this.log.error(`WhatsApp delivery failed (${delivery.id}): ${detail}`);
      }
    }

    await this.writeHeartbeat({
      status: hadFailure ? 'degraded' : 'idle',
      lastBatchCompletedAt: new Date().toISOString(),
    });
  }

  private resolveProviderMessageId(result: WhatsappTransportSendResult | void): string | null {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const candidate =
      'providerMessageId' in result ? String(result.providerMessageId || '').trim() : '';
    return candidate ? candidate : null;
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
        env.redis.whatsappWorkerHeartbeatKey,
        JSON.stringify(this.heartbeatState),
        'EX',
        this.getHeartbeatTtlSeconds()
      );
    } catch (error) {
      this.log.warn(
        `Unable to write WhatsApp worker heartbeat: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async clearHeartbeat(): Promise<void> {
    try {
      await RedisClient.getConnection().del(env.redis.whatsappWorkerHeartbeatKey);
    } catch (error) {
      this.log.warn(
        `Unable to clear WhatsApp worker heartbeat: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private getHeartbeatTtlSeconds(): number {
    return Math.max(30, Math.ceil((env.whatsapp.pollIntervalMs * 3) / 1000));
  }

  private async releaseClaimedDeliveries(
    deliveries: Array<{ id: string; recipientPhone?: string | null }>,
    reason: string
  ): Promise<void> {
    for (const delivery of deliveries) {
      await this.whatsappDeliveryRepository.releaseClaimedDelivery(delivery.id, reason);
      this.log.info(
        `Released claimed WhatsApp delivery ${delivery.id}${
          delivery.recipientPhone ? ` (${delivery.recipientPhone})` : ''
        } during shutdown`
      );
    }
  }
}
