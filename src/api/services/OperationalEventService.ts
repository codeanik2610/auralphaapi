import { Service, Inject } from 'typedi';
import { ActivityLog, ActivityRepository, AlertRepository } from '../../database';
import { env } from '../../env';

interface ActivityPayload {
  type: string;
  title: string;
  status: string;
  route: string;
  stream: string;
  related?: string;
  description?: string;
  referenceId?: string;
  correlationId?: string;
  symbol?: string;
  actor?: string;
  flags?: ActivityLog['flags'];
}

interface FailureAlertPayload {
  channel: string;
  source: string;
  message: string;
  route?: string;
  severity?: string;
  symbol?: string;
  urgency?: string;
}

interface NotificationAlertPayload {
  channel: string;
  source: string;
  message: string;
  route?: string;
  severity?: string;
  symbol?: string;
  urgency?: string;
  status?: string;
}

@Service()
export class OperationalEventService {
  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  async logActivity(userId: string, payload: ActivityPayload): Promise<void> {
    try {
      if (!userId) {
        return;
      }
      await this.activityRepository.createActivityLog({
        userId,
        type: payload.type,
        title: payload.title,
        status: payload.status,
        actor: payload.actor ?? userId,
        route: payload.route,
        stream: payload.stream,
        related: payload.related ?? null,
        description: payload.description ?? null,
        referenceId: payload.referenceId ?? null,
        correlationId: payload.correlationId ?? payload.referenceId ?? null,
        symbol: payload.symbol ?? null,
        flags: payload.flags ?? null,
      });
    } catch {
      // Keep primary operations non-blocking if activity logging fails.
    }
  }

  async emitFailureAlert(userId: string, payload: FailureAlertPayload): Promise<void> {
    try {
      if (!userId) {
        return;
      }
      const throttled = await this.alertRepository.findRecentOpenAlertBySource({
        userId,
        channel: payload.channel,
        source: payload.source,
        withinMinutes: env.observability.failureAlertThrottleMinutes,
      });
      if (throttled) {
        return;
      }
      const message = String(payload.message || '').slice(0, 255);
      const open = await this.alertRepository.findOpenAlertBySignature({
        userId,
        channel: payload.channel,
        source: payload.source,
        message,
      });
      if (open) {
        return;
      }
      await this.alertRepository.createAlert({
        userId,
        severity: payload.severity || 'High',
        channel: payload.channel,
        symbol: payload.symbol || 'SYSTEM',
        message,
        route: payload.route ?? null,
        status: 'Open',
        source: payload.source,
        urgency: payload.urgency ?? null,
        applyEscalationPolicy: true,
      });
    } catch {
      // Keep primary operations non-blocking if alert emission fails.
    }
  }

  async emitNotificationAlert(
    userId: string,
    payload: NotificationAlertPayload
  ): Promise<void> {
    try {
      if (!userId) {
        return;
      }
      const message = String(payload.message || '').slice(0, 255);
      await this.alertRepository.createAlert({
        userId,
        severity: payload.severity || 'Medium',
        channel: payload.channel,
        symbol: payload.symbol || 'SYSTEM',
        message,
        route: payload.route ?? null,
        status: payload.status || 'Closed',
        source: payload.source,
        urgency: payload.urgency ?? null,
        applyEscalationPolicy: false,
      });
    } catch {
      // Keep primary operations non-blocking if alert emission fails.
    }
  }
}
