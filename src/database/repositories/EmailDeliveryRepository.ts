import { Service } from 'typedi';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { coreDataSource } from '../data-source';
import { EmailDelivery } from '../entities/EmailDelivery';

const ACTIVE_DELIVERY_STATUSES = ['Queued', 'Failed', 'Sending'] as const;
const TERMINAL_DELIVERY_STATUSES = ['Sent', 'Failed'] as const;

export interface EmailDeliveryListQuery {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
  userId?: string;
  recipient?: string;
  severity?: string;
  channel?: string;
  source?: string;
}

@Service()
export class EmailDeliveryRepository {
  private get repository(): Repository<EmailDelivery> {
    return coreDataSource.getRepository(EmailDelivery);
  }

  async queueDelivery(payload: {
    userId: string;
    alertId?: string | null;
    recipientEmail: string;
    subject: string;
    body: string;
    channel: string;
    severity: string;
    route?: string | null;
    source?: string | null;
    status?: string;
    attempts?: number;
    lastError?: string | null;
  }): Promise<EmailDelivery> {
    const delivery = this.repository.create({
      userId: payload.userId,
      alertId: payload.alertId ?? null,
      recipientEmail: payload.recipientEmail,
      subject: payload.subject,
      body: payload.body,
      channel: payload.channel,
      severity: payload.severity,
      route: payload.route ?? null,
      source: payload.source ?? null,
      status: payload.status ?? 'Queued',
      attempts: payload.attempts ?? 0,
      lastError: payload.lastError ?? null,
    });

    return this.repository.save(delivery);
  }

  private applyFilters(
    builder: SelectQueryBuilder<EmailDelivery>,
    query: Pick<
      EmailDeliveryListQuery,
      'status' | 'search' | 'userId' | 'recipient' | 'severity' | 'channel' | 'source'
    >
  ): SelectQueryBuilder<EmailDelivery> {
    if (query.status) {
      builder.andWhere('delivery.status = :status', { status: query.status });
    }

    if (query.userId) {
      builder.andWhere('delivery.userId = :userId', { userId: query.userId });
    }

    if (query.recipient) {
      builder.andWhere('LOWER(delivery.recipientEmail) LIKE LOWER(:recipient)', {
        recipient: `%${query.recipient}%`,
      });
    }

    if (query.severity) {
      builder.andWhere('LOWER(delivery.severity) = LOWER(:severity)', {
        severity: query.severity,
      });
    }

    if (query.channel) {
      builder.andWhere('LOWER(delivery.channel) = LOWER(:channel)', {
        channel: query.channel,
      });
    }

    if (query.source) {
      builder.andWhere('LOWER(delivery.source) LIKE LOWER(:source)', {
        source: `%${query.source}%`,
      });
    }

    if (query.search) {
      builder.andWhere(
        '(LOWER(delivery.recipientEmail) LIKE LOWER(:search) OR LOWER(delivery.subject) LIKE LOWER(:search) OR LOWER(delivery.route) LIKE LOWER(:search) OR LOWER(delivery.source) LIKE LOWER(:search) OR LOWER(delivery.lastError) LIKE LOWER(:search))',
        { search: `%${query.search}%` }
      );
    }

    return builder;
  }

  private buildFailedDeliveryFilterQuery(
    query: Pick<
      EmailDeliveryListQuery,
      'status' | 'search' | 'userId' | 'recipient' | 'severity' | 'channel' | 'source'
    >
  ): SelectQueryBuilder<EmailDelivery> {
    return this.applyFilters(
      this.repository
        .createQueryBuilder('delivery')
        .where('delivery.status = :failedStatus', { failedStatus: 'Failed' }),
      query
    );
  }

  private buildTerminalDeliveryFilterQuery(
    query: Pick<
      EmailDeliveryListQuery,
      'status' | 'search' | 'userId' | 'recipient' | 'severity' | 'channel' | 'source'
    >
  ): SelectQueryBuilder<EmailDelivery> {
    return this.applyFilters(
      this.repository
        .createQueryBuilder('delivery')
        .where('delivery.status IN (:...statuses)', {
          statuses: TERMINAL_DELIVERY_STATUSES,
        }),
      query
    );
  }

  async listDeliveries(query: EmailDeliveryListQuery): Promise<{
    items: EmailDelivery[];
    total: number;
  }> {
    const builder = this.applyFilters(
      this.repository
        .createQueryBuilder('delivery')
        .orderBy('delivery.createdAt', 'DESC')
        .skip(query.offset)
        .take(query.limit),
      query
    );

    const [items, total] = await builder.getManyAndCount();
    return { items, total };
  }

  async getDeliveryById(id: string): Promise<EmailDelivery | null> {
    return this.repository.findOne({
      where: { id },
    });
  }

  async getFilterOptions(): Promise<{
    severities: string[];
    channels: string[];
  }> {
    const [severityRows, channelRows] = await Promise.all([
      this.repository
        .createQueryBuilder('delivery')
        .select('DISTINCT delivery.severity', 'value')
        .where("TRIM(COALESCE(delivery.severity, '')) <> ''")
        .orderBy('delivery.severity', 'ASC')
        .getRawMany<{ value: string | null }>(),
      this.repository
        .createQueryBuilder('delivery')
        .select('DISTINCT delivery.channel', 'value')
        .where("TRIM(COALESCE(delivery.channel, '')) <> ''")
        .orderBy('delivery.channel', 'ASC')
        .getRawMany<{ value: string | null }>(),
    ]);

    return {
      severities: severityRows
        .map((row) => String(row.value || '').trim())
        .filter(Boolean),
      channels: channelRows
        .map((row) => String(row.value || '').trim())
        .filter(Boolean),
    };
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
      .addSelect("COALESCE(SUM(CASE WHEN delivery.status = 'Failed' THEN 1 ELSE 0 END), 0)", 'failed')
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

  async retryFailedDelivery(id: string): Promise<EmailDelivery | null> {
    const result = await this.repository.update(
      { id, status: 'Failed' },
      {
        status: 'Queued',
        attempts: 0,
        lastError: null,
      }
    );

    if (Number(result.affected || 0) !== 1) {
      return null;
    }

    return this.getDeliveryById(id);
  }

  async retryAllFailedDeliveries(): Promise<number> {
    const result = await this.repository.update(
      { status: 'Failed' },
      {
        status: 'Queued',
        attempts: 0,
        lastError: null,
      }
    );

    return Number(result.affected || 0);
  }

  async countMatchingFailedDeliveries(
    query: Pick<
      EmailDeliveryListQuery,
      'status' | 'search' | 'userId' | 'recipient' | 'severity' | 'channel' | 'source'
    >
  ): Promise<number> {
    return this.buildFailedDeliveryFilterQuery(query).getCount();
  }

  async retryMatchingFailedDeliveries(
    query: Pick<
      EmailDeliveryListQuery,
      'status' | 'search' | 'userId' | 'recipient' | 'severity' | 'channel' | 'source'
    >
  ): Promise<number> {
    const items = await this.buildFailedDeliveryFilterQuery(query)
      .select(['delivery.id'])
      .getMany();

    const ids = items.map((item) => item.id).filter(Boolean);
    if (!ids.length) {
      return 0;
    }

    const result = await this.repository
      .createQueryBuilder()
      .update(EmailDelivery)
      .set({
        status: 'Queued',
        attempts: 0,
        lastError: null,
      })
      .whereInIds(ids)
      .andWhere('status = :failedStatus', { failedStatus: 'Failed' })
      .execute();

    return Number(result.affected || 0);
  }

  async countTerminalDeliveriesOlderThanDays(retentionDays: number): Promise<{
    total: number;
    sent: number;
    failed: number;
  }> {
    const [sent, failed] = await Promise.all([
      this.repository
        .createQueryBuilder('delivery')
        .where('delivery.status = :status', { status: 'Sent' })
        .andWhere('delivery.updatedAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
          retentionDays,
        })
        .getCount(),
      this.repository
        .createQueryBuilder('delivery')
        .where('delivery.status = :status', { status: 'Failed' })
        .andWhere('delivery.updatedAt < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
          retentionDays,
        })
        .getCount(),
    ]);

    return {
      total: sent + failed,
      sent,
      failed,
    };
  }

  async deleteTerminalDeliveriesOlderThanDays(retentionDays: number): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(EmailDelivery)
      .where('status IN (:...statuses)', {
        statuses: TERMINAL_DELIVERY_STATUSES,
      })
      .andWhere('updated_at < DATE_SUB(NOW(), INTERVAL :retentionDays DAY)', {
        retentionDays,
      })
      .execute();

    return Number(result.affected || 0);
  }

  async countMatchingTerminalDeliveries(
    query: Pick<
      EmailDeliveryListQuery,
      'status' | 'search' | 'userId' | 'recipient' | 'severity' | 'channel' | 'source'
    >
  ): Promise<{
    total: number;
    sent: number;
    failed: number;
  }> {
    const baseQuery = this.buildTerminalDeliveryFilterQuery(query);
    const [total, sent, failed] = await Promise.all([
      baseQuery.clone().getCount(),
      baseQuery
        .clone()
        .andWhere('delivery.status = :sentStatus', { sentStatus: 'Sent' })
        .getCount(),
      baseQuery
        .clone()
        .andWhere('delivery.status = :failedStatus', { failedStatus: 'Failed' })
        .getCount(),
    ]);

    return {
      total,
      sent,
      failed,
    };
  }

  async deleteMatchingTerminalDeliveries(
    query: Pick<
      EmailDeliveryListQuery,
      'status' | 'search' | 'userId' | 'recipient' | 'severity' | 'channel' | 'source'
    >
  ): Promise<number> {
    const items = await this.buildTerminalDeliveryFilterQuery(query)
      .select(['delivery.id'])
      .getMany();

    const ids = items.map((item) => item.id).filter(Boolean);
    if (!ids.length) {
      return 0;
    }

    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(EmailDelivery)
      .whereInIds(ids)
      .execute();

    return Number(result.affected || 0);
  }

  async cloneDeliveryForResend(delivery: EmailDelivery): Promise<EmailDelivery> {
    const cloned = this.repository.create({
      userId: delivery.userId,
      alertId: delivery.alertId ?? null,
      recipientEmail: delivery.recipientEmail,
      subject: delivery.subject,
      body: delivery.body,
      channel: delivery.channel,
      severity: delivery.severity,
      route: delivery.route ?? null,
      source: delivery.source ?? null,
      status: 'Queued',
      attempts: 0,
      lastError: null,
    });

    return this.repository.save(cloned);
  }

  async getSummary(): Promise<{
    queued: number;
    sending: number;
    sent: number;
    failed: number;
    active: number;
    latestSentAt: Date | null;
    oldestPendingAt: Date | null;
  }> {
    const [queued, sending, sent, failed, active, latestSent, oldestPending] =
      await Promise.all([
        this.repository.count({ where: { status: 'Queued' } }),
        this.repository.count({ where: { status: 'Sending' } }),
        this.repository.count({ where: { status: 'Sent' } }),
        this.repository.count({ where: { status: 'Failed' } }),
        this.countActiveDeliveries(),
        this.repository.findOne({
          where: { status: 'Sent' },
          order: { updatedAt: 'DESC' },
        }),
        this.repository
          .createQueryBuilder('delivery')
          .where("delivery.status IN ('Queued', 'Failed', 'Sending')")
          .orderBy('delivery.createdAt', 'ASC')
          .getOne(),
      ]);

    return {
      queued,
      sending,
      sent,
      failed,
      active,
      latestSentAt: latestSent?.updatedAt ?? null,
      oldestPendingAt: oldestPending?.createdAt ?? null,
    };
  }

  async claimPendingDeliveries(
    limit: number,
    maxAttempts: number,
    staleMinutes: number
  ): Promise<EmailDelivery[]> {
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

    const claimed: EmailDelivery[] = [];

    for (const candidate of candidates) {
      const result = await this.repository
        .createQueryBuilder()
        .update(EmailDelivery)
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

  async markSent(id: string): Promise<void> {
    await this.repository.update({ id }, { status: 'Sent', lastError: null });
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    const message = String(errorMessage || 'Unknown email delivery error')
      .trim()
      .slice(0, 2000);
    await this.repository.update({ id }, { status: 'Failed', lastError: message });
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
