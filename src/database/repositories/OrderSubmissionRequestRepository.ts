import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { OrderSubmissionRequest } from '../entities/OrderSubmissionRequest';

export interface CreateOrderSubmissionRequestPayload {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  executionMode: string;
  assetId: string;
  brokerKey?: string | null;
  accountId?: string | null;
  suggestedTradeId?: string | null;
  requestPayload?: Record<string, unknown> | null;
}

export interface OrderSubmissionLifecycleEvent {
  type: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface OrderSubmissionCompletionOptions {
  placementState?: OrderSubmissionRequest['placementState'];
  brokerOrderId?: string | null;
  brokerOrderStatus?: string | null;
  reconciliationState?: OrderSubmissionRequest['reconciliationState'];
  lifecycleEvent?: OrderSubmissionLifecycleEvent;
}

export interface OrderSubmissionFailureOptions {
  placementState?: OrderSubmissionRequest['placementState'];
  reconciliationState?: OrderSubmissionRequest['reconciliationState'];
  lifecycleEvent?: OrderSubmissionLifecycleEvent;
}

export interface OrderSubmissionAttemptsListQuery {
  userId: string;
  limit: number;
  offset: number;
  suggestedTradeId?: string;
  status?: OrderSubmissionRequest['status'];
  placementState?: OrderSubmissionRequest['placementState'];
  reconciliationState?: OrderSubmissionRequest['reconciliationState'];
  brokerKey?: string;
  accountId?: string;
}

export interface OrderSubmissionReconciliationCandidatesQuery {
  userId: string;
  limit: number;
  brokerKey?: string;
  accountId?: string;
}

export interface OrderSubmissionOrderIdCandidatesQuery {
  userId: string;
  brokerKey: string;
  accountId: string;
  brokerOrderIds: string[];
}

@Service()
export class OrderSubmissionRequestRepository {
  private get repository(): Repository<OrderSubmissionRequest> {
    return coreDataSource.getRepository(OrderSubmissionRequest);
  }

  async findByUserAndKey(
    userId: string,
    idempotencyKey: string
  ): Promise<OrderSubmissionRequest | null> {
    return this.repository.findOne({
      where: {
        userId,
        idempotencyKey,
      },
    });
  }

  async findByUserAndId(
    userId: string,
    submissionId: string
  ): Promise<OrderSubmissionRequest | null> {
    return this.repository.findOne({
      where: {
        userId,
        id: submissionId,
      },
    });
  }

  async listSubmissionAttempts(
    query: OrderSubmissionAttemptsListQuery
  ): Promise<{ items: OrderSubmissionRequest[]; total: number }> {
    const builder = this.repository
      .createQueryBuilder('submission')
      .where('submission.userId = :userId', { userId: query.userId });

    if (query.suggestedTradeId) {
      builder.andWhere('submission.suggestedTradeId = :suggestedTradeId', {
        suggestedTradeId: query.suggestedTradeId,
      });
    }

    if (query.status) {
      builder.andWhere('submission.status = :status', { status: query.status });
    }

    if (query.placementState) {
      builder.andWhere('submission.placementState = :placementState', {
        placementState: query.placementState,
      });
    }

    if (query.reconciliationState) {
      builder.andWhere('submission.reconciliationState = :reconciliationState', {
        reconciliationState: query.reconciliationState,
      });
    }

    if (query.brokerKey) {
      builder.andWhere('LOWER(COALESCE(submission.brokerKey, \'\')) = :brokerKey', {
        brokerKey: query.brokerKey.toLowerCase(),
      });
    }

    if (query.accountId) {
      builder.andWhere('submission.accountId = :accountId', {
        accountId: query.accountId,
      });
    }

    const [items, total] = await builder
      .orderBy('submission.createdAt', 'DESC')
      .addOrderBy('submission.id', 'DESC')
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();

    return { items, total };
  }

  async listReconciliationCandidates(
    query: OrderSubmissionReconciliationCandidatesQuery
  ): Promise<OrderSubmissionRequest[]> {
    const builder = this.repository
      .createQueryBuilder('submission')
      .where('submission.userId = :userId', { userId: query.userId })
      .andWhere('submission.status = :status', { status: 'completed' })
      .andWhere('submission.placementState = :placementState', {
        placementState: 'placed',
      })
      .andWhere('submission.reconciliationState IN (:...states)', {
        states: ['pending', 'missing'],
      })
      .orderBy('submission.updatedAt', 'ASC')
      .addOrderBy('submission.createdAt', 'ASC')
      .take(query.limit);

    if (query.brokerKey) {
      builder.andWhere('LOWER(COALESCE(submission.brokerKey, \'\')) = :brokerKey', {
        brokerKey: query.brokerKey.toLowerCase(),
      });
    }

    if (query.accountId) {
      builder.andWhere('submission.accountId = :accountId', {
        accountId: query.accountId,
      });
    }

    return builder.getMany();
  }

  async listReconciliationCandidatesByBrokerOrderIds(
    query: OrderSubmissionOrderIdCandidatesQuery
  ): Promise<OrderSubmissionRequest[]> {
    const brokerOrderIds = Array.from(
      new Set(query.brokerOrderIds.map((item) => String(item || '').trim()).filter(Boolean))
    );
    if (!brokerOrderIds.length) {
      return [];
    }

    return this.repository
      .createQueryBuilder('submission')
      .where('submission.userId = :userId', { userId: query.userId })
      .andWhere('LOWER(COALESCE(submission.brokerKey, \'\')) = :brokerKey', {
        brokerKey: query.brokerKey.toLowerCase(),
      })
      .andWhere('submission.accountId = :accountId', { accountId: query.accountId })
      .andWhere('submission.status = :status', { status: 'completed' })
      .andWhere('submission.placementState = :placementState', {
        placementState: 'placed',
      })
      .andWhere('submission.reconciliationState IN (:...states)', {
        states: ['pending', 'missing'],
      })
      .andWhere('submission.brokerOrderId IN (:...brokerOrderIds)', {
        brokerOrderIds,
      })
      .orderBy('submission.updatedAt', 'ASC')
      .getMany();
  }

  async createInProgress(
    payload: CreateOrderSubmissionRequestPayload
  ): Promise<OrderSubmissionRequest> {
    const entity = this.repository.create({
      id: randomUUID(),
      userId: payload.userId,
      idempotencyKey: payload.idempotencyKey,
      requestHash: payload.requestHash,
      executionMode: payload.executionMode,
      assetId: payload.assetId,
      brokerKey: payload.brokerKey || null,
      accountId: payload.accountId || null,
      suggestedTradeId: payload.suggestedTradeId || null,
      requestPayload: payload.requestPayload || null,
      status: 'in_progress',
      placementState: 'registered',
      brokerOrderId: null,
      brokerOrderStatus: null,
      reconciliationState: 'not_required',
      responsePayload: null,
      errorPayload: null,
      lifecyclePayload: this.appendLifecycleEvent(null, {
        type: 'submission_registered',
        details: {
          executionMode: payload.executionMode,
          brokerKey: payload.brokerKey || null,
          accountId: payload.accountId || null,
          suggestedTradeId: payload.suggestedTradeId || null,
        },
      }),
      completedAt: null,
      failedAt: null,
    });

    return this.repository.save(entity);
  }

  async markInProgress(
    request: OrderSubmissionRequest,
    requestHash: string
  ): Promise<OrderSubmissionRequest> {
    request.requestHash = requestHash;
    request.status = 'in_progress';
    request.placementState = 'registered';
    request.brokerOrderId = null;
    request.brokerOrderStatus = null;
    request.reconciliationState = 'not_required';
    request.responsePayload = null;
    request.errorPayload = null;
    request.lifecyclePayload = this.appendLifecycleEvent(request.lifecyclePayload, {
      type: 'submission_restarted',
      message: 'Stale order submission was restarted with the same idempotency key.',
    });
    request.completedAt = null;
    request.failedAt = null;
    return this.repository.save(request);
  }

  async markBrokerSubmitting(
    request: OrderSubmissionRequest,
    event: OrderSubmissionLifecycleEvent = {
      type: 'broker_call_started',
      message: 'Broker placement call started.',
    }
  ): Promise<OrderSubmissionRequest> {
    request.status = 'in_progress';
    request.placementState = 'submitting';
    request.lifecyclePayload = this.appendLifecycleEvent(request.lifecyclePayload, event);
    return this.repository.save(request);
  }

  async markCompleted(
    request: OrderSubmissionRequest,
    responsePayload: Record<string, unknown>,
    options: OrderSubmissionCompletionOptions = {}
  ): Promise<OrderSubmissionRequest> {
    request.status = 'completed';
    request.placementState = options.placementState || 'placed';
    request.brokerOrderId = this.normalizeOptionalString(options.brokerOrderId);
    request.brokerOrderStatus = this.normalizeOptionalString(options.brokerOrderStatus);
    request.reconciliationState = options.reconciliationState || 'not_required';
    request.responsePayload = responsePayload;
    request.errorPayload = null;
    request.lifecyclePayload = this.appendLifecycleEvent(request.lifecyclePayload, {
      type: 'submission_completed',
      message: 'Order submission completed.',
      ...(options.lifecycleEvent || {}),
    });
    request.completedAt = new Date();
    request.failedAt = null;
    return this.repository.save(request);
  }

  async markFailed(
    request: OrderSubmissionRequest,
    errorPayload: Record<string, unknown>,
    options: OrderSubmissionFailureOptions = {}
  ): Promise<OrderSubmissionRequest> {
    request.status = 'failed';
    request.placementState = options.placementState || 'rejected';
    request.reconciliationState = options.reconciliationState || 'not_required';
    request.errorPayload = errorPayload;
    request.responsePayload = null;
    request.lifecyclePayload = this.appendLifecycleEvent(request.lifecyclePayload, {
      type: 'submission_failed',
      message:
        typeof errorPayload.message === 'string'
          ? errorPayload.message
          : 'Order submission failed.',
      ...(options.lifecycleEvent || {}),
    });
    request.completedAt = null;
    request.failedAt = new Date();
    return this.repository.save(request);
  }

  async markReconciliationMatched(
    request: OrderSubmissionRequest,
    options: {
      brokerOrderStatus?: string | null;
      lifecycleEvent?: OrderSubmissionLifecycleEvent;
    } = {}
  ): Promise<OrderSubmissionRequest> {
    request.reconciliationState = 'matched';
    request.brokerOrderStatus =
      this.normalizeOptionalString(options.brokerOrderStatus) || request.brokerOrderStatus;
    request.lifecyclePayload = this.appendLifecycleEvent(request.lifecyclePayload, {
      type: 'broker_order_snapshot_matched',
      message: 'Broker order was confirmed in the scheduler snapshot.',
      ...(options.lifecycleEvent || {}),
    });
    return this.repository.save(request);
  }

  async markReconciliationMissing(
    request: OrderSubmissionRequest,
    options: { lifecycleEvent?: OrderSubmissionLifecycleEvent } = {}
  ): Promise<OrderSubmissionRequest> {
    request.reconciliationState = 'missing';
    request.lifecyclePayload = this.appendLifecycleEvent(request.lifecyclePayload, {
      type: 'broker_order_snapshot_missing',
      message: 'Broker order was not found after the safe reconciliation threshold.',
      ...(options.lifecycleEvent || {}),
    });
    return this.repository.save(request);
  }

  isDuplicateIdempotencyKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const value = error as { code?: string; errno?: number };
    return value.code === 'ER_DUP_ENTRY' || value.errno === 1062;
  }

  private appendLifecycleEvent(
    current: Array<Record<string, unknown>> | Record<string, unknown> | string | null | undefined,
    event: OrderSubmissionLifecycleEvent
  ): Array<Record<string, unknown>> {
    const existing = this.normalizeLifecyclePayload(current);
    return [
      ...existing,
      {
        at: new Date().toISOString(),
        ...event,
      },
    ];
  }

  private normalizeLifecyclePayload(
    current: Array<Record<string, unknown>> | Record<string, unknown> | string | null | undefined
  ): Array<Record<string, unknown>> {
    if (Array.isArray(current)) {
      return current.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    }

    if (typeof current === 'string') {
      try {
        const parsed = JSON.parse(current) as unknown;
        return this.normalizeLifecyclePayload(
          parsed as Array<Record<string, unknown>> | Record<string, unknown>
        );
      } catch {
        return [];
      }
    }

    if (current && typeof current === 'object') {
      return [current as Record<string, unknown>];
    }

    return [];
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const normalized = String(value).trim();
    return normalized ? normalized : null;
  }
}
