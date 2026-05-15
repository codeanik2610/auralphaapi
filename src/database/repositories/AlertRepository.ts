import { Service } from 'typedi';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { coreDataSource } from '../data-source';
import { Alert } from '../entities/Alert';
import { AlertAction } from '../entities/AlertAction';
import { AppSetting } from '../entities/AppSetting';
import { EmailDelivery } from '../entities/EmailDelivery';
import { User } from '../entities/User';
import { env } from '../../env';
import { Logger } from '../../lib/logger';

const log = new Logger('database:AlertRepository');
const REQUIRED_ALERT_INBOX_INDEXES = [
  'idx_alerts_user_created_at',
  'idx_alerts_user_status_created_at',
  'idx_alerts_user_severity_created_at',
];

export interface AlertListQuery {
  limit: number;
  offset: number;
  status?: string;
  search?: string;
  severity?: string;
  channel?: string;
}

export interface CreateAlertPayload {
  userId: string;
  severity: string;
  channel: string;
  symbol: string;
  message: string;
  route?: string | null;
  status: string;
  source?: string | null;
  urgency?: string | null;
  applyEscalationPolicy?: boolean;
  suppressEmailDelivery?: boolean;
}

export interface AlertChannelOpenSnapshot {
  openAlerts: number;
  openAlertsBySource: Record<string, number>;
}

@Service()
export class AlertRepository {
  private inboxIndexesChecked = false;

  private get alertRepository(): Repository<Alert> {
    return coreDataSource.getRepository(Alert);
  }

  private get appSettingsRepository(): Repository<AppSetting> {
    return coreDataSource.getRepository(AppSetting);
  }

  private get emailDeliveryRepository(): Repository<EmailDelivery> {
    return coreDataSource.getRepository(EmailDelivery);
  }

  private get alertActionRepository(): Repository<AlertAction> {
    return coreDataSource.getRepository(AlertAction);
  }

  private get userEntityRepository(): Repository<User> {
    return coreDataSource.getRepository(User);
  }

  private async ensureAlertsInboxIndexesChecked(): Promise<void> {
    if (this.inboxIndexesChecked || !coreDataSource.isInitialized) {
      return;
    }

    this.inboxIndexesChecked = true;

    try {
      const rows = await coreDataSource.query(
        `
          SELECT DISTINCT index_name AS indexName
          FROM information_schema.statistics
          WHERE table_schema = DATABASE()
            AND table_name = 'alerts'
            AND index_name IN (?, ?, ?)
        `,
        REQUIRED_ALERT_INBOX_INDEXES
      );
      const presentIndexes = new Set(
        Array.isArray(rows)
          ? rows
              .map((row) =>
                typeof row?.indexName === 'string' ? row.indexName : row?.INDEX_NAME
              )
              .filter((value): value is string => Boolean(value))
          : []
      );
      const missingIndexes = REQUIRED_ALERT_INBOX_INDEXES.filter(
        (indexName) => !presentIndexes.has(indexName)
      );

      if (missingIndexes.length) {
        log.warn(
          `Alerts inbox indexes missing (${missingIndexes.join(
            ', '
          )}). Apply the baseline schema before production traffic.`
        );
      }
    } catch (error) {
      log.warn('Unable to verify alerts inbox indexes.', error);
    }
  }

  private applyAlertListFilters(
    builder: SelectQueryBuilder<Alert>,
    userId: string,
    query: Pick<AlertListQuery, 'status' | 'search' | 'severity' | 'channel'>
  ): SelectQueryBuilder<Alert> {
    builder.where('alert.userId = :userId', { userId });

    if (query.status) {
      builder.andWhere('alert.status = :status', { status: query.status });
    }

    if (query.severity) {
      builder.andWhere('alert.severity = :severity', { severity: query.severity });
    }

    if (query.channel) {
      builder.andWhere('LOWER(alert.channel) = LOWER(:channel)', { channel: query.channel });
    }

    if (query.search) {
      builder.andWhere(
        '(alert.symbol LIKE :search OR alert.message LIKE :search OR alert.route LIKE :search OR alert.status LIKE :search OR alert.source LIKE :search)',
        { search: `%${query.search}%` }
      );
    }

    return builder;
  }

  async listAlerts(userId: string, query: AlertListQuery) {
    await this.ensureAlertsInboxIndexesChecked();
    const builder = this.applyAlertListFilters(
      this.alertRepository.createQueryBuilder('alert'),
      userId,
      query
    )
      .orderBy('alert.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    const [data, total] = await builder.getManyAndCount();
    return { data, total };
  }

  async getAlertById(userId: string, alertId: string): Promise<Alert | null> {
    return this.alertRepository.findOne({
      where: { id: alertId, userId },
      relations: {
        actions: true,
      },
      order: {
        actions: {
          createdAt: 'DESC',
        },
      },
    });
  }

  async getAlertsByIds(userId: string, alertIds: string[]): Promise<Alert[]> {
    const uniqueIds = Array.from(
      new Set(
        (alertIds || [])
          .map((alertId) => String(alertId || '').trim())
          .filter(Boolean)
      )
    );

    if (!uniqueIds.length) {
      return [];
    }

    const items = await this.alertRepository.find({
      where: { userId, id: In(uniqueIds) },
      order: { createdAt: 'DESC' },
    });

    const itemsById = new Map(items.map((item) => [item.id, item]));
    return uniqueIds
      .map((alertId) => itemsById.get(alertId))
      .filter((item): item is Alert => Boolean(item));
  }

  async listRelatedAlerts(
    userId: string,
    payload: { symbol: string; limit?: number }
  ): Promise<Alert[]> {
    const symbol = String(payload.symbol || '').trim();
    if (!symbol) {
      return [];
    }

    const requestedLimit = Number(payload.limit ?? 6);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 12)
      : 6;

    return this.alertRepository.find({
      where: { userId, symbol },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getAlertsSummary(
    userId: string,
    query: Pick<AlertListQuery, 'status' | 'search' | 'severity' | 'channel'> = {}
  ): Promise<{
    openAlerts: number;
    acknowledged: number;
    highSeverityAlerts: number;
  }> {
    await this.ensureAlertsInboxIndexesChecked();
    const raw = await this.applyAlertListFilters(
      this.alertRepository.createQueryBuilder('alert'),
      userId,
      query
    )
      .select(
        "COALESCE(SUM(CASE WHEN alert.status = 'Open' THEN 1 ELSE 0 END), 0)",
        'openAlerts'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN alert.status = 'Acknowledged' THEN 1 ELSE 0 END), 0)",
        'acknowledged'
      )
      .addSelect(
        "COALESCE(SUM(CASE WHEN alert.severity = 'High' THEN 1 ELSE 0 END), 0)",
        'highSeverityAlerts'
      )
      .getRawOne<{
        openAlerts?: string | number;
        acknowledged?: string | number;
        highSeverityAlerts?: string | number;
      }>();

    return {
      openAlerts: Number(raw?.openAlerts || 0),
      acknowledged: Number(raw?.acknowledged || 0),
      highSeverityAlerts: Number(raw?.highSeverityAlerts || 0),
    };
  }

  async getOpenChannelSnapshot(
    channel: string,
    sources: string[] = []
  ): Promise<AlertChannelOpenSnapshot> {
    const normalizedChannel = String(channel || '').trim();
    const normalizedSources = Array.from(
      new Set(
        (sources || [])
          .map((source) => String(source || '').trim())
          .filter(Boolean)
      )
    );

    if (!normalizedChannel) {
      return {
        openAlerts: 0,
        openAlertsBySource: {},
      };
    }

    const openAlerts = await this.alertRepository
      .createQueryBuilder('alert')
      .where('alert.status = :status', { status: 'Open' })
      .andWhere('LOWER(alert.channel) = LOWER(:channel)', { channel: normalizedChannel })
      .getCount();

    if (!normalizedSources.length) {
      return {
        openAlerts,
        openAlertsBySource: {},
      };
    }

    const sourceRows = await this.alertRepository
      .createQueryBuilder('alert')
      .select('alert.source', 'source')
      .addSelect('COUNT(*)', 'total')
      .where('alert.status = :status', { status: 'Open' })
      .andWhere('LOWER(alert.channel) = LOWER(:channel)', { channel: normalizedChannel })
      .andWhere('alert.source IN (:...sources)', { sources: normalizedSources })
      .groupBy('alert.source')
      .getRawMany<{ source?: string | null; total?: string | number }>();

    const openAlertsBySource = normalizedSources.reduce<Record<string, number>>(
      (accumulator, source) => {
        accumulator[source] = 0;
        return accumulator;
      },
      {}
    );

    sourceRows.forEach((row) => {
      const source = String(row.source || '').trim();
      if (!source) {
        return;
      }
      openAlertsBySource[source] = Number(row.total || 0);
    });

    return {
      openAlerts,
      openAlertsBySource,
    };
  }

  async updateAlert(
    userId: string,
    alertId: string,
    payload: Partial<Pick<Alert, 'status' | 'route'>>
  ): Promise<void> {
    await this.alertRepository.update({ id: alertId, userId }, payload);
  }

  async updateOpenAlertDetails(
    userId: string,
    alertId: string,
    payload: Partial<Pick<Alert, 'severity' | 'symbol' | 'message' | 'route' | 'urgency'>>
  ): Promise<void> {
    await this.alertRepository.update({ id: alertId, userId, status: 'Open' }, payload);
  }

  async createAlertAction(payload: {
    userId: string;
    alertId: string;
    actionType: string;
    target?: string;
    note?: string;
    actor?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AlertAction> {
    const action = this.alertActionRepository.create({
      userId: payload.userId,
      alertId: payload.alertId,
      actionType: payload.actionType,
      target: payload.target ?? null,
      note: payload.note ?? null,
      actor: payload.actor ?? null,
      metadata: payload.metadata ?? null,
    });

    return this.alertActionRepository.save(action);
  }

  async findOpenAlertBySignature(payload: {
    userId: string;
    channel: string;
    source?: string | null;
    message: string;
  }): Promise<Alert | null> {
    const builder = this.alertRepository
      .createQueryBuilder('alert')
      .where('alert.userId = :userId', { userId: payload.userId })
      .andWhere('alert.status = :status', { status: 'Open' })
      .andWhere('alert.channel = :channel', { channel: payload.channel })
      .andWhere('alert.message = :message', { message: payload.message })
      .orderBy('alert.createdAt', 'DESC')
      .limit(1);

    if (payload.source) {
      builder.andWhere('alert.source = :source', { source: payload.source });
    } else {
      builder.andWhere('alert.source IS NULL');
    }

    return builder.getOne();
  }

  async findOpenAlertBySource(payload: {
    userId: string;
    channel: string;
    source?: string | null;
  }): Promise<Alert | null> {
    const builder = this.alertRepository
      .createQueryBuilder('alert')
      .where('alert.userId = :userId', { userId: payload.userId })
      .andWhere('alert.status = :status', { status: 'Open' })
      .andWhere('alert.channel = :channel', { channel: payload.channel })
      .orderBy('alert.createdAt', 'DESC')
      .limit(1);

    if (payload.source) {
      builder.andWhere('alert.source = :source', { source: payload.source });
    } else {
      builder.andWhere('alert.source IS NULL');
    }

    return builder.getOne();
  }

  async findRecentOpenAlertBySource(payload: {
    userId: string;
    channel: string;
    source?: string | null;
    withinMinutes: number;
  }): Promise<Alert | null> {
    const withinMinutes = Number(payload.withinMinutes);
    if (!Number.isFinite(withinMinutes) || withinMinutes <= 0) {
      return null;
    }

    const builder = this.alertRepository
      .createQueryBuilder('alert')
      .where('alert.userId = :userId', { userId: payload.userId })
      .andWhere('alert.status = :status', { status: 'Open' })
      .andWhere('alert.channel = :channel', { channel: payload.channel })
      .andWhere('alert.createdAt >= DATE_SUB(NOW(), INTERVAL :withinMinutes MINUTE)', {
        withinMinutes,
      })
      .orderBy('alert.createdAt', 'DESC')
      .limit(1);

    if (payload.source) {
      builder.andWhere('alert.source = :source', { source: payload.source });
    } else {
      builder.andWhere('alert.source IS NULL');
    }

    return builder.getOne();
  }

  async createAlert(payload: CreateAlertPayload): Promise<Alert | null> {
    const settings = await this.appSettingsRepository.findOne({
      where: { userId: payload.userId },
    });
    const normalizedSeverity = this.normalizeAlertSeverity(payload.severity);
    const shouldCreateInApp = this.shouldCreateInAppAlert(settings, normalizedSeverity);
    const shouldQueueEmail =
      !payload.suppressEmailDelivery &&
      this.shouldQueueEmailDelivery(settings, normalizedSeverity);

    if (!shouldCreateInApp && !shouldQueueEmail) {
      return null;
    }

    const escalation = payload.applyEscalationPolicy
      ? this.resolveEscalationPolicy(settings, payload)
      : {
          route: payload.route ?? null,
          urgency: payload.urgency ?? null,
        };

    let createdAlert: Alert | null = null;

    if (shouldCreateInApp) {
      const created = this.alertRepository.create({
        userId: payload.userId,
        severity: normalizedSeverity,
        channel: payload.channel,
        symbol: payload.symbol,
        message: payload.message,
        route: escalation.route,
        status: payload.status,
        source: payload.source ?? null,
        urgency: escalation.urgency,
      });
      createdAlert = await this.alertRepository.save(created);
    }

    if (shouldQueueEmail) {
      await this.queueEmailDelivery({
        userId: payload.userId,
        alertId: createdAlert?.id ?? null,
        severity: normalizedSeverity,
        channel: payload.channel,
        symbol: payload.symbol,
        message: payload.message,
        route: escalation.route,
        source: payload.source ?? null,
        urgency: escalation.urgency,
      });
    }

    return createdAlert;
  }


  async createManualAlert(payload: CreateAlertPayload): Promise<Alert> {
    const normalizedSeverity = this.normalizeAlertSeverity(payload.severity);
    const alert = this.alertRepository.create({
      userId: payload.userId,
      severity: normalizedSeverity,
      channel: payload.channel,
      symbol: payload.symbol,
      message: payload.message,
      route: payload.route ?? null,
      status: payload.status,
      source: payload.source ?? null,
      urgency: payload.urgency ?? null,
    });

    return this.alertRepository.save(alert);
  }

  private shouldCreateInAppAlert(
    settings: AppSetting | null,
    severity: string
  ): boolean {
    if (!settings) {
      return true;
    }

    const channel = String(settings.notificationChannel || 'both').trim().toLowerCase();
    if (channel === 'disabled' || channel === 'email') {
      return false;
    }

    if (!settings.notifyInApp) {
      return false;
    }

    const severityRank = this.getAlertSeverityRank(severity);
    const thresholdRank = this.getNotificationThresholdRank(
      settings.notificationSeverity
    );

    return severityRank >= thresholdRank;
  }

  private shouldQueueEmailDelivery(
    settings: AppSetting | null,
    severity: string
  ): boolean {
    if (!settings) {
      return true;
    }

    const channel = String(settings.notificationChannel || 'both').trim().toLowerCase();
    if (channel === 'disabled' || channel === 'in-app') {
      return false;
    }

    if (!settings.notifyEmail) {
      return false;
    }

    const severityRank = this.getAlertSeverityRank(severity);
    const thresholdRank = this.getNotificationThresholdRank(
      settings.notificationSeverity
    );

    return severityRank >= thresholdRank;
  }

  private async queueEmailDelivery(payload: {
    userId: string;
    alertId: string | null;
    severity: string;
    channel: string;
    symbol: string;
    message: string;
    route: string | null;
    source: string | null;
    urgency: string | null;
  }): Promise<void> {
    const user = await this.userEntityRepository.findOne({
      where: { id: payload.userId },
    });
    const recipientEmail = String(user?.email || '').trim().toLowerCase();
    if (!recipientEmail) {
      return;
    }

    const subject = this.buildEmailSubject(payload);
    const existing = await this.findRecentEmailDeliveryBySignature({
      userId: payload.userId,
      recipientEmail,
      channel: payload.channel,
      source: payload.source,
      subject,
      withinMinutes: env.observability.failureAlertThrottleMinutes,
    });
    if (existing) {
      return;
    }

    const body = this.buildEmailBody(payload);
    const queued = this.emailDeliveryRepository.create({
      userId: payload.userId,
      alertId: payload.alertId,
      recipientEmail,
      subject,
      body,
      channel: payload.channel,
      severity: payload.severity,
      route: payload.route,
      source: payload.source,
      status: 'Queued',
      attempts: 0,
      lastError: null,
    });
    await this.emailDeliveryRepository.save(queued);
  }

  private async findRecentEmailDeliveryBySignature(payload: {
    userId: string;
    recipientEmail: string;
    channel: string;
    source?: string | null;
    subject: string;
    withinMinutes: number;
  }): Promise<EmailDelivery | null> {
    const withinMinutes = Number(payload.withinMinutes);
    if (!Number.isFinite(withinMinutes) || withinMinutes <= 0) {
      return null;
    }

    const builder = this.emailDeliveryRepository
      .createQueryBuilder('delivery')
      .where('delivery.userId = :userId', { userId: payload.userId })
      .andWhere('LOWER(delivery.recipientEmail) = LOWER(:recipientEmail)', {
        recipientEmail: payload.recipientEmail,
      })
      .andWhere('delivery.channel = :channel', { channel: payload.channel })
      .andWhere('delivery.subject = :subject', { subject: payload.subject })
      .andWhere(
        'delivery.createdAt >= DATE_SUB(NOW(), INTERVAL :withinMinutes MINUTE)',
        { withinMinutes }
      )
      .orderBy('delivery.createdAt', 'DESC')
      .limit(1);

    if (payload.source) {
      builder.andWhere('delivery.source = :source', { source: payload.source });
    } else {
      builder.andWhere('delivery.source IS NULL');
    }

    return builder.getOne();
  }

  private resolveEscalationPolicy(
    settings: AppSetting | null,
    payload: Pick<CreateAlertPayload, 'route' | 'urgency'>
  ): { route: string | null; urgency: string | null } {
    return {
      route: this.resolveEscalationRoute(settings, payload.route),
      urgency: this.resolveEscalationUrgency(settings, payload.urgency),
    };
  }

  private resolveEscalationRoute(
    settings: AppSetting | null,
    route?: string | null
  ): string | null {
    const requestedRoute = String(route || '').trim();
    if (requestedRoute && !this.isDefaultEscalationRoute(requestedRoute)) {
      return requestedRoute;
    }

    return this.getEscalationRouteLabel(settings?.escalationRoute);
  }

  private resolveEscalationUrgency(
    settings: AppSetting | null,
    urgency?: string | null
  ): string | null {
    const requestedUrgency = String(urgency || '').trim();
    if (requestedUrgency) {
      return requestedUrgency;
    }

    return this.formatEscalationWindow(settings?.escalationSlaMinutes);
  }

  private isDefaultEscalationRoute(value: string): boolean {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
    return normalized === 'risk-review';
  }

  private getEscalationRouteLabel(value?: string | null): string {
    const normalized = String(value || 'risk-review').trim().toLowerCase();
    if (normalized === 'on-call') {
      return 'On-call engineer';
    }
    if (normalized === 'manual') {
      return 'Manual triage';
    }
    return 'Risk review';
  }

  private formatEscalationWindow(value?: number | null): string {
    const minutes = this.normalizeEscalationSlaMinutes(value);
    if (minutes < 60) {
      return `Due in ${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) {
      if (remainingMinutes === 0) {
        return `Due in ${hours} hr`;
      }
      return `Due in ${hours}h ${remainingMinutes}m`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) {
      return `Due in ${days} day${days === 1 ? '' : 's'}`;
    }

    return `Due in ${days}d ${remainingHours}h`;
  }

  private buildEmailSubject(payload: {
    severity: string;
    channel: string;
    message: string;
  }): string {
    const prefix = `[${payload.severity}][${payload.channel}] `;
    const maxMessageLength = 255 - prefix.length;
    const clippedMessage = String(payload.message || '').trim().slice(0, maxMessageLength);
    return `${prefix}${clippedMessage}`.trim();
  }

  private buildEmailBody(payload: {
    severity: string;
    channel: string;
    symbol: string;
    message: string;
    route: string | null;
    source: string | null;
    urgency: string | null;
  }): string {
    const lines = [
      'AurAlpha alert notification',
      '',
      `Severity: ${payload.severity}`,
      `Channel: ${payload.channel}`,
      `Symbol: ${payload.symbol}`,
    ];

    if (payload.route) {
      lines.push(`Route: ${payload.route}`);
    }
    if (payload.urgency) {
      lines.push(`Urgency: ${payload.urgency}`);
    }
    if (payload.source) {
      lines.push(`Source: ${payload.source}`);
    }

    lines.push('', `Message: ${payload.message}`, '', `Generated at (UTC): ${new Date().toISOString()}`);

    return lines.join('\n');
  }

  private normalizeEscalationSlaMinutes(value?: number | null): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 15;
    }

    const rounded = Math.trunc(parsed);
    if (rounded < 1) {
      return 1;
    }
    if (rounded > 1440) {
      return 1440;
    }
    return rounded;
  }

  private normalizeAlertSeverity(value: string): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'low') return 'Low';
    if (normalized === 'medium') return 'Medium';
    return 'High';
  }

  private getAlertSeverityRank(value: string): number {
    const normalized = this.normalizeAlertSeverity(value);
    if (normalized === 'Low') return 1;
    if (normalized === 'Medium') return 2;
    return 3;
  }

  private getNotificationThresholdRank(value: string): number {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'medium') return 2;
    if (normalized === 'high' || normalized === 'critical') return 3;
    return 1;
  }
}
