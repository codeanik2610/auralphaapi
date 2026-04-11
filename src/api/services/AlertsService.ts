import { Inject, Service } from 'typedi';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  AlertDetailItem,
  AlertHistoryItem,
  AlertItem,
  AlertRouteActionResult,
  AlertRouteTarget,
  AlertsListResponse,
  AlertsSummary,
  AlertStatusActionResult,
} from '../contracts/Alert';
import { NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import {
  AlertAcknowledgeBody,
  AlertMuteBody,
  AlertRouteBody,
  AlertsQuery,
  validateAlertAcknowledgeBody,
  validateAlertId,
  validateAlertMuteBody,
  validateAlertRouteBody,
  validateAlertsQuery,
} from '../validators/alerts.validator';
import { Alert } from '../../database';
import { AlertRepository } from '../../database';
import { ActivityRepository } from '../../database';
import { coreDataSource } from '../../database/data-source';
import { AlertAction } from '../../database/entities/AlertAction';

@Service()
export class AlertsService {
  @Inject(() => AlertRepository)
  private alertRepository!: AlertRepository;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  async getAlerts(userId: string, query: AlertsQuery): Promise<ApiSuccessResponse<AlertsListResponse>> {
    const params = validateAlertsQuery(query);
    const { data, total } = await this.alertRepository.listAlerts(userId, params);

    return successResponse({
      items: data.map((alert) => this.mapAlert(alert)),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getAlertsSummary(userId: string): Promise<ApiSuccessResponse<AlertsSummary>> {
    const summary = await this.alertRepository.getAlertsSummary(userId);

    return successResponse({
      openAlerts: summary.openAlerts,
      acknowledged: summary.acknowledged,
      highSeverityAlerts: summary.highSeverityAlerts,
      criticalSeverity: summary.highSeverityAlerts,
      watchlistCapable: 'Yes',
    });
  }

  async getScopedAlertsSummary(
    userId: string,
    query: AlertsQuery
  ): Promise<ApiSuccessResponse<AlertsSummary>> {
    const params = validateAlertsQuery(query);
    const summary = await this.alertRepository.getAlertsSummary(userId, {
      status: params.status,
      search: params.search,
      severity: params.severity,
      channel: params.channel,
    });

    return successResponse({
      openAlerts: summary.openAlerts,
      acknowledged: summary.acknowledged,
      highSeverityAlerts: summary.highSeverityAlerts,
      criticalSeverity: summary.highSeverityAlerts,
      watchlistCapable: 'Yes',
    });
  }

  async getAlertById(userId: string, alertId: string): Promise<ApiSuccessResponse<AlertDetailItem>> {
    const alert = await this.requireAlert(userId, alertId);
    return successResponse(this.mapAlertDetail(alert));
  }

  async acknowledgeAlert(
    userId: string,
    alertId: string,
    body: AlertAcknowledgeBody = {}
  ): Promise<ApiSuccessResponse<AlertStatusActionResult>> {
    const validatedAlertId = validateAlertId(alertId);
    try {
      const payload = validateAlertAcknowledgeBody(body);
      const alert = await this.runAlertActionTransaction(userId, validatedAlertId, {
        alertUpdate: { status: 'Acknowledged' },
        actionType: 'acknowledge',
        note: payload.note,
      });
      await this.logAlertActivity(userId, validatedAlertId, 'Alert acknowledged', 'Success');

      return successResponse({
        message: 'Alert acknowledged',
        alert: {
          id: alert.id,
          status: alert.status as AlertStatusActionResult['alert']['status'],
          updatedAt: alert.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      await this.logAlertActivity(
        userId,
        validatedAlertId,
        'Alert acknowledge failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitAlertActionFailureAlert(
        userId,
        'acknowledge',
        validatedAlertId,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async muteAlert(
    userId: string,
    alertId: string,
    body: AlertMuteBody = {}
  ): Promise<ApiSuccessResponse<AlertStatusActionResult>> {
    const validatedAlertId = validateAlertId(alertId);
    try {
      const payload = validateAlertMuteBody(body);
      const alert = await this.runAlertActionTransaction(userId, validatedAlertId, {
        alertUpdate: { status: 'Muted' },
        actionType: 'mute',
        note: payload.reason,
      });
      await this.logAlertActivity(userId, validatedAlertId, 'Alert muted', 'Success');

      return successResponse({
        message: 'Alert muted',
        alert: {
          id: alert.id,
          status: alert.status as AlertStatusActionResult['alert']['status'],
          updatedAt: alert.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      await this.logAlertActivity(
        userId,
        validatedAlertId,
        'Alert mute failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitAlertActionFailureAlert(
        userId,
        'mute',
        validatedAlertId,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  async routeAlert(
    userId: string,
    alertId: string,
    body: AlertRouteBody
  ): Promise<ApiSuccessResponse<AlertRouteActionResult>> {
    const validatedAlertId = validateAlertId(alertId);
    try {
      const { target, note } = validateAlertRouteBody(body);
      const targetLabel = this.getRouteLabel(target);
      const alert = await this.runAlertActionTransaction(userId, validatedAlertId, {
        alertUpdate: {
          route: targetLabel,
        },
        actionType: 'route',
        target,
        note,
        metadata: { target, targetLabel },
      });
      await this.logAlertActivity(
        userId,
        validatedAlertId,
        `Alert triage updated to ${targetLabel}`,
        'Success'
      );

      return successResponse({
        message: 'Alert triage updated',
        alert: {
          id: alert.id,
          route: alert.route ?? targetLabel,
          updatedAt: alert.updatedAt.toISOString(),
        },
        target,
        targetLabel,
        note,
      });
    } catch (error) {
      await this.logAlertActivity(
        userId,
        validatedAlertId,
        'Alert triage update failed',
        'Failed',
        error instanceof Error ? error.message : String(error)
      );
      await this.emitAlertActionFailureAlert(
        userId,
        'route',
        validatedAlertId,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private async requireAlert(userId: string, alertId: string): Promise<Alert> {
    const validatedAlertId = validateAlertId(alertId);
    const alert = await this.alertRepository.getAlertById(userId, validatedAlertId);

    if (!alert) {
      throw new NotFoundAppError('Alert not found');
    }

    return alert;
  }

  private async runAlertActionTransaction(
    userId: string,
    alertId: string,
    payload: {
      alertUpdate: Partial<Pick<Alert, 'status' | 'route'>>;
      actionType: string;
      note?: string;
      target?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<Alert> {
    return coreDataSource.transaction(async (manager) => {
      const alertRepository = manager.getRepository(Alert);
      const alertActionRepository = manager.getRepository(AlertAction);
      const alert = await alertRepository.findOne({
        where: { id: alertId, userId },
      });

      if (!alert) {
        throw new NotFoundAppError('Alert not found');
      }

      await alertRepository.update({ id: alertId, userId }, payload.alertUpdate);

      await alertActionRepository.save(
        alertActionRepository.create({
          userId,
          alertId,
          actionType: payload.actionType,
          target: payload.target ?? null,
          note: payload.note ?? null,
          actor: userId,
          metadata: payload.metadata ?? null,
        })
      );

      const updatedAlert = await alertRepository.findOne({
        where: { id: alertId, userId },
      });

      if (!updatedAlert) {
        throw new NotFoundAppError('Alert not found');
      }

      return updatedAlert;
    });
  }

  private mapAlert(alert: Alert): AlertItem {
    return {
      id: alert.id,
      severity: alert.severity as AlertItem['severity'],
      channel: alert.channel,
      symbol: alert.symbol,
      message: alert.message,
      route: alert.route ?? '',
      time: alert.createdAt.toISOString(),
      status: alert.status as AlertItem['status'],
      source: alert.source ?? '',
      urgency: alert.urgency ?? '',
      updatedAt: alert.updatedAt.toISOString(),
    };
  }

  private mapAlertDetail(alert: Alert): AlertDetailItem {
    return {
      ...this.mapAlert(alert),
      createdAt: alert.createdAt.toISOString(),
      history: this.buildAlertHistory(alert),
    };
  }

  private buildAlertHistory(alert: Alert): AlertHistoryItem[] {
    const actionHistory = Array.isArray(alert.actions)
      ? alert.actions.map((action) => this.mapAlertHistoryItem(action))
      : [];

    const createdEntry: AlertHistoryItem = {
      id: `created-${alert.id}`,
      actionType: 'created',
      title: 'Alert created',
      description: `${alert.severity} severity alert opened through ${alert.channel}.`,
      actor: alert.source?.trim() || 'System',
      createdAt: alert.createdAt.toISOString(),
    };

    return [createdEntry, ...actionHistory].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  private mapAlertHistoryItem(action: AlertAction): AlertHistoryItem {
    const target = this.normalizeRouteTarget(action.target);
    const targetLabel = this.readString(action.metadata?.targetLabel) ?? undefined;
    const note = action.note?.trim() || undefined;
    const actor = action.actor?.trim() || 'System';

    if (action.actionType === 'acknowledge') {
      return {
        id: action.id,
        actionType: 'acknowledge',
        title: 'Alert acknowledged',
        description: note
          ? 'Operator confirmed the alert and added a review note.'
          : 'Operator confirmed the alert.',
        actor,
        createdAt: action.createdAt.toISOString(),
        note,
      };
    }

    if (action.actionType === 'mute') {
      return {
        id: action.id,
        actionType: 'mute',
        title: 'Alert muted',
        description: note
          ? 'Alert noise was muted with an operator reason.'
          : 'Alert noise was muted.',
        actor,
        createdAt: action.createdAt.toISOString(),
        note,
      };
    }

    if (action.actionType === 'route') {
      const resolvedTargetLabel = targetLabel || action.target || 'New triage desk';
      return {
        id: action.id,
        actionType: 'route',
        title: `Assigned to ${resolvedTargetLabel}`,
        description: note
          ? 'Triage ownership changed and a note was attached.'
          : 'Triage ownership changed.',
        actor,
        createdAt: action.createdAt.toISOString(),
        note,
        target: target ?? undefined,
        targetLabel: resolvedTargetLabel,
      };
    }

    return {
      id: action.id,
      actionType: 'created',
      title: action.actionType,
      description: note || 'Alert action recorded.',
      actor,
      createdAt: action.createdAt.toISOString(),
      note,
      target: target ?? undefined,
      targetLabel,
    };
  }

  private getRouteLabel(target: string): string {
    switch (target) {
      case 'signals':
        return 'Signal review';
      case 'risk':
        return 'Risk review';
      case 'automations':
        return 'Automation desk';
      case 'orders':
      default:
        return 'Orders desk';
    }
  }

  private normalizeRouteTarget(value: string | null | undefined): AlertRouteTarget | null {
    const candidate = String(value || '').trim();
    if (
      candidate === 'signals' ||
      candidate === 'risk' ||
      candidate === 'automations' ||
      candidate === 'orders'
    ) {
      return candidate;
    }

    return null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private async logAlertActivity(
    userId: string,
    alertId: string,
    title: string,
    status: string,
    description?: string
  ): Promise<void> {
    try {
      const time = new Date().toISOString();
      await this.activityRepository.createActivityLog({
        userId,
        type: 'Alert action',
        title,
        status,
        actor: userId,
        route: 'Alerts',
        stream: 'Controls',
        referenceId: alertId,
        related: 'alerts',
        description: description || `${title} (${alertId})`,
        flags: [
          {
            id: status === 'Failed' ? 'alert-action-review' : 'alert-action-synced',
            message:
              status === 'Failed'
                ? 'Review alert action outcome and triage state.'
                : 'Alert history updated successfully.',
            channel: 'Alerts',
            time,
            status: status === 'Failed' ? 'Needs review' : 'Ready',
          },
        ],
      });
    } catch {
      // Keep alert actions non-blocking if activity logging fails.
    }
  }

  private async emitAlertActionFailureAlert(
    userId: string,
    action: string,
    alertId: string,
    detail: string
  ): Promise<void> {
    try {
      const message = `Alert action failed (${action}, ${alertId}): ${detail}`.slice(0, 255);
      const open = await this.alertRepository.findOpenAlertBySignature({
        userId,
        channel: 'Alerts',
        source: 'alerts-api',
        message,
      });
      if (open) {
        return;
      }
      await this.alertRepository.createAlert({
        userId,
        severity: 'High',
        channel: 'Alerts',
        symbol: 'SYSTEM',
        message,
        route: 'Risk review',
        status: 'Open',
        source: 'alerts-api',
        urgency: null,
        applyEscalationPolicy: true,
      });
    } catch {
      // Keep alerts operations non-blocking if alert emission fails.
    }
  }
}
