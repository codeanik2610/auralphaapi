import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { WhatsappDelivery } from '../entities/WhatsappDelivery';

const ACTIVE_DELIVERY_STATUSES = ['Queued', 'Failed', 'Sending'] as const;

@Service()
export class WhatsappDeliveryRepository {
  private get repository(): Repository<WhatsappDelivery> {
    return coreDataSource.getRepository(WhatsappDelivery);
  }

  async queueDelivery(payload: {
    userId: string;
    suggestedTradeId?: string | null;
    automationId?: string | null;
    automationRunId?: string | null;
    recipientPhone: string;
    templateKey: string;
    body: string;
    channel?: string;
    severity: string;
    route?: string | null;
    source?: string | null;
    status?: string;
    attempts?: number;
    lastError?: string | null;
    dedupeKey?: string | null;
    providerMessageId?: string | null;
    sentAt?: Date | null;
  }): Promise<WhatsappDelivery> {
    const delivery = this.repository.create({
      userId: payload.userId,
      suggestedTradeId: payload.suggestedTradeId ?? null,
      automationId: payload.automationId ?? null,
      automationRunId: payload.automationRunId ?? null,
      recipientPhone: payload.recipientPhone,
      templateKey: payload.templateKey,
      body: payload.body,
      channel: payload.channel ?? 'whatsapp',
      severity: payload.severity,
      route: payload.route ?? null,
      source: payload.source ?? null,
      status: payload.status ?? 'Queued',
      attempts: payload.attempts ?? 0,
      lastError: payload.lastError ?? null,
      dedupeKey: payload.dedupeKey ?? null,
      providerMessageId: payload.providerMessageId ?? null,
      sentAt: payload.sentAt ?? null,
    });

    return this.repository.save(delivery);
  }

  async findByDedupeKey(dedupeKey: string): Promise<WhatsappDelivery | null> {
    return this.repository.findOne({ where: { dedupeKey } });
  }

  async claimPendingDeliveries(
    limit: number,
    maxAttempts: number,
    staleMinutes: number
  ): Promise<WhatsappDelivery[]> {
    const normalizedLimit = Math.max(1, Math.trunc(limit));
    const normalizedMaxAttempts = Math.max(1, Math.trunc(maxAttempts));
    const normalizedStaleMinutes = Math.max(1, Math.trunc(staleMinutes));

    const candidates = await this.repository
      .createQueryBuilder('delivery')
      .where(
        "(delivery.status IN ('Queued', 'Failed') OR (delivery.status = 'Sending' AND delivery.updatedAt < DATE_SUB(NOW(), INTERVAL :staleMinutes MINUTE)))",
        { staleMinutes: normalizedStaleMinutes }
      )
      .andWhere('delivery.attempts < :maxAttempts', {
        maxAttempts: normalizedMaxAttempts,
      })
      .orderBy('delivery.createdAt', 'ASC')
      .take(normalizedLimit)
      .getMany();

    const claimed: WhatsappDelivery[] = [];

    for (const candidate of candidates) {
      const result = await this.repository
        .createQueryBuilder()
        .update(WhatsappDelivery)
        .set({
          status: 'Sending',
          attempts: () => 'attempts + 1',
          lastError: null,
        })
        .where('id = :id', { id: candidate.id })
        .andWhere(
          "(status IN ('Queued', 'Failed') OR (status = 'Sending' AND updated_at < DATE_SUB(NOW(), INTERVAL :staleMinutes MINUTE)))",
          { staleMinutes: normalizedStaleMinutes }
        )
        .andWhere('attempts < :maxAttempts', {
          maxAttempts: normalizedMaxAttempts,
        })
        .execute();

      if (Number(result.affected || 0) !== 1) {
        continue;
      }

      const claimedDelivery = await this.repository.findOne({
        where: { id: candidate.id },
      });
      if (claimedDelivery) {
        claimed.push(claimedDelivery);
      }
    }

    return claimed;
  }

  async markSent(id: string, providerMessageId?: string | null): Promise<void> {
    await this.repository.update(
      { id },
      {
        status: 'Sent',
        lastError: null,
        providerMessageId: providerMessageId?.trim() || null,
        sentAt: new Date(),
      }
    );
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    const message = String(errorMessage || 'Unknown WhatsApp delivery error')
      .trim()
      .slice(0, 2000);
    await this.repository.update(
      { id },
      {
        status: 'Failed',
        lastError: message,
      }
    );
  }

  async releaseClaimedDelivery(id: string, reason?: string | null): Promise<void> {
    const message =
      typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 2000) : null;

    await this.repository
      .createQueryBuilder()
      .update(WhatsappDelivery)
      .set({
        status: 'Queued',
        attempts: () => 'CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END',
        lastError: message,
      })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: 'Sending' })
      .execute();
  }

  async getOperationalSnapshot(): Promise<{
    queued: number;
    sending: number;
    failed: number;
    active: number;
    oldestPendingAt: Date | null;
    oldestPendingAgeMs: number | null;
  }> {
    const raw = await this.repository
      .createQueryBuilder('delivery')
      .select("COALESCE(SUM(CASE WHEN delivery.status = 'Queued' THEN 1 ELSE 0 END), 0)", 'queued')
      .addSelect(
        "COALESCE(SUM(CASE WHEN delivery.status = 'Sending' THEN 1 ELSE 0 END), 0)",
        'sending'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN delivery.status = 'Failed' THEN 1 ELSE 0 END), 0)",
        'failed'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN delivery.status IN ('Queued', 'Failed', 'Sending') THEN 1 ELSE 0 END), 0)",
        'active'
      )
      .addSelect(
        "MIN(CASE WHEN delivery.status IN ('Queued', 'Failed', 'Sending') THEN delivery.createdAt ELSE NULL END)",
        'oldestPendingAt'
      )
      .getRawOne<{
        queued: string | number | null;
        sending: string | number | null;
        failed: string | number | null;
        active: string | number | null;
        oldestPendingAt: string | Date | null;
      }>();

    const parsedOldestPendingAt =
      raw?.oldestPendingAt !== undefined && raw?.oldestPendingAt !== null
        ? new Date(raw.oldestPendingAt)
        : null;
    const oldestPendingAt =
      parsedOldestPendingAt && !Number.isNaN(parsedOldestPendingAt.getTime())
        ? parsedOldestPendingAt
        : null;

    return {
      queued: Number(raw?.queued || 0),
      sending: Number(raw?.sending || 0),
      failed: Number(raw?.failed || 0),
      active: Number(raw?.active || 0),
      oldestPendingAt,
      oldestPendingAgeMs: oldestPendingAt
        ? Math.max(0, Date.now() - oldestPendingAt.getTime())
        : null,
    };
  }

  async countActiveDeliveries(): Promise<number> {
    return this.repository
      .createQueryBuilder('delivery')
      .where('delivery.status IN (:...statuses)', {
        statuses: ACTIVE_DELIVERY_STATUSES,
      })
      .getCount();
  }
}
