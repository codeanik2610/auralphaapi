import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { Repository } from 'typeorm';
import { coreDataSource } from '../data-source';
import { SignalAlertLink } from '../entities/SignalAlertLink';

export interface CreateSignalAlertLinkPayload {
  userId: string;
  signalId: string;
  alertId: string;
  relationType?: string | null;
}

@Service()
export class SignalAlertLinkRepository {
  private get repository(): Repository<SignalAlertLink> {
    return coreDataSource.getRepository(SignalAlertLink);
  }

  async createLink(payload: CreateSignalAlertLinkPayload): Promise<SignalAlertLink> {
    const relationType = String(payload.relationType || 'related').trim() || 'related';
    const existing = await this.repository.findOne({
      where: {
        userId: payload.userId,
        signalId: payload.signalId,
        alertId: payload.alertId,
        relationType,
      },
    });

    if (existing) {
      return existing;
    }

    const entity = this.repository.create({
      id: randomUUID(),
      userId: payload.userId,
      signalId: payload.signalId,
      alertId: payload.alertId,
      relationType,
    });

    return this.repository.save(entity);
  }

  async listLinkedAlertIds(userId: string, signalId: string, limit = 6): Promise<string[]> {
    const normalizedUserId = String(userId || '').trim();
    const normalizedSignalId = String(signalId || '').trim();
    if (!normalizedUserId || !normalizedSignalId) {
      return [];
    }

    const requestedLimit = Number(limit);
    const take = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 20)
      : 6;

    const rows = await this.repository.find({
      where: {
        userId: normalizedUserId,
        signalId: normalizedSignalId,
      },
      order: {
        createdAt: 'DESC',
      },
      take,
    });

    return rows.map((row) => row.alertId);
  }
}
