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
      status: 'in_progress',
      responsePayload: null,
      errorPayload: null,
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
    request.responsePayload = null;
    request.errorPayload = null;
    request.completedAt = null;
    request.failedAt = null;
    return this.repository.save(request);
  }

  async markCompleted(
    request: OrderSubmissionRequest,
    responsePayload: Record<string, unknown>
  ): Promise<OrderSubmissionRequest> {
    request.status = 'completed';
    request.responsePayload = responsePayload;
    request.errorPayload = null;
    request.completedAt = new Date();
    request.failedAt = null;
    return this.repository.save(request);
  }

  async markFailed(
    request: OrderSubmissionRequest,
    errorPayload: Record<string, unknown>
  ): Promise<OrderSubmissionRequest> {
    request.status = 'failed';
    request.errorPayload = errorPayload;
    request.responsePayload = null;
    request.completedAt = null;
    request.failedAt = new Date();
    return this.repository.save(request);
  }

  isDuplicateIdempotencyKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const value = error as { code?: string; errno?: number };
    return value.code === 'ER_DUP_ENTRY' || value.errno === 1062;
  }
}
