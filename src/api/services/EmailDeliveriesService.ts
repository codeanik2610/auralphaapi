import { Inject, Service } from 'typedi';
import {
  EMAIL_DELIVERY_BODY_VISIBILITY,
  EMAIL_DELIVERY_BODY_PREVIEW_MAX_CHARS,
  EMAIL_DELIVERY_BODY_PREVIEW_MAX_LINES,
  EMAIL_DELIVERY_CLEANUP_ELIGIBLE_STATUSES,
  EMAIL_DELIVERY_CLEANUP_PROTECTED_STATUSES,
  EMAIL_DELIVERY_DEFAULT_RETENTION_DAYS,
  EMAIL_DELIVERY_EXPORT_MAX_ROWS,
  EMAIL_DELIVERY_RETENTION_FIELD,
} from '../constants/emailDeliveries';
import { ApiSuccessResponse } from '../contracts/ApiResponse';
import {
  EmailDeliveryActionResult,
  EmailDeliveryBulkActionResult,
  EmailDeliveryBulkPreviewResult,
  EmailDeliveryCleanupActivityItem,
  EmailDeliveryCleanupResult,
  EmailDeliveryCleanupPreviewResult,
  EmailDeliveryFilterOptions,
  EmailDeliveryExportBody,
  EmailDeliveryExportResult,
  EmailDeliveryMatchingCleanupPreviewResult,
  EmailDeliveryMatchingCleanupResult,
  EmailDeliveriesListResponse,
  EmailDeliveriesSummary,
  EmailDeliveryItem,
} from '../contracts/EmailDelivery';
import { BadRequestAppError, ForbiddenAppError, NotFoundAppError } from '../errors/AppError';
import { successResponse } from '../utils/response';
import { AuthUserContext } from '../utils/auth';
import {
  EmailDeliveriesQuery,
  hasEmailDeliveryFilters,
  validateEmailDeliveriesFilters,
  validateEmailDeliveriesQuery,
  validateEmailDeliveryExportBody,
  validateEmailDeliveryId,
  validateEmailDeliveryRetentionDays,
} from '../validators/emailDeliveries.validator';
import {
  ActivityRepository,
  EmailDelivery,
  EmailDeliveryRepository,
  UserRepository,
} from '../../database';
import { OperationalEventService } from './OperationalEventService';

@Service()
export class EmailDeliveriesService {
  @Inject(() => EmailDeliveryRepository)
  private emailDeliveryRepository!: EmailDeliveryRepository;

  @Inject(() => ActivityRepository)
  private activityRepository!: ActivityRepository;

  @Inject(() => UserRepository)
  private userRepository!: UserRepository;

  @Inject(() => OperationalEventService)
  private operationalEventService!: OperationalEventService;

  async getEmailDeliveries(
    auth: AuthUserContext,
    query: EmailDeliveriesQuery
  ): Promise<ApiSuccessResponse<EmailDeliveriesListResponse>> {
    this.requireAdmin(auth);
    const params = validateEmailDeliveriesQuery(query);
    const { items, total } = await this.emailDeliveryRepository.listDeliveries(params);
    const userMap = await this.getUserMap(items.map((item) => item.userId));

    return successResponse({
      items: items.map((item) => this.mapDelivery(item, userMap)),
      total,
      limit: params.limit,
      offset: params.offset,
    });
  }

  async getEmailDeliveriesSummary(
    auth: AuthUserContext
  ): Promise<ApiSuccessResponse<EmailDeliveriesSummary>> {
    this.requireAdmin(auth);
    const summary = await this.emailDeliveryRepository.getSummary();

    return successResponse({
      queued: summary.queued,
      sending: summary.sending,
      sent: summary.sent,
      failed: summary.failed,
      active: summary.active,
      latestSentAt: summary.latestSentAt?.toISOString(),
      oldestPendingAt: summary.oldestPendingAt?.toISOString(),
    });
  }

  async getEmailDeliveryFilterOptions(
    auth: AuthUserContext
  ): Promise<ApiSuccessResponse<EmailDeliveryFilterOptions>> {
    this.requireAdmin(auth);
    const filterOptions = await this.emailDeliveryRepository.getFilterOptions();

    return successResponse({
      ...filterOptions,
      defaultRetentionDays: EMAIL_DELIVERY_DEFAULT_RETENTION_DAYS,
      exportMaxRows: EMAIL_DELIVERY_EXPORT_MAX_ROWS,
      bodyVisibility: EMAIL_DELIVERY_BODY_VISIBILITY,
      governance: {
        bodyVisibility: EMAIL_DELIVERY_BODY_VISIBILITY,
        cleanupEligibleStatuses: [...EMAIL_DELIVERY_CLEANUP_ELIGIBLE_STATUSES],
        cleanupProtectedStatuses: [...EMAIL_DELIVERY_CLEANUP_PROTECTED_STATUSES],
        retentionField: EMAIL_DELIVERY_RETENTION_FIELD,
        bodyPreviewMaxChars: EMAIL_DELIVERY_BODY_PREVIEW_MAX_CHARS,
        bodyPreviewMaxLines: EMAIL_DELIVERY_BODY_PREVIEW_MAX_LINES,
      },
    });
  }

  async getLatestCleanupActivity(
    auth: AuthUserContext
  ): Promise<ApiSuccessResponse<EmailDeliveryCleanupActivityItem | null>> {
    this.requireAdmin(auth);
    const item = await this.activityRepository.getLatestEmailDeliveryCleanupActivity();

    return successResponse(item ? this.mapCleanupActivity(item) : null);
  }

  async getEmailDeliveryById(
    auth: AuthUserContext,
    deliveryId: string
  ): Promise<ApiSuccessResponse<EmailDeliveryItem>> {
    this.requireAdmin(auth);
    const validatedDeliveryId = validateEmailDeliveryId(deliveryId);
    const item = await this.emailDeliveryRepository.getDeliveryById(validatedDeliveryId);

    if (!item) {
      throw new NotFoundAppError('Email delivery not found');
    }

    const userMap = await this.getUserMap([item.userId]);
    return successResponse(this.mapDelivery(item, userMap, { includeBodyPreview: true }));
  }

  async exportEmailDeliveries(
    auth: AuthUserContext,
    body: EmailDeliveryExportBody = {}
  ): Promise<ApiSuccessResponse<EmailDeliveryExportResult>> {
    this.requireAdmin(auth);
    const validated = validateEmailDeliveryExportBody(body);
    const { items } = await this.emailDeliveryRepository.listDeliveries({
      limit: EMAIL_DELIVERY_EXPORT_MAX_ROWS,
      offset: 0,
      status: validated.status,
      search: validated.search,
      userId: validated.userId,
      recipient: validated.recipient,
      severity: validated.severity,
      channel: validated.channel,
      source: validated.source,
    });
    const userMap = await this.getUserMap(items.map((item) => item.userId));
    const rows = items.map((item) => this.mapDelivery(item, userMap));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const scopeLabel =
      this.formatFilterSummary({
        status: validated.status,
        search: validated.search,
        userId: validated.userId,
        recipient: validated.recipient,
        severity: validated.severity,
        channel: validated.channel,
        source: validated.source,
      }) === 'none'
        ? 'all'
        : 'filtered';
    const fileName = `email-deliveries-${scopeLabel}-${timestamp}.csv`;
    const csvHeader = [
      'id',
      'status',
      'recipientEmail',
      'userId',
      'userEmail',
      'userName',
      'subject',
      'channel',
      'severity',
      'route',
      'source',
      'attempts',
      'alertId',
      'lastError',
      'createdAt',
      'updatedAt',
    ];
    const csvRows = rows.map((row) => [
      row.id,
      row.status,
      row.recipientEmail,
      row.userId,
      row.userEmail || '',
      row.userName || '',
      row.subject,
      row.channel,
      row.severity,
      row.route || '',
      row.source || '',
      row.attempts,
      row.alertId || '',
      row.lastError || '',
      row.createdAt,
      row.updatedAt,
    ]);
    const csv = [csvHeader, ...csvRows]
      .map((columns) =>
        columns.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');

    return successResponse({
      message: `Email delivery export ready (${rows.length} row${rows.length === 1 ? '' : 's'})`,
      exportId: `email-deliveries-${Date.now()}`,
      status: 'Ready',
      fileName,
      csv,
      exportedCount: rows.length,
    });
  }

  async retryEmailDelivery(
    auth: AuthUserContext,
    deliveryId: string
  ): Promise<ApiSuccessResponse<EmailDeliveryActionResult>> {
    this.requireAdmin(auth);
    const validatedDeliveryId = validateEmailDeliveryId(deliveryId);
    const item = await this.emailDeliveryRepository.getDeliveryById(validatedDeliveryId);

    if (!item) {
      throw new NotFoundAppError('Email delivery not found');
    }

    if (String(item.status || '').toLowerCase() !== 'failed') {
      throw new BadRequestAppError('Only failed email deliveries can be retried');
    }

    const updated = await this.emailDeliveryRepository.retryFailedDelivery(validatedDeliveryId);

    if (!updated) {
      throw new BadRequestAppError(
        'This email delivery is no longer failed and cannot be retried again'
      );
    }

    const userMap = await this.getUserMap([updated.userId]);
    return successResponse({
      message: 'Email delivery re-queued. Attempts were reset and the previous failure detail was cleared.',
      delivery: this.mapDelivery(updated, userMap, { includeBodyPreview: true }),
    });
  }

  async retryAllFailedEmailDeliveries(
    auth: AuthUserContext
  ): Promise<ApiSuccessResponse<EmailDeliveryBulkActionResult>> {
    this.requireAdmin(auth);
    const updatedCount = await this.emailDeliveryRepository.retryAllFailedDeliveries();

    return successResponse({
      message:
        updatedCount > 0
          ? `${updatedCount} failed email deliver${updatedCount === 1 ? 'y was' : 'ies were'} re-queued`
          : 'No failed email deliveries were waiting for retry',
      updatedCount,
    });
  }

  async previewMatchingFailedEmailDeliveries(
    auth: AuthUserContext,
    query: EmailDeliveriesQuery
  ): Promise<ApiSuccessResponse<EmailDeliveryBulkPreviewResult>> {
    this.requireAdmin(auth);
    const filters = validateEmailDeliveriesFilters(query);
    const matchingCount = await this.emailDeliveryRepository.countMatchingFailedDeliveries(
      filters
    );

    return successResponse({
      message:
        matchingCount > 0
          ? `${matchingCount} failed email deliver${matchingCount === 1 ? 'y matches' : 'ies match'} the current filters`
          : 'No failed email deliveries match the current filters',
      matchingCount,
    });
  }

  async retryMatchingFailedEmailDeliveries(
    auth: AuthUserContext,
    query: EmailDeliveriesQuery
  ): Promise<ApiSuccessResponse<EmailDeliveryBulkActionResult>> {
    this.requireAdmin(auth);
    const {
      status,
      search,
      userId,
      recipient,
      severity,
      channel,
      source,
    } = validateEmailDeliveriesFilters(query);

    const updatedCount = await this.emailDeliveryRepository.retryMatchingFailedDeliveries({
      status,
      search,
      userId,
      recipient,
      severity,
      channel,
      source,
    });

    return successResponse({
      message:
        updatedCount > 0
          ? `${updatedCount} failed email deliver${updatedCount === 1 ? 'y was' : 'ies were'} re-queued for the current filters`
          : 'No failed email deliveries matched the current filters',
      updatedCount,
    });
  }

  async previewCleanupEmailDeliveries(
    auth: AuthUserContext,
    retentionDays?: string
  ): Promise<ApiSuccessResponse<EmailDeliveryCleanupPreviewResult>> {
    this.requireAdmin(auth);
    const normalizedRetentionDays = validateEmailDeliveryRetentionDays(retentionDays);
    const counts = await this.emailDeliveryRepository.countTerminalDeliveriesOlderThanDays(
      normalizedRetentionDays
    );

    return successResponse({
      message:
        counts.total > 0
          ? `${counts.total} email deliver${counts.total === 1 ? 'y is' : 'ies are'} ready for cleanup`
          : `No sent or failed email deliveries are older than ${normalizedRetentionDays} days`,
      retentionDays: normalizedRetentionDays,
      matchingCount: counts.total,
      sentCount: counts.sent,
      failedCount: counts.failed,
    });
  }

  async previewMatchingCleanupEmailDeliveries(
    auth: AuthUserContext,
    query: EmailDeliveriesQuery
  ): Promise<ApiSuccessResponse<EmailDeliveryMatchingCleanupPreviewResult>> {
    this.requireAdmin(auth);
    const filters = validateEmailDeliveriesFilters(query);

    if (!hasEmailDeliveryFilters(filters)) {
      throw new BadRequestAppError(
        'At least one filter is required to preview filtered email cleanup'
      );
    }

    const counts = await this.emailDeliveryRepository.countMatchingTerminalDeliveries(filters);

    return successResponse({
      message:
        counts.total > 0
          ? `${counts.total} sent/failed email deliver${counts.total === 1 ? 'y matches' : 'ies match'} the current filters`
          : 'No sent or failed email deliveries match the current filters',
      matchingCount: counts.total,
      sentCount: counts.sent,
      failedCount: counts.failed,
    });
  }

  async cleanupEmailDeliveries(
    auth: AuthUserContext,
    retentionDays?: string
  ): Promise<ApiSuccessResponse<EmailDeliveryCleanupResult>> {
    this.requireAdmin(auth);
    const normalizedRetentionDays = validateEmailDeliveryRetentionDays(retentionDays);
    const counts = await this.emailDeliveryRepository.countTerminalDeliveriesOlderThanDays(
      normalizedRetentionDays
    );

    if (counts.total > 0) {
      await this.emailDeliveryRepository.deleteTerminalDeliveriesOlderThanDays(
        normalizedRetentionDays
      );
    }

    await this.logCleanupActivity(auth.userId, {
      title:
        counts.total > 0
          ? `Retention email cleanup removed ${counts.total} deliver${counts.total === 1 ? 'y' : 'ies'}`
          : 'Retention email cleanup found no eligible deliveries',
      description: `Retention window: ${normalizedRetentionDays} day(s). Deleted ${counts.total} total delivery records (${counts.sent} sent, ${counts.failed} failed).`,
      status: 'Completed',
      related: 'retention-cleanup',
    });

    return successResponse({
      message:
        counts.total > 0
          ? `Deleted ${counts.total} email deliver${counts.total === 1 ? 'y' : 'ies'} older than ${normalizedRetentionDays} days`
          : `No sent or failed email deliveries were older than ${normalizedRetentionDays} days`,
      retentionDays: normalizedRetentionDays,
      deletedCount: counts.total,
      deletedSentCount: counts.sent,
      deletedFailedCount: counts.failed,
    });
  }

  async cleanupMatchingEmailDeliveries(
    auth: AuthUserContext,
    query: EmailDeliveriesQuery
  ): Promise<ApiSuccessResponse<EmailDeliveryMatchingCleanupResult>> {
    this.requireAdmin(auth);
    const filters = validateEmailDeliveriesFilters(query);

    if (!hasEmailDeliveryFilters(filters)) {
      throw new BadRequestAppError(
        'At least one filter is required to clean up filtered email deliveries'
      );
    }

    const counts = await this.emailDeliveryRepository.countMatchingTerminalDeliveries(filters);

    if (counts.total > 0) {
      await this.emailDeliveryRepository.deleteMatchingTerminalDeliveries(filters);
    }

    await this.logCleanupActivity(auth.userId, {
      title:
        counts.total > 0
          ? `Filtered email cleanup removed ${counts.total} deliver${counts.total === 1 ? 'y' : 'ies'}`
          : 'Filtered email cleanup found no matching deliveries',
      description: `Deleted ${counts.total} filtered delivery records (${counts.sent} sent, ${counts.failed} failed). Filters: ${this.formatFilterSummary(
        filters
      )}.`,
      status: 'Completed',
      related: 'filtered-cleanup',
    });

    return successResponse({
      message:
        counts.total > 0
          ? `Deleted ${counts.total} filtered email deliver${counts.total === 1 ? 'y' : 'ies'}`
          : 'No sent or failed email deliveries matched the current filters',
      deletedCount: counts.total,
      deletedSentCount: counts.sent,
      deletedFailedCount: counts.failed,
    });
  }

  async sendTestEmailDelivery(
    auth: AuthUserContext
  ): Promise<ApiSuccessResponse<EmailDeliveryActionResult>> {
    try {
      this.requireAdmin(auth);
      const user = await this.userRepository.findById(auth.userId);

      if (!user) {
        throw new NotFoundAppError('Admin user was not found');
      }

      const recipientEmail = String(user.email || '').trim().toLowerCase();
      if (!recipientEmail) {
        throw new BadRequestAppError('Your account does not have an email address for test sends');
      }

      const queued = await this.emailDeliveryRepository.queueDelivery({
        userId: auth.userId,
        alertId: null,
        recipientEmail,
        subject: `AurAlpha SMTP test · ${new Date().toISOString()}`,
        body: [
          'This is a queued test email from the AurAlpha email delivery monitor.',
          '',
          `Recipient: ${recipientEmail}`,
          `Queued at (UTC): ${new Date().toISOString()}`,
          `Environment: ${process.env.NODE_ENV || 'development'}`,
          '',
          'If you received this, the outbox, worker, and SMTP transport are all connected.',
        ].join('\n'),
        channel: 'email',
        severity: 'Low',
        route: 'Email delivery monitor',
        source: 'email-deliveries:test',
        status: 'Queued',
        attempts: 0,
        lastError: null,
      });

      const userMap = await this.getUserMap([queued.userId]);
      return successResponse({
        message: `Test email queued for ${recipientEmail}`,
        delivery: this.mapDelivery(queued, userMap, { includeBodyPreview: true }),
      });
    } catch (error) {
      await this.operationalEventService.emitFailureAlert(auth.userId, {
        channel: 'Email Deliveries',
        source: 'email-deliveries:test',
        message: `Test email queue failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        route: 'Risk review',
      });
      throw error;
    }
  }

  async resendEmailDelivery(
    auth: AuthUserContext,
    deliveryId: string
  ): Promise<ApiSuccessResponse<EmailDeliveryActionResult>> {
    this.requireAdmin(auth);
    const validatedDeliveryId = validateEmailDeliveryId(deliveryId);
    const item = await this.emailDeliveryRepository.getDeliveryById(validatedDeliveryId);

    if (!item) {
      throw new NotFoundAppError('Email delivery not found');
    }

    const normalizedStatus = String(item.status || '').toLowerCase();
    if (normalizedStatus === 'queued' || normalizedStatus === 'sending') {
      throw new BadRequestAppError(
        'Only completed or failed email deliveries can be resent as a new copy'
      );
    }

    const cloned = await this.emailDeliveryRepository.cloneDeliveryForResend(item);
    const userMap = await this.getUserMap([cloned.userId]);

    return successResponse({
      message: 'A new delivery copy has been queued. The original record remains unchanged for history.',
      delivery: this.mapDelivery(cloned, userMap, { includeBodyPreview: true }),
    });
  }

  private async getUserMap(
    userIds: string[]
  ): Promise<Map<string, { email: string; fullName: string }>> {
    const users = await this.userRepository.findByIds(userIds);
    return new Map(
      users.map((user) => [
        user.id,
        {
          email: user.email,
          fullName: user.fullName,
        },
      ])
    );
  }

  private mapDelivery(
    item: EmailDelivery,
    userMap: Map<string, { email: string; fullName: string }>,
    options: {
      includeBodyPreview?: boolean;
    } = {}
  ): EmailDeliveryItem {
    const user = userMap.get(item.userId);
    const bodyPreview = options.includeBodyPreview
      ? this.buildBodyPreview(item.body)
      : undefined;

    return {
      id: item.id,
      userId: item.userId,
      userEmail: user?.email,
      userName: user?.fullName,
      alertId: item.alertId ?? undefined,
      recipientEmail: item.recipientEmail,
      subject: item.subject,
      channel: item.channel,
      severity: item.severity,
      route: item.route ?? undefined,
      source: item.source ?? undefined,
      status: item.status as EmailDeliveryItem['status'],
      attempts: item.attempts,
      lastError: item.lastError ?? undefined,
      bodyPreview: bodyPreview?.value,
      bodyPreviewTruncated: bodyPreview?.truncated || undefined,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private buildBodyPreview(
    body: string | null | undefined
  ): { value: string; truncated: boolean } | undefined {
    const normalizedBody = String(body || '').replace(/\r\n/g, '\n').trim();
    if (!normalizedBody) {
      return undefined;
    }

    const redactedBody = normalizedBody
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/https?:\/\/\S+/gi, '[redacted-link]')
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
        '[redacted-id]'
      )
      .replace(/\b(?:[A-Za-z0-9+/_=-]{24,}|[0-9]{6,})\b/g, '[redacted-token]');

    const limitedLines = redactedBody
      .split('\n')
      .slice(0, EMAIL_DELIVERY_BODY_PREVIEW_MAX_LINES)
      .join('\n')
      .trim();

    if (!limitedLines) {
      return undefined;
    }

    const shouldTruncate =
      limitedLines.length > EMAIL_DELIVERY_BODY_PREVIEW_MAX_CHARS ||
      redactedBody !== limitedLines;
    const value = shouldTruncate
      ? `${limitedLines.slice(0, EMAIL_DELIVERY_BODY_PREVIEW_MAX_CHARS).trimEnd()}...`
      : limitedLines;

    return {
      value,
      truncated: shouldTruncate,
    };
  }

  private mapCleanupActivity(item: {
    id: string;
    userId: string;
    title: string;
    status: string;
    actor: string | null;
    stream: string | null;
    route: string | null;
    related: string | null;
    description: string | null;
    createdAt: Date;
  }): EmailDeliveryCleanupActivityItem {
    return {
      id: item.id,
      userId: item.userId,
      title: item.title,
      status: item.status,
      actor: item.actor ?? undefined,
      stream: item.stream ?? undefined,
      route: item.route ?? undefined,
      related: item.related ?? undefined,
      description: item.description ?? undefined,
      time: item.createdAt.toISOString(),
    };
  }

  private formatFilterSummary(filters: {
    status?: string;
    search?: string;
    userId?: string;
    recipient?: string;
    severity?: string;
    channel?: string;
    source?: string;
  }): string {
    const entries = [
      ['status', filters.status],
      ['severity', filters.severity],
      ['channel', filters.channel],
      ['recipient', filters.recipient],
      ['source', filters.source],
      ['search', filters.search],
      ['userId', filters.userId],
    ].filter(([, value]) => String(value || '').trim().length > 0);

    if (!entries.length) {
      return 'none';
    }

    return entries.map(([key, value]) => `${key}=${value}`).join(', ');
  }

  private async logCleanupActivity(
    userId: string,
    payload: {
      title: string;
      description: string;
      status?: string;
      related?: string | null;
    }
  ): Promise<void> {
    try {
      if (!userId) {
        return;
      }

      await this.activityRepository.createActivityLog({
        userId,
        type: 'Email Deliveries',
        title: payload.title,
        status: payload.status ?? 'Completed',
        actor: userId,
        route: 'Email Deliveries',
        stream: 'Controls',
        related: payload.related ?? 'cleanup',
        description: payload.description,
      });
    } catch {
      // Keep cleanup operations non-blocking if activity logging fails.
    }
  }

  private requireAdmin(auth: AuthUserContext): void {
    if (String(auth?.role || '').toLowerCase() !== 'admin') {
      throw new ForbiddenAppError('Admin role is required to monitor email deliveries');
    }
  }
}
